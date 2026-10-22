import type { AppCategory, BusyState, Observation } from '@proj-airi/stage-shared/situation'
import type { ForegroundWindowSample } from '@proj-airi/stage-shared/stores/foreground-window'

import {
  appIdFromExe,
  categorizeApp,
  isDenylisted,
  labelFromExe,
  normalizeWindowTitle,
} from '@proj-airi/stage-shared/situation'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { effectScope, watch } from 'vue'

import { useSituationSettings } from '../../../features/situation/settings'

/**
 * While the stage window is visible, a foreground sample further than this from now is too old to describe the
 * desktop, and busy reads as `unknown`. The producer samples at 1 Hz, so this spans several missed replies.
 *
 * Tuning: keep it several producer intervals long, so one slow main-process reply does not flap busy.
 */
export const FOREGROUND_SAMPLE_STALE_VISIBLE_MS = 5_000

/**
 * The same limit while the stage window is hidden or minimized. Chromium throttles the timers of a hidden window,
 * so samples arrive up to about 12 s apart then (task-17 QA), and the 5 s limit would report a healthy producer as
 * stale.
 *
 * Tuning: keep it above the slowest throttled interval observed on hidden windows.
 */
export const FOREGROUND_SAMPLE_STALE_HIDDEN_MS = 20_000

const BUSY_BY_NOTIFICATION_STATE: Readonly<Record<NonNullable<ForegroundWindowSample['notificationState']>, BusyState>> = Object.freeze({
  'busy': 'busy',
  'd3d-fullscreen': 'fullscreen',
  'presentation': 'presentation',
  'quiet-time': 'quiet',
  'app': 'busy',
  'accepts': 'accepts',
  // The session is locked, switched away, or showing the screen saver; the shell cannot say whether a remark fits.
  'not-present': 'unknown',
})

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Whether `sample` still describes the desktop at `nowMs`. A sample from the future is as untrusted as an old one. */
function isFresh(sample: ForegroundWindowSample, nowMs: number, stageVisible: boolean): boolean {
  const limitMs = stageVisible ? FOREGROUND_SAMPLE_STALE_VISIBLE_MS : FOREGROUND_SAMPLE_STALE_HIDDEN_MS
  return isTime(sample.sampledAtMs) && Math.abs(nowMs - sample.sampledAtMs) <= limitMs
}

