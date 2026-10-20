import { execFile } from 'node:child_process'
import { platform } from 'node:process'

import { errorMessageFrom } from '@moeru/std'
import { boolean, finite, looseObject, nullable, number, pipe, safeParse, string } from 'valibot'

/** Where the harness parks the OS cursor: the top-left pixel of the primary monitor, away from the stage window. */
export const parkedCursor = { x: 0, y: 0 } as const

/**
 * Builds the command that parks the OS cursor with user32 `SetCursorPos` and prints one JSON receipt: the call's
 * result, `GetLastWin32Error`, the position read back with `GetCursorPos`, and the foreground window's process (a
 * foreground window of a more privileged process makes `SetCursorPos` fail). `null` on platforms without an
 * implementation (the harness then warns and relies on `cursorAttention: false`).
 */
export function parkCursorCommand(x: number, y: number, os: NodeJS.Platform = platform): { command: string, args: string[] } | null {
  if (!Number.isInteger(x) || !Number.isInteger(y))
    throw new Error(`Cursor coordinates must be integers, got ${x},${y}`)
  if (os !== 'win32')
    return null
  const script = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public struct QaPoint { public int X; public int Y; }',
    'public static class QaCursor {',
    '  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll", SetLastError = true)] public static extern bool GetCursorPos(out QaPoint p);',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);',
    '}',
    '"@',
    `$ok = [QaCursor]::SetCursorPos(${x}, ${y})`,
    '$lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()',
    '$p = New-Object QaPoint; [void][QaCursor]::GetCursorPos([ref]$p)',
    '$fgPid = [uint32]0; [void][QaCursor]::GetWindowThreadProcessId([QaCursor]::GetForegroundWindow(), [ref]$fgPid)',
    '$fgName = (Get-Process -Id $fgPid -ErrorAction SilentlyContinue).ProcessName',
    '@{ ok = $ok; lastError = $lastError; x = $p.X; y = $p.Y; foregroundPid = $fgPid; foregroundName = $fgName } | ConvertTo-Json -Compress',
  ].join('\n')
  return { command: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command', script] }
}

const ParkOutputSchema = looseObject({
  ok: boolean(),
  x: pipe(number(), finite()),
  y: pipe(number(), finite()),
  lastError: pipe(number(), finite()),
  foregroundPid: pipe(number(), finite()),
  foregroundName: nullable(string()),
})

export interface ParkResult {
  ok: boolean
  /** Why parking failed; set only when `ok` is false. */
  reason?: string
  /** The requested and the read-back position, the Win32 error, and the foreground process. */
  receipt: string
}

/**
 * Reads the receipt `parkCursorCommand` prints. Parking succeeded only when `SetCursorPos` returned true and the
 * position read back is the requested one; a zero process exit alone proves nothing.
 */
export function parseParkReceipt(stdout: string, target: { x: number, y: number }): ParkResult {
  let json: unknown
  try {
    json = JSON.parse(stdout.trim())
  }
  catch {
    return { ok: false, reason: `the park command printed no receipt: ${stdout.trim() || '(empty)'}`, receipt: stdout.trim() }
  }
  const parsed = safeParse(ParkOutputSchema, json)
  if (!parsed.success)
    return { ok: false, reason: `the park receipt is malformed: ${stdout.trim()}`, receipt: stdout.trim() }
  const { ok: setOk, x, y, lastError, foregroundPid, foregroundName } = parsed.output
  const receipt = `park target=${target.x},${target.y} ok=${setOk} lastError=${lastError} actual=${x},${y} foreground=${foregroundName ?? 'unknown'}(${foregroundPid})`
  if (!setOk)
    return { ok: false, reason: `SetCursorPos failed (Win32 error ${lastError}${lastError === 5 ? ', access denied: the foreground window may belong to an elevated process or the input desktop is locked' : ''}); ${receipt}`, receipt }
  if (x !== target.x || y !== target.y)
    return { ok: false, reason: `the cursor is at ${x},${y} after parking, not ${target.x},${target.y}; ${receipt}`, receipt }
  return { ok: true, receipt }
}

/** Parks the OS cursor. Resolves `ok: true` with a warning on platforms without an implementation; never claims success it cannot read back. */
export function parkCursor(x: number = parkedCursor.x, y: number = parkedCursor.y): Promise<ParkResult> {
  const built = parkCursorCommand(x, y)
  if (!built)
    return Promise.resolve({ ok: true, receipt: `warning: cursor parking is not implemented on ${platform}; cursor attention is off instead` })
  return new Promise((resolvePark) => {
    execFile(built.command, built.args, { timeout: 20_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error)
        resolvePark({ ok: false, reason: `the park command failed: ${stderr.trim() || (errorMessageFrom(error) ?? 'unknown error')}`, receipt: `${stdout}${stderr}`.trim() })
      else
        resolvePark(parseParkReceipt(stdout, { x, y }))
    })
  })
}
