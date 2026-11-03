import type { App, BrowserWindow, Rectangle, Screen } from 'electron'

import process, { env } from 'node:process'

import { Buffer } from 'node:buffer'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

import { useLogg } from '@guiiai/logg'
import { errorMessageFrom } from '@moeru/std'

// NOTICE:
// A measurement spike, not the product sensor: it measures what a top-level window walk costs
// on the main thread, koffi's async pool and a worker before M4 picks a design and a wire shape.
// Source: `.omo/plans/mmd-actions-library.md`, todo 6.
// Removal condition: the M4 plan replaces or deletes it.

// No runtime Electron import: the worker entry imports the walk from here, and Electron modules
// are unavailable in worker threads. The main process passes `app`, `screen` and `BrowserWindow` in.

/** Opaque Win32 `HWND` as koffi returns it; the null handle is falsy. Handles never leave this module. */
type Win32Handle = unknown

/** A Win32 `RECT` out parameter; koffi fills the members, so they are absent until the call succeeds. */
interface Win32Rect {
  left?: number
  top?: number
  right?: number
  bottom?: number
}

/** The FFI calls of one walk. BOOL results are 4-byte `int`s; HRESULTs are 0 on success. */
export interface WindowRectsCalls {
  GetTopWindow: (hwnd: Win32Handle) => Win32Handle
  GetWindow: (hwnd: Win32Handle, command: number) => Win32Handle
  IsWindowVisible: (hwnd: Win32Handle) => number
  IsIconic: (hwnd: Win32Handle) => number
  GetWindowLongPtrW: (hwnd: Win32Handle, index: number) => number | bigint
  GetWindowRect: (hwnd: Win32Handle, rect: Win32Rect) => number
  GetWindowThreadProcessId: (hwnd: Win32Handle, processId: [number]) => number
  GetWindowTextW: (hwnd: Win32Handle, buffer: Buffer, maxCount: number) => number
  /** `DwmGetWindowAttribute` declared with a `DWORD` out parameter, for `DWMWA_CLOAKED`. */
  DwmGetCloaked: (hwnd: Win32Handle, attribute: number, value: [number], size: number) => number
  /** `DwmGetWindowAttribute` declared with a `RECT` out parameter, for `DWMWA_EXTENDED_FRAME_BOUNDS`. */
  DwmGetFrameBounds: (hwnd: Win32Handle, attribute: number, rect: Win32Rect, size: number) => number
}

export type AsyncWindowRectsCalls = {
  [K in keyof WindowRectsCalls]: (...args: Parameters<WindowRectsCalls[K]>) => Promise<ReturnType<WindowRectsCalls[K]>>
}

export interface WindowRectsBinding<TCalls> {
  calls: TCalls
  /** The numeric address of a handle, used as its identity across the walk. */
  address: (hwnd: Win32Handle) => bigint
}

export interface WindowRect {
  x: number
  y: number
  width: number
  height: number
}

export interface WalkedWindow {
  /** The handle address as `0x` hex, so a walk stays structured-cloneable and JSON-safe. */
  hwnd: string
  pid: number
  title: string
  /** Position in the walk, 0 = topmost; counts every walked window, kept or not. */
  zOrder: number
  /** The visible frame in physical pixels: the DWM extended frame bounds, else `control`. */
  physicalRect: WindowRect
  /** `GetWindowRect` in physical pixels; it includes the invisible resize borders (about 7 px). */
  control: WindowRect
  frameSource: 'dwm' | 'window-rect'
  cloaked: boolean
}

export interface SkippedWindow {
  hwnd: string
  zOrder: number
  /** `closed`: the window went away mid-walk; `invalid-rect`: an empty, negative or non-finite rect; `threw`: a call threw; `dip`: the DIP conversion threw. */
  reason: 'closed' | 'invalid-rect' | 'threw' | 'dip'
  message?: string
}

/** One walk in physical pixels, before the own-process filter and the DIP conversion. */
export interface WindowWalk {
  windows: WalkedWindow[]
  skipped: SkippedWindow[]
  walked: number
  /** Skipped windows plus a walk that stopped on an error. */
  failures: number
  /** The walk hit the window cap or revisited a handle (z-order changed under it). */
  truncated: boolean
  walkError: string | null
}

export type WindowRectsMode = 'main' | 'async' | 'worker'

