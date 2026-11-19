import process from 'node:process'

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { constants } from 'node:os'
import { resolve } from 'node:path'

const QA_TOOLS = resolve(import.meta.dirname, '..', '..', '..')
const ENTRY = resolve(QA_TOOLS, 'bin', 'motion3d.ts')

export interface ChildResult {
  /** The argument vector exactly as spawned, without a shell, so a path with a space stays one argument. */
  readonly argv: readonly string[]
  readonly exitCode: number
  readonly durationMs: number
}

/**
 * Runs one `qa:motion3d` command in its own Node process through tsx, as `pnpm qa:motion3d` does but without pnpm, and
 * writes its stdout and stderr to `log`. Every path argument must be absolute: the child resolves relative paths
 * against the qa-tools folder. A signal ends the child with 128 plus the signal number.
 */
export function runMotion3dChild(args: readonly string[], log: string, signal: AbortSignal): Promise<ChildResult> {
  const argv = [process.execPath, '--import', 'tsx', ENTRY, ...args]
  const started = performance.now()
  return new Promise((done, fail) => {
    const out = createWriteStream(log)
    const child = spawn(argv[0], argv.slice(1), { cwd: QA_TOOLS, env: { ...process.env, INIT_CWD: QA_TOOLS }, stdio: ['ignore', 'pipe', 'pipe'], signal, killSignal: 'SIGTERM' })
    child.stdout.pipe(out, { end: false })
    child.stderr.pipe(out, { end: false })
    child.on('error', (error) => {
      if (error.name !== 'AbortError')
        fail(error)
    })
    child.on('close', (code, killed) => {
      out.end(() => done({ argv, exitCode: code ?? 128 + (killed ? constants.signals[killed] : 0), durationMs: Math.round(performance.now() - started) }))
    })
  })
}