function busyOf(sample: ForegroundWindowSample | null, nowMs: number, stageVisible: boolean): BusyState | null {
  if (!sample)
    return null
  if (!isFresh(sample, nowMs, stageVisible))
    return 'unknown'
  const state = sample.notificationState
  return state !== null && Object.hasOwn(BUSY_BY_NOTIFICATION_STATE, state) ? BUSY_BY_NOTIFICATION_STATE[state] : 'unknown'
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

export interface ForegroundSensorOptions {
  /** Whether the stage window is on screen (visible and not minimized); it picks the staleness limit. */
  stageVisible: () => boolean
  /**
   * Receives the category of the user's foreground app while the latest sample is fresh, and `null` once that
   * sample goes stale (or before any sample), so a producer that stops cannot keep a category alive. Called only
   * when the value changes.
   */
  onCategory?: (category: AppCategory | null) => void
}

export interface ForegroundSensor {
  /** Re-evaluates busy and the category at `nowMs` without a new sample, so a sample that stops arriving turns busy `unknown` and clears the category. */
  check: (nowMs: number) => void
  /** App ids of AIRI's own executable, for the reducer's `selfAppIds`. */
  selfAppIds: () => readonly string[]
  stop: () => void
}

/**
 * Turns the foreground window samples of this window into `activity` and `busy` observations.
 *
 * Samples of AIRI's own windows (`ownProcess`, including the Godot stage sidecar) never become activity; the
 * first one only records AIRI's app id for {@link ForegroundSensor.selfAppIds}. Activity is reported when the
 * app id or the normalized title changes. An executable on the `titleDenylist` setting still reports its app,
 * label and category, but its title is dropped here and reaches no observation, log, or prompt.
 *
 * Busy comes from the shell notification state, which describes the whole session rather than one window, so own
 * samples count for it too. It is reported only when it changes. A sample older than
 * {@link FOREGROUND_SAMPLE_STALE_VISIBLE_MS} while the stage is visible, or {@link FOREGROUND_SAMPLE_STALE_HIDDEN_MS}
 * while it is hidden, reads as busy `unknown` and reports no activity. The caller owns the clock through
 * {@link ForegroundSensor.check}. Hosts without a producer keep a `null` sample and send nothing.
 *
 * While the `shareForegroundWindow` setting is false, the sensor treats every sample as missing: it reports no busy
 * state, activity, or category, and clears a reported category. It forgets what it reported, so turning the setting
 * back on reports the current sample again, even for the same app.
 */
export function startForegroundSensor(ingest: (observation: Observation) => void, options: ForegroundSensorOptions): ForegroundSensor {
  const foreground = useForegroundWindowStore()
  const settings = useSituationSettings()
  let busy: BusyState | null = null
  let lastAppId: string | null = null
  let lastTitle: string | null = null
  let selfAppIds: readonly string[] = []
  let lastCategory: AppCategory | null = null
  let reportedCategory: AppCategory | null = null

  /** The latest sample, or `null` while the user does not share the foreground app. */
  function sharedSample(): ForegroundWindowSample | null {
    return settings.document.shareForegroundWindow ? foreground.sample : null
  }

  function forgetReported() {
    busy = null
    lastAppId = null
    lastTitle = null
    lastCategory = null
  }

  /** Reports the last user category while the latest sample (own windows included) is fresh, else `null`. */
  function reportCategory(nowMs: number) {
    const sample = sharedSample()
    const next = sample && isFresh(sample, nowMs, options.stageVisible()) ? lastCategory : null
    if (next === reportedCategory)
      return
    reportedCategory = next
    options.onCategory?.(next)
  }

  function reportBusy(nowMs: number) {
    const next = busyOf(sharedSample(), nowMs, options.stageVisible())
    if (next === null || next === busy)
      return
    busy = next
    ingest({ kind: 'busy', state: next, atMs: nowMs })
  }

  function reportActivity(sample: ForegroundWindowSample) {
    const exe = nonEmptyString(sample.exePath) ?? nonEmptyString(sample.exeName)
    if (!exe)
      return
    const appId = appIdFromExe(exe)
    if (!appId)
      return
    if (sample.ownProcess === true) {
      if (selfAppIds.length === 0)
        selfAppIds = [appId]
      return
    }

    const exeName = nonEmptyString(sample.exeName) ?? exe
    const label = labelFromExe(exeName)
    const title = isDenylisted(exeName, settings.document.titleDenylist) ? null : normalizeWindowTitle(sample.title, label)
    if (appId === lastAppId && title === lastTitle)
      return
    lastAppId = appId
    lastTitle = title
    const category = categorizeApp(nonEmptyString(sample.exePath) ?? '', exeName)
    lastCategory = category
    ingest({
      kind: 'activity',
      appId,
      label,
      category,
      title,
      atMs: sample.sampledAtMs,
    })
  }

  const scope = effectScope(true)
  scope.run(() => {
    watch([() => foreground.sample, () => settings.document.shareForegroundWindow], ([, sharing]) => {
      if (!sharing)
        forgetReported()
      const nowMs = Date.now()
      reportBusy(nowMs)
      const sample = sharedSample()
      if (sample && isFresh(sample, nowMs, options.stageVisible()))
        reportActivity(sample)
      reportCategory(nowMs)
    }, { immediate: true, flush: 'sync' })
  })

  return {
    check(nowMs) {
      reportBusy(nowMs)
      reportCategory(nowMs)
    },
    selfAppIds: () => selfAppIds,
    stop: () => scope.stop(),
  }
}
