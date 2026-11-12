import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DecodedMotionTrace } from '../read-trace'
import type { LocalPose } from './pose'
import type { FrameView } from './render'

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import * as v from 'valibot'

import { poseFrame, skin } from './pose'
import { contactSheet, encodePng, framingFor, rasterize } from './render'

/** What frames drawn this way cannot show; printed by the command and stored in index.json. */
export const FRAMES_LIMITS = 'The frames show the posed skinned mesh only: no face, morphs, textures or materials; bones the rig profile marks physics-owned (most hair and cloth) keep their bind pose relative to their parent bone, and other untraced bones follow the re-run, its physics included, so hair and cloth are not judged here; no lip-sync; motion time, not real-app timing or frame pacing.'

export type FrameSelection
  = | { readonly kind: 'at', readonly times: readonly number[] }
    | { readonly kind: 'window', readonly from: number, readonly to: number, readonly hz: number }
    | { readonly kind: 'around', readonly marker: string, readonly before: number, readonly after: number, readonly hz: number }

export interface FrameWindow {
  readonly name: string
  readonly from: number
  readonly to: number
  /** Seconds between drawn frames: half of it is how near an event must be to be printed under a frame. */
  readonly step: number
  readonly times: readonly number[]
}

const CHANNELS: readonly string[] = MOTION_TRACE_CHANNELS

/** The fields of a run's summary.json the frames command reads: what to re-run, and the per-frame ownership series. */
export const framesSummarySchema = v.object({
  scenario: v.object({ id: v.string(), seed: v.number(), seconds: v.number(), warmupSeconds: v.number() }),
  owned: v.object({ groups: v.array(v.string()), perFrame: v.array(v.array(v.number())) }),
  ownership: v.object({ activation: v.object({ left: v.array(v.number()), right: v.array(v.number()) }) }),
})
export type FramesSummary = v.InferOutput<typeof framesSummarySchema>

export function frameAt(input: DecodedMotionTrace, t: number): number {
  let best = 0
  for (let f = 1; f < input.trace.frames; f++) {
    if (Math.abs(input.channels[f * CHANNELS.length] - t) < Math.abs(input.channels[best * CHANNELS.length] - t))
      best = f
  }
  return best
}

export const eventLabel = (event: MotionTraceEvent): string => event.kind === 'marker' ? event.label : `${event.kind}${'emotion' in event ? `:${event.emotion}:${event.phase}` : 'touch' in event ? `:${event.touch}` : 'gesture' in event ? `:${event.gesture}` : ''}`

export function selectWindows(input: DecodedMotionTrace, selection: FrameSelection): FrameWindow[] {
  const sampled = (from: number, to: number, hz: number) => Array.from({ length: Math.floor((to - from) * hz + 1e-6) + 1 }, (_, i) => from + i / hz)
  switch (selection.kind) {
    case 'at':
      return [{ name: 'at', from: Math.min(...selection.times), to: Math.max(...selection.times), step: 1 / input.trace.hz, times: selection.times }]
    case 'window':
      return [{ name: `window-${selection.from.toFixed(2)}-${selection.to.toFixed(2)}`, from: selection.from, to: selection.to, step: 1 / selection.hz, times: sampled(selection.from, selection.to, selection.hz) }]
    case 'around':
      return input.trace.events
        // A marker matches by its label prefix (`clip-claim`, `cue:nod`); any other event by its kind (`touch`) or by
        // its kind's own name (`poke` for a touch poke, `happy` for an emotion event).
        .filter(event => event.kind === selection.marker || eventLabel(event).startsWith(selection.marker) || eventLabel(event).startsWith(`${event.kind}:${selection.marker}`))
        .map((event, i) => ({
          name: `${selection.marker.replaceAll(/[^\w-]/g, '_')}-${i + 1}-t${event.t.toFixed(2)}`,
          from: event.t - selection.before,
          to: event.t + selection.after,
          step: 1 / selection.hz,
          times: sampled(event.t - selection.before, event.t + selection.after, selection.hz),
        }))
  }
}

