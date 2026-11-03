import type { Buffer } from 'node:buffer'

import type { AsyncWindowRectsCalls, WindowRect, WindowRectsBinding, WindowRectsCalls, WindowRectsWorkerPort, WindowRectsWorkerRequest, WindowRectsWorkerResponse } from './window-rects-spike'

import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWindowRectsSampler, createWorkerWalker, walkWindowsAsync, walkWindowsSync } from './window-rects-spike'

interface FakeWindow {
  hwnd: bigint
  pid: number
  title: string
  visible?: boolean
  iconic?: boolean
  exStyle?: number
  cloaked?: boolean
  rect?: { left: number, top: number, right: number, bottom: number }
  /** DWM extended frame bounds; absent means the DWM query fails. */
  frame?: { left: number, top: number, right: number, bottom: number }
  /** The thread id the pid query returns; 0 means the window closed mid-walk. */
  threadId?: number
  rectResult?: number
  textResult?: number
  throwIn?: keyof WindowRectsCalls
}

const WS_EX_TOOLWINDOW = 0x80
const WS_EX_NOACTIVATE = 0x08000000

/** A fake desktop in z-order, top first; `next` overrides the GetWindow chain. */
function createDesktop(windows: FakeWindow[], next?: (hwnd: bigint) => bigint | null): WindowRectsBinding<WindowRectsCalls> {
  const byHandle = new Map(windows.map(window => [window.hwnd, window]))
  const get = (hwnd: unknown, call: keyof WindowRectsCalls) => {
    const window = byHandle.get(hwnd as bigint)
    if (!window)
      throw new Error(`unknown handle ${String(hwnd)}`)
    if (window.throwIn === call)
      throw new Error(`${call} failed for ${window.title}`)
    return window
  }
  const write = (target: { left?: number, top?: number, right?: number, bottom?: number }, rect: FakeWindow['rect']) => Object.assign(target, rect)

  const calls: WindowRectsCalls = {
    GetTopWindow: () => windows[0]?.hwnd ?? null,
    GetWindow: (hwnd, _command) => {
      get(hwnd, 'GetWindow')
      if (next)
        return next(hwnd as bigint)
      const index = windows.findIndex(window => window.hwnd === hwnd)
      return windows[index + 1]?.hwnd ?? null
    },
    IsWindowVisible: hwnd => get(hwnd, 'IsWindowVisible').visible === false ? 0 : 1,
    IsIconic: hwnd => get(hwnd, 'IsIconic').iconic ? 1 : 0,
    GetWindowLongPtrW: hwnd => get(hwnd, 'GetWindowLongPtrW').exStyle ?? 0,
    DwmGetCloaked: (hwnd, _attribute, value) => {
      value[0] = get(hwnd, 'DwmGetCloaked').cloaked ? 2 : 0
      return 0
    },
    GetWindowThreadProcessId: (hwnd, processId) => {
      const window = get(hwnd, 'GetWindowThreadProcessId')
      const threadId = window.threadId ?? 11
      processId[0] = threadId === 0 ? 0 : window.pid
      return threadId
    },
    GetWindowRect: (hwnd, rect) => {
      const window = get(hwnd, 'GetWindowRect')
      if (window.rectResult === 0)
        return 0
      write(rect, window.rect ?? { left: 0, top: 0, right: 100, bottom: 100 })
      return 1
    },
    DwmGetFrameBounds: (hwnd, _attribute, rect) => {
      const window = get(hwnd, 'DwmGetFrameBounds')
      if (!window.frame)
        return -2147024809 // E_INVALIDARG
      write(rect, window.frame)
      return 0
    },
    GetWindowTextW: (hwnd, buffer: Buffer, maxCount) => {
      const window = get(hwnd, 'GetWindowTextW')
      const units = Math.min(window.title.length, maxCount - 1)
      buffer.write(window.title.slice(0, units), 0, 'utf16le')
      return window.textResult ?? units
    },
  }
  return { calls, address: hwnd => hwnd as bigint }
}

