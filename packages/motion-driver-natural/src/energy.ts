import type { PerformanceMode, PerformanceState } from '@proj-airi/stage-shared/performance-state'

/** Preset values that the posture and gaze layers read each grid step. */
interface Preset {
  /** Multiplies continuous motion and posture shifts. */
  amplitude: number
  /** Divides posture shift holds, so higher values shift more often. */
  shiftRate: number
  /** Probability that an autonomous fixation targets the camera. */
  cameraFixation: number
}

/** Per-mode presets (amplitude / shift rate / camera-fixation probability). */
const presets: Record<PerformanceMode, Preset> = {
  idle: { amplitude: 1, shiftRate: 1, cameraFixation: 0.5 },
  watching: { amplitude: 0.8, shiftRate: 0.7, cameraFixation: 0.25 },
  listening: { amplitude: 0.75, shiftRate: 0.6, cameraFixation: 0.85 },
  thinking: { amplitude: 1, shiftRate: 1.1, cameraFixation: 0.3 },
  talking: { amplitude: 1.15, shiftRate: 1.3, cameraFixation: 0.65 },
}

/** Fixed overlay for the seconds after a desktop reaction or a poke. Emotion episodes do not use it: their weight comes from the band tables. */
const reacting = { amplitude: 1.3, shiftRate: 1.5, seconds: 2 }
/** The user has left the desktop, so the character settles. */
const away = { amplitude: 0.7, shiftRate: 0.6 }

/** Cross-fade time constants (seconds): faster into talking so speech feels responsive, slower out of it. */
const fade = { default: 1, intoTalking: 0.7, outOfTalking: 1.5 }

/**
 * Longest pause (seconds) through which an ACT cue's attention outlives the reply mode.
 * Between speech clips of one reply the mode can leave talking for a few hundred ms;
 * shorter pauses keep the cue's gaze target, and longer ones release it.
 */
const cueGapSeconds = 0.6

/**
 * Relative selection weights of the non-camera fixation targets. The gaze layer splits
 * `1 - cameraFixationProbability` across them in proportion to these weights.
 */
export interface GazeTargetWeights {
  desk: number
  peripheral: number
  /** Thinking glances aside and up, at `(±0.15, +0.12)`. 0 disables the target. */
  peripheralUp: number
}

const defaultWeights: Readonly<GazeTargetWeights> = Object.freeze({ desk: 1, peripheral: 1, peripheralUp: 0 })

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

/**
 * Turns the performance state and user energy into posture and gaze scales.
 *
 * Preset values cross-fade through a first-order filter, so a mode change never jumps
 * the pose and no random process restarts. User energy `E` in [0, 1] scales amplitude by
 * `0.7 + 0.6E` and shift rate by `0.6 + 0.8E`; at `E = 0.5` both are 1, so idle at the
 * default energy leaves every layer exactly at its unscaled behavior.
 *
 * Time is seconds of active motion; the facade steps it on the fixed grid.
 */
export class NaturalPerformanceEnergy {
  /** Filtered amplitude scale for posture. */
  amplitudeScale = presets.idle.amplitude
  /** Filtered shift-rate scale for posture. */
  shiftRateScale = presets.idle.shiftRate
  /** Filtered camera-fixation probability for gaze. */
  cameraFixationProbability = presets.idle.cameraFixation
  /** Non-camera fixation weights; they change only which target the next fixation draws, so they switch without a fade. */
  targetWeights: Readonly<GazeTargetWeights> = defaultWeights
  /** Probability that a detected speech onset becomes an emphasis nod: `0.15 + 0.2E`. */
  emphasisAcceptance = 0.25
  /** Whether attention is `aside`; the gaze layer then holds an off-camera fixation instead of drawing targets. */
  aside = false
  /** Whether attention is `screen`; the facade then drops the cursor, so the desk-weighted fixations watch the screen. */
  screen = false
  /** Watching mode is independent of the attention cue gap. */
  watching = false

  /** Attention an ACT cue set while talking or thinking, or `null`; `camera` cannot be told apart from the default. */
  private cueAttention: 'aside' | 'screen' | null = null
  /** The state waiting while a cue holds through a pause, and the active time at which the hold ends. */
  private cueGap: { until: number, state: Pick<PerformanceState, 'mode' | 'attention'> } | null = null

