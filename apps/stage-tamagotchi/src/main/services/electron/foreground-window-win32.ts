import type { ForegroundNotificationState, ForegroundWindowSample } from '@proj-airi/electron-eventa'

import { Buffer } from 'node:buffer'
import { win32 } from 'node:path'

/**
 * Opaque Win32 `HWND`/`HANDLE` as koffi returns it (a bigint address for `void *` results).
 * The null handle is falsy (`null` or `0n`). Handles never leave this module.
 */
type Win32Handle = unknown

interface Win32Binding {
  GetForegroundWindow: () => Win32Handle
  GetWindowTextLengthW: (hwnd: Win32Handle) => number
  GetWindowTextW: (hwnd: Win32Handle, buffer: Buffer, maxCount: number) => number
  GetWindowThreadProcessId: (hwnd: Win32Handle, processId: [number]) => number
  OpenProcess: (desiredAccess: number, inheritHandle: number, processId: number) => Win32Handle
  QueryFullProcessImageNameW: (process: Win32Handle, flags: number, buffer: Buffer, size: [number]) => number
  CloseHandle: (handle: Win32Handle) => number
  SHQueryUserNotificationState: (state: [number]) => number
}

// Win32 BOOL is a 4-byte int, so BOOL arguments and results are declared as `int`, not koffi's 1-byte `bool`.
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

/**
 * Longest title read, in UTF-16 code units. Consumers cut titles far shorter before a
 * prompt; the cap only bounds the read buffer against windows with unbounded titles.
 */
const TITLE_MAX_UNITS = 1024

/** Longest Win32 path (`\\?\` long path form), in UTF-16 code units. */
const PATH_MAX_UNITS = 32767

/** QUERY_USER_NOTIFICATION_STATE values 1..7 (shellapi.h) in declaration order. */
const NOTIFICATION_STATES: readonly ForegroundNotificationState[] = ['not-present', 'busy', 'd3d-fullscreen', 'presentation', 'accepts', 'quiet-time', 'app']

export async function loadWin32Binding(): Promise<Win32Binding> {
  const { load } = await import('koffi')
  const user32 = load('user32.dll')
  const kernel32 = load('kernel32.dll')
  const shell32 = load('shell32.dll')

  return {
    GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
    GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(void *hWnd)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hWnd, _Out_ uint16_t *lpString, int nMaxCount)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)'),
    OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)'),
    QueryFullProcessImageNameW: kernel32.func('int __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, _Out_ uint16_t *lpExeName, _Inout_ uint32_t *lpdwSize)'),
    CloseHandle: kernel32.func('int __stdcall CloseHandle(void *hObject)'),
    SHQueryUserNotificationState: shell32.func('int32_t __stdcall SHQueryUserNotificationState(_Out_ int32_t *pquns)'),
  }
}

/** Decodes `units` UTF-16LE code units, dropping a high surrogate whose pair the read cap cut off. */
function decodeUtf16(buffer: Buffer, units: number): string {
  return buffer.toString('utf16le', 0, units * 2).replace(/[\uD800-\uDBFF]$/u, '')
}

/**
 * Builds the Win32 sampler over a loaded binding.
 *
 * Expects:
 * - `isOwnProcess` answers whether a pid belongs to AIRI itself; the caller owns that policy
 *   (own pid, Electron processes, the stage sidecar), so this module needs no Electron access
 */
export function createWin32Sampler(binding: Win32Binding, isOwnProcess: (pid: number) => boolean) {
  // Buffers are reused across reads. Every FFI call below is synchronous, so two
  // invokes can never interleave inside one read.
  const titleBuffer = Buffer.alloc((TITLE_MAX_UNITS + 1) * 2)
  const pathBuffer = Buffer.alloc((PATH_MAX_UNITS + 1) * 2)

  function readTitle(hwnd: Win32Handle): string {
    const length = binding.GetWindowTextLengthW(hwnd)
    if (length <= 0)
      return ''
    // The window can rename or close between the two calls; the copied count is the truth.
    const copied = binding.GetWindowTextW(hwnd, titleBuffer, Math.min(length, TITLE_MAX_UNITS) + 1)
    return copied > 0 ? decodeUtf16(titleBuffer, copied) : ''
  }

  function readExePath(pid: number): string | null {
    const processHandle = binding.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
    // Elevated or protected processes refuse even the limited query.
    if (!processHandle)
      return null
    try {
      const size: [number] = [PATH_MAX_UNITS + 1]
      if (binding.QueryFullProcessImageNameW(processHandle, 0, pathBuffer, size) === 0)
        return null
      return decodeUtf16(pathBuffer, size[0]) || null
    }
    finally {
      binding.CloseHandle(processHandle)
    }
  }

  function readNotificationState(): ForegroundNotificationState | null {
    const state: [number] = [0]
    if (binding.SHQueryUserNotificationState(state) !== 0)
      return null
    return NOTIFICATION_STATES[state[0] - 1] ?? null
  }

  return function sample(): ForegroundWindowSample | null {
    const hwnd = binding.GetForegroundWindow()
    // No focused window: lock screen, secure desktop, or a focus change in progress.
    if (!hwnd)
      return null

    const processId: [number] = [0]
    // A zero thread id means the window closed after GetForegroundWindow returned it.
    if (binding.GetWindowThreadProcessId(hwnd, processId) === 0 || processId[0] === 0)
      return null

    const pid = processId[0]
    const exePath = readExePath(pid)
    return {
      exePath,
      exeName: exePath == null ? null : win32.basename(exePath),
      title: readTitle(hwnd),
      pid,
      ownProcess: isOwnProcess(pid),
      notificationState: readNotificationState(),
      sampledAtMs: Date.now(),
    }
  }
}
