import { describe, expect, it } from 'vitest'

import { initialMusicMemory, resolveMusic } from './idle-music'

const T0 = 1_700_000_000_000

function run(samples: { atS: number, level: number | null, category?: 'media' | 'game' | 'call' | null, speaking?: boolean }[]) {
  let memory = initialMusicMemory
  return samples.map(({ atS, level, category = 'media', speaking = false }) => {
    const result = resolveMusic({ nowMs: T0 + atS * 1000, systemAudioLevel: level, category, speaking }, memory)
    memory = result.memory
    return result.music
  })
}

describe('resolveMusic', () => {
  it('needs eight seconds of audio before it counts as music', () => {
    expect(run([{ atS: 0, level: 0.4 }, { atS: 7, level: 0.4 }, { atS: 8, level: 0.4 }])).toEqual([false, false, true])
  })

  it('starts over after silence', () => {
    expect(run([{ atS: 0, level: 0.4 }, { atS: 9, level: 0.4 }, { atS: 10, level: 0 }, { atS: 11, level: 0.4 }, { atS: 18, level: 0.4 }]))
      .toEqual([false, true, false, false, false])
  })

  it('ignores games and calls, and an unknown level', () => {
    expect(run([{ atS: 0, level: 0.4, category: 'game' }, { atS: 20, level: 0.4, category: 'game' }])).toEqual([false, false])
    expect(run([{ atS: 0, level: 0.4, category: 'call' }, { atS: 20, level: 0.4, category: 'call' }])).toEqual([false, false])
    expect(run([{ atS: 0, level: null }, { atS: 20, level: null }])).toEqual([false, false])
  })

  it('counts audio in an unknown app, and pauses while she speaks without losing the stretch', () => {
    expect(run([{ atS: 0, level: 0.4, category: null }, { atS: 9, level: 0.4, category: null, speaking: true }, { atS: 10, level: 0.4, category: null }]))
      .toEqual([false, false, true])
  })
})