export interface WindowRectsSample {
  mode: WindowRectsMode
  windows: (WalkedWindow & { dipRect: WindowRect })[]
  skipped: SkippedWindow[]
  walked: number
  kept: number
  failures: number
  truncated: boolean
  /** Wall time of the sample on the calling thread, including the round trip and the DIP conversion. */
  durationUs: number
  timedOut: boolean
  /** Why the sample has no windows: a failed koffi load, a dead worker or a timeout. */
  error: string | null
}

const GW_HWNDNEXT = 2
const GWL_EXSTYLE = -20
const WS_EX_TOOLWINDOW = 0x80
const WS_EX_NOACTIVATE = 0x08000000
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
const RECT_BYTES = 16
const DWORD_BYTES = 4

/** Titles are cut here; the spike only needs them to match windows against a manual list. */
const TITLE_MAX_UNITS = 256

/** A desktop rarely has more than a few hundred top-level windows; the cap bounds a walk whose chain never ends. */
const WALK_MAX_WINDOWS = 4096

/** One 4 Hz period: an off-main walk slower than this is reported as timed out. */
export const WINDOW_RECTS_DEFAULT_TIMEOUT_MS = 250

type WindowRectsCall = {
  [K in keyof WindowRectsCalls]: { name: K, args: Parameters<WindowRectsCalls[K]> }
}[keyof WindowRectsCalls]

type WalkSteps<T> = Generator<WindowRectsCall, T, unknown>

/** Yields one FFI call to the driver and returns its result; a call that throws throws here. */
function* invoke<K extends keyof WindowRectsCalls>(name: K, ...args: Parameters<WindowRectsCalls[K]>): WalkSteps<ReturnType<WindowRectsCalls[K]>> {
  // The driver answers each yielded call with that call's own result, so the result type follows `name`.
  return (yield { name, args } as WindowRectsCall) as ReturnType<WindowRectsCalls[K]>
}

function toWindowRect(rect: Win32Rect): WindowRect | null {
  const { left, top, right, bottom } = rect
  if (left == null || top == null || right == null || bottom == null)
    return null
  if (![left, top, right, bottom].every(Number.isFinite))
    return null
  const width = right - left
  const height = bottom - top
  // A zero-area window cannot be perched on; a negative one is a torn read.
  if (width <= 0 || height <= 0)
    return null
  return { x: left, y: top, width, height }
}

type WindowRead
  = | { kind: 'filtered' }
    | { kind: 'skipped', reason: SkippedWindow['reason'] }
    | { kind: 'window', window: Omit<WalkedWindow, 'hwnd' | 'zOrder'> }

function* readWindow(hwnd: Win32Handle, titleBuffer: Buffer): WalkSteps<WindowRead> {
  // Cheapest checks first: most top-level windows are hidden.
  if ((yield* invoke('IsWindowVisible', hwnd)) === 0)
    return { kind: 'filtered' }
  if ((yield* invoke('IsIconic', hwnd)) !== 0)
    return { kind: 'filtered' }
  const exStyle = Number(yield* invoke('GetWindowLongPtrW', hwnd, GWL_EXSTYLE))
  if ((exStyle & WS_EX_TOOLWINDOW) !== 0 || (exStyle & WS_EX_NOACTIVATE) !== 0)
    return { kind: 'filtered' }

  // Cloaked windows (other virtual desktops, suspended UWP apps) report visible but draw nothing.
  // A failed query reads as not cloaked; the window then shows up and the measurement sees it.
  const cloakedValue: [number] = [0]
  const cloaked = (yield* invoke('DwmGetCloaked', hwnd, DWMWA_CLOAKED, cloakedValue, DWORD_BYTES)) === 0 && cloakedValue[0] !== 0
  if (cloaked)
    return { kind: 'filtered' }

  const processId: [number] = [0]
  // A zero thread id means the window closed after GetWindow returned it.
  if ((yield* invoke('GetWindowThreadProcessId', hwnd, processId)) === 0 || processId[0] === 0)
    return { kind: 'skipped', reason: 'closed' }

  const windowRect: Win32Rect = {}
  if ((yield* invoke('GetWindowRect', hwnd, windowRect)) === 0)
    return { kind: 'skipped', reason: 'closed' }
  const control = toWindowRect(windowRect)
  if (!control)
    return { kind: 'skipped', reason: 'invalid-rect' }

  const frameRect: Win32Rect = {}
  const frame = (yield* invoke('DwmGetFrameBounds', hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, frameRect, RECT_BYTES)) === 0 ? toWindowRect(frameRect) : null

  // The copied count is the truth; clamp it so a bad count cannot read past the buffer.
  const copied = Math.max(0, Math.min(yield* invoke('GetWindowTextW', hwnd, titleBuffer, TITLE_MAX_UNITS + 1), TITLE_MAX_UNITS))
  // Win32 titles are not validated UTF-16; a lone surrogate becomes U+FFFD so the title stays a valid string.
  const title = titleBuffer.toString('utf16le', 0, copied * 2).toWellFormed()

  return {
    kind: 'window',
    window: {
      pid: processId[0],
      title,
      physicalRect: frame ?? control,
      control,
      frameSource: frame ? 'dwm' : 'window-rect',
      cloaked,
    },
  }
}

