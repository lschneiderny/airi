import type { ElectronMainContextExtensions, ElectronMainEmitOptions } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow, DesktopCapturerSource, IpcMainEvent, NativeImage, Session, SourcesOptions, Streams } from 'electron'

import { Buffer } from 'node:buffer'

import { createContext, defineInvoke } from '@moeru/eventa'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { screenCapture } from '..'
import { hasSelectedScreenCaptureSource, initScreenCaptureForMain, initScreenCaptureForWindow } from './index'

type DisplayHandler = NonNullable<Parameters<Session['setDisplayMediaRequestHandler']>[0]>
// An in-memory context with the types of the Electron main context, which `initScreenCaptureForWindow` takes.
type TestContext = ReturnType<typeof createContext<ElectronMainContextExtensions, ElectronMainEmitOptions>>

const boundary = vi.hoisted(() => ({
  platform: 'linux',
  handler: null as DisplayHandler | null,
  getSources: vi.fn<() => Promise<DesktopCapturerSource[]>>(),
}))

vi.mock('std-env', () => ({
  get isLinux() { return boundary.platform === 'linux' },
  get isMacOS() { return boundary.platform === 'darwin' },
}))

vi.mock('electron', () => ({
  app: { commandLine: { getSwitchValue: () => '', hasSwitch: () => false, appendSwitch: vi.fn() } },
  desktopCapturer: { getSources: boundary.getSources },
  ipcMain: {},
  session: {
    defaultSession: {
      setDisplayMediaRequestHandler: (handler: DisplayHandler | null) => { boundary.handler = handler },
    },
  },
  shell: {},
  systemPreferences: {},
}))

const sourcesOptions: SourcesOptions = { types: ['screen'] }
// The handlers read only the sender id of the IPC event.
const sender: ElectronMainEmitOptions = { raw: { ipcMainEvent: { sender: { id: 1 } } as IpcMainEvent, event: undefined } }
const mediaRequest = { frame: null, securityOrigin: 'http://localhost', videoRequested: true, audioRequested: true, userGesture: true }

function source(id: string): DesktopCapturerSource {
  // Electron supplies NativeImage; this fake implements its serialization API.
  const image: Partial<NativeImage> = { toJPEG: () => Buffer.alloc(0), isEmpty: () => true }
  return { id, name: id, display_id: '', appIcon: image as NativeImage, thumbnail: image as NativeImage }
}

let context: TestContext
let handle: string | undefined

function initWindow(loopbackWithMute = false) {
  const window = { id: 1, webContents: { id: 1 }, isDestroyed: () => false, getTitle: () => 'Capture test' } as BrowserWindow
  initScreenCaptureForWindow(window, context, { loopbackWithMute })
}

async function select(sourceId: string) {
  handle = await defineInvoke(context, screenCapture.setSource)({ sourceId, options: sourcesOptions }, sender)
  return handle
}

async function capture() {
  if (!boundary.handler)
    throw new Error('No display request handler installed')
  const callback = vi.fn((streams: Streams | null) => {
    // Electron 43 rejects an empty object by throwing in main after rejecting
    // getDisplayMedia. Only null denies without an unhandled handler rejection.
    if (streams !== null && !streams.video)
      throw new TypeError('Video was requested, but no video stream was provided')
  })
  // Awaiting also detects a rejected async Electron callback on the broken base.
  await boundary.handler(mediaRequest, callback)
  expect(callback).toHaveBeenCalledTimes(1)
  return callback.mock.calls[0][0]
}

beforeAll(() => initScreenCaptureForMain())
beforeEach(() => {
  vi.useFakeTimers()
  context = createContext()
  boundary.platform = 'linux'
  boundary.getSources.mockReset()
  handle = undefined
})
afterEach(async () => {
  if (handle)
    await defineInvoke(context, screenCapture.resetSource)(handle, sender)
  vi.useRealTimers()
})

describe('display media selection', () => {
  it.each(['win32', 'darwin'])('keeps %s source re-enumeration and loopback options', async (platform) => {
    boundary.platform = platform
    initWindow(true)
    const original = source('screen:1')
    const refreshed = { ...original, name: 'Refreshed' }
    boundary.getSources.mockResolvedValueOnce([original]).mockResolvedValueOnce([refreshed])
    await defineInvoke(context, screenCapture.getSources)(sourcesOptions, sender)
    await select(original.id)

    expect(await capture()).toEqual({ video: refreshed, audio: 'loopbackWithMute' })
    expect(boundary.getSources).toHaveBeenCalledTimes(2)
  })

  it('uses the Linux portal selection once without requesting another picker', async () => {
    initWindow()
    const chosen = source('screen:1:0:s')
    boundary.getSources.mockResolvedValueOnce([chosen]).mockResolvedValueOnce([source('screen:2:0:s')])
    await defineInvoke(context, screenCapture.getSources)(sourcesOptions, sender)
    await select(chosen.id)

    expect(await capture()).toEqual({ video: chosen, audio: 'loopback' })
    expect(boundary.getSources).toHaveBeenCalledTimes(1)
  })

  it.each(['win32', 'darwin', 'linux'])('denies a missing %s source through the callback', async (platform) => {
    boundary.platform = platform
    initWindow()
    boundary.getSources.mockResolvedValue([])
    await select('missing')

    expect(await capture()).toBeNull()
  })

  it.each(['win32', 'darwin'])('answers when %s enumeration rejects', async (platform) => {
    boundary.platform = platform
    initWindow()
    boundary.getSources.mockRejectedValue(new Error('Capture denied'))
    await select('screen:1')

    expect(await capture()).toBeNull()
  })

  it('consumes a Linux selection so a later capture cannot reuse it', async () => {
    initWindow()
    boundary.getSources.mockResolvedValue([source('screen:1:0:s')])
    await defineInvoke(context, screenCapture.getSources)(sourcesOptions, sender)
    const firstHandle = await select('screen:1:0:s')
    expect(await capture()).toHaveProperty('audio', 'loopback')
    await defineInvoke(context, screenCapture.resetSource)(firstHandle, sender)
    await select('screen:1:0:s')

    expect(await capture()).toBeNull()
  })

  it('clears a previous Linux selection when the next picker is cancelled', async () => {
    initWindow()
    boundary.getSources.mockResolvedValueOnce([source('screen:1:0:s')]).mockRejectedValueOnce(new Error('Picker cancelled'))
    await defineInvoke(context, screenCapture.getSources)(sourcesOptions, sender)
    await expect(defineInvoke(context, screenCapture.getSources)(sourcesOptions, sender)).rejects.toThrow('Picker cancelled')
    await select('screen:1:0:s')

    expect(await capture()).toBeNull()
  })

  it('starts two fresh Linux captures after resetting each selection', async () => {
    initWindow()
    for (const id of ['screen:1:0:s', 'screen:2:0:s']) {
      boundary.getSources.mockResolvedValue([source(id)])
      await defineInvoke(context, screenCapture.getSources)(sourcesOptions, sender)
      const currentHandle = await select(id)
      expect(await capture()).toHaveProperty('video.id', id)
      await defineInvoke(context, screenCapture.resetSource)(currentHandle, sender)
      expect(hasSelectedScreenCaptureSource()).toBe(false)
    }
    expect(boundary.getSources).toHaveBeenCalledTimes(2)
  })
})
