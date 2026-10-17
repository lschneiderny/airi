import type { BrowserWindow } from 'electron'

import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { goCancelRequest, goGetConfiguration, goOpenRequest, goReadChunk, goSetConfiguration } from '../../../../shared/eventa/opencode-go'
import { createGoNetworkService } from './index'

type Handler = (input: unknown, options: unknown) => unknown
const boundary = vi.hoisted(() => ({
  root: '',
  handlers: new Map<object, Map<unknown, Handler>>(),
  contexts: new Map<object, object>(),
  dispose: vi.fn(),
  available: vi.fn(async () => true),
  backend: vi.fn(() => 'gnome_libsecret'),
  encrypt: vi.fn(async (key: string) => Buffer.from(`encrypted:${key}`)),
  decrypt: vi.fn(async (value: Buffer) => ({ result: value.toString().slice(10), shouldReEncrypt: false })),
}))

vi.mock('electron', () => ({
  app: { getPath: () => boundary.root },
  ipcMain: {},
  safeStorage: {
    isAsyncEncryptionAvailable: boundary.available,
    getSelectedStorageBackend: boundary.backend,
    encryptStringAsync: boundary.encrypt,
    decryptStringAsync: boundary.decrypt,
  },
}))
vi.mock('node:process', async original => ({
  ...await original<typeof import('node:process')>(),
  platform: 'linux',
}))
// Capture the IPC registration boundary, retaining the production service and
// its real filesystem, validation, cancellation, and response-reader behavior.
vi.mock('@moeru/eventa', async original => ({
  ...await original<typeof import('@moeru/eventa')>(),
  defineInvokeHandler: (context: object, event: unknown, handler: Handler) => {
    boundary.handlers.get(context)!.set(event, handler)
  },
}))
vi.mock('@moeru/eventa/adapters/electron/main', () => ({
  createContext: (_ipc: unknown, window: object, options: unknown) => {
    expect(options).toEqual({ onlySameWindow: true })
    const context = {}
    boundary.contexts.set(window, context)
    boundary.handlers.set(context, new Map())
    return { context, dispose: boundary.dispose }
  },
}))

function windowFixture() {
  const contents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false })
  return Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: (): boolean => false })
}
type WindowFixture = ReturnType<typeof windowFixture>

function call(window: WindowFixture, event: unknown, input: unknown, frame = window.webContents.mainFrame): Promise<unknown> {
  const context = boundary.contexts.get(window)!
  return Promise.resolve().then(() => boundary.handlers.get(context)!.get(event)!(input, {
    raw: { ipcMainEvent: { sender: window.webContents, senderFrame: frame } },
  }))
}

