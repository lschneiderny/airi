import process from 'node:process'

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { sha256Buffer } from './run'

export interface ManifestFile {
  path: string
  sha256: string
  bytes: number
}

export interface EvidenceManifest {
  plan: string
  files: ManifestFile[]
}

export interface ArchiveConflict {
  path: string
  sourceSha256: string
  destinationSha256: string
}

export interface ArchiveResult {
  copied: string[]
  unchanged: string[]
  manifest: EvidenceManifest
}

export class EvidenceConflictError extends Error {
  constructor(readonly conflicts: ArchiveConflict[]) {
    super(`Refusing to archive: ${conflicts.length} file(s) already exist with different bytes: ${conflicts.map(c => c.path).join(', ')}`)
    this.name = 'EvidenceConflictError'
  }
}

const PLAN_PATTERN = /^\w[\w.-]*$/

export function assertPlanSlug(plan: string): void {
  if (!PLAN_PATTERN.test(plan) || plan.includes('..'))
    throw new Error(`Invalid plan slug ${JSON.stringify(plan)}: use letters, digits, '.', '_' and '-' only.`)
}

/**
 * Resolves the main checkout as the first `worktree` entry of
 * `git worktree list --porcelain`, run from `fromPath`.
 */
export function resolveMainCheckout(
  fromPath: string,
  runGit: (args: string[]) => string = args => execFileSync('git', args, { encoding: 'utf8' }),
): string {
  const output = runGit(['-C', fromPath, 'worktree', 'list', '--porcelain'])
  const first = output.split(/\r?\n/).find(line => line.startsWith('worktree '))
  if (!first)
    throw new Error(`No worktree entry found for ${fromPath}.`)
  return resolve(first.slice('worktree '.length))
}

function listFiles(root: string, prefix = ''): string[] {
  const entries = readdirSync(join(root, prefix), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory())
      files.push(...listFiles(root, rel))
    else if (entry.isFile())
      files.push(rel)
  }
  return files.sort()
}

function writeFileAtomic(target: string, data: Uint8Array | string): void {
  const tmp = `${target}.tmp-${process.pid}`
  writeFileSync(tmp, data)
  renameSync(tmp, target)
}

export function buildManifest(plan: string, dir: string): EvidenceManifest {
  const files = listFiles(dir)
    .filter(path => path !== 'manifest.json')
    .map((path): ManifestFile => {
      const data = readFileSync(join(dir, path))
      return { path, sha256: sha256Buffer(data), bytes: data.length }
    })
  return { plan, files }
}

/**
 * Copies `<from>/.omo/evidence/<plan>/` into `<main>/.omo/evidence/<plan>/`.
 * Source files are read once, so the hashed bytes are the copied bytes even if a
 * writer is still appending. Conflicts are detected before anything is written;
 * new files are staged in a temp dir and renamed into place. Never touches the source.
 */
export function archiveEvidence(options: { plan: string, from: string, main: string }): ArchiveResult {
  assertPlanSlug(options.plan)

  const source = resolve(options.from, '.omo', 'evidence', options.plan)
  const destination = resolve(options.main, '.omo', 'evidence', options.plan)

  if (!existsSync(source) || !statSync(source).isDirectory())
    throw new Error(`No evidence directory at ${source}.`)

  const snapshot = listFiles(source)
    .filter(path => path !== 'manifest.json')
    .map(path => ({ path, data: readFileSync(join(source, path)) }))

  const conflicts: ArchiveConflict[] = []
  const toCopy: typeof snapshot = []
  const unchanged: string[] = []
  for (const file of snapshot) {
    const target = join(destination, file.path)
    if (!existsSync(target)) {
      toCopy.push(file)
      continue
    }
    const destinationSha256 = sha256Buffer(readFileSync(target))
    const sourceSha256 = sha256Buffer(file.data)
    if (destinationSha256 === sourceSha256)
      unchanged.push(file.path)
    else
      conflicts.push({ path: file.path, sourceSha256, destinationSha256 })
  }

  if (conflicts.length > 0)
    throw new EvidenceConflictError(conflicts)

  mkdirSync(destination, { recursive: true })
  const staging = mkdtempSync(join(dirname(destination), `.${options.plan}-staging-`))
  try {
    for (const file of toCopy) {
      const staged = join(staging, file.path)
      mkdirSync(dirname(staged), { recursive: true })
      writeFileSync(staged, file.data)
    }
    for (const file of toCopy) {
      const target = join(destination, file.path)
      mkdirSync(dirname(target), { recursive: true })
      renameSync(join(staging, file.path), target)
    }
  }
  finally {
    rmSync(staging, { recursive: true, force: true })
  }

  const manifest = buildManifest(options.plan, destination)
  writeFileAtomic(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  return { copied: toCopy.map(f => f.path), unchanged, manifest }
}
