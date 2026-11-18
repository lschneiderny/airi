import { join, resolve } from 'node:path'

import { BrowserWindow } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { baseUrl, getPreloadPath, getRendererRoot, load, setElectronMainDirname, withHashRoute } from './location'
import { ignoreWindowClosedDuringCreation, WindowClosedDuringCreationError } from './window-closed'

vi.mock('electron', async () => ({
  BrowserWindow: class extends (await import('node:events')).EventEmitter {
    readonly isDestroyed = vi.fn(() => false)
    readonly loadURL = vi.fn(async () => {})
    readonly loadFile = vi.fn(async () => {})
    readonly webContents = { removeAllListeners: vi.fn() }
  },
}))

const electronToolkit = vi.hoisted(() => ({ is: { dev: true } }))

vi.mock(import('@electron-toolkit/utils'), () => electronToolkit)

afterEach(() => {
  electronToolkit.is.dev = true
  vi.unstubAllEnvs()
})

describe('load', () => {
  it.each([
    { url: 'http://localhost:5173/#/settings', code: 'ERR_FAILED', errno: -2 },
    { url: { file: '/app/index.html' }, code: 'ERR_ABORTED', errno: -3 },
  ])('treats $code after the window closes as creation cancellation', async ({ url, code, errno }) => {
    const window = new BrowserWindow()
    const failure = Object.assign(new Error('navigation interrupted'), { code, errno })
    let interrupt: (error: Error) => void = () => {}
    const navigation = new Promise<void>((_resolve, reject) => {
      interrupt = reject
    })
    vi.mocked(window.loadURL).mockReturnValue(navigation)
    vi.mocked(window.loadFile).mockReturnValue(navigation)
    const loading = load(window, url)

    vi.mocked(window.isDestroyed).mockReturnValue(true)
    interrupt(failure)

    await expect(loading).rejects.toBeInstanceOf(WindowClosedDuringCreationError)
    expect(window.webContents.removeAllListeners).not.toHaveBeenCalled()
  })

  it('treats a load interrupted by a close that is still in progress as creation cancellation', async () => {
    const window = new BrowserWindow()
    const failure = Object.assign(new Error('navigation interrupted'), { code: 'ERR_FAILED', errno: -2 })
    let interrupt: (error: Error) => void = () => {}
    vi.mocked(window.loadURL).mockReturnValue(new Promise<void>((_resolve, reject) => {
      interrupt = reject
    }))
    const loading = load(window, 'http://localhost:5173/#/settings')

    window.emit('close', { defaultPrevented: false })
    interrupt(failure)

    await expect(loading).rejects.toBeInstanceOf(WindowClosedDuringCreationError)
  })

  it('preserves load failures after a prevented close, such as hide-on-close', async () => {
    const window = new BrowserWindow()
    const failure = Object.assign(new Error('load failed'), { code: 'ERR_FAILED', errno: -2 })
    let interrupt: (error: Error) => void = () => {}
    vi.mocked(window.loadURL).mockReturnValue(new Promise<void>((_resolve, reject) => {
      interrupt = reject
    }))
    const loading = load(window, 'http://localhost:5173/#/settings')

    window.emit('close', { defaultPrevented: true })
    interrupt(failure)

    await expect(loading).rejects.toBe(failure)
    expect(window.listenerCount('close')).toBe(0)
  })

  it('preserves genuine load failures while the window is alive', async () => {
    const window = new BrowserWindow()
    const failure = Object.assign(new Error('load failed'), { code: 'ERR_FAILED', errno: -2 })
    vi.mocked(window.loadURL).mockRejectedValue(failure)

    await expect(load(window, 'http://localhost:5173/#/settings')).rejects.toBe(failure)
    expect(window.webContents.removeAllListeners).toHaveBeenCalledWith('did-start-navigation')
  })

  it('preserves unrelated failures even when the window is destroyed', async () => {
    const window = new BrowserWindow()
    const failure = new TypeError('invalid navigation')
    vi.mocked(window.loadURL).mockRejectedValue(failure)
    vi.mocked(window.isDestroyed).mockReturnValue(true)

    await expect(load(window, 'http://localhost:5173/#/settings')).rejects.toBe(failure)
  })

  it('lets open commands quietly finish only for creation cancellation', async () => {
    await expect(Promise.reject(new WindowClosedDuringCreationError()).catch(ignoreWindowClosedDuringCreation)).resolves.toBeUndefined()
    const failure = new Error('real failure')
    await expect(Promise.reject(failure).catch(ignoreWindowClosedDuringCreation)).rejects.toBe(failure)
  })
})

