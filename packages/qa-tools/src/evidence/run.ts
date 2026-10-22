import process from 'node:process'

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

export interface RunGitState {
  gitSha: string
  dirty: boolean
}

export interface RunGate {
  id: string
  version: string
  fileSha: string
}

export interface RunArtifact {
  path: string
  kind: string
  sha256: string
}

/** The root of a process tree the run launched, for example the Electron dev session of a T3 run. */
export interface RunProcess {
  rootPid: number
  /** Creation time of the root (Windows FILETIME UTC), so a reused PID is never taken for it. */
  created?: number
  commandLine: string
}

export interface RunResult {
  exitCode: number
  summary: string
}

/** Marks a run that replayed a stored result instead of computing it: a local check, never acceptance evidence. */
export interface RunCache {
  hit: true
  sourceRunId: string
  entryId: string
}

export interface RunManifest {
  runId: string
  tool: string
  label: string
  gitSha: string
  dirty: boolean
  startedAt: string
  endedAt: string
  command: string[]
  env: Record<string, string>
  gate?: RunGate
  process?: RunProcess
  cache?: RunCache
  artifacts: RunArtifact[]
  result: RunResult
}

export interface CreateRunOptions {
  tool: string
  label: string
  repoRoot: string
  gate?: RunGate
  cache?: RunCache
  /** Injectable for tests. Defaults to the current time. */
  now?: () => Date
  /** Injectable for tests. Defaults to `git rev-parse HEAD` / `git status --porcelain`. */
  readGitState?: (repoRoot: string) => RunGitState
  /** Injectable for tests. Defaults to `process.argv`. */
  command?: string[]
  /** Injectable for tests. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
}

export interface RunHandle {
  runId: string
  dir: string
  path: (name: string) => string
  addArtifact: (relPath: string, kind: string) => RunArtifact
  /** Records the root process the run launched; `run.json` lists it as `process`. */
  recordProcess: (process: RunProcess) => void
  finish: (result: RunResult) => RunManifest
}

const SEGMENT_PATTERN = /^[\w.-]+$/
const ENV_KEY_PATTERN = /^(?:APP_|AIRI_QA_)/

function assertSegment(name: string, value: string): void {
  if (!SEGMENT_PATTERN.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${name} ${JSON.stringify(value)}: use letters, digits, '.', '_' and '-' only.`)
  }
}

export function formatRunTimestamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

export function sha256Buffer(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

export function readGitStateFromRepo(repoRoot: string): RunGitState {
  const git = (...args: string[]) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' })
  return {
    gitSha: git('rev-parse', 'HEAD').trim(),
    dirty: git('status', '--porcelain').trim().length > 0,
  }
}

export function pickRunEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const key of Object.keys(env).sort()) {
    const value = env[key]
    if (ENV_KEY_PATTERN.test(key) && value !== undefined)
      picked[key] = value
  }
  return picked
}

/**
 * Creates `.temp/qa/<YYYYMMDD-HHmmss>-<tool>-<label>/` under `repoRoot`.
 * Throws when the directory already exists so two runs never share one.
 */
export function createRun(options: CreateRunOptions): RunHandle {
  assertSegment('tool', options.tool)
  assertSegment('label', options.label)

  const startedAt = (options.now ?? (() => new Date()))()
  const runId = `${formatRunTimestamp(startedAt)}-${options.tool}-${options.label}`
  const dir = resolve(options.repoRoot, '.temp', 'qa', runId)
  const { gitSha, dirty } = (options.readGitState ?? readGitStateFromRepo)(options.repoRoot)

  mkdirSync(join(dir, '..'), { recursive: true })
  mkdirSync(dir)

  const artifacts: RunArtifact[] = []
  let launched: RunProcess | undefined

  const path = (name: string): string => {
    const full = resolve(dir, name)
    const rel = relative(dir, full)
    if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || resolve(rel) === rel)
      throw new Error(`Path ${JSON.stringify(name)} escapes run directory ${runId}.`)
    return full
  }

  return {
    runId,
    dir,
    path,
    addArtifact(relPath, kind) {
      const artifact: RunArtifact = {
        path: relative(dir, path(relPath)).split(sep).join('/'),
        kind,
        sha256: sha256Buffer(readFileSync(path(relPath))),
      }
      artifacts.push(artifact)
      return artifact
    },
    recordProcess(process) {
      launched = { ...process }
    },
    finish(result) {
      const manifest: RunManifest = {
        runId,
        tool: options.tool,
        label: options.label,
        gitSha,
        dirty,
        startedAt: startedAt.toISOString(),
        endedAt: (options.now ?? (() => new Date()))().toISOString(),
        command: options.command ?? process.argv,
        env: pickRunEnv(options.env ?? process.env),
        ...(options.gate ? { gate: options.gate } : {}),
        ...(launched ? { process: launched } : {}),
        ...(options.cache ? { cache: options.cache } : {}),
        artifacts: [...artifacts],
        result,
      }
      writeFileSync(join(dir, 'run.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      return manifest
    },
  }
}
