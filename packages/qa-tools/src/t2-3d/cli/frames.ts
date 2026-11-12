import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { FrameSelection, FramesSummary } from '../frames/frames'
import type { FrameRig, LocalPose } from '../frames/pose'
import type { FrameView } from '../frames/render'
import type { Quat } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { acquire } from '@proj-airi/cpu-slots'
import { Quaternion } from 'three'

import * as v from 'valibot'

import { readGitStateFromRepo } from '../../evidence/run'
import { diffTraces } from '../diff'
import { availableChannels, drawFrames, frameAt, FRAMES_LIMITS, framesSummarySchema, selectWindows } from '../frames/frames'
import { frameRigFromMMD, localPoses } from '../frames/model'
import { FramePoseRefusal, neededBones, poseFrame } from '../frames/pose'
import { DEG } from '../metrics/math'
import { MotionTraceRefusal, parseTrace, readTrace } from '../read-trace'
import { loadHeadlessMMD } from '../runner/loader'
import { runMotion3dScenario } from '../runner/run'
import { motion3dScenarios } from '../scenarios'

const usage = 'Usage: qa:motion3d frames <run directory> --model <pmx> (--at <t>[,<t>...] | --window <from>:<to> [--hz <n>] | --around <marker label prefix or event kind> --before <s> --after <s> [--hz <n>]) [--views front,side] [--channels <name>[,<name>...]] --out <directory>'
/** A re-run must reproduce every stored rotation to this turn, else its untraced bones would not belong to the reviewed run. */
const RERUN_TOLERANCE_DEG = 0.001
/** Largest turn between a traced bone posed from the trace and the same bone in the re-run, on the drawn frames. */
const POSE_TOLERANCE_DEG = 0.01
const DEFAULT_CHANNELS = ['speaking', 'owned.rightArm', 'activation.left', 'activation.right']

class FramesUsageError extends Error {
  override readonly name = 'FramesUsageError'
}

function parse(args: readonly string[], cwd: string) {
  const values = new Map<string, string>()
  let run: string | null = null
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (!args[i + 1] || args[i + 1].startsWith('--'))
        throw new FramesUsageError(`${args[i]} needs a value`)
      values.set(args[i].slice(2), args[++i])
    }
    else if (run === null) {
      run = resolve(cwd, args[i])
    }
    else {
      throw new FramesUsageError(`unexpected argument ${args[i]}`)
    }
  }
  const known = new Set(['model', 'at', 'window', 'hz', 'around', 'before', 'after', 'views', 'channels', 'out'])
  const unknown = [...values.keys()].filter(key => !known.has(key))
  if (!run || !values.get('model') || !values.get('out') || unknown.length)
    throw new FramesUsageError(unknown.length ? `unknown option --${unknown[0]}` : 'a run directory, --model and --out are required')
  const number = (key: string, fallback?: number) => {
    const raw = values.get(key)
    const value = raw === undefined ? fallback : Number(raw)
    if (value === undefined || !Number.isFinite(value))
      throw new FramesUsageError(`--${key} must be a number`)
    return value
  }
  const modes = ['at', 'window', 'around'].filter(key => values.has(key))
  if (modes.length !== 1)
    throw new FramesUsageError('give exactly one of --at, --window and --around')
  let selection: FrameSelection
  if (values.has('at')) {
    const times = (values.get('at') ?? '').split(',').map(Number)
    if (!times.length || times.some(t => !Number.isFinite(t)))
      throw new FramesUsageError('--at takes seconds separated by commas')
    selection = { kind: 'at', times }
  }
  else if (values.has('window')) {
    const [from, to] = (values.get('window') ?? '').split(':').map(Number)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from)
      throw new FramesUsageError('--window takes <from>:<to> seconds')
    selection = { kind: 'window', from, to, hz: number('hz', 30) }
  }
  else {
    selection = { kind: 'around', marker: values.get('around') ?? '', before: number('before'), after: number('after'), hz: number('hz', 30) }
  }
  if ('hz' in selection && (selection.hz <= 0 || selection.hz > 60))
    throw new FramesUsageError('--hz must be above 0 and at most 60')
  const named = (values.get('views') ?? 'front,side').split(',')
  const views = named.filter((view): view is FrameView => view === 'front' || view === 'side')
  if (!views.length || views.length !== named.length)
    throw new FramesUsageError('--views takes front, side or both')
  return { run, model: resolve(cwd, values.get('model') ?? ''), out: resolve(cwd, values.get('out') ?? ''), selection, views, channels: values.get('channels')?.split(',') ?? null }
}

