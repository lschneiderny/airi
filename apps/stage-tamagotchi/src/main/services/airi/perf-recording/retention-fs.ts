import { createReadStream } from 'node:fs'
import { appendFile, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

/** The asynchronous file operations retention uses; {@link nodePerfRetentionFs} implements them over `node:fs`. */
export interface PerfRetentionFs {
  readdir: (path: string) => Promise<string[]>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  stat: (path: string) => Promise<{ size: number, mtimeMs: number }>
  /** Called with `flag: 'wx'`, so it rejects with `EEXIST` when the file exists. */
  writeFile: (path: string, data: string, options: { flag: 'wx', mode: number }) => Promise<void>
  appendFile: (path: string, data: string, options: { mode: number }) => Promise<void>
  rm: (path: string, options: { force: true }) => Promise<void>
  /** Streams a file's lines; iteration rejects with `ENOENT` when the file is missing. */
  readLines: (path: string) => AsyncIterable<string>
}

export const nodePerfRetentionFs: PerfRetentionFs = {
  readdir: path => readdir(path),
  readFile,
  stat,
  writeFile,
  appendFile,
  rm,
  readLines: path => createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Number.POSITIVE_INFINITY }),
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
