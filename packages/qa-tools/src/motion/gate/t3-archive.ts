import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as v from 'valibot'

import { sha256Buffer } from '../../evidence/run'

/**
 * Integrity of an archived T3 emotion run before `--rescore` reads it. Every artifact scoring reads is checked against
 * the sha256 its own run dir's `run.json` recorded when it was written (`createRun().addArtifact`, todo 4). A file
 * without a recorded digest is refused as unverifiable, never skipped. This binds the archive to what the capture
 * wrote; it does not authenticate `run.json` itself, which is the digest source.
 */

/** A refusal: the archive does not match the digests recorded at capture time. */
export class ArchiveDigestError extends Error {
  constructor(detail: string) {
    super(`archive invariant "artifact-digest": ${detail}`)
  }
}

const ManifestSchema = v.looseObject({
  artifacts: v.array(v.looseObject({ path: v.string(), sha256: v.string() })),
})

const ArchivedRunSchema = v.looseObject({
  sessions: v.array(v.looseObject({ runDir: v.nullable(v.string()) })),
  t1Reference: v.looseObject({ runId: v.string() }),
})

/** The files a traced session contributes to scoring and to the session-header and trace-identity checks. */
export const t3SessionArtifacts = ['scenario.json', 'trace.json', 'bridge.json', 'verification.json'] as const

function recordedArtifacts(dir: string): Map<string, string> {
  const manifestPath = join(dir, 'run.json')
  if (!existsSync(manifestPath))
    throw new ArchiveDigestError(`${manifestPath} is missing, so nothing in ${dir} can be verified`)
  const parsed = v.safeParse(ManifestSchema, JSON.parse(readFileSync(manifestPath, 'utf8')))
  if (!parsed.success)
    throw new ArchiveDigestError(`${manifestPath} has no readable artifact list`)
  return new Map(parsed.output.artifacts.map(artifact => [artifact.path, artifact.sha256]))
}

/**
 * Checks each of `files` (paths relative to `dir`) against the digest `dir/run.json` recorded for it, and returns the
 * verified paths. Throws `ArchiveDigestError` naming the file for a missing file, a missing digest, or a mismatch.
 */
export function verifyRecordedArtifacts(dir: string, files: readonly string[]): string[] {
  const recorded = recordedArtifacts(dir)
  return files.map((file) => {
    const path = join(dir, file)
    const expected = recorded.get(file)
    if (expected === undefined)
      throw new ArchiveDigestError(`${path} has no digest recorded in ${join(dir, 'run.json')}, so it is unverifiable`)
    if (!existsSync(path))
      throw new ArchiveDigestError(`${path} is missing; ${join(dir, 'run.json')} recorded sha256 ${expected}`)
    const actual = sha256Buffer(readFileSync(path))
    if (actual !== expected)
      throw new ArchiveDigestError(`${path} has sha256 ${actual}, but ${join(dir, 'run.json')} recorded ${expected} when it was written`)
    return path
  })
}

/**
 * Verifies every artifact `--rescore` reads, before any of them is parsed for scoring: the gate run's `report.json` and
 * `scenarios/*.json` (every scenario on disk or recorded), the T1 reference's `report.json`, and each traced session's
 * `scenario.json`, `trace.json`, `bridge.json` and `verification.json`. A session counts as traced when its manifest
 * records `trace.json` or the file exists. Returns the verified paths.
 */
export function verifyT3Archive(sourceDir: string, repoRoot: string): string[] {
  const recordedScenarios = [...recordedArtifacts(sourceDir).keys()].filter(path => path.startsWith('scenarios/'))
  const diskScenarios = existsSync(join(sourceDir, 'scenarios')) ? readdirSync(join(sourceDir, 'scenarios')).map(name => `scenarios/${name}`) : []
  const covered = verifyRecordedArtifacts(sourceDir, ['report.json', ...[...new Set([...recordedScenarios, ...diskScenarios])].sort()])

  // report.json is verified, so its session list and T1 reference can be followed.
  const archived = v.safeParse(ArchivedRunSchema, JSON.parse(readFileSync(join(sourceDir, 'report.json'), 'utf8')))
  if (!archived.success)
    throw new ArchiveDigestError(`${join(sourceDir, 'report.json')} lists no sessions or T1 reference to verify`)
  covered.push(...verifyRecordedArtifacts(join(repoRoot, '.temp', 'qa', archived.output.t1Reference.runId), ['report.json']))
  for (const session of archived.output.sessions) {
    if (!session.runDir)
      continue
    const traced = recordedArtifacts(session.runDir).has('trace.json') || existsSync(join(session.runDir, 'trace.json'))
    if (traced)
      covered.push(...verifyRecordedArtifacts(session.runDir, t3SessionArtifacts))
  }
  return covered
}
