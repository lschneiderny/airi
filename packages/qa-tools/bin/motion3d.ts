import process from 'node:process'

import { resolve } from 'node:path'

import { loadQaEnv } from '../src/env/load'
import { takeJsonOption, VerdictRecorder } from '../src/t2-3d/verdicts'

export interface Motion3dCliContext {
  readonly repoRoot: string
  /** Paths supplied by the user resolve against INIT_CWD. */
  readonly cwd: string
  readonly signal: AbortSignal
  /** Present when `--json <path>` was given; gate and report commands record their lines into it. */
  readonly verdicts?: VerdictRecorder
}

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
loadQaEnv(repoRoot)
const interrupt = new AbortController()
const stop = () => interrupt.abort(new Error('interrupted'))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

async function main(): Promise<number> {
  const [command, ...given] = process.argv.slice(2)
  const json = takeJsonOption(given)
  if ('error' in json) {
    console.error(`qa:motion3d ${command}: ${json.error}`)
    return 2
  }
  const cwd = process.env.INIT_CWD ?? process.cwd()
  const verdicts = json.path === null ? undefined : new VerdictRecorder(command ?? '', resolve(cwd, json.path))
  const code = await dispatch(command, json.args, { repoRoot, cwd, signal: interrupt.signal, verdicts })
  return verdicts ? verdicts.finish(interrupt.signal.aborted ? 130 : code) : code
}

async function dispatch(command: string | undefined, args: string[], context: Motion3dCliContext): Promise<number> {
  switch (command) {
    case 'run': return (await import('../src/t2-3d/cli/run')).runMotion3d(args, context)
    case 'gate': return (await import('../src/t2-3d/cli/gate')).gateMotion3d(args, context)
    case 'reference': return (await import('../src/t2-3d/cli/reference')).referenceMotion3d(args, context)
    case 'gaze-order': return (await import('../src/t2-3d/cli/gaze-order')).gazeOrderMotion3d(args, context)
    case 'gesture-timing': return (await import('../src/t2-3d/cli/gesture-timing')).gestureTimingMotion3d(args, context)
    case 'emotion-table': return (await import('../src/t2-3d/cli/emotion-table')).emotionTableMotion3d(args, context)
    case 'cue-body': return (await import('../src/t2-3d/cli/cue-body')).cueBodyMotion3d(args, context)
    case 'ownership': return (await import('../src/t2-3d/cli/ownership')).ownershipMotion3d(args, context)
    case 'turn': return (await import('../src/t2-3d/cli/turn')).turnMotion3d(args, context)
    case 'pops': return (await import('../src/t2-3d/cli/pops')).popsMotion3d(args, context)
    case 'idle-acts': return (await import('../src/t2-3d/cli/idle-acts')).idleActsMotion3d(args, context)
    case 'walk-form': return (await import('../src/t2-3d/cli/walk-form')).walkFormMotion3d(args, context)
    case 'rest': return (await import('../src/t2-3d/cli/rest')).restMotion3d(args, context)
    case 'diff': return (await import('../src/t2-3d/cli/diff')).diffMotion3d(args, context)
    case 'verdicts': return (await import('../src/t2-3d/cli/verdicts')).verdictsMotion3d(args, context)
    case 'frames': return (await import('../src/t2-3d/cli/frames')).framesMotion3d(args, context)
    case 'affected': return (await import('../src/t2-3d/cli/affected')).affectedMotion3d(args, context)
    case 'clip': return (await import('../src/t2-3d/cli/clip')).clipMotion3d(args, context)
    case 'inject': return (await import('../src/t2-3d/cli/inject')).injectMotion3d(args, context)
    default:
      console.error('Usage: qa:motion3d <run|gate|reference|gaze-order|gesture-timing|emotion-table|cue-body|ownership|turn|pops|idle-acts|walk-form|rest|diff|verdicts|frames|affected|clip|inject> [arguments] [--json <verdict file>]')
      return 2
  }
}

void main().then((code) => {
  process.exitCode = interrupt.signal.aborted ? 130 : code
}).finally(() => {
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
})
