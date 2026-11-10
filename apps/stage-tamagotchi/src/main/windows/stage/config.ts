import type { InferOutput } from 'valibot'

import type { StageDisplayInfo, StageHostMode, StageHostState } from '../../../shared/eventa'

import { boolean, nullable, number, object, optional, picklist, record, string } from 'valibot'

import { createConfig } from '../../libs/electron/persistence'

const displayFingerprintSchema = object({
  width: number(),
  height: number(),
  scaleFactor: number(),
})

export const stageConfigSchema = object({
  /** The Experimental 3D stage setting. While it is off, every launch builds the classic window. */
  experimental: optional(boolean(), false),
  mode: optional(picklist(['window', 'desktop']), 'window'),
  activeRenderer: optional(nullable(picklist(['mmd', 'other'])), null),
  homeDisplayId: optional(nullable(string()), null),
  homes: optional(record(string(), object({
    xDip: number(),
    fingerprint: displayFingerprintSchema,
  })), {}),
})

export type StageConfig = InferOutput<typeof stageConfigSchema>
export type StageDisplayFingerprint = InferOutput<typeof displayFingerprintSchema>

export const defaultStageConfig: StageConfig = {
  experimental: false,
  mode: 'window',
  activeRenderer: null,
  homeDisplayId: null,
  homes: {},
}

/** The persisted `stage-config.json` under the user data directory. It never touches `app-config.json`. */
export function createStageConfig() {
  return createConfig('stage', 'config.json', stageConfigSchema, {
    default: defaultStageConfig,
    autoHeal: true,
  })
}

/** The size and scale that identify a display when its id changes, for example after a reconnect. */
export function displayFingerprint(display: Pick<StageDisplayInfo, 'workArea' | 'scaleFactor'>): StageDisplayFingerprint {
  return { width: display.workArea.width, height: display.workArea.height, scaleFactor: display.scaleFactor }
}

function sameFingerprint(a: StageDisplayFingerprint, b: StageDisplayFingerprint): boolean {
  return a.width === b.width && a.height === b.height && a.scaleFactor === b.scaleFactor
}

/**
 * Picks the display the stage window covers.
 *
 * Use when:
 * - Creating the stage window, and again on every display change
 *
 * Expects:
 * - `displays` is not empty and has exactly one `primary` display, as Electron's `screen` reports
 *
 * Returns:
 * - The saved home display when it is connected; else a connected display with the fingerprint saved for it; else the
 *   primary display
 */
export function resolveHomeDisplay(displays: readonly StageDisplayInfo[], config: StageConfig): StageDisplayInfo {
  const primary = displays.find(display => display.primary) ?? displays[0]!
  if (config.homeDisplayId === null)
    return primary

  const byId = displays.find(display => display.id === config.homeDisplayId)
  if (byId)
    return byId

  const saved = config.homes[config.homeDisplayId]
  const byFingerprint = saved && displays.find(display => sameFingerprint(displayFingerprint(display), saved.fingerprint))
  return byFingerprint || primary
}

/**
 * The saved home of `display`, or `null` when the renderer must compute the default home.
 *
 * A home saved on a display whose work-area size or scale has changed is `null` too: the floor row and the chat side
 * moved, so the old x no longer means the same spot.
 */
export function resolveHome(display: StageDisplayInfo, config: StageConfig): { xDip: number } | null {
  const saved = config.homes[display.id]
  if (!saved || !sameFingerprint(saved.fingerprint, displayFingerprint(display)))
    return null

  return { xDip: saved.xDip }
}

/**
 * Builds the state `electronStageGetState` returns, with a `homes` entry for every connected display.
 *
 * `stageDisplayId` is the display the desktop stage window covers. Without one, or when it names a display that is not
 * connected, the state reports the home display.
 */
export function buildStageHostState(params: {
  config: StageConfig
  displays: readonly StageDisplayInfo[]
  running: StageHostMode
  next: StageHostMode
  stageDisplayId?: string
}): StageHostState {
  const homeDisplayId = resolveHomeDisplay(params.displays, params.config).id
  return {
    experimental: params.config.experimental,
    mode: params.config.mode,
    activeRenderer: params.config.activeRenderer,
    displays: [...params.displays],
    homeDisplayId,
    stageDisplayId: params.displays.some(display => display.id === params.stageDisplayId) ? params.stageDisplayId! : homeDisplayId,
    homes: Object.fromEntries(params.displays.map(display => [display.id, resolveHome(display, params.config)])),
    running: params.running,
    next: params.next,
  }
}

/**
 * Returns the config with `displayId` as the home display. The saved homes are kept, so a home saved earlier on that
 * display is used again.
 *
 * Throws (so the invoke rejects and the config stays unchanged) when the display is not connected.
 */
export function withStageHomeDisplay(
  config: StageConfig,
  displays: readonly StageDisplayInfo[],
  displayId: unknown,
): StageConfig {
  const display = typeof displayId === 'string' && displays.find(candidate => candidate.id === displayId)
  if (!display)
    throw new Error(`The home display ${JSON.stringify(displayId)} is not connected`)

  return { ...config, homeDisplayId: display.id }
}

/**
 * Returns the config with the home of `payload.displayId` saved, with that display's fingerprint.
 *
 * Throws (so the invoke rejects and the config stays unchanged) when the display is not connected or `xDip` is not a
 * finite number.
 */
export function withStageHome(
  config: StageConfig,
  displays: readonly StageDisplayInfo[],
  payload: { displayId: string, xDip: number } | undefined,
): StageConfig {
  const display = payload && displays.find(candidate => candidate.id === payload.displayId)
  if (!payload || !display)
    throw new Error(`electronStageSetHome: display ${JSON.stringify(payload?.displayId)} is not connected`)
  if (typeof payload.xDip !== 'number' || !Number.isFinite(payload.xDip))
    throw new TypeError(`electronStageSetHome: xDip must be a finite number, got ${JSON.stringify(payload.xDip)}`)

  return {
    ...config,
    homes: {
      ...config.homes,
      [display.id]: { xDip: payload.xDip, fingerprint: displayFingerprint(display) },
    },
  }
}
