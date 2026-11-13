import type { MotionScenarioClass } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'
import type { RandomStream } from '@proj-airi/motion-driver-natural/random'
import type { Band, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { PerformanceMode } from '@proj-airi/stage-shared/performance-state'

import type { Motion3dIdleDrive } from './idle-drive'

import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { PERFORMANCE_EMOTIONS } from '@proj-airi/stage-shared/expression-performance'

import { QA_DRIVE_AWAY, QA_DRIVE_PRESENT } from './idle-drive'

export interface Motion3dScenario {
  /** Timeline version; a new version changes the cues, so traces of an older version are no longer its reference. */
  version: 1 | 2 | 3
  id: string
  class: MotionScenarioClass
  /** Simulated and discarded before scoring. */
  warmupSeconds: number
  /** Default scored length; --seconds overrides it, up to `maxSeconds`. */
  seconds: number
  /** Longest scored length the runner accepts; 120 s when omitted, 600 s for the idle-class scenarios (owner decision O1). */
  maxSeconds?: number
  /**
   * Records a `stance:<reason>` marker whenever the stance director's reason changes, from the first frame. Off unless
   * set, so the traces of scenarios that predate the marker stay byte-identical.
   */
  recordStance?: boolean
  /**
   * Natural's idle drive for the whole run, set before the first frame, so the idle scheduler runs and its start and
   * end reports are recorded as `idle:<kind>:<start|end>` markers. Unset leaves the scheduler inert, so the traces of
   * scenarios without a drive stay byte-identical. `--acts off` sets no drive.
   */
  idleDrive?: Motion3dIdleDrive
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
    /** Recorded as a `mode` event naming the mode, or `away` while the user is away. */
    | { at: number, kind: 'activity', mode: PerformanceMode, away?: boolean }
    | { at: number, kind: 'marker', label: string }
    /** User energy handed to Natural and the body, 0-1; the runner starts at 0.5. */
    | { at: number, kind: 'energy', level: number }
    /**
     * The chat panel at a point in head widths, as the gaze cursor; `unfold` reports a reply unfolding, the app's case
     * while she answers, so Natural glances at it. Null hides the chat.
     */
    | { at: number, kind: 'chat', target: { x: number, y: number } | null, unfold: boolean }
    /** The runner's synthetic right-arm clip starts or ends as the app's upper clip layer, with that layer's fade. */
    | { at: number, kind: 'clip-claim' | 'clip-release' }

/**
 * Plan 2.2 peaks: the first 0.6 to 1.0 s into the utterance, then seeded gaps of 0.9 to 1.5 s, so no two are closer
 * than 0.9 s and no stroke period is imposed; strengths 0.35 to 0.95.
 */
function peaksFor(count: number, random: RandomStream): { at: number, strength: number }[] {
  let at = 0.6 + 0.4 * random()
  return Array.from({ length: count }, (_, i) => {
    if (i > 0)
      at += 0.9 + 0.6 * random()
    return { at, strength: 0.35 + 0.6 * random() }
  })
}

/**
 * A 0.1 floor under one 80 ms Gaussian per labelled peak, sampled at 60 Hz. Unlike version 1 the peak's level is its
 * labelled strength, so a 0.95 peak stays inside the [0, 1] voice level.
 */
function voiceCue(at: number, seconds: number, emphasis: { at: number, strength: number }[]): Motion3dCue {
  const envelope = Array.from({ length: Math.ceil(seconds * 60) }, (_, frame) =>
    0.1 + Math.max(...emphasis.map(peak => (peak.strength - 0.1) * Math.exp(-(((frame / 60 - peak.at) / 0.08) ** 2)))))
  return { at, kind: 'voice', seconds, envelope, emphasis }
}

/** A chat panel 25 degrees to a seeded side and 10 degrees below the head, in head widths. */
function chatTarget(random: RandomStream): { x: number, y: number } {
  const side = random() < 0.5 ? -1 : 1
  return { x: 3 * Math.sin(side * 25 * Math.PI / 180), y: 3 * Math.sin(-10 * Math.PI / 180) }
}

const byTime = (a: Motion3dCue, b: Motion3dCue) => a.at - b.at

// A seeded observation marker carries no performer input: idle stays idle.
const idleTimeline: Motion3dScenario['timeline'] = (seed, seconds) => seconds > 0 ? [{ at: createRandomStream(seed)() * Math.min(1, seconds), kind: 'marker', label: 'observe-idle' }] : []

/**
 * Walk version 3 goals: scenario seconds and x in leg lengths. Each cue but the turn-around comes at the first 0.5 s mark
 * at least 2 s after the previous leg's arrival turn ends, as measured on version 2 (Chisa seed 1: legs of 25.48, 9.67,
 * 7.15 and 7.15 s from cue to arrival turn), so slower starts and stops still leave each turn in place. The third goal
 * comes 5 s after the second, behind her while she walks left (the turn-around); the last fires only in runs over 60 s.
 */
const WALK_GOALS = [[0.5, 19.5], [28, 8], [33, 19], [45, 16], [54.5, 19], [64, 16]] as const

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
    maxSeconds: 600,
    timeline: idleTimeline,
  },
  {
    /**
     * C001 (goal 4, owner decision "Idle wording: Amend it"): the `idle` timeline with the fixed QA idle drive (neutral
     * mood, daytime, the user present and inactive), so the idle scheduler decides her idle acts. Its `--acts off`
     * companion sets no drive.
     */
    version: 1,
    id: 'idle-drive',
    class: 'idle',
    warmupSeconds: 10,
    seconds: 60,
    maxSeconds: 600,
    idleDrive: QA_DRIVE_PRESENT,
    timeline: idleTimeline,
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
    /**
     * Version 2 (plan 2.2): three 8 s utterances, each with five labelled peaks at seeded spacings of at least 0.9 s
     * and strengths of 0.35 to 0.95, at a seeded order of the energies 0.45, 0.65 and 0.85 (0.5 again after each
     * utterance). During one seeded utterance a chat panel shows and unfolds a reply. No emotion pulse. A run shorter
     * than 60 s drops the utterances that do not fit.
     */
    version: 2,
    id: 'speak',
    class: 'talk',
    warmupSeconds: 10,
    seconds: 60,
    timeline(seed, seconds) {
      const random = createRandomStream(seed)
      const duration = Math.min(seconds, 120)
      const energies = shuffled([0.45, 0.65, 0.85], random)
      const chatTurn = Math.floor(random() * 3)
      const chat = chatTarget(random)
      return Array.from({ length: 3 }, (_, turn): Motion3dCue[] => {
        const at = (turn + 0.1 + 0.1 * random()) * 20
        const emphasis = peaksFor(5, random)
        const cues: Motion3dCue[] = [
          { at, kind: 'energy', level: energies[turn] },
          voiceCue(at, 8, emphasis),
          { at: at + 8, kind: 'energy', level: 0.5 },
        ]
        if (turn === chatTurn)
          cues.push({ at: at - 0.5, kind: 'chat', target: chat, unfold: true }, { at: at + 8, kind: 'chat', target: null, unfold: false })
        return at + 8 <= duration ? cues : []
      }).flat().sort(byTime)
    },
  },
  {
    /**
     * Plan 2.5 (C004), 30 s, class talk, with the app's upper-layer fade (smoothstep, 0.25 s in and 0.3 s out).
     * Version 3 (ownership report version 2, E/g3/own2/rules-v2.md) derives every time from the timeline itself, by one
     * rule for every seed:
     * - utterance A at 0.5 s (8 s, five peaks) at energy 0.85;
     * - the synthetic clip claims the right arm and fingers 50 ms after the A peak nearest 3 s, inside a stroke on it;
     * - a body poke lands 50 ms after the A peak nearest 5 s, inside utterance A's gesture unit, with the arm owned;
     * - utterance B at 8.5 s (10 s, six peaks): only the left arm may gesture;
     * - the clip releases 1.5 s after B ends, when no gesture unit can run, so the free left arm is out of a unit at
     *   release + 0.5 s;
     * - utterance C 2 s after the release (7 s, four peaks), with both arms free;
     * - revision B: the clip claims the right arm again 50 ms after C's first peak and releases it 50 ms after C's third,
     *   while C's gesture unit runs, so a stroke is in progress at that release and C's fourth peak remains for the arm
     *   to rejoin at.
     * Version 2 claimed at 3.0 s, poked near 12 s and released at 14 s; the seeded peaks are unchanged.
     */
    version: 3,
    id: 'gesture-under-clip',
    class: 'talk',
    warmupSeconds: 10,
    seconds: 30,
    timeline(seed, seconds) {
      const random = createRandomStream(seed)
      const a = peaksFor(5, random)
      const b = peaksFor(6, random)
      const c = peaksFor(4, random)
      const start = { a: 0.5, b: 8.5 }
      const afterA = (t: number) => start.a + a.reduce((best, peak) => Math.abs(start.a + peak.at - t) < Math.abs(start.a + best.at - t) ? peak : best).at + 0.05
      const release = start.b + 10 + 1.5
      const startC = release + 2
      const cues: Motion3dCue[] = [
        { at: start.a, kind: 'energy', level: 0.85 },
        voiceCue(start.a, 8, a),
        { at: afterA(3), kind: 'clip-claim' },
        voiceCue(start.b, 10, b),
        { at: afterA(5), kind: 'touch', touch: 'poke', region: 'body', x: random() * 2 - 1, y: random() * 2 - 1 },
        { at: release, kind: 'clip-release' },
        voiceCue(startC, 7, c),
        { at: startC + c[0].at + 0.05, kind: 'clip-claim' },
        { at: startC + c[2].at + 0.05, kind: 'clip-release' },
      ]
      return cues.filter(cue => cue.at < Math.min(seconds, 120)).sort(byTime)
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
    /**
     * Version 3 (goal 4, plan D1 as unit M revised it, with 2 s of slack after each leg): every goal at walk pace (owner
     * decision O5). A long leg to the right (about 22 s of walking, so the gate places three 10 s windows), back to the
     * left, a goal behind her while she walks left (the turn-around), then short legs, for 8 turns in 60 s. Goals are in
     * leg lengths and at least the director's goal dwell apart; only the seeded observation marker depends on the seed.
     */
    version: 3,
    id: 'walk',
    class: 'walk',
    warmupSeconds: 10,
    seconds: 60,
    timeline: (seed, seconds) => [
      { at: createRandomStream(seed)() * Math.min(1, seconds), kind: 'marker', label: 'observe-walk' } satisfies Motion3dCue,
      ...WALK_GOALS.map(([at, x]): Motion3dCue => ({ at, kind: 'goal', x, pace: 'walk' })),
    ].filter(cue => cue.at < Math.min(seconds, 120)).sort(byTime),
  },
  {
    /**
     * Plan C004 (goal 4): no stance clip is ever assigned. The 100 s warm-up puts the director's idle-to-sit time (120 s
     * after load) at 20 s of scenario time, so the clip-free rest fallback has 20 s of idle before the user goes away at
     * 40 s; input returns as `listening` at 80 s. Only the seeded observation marker depends on the seed. Version 2 sets
     * the QA idle drive with the user away from 40 s, so the idle scheduler falls asleep 12 to 30 s after the away cue.
     */
    version: 2,
    id: 'sleepy-no-clip',
    class: 'idle',
    warmupSeconds: 100,
    seconds: 120,
    maxSeconds: 600,
    recordStance: true,
    idleDrive: QA_DRIVE_AWAY,
    timeline: (seed, seconds) => ([
      { at: 0, kind: 'activity', mode: 'idle' },
      { at: createRandomStream(seed)() * Math.min(1, seconds), kind: 'marker', label: 'observe-sleepy' },
      { at: 40, kind: 'activity', mode: 'idle', away: true },
      { at: 80, kind: 'activity', mode: 'listening' },
    ] satisfies Motion3dCue[]).filter(cue => cue.at < seconds).sort(byTime),
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
