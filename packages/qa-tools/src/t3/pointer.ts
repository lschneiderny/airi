import type { MotionQaState, ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'
import type { InferOutput } from 'valibot'

import type { ParkResult } from './cursor'
import type { KwinWindow, StageWindowMatch } from './pointer-kwin'

import { execFile } from 'node:child_process'
import { platform, env as processEnv } from 'node:process'

import { errorMessageFrom } from '@moeru/std'
import { boolean, finite, integer, minValue, nullable, number, parse, pipe, strictObject, string } from 'valibot'

import { parkCursor, parkedCursor } from './cursor'
import { kwinHelperCommand, matchStageWindow, parseKwinQuery, runKwinHelper } from './pointer-kwin'

/**
 * `windows` drives the real desktop cursor with user32. `kwin-eis` injects input into the `pnpm qa:display` KWin
 * session only; the user's own Linux desktop is never a pointer target.
 */
export type PointerBackend = 'windows' | 'kwin-eis'

export type PointerBackendSelection = { backend: PointerBackend } | { backend: null, reason: string }

export function selectPointerBackend(os: NodeJS.Platform = platform, env: Record<string, string | undefined> = processEnv): PointerBackendSelection {
  if (os === 'win32')
    return { backend: 'windows' }
  if (os === 'linux' && env.AIRI_QA_DISPLAY)
    return { backend: 'kwin-eis' }
  if (os === 'linux')
    return { backend: null, reason: 'pointer-platform-unsupported: on Linux, real pointer runs inject input only into the headless QA display; start the run with `pnpm qa:display run -- pnpm qa:motion t3 ...`' }
  return { backend: null, reason: 'pointer-platform-unsupported: real pointer runs require Windows, or Linux inside `pnpm qa:display run --`' }
}

function currentBackend(): PointerBackend | null {
  return selectPointerBackend().backend
}

function unsupportedReason(): string {
  const selection = selectPointerBackend()
  return selection.backend === null ? selection.reason : 'pointer-platform-unsupported'
}

/** Allows the host's 60 Hz cursor poll and pixel hit test to turn click-through off before pressing. */
export const pressDwellMs = 100

const VirtualScreenSchema = strictObject({
  x: pipe(number(), integer()),
  y: pipe(number(), integer()),
  width: pipe(number(), integer(), minValue(1)),
  height: pipe(number(), integer(), minValue(1)),
})
export type VirtualScreen = InferOutput<typeof VirtualScreenSchema>

/** The query and playback scripts read the same physical virtual-screen rectangle, without DPI virtualization. */
const virtualScreenScript = [
  'Add-Type @"',
  'using System.Runtime.InteropServices;',
  'public static class QaDesktop {',
  ' [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
  ' [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);',
  '}',
  '"@',
  '[void][QaDesktop]::SetProcessDPIAware()',
  '$desktop = @{ x = [QaDesktop]::GetSystemMetrics(76); y = [QaDesktop]::GetSystemMetrics(77); width = [QaDesktop]::GetSystemMetrics(78); height = [QaDesktop]::GetSystemMetrics(79) }',
].join('\n')

/** A read-only query: no cursor, mouse-event, or application calls. On KWin it reads the virtual output geometry. */
export function pointerDesktopCommand(backend: PointerBackend | null = currentBackend()): { command: string, args: string[] } | null {
  if (backend === 'windows')
    return { command: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = "Stop"\n${virtualScreenScript}\n$desktop | ConvertTo-Json -Compress`] }
  return backend === 'kwin-eis' ? kwinHelperCommand('query') : null
}

export function parseVirtualScreenReceipt(stdout: string): VirtualScreen {
  return parse(VirtualScreenSchema, JSON.parse(stdout.trim()))
}

export async function readPointerDesktop(backend: PointerBackend | null = currentBackend()): Promise<VirtualScreen> {
  if (backend === 'kwin-eis')
    return parse(VirtualScreenSchema, parseKwinQuery(await runKwinHelper('query')).screen)
  const built = pointerDesktopCommand(backend)
  if (!built)
    throw new Error(unsupportedReason())
  return new Promise((resolve, reject) => {
    execFile(built.command, built.args, { timeout: 20_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`pointer-desktop-query-failed: ${stderr.trim() || error.message}`))
        return
      }
      try {
        resolve(parseVirtualScreenReceipt(stdout))
      }
      catch (error) {
        reject(error)
      }
    })
  })
}

export interface PointerStep {
  tMs: number
  x: number
  y: number
  phase: 'move' | 'down' | 'up' | 'leave'
}

/**
 * The screen origin that maps the page's CSS pixels to pointer coordinates. Windows uses the renderer's DOM window
 * origin and device pixel ratio. Wayland gives every client 0,0 as its window origin, so the KWin backend reads the
 * stage window's client rectangle from KWin instead; KWin coordinates are logical pixels, so the ratio is 1.
 */
export async function resolvePointerScreen(
  backend: PointerBackend,
  screen: MotionQaState['screen'],
  page: { width: number, height: number },
  appPids: readonly number[],
): Promise<{ screen: MotionQaState['screen'], window?: StageWindowMatch, windows?: KwinWindow[] }> {
  if (backend === 'windows')
    return { screen }
  const { windows } = parseKwinQuery(await runKwinHelper('query'))
  const match = matchStageWindow(windows, appPids, page)
  return { screen: { x: match.window.client.x, y: match.window.client.y, devicePixelRatio: 1 }, window: match, windows }
}

/** Head-width offsets become physical screen pixels; negative monitor origins remain negative. */
export function pointerSteps(events: readonly ScenarioEvent[], state: MotionQaState, mirror: 'x' | 'y' | null = null): PointerStep[] {
  const head = state.head
  if (!head)
    throw new Error('pointer-head-unavailable: the loaded stage has no face-feature head unit')
  const screen = state.screen
  return events.flatMap(event => event.kind === 'pointer'
    ? [{
        tMs: Math.round(event.at * 1000),
        x: Math.round((screen.x + head.x + head.width / 2 + event.x * head.width * (mirror === 'x' ? -1 : 1)) * screen.devicePixelRatio),
        y: Math.round((screen.y + head.y + head.height / 2 + event.y * head.width * (mirror === 'y' ? -1 : 1)) * screen.devicePixelRatio),
        phase: event.phase,
      }]
    : [])
}

/**
 * Keeps a declared path when it fits. Otherwise mirrors the approach axis toward the virtual-screen center.
 * Every point (including later strokes, pokes, and leave targets) must fit; never clip or shorten a path.
 */
export function planPointerSteps(events: readonly ScenarioEvent[], state: MotionQaState, desktop: VirtualScreen): { steps: PointerStep[], mirrored: 'x' | 'y' | null } {
  const original = pointerSteps(events, state)
  const outside = (steps: readonly PointerStep[]) => steps.findIndex(step =>
    step.x < desktop.x || step.x >= desktop.x + desktop.width
    || step.y < desktop.y || step.y >= desktop.y + desktop.height)
  const invalid = outside(original)
  if (invalid < 0)
    return { steps: original, mirrored: null }
  const first = events.find(event => event.kind === 'pointer')
  const head = state.head
  if (!first || first.kind !== 'pointer' || !head)
    throw new Error('pointer-head-unavailable: cannot plan a pointer approach')
  const axis = Math.abs(first.x) >= Math.abs(first.y) ? 'x' : 'y'
  const center = axis === 'x'
    ? (state.screen.x + head.x + head.width / 2) * state.screen.devicePixelRatio
    : (state.screen.y + head.y + head.height / 2) * state.screen.devicePixelRatio
  const screenCenter = desktop[axis] + (axis === 'x' ? desktop.width : desktop.height) / 2
  const mirrored = pointerSteps(events, state, axis)
  const mirroredInvalid = outside(mirrored)
  if ((screenCenter - center) * -first[axis] > 0 && mirroredInvalid < 0)
    return { steps: mirrored, mirrored: axis }
  const point = original[invalid]
  throw new Error(`pointer-path-outside-virtual-screen: step #${invalid} at ${point.tMs} ms targets ${point.x},${point.y}; bounds=${JSON.stringify(desktop)}; ${axis}-mirror toward screen center cannot fit the full path (outside step #${mirroredInvalid})`)
}

/**
 * Timed real input. `startAtMs` is the host epoch corresponding to the renderer's scenario start.
 * Compilation and helper startup time are included in timing error, never silently shifted out of the scenario.
 * The KWin helper reads the same numeric table from stdin after a `<startAtMs> <pressDwellMs>` header line.
 */
export function pointerScriptCommand(steps: readonly PointerStep[], startAtMs: number, backend: PointerBackend | null = currentBackend()): { command: string, args: string[], input?: string } | null {
  if (backend === null)
    return null
  if (!Number.isSafeInteger(startAtMs) || steps.some((step, index) =>
    !Number.isSafeInteger(step.tMs) || step.tMs < 0
    || !Number.isSafeInteger(step.x) || !Number.isSafeInteger(step.y)
    || !['move', 'down', 'up', 'leave'].includes(step.phase)
    || (index > 0 && step.tMs < steps[index - 1].tMs))) {
    throw new Error('Invalid pointer script: expected sorted finite integer steps and an epoch origin')
  }
  // A compact numeric table keeps a 60 Hz scenario below Windows' command-line length limit.
  const table = steps.map(step => `${step.tMs},${step.x},${step.y},${['move', 'down', 'up', 'leave'].indexOf(step.phase)}`).join(';')
  if (backend === 'kwin-eis')
    return { ...kwinHelperCommand('play'), input: `${startAtMs} ${pressDwellMs}\n${table}` }
  const script = [
    '$ErrorActionPreference = "Stop"',
    virtualScreenScript,
    `$rows = ('${table}' -split ';' | Where-Object { $_ })`,
    // Recheck the live desktop before any input, in case monitor layout changed after the host planned the path.
    'foreach ($row in $rows) { $s = $row.Split(","); $x = [int]$s[1]; $y = [int]$s[2]; if ($x -lt $desktop.x -or $x -ge ($desktop.x + $desktop.width) -or $y -lt $desktop.y -or $y -ge ($desktop.y + $desktop.height)) { throw "pointer-path-outside-virtual-screen: $x,$y; bounds=$($desktop | ConvertTo-Json -Compress)" } }',
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public struct QaPoint { public int X; public int Y; }',
    'public static class QaPointer {',
    ' [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int x, int y);',
    ' [DllImport("user32.dll")] public static extern bool GetCursorPos(out QaPoint p);',
    ' [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);',
    ' [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    ' [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
    ' [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);',
    ' [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr token);',
    ' [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int returned);',
    ' [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);',
    ' public static bool Elevated(uint pid) {',
    '  var p = OpenProcess(0x1000, false, pid); if (p == IntPtr.Zero) throw new Exception("foreground-process-unreadable");',
    '  IntPtr token = IntPtr.Zero; try {',
    '   if (!OpenProcessToken(p, 8, out token)) throw new Exception("foreground-token-unreadable");',
    '   int value, returned; if (!GetTokenInformation(token, 20, out value, 4, out returned)) throw new Exception("foreground-elevation-unreadable");',
    '   return value != 0;',
    '  } finally { if (token != IntPtr.Zero) CloseHandle(token); CloseHandle(p); }',
    ' }',
    '}',
    '"@',
    '$fgPid = [uint32]0; [void][QaPointer]::GetWindowThreadProcessId([QaPointer]::GetForegroundWindow(), [ref]$fgPid)',
    '$fgName = (Get-Process -Id $fgPid -ErrorAction SilentlyContinue).ProcessName',
    '$elevated = [QaPointer]::Elevated($fgPid)',
    '$clock = [Diagnostics.Stopwatch]::StartNew()',
    `$origin = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - ${startAtMs}`,
    'function Wait-Time([double]$due) { while (($origin + $clock.Elapsed.TotalMilliseconds) -lt $due) { [Threading.Thread]::Sleep(1) } }',
    'function Move-To([int]$x, [int]$y) { if (![QaPointer]::SetCursorPos($x, $y)) { throw "pointer-set-position-failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" } }',
    '$played = 0; $maxError = 0.0',
    'try {',
    ' if (!$elevated) {',
    '  foreach ($row in $rows) {',
    '   $s = $row.Split(","); $due = [double]$s[0]; $x = [int]$s[1]; $y = [int]$s[2]; $phase = [int]$s[3]',
    `   if ($phase -eq 1) { Wait-Time ($due - ${pressDwellMs}); Move-To $x $y; $due = [Math]::Max($due, $origin + $clock.Elapsed.TotalMilliseconds + ${pressDwellMs}) }`,
    '   Wait-Time $due; Move-To $x $y',
    '   if ($phase -eq 1) { [QaPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero) }',
    '   if ($phase -eq 2) { [QaPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }',
    '   $maxError = [Math]::Max($maxError, [Math]::Abs($origin + $clock.Elapsed.TotalMilliseconds - [double]$s[0])); $played++',
    '  }',
    ' }',
    '} finally { [QaPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }',
    '$p = New-Object QaPoint; if (![QaPointer]::GetCursorPos([ref]$p)) { throw "pointer-read-position-failed" }',
    '@{ played = $played; maxTimingErrorMs = $maxError; x = $p.X; y = $p.Y; foregroundPid = $fgPid; foregroundName = $fgName; foregroundElevated = $elevated; desktop = $desktop } | ConvertTo-Json -Compress',
  ].join('\n')
  return { command: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', script] }
}

const PointerReceiptSchema = strictObject({
  played: pipe(number(), integer(), minValue(0)),
  maxTimingErrorMs: pipe(number(), finite(), minValue(0)),
  x: pipe(number(), integer()),
  y: pipe(number(), integer()),
  foregroundPid: pipe(number(), integer(), minValue(0)),
  foregroundName: nullable(string()),
  foregroundElevated: boolean(),
  desktop: VirtualScreenSchema,
})
export type PointerReceipt = InferOutput<typeof PointerReceiptSchema>

/**
 * Exit zero is insufficient: reject garbage, elevated foregrounds, partial playback, drift, and wrong final position.
 * The KWin helper reads the cursor back from KWin; Linux has no elevated foreground, so it always reports false.
 */
export function parsePointerReceipt(stdout: string, steps: readonly PointerStep[]): PointerReceipt {
  const receipt = parse(PointerReceiptSchema, JSON.parse(stdout.trim()))
  if (receipt.foregroundElevated)
    throw new Error(`pointer-foreground-elevated: ${receipt.foregroundName}(${receipt.foregroundPid}); receipt=${stdout.trim()}`)
  if (receipt.played !== steps.length)
    throw new Error(`pointer-incomplete: played ${receipt.played} of ${steps.length}; receipt=${stdout.trim()}`)
  if (receipt.maxTimingErrorMs > 500)
    throw new Error(`pointer-timing-error: ${receipt.maxTimingErrorMs} ms exceeds 500 ms; receipt=${stdout.trim()}`)
  const last = steps.at(-1)
  if (last && (receipt.x !== last.x || receipt.y !== last.y))
    throw new Error(`pointer-final-position: ${receipt.x},${receipt.y}, expected ${last.x},${last.y}; receipt=${stdout.trim()}`)
  return receipt
}

/** The AbortSignal terminates only the child this call starts; the caller releases input and parks in finally. */
export function playPointer(steps: readonly PointerStep[], startAtMs: number, signal?: AbortSignal, backend: PointerBackend | null = currentBackend()): Promise<PointerReceipt> {
  const built = pointerScriptCommand(steps, startAtMs, backend)
  if (!built)
    return Promise.reject(new Error(unsupportedReason()))
  return new Promise((resolve, reject) => {
    const child = execFile(built.command, built.args, { signal, timeout: (steps.at(-1)?.tMs ?? 0) + 20_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`pointer-command-failed: ${stderr.trim() || error.message}`))
        return
      }
      try {
        resolve(parsePointerReceipt(stdout, steps))
      }
      catch (error) {
        reject(error)
      }
    })
    child.stdin?.end(built.input ?? '')
  })
}

/**
 * Parks the cursor before and after a pointer run. On KWin the session cursor starts at the output center, where
 * KWin also centers the stage window, so an unparked cursor would sit on the character before the approach starts.
 * Parking there is one absolute EIS move, read back from KWin.
 */
export async function parkPointer(backend: PointerBackend): Promise<ParkResult> {
  if (backend === 'windows')
    return await parkCursor()
  const target = { x: parkedCursor.x, y: parkedCursor.y }
  try {
    const stdout = await runKwinHelper('play', { input: `${Date.now()} ${pressDwellMs}\n0,${target.x},${target.y},0` })
    const receipt = parse(PointerReceiptSchema, JSON.parse(stdout.trim()))
    const text = `park target=${target.x},${target.y} actual=${receipt.x},${receipt.y} foreground=${receipt.foregroundName ?? 'unknown'}(${receipt.foregroundPid})`
    return receipt.x === target.x && receipt.y === target.y
      ? { ok: true, receipt: text }
      : { ok: false, reason: `the cursor is at ${receipt.x},${receipt.y} after parking, not ${target.x},${target.y}; ${text}`, receipt: text }
  }
  catch (error) {
    const message = errorMessageFrom(error) ?? 'the KWin park command failed'
    return { ok: false, reason: message, receipt: message }
  }
}
