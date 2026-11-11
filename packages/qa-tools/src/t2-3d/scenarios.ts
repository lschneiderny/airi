import type { MotionScenarioClass } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'
import type { RandomStream } from '@proj-airi/motion-driver-natural/random'
import type { Band, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceMode } from '@proj-airi/stage-shared/performance-state'

import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { PERFORMANCE_EMOTIONS } from '@proj-airi/stage-shared/expression-performance'

export interface Motion3dScenario {
  version: 1
  id: string
  class: MotionScenarioClass
  /** Simulated and discarded before scoring. */
  warmupSeconds: number
  /** Default scored length; --seconds overrides it, within the v1 120 s cap. */
  seconds: number
  /** Pure timeline in seconds from scoring start; negative times are warm-up. */
  timeline: (seed: number, seconds: number) => Motion3dCue[]
}

export type Motion3dCue
  /**
   * Gaze cursor is in head widths: x=3*sin(yaw), y=3*sin(pitch).
   * Targets are three head widths from the head; yaw/pitch are in [-90,90].
   * Reconstruct degrees as yaw=asin(x/3)*180/pi, pitch=asin(y/3)*180/pi,
   * then use design 10.1's world-point formula.
   * A zero cursor explicitly targets forward; null clears the target.
   */
  = | { at: number, kind: 'gaze', cursor: { x: number, y: number } | null }
    | { at: number, kind: 'voice', seconds: number, envelope: number[], emphasis: { at: number, strength: number }[] }
    | { at: number, kind: 'emotion', emotion: PerformanceEmotion, band: Band, trialId?: string }
    | { at: number, kind: 'placebo', trialId: string }
    | { at: number, kind: 'gesture', gesture: CueGestureKind, count?: number }
    | { at: number, kind: 'touch', touch: 'poke' | 'pet-start' | 'pet-end', region: 'head' | 'body', x: number, y: number }
    | { at: number, kind: 'goal', x: number | null, pace: 'stroll' | 'walk' }
    | { at: number, kind: 'activity', mode: PerformanceMode, away?: boolean }
    | { at: number, kind: 'marker', label: string }

function shuffled<T>(values: readonly T[], random: RandomStream): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/**
 * Each 120 s emotions run has six pulses and two placebos, 12 s apart in the
 * first 100 s, then nod/shake/shrug/lean/glance once each in the last 20 s.
 * With E=PERFORMANCE_EMOTIONS, k=(seed-1) mod 6 and p=floor(k/2), rotate E by
 * 3p and take its first half for even k or second half for odd k. Seeds 1..6
 * give each emotion three trials and twelve placebos. Run seeds 1..6 and gate
 * them together; higher seeds repeat the sets in different seeded orders.
 * Shorter runs truncate trials; the full pooling guarantee requires 120 s.
 */
