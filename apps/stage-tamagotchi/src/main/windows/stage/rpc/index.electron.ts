import type { BrowserWindow } from 'electron'

import type { StageCharacterPlacement, StageHostMode, StageHostState } from '../../../../shared/eventa'
import type { StageConfig } from '../config'
import type { StageScreen } from '../displays'
import type { StageStateBroadcast } from '../state-broadcast'

import { env, platform, versions } from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'
import { boolean, number, object, picklist, safeParse, string } from 'valibot'

import {
  electronStageCharacterPlacementChanged,
  electronStageGetCharacterPlacement,
  electronStageGetState,
  electronStageMoveToDisplay,
  electronStageRehome,
  electronStageRelaunch,
  electronStageSetActiveRenderer,
  electronStageSetExperimental,
  electronStageSetHome,
  electronStageSetHomeDisplay,
  electronStageSetMode,
  electronStageStateChanged,
} from '../../../../shared/eventa'
import { onWindowClosed } from '../../../libs/electron/on-window-closed'
import { createWindowContext } from '../../../libs/electron/window-context'
import { buildStageHostState, withStageHome, withStageHomeDisplay } from '../config'
import { readStageDisplays } from '../displays'
import { isLinuxStageEligible, selectHostMode } from '../mode'

const rectSchema = object({ x: number(), y: number(), width: number(), height: number() })
const placementSchema = object({ displayId: string(), bounds: rectSchema, homeBounds: rectSchema })
const modeSchema = picklist(['window', 'desktop'])
const rendererSchema = picklist(['mmd', 'other'])

export interface StageConfigStore {
  get: () => StageConfig | undefined
  update: (config: StageConfig) => void
}

export interface StageWindowInvokes {
  /** Sends the current state to the window, for example after a display change. */
  emitState: () => void
  getCharacterPlacement: () => StageCharacterPlacement | null
  /** Calls `listener` with each placement the renderer publishes. Returns the function that stops it. */
  onCharacterPlacementChange: (listener: (placement: StageCharacterPlacement) => void) => () => void
}

/**
 * Registers the stage contracts on one window: the desktop stage, the classic main window, whose page reports the
 * active renderer too, or the settings window, whose page edits the mode and the home display.
 *
 * Use when:
 * - A window whose renderer reads or writes the stage config has been created
 *
 * Expects:
 * - `config` was set up, and `running` is the host this launch built
 * - `broadcast` is shared by every window of this launch, so a config change made here reaches the other windows
 * - `applyHomeDisplay` re-bounds the desktop stage window when one exists; it runs after the home display changed
 * - `stageDisplayId` reads the display the desktop stage window covers; every window of a desktop stage launch gets it,
 *   so they all report the same state
 * - `moveToDisplay` moves the desktop stage window to another display; only the desktop stage window gets it
 * - `onLeaveMmd` runs when this window reports that the stage model left MMD while the desktop stage runs; the host stays
 *   until the next launch
 *
 * Returns:
 * - The state emitter for this window and the placement the renderer published last
 */
