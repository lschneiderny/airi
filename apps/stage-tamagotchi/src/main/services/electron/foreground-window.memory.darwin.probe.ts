import assert from 'node:assert/strict'
import process from 'node:process'

import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { promisify } from 'node:util'
import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8'

import { errorMessageFrom } from '@moeru/std'

async function main() {
  const path = process.env.AIRI_FOREGROUND_MEMORY_PATH
  assert(path === 'native' || path === 'service' || path === 'service-control', 'choose native, service, or service-control')
  const serviceUrl = new URL('./foreground-window.ts', import.meta.url).href
  const bindingUrl = new URL('./foreground-window-darwin.ts', import.meta.url).href
  // The control keeps the actual dispatcher, loader and Eventa endpoints. Only
  // the service's sampler factory returns a null reader, without native calls.
  const controlUrl = `data:text/javascript,${encodeURIComponent(`
    export { loadDarwinBinding } from ${JSON.stringify(bindingUrl)};
    export const createDarwinSampler = () => () => null;
  `)}`
  // Plain Node removes Vitest's transform, mock, assertion, and worker machinery.
  // These hooks resolve the existing extensionless TS sources and replace only
  // Electron's process inventory, exactly as the real-binding service suite does.
  const electronStub = 'data:text/javascript,export const app = { getAppMetrics: () => [] }'
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'electron')
        return { url: electronStub, shortCircuit: true }
      if (path === 'service-control' && context.parentURL === serviceUrl && specifier === './foreground-window-darwin')
        return { url: controlUrl, shortCircuit: true }
      if (specifier.startsWith('.') && context.parentURL) {
        for (const suffix of ['.ts', '/index.ts']) {
          const url = new URL(specifier + suffix, context.parentURL)
          if (existsSync(url))
            return nextResolve(url.href, context)
        }
      }
      return nextResolve(specifier, context)
    },
  })

  const { createContext, defineInvoke } = await import('@moeru/eventa')
  const { electron } = await import('@proj-airi/electron-eventa')
  const { createForegroundWindowService } = await import('./foreground-window')
  const { createDarwinSampler, loadDarwinBinding } = await import('./foreground-window-darwin')
  assert.equal(process.platform, 'darwin')
  const collect = globalThis.gc
  assert.equal(typeof collect, 'function', 'launch node --expose-gc')
  if (!collect)
    throw new TypeError('Explicit GC is required')

  const binding = await loadDarwinBinding()
  assert.equal(binding.isProcessTrusted(), 1, 'Accessibility trust is required')
  const session = binding.readSession()
  assert.equal(session?.onConsole, true, 'console GUI is required')
  assert.notEqual(session?.locked, true, 'unlocked GUI is required')
  console.info(`PROBE_PRECONDITION=${JSON.stringify({ path, pid: process.pid, trusted: 1, session, node: process.version, execArgv: process.execArgv, nativeSamplerEnabled: path !== 'service-control' })}`)

  const context = createContext()
  const window = new EventEmitter()
  if (path !== 'native')
    createForegroundWindowService({ context: context as never, window: window as never })
  const read = path !== 'native'
    ? defineInvoke(context, electron.foregroundWindow.sample)
    : createDarwinSampler(binding, pid => pid === process.pid)

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

  function memory() {
    const newSpace = getHeapSpaceStatistics().find(space => space.space_name === 'new_space')
    assert(newSpace, 'V8 must expose new_space statistics')
    return {
      ...process.memoryUsage(),
      v8PhysicalBytes: getHeapStatistics().total_physical_size,
      newSpace: {
        size: newSpace.space_size,
        used: newSpace.space_used_size,
        physical: newSpace.physical_space_size,
      },
    }
  }

  const runVmmap = promisify(execFile)
  async function captureVm(stage: string) {
    if (process.env.AIRI_FOREGROUND_MEMORY_VM !== '1')
      return
    try {
      const { stdout } = await runVmmap('/usr/bin/vmmap', ['-summary', String(process.pid)])
      console.info(`PROBE_VM=${JSON.stringify({ path, stage, stdout })}`)
    }
    catch (error) {
      console.info(`PROBE_VM_ERROR=${JSON.stringify({ path, stage, error: errorMessageFrom(error) })}`)
      process.exitCode = 1
    }
  }

  try {
    assert.equal((await read()) === null, path === 'service-control', 'control must return null; active path must return a sample')
    await captureVm('initialized')
    await collect({ type: 'major', execution: 'async' })
    let before = memory()
    console.info(`PROBE_BASELINE=${JSON.stringify({ path, ...before })}`)
    // Three consecutive 20k epochs show whether a failed first fit stabilizes.
    // All failures remain failures; subsequent epochs never overwrite the first.
    for (let epoch = 1; epoch <= 3; epoch++) {
      const rows: ReturnType<typeof memory>[] = []
      const growth: number[] = []
      for (let batch = 1; batch <= 10; batch++) {
        let samples = 0
        let externalSamples = 0
        let nullSamples = 0
        for (let index = 0; index < 2000; index++) {
          const sample = await read()
          if (sample !== null) {
            samples += 1
            if (!sample.ownProcess)
              externalSamples += 1
          }
          else {
            nullSamples += 1
          }
        }
        const raw = memory()
        await collect({ type: 'major', execution: 'async' })
        const after = memory()
        rows.push(after)
        growth.push(raw.rss - before.rss)
        console.info(`PROBE_BATCH=${JSON.stringify({
          path,
          epoch,
          batch,
          samples,
          externalSamples,
          nullSamples,
          before,
          raw,
          postGc: after,
          rawGrowthBytes: raw.rss - before.rss,
          postGcGrowthBytes: after.rss - before.rss,
          listeners: context.listeners.size,
        })}`)
        assert.equal(samples, path === 'service-control' ? 0 : 2000)
        assert.equal(nullSamples, path === 'service-control' ? 2000 : 0)
        assert.equal(externalSamples, samples, 'all active samples must identify an external app')
        before = after
      }
      const slopes = (start: number, end: number) => ({
        rss: slope(rows.slice(start, end).map(row => row.rss)),
        heapUsed: slope(rows.slice(start, end).map(row => row.heapUsed)),
        external: slope(rows.slice(start, end).map(row => row.external)),
        heapTotal: slope(rows.slice(start, end).map(row => row.heapTotal)),
        v8PhysicalBytes: slope(rows.slice(start, end).map(row => row.v8PhysicalBytes)),
        rssLessV8Physical: slope(rows.slice(start, end).map(row => row.rss - row.v8PhysicalBytes)),
      })
      const warmup = slopes(0, 2)
      const late = slopes(2, 10)
      const maxRawGrowthBytes = Math.max(...growth)
      const pass = late.rss < 0.5 * 1024 * 1024
        && late.heapUsed < 0.25 * 1024 * 1024
        && maxRawGrowthBytes < 20 * 1024 * 1024
      console.info(`PROBE_SLOPES=${JSON.stringify({ path, epoch, units: 'bytes/batch', warmup, late, maxRawGrowthBytes, originalBoundBytes: 20 * 1024 * 1024, pass })}`)
      if (!pass)
        process.exitCode = 1
      // The sampler is quiescent here; compare live allocator totals at the
      // same completed-call boundary, not arbitrary mid-batch snapshots.
      await captureVm(`epoch-${epoch}`)
    }
  }
  finally {
    window.emit('closed')
    console.info(`PROBE_CLEANUP=${JSON.stringify({ path, windowListeners: window.eventNames().length, contextListeners: context.listeners.size, activeListeners: [...context.listeners.values()].reduce((count, handlers) => count + handlers.size, 0) })}`)
    context.abort()
    hooks.deregister()
  }
}

main().catch((error: unknown) => {
  console.error(errorMessageFrom(error) ?? 'Memory probe failed')
  process.exitCode = 1
})
