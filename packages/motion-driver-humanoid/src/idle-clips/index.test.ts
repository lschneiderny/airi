import type { IdleClipCandidate, IdleClipInput } from './index'

import { describe, expect, it } from 'vitest'

import { decideIdleClip, IDLE_CLIP_MEAN_GAP_MS, IDLE_CLIP_REPEAT_MS, IDLE_CLIP_REST_MS, initialIdleClipMemory } from './index'

const clips: IdleClipCandidate[] = [
  { clipId: 'wave', kind: 'gesture' },
  { clipId: 'hair', kind: 'gesture' },
  { clipId: 'spin', kind: 'action' },
  { clipId: 'dance', kind: 'dance' },
]

/** Runs frames one second apart and returns each started clip with its time. */
function simulate(seconds: number, overrides: Partial<IdleClipInput> | ((nowMs: number) => Partial<IdleClipInput>) = {}, seed = 3) {
  let memory = initialIdleClipMemory
  const started: { clipId: string, atMs: number }[] = []
  for (let second = 0; second <= seconds; second++) {
    const nowMs = second * 1_000
    const decision = decideIdleClip({ nowMs, clips, quiet: true, pace: 1, seed, ...(typeof overrides === 'function' ? overrides(nowMs) : overrides) }, memory)
    memory = decision.memory
    if (decision.clipId)
      started.push({ clipId: decision.clipId, atMs: nowMs })
  }
  return started
}

describe('decideIdleClip', () => {
  it('starts clips at irregular intervals around the mean gap, never twice in a row', () => {
    const started = simulate(8 * 3600)
    const perHour = started.length / 8
    expect(perHour).toBeGreaterThan(0.5 * 3_600_000 / (IDLE_CLIP_MEAN_GAP_MS + IDLE_CLIP_REST_MS))
    expect(perHour).toBeLessThan(1.5 * 3_600_000 / IDLE_CLIP_MEAN_GAP_MS)
    const gaps = started.slice(1).map((clip, index) => clip.atMs - started[index].atMs)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(IDLE_CLIP_REST_MS)
    expect(Math.max(...gaps)).toBeGreaterThan(2 * Math.min(...gaps))
    expect(started.some((clip, index) => index > 0 && clip.clipId === started[index - 1].clipId)).toBe(false)
  })

  it('lets each clip rest for its kind, so a dance stays rare', () => {
    const started = simulate(8 * 3600)
    for (const { clipId, kind } of clips) {
      const times = started.filter(clip => clip.clipId === clipId).map(clip => clip.atMs)
      for (let index = 1; index < times.length; index++)
        expect(times[index] - times[index - 1]).toBeGreaterThanOrEqual(IDLE_CLIP_REPEAT_MS[kind])
    }
    const count = (id: string) => started.filter(clip => clip.clipId === id).length
    expect(count('dance')).toBeLessThan(count('wave'))
  })

  it('starts nothing while she is busy, at pace 0, or without clips', () => {
    expect(simulate(3600, { quiet: false })).toEqual([])
    expect(simulate(3600, { pace: 0 })).toEqual([])
    expect(simulate(3600, { clips: [] })).toEqual([])
  })

  it('counts only quiet time toward the next clip', () => {
    // Quiet for the first second of every minute: the urge grows sixty times slower.
    const started = simulate(4 * 3600, nowMs => ({ quiet: nowMs % 60_000 === 0 }))
    expect(started.length).toBeLessThan(simulate(4 * 3600).length / 10)
  })

  it('does not start a clip the moment a paused stage resumes', () => {
    const first = decideIdleClip({ nowMs: 0, clips, quiet: true, pace: 1, seed: 3 }, initialIdleClipMemory)
    const resumed = decideIdleClip({ nowMs: 6 * 3_600_000, clips, quiet: true, pace: 1, seed: 3 }, first.memory)
    expect(resumed.clipId).toBeNull()
    expect(resumed.memory.urge).toBeLessThan(0.01)
  })

  it('replays the same clips for the same seed', () => {
    expect(simulate(4 * 3600, {}, 9)).toEqual(simulate(4 * 3600, {}, 9))
    expect(simulate(4 * 3600, {}, 9)).not.toEqual(simulate(4 * 3600, {}, 10))
  })
})