export function setupStageWindowInvokes(params: {
  window: BrowserWindow
  config: StageConfigStore
  defaultConfig: StageConfig
  screen: Pick<StageScreen, 'getAllDisplays' | 'getPrimaryDisplay'>
  running: StageHostMode
  relaunch: () => void
  broadcast: StageStateBroadcast
  applyHomeDisplay?: () => void
  stageDisplayId?: () => string | undefined
  moveToDisplay?: (displayId: string) => Promise<boolean>
  onLeaveMmd?: () => void
}): StageWindowInvokes {
  const { context } = createWindowContext(params.window)
  const getConfig = () => params.config.get() ?? params.defaultConfig

  let placement: StageCharacterPlacement | null = null
  const placementListeners = new Set<(placement: StageCharacterPlacement) => void>()

  function getState(): StageHostState {
    const config = getConfig()
    return buildStageHostState({
      config,
      displays: readStageDisplays(params.screen),
      stageDisplayId: params.stageDisplayId?.(),
      running: params.running,
      // The same inputs as the launch in `main/index.ts`, so `next` predicts what a relaunch builds.
      next: selectHostMode(config, platform, env, { development: import.meta.env.DEV }, isLinuxStageEligible(env, versions.electron)),
    })
  }

  function emitState() {
    if (!params.window.isDestroyed())
      context.emit(electronStageStateChanged, getState())
  }

  function updateConfig(next: StageConfig): StageHostState {
    params.config.update(next)
    params.broadcast.emitAll()
    return getState()
  }

  const stopBroadcast = params.broadcast.add(emitState)

  defineInvokeHandler(context, electronStageGetState, () => getState())
  defineInvokeHandler(context, electronStageSetHome, payload =>
    updateConfig(withStageHome(getConfig(), readStageDisplays(params.screen), payload)))
  defineInvokeHandler(context, electronStageSetHomeDisplay, (payload) => {
    const state = updateConfig(withStageHomeDisplay(getConfig(), readStageDisplays(params.screen), payload))
    params.applyHomeDisplay?.()
    return state
  })
  // The window stays: she walks to the new home display, and the stage page moves the window after her.
  defineInvokeHandler(context, electronStageRehome, payload =>
    updateConfig(withStageHomeDisplay(getConfig(), readStageDisplays(params.screen), payload)))
  defineInvokeHandler(context, electronStageMoveToDisplay, async (payload) => {
    if (!params.moveToDisplay)
      throw new Error('electronStageMoveToDisplay: this window is not the desktop stage')
    if (typeof payload !== 'string')
      throw new TypeError(`electronStageMoveToDisplay: expected a display id, got ${JSON.stringify(payload)}`)
    // Confirmed or not, every window hears where the stage window is now.
    await params.moveToDisplay(payload)
    params.broadcast.emitAll()
    return getState()
  })
  defineInvokeHandler(context, electronStageSetExperimental, (payload) => {
    const parsed = safeParse(boolean(), payload)
    if (!parsed.success)
      throw new TypeError(`electronStageSetExperimental: expected a boolean, got ${JSON.stringify(payload)}`)
    return updateConfig({ ...getConfig(), experimental: parsed.output })
  })
  defineInvokeHandler(context, electronStageSetMode, (payload) => {
    const parsed = safeParse(modeSchema, payload)
    if (!parsed.success)
      throw new TypeError(`electronStageSetMode: expected 'window' or 'desktop', got ${JSON.stringify(payload)}`)
    return updateConfig({ ...getConfig(), mode: parsed.output })
  })
  defineInvokeHandler(context, electronStageSetActiveRenderer, (payload) => {
    const parsed = safeParse(rendererSchema, payload)
    if (!parsed.success)
      throw new TypeError(`electronStageSetActiveRenderer: expected 'mmd' or 'other', got ${JSON.stringify(payload)}`)
    if (getConfig().activeRenderer === parsed.output)
      return getState()
    const state = updateConfig({ ...getConfig(), activeRenderer: parsed.output })
    if (parsed.output === 'other' && params.running === 'desktop')
      params.onLeaveMmd?.()
    return state
  })
  // Policy: the relaunch does not carry an unsent chat draft over. Drafts live in memory (`windows/chat/index.ts`), and
  // the settings page says so next to its Relaunch button (`settings.mmd.stage.relaunch.description`).
  defineInvokeHandler(context, electronStageRelaunch, () => params.relaunch())
  defineInvokeHandler(context, electronStageGetCharacterPlacement, () => placement)

  context.on(electronStageCharacterPlacementChanged, (event) => {
    const parsed = safeParse(placementSchema, event.body)
    if (!parsed.success) {
      console.warn('[stage] Dropped a malformed character placement:', parsed.issues.map(issue => issue.message).join('; '))
      return
    }
    placement = parsed.output
    for (const listener of placementListeners)
      listener(parsed.output)
  })

  onWindowClosed(params.window, () => {
    stopBroadcast()
    placementListeners.clear()
  })

  return {
    emitState,
    getCharacterPlacement: () => placement,
    onCharacterPlacementChange(listener) {
      placementListeners.add(listener)
      return () => placementListeners.delete(listener)
    },
  }
}
