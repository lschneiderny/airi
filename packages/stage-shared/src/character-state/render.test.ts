import type { AdvanceContext, CharacterEvent, CharacterReading, CharacterStateRecordV1, MoodAxes, MoodContribution, MoodSource, RelationshipStages } from '.'

import { describe, expect, it } from 'vitest'

import { advance, applyEvent, DEFAULT_CHARACTER_PROFILE, initialCharacterState } from '.'
import { nextRandom, seedRng } from '../situation/rng'
import { readCharacter } from './reading'
import { characterRenderKey, renderCharacterContext } from './render'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const ROLLOVER_MS = 4 * HOUR_MS
const NOW_MS = Date.UTC(2026, 10, 3, 15)
const PROFILE = DEFAULT_CHARACTER_PROFILE
const SEEDS = Array.from({ length: 200 }, (_, index) => 5_003 + index * 19)
const STRANGER = 'You two: you are still getting to know him; keep it polite and a little reserved.'
const TEASING = 'you can tease him a little'
const NICKNAMES = 'you may use a nickname for him if you have one'
const INITIATIVE = 'you may start conversations and suggest things yourself'
const CALLBACKS = 'you may bring up things you shared before'
const VULNERABILITY = 'you can admit when something hurts'

function logicalDayStartOf(ms: number): number {
  return Math.floor((ms - ROLLOVER_MS) / DAY_MS) * DAY_MS + ROLLOVER_MS
}

function contextAt(nowMs: number): AdvanceContext {
  return { nowMs, logicalDayStartOf, logicalDayKeyOf: ms => new Date(logicalDayStartOf(ms)).toISOString().slice(0, 10) }
}

function contribution(id: string, source: MoodSource, atMs: number, halfLifeMs: number, delta: MoodAxes, reason: string): MoodContribution {
  const size = Math.max(Math.abs(delta.valence), Math.abs(delta.energy), Math.abs(delta.tension))
  return { id, source, reason, atMs, halfLifeMs, delta, expiresAtMs: atMs + halfLifeMs * Math.log2(size / 0.01) }
}

function stateWith(temperament: MoodAxes, contributions: readonly MoodContribution[], stages?: RelationshipStages, milestones = 0): CharacterStateRecordV1 {
  const state = initialCharacterState('card', PROFILE, contextAt(NOW_MS - DAY_MS))
  return {
    ...state,
    temperament: { ...state.temperament, axes: temperament },
    mood: { ...state.mood, contributions },
    relationship: {
      ...state.relationship,
      stages: stages ?? state.relationship.stages,
      milestoneIds: Array.from({ length: milestones }, (_, index) => `m${index}`),
    },
  }
}

function render(state: CharacterStateRecordV1, nowMs = NOW_MS): string {
  return renderCharacterContext(readCharacter(state, PROFILE, null, contextAt(nowMs)), contextAt(nowMs))
}

