import type { AppExitOutcome } from './exit'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppExit } from './exit'

const TIMEOUT_MS = 5_000

function createExit(shutdown: () => Promise<boolean>) {
  const finished: { outcome: AppExitOutcome, finalQuitAllowed: boolean }[] = []
  const exit: AppExit = new AppExit({
    shutdown,
    // The app ends the process with `app.quit()`, which emits `before-quit` again.
    finish: outcome => finished.push({ outcome, finalQuitAllowed: exit.beforeQuit() }),
    timeoutMs: TIMEOUT_MS,
    setTimeout: (callback, ms) => {
      const handle = setTimeout(callback, ms)
      return () => clearTimeout(handle)
    },
  })
  return { exit, finished }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('appExit', () => {
  it('holds every quit request until the shutdown settles, then lets only the final quit through', async () => {
    let settle!: (clean: boolean) => void
    const shutdown = vi.fn(() => new Promise<boolean>((resolve) => {
      settle = resolve
    }))
    const { exit, finished } = createExit(shutdown)

    // SIGINT starts the exit; Browser.close, window-all-closed or a tray click then ask to quit again.
    exit.request()
    expect(exit.beforeQuit()).toBe(false)
    expect(exit.beforeQuit()).toBe(false)
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1)
    expect(finished).toEqual([])

    settle(true)
    await vi.advanceTimersByTimeAsync(0)

    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(finished).toEqual([{ outcome: 'clean', finalQuitAllowed: true }])
  })

  it.each([
    ['a step failed', () => Promise.resolve(false)],
    ['the shutdown threw', () => Promise.reject(new Error('stop failed'))],
  ] satisfies [string, () => Promise<boolean>][])('finishes as failed when %s', async (_, shutdown) => {
    const { exit, finished } = createExit(shutdown)

    expect(exit.beforeQuit()).toBe(false)
    await vi.advanceTimersByTimeAsync(0)

    expect(finished).toEqual([{ outcome: 'failed', finalQuitAllowed: true }])
  })

  it('finishes once when the shutdown outlasts the timeout', async () => {
    let settle!: (clean: boolean) => void
    const { exit, finished } = createExit(() => new Promise<boolean>((resolve) => {
      settle = resolve
    }))

    exit.request()
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)
    expect(finished).toEqual([{ outcome: 'timed-out', finalQuitAllowed: true }])

    settle(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(finished).toHaveLength(1)
  })
})
