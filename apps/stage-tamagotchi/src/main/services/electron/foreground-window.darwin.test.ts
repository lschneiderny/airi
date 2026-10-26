import process from 'node:process'

import { EventEmitter } from 'node:events'

import { createContext, defineInvoke } from '@moeru/eventa'
import { electron } from '@proj-airi/electron-eventa'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createForegroundWindowService } from './foreground-window'
import { createDarwinSampler, loadDarwinBinding } from './foreground-window-darwin'

// Only Electron's process inventory is mocked; the service, invoke, and native binding are real.
vi.mock('electron', () => ({
  app: {
    getAppMetrics: () => [],
  },
}))

const busyStates = ['accepts', 'busy', 'fullscreen', 'presentation', 'quiet', null] as const

describe.runIf(process.platform === 'darwin')('createForegroundWindowService with the real Darwin binding', () => {
  let binding: Awaited<ReturnType<typeof loadDarwinBinding>>

  beforeAll(async () => {
    binding = await loadDarwinBinding()
    const trusted = binding.isProcessTrusted()
    console.info(`AX_TRUST=${trusted}`)
    if (!trusted)
      console.info('LIVE_AX_PREREQUISITE_MISSING: title and frozen-app proof NOT RUN; task 9 remains PARTIAL')
  })

  beforeEach((context) => {
    const session = binding.readSession()
    console.info(`DARWIN_SERVICE_SESSION=${JSON.stringify(session)}`)
    if (!session || session.onConsole !== true || session.locked === true) {
      console.info('REAL_BINDING_SKIP: no unlocked console GUI session; timing and RSS NOT PASSED')
      context.skip()
    }
  })

  function createReader() {
    const context = createContext()
    const window = new EventEmitter()
    createForegroundWindowService({ context: context as never, window: window as never })
    return { read: defineInvoke(context, electron.foregroundWindow.sample), close: () => window.emit('closed') }
  }

  it('validates 50 responsive service samples and records informational percentiles', async () => {
    const reader = createReader()
    const durations: number[] = []
    let samples = 0
    try {
      for (let i = 0; i < 50; i++) {
        const started = performance.now()
        const sample = await reader.read()
        durations.push(performance.now() - started)
        if (sample === null)
          continue

        samples += 1
        expect(sample.pid).toBeGreaterThan(0)
        expect(typeof sample.title).toBe('string')
        expect(typeof sample.ownProcess).toBe('boolean')
        expect(Number.isFinite(sample.sampledAtMs)).toBe(true)
        expect(busyStates).toContain(sample.busy)
        if (sample.exePath !== null) {
          expect(sample.exeName === null).toBe(false)
          expect(sample.exePath.endsWith(sample.exeName ?? '')).toBe(true)
        }
      }
      durations.sort((a, b) => a - b)
      console.info(`DARWIN_SERVICE_TIMING=${JSON.stringify({
        calls: durations.length,
        samples,
        p50Ms: durations[24],
        p95Ms: durations[47],
        maxMs: durations[49],
      })}`)
      expect(samples).toBeGreaterThan(0)
      expect(Math.max(...durations)).toBeLessThan(250)
    }
    finally {
      reader.close()
    }
  })

  it('keeps native RSS growth below 20 MB across 2000 real samples', () => {
    // The 50-call test covers service delivery. Measure native ownership here:
    // an in-process invoke loop also allocates both client and server JS events.
    const read = createDarwinSampler(binding, pid => pid === process.pid)
    const before = process.memoryUsage()
    let samples = 0
    for (let i = 0; i < 2000; i++) {
      if (read() !== null)
        samples += 1
    }
    const after = process.memoryUsage()
    console.info(`DARWIN_NATIVE_RSS=${JSON.stringify({ samples, before, after, growthBytes: after.rss - before.rss })}`)
    expect(samples).toBe(2000)
    expect(after.rss - before.rss).toBeLessThan(20 * 1024 * 1024)
  }, 120_000)

  it.runIf(process.env.AIRI_FOREGROUND_QA_SAFARI === '1')('reads Safari through the actual service without logging title content', async () => {
    const reader = createReader()
    try {
      const sample = await reader.read()
      expect(sample === null).toBe(false)
      if (sample === null)
        return

      console.info(`SAFARI_SERVICE_SAMPLE=${JSON.stringify({
        fields: Object.keys(sample).sort(),
        exeName: sample.exeName,
        exePath: sample.exePath,
        pid: sample.pid,
        busy: sample.busy,
        ownProcess: sample.ownProcess,
        titleType: typeof sample.title,
        sampledAtMs: sample.sampledAtMs,
      })}`)
      expect(sample.exeName).toBe('Safari.app')
      expect(sample.busy).toBe('accepts')
      expect(sample.ownProcess).toBe(false)
    }
    finally {
      reader.close()
    }
  })

  it.runIf(Boolean(process.env.AIRI_FOREGROUND_QA_FROZEN_PID))('bounds a trusted frozen TextEdit sample with the shared AX budget', async () => {
    expect(binding.isProcessTrusted()).toBe(1)
    const pid = Number(process.env.AIRI_FOREGROUND_QA_FROZEN_PID)
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true)
    const reader = createReader()
    try {
      const front = await reader.read()
      expect(front?.exeName).toBe('TextEdit.app')
      expect(front?.pid).toBe(pid)
      process.kill(pid, 'SIGSTOP')
      try {
        const started = performance.now()
        const sample = await reader.read()
        const elapsedMs = performance.now() - started
        console.info(`FROZEN_TEXTEDIT_SAMPLE=${JSON.stringify({
          pid,
          elapsedMs,
          sampled: sample !== null,
          titleType: typeof sample?.title,
          trusted: binding.isProcessTrusted(),
        })}`)
        expect(sample === null).toBe(false)
        expect(elapsedMs).toBeGreaterThanOrEqual(150)
        expect(elapsedMs).toBeLessThan(400)
      }
      finally {
        process.kill(pid, 'SIGCONT')
      }
    }
    finally {
      reader.close()
    }
  })
})
