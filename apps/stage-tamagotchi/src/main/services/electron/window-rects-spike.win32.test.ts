import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { createWindowRectsSampler, loadWindowRectsBinding, walkWindowsSync } from './window-rects-spike'

const SM_XVIRTUALSCREEN = 76
const SM_YVIRTUALSCREEN = 77
const SM_CXVIRTUALSCREEN = 78
const SM_CYVIRTUALSCREEN = 79

// Electron is not running under Vitest, so `screen.screenToDipRect` is unavailable: the test keeps
// physical pixels (identity conversion) and checks them against the virtual screen, the union of
// every display's bounds in physical pixels.
describe.runIf(process.platform === 'win32')('window-rects spike with the real Win32 binding', () => {
  it('samples visible top-level windows that lie on the virtual screen', async () => {
    const { load } = await import('koffi')
    const getSystemMetrics = load('user32.dll').func('int __stdcall GetSystemMetrics(int nIndex)') as (index: number) => number
    const screen = {
      left: getSystemMetrics(SM_XVIRTUALSCREEN),
      top: getSystemMetrics(SM_YVIRTUALSCREEN),
      right: getSystemMetrics(SM_XVIRTUALSCREEN) + getSystemMetrics(SM_CXVIRTUALSCREEN),
      bottom: getSystemMetrics(SM_YVIRTUALSCREEN) + getSystemMetrics(SM_CYVIRTUALSCREEN),
    }
    const binding = await loadWindowRectsBinding()
    const sample = createWindowRectsSampler({
      mode: 'main',
      walker: { run: () => walkWindowsSync(binding.sync) },
      ownProcessFilter: () => pid => pid === process.pid,
      toDipRect: rect => rect,
    })

    const result = await sample()

    expect(result.error).toBeNull()
    expect(result.kept).toBeGreaterThan(0)
    for (const window of result.windows) {
      // A window can hang partly off-screen, so the check is overlap, not containment.
      expect(window.dipRect.x).toBeLessThan(screen.right)
      expect(window.dipRect.y).toBeLessThan(screen.bottom)
      expect(window.dipRect.x + window.dipRect.width).toBeGreaterThan(screen.left)
      expect(window.dipRect.y + window.dipRect.height).toBeGreaterThan(screen.top)
    }
  })
})
