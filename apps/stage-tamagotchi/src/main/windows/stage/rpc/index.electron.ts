import type { BrowserWindow } from 'electron'

import type { StageCharacterPlacement, StageHostMode, StageHostState } from '../../../../shared/eventa'
import type { StageConfig } from '../config'
import type { StageScreen } from '../displays'

import { defineInvokeHandler } from '@moeru/eventa'
import { number, object, picklist, safeParse, string } from 'valibot'

import {
  electronStageCharacterPlacementChanged,
  electronStageGetCharacterPlacement,
  electronStageGetState,
  electronStageRelaunch,
  electronStageSetActiveRenderer,
  electronStageSetHome,
  electronStageSetMode,
  electronStageStateChanged,
} from '../../../../shared/eventa'
import { createWindowContext } from '../../../libs/electron/window-context'
import { buildStageHostState, withStageHome } from '../config'
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
 * Registers the stage contracts on one window: the desktop stage, or the classic main window, whose page reports the
 * active renderer too.
 *
 * Use when:
 * - A window whose renderer reads or writes the stage config has been created
 *
 * Expects:
 * - `config` was set up, and `running` is the host this launch built
 *
 * Returns:
 * - The state emitter and the placement the renderer published last
 */
export function setupStageWindowInvokes(params: {
  window: BrowserWindow
  config: StageConfigStore
  defaultConfig: StageConfig
  screen: Pick<StageScreen, 'getAllDisplays' | 'getPrimaryDisplay'>
  running: StageHostMode
  relaunch: () => void
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
    emitState()
    return getState()
  }

  defineInvokeHandler(context, electronStageGetState, () => getState())
  defineInvokeHandler(context, electronStageSetHome, payload =>
    updateConfig(withStageHome(getConfig(), readStageDisplays(params.screen), payload)))
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
  // NOTICE:
  // The relaunch does not carry an unsent chat draft over: nothing restores a collected draft in the next process.
  // Source: plan fullscreen-stage-locomotion todo 6; `windows/chat/index.ts` keeps drafts in memory only.
  // Removal condition: todo 14 adds the Relaunch control with a draft that survives the relaunch.
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

  params.window.once('closed', () => placementListeners.clear())

  return {
    emitState,
    getCharacterPlacement: () => placement,
    onCharacterPlacementChange(listener) {
      placementListeners.add(listener)
      return () => placementListeners.delete(listener)
    },
  }
}