/**
 * Walks the top-level windows from the top of the z-order down. One body serves the three
 * execution strategies: the drivers below answer its calls synchronously or through promises.
 */
function* walkWindows(address: (hwnd: Win32Handle) => bigint): WalkSteps<WindowWalk> {
  const windows: WalkedWindow[] = []
  const skipped: SkippedWindow[] = []
  const seen = new Set<bigint>()
  // Allocated per walk: a timed-out async walk can still be running when the next one starts.
  const titleBuffer = Buffer.alloc((TITLE_MAX_UNITS + 1) * 2)
  let walked = 0
  let truncated = false
  let walkError: string | null = null

  let hwnd: Win32Handle = null
  try {
    hwnd = yield* invoke('GetTopWindow', null)
  }
  catch (error) {
    walkError = errorMessageFrom(error) ?? 'GetTopWindow failed'
  }

  while (hwnd) {
    const id = address(hwnd)
    // A window moving in the z-order mid-walk can send GetWindow back to a handle already seen.
    if (seen.has(id) || walked >= WALK_MAX_WINDOWS) {
      truncated = true
      break
    }
    seen.add(id)
    const zOrder = walked++
    const hwndText = `0x${id.toString(16)}`

    try {
      const read = yield* readWindow(hwnd, titleBuffer)
      if (read.kind === 'window')
        windows.push({ hwnd: hwndText, zOrder, ...read.window })
      else if (read.kind === 'skipped')
        skipped.push({ hwnd: hwndText, zOrder, reason: read.reason })
    }
    catch (error) {
      skipped.push({ hwnd: hwndText, zOrder, reason: 'threw', message: errorMessageFrom(error) ?? 'a Win32 call threw' })
    }

    try {
      hwnd = yield* invoke('GetWindow', hwnd, GW_HWNDNEXT)
    }
    catch (error) {
      walkError = errorMessageFrom(error) ?? 'GetWindow failed'
      break
    }
  }

  return { windows, skipped, walked, failures: skipped.length + (walkError ? 1 : 0), truncated, walkError }
}

function callOf(calls: WindowRectsCalls | AsyncWindowRectsCalls, call: WindowRectsCall): unknown {
  // Each entry of `WindowRectsCall` pairs a name with that function's own parameters.
  const fn: (...args: never[]) => unknown = calls[call.name]
  return Reflect.apply(fn, undefined, call.args)
}

/** Runs one walk with synchronous koffi calls on the calling thread (the `main` and `worker` strategies). */
export function walkWindowsSync(binding: WindowRectsBinding<WindowRectsCalls>): WindowWalk {
  const steps = walkWindows(binding.address)
  let step = steps.next()
  while (!step.done) {
    let result: unknown
    try {
      result = callOf(binding.calls, step.value)
    }
    catch (error) {
      step = steps.throw(error)
      continue
    }
    step = steps.next(result)
  }
  return step.value
}

/** Runs one walk with every call on koffi's async pool (the `async` strategy); each call is one pool round trip. */
export async function walkWindowsAsync(binding: WindowRectsBinding<AsyncWindowRectsCalls>): Promise<WindowWalk> {
  const steps = walkWindows(binding.address)
  let step = steps.next()
  while (!step.done) {
    let result: unknown
    try {
      result = await callOf(binding.calls, step.value)
    }
    catch (error) {
      step = steps.throw(error)
      continue
    }
    step = steps.next(result)
  }
  return step.value
}

interface LoadedWindowRectsBinding {
  sync: WindowRectsBinding<WindowRectsCalls>
  async: WindowRectsBinding<AsyncWindowRectsCalls>
}

