import { describe, expect, it } from 'vitest'

import { parkCursorCommand, parseParkReceipt } from './cursor'

describe('parkCursorCommand', () => {
  it('builds a PowerShell SetCursorPos call that reports the Win32 error and the read-back position', () => {
    const built = parkCursorCommand(0, 12, 'win32')
    expect(built?.command).toBe('powershell')
    expect(built?.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    expect(built?.args[3]).toContain('[QaCursor]::SetCursorPos(0, 12)')
    expect(built?.args[3]).toContain('GetLastWin32Error')
    expect(built?.args[3]).toContain('GetCursorPos')
  })

  it('returns null on platforms without an implementation', () => {
    expect(parkCursorCommand(0, 0, 'linux')).toBeNull()
    expect(parkCursorCommand(0, 0, 'darwin')).toBeNull()
  })

  it('rejects non-integer coordinates', () => {
    expect(() => parkCursorCommand(0.5, 0, 'win32')).toThrow(/integers/)
  })
})

describe('parseParkReceipt', () => {
  const target = { x: 0, y: 0 }
  const receipt = (fields: Record<string, unknown>) => JSON.stringify({ ok: true, lastError: 0, x: 0, y: 0, foregroundPid: 42, foregroundName: 'electron', ...fields })

  it('passes only when SetCursorPos succeeded and the cursor reads back at the target', () => {
    expect(parseParkReceipt(receipt({}), target)).toMatchObject({ ok: true })
  })

  it('fails with the Win32 error and the foreground process when SetCursorPos returns false', () => {
    const result = parseParkReceipt(receipt({ ok: false, lastError: 5, x: -1281, y: 611, foregroundName: 'Taskmgr', foregroundPid: 7 }), target)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Win32 error 5/)
    expect(result.receipt).toContain('actual=-1281,611')
    expect(result.receipt).toContain('foreground=Taskmgr(7)')
  })

  it('fails when the call reports success but the cursor is elsewhere', () => {
    const result = parseParkReceipt(receipt({ x: -1281, y: 611 }), target)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/at -1281,611 after parking, not 0,0/)
  })

  it('fails when the command printed no parseable receipt, even after a zero exit', () => {
    expect(parseParkReceipt('', target)).toMatchObject({ ok: false })
    expect(parseParkReceipt('{"ok":true}', target)).toMatchObject({ ok: false })
  })
})
