import type { BenchRunRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfFileCounts } from '../perf/read'

import { appendFileSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, posix, win32 } from 'node:path'

import { parsePerfLine } from '@proj-airi/stage-shared/perf/usage'

export interface BenchHistoryHost {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homedir: string
}

/**
 * The per-machine bench history, `<state dir>/airi-perf/bench.jsonl`. The state directory is
 * `$XDG_STATE_HOME` or `~/.local/state` on Linux, `%LOCALAPPDATA%` on Windows, `~/Library/Application Support` on
 * macOS. `AIRI_PERF_BENCH_DIR` names the directory that holds `bench.jsonl` directly.
 */
export function benchHistoryPath(host: BenchHistoryHost): string {
  const path = host.platform === 'win32' ? win32 : posix
  const override = host.env.AIRI_PERF_BENCH_DIR?.trim()
  if (override)
    return path.join(override, 'bench.jsonl')
  const stateDir = (() => {
    switch (host.platform) {
      case 'darwin':
        return path.join(host.homedir, 'Library', 'Application Support')
      case 'win32':
        return host.env.LOCALAPPDATA?.trim() || path.join(host.homedir, 'AppData', 'Local')
      default:
        return host.env.XDG_STATE_HOME?.trim() || path.join(host.homedir, '.local', 'state')
    }
  })()
  return path.join(stateDir, 'airi-perf', 'bench.jsonl')
}

/** Appends one line to the history. The file is append-only and never rotated; a new file is readable by its owner only. */
export function appendBenchLine(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  appendFileSync(path, `${line}\n`, { mode: 0o600 })
}

export interface BenchHistory {
  readonly runs: readonly BenchRunRecord[]
  /** Rejected lines; a valid record of another kind counts as malformed, since the history holds only bench runs. */
  readonly counts: PerfFileCounts
  readonly found: boolean
}

/** Reads the history without writing to it; a missing file is an empty history. */
export async function readBenchHistory(path: string): Promise<BenchHistory> {
  const counts = { path, malformed: 0, unknownVersion: 0 }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { runs: [], counts, found: false }
    throw error
  }
  const runs: BenchRunRecord[] = []
  for (const line of text.split('\n')) {
    if (!line.trim())
      continue
    const parsed = parsePerfLine(line)
    if (parsed.ok && parsed.record.kind === 'bench-run')
      runs.push(parsed.record)
    else if (!parsed.ok && parsed.reason === 'version')
      counts.unknownVersion += 1
    else
      counts.malformed += 1
  }
  return { runs, counts, found: true }
}
