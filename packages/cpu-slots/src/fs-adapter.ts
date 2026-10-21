import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'

/** The complete filesystem boundary; adapters preserve synchronous atomic rename. */
export interface StoreFs {
  mkdir: (path: string) => void
  read: (path: string) => string
  write: (path: string, text: string) => void
  rename: (from: string, to: string) => void
  remove: (path: string) => void
  list: (path: string) => string[]
  stat: (path: string) => { mtimeMs: number }
  touch: (path: string, now: number) => void
}

export const nodeFs: StoreFs = {
  mkdir: path => mkdirSync(path, { recursive: true }),
  read: path => readFileSync(path, 'utf8'),
  write: (path, text) => writeFileSync(path, text),
  rename: (from, to) => renameSync(from, to),
  remove: path => rmSync(path, { recursive: true, force: true }),
  list: path => readdirSync(path),
  stat: path => statSync(path),
  touch: (path, now) => utimesSync(path, now / 1_000, now / 1_000),
}