  private mode: PerformanceMode = 'idle'
  private tau = fade.default
  private away = false
  private energy = 0.5
  private time = 0
  /** Active time at which the reacting overlay ends; later reactions extend it and never stack. */
  private reactingUntil = Number.NEGATIVE_INFINITY

  /** Talking suppresses chat attention immediately, independently of the preset cross-fade. */
  get talking(): boolean {
    return this.mode === 'talking'
  }

  /** Sets the target state; the filter moves toward it from the next step. */
  setState(state: Pick<PerformanceState, 'mode' | 'attention' | 'away'>, energy: number) {
    this.watching = state.mode === 'watching'
    if (state.mode !== this.mode) {
      // Leaving talking wins over the default, so talking -> listening also fades slowly.
      if (state.mode === 'talking')
        this.tau = fade.intoTalking
      else if (this.mode === 'talking')
        this.tau = fade.outOfTalking
      else
        this.tau = fade.default
      this.mode = state.mode
    }
    this.away = state.away
    this.energy = clamp01(Number.isFinite(energy) ? energy : 0.5)
    this.emphasisAcceptance = 0.15 + 0.2 * this.energy
    // A pause between speech clips keeps the cue's attention for up to cueGapSeconds, so the eyes
    // do not flick to the camera and back. Listening belongs to the user and ends the cue at once.
    const performing = state.mode === 'talking' || state.mode === 'thinking'
    if (!performing && state.mode !== 'listening' && this.cueAttention !== null) {
      this.cueGap = { until: this.cueGap?.until ?? this.time + cueGapSeconds, state: { mode: state.mode, attention: state.attention } }
      return
    }
    this.cueGap = null
    this.applyAttention(state)
  }

  /** Starts the reacting overlay at `at` (active seconds) for 2 s; overlapping reactions extend it and do not stack. */
  react(at: number) {
    this.reactingUntil = Math.max(this.reactingUntil, at + reacting.seconds)
  }

  /** Advances the cross-fade by `dt` seconds. */
  step(dt: number) {
    this.time += dt
    if (this.cueGap !== null && this.time >= this.cueGap.until) {
      const { state } = this.cueGap
      this.cueGap = null
      this.applyAttention(state)
    }
    const preset = presets[this.mode]
    const isReacting = this.time < this.reactingUntil
    const reactionAmplitude = isReacting ? reacting.amplitude - 1 : 0
    const reactionRate = isReacting ? reacting.shiftRate - 1 : 0
    const amplitude = preset.amplitude
      * (1 + reactionAmplitude)
      * (this.away ? away.amplitude : 1)
      // 0.7 + 0.6E, written around E = 0.5 so the default energy is exactly 1 in floating point.
      * (1 + 0.6 * (this.energy - 0.5))
    const shiftRate = preset.shiftRate
      * (1 + reactionRate)
      * (this.away ? away.shiftRate : 1)
      // 0.6 + 0.8E, likewise exact at E = 0.5.
      * (1 + 0.8 * (this.energy - 0.5))
    // Exact first-order update; a target equal to the state leaves it bit-identical.
    const decay = Math.exp(-dt / this.tau)
    this.amplitudeScale = amplitude + (this.amplitudeScale - amplitude) * decay
    this.shiftRateScale = shiftRate + (this.shiftRateScale - shiftRate) * decay
    this.cameraFixationProbability = preset.cameraFixation + (this.cameraFixationProbability - preset.cameraFixation) * decay
  }

  private applyAttention(state: Pick<PerformanceState, 'mode' | 'attention'>) {
    const performing = state.mode === 'talking' || state.mode === 'thinking'
    this.cueAttention = performing && (state.attention === 'aside' || state.attention === 'screen') ? state.attention : null
    this.aside = state.attention === 'aside'
    this.screen = state.attention === 'screen'
    // Screen attention outside watching comes from an ACT cue and weights the desk the same way.
    if (state.attention === 'screen')
      this.targetWeights = { ...defaultWeights, desk: 2 }
    else if (state.mode === 'thinking')
      this.targetWeights = { ...defaultWeights, peripheralUp: 1 }
    else
      this.targetWeights = defaultWeights
  }
}
