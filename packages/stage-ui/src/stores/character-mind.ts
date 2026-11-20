import type { MindIntent, MindStep } from '@proj-airi/character-mind'
import type { ReactionDecision } from '@proj-airi/stage-shared/situation'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { CharacterMind } from '@proj-airi/character-mind'
import { defineStore } from 'pinia'
import { markRaw } from 'vue'

import { MindVoice } from '../composables/performance/mind-voice'
import { useCharacterStateStore } from './character-state'
import { useSituationObservabilityStore } from './devtools/situation-observability'
import { useSituationStore } from './situation'

/** What a mounted stage lends the mind: the body around a line. The conductor gates it by driver. */
export interface MindStage {
  idleCue: (cue: Extract<MindIntent, { kind: 'cue' }>['cue']) => void
}

/**
 * The voice decision a step made, or null when none of its stimuli reached the voice policy: only a poke or a
 * finished pet with a voice view does. The state keeps the last decision between steps, so it alone cannot tell.
 */
export function voiceDecisionOf({ stimuli, state }: Pick<MindStep, 'stimuli' | 'state'>): ReactionDecision | null {
  const decided = stimuli.some(stimulus => stimulus.kind === 'touch' && stimulus.voice !== null && stimulus.gesture !== 'pet-start')
  return decided ? state.voice.lastDecision : null
}

/**
 * Hosts the window's one character mind, seeded from the platform's random source. It is not synced: every window
 * that creates it constructs its own mind, but only the leader's connects to the situation store's voice port, so a
 * follower's mind answers touch and desktop steps of its own stage and decides no line.
 *
 * The mind outlives stage remounts. It feeds the devtools reaction inspector of this window from creation until
 * {@link dispose}.
 */
export const useCharacterMindStore = defineStore('character-mind', () => {
  const situation = useSituationStore()
  const characterState = useCharacterStateStore()
  const observability = useSituationObservabilityStore()

  // markRaw: the mind's state is replaced on every step and must not become reactive.
  const mind = markRaw(new CharacterMind({ seed: crypto.getRandomValues(new Uint32Array(1))[0] }))
  /** Mounted stages, oldest first; the newest receives the cues. */
  const stages: MindStage[] = []
  /** Answers the voice port's stimuli; its cues go to the newest attached stage, or nowhere. */
  const voice = new MindVoice(mind, () => situation, cue => stages.at(-1)?.idleCue(cue))

  observability.publishReactionMemory(mind.state.voice.reaction)
  let stopInspector: (() => void) | undefined = mind.onStep((step) => {
    const { reaction } = step.state.voice
    const decision = voiceDecisionOf(step)
    if (decision)
      observability.recordReactionDecision(decision, reaction, step.atMs)
    else if (step.stimuli.some(stimulus => stimulus.kind === 'voice-outcome'))
      observability.publishReactionMemory(reaction)
  })

  let stopLeadershipListener: (() => void) | undefined
  let disconnectVoice: (() => void) | undefined
  /** Bumped at every leadership change, so a promotion that a demotion overtook does not connect. */
  let leadership = 0

  async function startLeading() {
    const promotion = ++leadership
    await characterState.ready()
    if (promotion !== leadership || disconnectVoice)
      return
    disconnectVoice = situation.connect(stimulus => voice.answer(stimulus))
  }

  function stopLeading() {
    leadership += 1
    disconnectVoice?.()
    disconnectVoice = undefined
  }

  /** Lends the mind a stage's body; the result detaches it. The newest stage wins. */
  function attachStage(next: MindStage): () => void {
    const attached = { ...next }
    stages.push(attached)
    return () => {
      const index = stages.indexOf(attached)
      if (index !== -1)
        stages.splice(index, 1)
    }
  }

  /** Binds the mind to leadership: it connects to the gate while the window leads. Repeated calls keep the first. */
  function initialize(syncedPinia: SyncedPiniaRuntime) {
    stopLeadershipListener ??= syncedPinia.onLeadershipChange(isLeader => isLeader ? void startLeading() : stopLeading())
  }

  /** Stops the leadership subscription, disconnects from the gate, and clears the inspector's memory. */
  function dispose() {
    stopLeadershipListener?.()
    stopLeadershipListener = undefined
    stopLeading()
    stopInspector?.()
    stopInspector = undefined
    observability.publishReactionMemory(null)
  }

  return { mind, attachStage, initialize, dispose }
})
