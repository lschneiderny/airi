import type { CharacterMind, MindIntent, MindStimulus, VoiceLine } from '@proj-airi/character-mind'
import type { GateOutcome, ReturnObservation, TouchObservation, TouchVoiceView, UrgeGateDecision, UrgeGateMemory, WakeObservation } from '@proj-airi/stage-shared/situation'

import { errorMessageFrom } from '@moeru/std'

/** The stimuli the voice port sends to the mind of the connected stage. */
export type VoiceStimulus = Extract<MindStimulus, { kind: 'voice-tick' | 'user-turn' | 'external-speech' }>

/**
 * The voice channel the mind can reach: the leader's situation store. It senses and folds the situation, runs the
 * lines the mind decides, and stores what the mind publishes; the mind decides whether and when she speaks.
 */
export interface VoicePort {
  /** Records the touch in the situation and returns what the mind may see of it, or null when nobody could speak a line. */
  observeTouch: (observation: TouchObservation) => TouchVoiceView | null
  /** Records a return or a desktop wake in the situation. Does nothing in a follower window. */
  observeReturn: (observation: ReturnObservation | WakeObservation) => void
  /**
   * Starts the line's turn and resolves with what became of it: at the first spoken literal, at a decline, or with
   * the turn's result. Resolves `refused` without sending while another unprompted turn is pending, and `failed` in
   * a follower window, while the gate loop does not run, or when a touch line's event is gone.
   */
  speak: (turnId: string, line: VoiceLine) => Promise<GateOutcome | 'refused'>
  /** Mirrors, saves, and publishes the voice state after a step that touched it. `wakeAtMs` is always null in CM3a. */
  publishVoice: (update: { runId: number, memory: UrgeGateMemory, decision: UrgeGateDecision | null, wakeAtMs: number | null }) => void
  /** Hands the port this stage's way to send it a voice stimulus. The newest connection wins; the result disconnects. */
  connect: (send: (stimulus: VoiceStimulus) => void) => () => void
}

/**
 * The voice side of one character mind: every step that may touch the voice state goes through {@link receive}, so
 * the port sees each new gate memory and gate decision, and {@link speak} runs a `speak` intent and returns its
 * outcome to the mind as a `voice-outcome` stimulus with the same `turnId`.
 */
export class MindVoice {
  constructor(private readonly mind: CharacterMind, private readonly voice: () => VoicePort | undefined) {}

  /** Answers the stimuli in one step, publishes the voice state when the step changed it, and returns the intents. */
  receive(...stimuli: MindStimulus[]): MindIntent[] {
    const before = this.mind.state.voice
    const intents = this.mind.receive(...stimuli)
    const after = this.mind.state.voice
    const decision = after.lastGate !== before.lastGate ? after.lastGate : null
    if (after.gate !== null && after.runId !== null && (after.gate !== before.gate || decision !== null))
      this.voice()?.publishVoice({ runId: after.runId, memory: after.gate, decision, wakeAtMs: null })
    return intents
  }

  /** Answers one stimulus of the voice port and speaks every line the step decided, in intent order. */
  answer(stimulus: VoiceStimulus): void {
    for (const intent of this.receive(stimulus)) {
      if (intent.kind === 'speak')
        void this.speak(intent)
    }
  }

  /** Runs the line and tells the mind what became of it, so its line always settles. */
  async speak(intent: Extract<MindIntent, { kind: 'speak' }>): Promise<void> {
    let outcome: GateOutcome | 'refused' = 'failed'
    try {
      outcome = await this.voice()?.speak(intent.turnId, intent.line) ?? 'failed'
    }
    catch (error) {
      console.error('[mind-voice] Voice line failed:', errorMessageFrom(error) ?? 'unknown error')
    }
    this.receive({ kind: 'voice-outcome', turnId: intent.turnId, outcome })
  }
}
