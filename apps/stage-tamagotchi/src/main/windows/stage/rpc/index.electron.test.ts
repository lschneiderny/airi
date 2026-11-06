import type { Display } from 'electron'

import type { StageHostState } from '../../../../shared/eventa'
import type { createWindowContext } from '../../../libs/electron/window-context'
import type { StageConfig } from '../config'

import { EventEmitter } from 'node:events'

import { createContext, defineInvoke, defineInvokeEventa } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import { electronStageSetActiveRenderer, electronStageSetExperimental, electronStageSetMode, electronStageStateChanged } from '../../../../shared/eventa'
import { defaultStageConfig } from '../config'
import { createStageStateBroadcast } from '../state-broadcast'
import { setupStageWindowInvokes } from './index.electron'

const createMemoryContext = () => createContext()
const contexts = new Map<object, ReturnType<typeof createMemoryContext>>()

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/airi-test' }, ipcMain: {} }))
// Each window gets its own in-memory eventa context, as the Electron adapter gives each window its own IPC context.
vi.mock('../../../libs/electron/window-context', () => ({
  createWindowContext: (window: object) => {
    const context = createMemoryContext()
    contexts.set(window, context)
    return { context: context as unknown as ReturnType<typeof createWindowContext>['context'] }
  },
}))

class FakeWindow extends EventEmitter {
  isDestroyed = () => false
}

const builtIn = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 801 }, scaleFactor: 2 } as Display
const screen = { getAllDisplays: () => [builtIn], getPrimaryDisplay: () => builtIn }

function setup(options: { running?: 'window' | 'desktop', onLeaveMmd?: () => void } = {}) {
  let config: StageConfig = { ...defaultStageConfig, mode: 'desktop', activeRenderer: 'mmd' }
  const store = {
    get: () => config,
    update: (next: StageConfig) => {
      config = next
    },
  }
  const broadcast = createStageStateBroadcast()
  const stageWindow = new FakeWindow()
  const settingsWindow = new FakeWindow()
  const shared = { config: store, defaultConfig: defaultStageConfig, screen, running: options.running ?? 'desktop', relaunch: () => {}, broadcast }
  setupStageWindowInvokes({ ...shared, window: stageWindow as never, onLeaveMmd: options.onLeaveMmd })
  setupStageWindowInvokes({ ...shared, window: settingsWindow as never })
  const settingsContext = contexts.get(settingsWindow)!
  const received: StageHostState[] = []
  settingsContext.on(electronStageStateChanged, (event: { body?: StageHostState }) => {
    if (event.body)
      received.push(event.body)
  })
  return { stageContext: contexts.get(stageWindow)!, settingsContext, settingsWindow, received, getConfig: () => config }
}

describe('setupStageWindowInvokes state fan-out', () => {
  it('emits the state on the settings window when the stage window reports a renderer change', async () => {
    const { stageContext, received } = setup()

    const state = await defineInvoke(stageContext, electronStageSetActiveRenderer)('other')

    expect(state.activeRenderer).toBe('other')
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ activeRenderer: 'other', mode: 'desktop', running: 'desktop' })
  })

  it('emits the state on the stage window when the settings window saves the mode, and stops after the settings window closes', async () => {
    const { stageContext, settingsContext, settingsWindow, received } = setup()
    const stageReceived: StageHostState[] = []
    stageContext.on(electronStageStateChanged, (event: { body?: StageHostState }) => {
      if (event.body)
        stageReceived.push(event.body)
    })

    await defineInvoke(settingsContext, electronStageSetMode)('window')
    expect(stageReceived.map(state => state.mode)).toEqual(['window'])
    expect(received.map(state => state.mode)).toEqual(['window'])

    settingsWindow.emit('closed')
    await defineInvoke(stageContext, electronStageSetMode)('desktop')
    expect(stageReceived.map(state => state.mode)).toEqual(['window', 'desktop'])
    expect(received.map(state => state.mode)).toEqual(['window'])
  })
})

describe('electronStageSetExperimental', () => {
  it('persists the Experimental 3D stage setting and sends the new state to every window', async () => {
    const { settingsContext, received, getConfig } = setup()

    const state = await defineInvoke(settingsContext, electronStageSetExperimental)(true)

    expect(state.experimental).toBe(true)
    expect(getConfig().experimental).toBe(true)
    expect(received.map(next => next.experimental)).toEqual([true])
  })

  it('rejects a payload that is not a boolean and leaves the config unchanged', async () => {
    const { settingsContext, getConfig } = setup()

    // The same contract id with an untyped payload, as a misbehaving renderer could send it.
    const looseSetExperimental = defineInvokeEventa<StageHostState, unknown>('eventa:invoke:electron:windows:stage:set-experimental')
    await expect(defineInvoke(settingsContext, looseSetExperimental)('yes')).rejects.toThrow()
    expect(getConfig().experimental).toBe(false)
  })
})

describe('leaving MMD while the desktop stage runs', () => {
  it('asks once to relaunch when the stage page reports a renderer that is not MMD, and keeps the host', async () => {
    const onLeaveMmd = vi.fn()
    const { stageContext, getConfig } = setup({ onLeaveMmd })
    const setActiveRenderer = defineInvoke(stageContext, electronStageSetActiveRenderer)

    await setActiveRenderer('other')
    await setActiveRenderer('other')

    expect(onLeaveMmd).toHaveBeenCalledOnce()
    // The saved mode is untouched: the next launch picks the classic window because the renderer is not MMD.
    expect(getConfig()).toMatchObject({ mode: 'desktop', activeRenderer: 'other' })
  })

  it('does not ask while the classic window runs, or when the renderer goes back to MMD', async () => {
    const classicLeave = vi.fn()
    const classic = setup({ running: 'window', onLeaveMmd: classicLeave })
    await defineInvoke(classic.stageContext, electronStageSetActiveRenderer)('other')
    expect(classicLeave).not.toHaveBeenCalled()

    const desktopLeave = vi.fn()
    const desktop = setup({ onLeaveMmd: desktopLeave })
    await defineInvoke(desktop.stageContext, electronStageSetActiveRenderer)('mmd')
    expect(desktopLeave).not.toHaveBeenCalled()
  })
})
