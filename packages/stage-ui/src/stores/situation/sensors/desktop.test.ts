import type { DesktopActivitySnapshot } from '@proj-airi/stage-shared/performance-state'
import type { Observation } from '@proj-airi/stage-shared/situation'

import { AWAY_INPUT_IDLE_SECONDS } from '@proj-airi/stage-shared/performance-state'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DESKTOP_SAMPLE_STALE_MS, IDLE_INPUT_IDLE_SECONDS, startDesktopSensor } from './desktop'

const T0 = Date.UTC(2026, 9, 20, 9, 0, 0)
const HOUR_MS = 60 * 60 * 1_000

/** A fresh sample of an active, unlocked desktop at the current fake time. */
function sample(overrides: Partial<DesktopActivitySnapshot> = {}): DesktopActivitySnapshot {
  return {
    idleSeconds: 0,
    locked: false,
    suspendedAtMs: null,
    resumedAtMs: null,
    unlockedAtMs: null,
    systemAudioLevel: null,
    screenChange: null,
    sampledAtMs: Date.now(),
    ...overrides,
  }
}

/** Starts a sensor on the real desktop activity store and records what it ingests. */
function run() {
  const observations: Observation[] = []
  const sensor = startDesktopSensor(observation => observations.push(observation))
  const desktop = useDesktopActivityStore()
  return {
    observations,
    sensor,
    /** Moves the fake clock to `atMs` and publishes a sample taken then. */
    publish(atMs: number, overrides: Partial<DesktopActivitySnapshot> = {}) {
      vi.setSystemTime(atMs)
      desktop.setSnapshot(sample(overrides))
    },
  }
}

