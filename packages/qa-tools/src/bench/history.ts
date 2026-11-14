import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, posix, win32 } from 'node:path'

export interface BenchHistoryHost {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  readonly homedir: string
}

/**
 * The per-machine bench history, `<state dir>/airi-perf/bench.jsonl`, resolved like the CPU slot history:
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
