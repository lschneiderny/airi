import type { MotionTraceEvent, MotionTraceRecorder, MotionTraceRig, MotionTraceSource, MotionTraceState } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

const finite = v.pipe(v.number(), v.finite())
const time = v.pipe(finite, v.minValue(0))
const band = v.picklist(['slight', 'clear', 'strong'])
const provenance = v.picklist(['scenario', 'derived'])
const eventSchema = v.variant('kind', [
  v.object({ t: time, kind: v.literal('marker'), label: v.string() }),
  v.object({ t: time, kind: v.literal('goal'), x: v.nullable(finite), pace: v.nullable(v.picklist(['stroll', 'walk'])) }),
  v.object({ t: time, kind: v.literal('gesture'), gesture: v.string() }),
  v.object({ t: time, kind: v.literal('mode'), mode: v.string() }),
  v.object({ t: time, kind: v.literal('touch'), touch: v.picklist(['poke', 'pet-start', 'pet-end']), region: v.optional(v.picklist(['head', 'body'])) }),
  v.object({ t: time, kind: v.literal('gait'), gait: v.picklist(['liftOff', 'heelStrike']), foot: v.picklist(['left', 'right']) }),
  v.object({ t: time, kind: v.literal('emotion'), emotion: v.string(), band, phase: v.picklist(['pulse', 'hold-start', 'hold-end', 'placebo']), trialId: v.optional(v.string()) }),
  v.object({ t: time, kind: v.literal('emphasis'), strength: finite, source: provenance }),
  v.object({ t: time, kind: v.literal('gaze-jump'), yaw: finite, pitch: finite, source: provenance }),
])
const startSchema = v.object({
  scenario: v.object({ id: v.string(), class: v.picklist(['idle', 'talk', 'gaze', 'emotion', 'walk', 'react']), seed: v.nullable(v.pipe(finite, v.integer())) }),
  maxSeconds: v.pipe(finite, v.minValue(0.001), v.maxValue(130)),
})
const drainSchema = v.object({
  requestId: v.string(),
  from: v.pipe(time, v.integer()),
  count: v.pipe(time, v.integer(), v.maxValue(600)),
})

export interface MMDMotionTraceSource {
  recorder: MotionTraceRecorder
  rig: MotionTraceRig
  stages: MotionTraceSource['stages']
  /** Updated by the scene only while recording, in motion seconds since frame zero. */
  seconds: number
  maxSeconds: number
}

export interface MMDMotionTraceSnapshot {
  state: MotionTraceState
  frames: number
  bones: number
  seconds: number
  refused: string | null
}

export type MMDMotionTraceCommand
  = | { type: 'command', name: 'startTrace', value: v.InferOutput<typeof startSchema> }
    | { type: 'command', name: 'markTrace', value: MotionTraceEvent }
    | { type: 'command', name: 'stopTrace', value?: undefined }
    | { type: 'command', name: 'drainTrace', value: v.InferOutput<typeof drainSchema> }

/** The diagnostics boundary owns one scene's recorder; model unload drops all buffers. */
export class MMDMotionTrace {
  private source: MMDMotionTraceSource | null = null
  private refused: string | null = null

  constructor(private readonly reply: (message: unknown) => void) {}

  setSource(source: MMDMotionTraceSource | null): void {
    this.source?.recorder.stop()
    this.source = source
    this.refused = null
  }

  snapshot(): MMDMotionTraceSnapshot | null {
    const source = this.source
    if (!source && !this.refused)
      return null
    return {
      state: source?.recorder.state() ?? 'idle',
      frames: source?.recorder.frames ?? 0,
      bones: source?.rig.bones.length ?? 0,
      seconds: source?.seconds ?? 0,
      refused: this.refused,
    }
  }

  receive(name: string, value: unknown, measurementRunning: boolean): void {
    const source = this.source
    switch (name) {
      case 'startTrace': {
        const parsed = v.safeParse(startSchema, value)
        this.refused = measurementRunning
          ? 'measurement-running'
          : !parsed.success
              ? 'invalid-trace-request'
              : !source
                  ? 'no-mmd-model'
                  : source.recorder.state() === 'recording' ? 'trace-recording' : null
        if (this.refused || !parsed.success || !source)
          return
        source.seconds = 0
        source.maxSeconds = parsed.output.maxSeconds
        source.recorder.start({
          kind: 'motion-trace',
          version: 1,
          rig: source.rig,
          hz: 60,
          scoredFrom: 0,
          source: { level: 'rendered', scenario: parsed.output.scenario, gitSha: null, dirty: null, stages: source.stages, omitted: [], detail: {} },
        })
        return
      }
      case 'markTrace': {
        const parsed = v.safeParse(eventSchema, value)
        if (!parsed.success)
          this.refused = 'invalid-trace-event'
        else
          source?.recorder.event(parsed.output)
        return
      }
      case 'stopTrace':
        source?.recorder.stop()
        return
      case 'drainTrace': {
        const parsed = v.safeParse(drainSchema, value)
        if (!parsed.success) {
          this.refused = 'invalid-trace-range'
          return
        }
        const { requestId, from, count } = parsed.output
        if (!source) {
          this.refused = 'no-mmd-model'
          this.reply({ type: 'trace', requestId, refused: this.refused })
          return
        }
        try {
          this.reply({ type: 'trace', requestId, ...source.recorder.drain(from, count) })
        }
        catch (error) {
          this.refused = source.recorder.state() !== 'stopped' ? 'trace-not-stopped' : 'invalid-trace-range'
          this.reply({ type: 'trace', requestId, refused: this.refused, message: errorMessageFrom(error) })
        }
      }
    }
  }
}
