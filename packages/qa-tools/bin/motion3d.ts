import process from 'node:process'

import { resolve } from 'node:path'

import { loadQaEnv } from '../src/env/load'

export interface Motion3dCliContext {
  readonly repoRoot: string
  /** Paths supplied by the user resolve against INIT_CWD. */
  readonly cwd: string
  readonly signal: AbortSignal
}

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
loadQaEnv(repoRoot)
const interrupt = new AbortController()
const stop = () => interrupt.abort(new Error('interrupted'))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2)
  const context: Motion3dCliContext = {
    repoRoot,
    cwd: process.env.INIT_CWD ?? process.cwd(),
    signal: interrupt.signal,
  }
  switch (command) {
    case 'run': return (await import('../src/t2-3d/cli/run')).runMotion3d(args, context)
    case 'gate': return (await import('../src/t2-3d/cli/gate')).gateMotion3d(args, context)
    case 'reference': return (await import('../src/t2-3d/cli/reference')).referenceMotion3d(args, context)
    case 'gaze-order': return (await import('../src/t2-3d/cli/gaze-order')).gazeOrderMotion3d(args, context)
    default:
      console.error('Usage: qa:motion3d <run|gate|reference|gaze-order> [arguments]')
      return 2
  }
}

void main().then((code) => {
  process.exitCode = interrupt.signal.aborted ? 130 : code
}).finally(() => {
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
})
