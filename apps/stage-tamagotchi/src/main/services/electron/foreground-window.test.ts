import process from 'node:process'

import { Buffer } from 'node:buffer'

import { createContext, defineInvoke } from '@moeru/eventa'
import { electron } from '@proj-airi/electron-eventa'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createForegroundWindowService } from './foreground-window'

const host = vi.hoisted(() => ({
  isWindows: true,
}))

const appMock = vi.hoisted(() => ({
  getAppMetrics: vi.fn<() => { pid: number }[]>(),
}))

/** The desktop the fake Win32 functions read. */
const desktop = vi.hoisted(() => ({
  hwnd: 1n as bigint | null,
  title: '',
  threadId: 7,
  pid: 4321,
  processHandle: 9n as bigint | null,
  exePath: null as string | null,
  quns: 5,
  qunsResult: 0,
}))

const win32 = vi.hoisted(() => ({
  GetForegroundWindow: vi.fn(() => desktop.hwnd),
  GetWindowTextLengthW: vi.fn((_hwnd: unknown) => desktop.title.length),
  GetWindowTextW: vi.fn((_hwnd: unknown, buffer: Buffer, maxCount: number) => {
    const units = Math.min(desktop.title.length, maxCount - 1)
    buffer.write(desktop.title.slice(0, units), 0, 'utf16le')
    return units
  }),
  GetWindowThreadProcessId: vi.fn((_hwnd: unknown, processId: [number]) => {
    processId[0] = desktop.threadId === 0 ? 0 : desktop.pid
    return desktop.threadId
  }),
  OpenProcess: vi.fn((_access: number, _inherit: number, _pid: number) => desktop.processHandle),
  QueryFullProcessImageNameW: vi.fn((_process: unknown, _flags: number, buffer: Buffer, size: [number]) => {
    if (desktop.exePath == null)
      return 0
    buffer.write(desktop.exePath, 0, 'utf16le')
    size[0] = desktop.exePath.length
    return 1
  }),
  CloseHandle: vi.fn((_handle: unknown) => 1),
  SHQueryUserNotificationState: vi.fn((state: [number]) => {
    state[0] = desktop.quns
    return desktop.qunsResult
  }),
}))

const koffiMock = vi.hoisted(() => ({
  loadError: null as Error | null,
  load: vi.fn(),
}))

const logMock = vi.hoisted(() => {
  const logger = {
    withError: vi.fn(),
    warn: vi.fn(),
    useGlobalConfig: vi.fn(),
  }
  logger.withError.mockReturnValue(logger)
  logger.useGlobalConfig.mockReturnValue(logger)
  return logger
})

vi.mock('@guiiai/logg', () => ({
  useLogg: () => logMock,
}))

vi.mock('koffi', () => ({
  load: koffiMock.load,
}))

vi.mock('electron', () => ({
  app: appMock,
}))

vi.mock('std-env', () => ({
  get isWindows() {
    return host.isWindows
  },
}))