/** Wraps the fake desktop's calls in promises; the `hang` call never settles, like a stuck pool call. */
function toAsync(binding: WindowRectsBinding<WindowRectsCalls>, hang?: keyof WindowRectsCalls): WindowRectsBinding<AsyncWindowRectsCalls> {
  const c = binding.calls
  const promised = <A extends unknown[], R>(name: keyof WindowRectsCalls, fn: (...args: A) => R) =>
    (...args: A) => name === hang ? new Promise<R>(() => {}) : Promise.resolve().then(() => fn(...args))
  const calls: AsyncWindowRectsCalls = {
    GetTopWindow: promised('GetTopWindow', c.GetTopWindow),
    GetWindow: promised('GetWindow', c.GetWindow),
    IsWindowVisible: promised('IsWindowVisible', c.IsWindowVisible),
    IsIconic: promised('IsIconic', c.IsIconic),
    GetWindowLongPtrW: promised('GetWindowLongPtrW', c.GetWindowLongPtrW),
    GetWindowRect: promised('GetWindowRect', c.GetWindowRect),
    GetWindowThreadProcessId: promised('GetWindowThreadProcessId', c.GetWindowThreadProcessId),
    GetWindowTextW: promised('GetWindowTextW', c.GetWindowTextW),
    DwmGetCloaked: promised('DwmGetCloaked', c.DwmGetCloaked),
    DwmGetFrameBounds: promised('DwmGetFrameBounds', c.DwmGetFrameBounds),
  }
  return { calls, address: binding.address }
}

/** DIP at 150 % scale, so a test sees the conversion was applied. */
const toDipRect = (rect: WindowRect): WindowRect => ({ x: rect.x / 1.5, y: rect.y / 1.5, width: rect.width / 1.5, height: rect.height / 1.5 })

const OWN_PID = 100

function samplerFor(binding: WindowRectsBinding<WindowRectsCalls>, ownPids: number[] = [OWN_PID]) {
  return createWindowRectsSampler({
    mode: 'main',
    walker: { run: () => walkWindowsSync(binding) },
    ownProcessFilter: () => pid => ownPids.includes(pid),
    toDipRect,
  })
}

function appWindow(hwnd: bigint, title: string, pid = 200): FakeWindow {
  return {
    hwnd,
    pid,
    title,
    rect: { left: -7, top: 0, right: 1207, bottom: 907 },
    frame: { left: 0, top: 0, right: 1200, bottom: 900 },
  }
}

class FakeWorker extends EventEmitter implements WindowRectsWorkerPort {
  requests: WindowRectsWorkerRequest[] = []
  terminated = false

  constructor(private readonly answer: ((request: WindowRectsWorkerRequest) => WindowRectsWorkerResponse) | null) {
    super()
  }

  postMessage(request: WindowRectsWorkerRequest) {
    this.requests.push(request)
    const answer = this.answer
    if (answer)
      queueMicrotask(() => this.emit('message', answer(request)))
  }

  terminate() {
    this.terminated = true
    return Promise.resolve(1)
  }
}

