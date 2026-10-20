import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createRun, formatRunTimestamp, sha256Buffer } from './run'

describe('createRun', () => {
  let repoRoot: string

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'qa-run-'))
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  const startedAt = new Date(2026, 9, 20, 3, 4, 5)
  const baseOptions = () => ({
    tool: 'motion',
    label: 'idle',
    repoRoot,
    now: () => startedAt,
    readGitState: () => ({ gitSha: 'abc123', dirty: true }),
    command: ['node', 'run.ts', '--x'],
    env: { APP_REMOTE_DEBUG: 'true', AIRI_QA_RIG_BEAR: 'bear', PATH: '/bin', HOME: '/home' },
  })

  it('names the run dir <timestamp>-<tool>-<label> under .temp/qa', () => {
    const run = createRun(baseOptions())

    expect(formatRunTimestamp(startedAt)).toBe('20261020-030405')
    expect(run.runId).toBe('20261020-030405-motion-idle')
    expect(run.dir).toBe(join(repoRoot, '.temp', 'qa', run.runId))
  })

  it('writes run.json with the documented fields and sha256 per artifact', () => {
    const run = createRun({ ...baseOptions(), gate: { id: 'g', version: '1', fileSha: 'f' } })
    writeFileSync(run.path('out.txt'), 'hello')
    const artifact = run.addArtifact('out.txt', 'log')
    const manifest = run.finish({ exitCode: 0, summary: 'ok' })

    const onDisk = JSON.parse(readFileSync(join(run.dir, 'run.json'), 'utf8'))
    expect(onDisk).toEqual(manifest)
    expect(onDisk).toMatchObject({
      runId: run.runId,
      tool: 'motion',
      label: 'idle',
      gitSha: 'abc123',
      dirty: true,
      command: ['node', 'run.ts', '--x'],
      gate: { id: 'g', version: '1', fileSha: 'f' },
      result: { exitCode: 0, summary: 'ok' },
    })
    expect(onDisk.env).toEqual({ AIRI_QA_RIG_BEAR: 'bear', APP_REMOTE_DEBUG: 'true' })
    expect(onDisk.startedAt).toBe(startedAt.toISOString())
    expect(typeof onDisk.endedAt).toBe('string')
    expect(artifact).toEqual({ path: 'out.txt', kind: 'log', sha256: sha256Buffer(Buffer.from('hello')) })
    expect(onDisk.artifacts).toEqual([artifact])
  })

  it('omits gate when none is given', () => {
    const run = createRun(baseOptions())
    expect(run.finish({ exitCode: 1, summary: 'bad' })).not.toHaveProperty('gate')
  })

  it('records the launched root process only when one was recorded', () => {
    const launched = createRun({ ...baseOptions(), label: 'launched' })
    launched.recordProcess({ rootPid: 4242, created: 1234, commandLine: 'node pnpm.mjs --dir C:/repo dev' })
    expect(launched.finish({ exitCode: 0, summary: 'ok' }).process).toEqual({ rootPid: 4242, created: 1234, commandLine: 'node pnpm.mjs --dir C:/repo dev' })

    expect(createRun(baseOptions()).finish({ exitCode: 0, summary: 'ok' })).not.toHaveProperty('process')
  })

  it('refuses an existing run dir', () => {
    createRun(baseOptions())
    expect(() => createRun(baseOptions())).toThrow()
  })

  it.each(['../x', 'a/b', '', '..', 'a b'])('rejects unsafe tool/label %j', (value) => {
    expect(() => createRun({ ...baseOptions(), label: value })).toThrow(/Invalid label/)
    expect(() => createRun({ ...baseOptions(), tool: value })).toThrow(/Invalid tool/)
  })

  it('rejects paths that escape the run dir', () => {
    const run = createRun(baseOptions())
    mkdirSync(join(repoRoot, '.temp', 'qa', 'sibling'), { recursive: true })
    expect(() => run.path('../sibling/x')).toThrow(/escapes/)
    expect(() => run.addArtifact('../../outside', 'log')).toThrow(/escapes/)
  })
})
