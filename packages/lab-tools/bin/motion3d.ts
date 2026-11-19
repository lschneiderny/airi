import process from 'node:process'

import { resolve } from 'node:path'

import { loadQaEnv } from '@proj-airi/qa-tools/env/load'

import { takeJsonOption, VerdictRecorder } from '../src/t2-3d/verdicts'

export interface Motion3dCliContext {
  readonly repoRoot: string
  /** Paths supplied by the user resolve against INIT_CWD. */
  readonly cwd: string
  readonly signal: AbortSignal
  /** Present when `--json <path>` was given; gate and report commands record their lines into it. */
  readonly verdicts?: VerdictRecorder
}

/** The criterion reports `report <topic>` runs; each topic keeps its own report version and verdict name. */
const reportTopics: Record<string, (args: string[], context: Motion3dCliContext) => Promise<number>> = {
  'gaze-order': async (args, context) => (await import('../src/t2-3d/cli/gaze-order')).gazeOrderMotion3d(args, context),
  'gesture-timing': async (args, context) => (await import('../src/t2-3d/cli/gesture-timing')).gestureTimingMotion3d(args, context),
  'emotion-table': async (args, context) => (await import('../src/t2-3d/cli/emotion-table')).emotionTableMotion3d(args, context),
  'cue-body': async (args, context) => (await import('../src/t2-3d/cli/cue-body')).cueBodyMotion3d(args, context),
  'ownership': async (args, context) => (await import('../src/t2-3d/cli/ownership')).ownershipMotion3d(args, context),
  'turn': async (args, context) => (await import('../src/t2-3d/cli/turn')).turnMotion3d(args, context),
  'pops': async (args, context) => (await import('../src/t2-3d/cli/pops')).popsMotion3d(args, context),
  'idle-acts': async (args, context) => (await import('../src/t2-3d/cli/idle-acts')).idleActsMotion3d(args, context),
  'walk-form': async (args, context) => (await import('../src/t2-3d/cli/walk-form')).walkFormMotion3d(args, context),
  'rest': async (args, context) => (await import('../src/t2-3d/cli/rest')).restMotion3d(args, context),
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
    console.error(`lab:motion3d ${command}: ${json.error}`)
    return 2
  }
  const cwd = process.env.INIT_CWD ?? process.cwd()
  // A report's verdict file names its topic, as before topics moved under `report`, so stored verdicts stay comparable.
  const label = command === 'report' ? json.args[0] : command
  const verdicts = json.path === null ? undefined : new VerdictRecorder(label ?? '', resolve(cwd, json.path))
  const code = await dispatch(command, json.args, { repoRoot, cwd, signal: interrupt.signal, verdicts })
  return verdicts ? verdicts.finish(interrupt.signal.aborted ? 130 : code) : code
}

async function dispatch(command: string | undefined, args: string[], context: Motion3dCliContext): Promise<number> {
  switch (command) {
    case 'gate': return (await import('../src/t2-3d/cli/gate')).gateMotion3d(args, context)
    case 'reference': return (await import('../src/t2-3d/cli/reference')).referenceMotion3d(args, context)
    case 'report': {
      const [topic, ...rest] = args
      const report = topic === undefined ? undefined : reportTopics[topic]
      if (report)
        return report(rest, context)
      console.error(`Usage: lab:motion3d report <${Object.keys(reportTopics).join('|')}> <run directory>... [--json <verdict file>]`)
      return 2
    }
    case 'verdicts': return (await import('../src/t2-3d/cli/verdicts')).verdictsMotion3d(args, context)
    case 'frames': return (await import('../src/t2-3d/cli/frames')).framesMotion3d(args, context)
    case 'clip': return (await import('../src/t2-3d/cli/clip')).clipMotion3d(args, context)
    case 'inject': return (await import('../src/t2-3d/cli/inject')).injectMotion3d(args, context)
    case 'matrix': return (await import('../src/t2-3d/cli/matrix')).matrixMotion3d(args, context)
    default:
      console.error('Usage: lab:motion3d <gate|reference|report <topic>|verdicts|frames|clip|inject|matrix> [arguments] [--json <verdict file>]\nRuns, diffs, and affected checks are qa:motion3d commands.')
      return 2
  }
}

void main().then((code) => {
  process.exitCode = interrupt.signal.aborted ? 130 : code
}).finally(() => {
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
})
