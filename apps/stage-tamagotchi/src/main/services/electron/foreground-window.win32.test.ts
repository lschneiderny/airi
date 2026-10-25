import process from 'node:process'

import { createContext, defineInvoke } from '@moeru/eventa'
import { electron } from '@proj-airi/electron-eventa'
import { describe, expect, it, vi } from 'vitest'

import { createForegroundWindowService } from './foreground-window'

// Electron itself is not running under Vitest; koffi and the Win32 calls are real.
vi.mock('electron', () => ({
  app: {
    getAppMetrics: () => [],
  },
}))

const busyStates = ['accepts', 'busy', 'fullscreen', 'presentation', 'quiet', null]

describe.runIf(process.platform === 'win32')('createForegroundWindowService with the real Win32 binding', () => {
  it('returns a sample or null without throwing, across many reads', async () => {
    // A test process has no guaranteed foreground window (CI, a locked desktop), so null is valid.
    const context = createContext()
    createForegroundWindowService({ context: context as never, window: { once: vi.fn() } as never })
    const read = defineInvoke(context, electron.foregroundWindow.sample)

    for (let i = 0; i < 50; i++) {
      const sample = await read()
      if (sample == null)
        continue

      expect(sample.pid).toBeGreaterThan(0)
      expect(typeof sample.title).toBe('string')
      expect(busyStates).toContain(sample.busy)
      if (sample.exePath != null)
        expect(sample.exePath.endsWith(sample.exeName ?? '')).toBe(true)
    }
  })
})
