import type { BrowserWindow } from 'electron'

import type { StageCharacterPlacement, StageHostMode, StageHostState } from '../../../../shared/eventa'
import type { StageConfig } from '../config'
import type { StageScreen } from '../displays'
import type { StageStateBroadcast } from '../state-broadcast'

import { defineInvokeHandler } from '@moeru/eventa'
import { number, object, picklist, safeParse, string } from 'valibot'

import {
  electronStageCharacterPlacementChanged,
  electronStageGetCharacterPlacement,
  electronStageGetState,
  electronStageRelaunch,
  electronStageSetActiveRenderer,
  electronStageSetHome,
  electronStageSetHomeDisplay,
  electronStageSetMode,
  electronStageStateChanged,
} from '../../../../shared/eventa'
import { createWindowContext } from '../../../libs/electron/window-context'
import { buildStageHostState, withStageHome, withStageHomeDisplay } from '../config'
import { readStageDisplays } from '../displays'

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
}): StageWindowInvokes {
  const { context } = createWindowContext(params.window)
  const getConfig = () => params.config.get() ?? params.defaultConfig

  let placement: StageCharacterPlacement | null = null
  const placementListeners = new Set<(placement: StageCharacterPlacement) => void>()

  function getState(): StageHostState {
    return buildStageHostState({ config: getConfig(), displays: readStageDisplays(params.screen), running: params.running })
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
    return updateConfig({ ...getConfig(), activeRenderer: parsed.output })
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

  params.window.once('closed', () => {
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