describe('window-rects spike walk', () => {
  it('keeps visible app windows in z-order and drops hidden, minimized, tool, no-activate and cloaked windows', async () => {
    const desktop = createDesktop([
      appWindow(1n, 'Editor'),
      { ...appWindow(2n, 'Hidden'), visible: false },
      { ...appWindow(3n, 'Minimized'), iconic: true },
      appWindow(4n, 'Browser', 300),
      { ...appWindow(5n, 'Tray flyout'), exStyle: WS_EX_TOOLWINDOW },
      { ...appWindow(6n, 'Toast'), exStyle: WS_EX_NOACTIVATE },
      { ...appWindow(7n, 'Other desktop'), cloaked: true },
      appWindow(8n, 'Explorer', 400),
    ])

    const sample = await samplerFor(desktop)()

    expect(sample.windows.map(window => [window.title, window.zOrder])).toEqual([['Editor', 0], ['Browser', 3], ['Explorer', 7]])
    expect(sample).toMatchObject({ mode: 'main', walked: 8, kept: 3, failures: 0, truncated: false, timedOut: false, error: null })
    expect(sample.windows.every(window => !window.cloaked)).toBe(true)
  })

  it('reports the DWM frame as the physical rect, keeps GetWindowRect as the control, and converts to DIP', async () => {
    const sample = await samplerFor(createDesktop([appWindow(0xABCn, 'Editor')]))()

    expect(sample.windows[0]).toMatchObject({
      hwnd: '0xabc',
      pid: 200,
      frameSource: 'dwm',
      physicalRect: { x: 0, y: 0, width: 1200, height: 900 },
      control: { x: -7, y: 0, width: 1214, height: 907 },
      dipRect: { x: 0, y: 0, width: 800, height: 600 },
    })
  })

  it('falls back to GetWindowRect when the DWM frame query fails', async () => {
    const sample = await samplerFor(createDesktop([{ ...appWindow(1n, 'Legacy'), frame: undefined }]))()

    expect(sample.windows[0]).toMatchObject({ frameSource: 'window-rect', physicalRect: { x: -7, y: 0, width: 1214, height: 907 } })
  })

  it('drops windows of the own process unless the caller asks for them', async () => {
    const desktop = createDesktop([appWindow(1n, 'AIRI stage', OWN_PID), appWindow(2n, 'Editor'), appWindow(3n, 'AIRI renderer', 101)])
    const sample = samplerFor(desktop, [OWN_PID, 101])

    expect((await sample()).windows.map(window => window.title)).toEqual(['Editor'])
    expect((await sample({ includeOwnProcess: true })).windows.map(window => window.title)).toEqual(['AIRI stage', 'Editor', 'AIRI renderer'])
  })

  it('turns a binding throw on one window into a skipped entry and walks on', async () => {
    const desktop = createDesktop([appWindow(1n, 'Editor'), { ...appWindow(2n, 'Crashing'), throwIn: 'GetWindowRect' }, appWindow(3n, 'Browser')])

    const sample = await samplerFor(desktop)()

    expect(sample.windows.map(window => window.title)).toEqual(['Editor', 'Browser'])
    expect(sample.skipped).toEqual([{ hwnd: '0x2', zOrder: 1, reason: 'threw', message: 'GetWindowRect failed for Crashing' }])
    expect(sample).toMatchObject({ walked: 3, kept: 2, failures: 1, error: null })
  })

  it('skips a window that closes mid-walk', async () => {
    const desktop = createDesktop([
      { ...appWindow(1n, 'Closing'), threadId: 0 },
      { ...appWindow(2n, 'Gone'), rectResult: 0 },
      appWindow(3n, 'Editor'),
    ])

    const sample = await samplerFor(desktop)()

    expect(sample.skipped.map(entry => [entry.hwnd, entry.reason])).toEqual([['0x1', 'closed'], ['0x2', 'closed']])
    expect(sample.kept).toBe(1)
  })

  it('skips zero-size, negative-size and non-finite rects instead of reporting them', async () => {
    const desktop = createDesktop([
      { ...appWindow(1n, 'Zero'), rect: { left: 10, top: 10, right: 10, bottom: 50 }, frame: undefined },
      { ...appWindow(2n, 'Negative'), rect: { left: 500, top: 400, right: 100, bottom: 50 }, frame: undefined },
      { ...appWindow(3n, 'Garbage'), rect: { left: Number.NaN, top: 0, right: 10, bottom: 10 }, frame: undefined },
      // A garbage DWM frame falls back to the valid control rect.
      { ...appWindow(4n, 'Bad frame'), frame: { left: 0, top: 0, right: -1, bottom: -1 } },
    ])

    const sample = await samplerFor(desktop)()

    expect(sample.skipped.map(entry => [entry.hwnd, entry.reason])).toEqual([['0x1', 'invalid-rect'], ['0x2', 'invalid-rect'], ['0x3', 'invalid-rect']])
    expect(sample.windows).toHaveLength(1)
    expect(sample.windows[0]).toMatchObject({ title: 'Bad frame', frameSource: 'window-rect' })
  })

  it('replaces a lone surrogate in a title and clamps a copied count past the buffer', async () => {
    const desktop = createDesktop([
      appWindow(1n, 'Bad \uD800 title'),
      { ...appWindow(2n, 'Short'), textResult: 100_000 },
      { ...appWindow(3n, 'Negative'), textResult: -5 },
    ])

    const sample = await samplerFor(desktop)()

    expect(sample.windows[0].title).toBe('Bad \uFFFD title')
    expect(sample.windows[0].title.isWellFormed()).toBe(true)
    expect(sample.windows[1].title.startsWith('Short')).toBe(true)
    expect(sample.windows[1].title.length).toBe(256)
    expect(sample.windows[2].title).toBe('')
  })

  it('stops a walk whose GetWindow chain loops back, and reports it as truncated', async () => {
    const desktop = createDesktop([appWindow(1n, 'A'), appWindow(2n, 'B')], hwnd => hwnd === 1n ? 2n : 1n)

    const sample = await samplerFor(desktop)()

    expect(sample).toMatchObject({ walked: 2, kept: 2, truncated: true })
  })

  it('reports a GetWindow throw as a walk error and keeps what it read', async () => {
    const desktop = createDesktop([{ ...appWindow(1n, 'Editor'), throwIn: 'GetWindow' }, appWindow(2n, 'Unreached')])

    const sample = await samplerFor(desktop)()

    expect(sample).toMatchObject({ walked: 1, kept: 1, failures: 1, error: 'GetWindow failed for Editor' })
  })

  it('returns an empty sample for an empty desktop', async () => {
    const sample = await samplerFor(createDesktop([]))()

    expect(sample).toMatchObject({ walked: 0, kept: 0, failures: 0, windows: [] })
  })

  it('turns a DIP conversion throw into a skipped entry', async () => {
    const sample = await createWindowRectsSampler({
      mode: 'main',
      walker: { run: () => walkWindowsSync(createDesktop([appWindow(1n, 'Off-screen')])) },
      ownProcessFilter: () => () => false,
      toDipRect: () => {
        throw new Error('no display')
      },
    })()

    expect(sample.skipped).toEqual([{ hwnd: '0x1', zOrder: 0, reason: 'dip', message: 'no display' }])
    expect(sample).toMatchObject({ kept: 0, failures: 1 })
  })
})

