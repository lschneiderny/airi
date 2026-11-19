import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { FramesSummary } from '../frames/frames'
import type { LocalPose } from '../frames/pose'
import type { FrameView } from '../frames/render'
import type { DecodedMotionTrace } from '../read-trace'

import process from 'node:process'

import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'

import * as v from 'valibot'

import { activeEvents, CLIP_LIMITS, clipCodec, clipTimes, composeClipFrame, findOnPath } from '../frames/clip'
import { eventLabel, frameAt, framesSummarySchema, selectWindows } from '../frames/frames'
import { frameRigFromMMD } from '../frames/model'
import { FramePoseRefusal, neededBones, poseFrame, skin, unposedBones } from '../frames/pose'
import { framingFor, rasterize } from '../frames/render'
import { MotionTraceRefusal, readTrace } from '../read-trace'
import { loadHeadlessMMD } from '../runner/loader'
import { DEFAULT_AFTER_SECONDS, DEFAULT_BEFORE_SECONDS, rerunRun } from './frames'

const usage = 'Usage: qa:motion3d clip <run directory> --model <pmx> [--window <from>:<to> | --around <marker label prefix or event kind> [--before <s>] [--after <s>] [--match <n>]] [--compare <run directory>] [--views front,side] [--hz <n>] [--pose rerun|trace] --out <file.mp4|.webm|.webp|.gif>'
const PANEL = { width: 270, height: 400 }
const CHANNELS: readonly string[] = MOTION_TRACE_CHANNELS

class ClipRefusal extends Error {
  override readonly name = 'ClipRefusal'
}

export interface ClipArguments {
  readonly run: string
  readonly compare: string | null
  readonly model: string
  readonly out: string
  readonly selection: { kind: 'whole' } | { kind: 'window', from: number, to: number } | { kind: 'around', marker: string, before: number, after: number, match: number }
  readonly views: readonly FrameView[]
  readonly hz: number
  readonly pose: 'rerun' | 'trace'
}

export function parseClipArguments(args: readonly string[], cwd: string): ClipArguments {
  const values = new Map<string, string>()
  let run: string | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (!args[i + 1] || args[i + 1].startsWith('--'))
        throw new ClipRefusal(`${args[i]} needs a value`)
      values.set(args[i].slice(2), args[++i])
    }
    else if (run === null) {
      run = resolve(cwd, args[i])
    }
    else {
      throw new ClipRefusal(`unexpected argument ${args[i]}`)
    }
  }
  const unknown = [...values.keys()].filter(key => !['model', 'window', 'around', 'before', 'after', 'match', 'compare', 'views', 'hz', 'pose', 'out'].includes(key))
  if (!run || !values.get('model') || !values.get('out') || unknown.length)
    throw new ClipRefusal(unknown.length ? `unknown option --${unknown[0]}` : 'a run directory, --model and --out are required')
  const number = (key: string, fallback: number) => {
    const value = values.has(key) ? Number(values.get(key)) : fallback
    if (!Number.isFinite(value))
      throw new ClipRefusal(`--${key} must be a number`)
    return value
  }
  if (values.has('window') && values.has('around'))
    throw new ClipRefusal('give at most one of --window and --around')
  if (!values.has('around') && ['before', 'after', 'match'].some(key => values.has(key)))
    throw new ClipRefusal('--before, --after and --match go with --around')
  let selection: ClipArguments['selection'] = { kind: 'whole' }
  if (values.has('window')) {
    const [from, to] = (values.get('window') ?? '').split(':').map(Number)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from)
      throw new ClipRefusal('--window takes <from>:<to> seconds')
    selection = { kind: 'window', from, to }
  }
  else if (values.has('around')) {
    const match = number('match', 1)
    if (!Number.isInteger(match) || match < 1)
      throw new ClipRefusal('--match takes a positive integer')
    selection = { kind: 'around', marker: values.get('around') ?? '', before: number('before', DEFAULT_BEFORE_SECONDS), after: number('after', DEFAULT_AFTER_SECONDS), match }
  }
  const hz = number('hz', 30)
  if (hz <= 0 || hz > 60)
    throw new ClipRefusal('--hz must be above 0 and at most 60')
  const named = (values.get('views') ?? 'front,side').split(',')
  const views = named.filter((view): view is FrameView => view === 'front' || view === 'side')
  if (!views.length || views.length !== named.length)
    throw new ClipRefusal('--views takes front, side or both')
  const pose = values.get('pose') ?? 'rerun'
  if (pose !== 'rerun' && pose !== 'trace')
    throw new ClipRefusal('--pose takes rerun or trace')
  const out = resolve(cwd, values.get('out') ?? '')
  if (!clipCodec(out))
    throw new ClipRefusal('--out must end in .mp4, .webm, .webp or .gif')
  return { run, compare: values.has('compare') ? resolve(cwd, values.get('compare') ?? '') : null, model: resolve(cwd, values.get('model') ?? ''), out, selection, views, hz, pose }
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  }
  catch {
    return false
  }
}

