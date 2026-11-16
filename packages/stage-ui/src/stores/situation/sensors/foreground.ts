import type { AppCategory, BusyState, Observation } from '@proj-airi/stage-shared/situation'
import type { ForegroundWindowSample } from '@proj-airi/stage-shared/stores/foreground-window'

import { isElectronWindow } from '@proj-airi/stage-shared'
import {
  appIdFromExe,
  categorizeApp,
  labelFromExe,
  normalizeWindowTitle,
} from '@proj-airi/stage-shared/situation'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { effectScope, watch } from 'vue'

import { foregroundReadPolicy, useSituationSettings } from '../../../features/situation/settings'

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
  const state = sample.busy
  return state === 'accepts' || state === 'busy' || state === 'fullscreen' || state === 'presentation' || state === 'quiet' ? state : 'unknown'
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
 * app id or the normalized title changes. An app on the `blockedApps` setting, and a private browser window, never
 * arrive here: the host drops their readings before it writes a sample.
 *
 * Busy comes from the host's reading of whether a remark fits now, so own samples count for it too.
 * It is reported only when it changes. A sample older than
 * {@link FOREGROUND_SAMPLE_STALE_VISIBLE_MS} while the stage is visible, or {@link FOREGROUND_SAMPLE_STALE_HIDDEN_MS}
 * while it is hidden, reads as busy `unknown` and reports no activity. The caller owns the clock through
 * {@link ForegroundSensor.check}. Hosts without a producer keep a `null` sample and send nothing.
 *
 * While the `shareForegroundWindow` setting is false, the sensor treats every sample as missing: it reports no busy
 * state, activity, or category, and clears a reported category. It forgets what it reported, so turning the setting
 * back on reports the current sample again, even for the same app.
 *
 * When the read policy changes (the `blockedApps` or the `shareWindowTitles` setting), the sensor forgets what it
 * reported and reports no activity from the sample it holds, because the host read that sample under the previous
 * policy. The next sample is reported again. The host leaves the title empty while `shareWindowTitles` is false.
 */
export function startForegroundSensor(ingest: (observation: Observation) => void, options: ForegroundSensorOptions): ForegroundSensor {
  const foreground = useForegroundWindowStore()
  const settings = useSituationSettings()
  const platform = typeof window !== 'undefined' && isElectronWindow(window) ? window.platform : undefined
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
    const appId = appIdFromExe(exe, platform)
    if (!appId)
      return
    if (sample.ownProcess === true) {
      if (selfAppIds.length === 0)
        selfAppIds = [appId]
      return
    }

    const exeName = nonEmptyString(sample.exeName) ?? exe
    const label = labelFromExe(exeName, platform)
    const title = normalizeWindowTitle(sample.title, label)
    if (appId === lastAppId && title === lastTitle)
      return
    lastAppId = appId
    lastTitle = title
    const category = categorizeApp(nonEmptyString(sample.exePath) ?? '', exeName, platform)
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
    // The policy is compared by content: every settings update replaces the document, also when another field changed.
    watch([() => foreground.sample, () => settings.document.shareForegroundWindow, () => JSON.stringify(foregroundReadPolicy(settings.document))], ([, sharing, policy], previous) => {
      // The immediate first run has no previous values.
      const policyChanged = previous[2] !== undefined && previous[2] !== policy
      if (!sharing || policyChanged)
        forgetReported()
      const nowMs = Date.now()
      reportBusy(nowMs)
      const sample = sharedSample()
      if (!policyChanged && sample && isFresh(sample, nowMs, options.stageVisible()))
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
