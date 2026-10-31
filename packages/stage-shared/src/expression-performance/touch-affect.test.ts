import type { MoodDose, TouchAffectInput, TouchAffectMemory } from '.'

import { describe, expect, it } from 'vitest'

import { createDecider, defaultExpressionPerformanceSettings, initialTouchAffectMemory, parseAffectTrace, resolveEffectiveSettings, touchAffect } from '.'

const settings = defaultExpressionPerformanceSettings
// Default units: slight 0.15 x 0.25, clear 0.25 x 0.6.
const slight = 0.0375
const clear = 0.15

function run(inputs: TouchAffectInput[], memory: TouchAffectMemory = initialTouchAffectMemory, effective = settings) {
  const doses: (MoodDose | null)[] = []
  for (const input of inputs) {
    const result = touchAffect(memory, input, effective)
    doses.push(result.dose)
    memory = result.memory
  }
  return { doses, memory }
}

/** Sums doses from a neutral mood with the Natural mood clamps: valence and arousal [-1, 1], tension [0, 1]. */
function accumulate(doses: readonly (MoodDose | null)[]) {
  const mood = { valence: 0, arousal: 0, tension: 0 }
  for (const dose of doses) {
    if (!dose)
      continue
    mood.valence = Math.max(-1, Math.min(1, mood.valence + dose.valence))
    mood.arousal = Math.max(-1, Math.min(1, mood.arousal + dose.arousal))
    mood.tension = Math.max(0, Math.min(1, mood.tension + dose.tension))
  }
  return mood
}

const petStart = (at: number): TouchAffectInput => ({ touch: 'pet-start', region: 'head', at })
const petEnd = (at: number, durationSeconds: number): TouchAffectInput => ({ touch: 'pet-end', region: 'head', durationSeconds, at })
const poke = (at: number, region: TouchAffectInput['region'] = 'head'): TouchAffectInput => ({ touch: 'poke', region, at })
const pokes = (count: number, from: number, spacing: number) => Array.from({ length: count }, (_, index) => poke(from + index * spacing))

