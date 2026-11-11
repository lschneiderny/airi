import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { NaturalChatInput, NaturalMotionVoice } from '@proj-airi/motion-driver-natural/natural-motion'
import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'
import type { MMDNaturalAdapter } from '@proj-airi/stage-ui-mmd/composables/mmd/natural/adapter'
import type { MMDStanceWorld } from '@proj-airi/stage-ui-mmd/composables/mmd/stance'

import type { Motion3dCue } from '../scenarios'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

/**
 * A hand resting on the mouse: a held scripted cursor circles its target by this visual angle, in radians, at this
 * rate. Natural's cursor attention keeps interest only while the cursor moves (`moveStep`, `restHold`), as a user's
 * cursor does in the app. The circle runs in angle space because cursors map to angles by `asin(x / 3)`, so an offset
 * in head widths would leave that domain at the 80-degree targets.
 */
const HAND = { radius: Math.PI / 180, hz: 1 }

/** The runner's synthetic clip; the driver only says when it claims and releases the arm. */
export interface Motion3dClipControl {
  claim: () => void
  release: () => void
}

/** Owns the scenario's mutable performer inputs and labels every applied cue. */
export class Motion3dCueDriver {
  cursor: { x: number, y: number } | null = null
  /** User energy for Natural and the body; 0.5 until an `energy` cue. */
  energy = 0.5
  /** Natural's chat input; null until a `chat` cue shows the panel. */
  chat: NaturalChatInput | null = null
  private held: { readonly cursor: { readonly x: number, readonly y: number }, readonly since: number } | null = null
  debugGoal: MMDStanceWorld['debugGoal'] = null
  goalCancelled = false
  private sequence = 0
  private activity: PerformanceState = { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }
  private speech: { cue: Extract<Motion3dCue, { kind: 'voice' }>, start: number, peak: number } | null = null
  private currentVoice: NaturalMotionVoice = { speaking: false, speechActiveOrRecent: false, level: 0 }

  constructor(
    private readonly adapter: Pick<MMDNaturalAdapter, 'impulse' | 'gesture' | 'poke' | 'setPet'>,
    private readonly legLength: number,
    private readonly event: (event: MotionTraceEvent) => void,
    private readonly clip: Motion3dClipControl | null = null,
  ) {}

  get voice(): NaturalMotionVoice { return this.currentVoice }
  get performance(): PerformanceState {
    return { ...this.activity, mode: this.currentVoice.speaking ? 'talking' : this.activity.mode }
  }

  apply(cue: Motion3dCue, t: number): void {
    switch (cue.kind) {
      case 'gaze':
        this.cursor = cue.cursor
        this.held = cue.cursor ? { cursor: cue.cursor, since: t } : null
        this.activity.attention = cue.cursor ? 'cursor' : 'camera'
        this.event(cue.cursor
          ? { t, kind: 'gaze-jump', yaw: Math.asin(cue.cursor.x / 3), pitch: Math.asin(cue.cursor.y / 3), source: 'scenario' }
          : { t, kind: 'marker', label: 'gaze-clear' })
        return
      case 'voice':
        this.speech = { cue, start: t, peak: 0 }
        this.event({ t, kind: 'marker', label: 'voice-start' })
        return
      case 'emotion': {
        const intensity = defaultExpressionPerformanceSettings.intensity[cue.band]
        this.adapter.impulse({
          id: cue.trialId ?? `emotion-${++this.sequence}`,
          emotion: cue.emotion,
          nominal: intensity,
          intensity,
          band: cue.band,
          escalation: false,
        })
        this.event({ t, kind: 'emotion', emotion: cue.emotion, band: cue.band, phase: 'pulse', ...(cue.trialId ? { trialId: cue.trialId } : {}) })
        return
      }
      case 'placebo':
        this.event({ t, kind: 'emotion', emotion: 'neutral', band: 'clear', phase: 'placebo', trialId: cue.trialId })
        return
      case 'gesture':
        this.adapter.gesture(cue.gesture, cue.count ?? 1)
        this.event({ t, kind: 'gesture', gesture: cue.gesture })
        return
      case 'touch':
        switch (cue.touch) {
          case 'poke':
            this.adapter.poke(cue.region, { x: cue.x, y: cue.y })
            break
          case 'pet-start':
            this.adapter.setPet({ x: cue.x, y: cue.y })
            break
          case 'pet-end':
            this.adapter.setPet(null)
            break
          default: cue.touch satisfies never
        }
        this.event({ t, kind: 'touch', touch: cue.touch, region: cue.region })
        return
      case 'goal':
        this.debugGoal = cue.x === null ? null : { seq: ++this.sequence, x: cue.x * this.legLength, pace: cue.pace }
        this.goalCancelled = cue.x === null
        this.event({ t, kind: 'goal', x: this.debugGoal?.x ?? null, pace: this.debugGoal?.pace ?? null })
        return
      case 'activity':
        this.activity.mode = cue.mode
        this.activity.away = cue.away ?? false
        this.event({ t, kind: 'mode', mode: cue.mode })
        return
      case 'marker':
        this.event({ t, kind: 'marker', label: cue.label })
        return
      case 'energy':
        this.energy = cue.level
        this.event({ t, kind: 'marker', label: `energy:${cue.level}` })
        return
      case 'chat': {
        const unfoldSeq = (this.chat?.unfoldSeq ?? 0) + (cue.unfold ? 1 : 0)
        this.chat = cue.target ? { target: { ...cue.target }, typing: false, sentSeq: 0, sentWords: 0, unfoldSeq } : null
        this.event({ t, kind: 'marker', label: cue.target ? `chat:show${cue.unfold ? ':unfold' : ''}` : 'chat:hide' })
        return
      }
      case 'clip-claim':
      case 'clip-release':
        if (!this.clip)
          throw new TypeError(`${cue.kind} needs the runner's clip`)
        if (cue.kind === 'clip-claim')
          this.clip.claim()
        else
          this.clip.release()
        this.event({ t, kind: 'marker', label: cue.kind })
        return
      default:
        cue satisfies never
    }
  }

  step(t: number): void {
    if (this.held) {
      const phase = 2 * Math.PI * HAND.hz * (t - this.held.since)
      const yaw = Math.asin(this.held.cursor.x / 3) + HAND.radius * (Math.cos(phase) - 1) * Math.sign(this.held.cursor.x || 1)
      const pitch = Math.asin(this.held.cursor.y / 3) + HAND.radius * Math.sin(phase)
      this.cursor = { x: 3 * Math.sin(yaw), y: 3 * Math.sin(pitch) }
    }
    const speech = this.speech
    if (!speech)
      return
    const elapsed = t - speech.start
    while (speech.peak < speech.cue.emphasis.length && speech.cue.emphasis[speech.peak].at <= elapsed + 1e-9) {
      const peak = speech.cue.emphasis[speech.peak++]
      this.event({ t, kind: 'emphasis', strength: peak.strength, source: 'scenario' })
    }
    const speaking = elapsed + 1e-9 < speech.cue.seconds
    this.currentVoice = {
      speaking,
      speechActiveOrRecent: speaking,
      level: speaking ? speech.cue.envelope[Math.floor(elapsed * 60 + 1e-9)] ?? 0 : 0,
    }
    if (!speaking) {
      this.speech = null
      this.event({ t, kind: 'marker', label: 'voice-end' })
    }
  }
}