/** Channel names a caption can print: the trace's channels, and summary.json's clip ownership and gesture activation. */
export function availableChannels(summary: FramesSummary | null): string[] {
  return [
    ...CHANNELS.filter(name => name !== 'time' && name !== 'wall'),
    ...summary ? summary.owned.groups.map(group => `owned.${group}`) : [],
    ...summary ? ['activation.left', 'activation.right'] : [],
  ]
}

/** A channel's value on a frame; summary series hold scored frames only, so a warm-up frame has none. */
export function channelValue(input: DecodedMotionTrace, summary: FramesSummary | null, name: string, frame: number): number | null {
  const traced = CHANNELS.indexOf(name)
  if (traced >= 0) {
    const value = input.channels[frame * CHANNELS.length + traced]
    return Number.isNaN(value) ? null : value
  }
  const scored = frame - Math.round(input.trace.scoredFrom * input.trace.hz)
  if (!summary || scored < 0)
    return null
  if (name.startsWith('owned.'))
    return summary.owned.perFrame[scored]?.[summary.owned.groups.indexOf(name.slice(6))] ?? null
  if (name === 'activation.left' || name === 'activation.right')
    return summary.ownership.activation[name === 'activation.left' ? 'left' : 'right'][scored] ?? null
  return null
}

export interface FramesIndexFrame {
  readonly window: string
  readonly t: number
  readonly frame: number
  readonly frameTime: number
  readonly files: Readonly<Record<string, string>>
  readonly channels: Readonly<Record<string, number | null>>
  readonly events: readonly string[]
}

export interface DrawFramesOptions {
  readonly input: DecodedMotionTrace
  readonly summary: FramesSummary | null
  readonly rig: Parameters<typeof poseFrame>[0]
  readonly windows: readonly FrameWindow[]
  readonly views: readonly FrameView[]
  readonly channels: readonly string[]
  readonly out: string
  readonly rerun?: (frame: number) => ((bone: number) => LocalPose | null) | undefined
  readonly size?: { readonly width: number, readonly height: number }
}

export async function drawFrames(options: DrawFramesOptions): Promise<FramesIndexFrame[]> {
  const { input, summary, rig, windows, views, channels, out } = options
  const { width, height } = options.size ?? { width: 300, height: 450 }
  const bindTrace = skin(rig, { rotations: rig.bones.map(bone => bone.bindRotation), positions: rig.bones.map(bone => bone.bindPosition) })
  const framing = framingFor(bindTrace, width, height)
  const index: FramesIndexFrame[] = []
  for (const window of windows) {
    await mkdir(join(out, window.name), { recursive: true })
    const cells = new Map<FrameView, { rgb: Uint8Array, caption: string[] }[]>(views.map(view => [view, []]))
    for (const t of window.times) {
      const frame = frameAt(input, t)
      const frameTime = input.channels[frame * CHANNELS.length]
      const vertices = skin(rig, poseFrame(rig, input, frame, options.rerun?.(frame)))
      const values = Object.fromEntries(channels.map(name => [name, channelValue(input, summary, name, frame)]))
      const events = input.trace.events.filter(e => Math.abs(e.t - frameTime) <= window.step / 2 + 1e-9).map(e => `${e.t.toFixed(3)} ${eventLabel(e)}`)
      const caption = [
        `t ${frameTime.toFixed(3)} s  f ${frame}`,
        ...channels.map(name => `${name} ${values[name] === null ? '-' : values[name]?.toFixed(3)}`),
        ...events.map(e => `> ${e}`),
      ]
      const files: Record<string, string> = {}
      for (const view of views) {
        const centre = view === 'front' ? input.root[frame * 4] : input.root[frame * 4 + 2]
        const rgb = rasterize(vertices, rig.triangles, view, framing, centre)
        const file = join(window.name, `${frameTime.toFixed(3)}-${view}.png`)
        await writeFile(join(out, file), await encodePng(rgb, width, height))
        files[view] = file
        cells.get(view)?.push({ rgb, caption })
      }
      index.push({ window: window.name, t, frame, frameTime, files, channels: values, events })
    }
    for (const [view, list] of cells) {
      const sheet = contactSheet(list, width, height, 6)
      await writeFile(join(out, window.name, `sheet-${view}.png`), await encodePng(sheet.rgb, sheet.width, sheet.height))
    }
  }
  return index
}
