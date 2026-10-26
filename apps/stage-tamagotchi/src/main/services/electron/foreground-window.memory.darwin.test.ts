import process from 'node:process'

import { EventEmitter } from 'node:events'
import { getHeapSpaceStatistics } from 'node:v8'

import { createContext, defineInvoke } from '@moeru/eventa'
import { electron } from '@proj-airi/electron-eventa'
import { describe, expect, it, vi } from 'vitest'

import { createForegroundWindowService } from './foreground-window'
import { createDarwinSampler, loadDarwinBinding } from './foreground-window-darwin'

// Opt-in diagnostic, not a default green regression gate. In the cold runs recorded in
// docs/ai/adr/2026-10-25-macos-foreground-sensor.md, 20 batches exceeded the 20 MiB bound
// (18 service, 2 native), peaking at +44,138,496 bytes. Keep the assertion and those
// failures visible; do not treat the default skipped run as a pass.

// Match the real-binding service suite: only Electron's process inventory is mocked.
vi.mock('electron', () => ({
  app: { getAppMetrics: () => [] },
}))

const path = process.env.AIRI_FOREGROUND_MEMORY_PATH
const enabled = process.platform === 'darwin' && (path === 'native' || path === 'service')
const MiB = 1024 * 1024

describe.runIf(enabled)('trusted Darwin foreground memory plateau', () => {
  it('plateaus over ten batches of 2000 real samples', async () => {
    // Run each path in a fresh process with --pool forks --execArgv=--expose-gc.
    const collect = globalThis.gc
    expect(typeof collect, 'explicit GC is required').toBe('function')
    if (!collect)
      return

    const binding = await loadDarwinBinding()
    expect(binding.isProcessTrusted(), 'Accessibility trust is required').toBe(1)
    const session = binding.readSession()
    expect(session?.onConsole, 'an unlocked console GUI is required').toBe(true)
    expect(session?.locked).not.toBe(true)
    console.info(`MEMORY_PRECONDITION=${JSON.stringify({ path, pid: process.pid, trusted: 1, session, node: process.version, execArgv: process.execArgv, collection: 'async major' })}`)

    const context = createContext()
    const window = new EventEmitter()
    if (path === 'service')
      createForegroundWindowService({ context: context as never, window: window as never })
    const read = path === 'service'
      ? defineInvoke(context, electron.foregroundWindow.sample)
      : createDarwinSampler(binding, pid => pid === process.pid)
    const rows: { readonly rss: number, readonly heapUsed: number, readonly external: number }[] = []
    const growth: number[] = []

    try {
      // Load the actual service binding before measuring, identically for both paths.
      expect((await read()) === null).toBe(false)
      await collect({ type: 'major', execution: 'async' })
      let before = process.memoryUsage()
      console.info(`MEMORY_BASELINE=${JSON.stringify({ path, ...before })}`)
      for (let batch = 1; batch <= 10; batch++) {
        let samples = 0
        let externalSamples = 0
        for (let index = 0; index < 2000; index++) {
          const sample = await read()
          if (sample !== null) {
            samples += 1
            if (!sample.ownProcess)
              externalSamples += 1
          }
        }
        const raw = process.memoryUsage()
        // Await collection itself, not a delay, so completed RPC microtasks can drain.
        await collect({ type: 'major', execution: 'async' })
        const after = process.memoryUsage()
        rows.push({ rss: after.rss, heapUsed: after.heapUsed, external: after.external })
        growth.push(raw.rss - before.rss)
        console.info(`MEMORY_BATCH=${JSON.stringify({
          path,
          batch,
          samples,
          externalSamples,
          before,
          raw,
          postGc: after,
          rawGrowthBytes: raw.rss - before.rss,
          postGcGrowthBytes: after.rss - before.rss,
          listeners: context.listeners.size,
          heapSpaces: getHeapSpaceStatistics().map(space => ({
            name: space.space_name,
            size: space.space_size,
            used: space.space_used_size,
          })),
        })}`)
        expect(samples).toBe(2000)
        expect(externalSamples, 'must sample an external app').toBe(2000)
        before = after
      }

      // Least-squares bytes/batch. Batches 1-2 are warm-up; 3-10 are the late fit.
      function slope(values: readonly number[]): number {
        const midpoint = (values.length - 1) / 2
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length
        let numerator = 0
        let denominator = 0
        for (const [index, value] of values.entries()) {
          numerator += (index - midpoint) * (value - mean)
          denominator += (index - midpoint) ** 2
        }
        return numerator / denominator
      }

      const slopes = (start: number, end: number) => ({
        rss: slope(rows.slice(start, end).map(row => row.rss)),
        heapUsed: slope(rows.slice(start, end).map(row => row.heapUsed)),
        external: slope(rows.slice(start, end).map(row => row.external)),
      })
      const warmup = slopes(0, 2)
      const late = slopes(2, 10)
      console.info(`MEMORY_SLOPES=${JSON.stringify({ path, units: 'bytes/batch', warmup, late, maxRawGrowthBytes: Math.max(...growth), originalBoundBytes: 20 * MiB })}`)
      expect(late.rss, 'late post-GC RSS slope').toBeLessThan(0.5 * MiB)
      expect(late.heapUsed, 'late post-GC heap slope').toBeLessThan(0.25 * MiB)
      expect(Math.max(...growth), 'original 20 MiB per 2000 samples bound').toBeLessThan(20 * MiB)
    }
    finally {
      window.emit('closed')
      console.info(`MEMORY_CLEANUP=${JSON.stringify({ path, windowListeners: window.eventNames().length })}`)
    }
  }, 180_000)
})
