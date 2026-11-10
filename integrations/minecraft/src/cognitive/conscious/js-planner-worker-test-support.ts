import type { ChildProcess } from 'node:child_process'

import { fork, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { clearTimeout, setTimeout } from 'node:timers'

import { afterEach, beforeEach, expect, vi } from 'vitest'

export async function bounded<T>(promise: Promise<T>, timeoutMs = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Worker event did not arrive within ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
}

export function trackSandboxWorkers(): () => ChildProcess[] {
  const workers = () => vi.mocked(fork).mock.results.flatMap((result, index) =>
    result.type === 'return' && String(vi.mocked(fork).mock.calls[index]?.[0]).endsWith('/js-planner-worker.ts')
      ? [result.value]
      : [],
  )

  beforeEach(() => {
    vi.mocked(fork).mockClear()
  })
  afterEach(async () => {
    try {
      const results = await Promise.allSettled(workers().map(async (child) => {
        const pid = child.pid
        expect(pid).toBeTypeOf('number')
        console.info(`planner-worker PID=${pid}`)
        try {
          if (child.exitCode === null && child.signalCode === null)
            await bounded(once(child, 'exit'))
        }
        finally {
          if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit')
            child.kill('SIGKILL')
            await bounded(exited)
          }
          const probe = spawnSync('kill', ['-0', String(pid)])
          expect(probe.error).toBeUndefined()
          expect(probe.status, `Worker ${pid} must be gone`).toBe(1)
          console.info(`planner-worker PID=${pid} kill -0=${probe.status}`)
        }
      }))
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
      if (failures.length > 0)
        throw new AggregateError(failures, 'Sandbox worker cleanup failed')
    }
    finally {
      vi.useRealTimers()
    }
  }, 15_000)

  return workers
}