let loadedBinding: Promise<LoadedWindowRectsBinding> | undefined

/**
 * Loads koffi and declares the walk's calls, once per thread. A failed load stays failed.
 * The declarations are cached because koffi rejects a second struct type with the same name.
 */
export function loadWindowRectsBinding(): Promise<LoadedWindowRectsBinding> {
  loadedBinding ??= (async () => {
    const koffi = await import('koffi')
    const user32 = koffi.load('user32.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    koffi.struct('AIRI_SPIKE_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' })

    const functions = {
      GetTopWindow: user32.func('void * __stdcall GetTopWindow(void *hWnd)'),
      GetWindow: user32.func('void * __stdcall GetWindow(void *hWnd, uint32_t uCmd)'),
      IsWindowVisible: user32.func('int __stdcall IsWindowVisible(void *hWnd)'),
      IsIconic: user32.func('int __stdcall IsIconic(void *hWnd)'),
      GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)'),
      GetWindowRect: user32.func('int __stdcall GetWindowRect(void *hWnd, _Out_ AIRI_SPIKE_RECT *lpRect)'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hWnd, _Out_ uint16_t *lpString, int nMaxCount)'),
      DwmGetCloaked: dwmapi.func('int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t dwAttribute, _Out_ uint32_t *pvAttribute, uint32_t cbAttribute)'),
      DwmGetFrameBounds: dwmapi.func('int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t dwAttribute, _Out_ AIRI_SPIKE_RECT *pvAttribute, uint32_t cbAttribute)'),
    } satisfies Record<keyof WindowRectsCalls, unknown>

    const pooled = <K extends keyof WindowRectsCalls>(name: K) => (...args: Parameters<WindowRectsCalls[K]>) => new Promise<ReturnType<WindowRectsCalls[K]>>((resolve, reject) => {
      functions[name].async(...args, (error: unknown, result: ReturnType<WindowRectsCalls[K]>) => error ? reject(error) : resolve(result))
    })
    const asyncCalls: AsyncWindowRectsCalls = {
      GetTopWindow: pooled('GetTopWindow'),
      GetWindow: pooled('GetWindow'),
      IsWindowVisible: pooled('IsWindowVisible'),
      IsIconic: pooled('IsIconic'),
      GetWindowLongPtrW: pooled('GetWindowLongPtrW'),
      GetWindowRect: pooled('GetWindowRect'),
      GetWindowThreadProcessId: pooled('GetWindowThreadProcessId'),
      GetWindowTextW: pooled('GetWindowTextW'),
      DwmGetCloaked: pooled('DwmGetCloaked'),
      DwmGetFrameBounds: pooled('DwmGetFrameBounds'),
    }

    const address = (hwnd: Win32Handle) => koffi.address(hwnd)
    return { sync: { calls: functions, address }, async: { calls: asyncCalls, address } }
  })()
  return loadedBinding
}

/** A walk strategy as the sampler sees it; `cancel` gives up on a walk that timed out. */
export interface WindowRectsWalker {
  run: () => WindowWalk | Promise<WindowWalk>
  cancel?: () => void
  dispose?: () => void
}

export interface WindowRectsWorkerRequest {
  id: number
}

export type WindowRectsWorkerResponse
  = | { id: number, walk: WindowWalk }
    | { id: number, error: string }

/** The part of `worker_threads.Worker` the worker walker uses. */
export interface WindowRectsWorkerPort {
  postMessage: (request: WindowRectsWorkerRequest) => void
  on: (event: 'message' | 'error' | 'exit', listener: (value: unknown) => void) => unknown
  terminate: () => unknown
}

class WalkTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`the walk did not finish within ${timeoutMs} ms`)
  }
}

/**
 * Runs walks in a worker thread, one request per walk.
 *
 * Expects:
 * - `spawn` starts a worker that answers each request with a walk or an error; it runs lazily
 *   on the first walk and again after a worker is cancelled, errors or exits
 *
 * Returns:
 * - A walker whose `cancel` terminates a stuck worker, so the next walk starts a fresh one.
 *   A reply that arrives after its request was given up is ignored.
 */