interface ClipRun {
  readonly dir: string
  readonly input: DecodedMotionTrace
  readonly summary: FramesSummary | null
}

async function readRun(dir: string): Promise<ClipRun> {
  const input = await readTrace(join(dir, 'trace.json'))
  const path = join(dir, 'summary.json')
  const parsed = existsSync(path) ? v.safeParse(framesSummarySchema, JSON.parse(await readFile(path, 'utf8'))) : null
  if (parsed && !parsed.success)
    throw new ClipRefusal(`${path} is not a motion3d run summary: ${v.summarize(parsed.issues)}`)
  return { dir, input, summary: parsed?.output ?? null }
}

interface PoseSource {
  readonly pose: (frame: number) => ((bone: number) => LocalPose | null) | 'trace' | undefined
  readonly unposed: readonly string[]
  readonly rerun: Awaited<ReturnType<typeof rerunRun>>['report'] | null
}

/**
 * `qa:motion3d clip`: the frames renderer's posed mesh at playback rate, encoded to one video or animated image by a
 * system ffmpeg, with a second run side by side. Exit 0 when the clip is written, 1 when ffmpeg fails, 2 on a usage
 * error or refusal (no ffmpeg or encoder, wrong model, scenario mismatch, a re-run that does not reproduce), 130 on
 * interrupt.
 */