describe('createForegroundWindowService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    host.isWindows = true
    koffiMock.loadError = null
    koffiMock.load.mockImplementation(() => {
      if (koffiMock.loadError)
        throw koffiMock.loadError
      return {
        func: (definition: string) => {
          const name = /__stdcall (\w+)\(/.exec(definition)?.[1] as keyof typeof win32
          return win32[name]
        },
      }
    })
    appMock.getAppMetrics.mockReturnValue([{ pid: 1111 }, { pid: 2222 }])
    Object.assign(desktop, {
      hwnd: 1n,
      title: 'notes.txt - Notepad',
      threadId: 7,
      pid: 4321,
      processHandle: 9n,
      exePath: 'C:\\Windows\\System32\\Notepad.exe',
      quns: 5,
      qunsResult: 0,
    })
  })

  function createReader(getSidecarPid?: () => number | null) {
    const context = createContext()
    createForegroundWindowService({ context: context as never, window: { once: vi.fn() } as never, getSidecarPid })
    return defineInvoke(context, electron.foregroundWindow.sample)
  }

  it('reads the title, the executable, and the notification state, and closes the process handle', async () => {
    const sample = await createReader()()

    expect(sample).toEqual({
      exePath: 'C:\\Windows\\System32\\Notepad.exe',
      exeName: 'Notepad.exe',
      title: 'notes.txt - Notepad',
      pid: 4321,
      ownProcess: false,
      notificationState: 'accepts',
      sampledAtMs: expect.any(Number),
    })
    expect(win32.OpenProcess).toHaveBeenCalledWith(0x1000, 0, 4321)
    expect(win32.CloseHandle).toHaveBeenCalledExactlyOnceWith(9n)
  })

  it('decodes non-ASCII titles intact', async () => {
    desktop.title = '\u65E5\u672C\u8A9E \u{1F3AE} caf\u00E9 \u2014 \u0645\u0631\u062D\u0628\u0627'

    await expect(createReader()()).resolves.toMatchObject({ title: desktop.title })
  })

  it('cuts a huge title at 1024 code units without leaving half a surrogate pair', async () => {
    // 1023 ASCII units put the emoji's high surrogate at the last readable unit.
    desktop.title = `${'a'.repeat(1023)}\u{1F3AE}${'b'.repeat(5000)}`

    const sample = await createReader()()

    expect(win32.GetWindowTextW).toHaveBeenCalledWith(1n, expect.any(Buffer), 1025)
    expect(sample?.title).toBe('a'.repeat(1023))
  })

  it('reports an empty title for an untitled window', async () => {
    desktop.title = ''

    await expect(createReader()()).resolves.toMatchObject({ title: '' })
    expect(win32.GetWindowTextW).not.toHaveBeenCalled()
  })

  it.each([null, 0n])('resolves null without touching any process when the foreground window is %s', async (hwnd) => {
    desktop.hwnd = hwnd

    await expect(createReader()()).resolves.toBeNull()
    expect(win32.GetWindowThreadProcessId).not.toHaveBeenCalled()
    expect(win32.OpenProcess).not.toHaveBeenCalled()
  })

  it('resolves null when the window closes between GetForegroundWindow and the thread lookup', async () => {
    desktop.threadId = 0

    await expect(createReader()()).resolves.toBeNull()
    expect(win32.OpenProcess).not.toHaveBeenCalled()
  })

  it('keeps the sample without an executable when Windows denies the process query', async () => {
    desktop.processHandle = null

    await expect(createReader()()).resolves.toMatchObject({ exePath: null, exeName: null, pid: 4321, title: 'notes.txt - Notepad' })
    expect(win32.CloseHandle).not.toHaveBeenCalled()
  })

  it('closes the process handle when the image name query fails', async () => {
    desktop.exePath = null

    await expect(createReader()()).resolves.toMatchObject({ exePath: null, exeName: null })
    expect(win32.CloseHandle).toHaveBeenCalledExactlyOnceWith(9n)
  })

  it('closes exactly one handle per read across many reads', async () => {
    const read = createReader()
    for (let i = 0; i < 200; i++)
      await read()

    expect(win32.OpenProcess).toHaveBeenCalledTimes(200)
    expect(win32.CloseHandle).toHaveBeenCalledTimes(200)
  })

  it.each([
    [1, 'not-present'],
    [2, 'busy'],
    [3, 'd3d-fullscreen'],
    [4, 'presentation'],
    [5, 'accepts'],
    [6, 'quiet-time'],
    [7, 'app'],
    [0, null],
    [8, null],
  ])('maps QUNS value %i to %s', async (quns, expected) => {
    desktop.quns = quns

    await expect(createReader()()).resolves.toMatchObject({ notificationState: expected })
  })

  it('reports an unknown notification state when the shell query fails', async () => {
    desktop.qunsResult = -2147467259 // E_FAIL

    await expect(createReader()()).resolves.toMatchObject({ notificationState: null })
  })

  it.each([
    ['an Electron process of the app', 2222],
    ['the main process', process.pid],
  ])('marks windows of %s as its own', async (_label, pid) => {
    desktop.pid = pid

    await expect(createReader()()).resolves.toMatchObject({ pid, ownProcess: true })
  })

  it('marks windows of the Godot stage sidecar as its own', async () => {
    await expect(createReader(() => 4321)()).resolves.toMatchObject({ pid: 4321, ownProcess: true })
  })

  it('reads the sidecar pid at every sample, so a restarted sidecar is its own and its old pid is not', async () => {
    let sidecarPid: number | null = 4321
    const read = createReader(() => sidecarPid)

    await expect(read()).resolves.toMatchObject({ pid: 4321, ownProcess: true })

    sidecarPid = 5555
    await expect(read()).resolves.toMatchObject({ pid: 4321, ownProcess: false })

    desktop.pid = 5555
    await expect(read()).resolves.toMatchObject({ pid: 5555, ownProcess: true })

    sidecarPid = null
    await expect(read()).resolves.toMatchObject({ pid: 5555, ownProcess: false })
  })

  it.each([
    ['a stopped sidecar', () => null],
    ['no sidecar source', undefined],
  ])('changes nothing for %s', async (_label, getSidecarPid) => {
    const read = createReader(getSidecarPid)

    await expect(read()).resolves.toMatchObject({ pid: 4321, ownProcess: false })

    desktop.pid = 2222
    await expect(read()).resolves.toMatchObject({ pid: 2222, ownProcess: true })
  })

  it('resolves null off Windows without loading koffi', async () => {
    host.isWindows = false

    await expect(createReader()()).resolves.toBeNull()
    expect(koffiMock.load).not.toHaveBeenCalled()
  })

  it('resolves null when koffi fails to load, and does not retry the load', async () => {
    koffiMock.loadError = new Error('The specified module could not be found.')
    const read = createReader()

    await expect(read()).resolves.toBeNull()
    await expect(read()).resolves.toBeNull()
    expect(koffiMock.load).toHaveBeenCalledOnce()
    expect(win32.GetForegroundWindow).not.toHaveBeenCalled()
  })

  it('resolves null and logs exactly one warning when koffi.load throws', async () => {
    const failure = new Error('user32.dll failed to load')
    koffiMock.load.mockImplementation(() => {
      throw failure
    })
    const read = createReader()

    await expect(read()).resolves.toBeNull()
    await expect(read()).resolves.toBeNull()

    expect(logMock.withError).toHaveBeenCalledExactlyOnceWith(failure)
    expect(logMock.warn).toHaveBeenCalledExactlyOnceWith('foreground window sampling is unavailable: user32.dll failed to load')
  })

  it('loads koffi only on the first read, once for overlapping reads', async () => {
    const read = createReader()
    expect(koffiMock.load).not.toHaveBeenCalled()

    const samples = await Promise.all([read(), read(), read()])

    expect(samples.map(sample => sample?.pid)).toEqual([4321, 4321, 4321])
    // user32, kernel32, and shell32, loaded once.
    expect(koffiMock.load).toHaveBeenCalledTimes(3)
  })
})