/** Largest turn, in degrees, between two rotations; q and -q read as one pose. */
const turnDeg = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * DEG

/**
 * `qa:motion3d frames`: stills of the posed character of one stored run, for visual review. Exit 0 when every frame
 * is written, 2 on a usage error, an unreadable run, a model that is not the run's, a selection that matches no time,
 * or a re-run that does not reproduce the stored trace; 130 on interrupt.
 */
export async function framesMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  try {
    const options = parse(args, context.cwd)
    const input = await readTrace(join(options.run, 'trace.json'))
    const summaryPath = join(options.run, 'summary.json')
    const parsedSummary = existsSync(summaryPath) ? v.safeParse(framesSummarySchema, JSON.parse(await readFile(summaryPath, 'utf8'))) : null
    if (parsedSummary && !parsedSummary.success)
      throw new FramesUsageError(`${summaryPath} is not a motion3d run summary: ${v.summarize(parsedSummary.issues)}`)
    const summary = parsedSummary?.output ?? null
    const channels = options.channels ?? DEFAULT_CHANNELS.filter(name => availableChannels(summary).includes(name))
    const unknown = channels.filter(name => !availableChannels(summary).includes(name))
    if (unknown.length)
      throw new FramesUsageError(`unknown channel ${unknown.join(', ')}; available: ${availableChannels(summary).join(', ')}`)
    const windows = selectWindows(input, options.selection)
    if (!windows.length || windows.every(window => !window.times.length))
      throw new FramesUsageError('the selection matches no time in this run')
    const loaded = await loadHeadlessMMD(options.model)
    try {
      if (loaded.assetSha256 !== input.trace.rig.assetSha256)
        throw new FramesUsageError(`the model hashes to ${loaded.assetSha256}, the run's rig to ${input.trace.rig.assetSha256 ?? 'nothing'}`)
      const rig = frameRigFromMMD(loaded.mmd)
      const traced = new Set(input.trace.rig.bones)
      const needed = neededBones(rig, traced)
      const frames = new Set(windows.flatMap(window => window.times.map(t => frameAt(input, t))))
      console.info(`frames ${options.run}: ${frames.size} frame(s) in ${windows.length} window(s); ${traced.size} traced bones posed from the trace`)
      let rerun: Awaited<ReturnType<typeof rerunRun>> | null = null
      if (needed.length) {
        console.info(`  the trace lacks ${needed.length} skinned bone(s) the mesh needs; they are posed from a re-run through the product body: ${needed.map(index => rig.bones[index].name).join(', ')}`)
        if (!summary)
          throw new FramesUsageError('a re-run needs the run\'s summary.json (scenario, seed, seconds, warm-up)')
        rerun = await rerunRun(context, options.model, summary, frames, input, rig)
      }
      await mkdir(options.out, { recursive: true })
      const index = await drawFrames({ input, summary, rig, windows, views: options.views, channels, out: options.out, rerun: rerun ? frame => rerun?.local(frame) : undefined })
      const commit = input.trace.source.gitSha
      await writeFile(join(options.out, 'index.json'), `${JSON.stringify({
        kind: 'motion3d-frames',
        version: 1,
        run: options.run,
        commit,
        dirty: input.trace.source.dirty,
        scenario: input.trace.source.scenario,
        modelSha256: loaded.assetSha256,
        limits: FRAMES_LIMITS,
        pose: { traced: [...traced], needed: needed.map(i => rig.bones[i].name), rerun: rerun?.report ?? null },
        windows,
        frames: index,
      }, null, 2)}\n`)
      console.info(`  wrote ${index.length} frame(s) x ${options.views.length} view(s), a contact sheet per window and view, and index.json to ${options.out}`)
      console.info(`  limits: ${FRAMES_LIMITS}`)
      return 0
    }
    finally {
      loaded.dispose()
    }
  }
  catch (error) {
    if (context.signal.aborted)
      return 130
    if (!(error instanceof FramesUsageError) && !(error instanceof FramePoseRefusal) && !(error instanceof MotionTraceRefusal))
      throw error
    console.error(`qa:motion3d frames: ${errorMessageFrom(error) ?? 'refused'}\n${error instanceof FramesUsageError ? usage : ''}`)
    return 2
  }
}