describe('renderCharacterContext', () => {
  it('renders nothing for a resting state', () => {
    expect(render(initialCharacterState('card', PROFILE, contextAt(NOW_MS)))).toBe('')
    expect(render(stateWith(PROFILE.resting, []))).toBe('')
  })

  it('renders only the relationship line for each stage from friendly up at a resting mood', () => {
    expect(render(stateWith(PROFILE.resting, [], { closeness: 'friendly', trust: 'guarded', familiarity: 'new' })))
      .toBe('You two: you are friendly and at ease with him.')
    expect(render(stateWith(PROFILE.resting, [], { closeness: 'close', trust: 'open', familiarity: 'new' })))
      .toBe(`You two: you are close and comfortable with him; ${TEASING}; ${INITIATIVE}.`)
    expect(render(stateWith(PROFILE.resting, [], { closeness: 'intimate', trust: 'confiding', familiarity: 'knows-you' }, 3)))
      .toBe(`You two: you are very close; you can be openly affectionate and say what you feel; ${TEASING}; ${NICKNAMES}; ${INITIATIVE}; ${CALLBACKS}; ${VULNERABILITY}.`)
    expect(render(stateWith(PROFILE.resting, [], { closeness: 'intimate', trust: 'guarded', familiarity: 'knows-you' }, 2)))
      .toBe(`You two: you are very close; you can be openly affectionate and say what you feel; ${NICKNAMES}; ${INITIATIVE}.`)
  })

  it('shows no tease or nickname wording when close without open trust or knowing him', () => {
    const text = render(stateWith(PROFILE.resting, [], { closeness: 'close', trust: 'guarded', familiarity: 'new' }))
    expect(text).toBe(`You two: you are close and comfortable with him; ${INITIATIVE}.`)
    expect(text).not.toMatch(/teas|nickname/)
  })

  it('shows the teasing sentence at friendly with open trust and not with guarded trust', () => {
    expect(render(stateWith(PROFILE.resting, [], { closeness: 'friendly', trust: 'open', familiarity: 'new' })))
      .toBe(`You two: you are friendly and at ease with him; ${TEASING}.`)
    expect(render(stateWith(PROFILE.resting, [], { closeness: 'friendly', trust: 'guarded', familiarity: 'knows-you' })))
      .not
      .toMatch(/teas/)
  })

  it('shows the nickname sentence at close once she knows him', () => {
    expect(render(stateWith(PROFILE.resting, [], { closeness: 'close', trust: 'guarded', familiarity: 'knows-you' })))
      .toBe(`You two: you are close and comfortable with him; ${NICKNAMES}; ${INITIATIVE}.`)
  })

  it('shows the initiative sentence from close and not below it', () => {
    expect(render(stateWith(PROFILE.resting, [], { closeness: 'close', trust: 'guarded', familiarity: 'new' }))).toContain(INITIATIVE)
    expect(render(stateWith(PROFILE.resting, [], { closeness: 'friendly', trust: 'confiding', familiarity: 'knows-you' }, 3))).not.toContain(INITIATIVE)
  })

  it('changes the render key when any one unlock changes', () => {
    const keyOf = (stages: RelationshipStages, milestones = 0) => characterRenderKey(readCharacter(stateWith(PROFILE.resting, [], stages, milestones), PROFILE, null, contextAt(NOW_MS)), contextAt(NOW_MS))
    // Each pair differs in exactly one unlock and keeps the closeness stage.
    const pairs: Array<[RelationshipStages, number, RelationshipStages, number]> = [
      [{ closeness: 'friendly', trust: 'guarded', familiarity: 'new' }, 0, { closeness: 'friendly', trust: 'open', familiarity: 'new' }, 0],
      [{ closeness: 'close', trust: 'guarded', familiarity: 'new' }, 0, { closeness: 'close', trust: 'guarded', familiarity: 'knows-you' }, 0],
      [{ closeness: 'close', trust: 'open', familiarity: 'new' }, 0, { closeness: 'close', trust: 'confiding', familiarity: 'new' }, 0],
      [{ closeness: 'friendly', trust: 'guarded', familiarity: 'knows-you' }, 2, { closeness: 'friendly', trust: 'guarded', familiarity: 'knows-you' }, 3],
    ]
    for (const [before, beforeMilestones, after, afterMilestones] of pairs)
      expect(keyOf(after, afterMilestones)).not.toBe(keyOf(before, beforeMilestones))
  })

  it('renders a hurt, unanswered feeling with the stranger line', () => {
    const unanswered = contribution('u', 'reach-out-unanswered', NOW_MS - 30 * MINUTE_MS, 3 * HOUR_MS, { valence: -0.06, energy: -0.03, tension: 0.06 }, 'he did not answer when you reached out')
    expect(render(stateWith({ valence: -0.3, energy: -0.1, tension: 0.45 }, [unanswered])))
      .toBe(`Feeling: low, steady, tense (he did not answer when you reached out earlier today).\n${STRANGER}`)
  })

  it('renders a bright lively feeling without a tension word when relaxed', () => {
    expect(render(stateWith({ valence: 0.5, energy: 0.3, tension: 0.1 }, [], { closeness: 'friendly', trust: 'open', familiarity: 'new' })))
      .toBe(`Feeling: bright, lively.\nYou two: you are friendly and at ease with him; ${TEASING}.`)
  })

  it('names a live reason even when every bucket rests', () => {
    const touch = contribution('t', 'touch', NOW_MS - 5 * MINUTE_MS, 1.5 * HOUR_MS, { valence: 0.04, energy: 0.01, tension: -0.01 }, 'he touched you gently')
    expect(render(stateWith(PROFILE.resting, [touch])))
      .toBe(`Feeling: even, steady (he touched you gently earlier today).\n${STRANGER}`)
  })

  it('returns to nothing after a cue decays, though the resting valence sits on the exit edge of good', () => {
    const cue: CharacterEvent = { kind: 'model-cue', id: 'cue', atMs: NOW_MS, turnId: 'cue', directions: { valence: 1, energy: 0, tension: 0 }, reason: 'he made you laugh' }
    let state = applyEvent(initialCharacterState('card', PROFILE, contextAt(NOW_MS - HOUR_MS)), cue, PROFILE, contextAt(NOW_MS))
    let previous = readCharacter(state, PROFILE, null, contextAt(NOW_MS))
    expect(previous.buckets.valence).toBe('good')
    for (let hour = 1; hour <= 72; hour++) {
      const at = NOW_MS + hour * HOUR_MS
      state = advance(state, PROFILE, contextAt(at))
      previous = readCharacter(state, PROFILE, previous, contextAt(at))
    }
    expect(renderCharacterContext(previous, contextAt(NOW_MS + 72 * HOUR_MS))).toBe('')
  })

  it('says yesterday, last night, and a few days ago from the logical day', () => {
    const at = (atMs: number) => contribution(`r${atMs}`, 'significant', atMs, 30 * HOUR_MS, { valence: 0.25, energy: 0, tension: 0 }, 'he remembered')
    const now = Date.UTC(2026, 10, 5, 10)
    expect(render(stateWith(PROFILE.resting, [at(Date.UTC(2026, 10, 4, 12))]), now)).toContain('(he remembered yesterday)')
    expect(render(stateWith(PROFILE.resting, [at(Date.UTC(2026, 10, 4, 21))]), now)).toContain('(he remembered last night)')
    expect(render(stateWith(PROFILE.resting, [at(Date.UTC(2026, 10, 5, 2))]), now)).toContain('(he remembered last night)')
    expect(render(stateWith(PROFILE.resting, [at(Date.UTC(2026, 10, 5, 4))]), now)).toContain('(he remembered earlier today)')
    expect(render(stateWith(PROFILE.resting, [at(Date.UTC(2026, 10, 3, 12))]), now)).toContain('(he remembered a few days ago)')
  })

  it('drops digits and list punctuation from reasons', () => {
    const cue = contribution('c', 'model-cue', NOW_MS, 90 * MINUTE_MS, { valence: 0.08, energy: 0.08, tension: 0 }, 'he ate 3 cakes (at 9); wow.')
    const text = render(stateWith(PROFILE.resting, [cue]))
    expect(text).not.toMatch(/\d/)
    expect(text).toContain('(he ate cakes at, wow earlier today)')
  })

  it('never renders a digit and keeps at most two lines for 200 seeded histories', () => {
    for (const seed of SEEDS) {
      let random = seedRng(seed)
      const next = () => {
        const [value, state] = nextRandom(random)
        random = state
        return value
      }
      let state = initialCharacterState('card', PROFILE, contextAt(NOW_MS))
      let previous: CharacterReading | null = null
      let at = NOW_MS
      for (let step = 0; step < 40; step++) {
        at += Math.floor(next() * 4 * HOUR_MS)
        const id = `e${step}`
        const reason = `he said ${Math.floor(next() * 1000)} things`
        const roll = next()
        const event: CharacterEvent = roll < 0.3
          ? { kind: 'model-cue', id, atMs: at, turnId: id, directions: { valence: next() < 0.5 ? 1 : -1, energy: next() < 0.5 ? 1 : 0, tension: 0 }, reason }
          : roll < 0.5
            ? { kind: next() < 0.5 ? 'significant-positive' : 'significant-negative', id, atMs: at, reason }
            : roll < 0.7
              ? { kind: 'reach-out-unanswered', id, atMs: at, consecutive: 2 }
              : { kind: 'user-turn', id, atMs: at, exchange: 'first-real' }
        state = advance(applyEvent(state, event, PROFILE, contextAt(at)), PROFILE, contextAt(at + MINUTE_MS))
        previous = readCharacter(state, PROFILE, previous, contextAt(at + MINUTE_MS))
        const text = renderCharacterContext(previous, contextAt(at + MINUTE_MS))
        expect(text).not.toMatch(/\d/)
        expect(text.split('\n').length).toBeLessThanOrEqual(2)
      }
    }
  })
})
