import type { MotionQaState, ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'
import type { InferOutput } from 'valibot'

import { execFile } from 'node:child_process'
import { platform } from 'node:process'

import { boolean, finite, integer, minValue, nullable, number, parse, pipe, strictObject, string } from 'valibot'

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

/** A read-only query: no cursor, mouse-event, or application calls. */
export function pointerDesktopCommand(os: NodeJS.Platform = platform): { command: string, args: string[] } | null {
  return os === 'win32'
    ? { command: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = "Stop"\n${virtualScreenScript}\n$desktop | ConvertTo-Json -Compress`] }
    : null
}

export function parseVirtualScreenReceipt(stdout: string): VirtualScreen {
  return parse(VirtualScreenSchema, JSON.parse(stdout.trim()))
}

export function readPointerDesktop(): Promise<VirtualScreen> {
  const built = pointerDesktopCommand()
  if (!built)
    return Promise.reject(new Error('pointer-platform-unsupported: real pointer runs require Windows'))
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
 * Timed real Windows input. `startAtMs` is the host epoch corresponding to the renderer's scenario start.
 * Compilation time is included in timing error, never silently shifted out of the scenario.
 */
export function pointerScriptCommand(steps: readonly PointerStep[], startAtMs: number, os: NodeJS.Platform = platform): { command: string, args: string[] } | null {
  if (os !== 'win32')
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

/** Exit zero is insufficient: reject garbage, elevated foregrounds, partial playback, drift, and wrong final position. */
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
export function playPointer(steps: readonly PointerStep[], startAtMs: number, signal?: AbortSignal): Promise<PointerReceipt> {
  const built = pointerScriptCommand(steps, startAtMs)
  if (!built)
    return Promise.reject(new Error('pointer-platform-unsupported: real pointer runs require Windows'))
  return new Promise((resolve, reject) => {
    execFile(built.command, built.args, { signal, timeout: (steps.at(-1)?.tMs ?? 0) + 20_000, windowsHide: true }, (error, stdout, stderr) => {
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
  })
}
