import type { PerformanceEntry } from 'node:perf_hooks'

import assert from 'node:assert/strict'
import process from 'node:process'

import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { PerformanceObserver } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { getHeapStatistics } from 'node:v8'

import { errorMessageFrom } from '@moeru/std'

async function main() {
  // Keep the same real-service boundary as the earlier plain-Node measurements.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'electron')
        return { url: 'data:text/javascript,export const app = { getAppMetrics: () => [] }', shortCircuit: true }
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
  const { loadDarwinBinding } = await import('./foreground-window-darwin')
  assert.equal(process.platform, 'darwin')
  const collect = globalThis.gc
  assert(collect, 'launch node --expose-gc')
  const binding = await loadDarwinBinding()

  const context = createContext()
  const window = new EventEmitter()
  createForegroundWindowService({ context: context as never, window: window as never })
  const read = defineInvoke(context, electron.foregroundWindow.sample)
  const memory = () => ({ ...process.memoryUsage(), v8PhysicalBytes: getHeapStatistics().total_physical_size })
  const durations: number[] = []
  const intervals: number[] = []
  const gc = { count: 0, totalDurationMs: 0, maxDurationMs: 0 }
  let startedAt = Number.POSITIVE_INFINITY
  let endedAt = Number.POSITIVE_INFINITY
  function recordGc(entries: readonly PerformanceEntry[]) {
    for (const entry of entries) {
      if (entry.startTime < startedAt || entry.startTime > endedAt)
        continue
      gc.count += 1
      gc.totalDurationMs += entry.duration
      gc.maxDurationMs = Math.max(gc.maxDurationMs, entry.duration)
    }
  }
  const observer = new PerformanceObserver(list => recordGc(list.getEntries()))
  observer.observe({ entryTypes: ['gc'] })
  let timer: ReturnType<typeof setInterval> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let interrupt = () => {}
  let calls = 0
  let nonNull = 0
  let externalSamples = 0
  let guiFailures = 0
  let skippedTicks = 0
  let inFlight = false
  let previousStart: number | undefined
  let failure: string | undefined

  function checkGui(stage: string) {
    const trusted = binding.isProcessTrusted()
    const session = binding.readSession()
    if (trusted !== 1 || session?.onConsole !== true || session.locked === true) {
      guiFailures += 1
      console.info(`CADENCE_PREREQUISITE_FAILURE=${JSON.stringify({ stage, calls, trusted, session })}`)
      throw new Error('Trusted unlocked GUI prerequisite failed')
    }
    return { trusted, session }
  }

  async function readKeepAwake() {
    // caffeinate utility mode execs Node and owns a child assertion process.
    const { stdout: children } = await promisify(execFile)('/usr/bin/pgrep', ['-P', String(process.pid), '-x', 'caffeinate'])
    const childPids = children.trim().split('\n').map(Number)
    assert.equal(childPids.length, 1, 'exactly one owned caffeinate child is required')
    const pid = childPids[0]
    assert(pid !== undefined && Number.isSafeInteger(pid) && pid > 0, 'owned caffeinate PID is required')
    const { stdout } = await promisify(execFile)('/usr/bin/pmset', ['-g', 'assertions'])
    // Inspect only the owned launcher, never dump other apps' assertion labels.
    const owned = stdout.split('\n').filter(line => line.includes(`pid ${pid}(caffeinate)`))
    const assertionTypes = ['PreventUserIdleDisplaySleep', 'PreventUserIdleSystemSleep'].filter(type => owned.some(line => line.includes(type)))
    console.info(`CADENCE_KEEP_AWAKE=${JSON.stringify({ utilityPid: process.pid, pid, assertionTypes })}`)
    assert.equal(assertionTypes.length, 2, 'launch with owned caffeinate -d -i')
    return { pid, assertionTypes }
  }

  let keepAwakeProcess: Awaited<ReturnType<typeof readKeepAwake>> | undefined
  try {
    const initialGui = checkGui('before-baseline')
    const keepAwake = await readKeepAwake()
    keepAwakeProcess = keepAwake
    // Do not invoke the service before the baseline: its first read stays cold.
    await collect({ type: 'major', execution: 'async' })
    const before = memory()
    let maxRss = before.rss
    startedAt = performance.now()
    console.info(`CADENCE_PRECONDITION=${JSON.stringify({
      pid: process.pid,
      node: process.version,
      startedAtIso: new Date().toISOString(),
      ...initialGui,
      keepAwake,
      cadenceMs: 1000,
      targetInvokes: 2000,
      forcedGcBefore: 1,
      forcedGcDuring: 0,
      before,
    })}`)

    async function sampleOne() {
      process.kill(keepAwake.pid, 0)
      const { trusted, session } = checkGui('before-invoke')
      const started = performance.now()
      if (previousStart !== undefined)
        intervals.push(started - previousStart)
      previousStart = started
      const sample = await read()
      durations.push(performance.now() - started)
      calls += 1
      if (sample === null)
        throw new Error('Real foreground service returned null; cadence coverage invalid')
      nonNull += 1
      if (!sample.ownProcess)
        externalSamples += 1
      const usage = memory()
      maxRss = Math.max(maxRss, usage.rss)
      if (calls % 100 === 0) {
        console.info(`CADENCE_CHECKPOINT=${JSON.stringify({ calls, nonNull, externalSamples, elapsedMs: performance.now() - startedAt, memory: usage, maxRss, gc, trusted, session })}`)
      }
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false
      function finish(error?: unknown) {
        if (settled)
          return
        settled = true
        clearInterval(timer)
        clearTimeout(deadline)
        if (error === undefined)
          resolve()
        else
          reject(error)
      }
      interrupt = () => finish(new Error('Cadence measurement interrupted'))
      process.once('SIGINT', interrupt)
      process.once('SIGTERM', interrupt)
      // Cadence itself is under test. Timer events, not sleeps or a tight loop,
      // schedule reads, and the guard prevents concurrent or catch-up invokes.
      timer = setInterval(() => {
        if (inFlight) {
          skippedTicks += 1
          return
        }
        inFlight = true
        void sampleOne().then(() => {
          inFlight = false
          if (calls === 2000)
            finish()
        }, (error: unknown) => {
          inFlight = false
          finish(error)
        })
      }, 1000)
      deadline = setTimeout(() => finish(new Error('Cadence measurement exceeded 38 minutes')), 38 * 60 * 1000)
    }).catch((error: unknown) => {
      failure = errorMessageFrom(error) ?? 'Cadence measurement failed'
    })
    endedAt = performance.now()
    recordGc(observer.takeRecords())
    const raw = memory()
    await collect({ type: 'major', execution: 'async' })
    recordGc(observer.takeRecords())
    const postGc = memory()
    if (failure === undefined) {
      try {
        checkGui('after-sampling')
        assert.equal((await readKeepAwake()).pid, keepAwake.pid, 'owned assertion process must not change')
      }
      catch (error) {
        failure = errorMessageFrom(error) ?? 'Final cadence prerequisite failed'
      }
    }
    function percentiles(values: number[]) {
      values.sort((a, b) => a - b)
      return { count: values.length, min: values[0], p50: values[Math.ceil(values.length * 0.5) - 1], p95: values[Math.ceil(values.length * 0.95) - 1], max: values.at(-1) }
    }
    const bound = 20 * 1024 * 1024
    const rawGrowthBytes = raw.rss - before.rss
    const peakGrowthBytes = maxRss - before.rss
    const pass = failure === undefined && calls === 2000 && nonNull === 2000 && externalSamples === 2000
      && guiFailures === 0 && rawGrowthBytes < bound && peakGrowthBytes < bound
    console.info(`CADENCE_RESULT=${JSON.stringify({
      calls,
      nonNull,
      externalSamples,
      guiFailures,
      skippedTicks,
      elapsedMs: endedAt - startedAt,
      endedAtIso: new Date().toISOString(),
      serviceMs: percentiles(durations),
      intervalMs: percentiles(intervals),
      before,
      raw,
      postGc,
      maxRss,
      rawGrowthBytes,
      peakGrowthBytes,
      postGcGrowthBytes: postGc.rss - before.rss,
      originalBoundBytes: bound,
      observedNaturalGc: gc,
      forcedGc: { before: 1, during: 0, after: 1 },
      failure,
      pass,
    })}`)
    if (!pass)
      process.exitCode = 1
  }
  finally {
    clearInterval(timer)
    clearTimeout(deadline)
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', interrupt)
    observer.disconnect()
    window.emit('closed')
    const activeListeners = [...context.listeners.values()].reduce((count, handlers) => count + handlers.size, 0)
    context.abort()
    hooks.deregister()
    console.info(`CADENCE_CLEANUP=${JSON.stringify({ calls, inFlight, windowListeners: window.eventNames().length, activeListeners, keepAwakePid: keepAwakeProcess?.pid ?? null, utilityPid: process.pid })}`)
  }
}

main().catch((error: unknown) => {
  console.error(errorMessageFrom(error) ?? 'Cadence measurement failed')
  process.exitCode = 1
})