export async function clipMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  try {
    const options = parseClipArguments(args, context.cwd)
    const ffmpeg = findOnPath('ffmpeg', process.env.PATH, isExecutableFile)
    if (!ffmpeg)
      throw new ClipRefusal('clip encodes through a system ffmpeg and none is on PATH; install ffmpeg, or use qa:motion3d frames for stills')
    const codec = clipCodec(options.out)!
    if (!new RegExp(`\\s${codec.encoder}\\s`).test(execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8' })))
      throw new ClipRefusal(`${ffmpeg} has no ${codec.encoder} encoder for ${options.out}; try another of .mp4, .webm, .webp, .gif`)
    const runs = await Promise.all([options.run, ...(options.compare ? [options.compare] : [])].map(readRun))
    const scenarios = runs.map(run => run.input.trace.source.scenario.id)
    if (new Set(scenarios).size > 1)
      throw new ClipRefusal(`--compare needs runs of one scenario; got ${scenarios.join(' and ')}`)
    const loaded = await loadHeadlessMMD(options.model)
    try {
      for (const run of runs) {
        if (loaded.assetSha256 !== run.input.trace.rig.assetSha256)
          throw new ClipRefusal(`the model hashes to ${loaded.assetSha256}, the rig of ${run.dir} to ${run.input.trace.rig.assetSha256 ?? 'nothing'}`)
      }
      const rig = frameRigFromMMD(loaded.mmd)
      const first = runs[0].input
      let from = first.channels[Math.round(first.trace.scoredFrom * first.trace.hz) * CHANNELS.length]
      let to = first.channels[(first.trace.frames - 1) * CHANNELS.length]
      if (options.selection.kind === 'window') {
        from = options.selection.from
        to = options.selection.to
      }
      else if (options.selection.kind === 'around') {
        const windows = selectWindows(first, { kind: 'around', marker: options.selection.marker, before: options.selection.before, after: options.selection.after, hz: options.hz })
        const window = windows[options.selection.match - 1]
        if (!window)
          throw new ClipRefusal(`${options.run} has ${windows.length} event(s) matching ${options.selection.marker}; --match ${options.selection.match} names none`)
        from = window.from
        to = window.to
        console.info(`clip: --around ${options.selection.marker} match ${options.selection.match} of ${windows.length} at ${window.name}`)
      }
      const times = clipTimes(from, to, options.hz)
      const sources: PoseSource[] = []
      for (const run of runs) {
        const traced = new Set(run.input.trace.rig.bones)
        const needed = neededBones(rig, traced)
        if (options.pose === 'trace') {
          const unposed = unposedBones(rig, traced).map(index => rig.bones[index].name)
          console.info(`clip ${run.dir}: posed from the trace only; ${needed.length - unposed.length} append bone(s) follow their append parent; ${unposed.length} skinned bone(s) keep their bind pose relative to their parent: ${unposed.join(', ') || 'none'}`)
          sources.push({ pose: () => 'trace', unposed, rerun: null })
        }
        else if (needed.length) {
          if (!run.summary)
            throw new ClipRefusal(`${run.dir} needs its summary.json for a re-run (scenario, seed, seconds, warm-up)`)
          const frames = new Set(times.map(t => frameAt(run.input, t)))
          console.info(`clip ${run.dir}: ${needed.length} skinned bone(s) come from a re-run through the product body; it must reproduce the stored trace`)
          const rerun = await rerunRun(context, options.model, run.summary, frames, run.input, rig)
          sources.push({ pose: frame => rerun.local(frame), unposed: [], rerun: rerun.report })
        }
        else {
          sources.push({ pose: () => undefined, unposed: [], rerun: null })
        }
      }
      const framing = framingFor(skin(rig, { rotations: rig.bones.map(bone => bone.bindRotation), positions: rig.bones.map(bone => bone.bindPosition) }), PANEL.width, PANEL.height)
      const label = runs.length > 1 ? ['BEFORE', 'AFTER'] : ['RUN']
      const footer = [`${options.pose === 'trace' ? 'posed from the trace only (untraced twist, physics and accessory bones at bind)' : 'posed from the trace and a reproducing re-run'}; ${options.hz} fps = real time`, CLIP_LIMITS]
      const drawFrame = (t: number) => composeClipFrame(runs.map((run, r) => {
        const frame = frameAt(run.input, t)
        const frameTime = run.input.channels[frame * CHANNELS.length]
        const vertices = skin(rig, poseFrame(rig, run.input, frame, sources[r].pose(frame)))
        const source = run.input.trace.source
        return {
          header: [
            `${label[r]} ${source.gitSha?.slice(0, 9) ?? '?'}${source.dirty ? '+dirty' : ''}`,
            `${source.scenario.id} seed ${source.scenario.seed ?? '-'}`,
            `t ${frameTime.toFixed(2)} s  f ${frame}${t > frameTime + 1 / options.hz ? ' (ended)' : ''}`,
            ...activeEvents(run.input.trace.events, frameTime, eventLabel).slice(0, 2),
          ],
          panels: options.views.map(view => ({ rgb: rasterize(vertices, rig.triangles, view, framing, view === 'front' ? run.input.root[frame * 4] : run.input.root[frame * 4 + 2]) })),
        }
      }), PANEL.width, PANEL.height, footer)
      const firstFrame = drawFrame(times[0])
      const encoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${firstFrame.width}x${firstFrame.height}`, '-r', String(options.hz), '-i', '-', ...codec.args, options.out], { stdio: ['pipe', 'inherit', 'inherit'] })
      const exited = once(encoder, 'close') as Promise<[number | null]>
      // The pipe breaks when ffmpeg exits early; its error is kept and reported with ffmpeg's exit code.
      const pipe: { error: unknown } = { error: null }
      encoder.stdin.on('error', (error) => {
        pipe.error = error
      })
      for (let i = 0; i < times.length && pipe.error === null; i++) {
        context.signal.throwIfAborted()
        if (!encoder.stdin.write(i === 0 ? firstFrame.rgb : drawFrame(times[i]).rgb))
          await Promise.race([once(encoder.stdin, 'drain'), exited])
      }
      encoder.stdin.end()
      const [code] = await exited
      if (code !== 0 || pipe.error !== null) {
        console.error(`qa:motion3d clip: ffmpeg exited ${code}${pipe.error ? ` (${errorMessageFrom(pipe.error) ?? 'pipe closed'})` : ''}`)
        return 1
      }
      const bytes = statSync(options.out).size
      await writeFile(`${options.out}.json`, `${JSON.stringify({
        kind: 'motion3d-clip',
        version: 1,
        out: options.out,
        bytes,
        from,
        to,
        hz: options.hz,
        frames: times.length,
        views: options.views,
        size: { width: firstFrame.width, height: firstFrame.height },
        pose: options.pose,
        runs: runs.map((run, r) => ({ label: label[r], run: run.dir, commit: run.input.trace.source.gitSha, dirty: run.input.trace.source.dirty, scenario: run.input.trace.source.scenario, unposedBones: sources[r].unposed, rerun: sources[r].rerun })),
        limits: CLIP_LIMITS,
      }, null, 2)}\n`)
      console.info(`clip: wrote ${options.out} (${(bytes / 1024 / 1024).toFixed(2)} MiB, ${times.length} frames, ${(times.length / options.hz).toFixed(1)} s at ${options.hz} fps, ${firstFrame.width}x${firstFrame.height}) from ${from.toFixed(2)} s to ${to.toFixed(2)} s motion time, and ${options.out}.json`)
      console.info(`  limits: ${CLIP_LIMITS}`)
      return 0
    }
    finally {
      loaded.dispose()
    }
  }
  catch (error) {
    if (context.signal.aborted)
      return 130
    if (!(error instanceof ClipRefusal) && !(error instanceof FramePoseRefusal) && !(error instanceof MotionTraceRefusal))
      throw error
    console.error(`qa:motion3d clip: ${errorMessageFrom(error) ?? 'refused'}${error instanceof ClipRefusal ? `\n${usage}` : ''}`)
    return 2
  }
}