describe('touchAffect', () => {
  it('escalates a pet of at least 3 s to the clear dose, habituated, with tension clamped at 0', () => {
    const { doses } = run([petStart(0), petEnd(3.5, 3.5), petStart(10), petEnd(13, 3)])
    for (const [pet, h] of [[doses.slice(0, 2), 1], [doses.slice(2, 4), 0.8]] as const) {
      expect(pet.every(dose => dose !== null)).toBe(true)
      const mood = accumulate(pet)
      expect(mood.valence).toBeCloseTo(clear * h, 10)
      expect(mood.arousal).toBe(0)
      expect(mood.tension).toBe(0)
    }
    expect(doses[0]).toEqual({ id: 'touch-1-pet', valence: slight, arousal: 0, tension: -slight / 2 })
    expect(doses[1]?.valence).toBeCloseTo(clear - slight, 10)
  })

  it('gives a pet shorter than 3 s only the slight dose', () => {
    const { doses } = run([petStart(0), petEnd(2.9, 2.9)])
    expect(doses[1]).toBeNull()
    expect(accumulate(doses)).toEqual({ valence: slight, arousal: 0, tension: 0 })
  })

  it('doses pet-start at most once per 4 s and lets a long pet started in the cooldown reach the clear dose', () => {
    const { doses } = run([petStart(0), petEnd(1, 1), petStart(2), petEnd(6, 4), petStart(6.5)])
    expect(doses.map(dose => dose?.id ?? null)).toEqual(['touch-1-pet', null, null, 'touch-2-pet-long', 'touch-3-pet'])
    // The cooldown pet gave nothing at its start, so its escalation is the whole habituated clear dose.
    expect(doses[3]?.valence).toBeCloseTo(clear * 0.8, 10)
  })

  it('paces 20 rapid pokes to at most 10 doses with a monotone habituation and bounded arousal', () => {
    const { doses } = run(pokes(20, 0, 0.5))
    const given = doses.filter(dose => dose !== null)
    expect(given.length).toBeLessThanOrEqual(10)
    const plain = given.filter(dose => dose.id.endsWith('-poke')).map(dose => dose.arousal)
    expect(plain[0]).toBeCloseTo(slight, 10)
    for (let index = 1; index < plain.length; index++)
      expect(plain[index]).toBeLessThanOrEqual(plain[index - 1])
    expect(plain.at(-1)).toBeCloseTo(slight * settings.intensity.habituationFloor, 10)
    expect(accumulate(doses).arousal).toBeLessThan(0.3)
  })

  it('doses the poke burst once per burst instead of the plain dose', () => {
    const { doses } = run([...pokes(20, 0, 0.5), ...pokes(3, 30, 0.5)])
    const bursts = doses.map((dose, index) => [index, dose] as const).filter(([, dose]) => dose?.id.endsWith('-poke-burst'))
    expect(bursts.map(([index]) => index)).toEqual([2, 22])
    expect(bursts[0][1]).toMatchObject({ valence: 0, arousal: clear * 0.5, tension: clear })
    expect(bursts[1][1]?.tension).toBeCloseTo(clear * 0.8, 10)
    expect(doses.filter(dose => dose?.id.endsWith('-poke')).length).toBeGreaterThan(0)
  })

  it('scales a body poke by 0.6', () => {
    expect(run([poke(0, 'body')]).doses[0]?.arousal).toBeCloseTo(slight * 0.6, 10)
  })

  it('gives no dose under a zero mood gain scale', () => {
    const silent = resolveEffectiveSettings(settings, { moodGainScale: 0 }).settings
    const { doses } = run([petStart(0), petEnd(5, 5), ...pokes(5, 10, 1.5)], initialTouchAffectMemory, silent)
    expect(doses.every(dose => dose === null)).toBe(true)
  })

  it('ignores earlier and non-finite times without changing memory', () => {
    const { memory } = run([poke(5)])
    for (const at of [4, Number.NaN])
      expect(touchAffect(memory, poke(at), settings)).toEqual({ dose: null, memory })
  })

  it('gives the same next output after a JSON round trip of the memory', () => {
    const history = [petStart(0), petEnd(2, 2), ...pokes(4, 3, 0.4), petStart(8)]
    const { memory } = run(history)
    const restored = JSON.parse(JSON.stringify(memory)) as TouchAffectMemory
    expect(restored).toEqual(memory)
    for (const input of [petEnd(12, 4), poke(9), poke(9.5, 'body')])
      expect(touchAffect(restored, input, settings)).toEqual(touchAffect(memory, input, settings))
  })
})

describe('touch signals in the deciders', () => {
  const ctx = { settings, catalog: [] }

  it.each(['picker', 'planner'] as const)('%s turns a touch into a mood dose only', (kind) => {
    const decider = createDecider(kind)
    const start = decider.decide({ kind: 'touch', touch: 'pet-start', region: 'head', at: 0 }, ctx, decider.initial(1))
    expect(start.decision).toEqual({ episodes: [], slots: [], holds: [], moods: [{ id: 'touch-1-pet', valence: slight, arousal: 0, tension: -slight / 2 }] })
    const end = decider.decide({ kind: 'touch', touch: 'pet-end', region: 'head', durationSeconds: 4, at: 4 }, ctx, start.state)
    expect(end.decision.episodes).toEqual([])
    expect(end.decision.moods.map(dose => dose.id)).toEqual(['touch-2-pet-long'])
    expect(end.state.reaction).toEqual(decider.initial(1).reaction)
  })

  it('accepts touch signals in recorded traces', () => {
    const trace = parseAffectTrace({
      version: 1,
      decider: 'picker',
      checkpoint: createDecider('picker').initial(1),
      initialContext: ctx,
      entries: [{ type: 'signal', signal: { kind: 'touch', touch: 'pet-end', region: 'head', durationSeconds: 3, at: 3 } }],
      truncated: false,
      endAt: 3,
    })
    expect(trace.entries[0]).toEqual({ type: 'signal', signal: { kind: 'touch', touch: 'pet-end', region: 'head', durationSeconds: 3, at: 3 } })
  })
})
