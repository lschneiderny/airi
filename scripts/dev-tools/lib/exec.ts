import process from 'node:process'

import { execFileSync, spawn } from 'node:child_process'

export function capture(command: string, args: string[], options: { cwd: string, env?: NodeJS.ProcessEnv }): string {
  return execFileSync(command, args, { cwd: options.cwd, env: options.env ?? process.env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** `onSpawn` receives the child pid as soon as it exists, so callers can register it as budgeted work. */
export function run(command: string, args: string[], options: { cwd: string, env?: NodeJS.ProcessEnv, onSpawn?: (pid: number) => void }): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: 'inherit', shell: false })
    child.once('error', reject)
    if (child.pid !== undefined)
      options.onSpawn?.(child.pid)
    child.once('close', code => resolve(code ?? 1))
  })
}

/** Splits `items` into chunks of at most `size`, so long file lists stay under the Windows command-line limit. */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size))
  return chunks
}