export const motion3dScenarios: readonly Motion3dScenario[] = [
  {
    version: 1,
    id: 'idle',
    class: 'idle',
    warmupSeconds: 10,
    seconds: 60,
    // A seeded observation marker carries no performer input: idle stays idle.
    timeline: (seed, seconds) => seconds > 0 ? [{ at: createRandomStream(seed)() * Math.min(1, seconds), kind: 'marker', label: 'observe-idle' }] : [],
  },
  {
    version: 1,
    id: 'gaze-shift',
    class: 'gaze',
    warmupSeconds: 10,
    seconds: 60,
    timeline(seed, seconds) {
      const random = createRandomStream(seed)
      const cues: Motion3dCue[] = []
      let at = 0
      let angles: number[] = []
      const duration = Math.min(seconds, 120)
      for (let i = 0; at < duration; i++) {
        if (i % 6 === 0)
          angles = shuffled([-80, -40, -15, 15, 40, 80], random)
        cues.push({ at, kind: 'gaze', cursor: { x: 3 * Math.sin(angles[i % 6] * Math.PI / 180), y: 0 } })
        at += 3 + 2 * random()
        if (at < duration)
          cues.push({ at, kind: 'gaze', cursor: { x: 0, y: 0 } })
        at += 2 + 2 * random()
      }
      return cues
    },
  },
  {
    version: 1,
    id: 'speak',
    class: 'talk',
    warmupSeconds: 10,
    seconds: 60,
    timeline(seed, seconds) {
      const random = createRandomStream(seed)
      const duration = Math.min(seconds, 120)
      if (duration <= 0)
        return []
      return Array.from({ length: 3 }, (_, turn): Motion3dCue => {
        const length = Math.min(8, duration / 6)
        const emphasis = [0.2, 0.4, 0.6, 0.8].map(fraction => ({ at: fraction * length, strength: 0.5 + 0.4 * random() }))
        const envelope = Array.from({ length: Math.ceil(length * 60) }, (_, frame) =>
          0.1 + Math.max(...emphasis.map(peak => peak.strength * Math.exp(-(((frame / 60 - peak.at) / 0.08) ** 2)))))
        return { at: (turn + 0.1 + 0.1 * random()) * duration / 3, kind: 'voice', seconds: length, envelope, emphasis }
      })
    },
  },
  {
    version: 1,
    id: 'emotions',
    class: 'emotion',
    warmupSeconds: 10,
    seconds: 120,
    timeline(seed, seconds) {
      const duration = Math.min(seconds, 120)
      if (duration <= 0)
        return []
      const random = createRandomStream(seed)
      const k = ((seed - 1) % 6 + 6) % 6
      const start = 3 * Math.floor(k / 2) + (k % 2) * 6
      const trials: Motion3dCue[] = Array.from({ length: 6 }, (_, i) => ({
        at: 0,
        kind: 'emotion',
        emotion: PERFORMANCE_EMOTIONS[(start + i) % 12],
        band: 'clear',
        trialId: `s${seed}-emotion-${i}`,
      }))
      trials.push({ at: 0, kind: 'placebo', trialId: `s${seed}-placebo-0` }, { at: 0, kind: 'placebo', trialId: `s${seed}-placebo-1` })
      const gestureStart = Math.max(0, duration - 20)
      const lead = 1 + random()
      const cues = shuffled(trials, random).map((cue, i) => ({ ...cue, at: lead + i * 12 })).filter(cue => cue.at < gestureStart)
      const gestures = shuffled<CueGestureKind>(['nod', 'shake', 'shrug', 'lean', 'glance'], random)
      return [
        ...cues,
        ...gestures.map((gesture, i): Motion3dCue => ({ at: gestureStart + i * Math.min(4, duration / 5), kind: 'gesture', gesture })),
      ]
    },
  },
  {
    version: 1,
    id: 'walk',
    class: 'walk',
    warmupSeconds: 10,
    seconds: 120,
    timeline(seed, seconds) {
      const random = createRandomStream(seed)
      const duration = Math.min(seconds, 120)
      return Array.from({ length: Math.ceil(duration / 60) }, (_, i): Motion3dCue => ({
        at: i * 60 + random() * Math.min(1, duration - i * 60),
        kind: 'goal',
        x: i % 2 === 0 ? 30 : 0,
        pace: random() < 0.5 ? 'stroll' : 'walk',
      }))
    },
  },
  {
    version: 1,
    id: 'touch',
    class: 'react',
    warmupSeconds: 10,
    seconds: 60,
    timeline(seed, seconds) {
      const random = createRandomStream(seed)
      return Array.from({ length: Math.floor(Math.min(seconds, 120) / 6) }, (_, i): Motion3dCue => ({
        at: (i + 0.2 + random() * 0.2) * 6,
        kind: 'touch',
        touch: 'poke',
        region: random() < 0.5 ? 'head' : 'body',
        x: random() * 2 - 1,
        y: random() * 2 - 1,
      }))
    },
  },
]