export function createWorkerWalker(spawn: () => WindowRectsWorkerPort): WindowRectsWalker {
  interface Pending { resolve: (walk: WindowWalk) => void, reject: (error: Error) => void }
  interface RunningWorker { port: WindowRectsWorkerPort, pending: Map<number, Pending> }

  let worker: RunningWorker | undefined
  let nextId = 1

  function retire(state: RunningWorker, error: Error) {
    if (worker === state)
      worker = undefined
    for (const pending of state.pending.values())
      pending.reject(error)
    state.pending.clear()
  }

  function ensureWorker(): RunningWorker {
    if (worker)
      return worker
    const state: RunningWorker = { port: spawn(), pending: new Map() }
    state.port.on('message', (value) => {
      // The worker entry in this directory is the only sender.
      const response = value as WindowRectsWorkerResponse
      const pending = state.pending.get(response.id)
      if (!pending)
        return
      state.pending.delete(response.id)
      if ('error' in response)
        pending.reject(new Error(response.error))
      else
        pending.resolve(response.walk)
    })
    state.port.on('error', error => retire(state, new Error(`the walk worker failed: ${errorMessageFrom(error) ?? 'unknown error'}`)))
    state.port.on('exit', code => retire(state, new Error(`the walk worker exited with code ${String(code)}`)))
    worker = state
    return state
  }

  function stop(error: Error) {
    const state = worker
    if (!state)
      return
    retire(state, error)
    void state.port.terminate()
  }

  return {
    run: () => new Promise<WindowWalk>((resolve, reject) => {
      const state = ensureWorker()
      const id = nextId++
      state.pending.set(id, { resolve, reject })
      state.port.postMessage({ id })
    }),
    cancel: () => stop(new Error('the walk was cancelled after a timeout')),
    dispose: () => stop(new Error('the walk worker was disposed')),
  }
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new WalkTimeoutError(timeoutMs))
      onTimeout()
    }, timeoutMs)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Builds one sampler over a walk strategy.
 *
 * Expects:
 * - `ownProcessFilter` returns, once per sample, whether a pid is AIRI's own
 * - `toDipRect` converts a physical rect to DIP; on Windows this is `screen.screenToDipRect(null, rect)`
 *
 * Returns:
 * - `sample()`, which never rejects: a failed or stuck walk is a sample with `error` set.
 *   A synchronous walk cannot time out; an off-main walk past `timeoutMs` is cancelled.
 */
export function createWindowRectsSampler(params: {
  mode: WindowRectsMode
  walker: WindowRectsWalker
  ownProcessFilter: () => (pid: number) => boolean
  toDipRect: (rect: WindowRect) => WindowRect
  timeoutMs?: number
}) {
  const timeoutMs = params.timeoutMs ?? WINDOW_RECTS_DEFAULT_TIMEOUT_MS

  return async function sample(options?: { includeOwnProcess?: boolean }): Promise<WindowRectsSample> {
    const started = performance.now()
    const elapsedUs = () => (performance.now() - started) * 1000

    let walk: WindowWalk
    try {
      const result = params.walker.run()
      walk = result instanceof Promise ? await withTimeout(result, timeoutMs, () => params.walker.cancel?.()) : result
    }
    catch (error) {
      return {
        mode: params.mode,
        windows: [],
        skipped: [],
        walked: 0,
        kept: 0,
        failures: 1,
        truncated: false,
        durationUs: elapsedUs(),
        timedOut: error instanceof WalkTimeoutError,
        error: errorMessageFrom(error) ?? 'the walk failed',
      }
    }

    const isOwnProcess = options?.includeOwnProcess ? () => false : params.ownProcessFilter()
    const windows: WindowRectsSample['windows'] = []
    const skipped = [...walk.skipped]
    for (const window of walk.windows) {
      if (isOwnProcess(window.pid))
        continue
      try {
        windows.push({ ...window, dipRect: params.toDipRect(window.physicalRect) })
      }
      catch (error) {
        skipped.push({ hwnd: window.hwnd, zOrder: window.zOrder, reason: 'dip', message: errorMessageFrom(error) ?? 'screenToDipRect threw' })
      }
    }

    return {
      mode: params.mode,
      windows,
      skipped,
      walked: walk.walked,
      kept: windows.length,
      failures: walk.failures + (skipped.length - walk.skipped.length),
      truncated: walk.truncated,
      durationUs: elapsedUs(),
      timedOut: false,
      error: walk.walkError,
    }
  }
}

export type WindowRectsSampler = ReturnType<typeof createWindowRectsSampler>

/** Whether the window-rect sensor spike runs. Set `AIRI_WINDOW_SENSOR_SPIKE=1`; the caller also requires Windows. */
export function isWindowRectsSpikeEnabled(): boolean {
  return env.AIRI_WINDOW_SENSOR_SPIKE === '1'
}

