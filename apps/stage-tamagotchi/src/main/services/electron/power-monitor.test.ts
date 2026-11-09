import { EventEmitter } from 'node:events'

import { createContext } from '@moeru/eventa'
import { electronEvents } from '@proj-airi/electron-eventa'
import { powerMonitor } from 'electron'
import { expect, it, vi } from 'vitest'

import { createPowerMonitorService } from './powerMonitor'

vi.mock('std-env', () => ({ isLinux: false }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { powerMonitor: new EventEmitter() }
})

it('retains native Electron lock forwarding on Windows and macOS', () => {
  const context = createContext()
  const window = new EventEmitter()
  const transitions: string[] = []
  context.on(electronEvents.powerMonitor.lockScreen, () => transitions.push('locked'))
  context.on(electronEvents.powerMonitor.unlockScreen, () => transitions.push('unlocked'))
  createPowerMonitorService({ context: context as never, window: window as never })
  powerMonitor.emit('lock-screen')
  powerMonitor.emit('unlock-screen')
  window.emit('closed')
  powerMonitor.emit('lock-screen')
  expect(transitions).toEqual(['locked', 'unlocked'])
})
