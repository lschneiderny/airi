import type { CharacterMind, MindIntent, MindStimulus, VoiceLine } from '@proj-airi/character-mind'
import type { GateOutcome, ReturnObservation, TouchObservation, TouchVoiceView, UrgeGateDecision, UrgeGateMemory, WakeObservation } from '@proj-airi/stage-shared/situation'

import { errorMessageFrom } from '@moeru/std'
import { nextVoiceWakeAt } from '@proj-airi/character-mind'

/** The stimuli the voice port sends to the connected mind. */
export type VoiceStimulus = Extract<MindStimulus, { kind: 'voice-tick' | 'user-turn' | 'voice-request' }>

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
  /** Cancels the chat turn of a widget line that has not spoken by its caller's deadline; its caller gets `cancelled`. */
  cancel: (turnId: string) => void
  /** Answers the caller of a widget request that the mind gave up before it started, with `cancelled`. */
  drop: (turnId: string) => void
  /**
   * Mirrors, saves, and publishes the voice state after a step that touched it. `wakeAtMs` is the mind's next widget
   * deadline, or null without one: the port ticks the mind then, so the deadline does not wait for the next interval.
   */
  publishVoice: (update: { runId: number, memory: UrgeGateMemory, decision: UrgeGateDecision | null, wakeAtMs: number | null }) => void
  /** Hands the port the mind's way to send it a voice stimulus. The newest connection wins; the result disconnects. */
  connect: (send: (stimulus: VoiceStimulus) => void) => () => void
}

/**
 * The voice side of one character mind: every step that may touch the voice state goes through {@link receive}, so
 * the port sees each new gate memory and gate decision, and {@link speak} runs a `speak` intent and returns its
 * outcome to the mind as a `voice-outcome` stimulus with the same `turnId`.
 */
export class MindVoice {
  /** `cue` performs the body around a reach-out or widget line; the conductor gates it by driver. */
  constructor(
    private readonly mind: CharacterMind,
    private readonly voice: () => VoicePort | undefined,
    private readonly cue: (cue: Extract<MindIntent, { kind: 'cue' }>['cue']) => void,
  ) {}

  /** Answers the stimuli in one step, publishes the voice state when the step changed it, and returns the intents. */
  receive(...stimuli: MindStimulus[]): MindIntent[] {
    const before = this.mind.state.voice
    const intents = this.mind.receive(...stimuli)
    const after = this.mind.state.voice
    const decision = after.lastGate !== before.lastGate ? after.lastGate : null
    const wakeAtMs = nextVoiceWakeAt(after)
    if (after.gate !== null && after.runId !== null && (after.gate !== before.gate || decision !== null || wakeAtMs !== nextVoiceWakeAt(before)))
      this.voice()?.publishVoice({ runId: after.runId, memory: after.gate, decision, wakeAtMs })
    return intents
  }

  /** Answers one stimulus of the voice port and runs its intents in order: cues, lines, cancels, and drops. */
  answer(stimulus: VoiceStimulus): void {
    for (const intent of this.receive(stimulus)) {
      if (intent.kind === 'cue')
        this.cue(intent.cue)
      else if (intent.kind === 'speak')
        void this.speak(intent)
      else if (intent.kind === 'cancel')
        this.voice()?.cancel(intent.turnId)
      else if (intent.kind === 'drop')
        this.voice()?.drop(intent.turnId)
    }
  }

  /** Runs the line and tells the mind what became of it, so its line always settles; a decline may yield a cue. */
  async speak(intent: Extract<MindIntent, { kind: 'speak' }>): Promise<void> {
    let outcome: GateOutcome | 'refused' = 'failed'
    try {
      outcome = await this.voice()?.speak(intent.turnId, intent.line) ?? 'failed'
    }
    catch (error) {
      console.error('[mind-voice] Voice line failed:', errorMessageFrom(error) ?? 'unknown error')
    }
    for (const answer of this.receive({ kind: 'voice-outcome', turnId: intent.turnId, outcome })) {
      if (answer.kind === 'cue')
        this.cue(answer.cue)
    }
  }
}