function readMode(value: string | undefined): WindowRectsMode {
  return value === 'async' || value === 'worker' ? value : 'main'
}

export interface WindowRectsRunSample {
  durationUs: number
  walked: number
  kept: number
  failures: number
  timedOut: boolean
}

export interface WindowRectsRun {
  mode: WindowRectsMode
  startedAt: string
  /** The first sample error, for example a koffi load failure in the worker. */
  error: string | null
  backToBack: WindowRectsRunSample[]
  paced: WindowRectsRunSample[]
  loopDelay: { baselineP99Ms: number, pacedP99Ms: number, deltaMs: number }
}

export interface WindowRectsMemoryPoint {
  tMs: number
  rss: number
  heapUsed: number
  external: number
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)))

function toRunSample(sample: WindowRectsSample): WindowRectsRunSample {
  return { durationUs: sample.durationUs, walked: sample.walked, kept: sample.kept, failures: sample.failures, timedOut: sample.timedOut }
}

/** Calls `tick` at `hz` for `count` ticks on a drift-free schedule; a slow tick delays only itself. */
async function paced(count: number, hz: number, tick: (index: number) => Promise<void>) {
  const periodMs = 1000 / hz
  const start = performance.now()
  for (let index = 0; index < count; index++) {
    await delay(start + index * periodMs - performance.now())
    await tick(index)
  }
}

function p99Ms(histogram: ReturnType<typeof monitorEventLoopDelay>): number {
  return histogram.percentile(99) / 1e6
}

/**
 * Starts the spike: one sampler per strategy, created on first use, and a measurement hook on
 * `globalThis.__airiWindowRectsSpike` that `packages/qa-tools/src/window-rects/measure.ts` drives
 * over the main-process inspector. The hook is the spike's only surface; it adds no IPC.
 *
 * Expects:
 * - Windows, after `app` is ready; `AIRI_WINDOW_SENSOR_SPIKE_MODE=main|async|worker` picks the
 *   default strategy for `sample()` (default `main`)
 *
 * Returns:
 * - The dispose function that removes the hook and stops the worker
 */
