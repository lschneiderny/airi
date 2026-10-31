import type { GateHardInput, GateHardReason, GateSettings, GateSignals, SituationState } from '.'

import { describe, expect, it } from 'vitest'

import { hardReason, initialSituationState } from '.'

const T0 = 1_700_000_000_000

function withSettings(input: GateHardInput, settings: Partial<GateSettings>): GateHardInput {
  return { ...input, settings: { ...input.settings, ...settings } }
}

function withSignals(input: GateHardInput, signals: Partial<GateSignals>): GateHardInput {
  return { ...input, signals: { ...input.signals, ...signals } }
}

function withSituation(input: GateHardInput, situation: Partial<SituationState>): GateHardInput {
  return { ...input, situation: { ...input.situation, ...situation } }
}

/** Every hard suppressor holds at once. */
const ALL_HOLDING: GateHardInput = {
  situation: {
    ...initialSituationState,
    presence: { state: 'away', reason: 'locked', sinceMs: T0 },
    busy: { state: 'busy', atMs: T0 },
    // A game that is also a quiet app holds both quiet-app and busy-game, so their order shows.
    activity: { appId: 'game.exe', label: 'Game', category: 'game', title: null, sinceMs: T0 },
    nowMs: T0,
  },
  signals: {
    userSpeaking: true,
    userTyping: true,
    characterSpeaking: true,
    generating: true,
    queued: 1,
    desktopFresh: false,
    foregroundFresh: false,
    stageVisible: false,
  },
  settings: { enabled: false, chattiness: 0.5, dontDisturb: true, quietApps: ['game.exe'], speakDuringGames: false },
}

/** Clears the suppressor reported at the same step, so the next one in order surfaces. */
const CLEARS: readonly ((input: GateHardInput) => GateHardInput)[] = [
  input => withSettings(input, { enabled: true }),
  input => withSettings(input, { dontDisturb: false }),
  input => withSignals(input, { stageVisible: true }),
  input => withSituation(input, { presence: { state: 'unknown', reason: 'stale', sinceMs: T0 } }),
  input => withSituation(input, { presence: { state: 'here', reason: null, sinceMs: T0 } }),
  input => withSignals(input, { desktopFresh: true, foregroundFresh: true }),
  input => withSignals(input, { userSpeaking: false }),
  input => withSignals(input, { userTyping: false }),
  input => withSignals(input, { characterSpeaking: false }),
  input => withSignals(input, { generating: false }),
  input => withSignals(input, { queued: 0 }),
  input => withSituation(input, { busy: { state: 'accepts', atMs: T0 } }),
  input => withSettings(input, { quietApps: [] }),
  input => withSituation(input, { activity: null }),
]

function reasonWalk(urgent: boolean): (GateHardReason | null)[] {
  let input = ALL_HOLDING
  const reasons = [hardReason(input, urgent)]
  for (const clear of CLEARS) {
    input = clear(input)
    reasons.push(hardReason(input, urgent))
  }
  return reasons
}

describe('hardReason', () => {
  it('reports the hard suppressors in their documented order', () => {
    expect(reasonWalk(false)).toEqual([
      'disabled',
      'dont-disturb',
      'stage-hidden',
      'presence-away',
      'presence-unknown',
      'stale-signal',
      'user-speaking',
      'user-typing',
      'character-speaking',
      'generating',
      'queued',
      'busy-busy',
      'quiet-app',
      'busy-game',
      null,
    ])
  })

  it('lets an urgent notify past busy-game and nothing else', () => {
    expect(reasonWalk(true)).toEqual([
      'disabled',
      'dont-disturb',
      'stage-hidden',
      'presence-away',
      'presence-unknown',
      'stale-signal',
      'user-speaking',
      'user-typing',
      'character-speaking',
      'generating',
      'queued',
      'busy-busy',
      'quiet-app',
      null,
      null,
    ])
  })
})
