import type { Series, Track } from './track'

import { NaturalMotion } from '@proj-airi/motion-driver-natural'

export interface ReplayOptions {
  readonly seed: number
  /** Natural's pep in [0, 1], set before the warm-up. */
  readonly pep: number
  /** When set, the mood valence is set to this once a second so it stays there. */
  readonly valence: number | null
  /** User energy, 0..1 with 0.5 neutral. */
  readonly energy: number
  /** When set, beats at this tempo and a repeated idle sway replace the talking drive. */
  readonly beatBpm: number | null
}

export const DEFAULT_REPLAY: ReplayOptions = { seed: 1, pep: 0, valence: null, energy: 0.5, beatBpm: null }

/** Seconds Natural runs before the track starts, so its slow processes are past their start. */
export const WARMUP_SECONDS = 180
/** Talking means voiced within this many seconds, as in the fingerprint. */
const TALK_RECENT_SECONDS = 0.4

export const REPLAY_TRACKER = 'natural-replay 1'

const round = (value: number): number => Math.round(value * 1e4) / 1e4

/**
 * Drives a headless `NaturalMotion` with a track's voice at the track's frame times and records the commanded head
 * as a `natural` track: tilt in degrees (30 per unit of head roll, as on Live2D), the head position in Natural's units,
 * and the eye opening. The voice is copied, so the fingerprint's talk measures use the same frames.
 */
export function replayTrack(track: Track, options: ReplayOptions = DEFAULT_REPLAY): Track {
  const { fps } = track
  const motion = new NaturalMotion({ seed: options.seed })
  if (options.pep !== 0)
    motion.setPep(options.pep, 0)
  let nextMood = 0
  const keepMood = (t: number) => {
    if (options.valence === null)
      return
    while (nextMood <= t) {
      motion.setMood({ valence: options.valence, arousal: 0, tension: 0 }, nextMood)
      nextMood += 1
    }
  }

  const beatSeconds = options.beatBpm === null ? null : 60 / options.beatBpm
  let nextBeat = 0
  let swayOrders = 0
  let swayWanted = beatSeconds !== null
  const feedBeats = (t: number) => {
    if (beatSeconds === null)
      return
    for (; nextBeat <= t; nextBeat += beatSeconds)
      motion.beat(beatSeconds, nextBeat)
  }
  const keepSway = (t: number) => {
    if (!swayWanted)
      return
    swayWanted = false
    motion.idle({ id: `sway-${swayOrders}`, kind: 'act', act: 'sway', seed: options.seed * 1000 + swayOrders, requested: true }, t)
    swayOrders++
  }
  const stopListening = motion.onIdleReports((reports) => {
    for (const report of reports) {
      if ((report.kind === 'ended' && report.act === 'sway') || (report.kind === 'refused' && report.intentId.startsWith('sway-')))
        swayWanted = true
    }
  })
  if (beatSeconds !== null)
    motion.setIdleDrive({ energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, rate: 0 }, 0)

  for (let i = 0; i * (1 / fps) < WARMUP_SECONDS; i++) {
    const t = i / fps
    keepMood(t)
    feedBeats(t)
    keepSway(t)
    motion.advance(t)
  }

  const recent = Math.round(TALK_RECENT_SECONDS * fps)
  const channels: Record<'tilt' | 'x' | 'y' | 'scale' | 'eyeOpen' | 'bodyTilt', Series> = { tilt: [], x: [], y: [], scale: [], eyeOpen: [], bodyTilt: [] }
  let lastVoiced = -Infinity
  track.voice.voiced.forEach((voiced, i) => {
    const t = WARMUP_SECONDS + i / fps
    keepMood(t)
    feedBeats(t)
    keepSway(t)
    if (voiced)
      lastVoiced = i
    const talking = beatSeconds === null && i - lastVoiced <= recent
    motion.setPerformance({ mode: talking ? 'talking' : 'idle', attention: 'camera', away: false }, options.energy, t)
    motion.setVoice({ speaking: talking, speechActiveOrRecent: talking, level: talking ? track.voice.level[i] : 0 })
    const frame = motion.advance(t)
    channels.tilt.push(round(frame.pose.headZ * 30))
    channels.x.push(round(frame.pose.headX))
    channels.y.push(round(frame.pose.headY))
    channels.scale.push(1)
    channels.eyeOpen.push(round(frame.blink.blinkFactor * frame.face.eyeOpenMultiplier))
    channels.bodyTilt.push(round((frame.pose.bodyZ ?? 0) * 10))
  })
  stopListening()
  return {
    format: 'natural-track',
    version: 1,
    source: 'natural',
    tracker: REPLAY_TRACKER,
    fps,
    channels,
    voice: { level: [...track.voice.level], voiced: [...track.voice.voiced] },
  }
}