describe('window-rects spike async strategy', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the same walk through promised calls as the synchronous strategy', async () => {
    const desktop = createDesktop([
      appWindow(1n, 'Editor'),
      { ...appWindow(2n, 'Other desktop'), cloaked: true },
      { ...appWindow(3n, 'Crashing'), throwIn: 'GetWindowTextW' },
      appWindow(4n, 'Browser'),
    ])

    expect(await walkWindowsAsync(toAsync(desktop))).toEqual(walkWindowsSync(desktop))
  })

  it('times out a walk whose pool call never returns', async () => {
    vi.useFakeTimers()
    const desktop = toAsync(createDesktop([appWindow(1n, 'Editor')]), 'GetWindowRect')
    const sample = createWindowRectsSampler({
      mode: 'async',
      walker: { run: () => walkWindowsAsync(desktop) },
      ownProcessFilter: () => () => false,
      toDipRect,
      timeoutMs: 250,
    })

    const pending = sample()
    await vi.advanceTimersByTimeAsync(250)

    expect(await pending).toMatchObject({ mode: 'async', timedOut: true, kept: 0, failures: 1, error: 'the walk did not finish within 250 ms' })
  })
})

describe('window-rects spike worker strategy', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('walks in the worker and filters and converts on the calling thread', async () => {
    const desktop = createDesktop([appWindow(1n, 'AIRI stage', OWN_PID), appWindow(2n, 'Editor')])
    const workers: FakeWorker[] = []
    const sample = createWindowRectsSampler({
      mode: 'worker',
      walker: createWorkerWalker(() => {
        const worker = new FakeWorker(request => ({ id: request.id, walk: walkWindowsSync(desktop) }))
        workers.push(worker)
        return worker
      }),
      ownProcessFilter: () => pid => pid === OWN_PID,
      toDipRect,
    })

    const first = await sample()
    const second = await sample()

    expect(first.windows.map(window => [window.title, window.dipRect])).toEqual([['Editor', { x: 0, y: 0, width: 800, height: 600 }]])
    expect(second.kept).toBe(1)
    expect(workers).toHaveLength(1)
    expect(workers[0].requests.map(request => request.id)).toEqual([1, 2])
  })

  it('times out a stuck worker, terminates it, and starts a fresh one for the next walk', async () => {
    vi.useFakeTimers()
    const desktop = createDesktop([appWindow(1n, 'Editor')])
    const workers: FakeWorker[] = []
    const sample = createWindowRectsSampler({
      mode: 'worker',
      walker: createWorkerWalker(() => {
        // The first worker never answers; the second does.
        const worker = new FakeWorker(workers.length === 0 ? null : request => ({ id: request.id, walk: walkWindowsSync(desktop) }))
        workers.push(worker)
        return worker
      }),
      ownProcessFilter: () => () => false,
      toDipRect,
      timeoutMs: 250,
    })

    const stuck = sample()
    await vi.advanceTimersByTimeAsync(249)
    expect(workers[0].terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(await stuck).toMatchObject({ mode: 'worker', timedOut: true, kept: 0, error: 'the walk did not finish within 250 ms' })
    expect(workers[0].terminated).toBe(true)

    const recovered = await sample()
    expect(recovered).toMatchObject({ timedOut: false, kept: 1, error: null })
    expect(workers).toHaveLength(2)
  })

  it('ignores a reply that arrives after its walk timed out', async () => {
    vi.useFakeTimers()
    const desktop = createDesktop([appWindow(1n, 'Editor')])
    const worker = new FakeWorker(null)
    const walker = createWorkerWalker(() => worker)
    const sample = createWindowRectsSampler({ mode: 'worker', walker, ownProcessFilter: () => () => false, toDipRect, timeoutMs: 250 })

    const stuck = sample()
    await vi.advanceTimersByTimeAsync(250)
    worker.emit('message', { id: 1, walk: walkWindowsSync(desktop) } satisfies WindowRectsWorkerResponse)

    expect((await stuck).timedOut).toBe(true)
  })

  it('reports a koffi load failure in the worker as the sample error', async () => {
    const sample = createWindowRectsSampler({
      mode: 'worker',
      walker: createWorkerWalker(() => new FakeWorker(request => ({ id: request.id, error: 'worker walk failed: koffi is unavailable' }))),
      ownProcessFilter: () => () => false,
      toDipRect,
    })

    expect(await sample()).toMatchObject({ timedOut: false, kept: 0, failures: 1, error: 'worker walk failed: koffi is unavailable' })
  })

  it('fails the pending walk when the worker exits and respawns on the next walk', async () => {
    const desktop = createDesktop([appWindow(1n, 'Editor')])
    const workers: FakeWorker[] = []
    const walker = createWorkerWalker(() => {
      const worker = new FakeWorker(workers.length === 0 ? null : request => ({ id: request.id, walk: walkWindowsSync(desktop) }))
      workers.push(worker)
      return worker
    })
    const sample = createWindowRectsSampler({ mode: 'worker', walker, ownProcessFilter: () => () => false, toDipRect })

    const crashed = sample()
    workers[0].emit('exit', 1)

    expect(await crashed).toMatchObject({ timedOut: false, error: 'the walk worker exited with code 1' })
    expect((await sample()).kept).toBe(1)
    expect(workers).toHaveLength(2)
  })
})
