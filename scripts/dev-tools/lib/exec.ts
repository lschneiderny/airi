import type { Buffer } from 'node:buffer'

import process from 'node:process'

import { execFileSync, spawn } from 'node:child_process'

export function capture(command: string, args: string[], options: { cwd: string, env?: NodeJS.ProcessEnv }): string {
  return execFileSync(command, args, { cwd: options.cwd, env: options.env ?? process.env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/**
 * With `onOutput`, stdout and stderr are piped and handed to `onOutput`; they are also copied to this process's own
 * streams unless `echo` is false.
 */
export function run(command: string, args: string[], options: { cwd: string, env?: NodeJS.ProcessEnv, onOutput?: (text: string) => void, echo?: boolean }): Promise<number> {
  return new Promise((resolve, reject) => {
    const onOutput = options.onOutput
    const echo = options.echo ?? true
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: onOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit', shell: false })
    child.once('error', reject)
    if (onOutput) {
      child.stdout?.on('data', (chunk: Buffer) => {
        if (echo)
          process.stdout.write(chunk)
        onOutput(chunk.toString('utf8'))
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        if (echo)
          process.stderr.write(chunk)
        onOutput(chunk.toString('utf8'))
      })
    }
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

/**
 * Limits for a command that starts `node` or another executable directly. On Windows, CreateProcess rejects command
 * lines over 32767 characters; 24000 leaves room for flags. Linux and macOS take at least 1 MB of arguments, so there a
 * branch-sized file list stays in one command: every extra chunk starts each Vitest config once more.
 */
export function nodeCommandChunkLimitsFor(platform: NodeJS.Platform): ChunkLimits {
  return platform === 'win32' ? { maxItems: 150, maxLength: 24_000 } : { maxItems: 5_000, maxLength: 500_000 }
}

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
