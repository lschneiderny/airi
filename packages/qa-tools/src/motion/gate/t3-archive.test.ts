import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { sha256Buffer } from '../../evidence/run'
import { verifyT3Archive } from './t3-archive'

/** A minimal archived T3 emotion run: gate run, T1 reference and one traced session, each with its own run.json digests. */
function writeArchive(root: string) {
  const write = (dir: string, files: Record<string, unknown>) => {
    mkdirSync(dir, { recursive: true })
    const artifacts = Object.entries(files).map(([path, value]) => {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), `${JSON.stringify(value, null, 2)}\n`)
      return { path, kind: 'test', sha256: sha256Buffer(readFileSync(join(dir, path))) }
    })
    writeFileSync(join(dir, 'run.json'), JSON.stringify({ runId: dir, artifacts }))
  }
  const qa = join(root, '.temp', 'qa')
  const session = join(qa, 'session-1')
  const gate = join(qa, 'gate')
  const scenario = { version: 1, id: 't3-emotion-transfer-1-of-3', events: [{ kind: 'emotion', at: 44, emotion: 'love', band: 'clear', source: 'devtools', trialId: 'love-clear-t3-1' }] }
  write(join(qa, 't1'), { 'report.json': { gateId: 'natural-emotion', determinismHash: 'a'.repeat(64) } })
  write(session, {
    'scenario.json': scenario,
    // The reviewer's round-4 targets: the stamped pulse time and the Natural hold side that folds signed checks.
    'trace.json': { version: 2, meta: { home: 'desk' }, t: [0, 1], events: [{ t: 44.0319, source: 'scenario', event: scenario.events[0] }, { t: 44.05, source: 'natural', event: { kind: 'hold', emotion: 'love', side: 1 } }] },
    'bridge.json': { rig: { name: 'forbooth' } },
    'verification.json': { ok: true, failures: [] },
  })
  write(gate, {
    'scenarios/t3-emotion-transfer-1-of-3.json': scenario,
    'report.json': { gateId: 'natural-emotion-t3', sessions: [{ scenarioId: scenario.id, runDir: session }], t1Reference: { runId: 't1' } },
  })
  return { qa, gate, session }
}

describe('verifyT3Archive', () => {
  let root: string
  let archive: ReturnType<typeof writeArchive>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'qa-t3-archive-'))
    archive = writeArchive(root)
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  interface TraceFile { meta: { home: string }, events: { t: number, event: { side?: number } }[] }
  interface ManifestFile { artifacts: { path: string, sha256: string }[] }
  const editJson = <T>(file: string, edit: (value: T) => void) => {
    const value = JSON.parse(readFileSync(file, 'utf8')) as T
    edit(value)
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
  }
  const refuses = (pattern: string) => expect(() => verifyT3Archive(archive.gate, root)).toThrow(pattern)

  it('accepts an untouched archive and lists every verified artifact', () => {
    const covered = verifyT3Archive(archive.gate, root).map(path => path.slice(archive.qa.length + 1).replaceAll('\\', '/'))
    expect(covered).toEqual([
      'gate/report.json',
      'gate/scenarios/t3-emotion-transfer-1-of-3.json',
      't1/report.json',
      'session-1/scenario.json',
      'session-1/trace.json',
      'session-1/bridge.json',
      'session-1/verification.json',
    ])
  })

  it('refuses the reviewer\'s flipped Natural hold side', () => {
    editJson<TraceFile>(join(archive.session, 'trace.json'), (trace) => {
      trace.events[1].event.side = -1
    })
    refuses('trace.json has sha256')
  })

  it.each([undefined, 'product'])('refuses a digest-valid trace with the wrong posture home (scenario home: %s)', (home) => {
    editJson<{ home?: string }>(join(archive.session, 'scenario.json'), (scenario) => {
      scenario.home = home
    })
    editJson<TraceFile>(join(archive.session, 'trace.json'), (trace) => {
      trace.meta.home = home === undefined ? 'product' : 'desk'
    })
    editJson<ManifestFile>(join(archive.session, 'run.json'), (manifest) => {
      for (const artifact of manifest.artifacts)
        artifact.sha256 = sha256Buffer(readFileSync(join(archive.session, artifact.path)))
    })
    refuses('archive invariant "posture-home"')
  })

  it('refuses the reviewer\'s pulse stamped 1.5 s later', () => {
    editJson<TraceFile>(join(archive.session, 'trace.json'), (trace) => {
      trace.events[0].t += 1.5
    })
    refuses('trace.json has sha256')
  })

  it.each([
    ['gate', 'report.json'],
    ['gate', 'scenarios/t3-emotion-transfer-1-of-3.json'],
    ['t1', 'report.json'],
    ['session-1', 'scenario.json'],
    ['session-1', 'trace.json'],
    ['session-1', 'bridge.json'],
    ['session-1', 'verification.json'],
  ])('refuses a one-byte edit of %s/%s', (dir, file) => {
    const path = join(archive.qa, dir, file)
    writeFileSync(path, `${readFileSync(path, 'utf8')} `)
    refuses(`${file.split('/').at(-1)} has sha256`)
  })

  it('refuses a covered file whose digest was deleted from run.json as unverifiable', () => {
    editJson<ManifestFile>(join(archive.session, 'run.json'), (manifest) => {
      manifest.artifacts = manifest.artifacts.filter(artifact => artifact.path !== 'trace.json')
    })
    refuses('trace.json has no digest recorded')
  })

  it('refuses a covered file that is missing', () => {
    rmSync(join(archive.session, 'bridge.json'))
    refuses('bridge.json is missing')
  })

  it('refuses a session whose run.json is missing', () => {
    rmSync(join(archive.session, 'run.json'))
    refuses('nothing in')
  })

  it('refuses a scenario added to the gate run without a recorded digest', () => {
    writeFileSync(join(archive.gate, 'scenarios', 't3-emotion-transfer-2-of-3.json'), '{}')
    refuses('t3-emotion-transfer-2-of-3.json has no digest recorded')
  })
})