describe('withHashRoute', () => {
  it('should use string url construct URL with hash route correctly', () => {
    const result = withHashRoute('http://localhost:5173', '/test/inner-test')
    expect(result).toEqual({ url: 'http://localhost:5173/#/test/inner-test' })
  })

  it('should use object url construct URL with hash route correctly', () => {
    const result = withHashRoute({ url: 'http://localhost:5173' }, '/test/inner-test')
    expect(result).toEqual({ url: 'http://localhost:5173/#/test/inner-test' })
  })

  it('should use file url construct URL with hash route correctly', () => {
    const result = withHashRoute({ url: 'file:////home/workspace/project/index.html' }, '/test/inner-test')
    expect(result).toEqual({ url: `file:////home/workspace/project/index.html#/test/inner-test` })
  })

  it('adds query options before the hash route for development URLs', () => {
    expect(withHashRoute({ url: 'http://localhost:5173' }, '/about', {
      query: { 'synced-leader': 'false' },
    })).toEqual({
      url: 'http://localhost:5173/?synced-leader=false#/about',
    })
  })

  it('passes query options to Electron for packaged renderer URLs', () => {
    expect(withHashRoute({ file: '/opt/airi/renderer/index.html' }, '/settings', {
      query: { 'synced-leader': 'false' },
    })).toEqual({
      file: '/opt/airi/renderer/index.html',
      options: {
        hash: '/settings',
        query: { 'synced-leader': 'false' },
      },
    })
  })
})

describe('getRendererRoot', () => {
  const mainDirname = resolve('/opt/airi/out/main')

  it('resolves the packaged renderer directory next to the main bundle', () => {
    setElectronMainDirname(mainDirname)

    expect(getRendererRoot()).toBe(resolve('/opt/airi/out/renderer'))
  })

  it('loads the packaged index.html from the renderer root', () => {
    electronToolkit.is.dev = false
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    setElectronMainDirname(mainDirname)

    expect(baseUrl(getRendererRoot())).toEqual({ file: join(resolve('/opt/airi/out/renderer'), 'index.html') })
    expect(baseUrl(getRendererRoot(), 'beat-sync.html')).toEqual({ file: join(resolve('/opt/airi/out/renderer'), 'beat-sync.html') })
  })

  it('uses the development server URL instead of the renderer root in development', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/')
    setElectronMainDirname(mainDirname)

    expect(baseUrl(getRendererRoot())).toEqual({ url: 'http://localhost:5173/' })
    expect(baseUrl(getRendererRoot(), 'beat-sync.html')).toEqual({ url: 'http://localhost:5173/beat-sync.html' })
  })
})

describe('getPreloadPath', () => {
  it('resolves the default preload entry next to the main bundle', () => {
    setElectronMainDirname(resolve('/opt/airi/out/main'))

    expect(getPreloadPath()).toBe(join(resolve('/opt/airi/out/preload'), 'index.mjs'))
  })

  it('resolves a named preload entry next to the main bundle', () => {
    setElectronMainDirname(resolve('/opt/airi/out/main'))

    expect(getPreloadPath('beat-sync.mjs')).toBe(join(resolve('/opt/airi/out/preload'), 'beat-sync.mjs'))
  })
})
