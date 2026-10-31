import type { ExpressionPerformanceSettings, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { HeldSpec } from './emotions'
import type { Vec3 } from './posture'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

import { naturalEmotions } from './emotions'

/**
 * Adapter face units. Positive `oneSidedBrow` adds to the left brow, negative adds
 * its absolute value to the right. Add `browY` to both first. During side changes,
 * the common part of the two raises is included in `browY`, keeping both brows
 * continuous without exposing the layer's internal side state.
 */
export type HeldFaceOffsets = Required<HeldSpec['face']>
export type HeldModulation = HeldSpec['modulation']

const neutralFace: HeldFaceOffsets = {
  browY: 0,
  browAngle: 0,
  oneSidedBrow: 0,
  eyeSmile: 0,
  mouthForm: 0,
  eyeOpenMultiplier: 1,
  eyeOpenHint: 0,
  cheek: 0,
  mouthOpen: 0,
}
const neutralModulation: HeldModulation = {
  blinkInterval: 1,
  breathPeriod: 1,
  amplitude: 1,
  cameraFixation: 0,
  deskWeight: 0,
  nodSize: 1,
  nodAcceptance: 0,
}
const faceKeys = ['browY', 'browAngle', 'eyeSmile', 'mouthForm', 'eyeOpenMultiplier', 'eyeOpenHint', 'cheek', 'mouthOpen'] as const
const modulationKeys = ['blinkInterval', 'breathPeriod', 'amplitude', 'cameraFixation', 'deskWeight', 'nodSize', 'nodAcceptance'] as const
const axes = [0, 1, 2] as const

/** Sustained targets, independent of idle RNG. Time and settings are in seconds. */
export class NaturalHoldLayer {
  level = 0
  private held: { readonly emotion: PerformanceEmotion, readonly strength: number } | null = null
  private settings = defaultExpressionPerformanceSettings.held
  private strengths: Partial<Record<PerformanceEmotion, number>> = {}
  private changes = 0
  private currentSide: -1 | 1 = 1
  private currentFace = { ...neutralFace }
  private currentPosture: Vec3 = [0, 0, 0]
  private currentModulation = { ...neutralModulation }
  private leftBrow = 0
  private rightBrow = 0

  constructor(private readonly emotions = naturalEmotions) {}

  get emotion() {
    return this.held?.emotion ?? null
  }

  /** The commanded 0..1 strength of the held emotion, before per-model strengths; 0 while nothing is held. */
  get strength() {
    return this.held?.strength ?? 0
  }

  /** Sign of the sided posture axes; 1 raises the left brow. It keeps its last value after a release. */
  get side() {
    return this.currentSide
  }

  /** Invalid commands are ignored. Repeated commands neither reroll sides nor restart onset. */
  set(held: { readonly emotion: PerformanceEmotion, readonly strength: number } | null) {
    if (held && (!Number.isFinite(held.strength) || !Object.hasOwn(this.emotions, held.emotion)))
      return
    const next = held && this.emotions[held.emotion].held
      ? { emotion: held.emotion, strength: Math.max(0, Math.min(1, held.strength)) }
      : null
    if (next?.emotion !== this.held?.emotion && next) {
      this.changes++
      let hash = 0
      for (const letter of next.emotion)
        hash = (Math.imul(hash, 31) + letter.charCodeAt(0)) >>> 0
      this.currentSide = (hash + this.changes) % 2 === 0 ? 1 : -1
    }
    this.held = next
  }

  setSettings(settings: ExpressionPerformanceSettings['held']) {
    this.settings = { ...settings }
  }

  /** Persisted values are an input boundary: malformed entries use the default 1. */
  setStrengths(record: Partial<Record<PerformanceEmotion, number>>) {
    this.strengths = {}
    for (const emotion of ['happy', 'sad', 'angry', 'surprised', 'think', 'awkward', 'question', 'curious', 'love', 'flustered', 'sleepy', 'neutral'] as const) {
      const value = record[emotion]
      this.strengths[emotion] = Number.isFinite(value)
        ? Math.max(0, Math.min(2, value ?? 1))
        : 1
    }
  }

  step(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0)
      return
    const spec = this.held ? this.emotions[this.held.emotion].held : undefined
    const strength = this.held ? this.held.strength * (this.strengths[this.held.emotion] ?? 1) : 0
    const active = spec !== undefined && strength > 0
    const tau = active ? this.settings.onsetTau : this.settings.releaseTau
    const decay = tau === 0 ? 0 : Math.exp(-dt / tau)
    const postureDecay = this.settings.postureTau === 0 ? 0 : Math.exp(-dt / this.settings.postureTau)
    this.level = (active ? 1 : 0) + (this.level - (active ? 1 : 0)) * decay
    for (const key of faceKeys) {
      const rest = neutralFace[key]
      const target = active ? rest + (spec.face[key] - rest) * strength : rest
      this.currentFace[key] = target + (this.currentFace[key] - target) * decay
    }
    const brow = active ? (spec.face.oneSidedBrow ?? 0) * strength : 0
    const left = this.currentSide === 1 ? brow : 0
    const right = this.currentSide === -1 ? brow : 0
    this.leftBrow = left + (this.leftBrow - left) * decay
    this.rightBrow = right + (this.rightBrow - right) * decay
    for (const axis of axes) {
      const target = active ? spec.posture[axis] * strength * (spec.sided.includes(axis) ? this.currentSide : 1) : 0
      this.currentPosture[axis] = target + (this.currentPosture[axis] - target) * postureDecay
    }
    for (const key of modulationKeys) {
      const rest = neutralModulation[key]
      const target = active ? rest + (spec.modulation[key] - rest) * strength : rest
      this.currentModulation[key] = target + (this.currentModulation[key] - target) * decay
    }
    // Exact exponential until numerical rest, not an early visible-tail snap.
    // Posture can have a longer tau, so it must settle independently too.
    if (!active && this.level < 1e-12 && this.currentPosture.every(value => Math.abs(value) < 1e-12)) {
      this.level = 0
      this.currentFace = { ...neutralFace }
      this.currentPosture = [0, 0, 0]
      this.currentModulation = { ...neutralModulation }
      this.leftBrow = 0
      this.rightBrow = 0
    }
  }

  face(): HeldFaceOffsets {
    return {
      ...this.currentFace,
      browY: this.currentFace.browY + Math.min(this.leftBrow, this.rightBrow),
      oneSidedBrow: this.leftBrow - this.rightBrow,
    }
  }

  posture(): Vec3 {
    return [...this.currentPosture]
  }

  modulation(): HeldModulation {
    return { ...this.currentModulation }
  }
}
