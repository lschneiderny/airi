import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { IpcRouter } from './ipc-router'

vi.mock('electron', () => ({ ipcMain: {} }))

const channel = 'eventa-message'

function setup() {
  const ipcMain = new EventEmitter()
  const router = new IpcRouter(ipcMain)
  const send = (senderId: number, payload: string) => ipcMain.emit(channel, { sender: { id: senderId } }, payload)
  return { ipcMain, router, send }
}

describe('ipcRouter', () => {
  it('keeps one ipcMain listener per channel and delivers a message to its sender window, then to the app listeners', () => {
    const { ipcMain, router, send } = setup()
    const calls: string[] = []
    router.forApp().on(channel, (_event, payload) => calls.push(`app:${payload}`))
    router.forWindow(1).on(channel, (_event, payload) => calls.push(`one:${payload}`))
    router.forWindow(1).on(channel, (_event, payload) => calls.push(`one again:${payload}`))
    router.forWindow(2).on(channel, (_event, payload) => calls.push(`two:${payload}`))
    router.forWindow(2).on('eventa-error', () => calls.push('error'))

    send(1, 'a')
    send(2, 'b')
    send(3, 'c')

    expect(ipcMain.listenerCount(channel)).toBe(1)
    expect(ipcMain.listenerCount('eventa-error')).toBe(1)
    expect(calls).toEqual(['one:a', 'one again:a', 'app:a', 'two:b', 'app:b', 'app:c'])
  })

  it('stops delivering to a removed listener and keeps the other windows', () => {
    const { ipcMain, router, send } = setup()
    const one = vi.fn()
    const two = vi.fn()
    const first = router.forWindow(1)
    first.on(channel, one)
    router.forWindow(2).on(channel, two)

    first.off(channel, one)
    send(1, 'a')
    send(2, 'b')

    expect(one).not.toHaveBeenCalled()
    expect(two).toHaveBeenCalledTimes(1)
    expect(ipcMain.listenerCount(channel)).toBe(1)
  })

  it('leaves ipcMain when the last listener of a channel goes, and returns for a later listener', () => {
    const { ipcMain, router, send } = setup()
    const window = router.forWindow(1)
    const app = router.forApp()
    const one = vi.fn()
    const all = vi.fn()
    window.on(channel, one)
    app.on(channel, all)

    window.off(channel, one)
    expect(ipcMain.listenerCount(channel)).toBe(1)
    app.off(channel, all)
    expect(ipcMain.listenerCount(channel)).toBe(0)

    const later = vi.fn()
    router.forWindow(1).on(channel, later)
    send(1, 'a')

    expect(ipcMain.listenerCount(channel)).toBe(1)
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('ignores the removal of a listener that another target added', () => {
    const { router, send } = setup()
    const one = vi.fn()
    router.forWindow(1).on(channel, one)

    router.forWindow(2).off(channel, one)
    router.forApp().off(channel, one)
    send(1, 'a')

    expect(one).toHaveBeenCalledTimes(1)
  })
})
