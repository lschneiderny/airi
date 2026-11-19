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
  const context = { repoRoot, cwd: process.env.INIT_CWD ?? process.cwd(), signal: interrupt.signal }
  switch (command) {
    case 'run': return (await import('../src/t2-3d/cli/run')).runMotion3d(args, context)
    case 'diff': return (await import('../src/t2-3d/cli/diff')).diffMotion3d(args, context)
    case 'affected': return (await import('../src/t2-3d/cli/affected')).affectedMotion3d(args, context)
    default:
      console.error('Usage: qa:motion3d <run|diff|affected> [arguments]\nScoring and rendering (gate, report, verdicts, frames, clip, inject, matrix, reference) are lab:motion3d commands.')
      return 2
  }
}

void main().then((code) => {
  process.exitCode = interrupt.signal.aborted ? 130 : code
}).finally(() => {
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
})
