import type { CharacterEvent, CharacterEventKind } from '@proj-airi/stage-shared/character-state'

import { nanoid } from 'nanoid'

const DAY_MS = 24 * 3_600_000

/** The test events the page offers; the leader stamps `atMs` at its clock. */
export const TEST_EVENT_KINDS = [
  'touch-pleasant',
  'touch-unwelcome',
  'reach-out-unanswered',
  'late-reply',
  'reach-out-reply',
  'return',
  'ritual-reciprocated',
  'user-turn',
  'disclosure',
  'kept-promise',
  'milestone',
  'significant-positive',
  'significant-negative',
  'unkind',
  'hurtful',
] as const satisfies readonly CharacterEventKind[]

export type TestEventKind = typeof TEST_EVENT_KINDS[number]

/** Builds the test event of a kind with a fresh id. The reason text is what a real event of that kind would carry. */
export function testEvent(kind: TestEventKind): CharacterEvent {
  const base = { id: `devtools-${nanoid(8)}`, atMs: 0 }
  switch (kind) {
    case 'reach-out-unanswered':
      return { kind, ...base, consecutive: 1 }
    case 'return':
      return { kind, ...base, gapMs: DAY_MS }
    case 'user-turn':
      return { kind, ...base, exchange: 'first-real' }
    case 'disclosure':
      return { kind, ...base, reason: 'he told you about his week' }
    case 'kept-promise':
      return { kind, ...base, reason: 'he came back when he said he would' }
    case 'milestone':
      return { kind, ...base, reason: 'you watched a film together', memoryId: `devtools-memory-${nanoid(8)}` }
    case 'significant-positive':
      return { kind, ...base, reason: 'he said something kind' }
    case 'significant-negative':
      return { kind, ...base, reason: 'he snapped at you' }
    case 'unkind':
      return { kind, ...base, reason: 'he brushed you off' }
    case 'hurtful':
      return { kind, ...base, reason: 'he said something cruel' }
    default:
      return { kind, ...base }
  }
}
