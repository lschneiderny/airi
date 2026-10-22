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

/**
 * A chunk stays under both limits: `maxItems` bounds the count for short paths, `maxLength` bounds the joined length for long ones.
 * Each item costs its length plus 3: a separator and the pair of quotes a batch-file shim adds. An item longer than `maxLength` gets its own chunk.
 */
export interface ChunkLimits {
  maxItems: number
  maxLength: number
}

/** A command that starts `node` or another executable directly is limited by CreateProcess to 32767 characters; 24000 leaves room for flags. */
export const nodeCommandChunkLimits: ChunkLimits = { maxItems: 150, maxLength: 24_000 }

/**
 * A command that starts a `node_modules/.bin` shim runs through cmd.exe, which rejects lines over 8191 characters.
 * `moeru-lint` starts `oxlint` and `eslint` that way, so its file lists use this limit; 6500 leaves room for the program, flags, and escaping.
 */
export const shimCommandChunkLimits: ChunkLimits = { maxItems: 150, maxLength: 6_500 }

export function chunkByLength(items: string[], limits: ChunkLimits): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let currentLength = 0
  for (const item of items) {
    const cost = item.length + 3
    if (current.length && (current.length >= limits.maxItems || currentLength + cost > limits.maxLength)) {
      chunks.push(current)
      current = []
      currentLength = 0
    }
    current.push(item)
    currentLength += cost
  }
  if (current.length)
    chunks.push(current)
  return chunks
}