describe('desktop situation sensor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends nothing for a host without samples, now or on later checks', () => {
    const { observations, sensor } = run()

    sensor.check(T0 + HOUR_MS)

    expect(observations).toEqual([])
  })

  it('maps idle time, lock, and suspend to presence, reporting only changes', () => {
    const { observations, publish } = run()

    publish(T0, { idleSeconds: 0 })
    publish(T0 + 1_000, { idleSeconds: 1 })
    publish(T0 + 2_000, { idleSeconds: IDLE_INPUT_IDLE_SECONDS })
    publish(T0 + 3_000, { idleSeconds: IDLE_INPUT_IDLE_SECONDS + 1 })
    publish(T0 + 4_000, { idleSeconds: AWAY_INPUT_IDLE_SECONDS })
    publish(T0 + 5_000, { idleSeconds: AWAY_INPUT_IDLE_SECONDS + 1 })
    publish(T0 + 6_000, { idleSeconds: 0, locked: true })
    publish(T0 + 7_000, { idleSeconds: 0, suspendedAtMs: T0 + 7_000 })
    publish(T0 + 8_000, { idleSeconds: 0, suspendedAtMs: T0 + 7_000, resumedAtMs: T0 + 8_000 })

    expect(observations).toEqual([
      { kind: 'presence', state: 'here', atMs: T0 },
      { kind: 'presence', state: 'idle', reason: 'idle', atMs: T0 + 3_000 },
      { kind: 'presence', state: 'away', reason: 'idle', atMs: T0 + 5_000 },
      { kind: 'presence', state: 'away', reason: 'locked', atMs: T0 + 6_000 },
      { kind: 'presence', state: 'away', reason: 'suspended', atMs: T0 + 7_000 },
      // The first resume after the baseline is also a wake.
      { kind: 'wake', cause: 'resume', atMs: T0 + 8_000 },
      { kind: 'presence', state: 'here', atMs: T0 + 8_000 },
    ])
  })

  it('reports a sample that stops arriving as unknown and stale, once, until a fresh one comes', () => {
    const { observations, publish, sensor } = run()
    publish(T0)

    sensor.check(T0 + DESKTOP_SAMPLE_STALE_MS)
    expect(observations).toEqual([{ kind: 'presence', state: 'here', atMs: T0 }])

    sensor.check(T0 + DESKTOP_SAMPLE_STALE_MS + 1)
    sensor.check(T0 + DESKTOP_SAMPLE_STALE_MS + 2)
    publish(T0 + 20_000)

    expect(observations).toEqual([
      { kind: 'presence', state: 'here', atMs: T0 },
      { kind: 'presence', state: 'unknown', reason: 'stale', atMs: T0 + DESKTOP_SAMPLE_STALE_MS + 1 },
      { kind: 'presence', state: 'here', atMs: T0 + 20_000 },
    ])
  })

  it('does not trust a sample from the future or one without a valid time', () => {
    const { observations, publish } = run()

    publish(T0, { sampledAtMs: T0 + DESKTOP_SAMPLE_STALE_MS + 1 })
    publish(T0 + 1_000, { sampledAtMs: Number.NaN })
    publish(T0 + 2_000, { sampledAtMs: -1 })

    expect(observations).toEqual([{ kind: 'presence', state: 'unknown', reason: 'stale', atMs: T0 }])
  })

  it('treats an unmeasurable idle time on an unlocked desktop as unknown, never as here', () => {
    const { observations, publish } = run()

    publish(T0, { idleSeconds: 0 })
    publish(T0 + 1_000, { idleSeconds: null })
    publish(T0 + 2_000, { idleSeconds: Number.NaN })
    publish(T0 + 3_000, { idleSeconds: -5 })
    // A lock is still known without an idle time.
    publish(T0 + 4_000, { idleSeconds: null, locked: true })

    expect(observations).toEqual([
      { kind: 'presence', state: 'here', atMs: T0 },
      { kind: 'presence', state: 'unknown', atMs: T0 + 1_000 },
      { kind: 'presence', state: 'away', reason: 'locked', atMs: T0 + 4_000 },
    ])
  })

  it('takes the first sample as the wake baseline and reports only advancing unlock and resume times', () => {
    const { observations, publish } = run()

    // Hours-old times in the first sample are not news.
    publish(T0, { unlockedAtMs: T0 - 3 * HOUR_MS, resumedAtMs: T0 - 2 * HOUR_MS })
    publish(T0 + 1_000, { unlockedAtMs: T0 - 3 * HOUR_MS, resumedAtMs: T0 - 2 * HOUR_MS })
    publish(T0 + 2_000, { unlockedAtMs: T0 + 2_000, resumedAtMs: T0 - 2 * HOUR_MS })
    // The same time again, an older time (clock stepped back), and a missing time are not wakes.
    publish(T0 + 3_000, { unlockedAtMs: T0 + 2_000 })
    publish(T0 + 4_000, { unlockedAtMs: T0 + 1_000 })
    publish(T0 + 5_000, { unlockedAtMs: null })
    // Both advance in one sample: the older one goes first, because the reducer keeps the newest wake.
    publish(T0 + 6_000, { unlockedAtMs: T0 + 6_000, resumedAtMs: T0 + 5_500 })

    expect(observations.filter(observation => observation.kind === 'wake')).toEqual([
      { kind: 'wake', cause: 'unlock', atMs: T0 + 2_000 },
      { kind: 'wake', cause: 'resume', atMs: T0 + 5_500 },
      { kind: 'wake', cause: 'unlock', atMs: T0 + 6_000 },
    ])
  })

  it('sees a locked and an unlocked sample written in the same tick', () => {
    const { observations, publish } = run()
    publish(T0)

    publish(T0 + 10_000, { locked: true })
    publish(T0 + 10_000, { locked: false, unlockedAtMs: T0 + 10_000 })

    expect(observations).toEqual([
      { kind: 'presence', state: 'here', atMs: T0 },
      { kind: 'presence', state: 'away', reason: 'locked', atMs: T0 + 10_000 },
      { kind: 'wake', cause: 'unlock', atMs: T0 + 10_000 },
      { kind: 'presence', state: 'here', atMs: T0 + 10_000 },
    ])
  })

  it('reads nothing after it stops', () => {
    const { observations, publish, sensor } = run()
    publish(T0)

    sensor.stop()
    publish(T0 + 1_000, { locked: true, unlockedAtMs: T0 + 1_000 })

    expect(observations).toEqual([{ kind: 'presence', state: 'here', atMs: T0 }])
  })
})
