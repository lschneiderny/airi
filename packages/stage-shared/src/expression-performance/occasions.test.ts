import type { OccasionInput } from './occasions'

import { describe, expect, it } from 'vitest'

import { initialOccasionMemory, OCCASION_SETTINGS, resolveOccasions } from './occasions'

const quiet: OccasionInput = { nowMs: 0, localHour: 15, localDay: 100, present: true, sleepiness: 0, solitude: 0.5, valence: 0, music: false, category: null }

describe('resolveOccasions', () => {
  it('holds nothing on a quiet afternoon', () => {
    expect(resolveOccasions(quiet, initialOccasionMemory).occasions).toEqual([])
  })

  it('starts the morning at the first presence of her day and ends it 45 minutes later', () => {
    // Away since the night: 07:00 passes without a morning.
    let step = resolveOccasions({ ...quiet, localHour: 7, present: false }, initialOccasionMemory)
    expect(step.occasions).toEqual([])
    const arrivedAt = 3_600_000
    step = resolveOccasions({ ...quiet, localHour: 8, nowMs: arrivedAt }, step.memory)
    expect(step.occasions).toEqual(['morning'])
    step = resolveOccasions({ ...quiet, localHour: 8.7, nowMs: arrivedAt + OCCASION_SETTINGS.morningMs - 1 }, step.memory)
    expect(step.occasions).toEqual(['morning'])
    step = resolveOccasions({ ...quiet, localHour: 8.75, nowMs: arrivedAt + OCCASION_SETTINGS.morningMs }, step.memory)
    expect(step.occasions).toEqual([])
    // Leaving and coming back the same morning does not start another one.
    step = resolveOccasions({ ...quiet, localHour: 9.5, nowMs: arrivedAt + 2 * OCCASION_SETTINGS.morningMs }, step.memory)
    expect(step.occasions).toEqual([])
  })

  it('gives no morning to a first presence after 11:00, and a new one the next day', () => {
    let step = resolveOccasions({ ...quiet, localHour: 12 }, initialOccasionMemory)
    expect(step.occasions).toEqual(['lunchtime'])
    step = resolveOccasions({ ...quiet, localHour: 9, localDay: 101, nowMs: 86_400_000 }, step.memory)
    expect(step.occasions).toEqual(['morning'])
  })

  it('counts the hours after midnight to the day before, so a late night starts no morning', () => {
    let step = resolveOccasions({ ...quiet, localHour: 22 }, initialOccasionMemory)
    step = resolveOccasions({ ...quiet, localHour: 1, localDay: 101, sleepiness: 1 }, step.memory)
    expect(step.occasions).toEqual(['late-night'])
    step = resolveOccasions({ ...quiet, localHour: 6, localDay: 101, sleepiness: 0.5 }, step.memory)
    expect(step.occasions).toEqual(['morning', 'late-night'])
  })

  it('follows the foreground app, the music and her mood', () => {
    const at = (patch: Partial<OccasionInput>) => resolveOccasions({ ...quiet, ...patch }, { day: 100, morningStartedAtMs: null }).occasions
    expect(at({ category: 'game', music: true })).toEqual(['gaming', 'music'])
    expect(at({ category: 'media' })).toEqual(['media'])
    expect(at({ category: 'editor' })).toEqual(['working'])
    expect(at({ category: 'work' })).toEqual(['working'])
    expect(at({ category: 'call' })).toEqual(['call'])
    expect(at({ category: 'browser' })).toEqual([])
    expect(at({ solitude: 0.75, valence: -0.3 })).toEqual(['lonely', 'gloomy'])
    expect(at({ valence: 0.4 })).toEqual(['cheerful'])
  })
})
