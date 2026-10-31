import type { HeadPulse } from './impulses'
import type { NaturalPostureLayers, Vec3 } from './posture'
import type { RandomStream } from './random'

import { headPulseOffset } from './impulses'

/** Envelope follower time constants (seconds): the fast one tracks syllables, the slow one the phrase level. */
const envelope = { fast: 0.04, slow: 0.25 }
/** Onset hysteresis: trigger when the onset crosses up through `trigger`, rearm once it falls below `rearm`. */
const onset = { trigger: 0.1, rearm: 0.04 }
/** Minimum seconds between two emphases, so loud speech cannot nod continuously. */
const refractorySeconds = 1.2
/** Emphasis size (normalized head units). */
const size = { min: 0.02, max: 0.05 }
/** Share of emphases that nod pitch down; the rest tilt (roll) to a random side. */
const nodShare = 0.8
// Envelope time constant (seconds) of one emphasis. It reuses the emotion impulse range so
// emphases share the impulse shape.
const tauRange = { min: 0.25, max: 0.5 }
// A posture shift due within this many seconds of a speech onset starts at the onset instead.
// See `SpeechOnsetShifts` for why this exists.
const onsetShiftWindow = 1

/**
 * Speech onset detector: the voice rising above its recent level.
 *
 * The input is the lipsync mouth level `a` in [0, 1], the scene's `mouthOpenSize` unscaled. Two first-order
 * envelopes (40 ms and 250 ms) give the onset `o = max(0, fast - slow)`, which is large when
 * the voice rises above its recent level. An up-cross of 0.10 is an onset; the detector
 * rearms once `o` falls below 0.04. Natural speech emphasis and the stage's `emphasis` timing
 * event share this detector, so both see the same onsets; each applies its own refractory period.
 */
export class SpeechOnsetDetector {
  private fast = 0
  private slow = 0
  private armed = true

  /** Advances by `dt` seconds with mouth level `level`; true when an onset up-crosses the trigger. */
  step(dt: number, level: number): boolean {
    const input = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0))
    this.fast = input + (this.fast - input) * Math.exp(-dt / envelope.fast)
    this.slow = input + (this.slow - input) * Math.exp(-dt / envelope.slow)
    const o = Math.max(0, this.fast - this.slow)
    if (!this.armed && o < onset.rearm)
      this.armed = true
    if (this.armed && o >= onset.trigger) {
      this.armed = false
      return true
    }
    return false
  }
}

/**
 * Speech emphasis: small head beats on speech onsets.
 *
 * Each onset of {@link SpeechOnsetDetector} is a candidate. A candidate becomes an emphasis with probability
 * `acceptance` (set from user energy) unless one happened in the last 1.2 s. Each emphasis
 * is a 0.02-0.05 head pulse: 80% pitch-down nod, 20% roll tilt.
 *
 * Time is seconds of active motion; the facade steps it on the fixed grid.
 */
export class NaturalSpeechEmphasis {
  /** Scales accepted pulse magnitudes after sampling; timing and draws are unchanged. @default 1 */
  sizeScale = 1

  /** Increments per accepted emphasis, so callers and diagnostics can count them. */
  emphasisCount = 0
  /** Increments per detected onset (up-cross of 0.10), before the refractory period and acceptance sampling. */
  onsetCount = 0

  private readonly pulses: HeadPulse[] = []
  private readonly onsets = new SpeechOnsetDetector()
  private time = 0
  private lastEmphasisAt = Number.NEGATIVE_INFINITY

  constructor(private readonly random: RandomStream) {}

  /**
   * Advances by `dt` seconds with mouth level `level` and returns the head offset.
   * `acceptance` is the probability that a detected onset becomes an emphasis.
   */
  step(dt: number, level: number, acceptance: number): Vec3 {
    this.time += dt
    if (this.onsets.step(dt, level)) {
      this.onsetCount++
      // The acceptance draw happens only outside the refractory window, so a long
      // refractory stretch does not consume the random stream differently.
      if (this.time - this.lastEmphasisAt >= refractorySeconds && this.random() < acceptance)
        this.emphasize()
    }
    return headPulseOffset(this.pulses, this.time)
  }

  private emphasize() {
    this.lastEmphasisAt = this.time
    this.emphasisCount++
    const magnitude = (size.min + (size.max - size.min) * this.random()) * this.sizeScale
    const tau = tauRange.min + (tauRange.max - tauRange.min) * this.random()
    let peak: Vec3
    if (this.random() < nodShare)
      peak = [0, -magnitude, 0]
    else
      peak = [0, 0, (this.random() < 0.5 ? -1 : 1) * magnitude]
    this.pulses.push({ start: this.time, tau, peak })
  }
}

/**
 * Phrase-onset locking of posture shifts while speaking.
 *
 * It exists to meet the liveliness gate's talking criterion `onsetEnrichment > 1.2`. Emphasis nods alone (0.02-0.05 at ~25% acceptance) lift head
 * speed in the 0.4 s after a phrase onset by only about 0-5% against the ~6 units/s talking
 * baseline, so a larger onset-locked motion is needed. It follows the blink-advance pattern:
 * when an onset is detected (before acceptance sampling) and a posture shift is already due
 * within 1 s, that shift starts at the onset. Shifts move earlier and are never added;
 * `advanceShift` returns the advanced time to the next hold, so the shift rate is unchanged.
 *
 * Call `update` once per grid step after stepping the emphasis detector and before stepping posture.
 */
export class SpeechOnsetShifts {
  private seenOnsets = 0

  /** `speaking` gates the rule to active speech; onsets seen while silent are only recorded. */
  update(posture: Pick<NaturalPostureLayers, 'secondsUntilShift' | 'advanceShift'>, emphasis: Pick<NaturalSpeechEmphasis, 'onsetCount'>, speaking: boolean) {
    const fresh = emphasis.onsetCount !== this.seenOnsets
    this.seenOnsets = emphasis.onsetCount
    if (!fresh || !speaking)
      return
    const untilShift = posture.secondsUntilShift
    if (untilShift <= onsetShiftWindow)
      posture.advanceShift(untilShift)
  }
}