export function setupWindowRectsSpike(params: { app: App, screen: Screen, BrowserWindow: typeof BrowserWindow }): () => void {
  const log = useLogg('window-rects-spike').useGlobalConfig()
  const defaultMode = readMode(env.AIRI_WINDOW_SENSOR_SPIKE_MODE)
  const samplers = new Map<WindowRectsMode, Promise<WindowRectsSampler>>()
  const walkers: WindowRectsWalker[] = []

  function ownProcessFilter() {
    // Mirrors the foreground sensor's own-process policy (`foreground-window.ts`), read once per sample.
    // The Godot stage sidecar is not filtered here; M4 must add its pid.
    const pids = new Set([process.pid, ...params.app.getAppMetrics().map(metric => metric.pid)])
    return (pid: number) => pids.has(pid)
  }

  async function createWalker(mode: WindowRectsMode): Promise<WindowRectsWalker> {
    if (mode === 'worker') {
      const { default: createWorker } = await import('./window-rects-spike.worker?nodeWorker')
      return createWorkerWalker(() => createWorker({}))
    }
    try {
      const binding = await loadWindowRectsBinding()
      return mode === 'async'
        ? { run: () => walkWindowsAsync(binding.async) }
        : { run: () => walkWindowsSync(binding.sync) }
    }
    catch (error) {
      const message = `koffi failed to load: ${errorMessageFrom(error) ?? 'unknown error'}`
      return {
        run: () => {
          throw new Error(message)
        },
      }
    }
  }

  function getSampler(mode: WindowRectsMode, timeoutMs?: number): Promise<WindowRectsSampler> {
    // A custom timeout gets its own sampler, so it never changes the cached default one.
    let sampler = timeoutMs == null ? samplers.get(mode) : undefined
    if (!sampler) {
      sampler = createWalker(mode).then((walker) => {
        walkers.push(walker)
        return createWindowRectsSampler({
          mode,
          walker,
          ownProcessFilter,
          toDipRect: rect => params.screen.screenToDipRect(null, rect as Rectangle),
          timeoutMs,
        })
      })
      if (timeoutMs == null)
        samplers.set(mode, sampler)
    }
    return sampler
  }

  async function measure(options: { mode: WindowRectsMode, backToBack: number, paced: number, hz: number, baselineMs: number, timeoutMs?: number }): Promise<WindowRectsRun> {
    const sample = await getSampler(options.mode, options.timeoutMs)
    const run: WindowRectsRun = {
      mode: options.mode,
      startedAt: new Date().toISOString(),
      error: null,
      backToBack: [],
      paced: [],
      loopDelay: { baselineP99Ms: 0, pacedP99Ms: 0, deltaMs: 0 },
    }
    const record = (target: WindowRectsRunSample[], result: WindowRectsSample) => {
      run.error ??= result.error
      target.push(toRunSample(result))
    }

    for (let index = 0; index < options.backToBack; index++)
      record(run.backToBack, await sample())

    const baseline = monitorEventLoopDelay({ resolution: 1 })
    baseline.enable()
    await delay(options.baselineMs)
    baseline.disable()

    const sampled = monitorEventLoopDelay({ resolution: 1 })
    sampled.enable()
    await paced(options.paced, options.hz, async () => record(run.paced, await sample()))
    sampled.disable()

    run.loopDelay = { baselineP99Ms: p99Ms(baseline), pacedP99Ms: p99Ms(sampled), deltaMs: p99Ms(sampled) - p99Ms(baseline) }
    return run
  }

  async function memory(options: { mode: WindowRectsMode, durationMs: number, hz: number, everyMs: number }): Promise<WindowRectsMemoryPoint[]> {
    const sample = await getSampler(options.mode)
    const points: WindowRectsMemoryPoint[] = []
    const start = performance.now()
    const ticks = Math.floor(options.durationMs * options.hz / 1000)
    const ticksPerPoint = Math.max(1, Math.round(options.everyMs * options.hz / 1000))
    const point = () => {
      const usage = process.memoryUsage()
      points.push({ tMs: performance.now() - start, rss: usage.rss, heapUsed: usage.heapUsed, external: usage.external })
    }
    point()
    await paced(ticks, options.hz, async (index) => {
      await sample()
      if ((index + 1) % ticksPerPoint === 0)
        point()
    })
    return points
  }

  /** Opens a frameless AIRI window at DIP (200, 150, 640x480) on each display and reads it back through the walk. */
  async function dipProbe(options: { mode: WindowRectsMode }) {
    const sample = await getSampler(options.mode)
    const rows = []
    for (const display of params.screen.getAllDisplays()) {
      const expected = { x: display.bounds.x + 200, y: display.bounds.y + 150, width: 640, height: 480 }
      const probe = new params.BrowserWindow({ ...expected, frame: false, show: false, skipTaskbar: true, focusable: false, title: 'AIRI window-rects DIP probe' })
      try {
        await withTimeout(new Promise<void>((resolve) => {
          probe.once('show', () => resolve())
          probe.showInactive()
        }), 5000, () => {})
        // Let DWM compose the shown window before the walk reads its frame.
        await delay(250)
        const handle = probe.getNativeWindowHandle()
        const hwnd = `0x${(handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(16)}`
        const result = await sample({ includeOwnProcess: true })
        const found = result.windows.find(window => window.hwnd === hwnd) ?? null
        const errorDip = found
          ? Math.max(Math.abs(found.dipRect.x - expected.x), Math.abs(found.dipRect.y - expected.y), Math.abs(found.dipRect.width - expected.width), Math.abs(found.dipRect.height - expected.height))
          : null
        rows.push({ displayId: display.id, scaleFactor: display.scaleFactor, expected, found: found && { physicalRect: found.physicalRect, control: found.control, dipRect: found.dipRect, frameSource: found.frameSource }, errorDip, sampleError: result.error })
      }
      finally {
        probe.destroy()
      }
    }
    return rows
  }

  const api = {
    defaultMode,
    sample: async (mode?: WindowRectsMode, options?: { includeOwnProcess?: boolean }) => (await getSampler(mode ?? defaultMode))(options),
    measure,
    memory,
    dipProbe,
  }
  Reflect.set(globalThis, '__airiWindowRectsSpike', api)
  log.warn(`window-rect sensor spike enabled (default mode ${defaultMode}); drive it through globalThis.__airiWindowRectsSpike`)

  return () => {
    Reflect.deleteProperty(globalThis, '__airiWindowRectsSpike')
    for (const walker of walkers)
      walker.dispose?.()
  }
}