describe('openCode Go main service', () => {
  let service: ReturnType<typeof createGoNetworkService>
  let window: WindowFixture
  const fetchMock = vi.fn<typeof fetch>()
  const profile = { providerId: 'opencode-go:custom' }
  const request = { ...profile, requestId: 'request-1', operation: 'models' }

  beforeEach(async () => {
    boundary.root = await mkdtemp(join(tmpdir(), 'airi-go-'))
    boundary.available.mockResolvedValue(true)
    boundary.backend.mockReturnValue('gnome_libsecret')
    boundary.encrypt.mockClear()
    boundary.decrypt.mockClear()
    boundary.contexts.clear()
    boundary.handlers.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    service = createGoNetworkService()
    window = windowFixture()
    service.bindWindow(window as BrowserWindow)
  })

  afterEach(async () => {
    await service.dispose()
    await rm(boundary.root, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function configure() {
    return call(window, goSetConfiguration, { ...profile, apiKey: '  secret-token-1234  ' })
  }

  it('acknowledges encrypted persistence and returns only masked metadata across restart', async () => {
    expect(await configure()).toEqual({ configured: true, revision: 1, keyPreview: '****1234' })
    expect(boundary.encrypt).toHaveBeenCalledWith('secret-token-1234')
    const disk = await readFile(join(boundary.root, 'opencode-go-v1.json'), 'utf8')
    expect(disk).not.toContain('secret-token')
    await service.dispose()
    service = createGoNetworkService()
    service.bindWindow(window as BrowserWindow)
    expect(await call(window, goGetConfiguration, profile)).toEqual({ configured: true, revision: 1, keyPreview: '****1234' })
    expect(boundary.decrypt).not.toHaveBeenCalled()
    expect(await call(window, goSetConfiguration, { ...profile, apiKey: '  ' })).toEqual({ configured: false, revision: 2, keyPreview: '' })
  })

  it('refuses insecure storage without changing the stored configuration', async () => {
    boundary.available.mockResolvedValue(false)
    await expect(configure()).rejects.toThrow('secure operating system')
    expect(await call(window, goGetConfiguration, profile)).toEqual({ configured: false, revision: 0, keyPreview: '' })
    expect(boundary.encrypt).not.toHaveBeenCalled()
    boundary.available.mockResolvedValue(true)
    boundary.backend.mockReturnValue('basic_text')
    await expect(configure()).rejects.toThrow('secure operating system')
  })

  it('uses fixed routes and headers, exposes safe metadata, and pulls one chunk per call', async () => {
    await configure()
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3]))
      },
      cancel,
    })
    fetchMock.mockResolvedValue(new Response(stream, { status: 429, headers: {
      'content-type': 'text/event-stream',
      'retry-after': '5',
      'set-cookie': 'sensitive',
    } }))
    expect(await call(window, goOpenRequest, {
      ...request,
      operation: 'chat',
      sessionId: 'conversation-42',
      body: '{"messages":[]}',
    })).toEqual({ status: 429, statusText: '', headers: [['content-type', 'text/event-stream'], ['retry-after', '5']] })
    expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/inference/go/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: {
        'Authorization': 'Bearer secret-token-1234',
        'User-Agent': 'Project-AIRI',
        'x-opencode-session': 'conversation-42',
        'Content-Type': 'application/json',
      },
    }))
    expect(await call(window, goReadChunk, { requestId: request.requestId })).toEqual({ done: false, data: new Uint8Array([1, 2]) })
    expect(await call(window, goReadChunk, { requestId: request.requestId })).toEqual({ done: false, data: new Uint8Array([3]) })
    await call(window, goCancelRequest, { requestId: request.requestId })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('handles completion and sanitizes network failures', async () => {
    await configure()
    fetchMock.mockResolvedValueOnce(new Response(null))
    await call(window, goOpenRequest, request)
    expect(await call(window, goReadChunk, { requestId: request.requestId })).toEqual({ done: true })
    fetchMock.mockRejectedValueOnce(new Error('secret-token upstream diagnostic'))
    await expect(call(window, goOpenRequest, request)).rejects.toThrow('OpenCode Go request failed or was cancelled')
  })

  it('uses a stable validation session separate from explicit conversation sessions', async () => {
    await configure()
    fetchMock.mockImplementation(async () => new Response(null))
    await call(window, goOpenRequest, request)
    await call(window, goReadChunk, { requestId: request.requestId })
    await call(window, goOpenRequest, request)
    const first = fetchMock.mock.calls[0][1]!.headers
    const second = fetchMock.mock.calls[1][1]!.headers
    expect(first).toEqual(second)
    expect(first).toMatchObject({ 'x-opencode-session': expect.stringMatching(/^airi-validation-/) })
  })

  it('rejects concurrent pulls and releases a pending reader on cancellation', async () => {
    await configure()
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>()))
    await call(window, goOpenRequest, request)
    const firstRead = call(window, goReadChunk, { requestId: request.requestId })
    const firstRejected = expect(firstRead).rejects.toThrow('cancelled')
    await expect(call(window, goReadChunk, { requestId: request.requestId })).rejects.toThrow('pending read')
    await call(window, goCancelRequest, { requestId: request.requestId })
    await firstRejected
  })

  it('rejects subframes, arbitrary URL fields, invalid bodies, and cross-window reads', async () => {
    await expect(call(window, goGetConfiguration, profile, {})).rejects.toThrow('not authorized')
    await expect(call(window, goOpenRequest, { ...request, url: 'https://evil.test' })).rejects.toThrow()
    await expect(call(window, goOpenRequest, { ...request, operation: 'chat', body: '[]' })).rejects.toThrow('JSON object')
    await configure()
    fetchMock.mockResolvedValue(new Response('hello'))
    await call(window, goOpenRequest, request)
    const other = windowFixture()
    service.bindWindow(other as BrowserWindow)
    await expect(call(other, goReadChunk, { requestId: request.requestId })).rejects.toThrow('not active')
    await call(other, goCancelRequest, { requestId: request.requestId })
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false)
  })

  it.each(['cancel', 'navigation', 'gone', 'close', 'replace', 'dispose', 'timeout'])('aborts requests on %s', async (reason) => {
    await configure()
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(new Response('hello'))
    await call(window, goOpenRequest, request)
    const signal = fetchMock.mock.calls[0][1]!.signal!
    if (reason === 'cancel')
      await call(window, goCancelRequest, { requestId: request.requestId })
    if (reason === 'navigation')
      window.webContents.emit('did-start-navigation', {}, 'file:///app', false, true)
    if (reason === 'gone')
      window.webContents.emit('render-process-gone')
    if (reason === 'close') {
      // Electron destroys the native window before it emits `closed`.
      vi.spyOn(window, 'isDestroyed').mockReturnValue(true)
      Object.defineProperty(window, 'webContents', {
        get() { throw new TypeError('Object has been destroyed') },
      })
      window.emit('closed')
    }
    if (reason === 'replace')
      await configure()
    if (reason === 'dispose')
      await service.dispose()
    if (reason === 'timeout')
      vi.advanceTimersByTime(120_000)
    expect(signal.aborted).toBe(true)
  })
})