/**
 * Re-runs the stored run's scenario, seed, length and warm-up through the product body at this checkout, keeps every
 * bone's local transform on the drawn frames, and refuses unless the re-run's trace reproduces the stored one and the
 * trace-posed bones match the re-run's own bones on those frames.
 */
async function rerunRun(context: Motion3dCliContext, model: string, summary: FramesSummary, frames: ReadonlySet<number>, stored: DecodedMotionTrace, rig: FrameRig) {
  const scenario = motion3dScenarios.find(s => s.id === summary.scenario.id)
  if (!scenario)
    throw new FramesUsageError(`unknown scenario ${summary.scenario.id}`)
  const locals = new Map<number, LocalPose[]>()
  const worlds = new Map<number, Quat[]>()
  const lease = await acquire({ class: 'gate', command: `qa:motion3d frames re-run --scenario ${scenario.id} --seed ${summary.scenario.seed}`, cwd: context.repoRoot, signal: context.signal })
  let result
  try {
    result = await runMotion3dScenario({
      model,
      scenario,
      seed: summary.scenario.seed,
      seconds: summary.scenario.seconds,
      warmupSeconds: summary.scenario.warmupSeconds,
      git: readGitStateFromRepo(context.repoRoot),
      signal: context.signal,
      onFrame: (frame, mesh) => {
        if (!frames.has(frame))
          return
        locals.set(frame, localPoses(mesh))
        worlds.set(frame, mesh.skeleton.bones.map((bone) => {
          const q = bone.getWorldQuaternion(new Quaternion())
          return [q.x, q.y, q.z, q.w]
        }))
      },
    })
  }
  finally {
    lease.release()
  }
  const blocks = diffTraces(stored, parseTrace(result.trace))
  const turn = blocks.find(block => block.name === 'rot')?.largest[0]?.value ?? 0
  const root = blocks.find(block => block.name === 'root')?.largest[0]?.value ?? 0
  const frameCount = blocks.find(block => block.name === 'header')?.notes.find(note => note.startsWith('frames'))
  console.info(`  re-run at ${result.trace.source.gitSha ?? 'unknown commit'}${result.trace.source.dirty ? ' (dirty)' : ''} against the stored trace at ${stored.trace.source.gitSha ?? 'unknown commit'}: ${blocks.map(block => `${block.name} ${block.identical ? 'IDENTICAL' : 'DIFFERENT'}`).join(', ')}; largest bone turn ${turn.toFixed(6)} deg (tolerance ${RERUN_TOLERANCE_DEG}), largest hips offset ${root.toFixed(6)} model units`)
  if (frameCount || turn > RERUN_TOLERANCE_DEG || root > 1e-4)
    throw new FramePoseRefusal(`the re-run does not reproduce the stored trace${frameCount ? ` (${frameCount})` : ''}: largest bone turn ${turn} deg, hips offset ${root}; the frames would not be the reviewed run`)
  let poseTurn = 0
  for (const frame of frames) {
    const posed = poseFrame(rig, stored, frame, bone => locals.get(frame)?.[bone] ?? null)
    const world = worlds.get(frame) ?? []
    rig.bones.forEach((bone, i) => {
      if (bone.slot && world[i])
        poseTurn = Math.max(poseTurn, turnDeg(posed.rotations[i], world[i]))
    })
  }
  console.info(`  traced bones posed from the trace against the re-run's own bones on the drawn frames: largest turn ${poseTurn.toFixed(6)} deg (tolerance ${POSE_TOLERANCE_DEG})`)
  if (poseTurn > POSE_TOLERANCE_DEG)
    throw new FramePoseRefusal(`posing from the trace disagrees with the re-run by ${poseTurn} deg; the bone mapping does not match the trace sampler`)
  return {
    local: (frame: number) => (bone: number) => locals.get(frame)?.[bone] ?? null,
    report: { commit: result.trace.source.gitSha, dirty: result.trace.source.dirty, blocks: blocks.map(block => ({ block: block.name, identical: block.identical })), largestTurnDeg: turn, largestHipsOffset: root, posedAgainstRerunDeg: poseTurn, toleranceDeg: RERUN_TOLERANCE_DEG },
  }
}
