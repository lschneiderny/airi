import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { parseGateArgs, resolveWorkers, runGateCli } from './cli'
import { emotionGateFor, gateBands, gateEmotions, livelinessGateFor } from './options'

const parse = (...args: string[]) => parseGateArgs(args)

describe('parseGateArgs', () => {
  it('defaults to every emotion and band and leaves the worker count to the slot grant', () => {
    const result = parse('emotion', '--level', 't1')

    expect(result).toEqual({ ok: true, command: { target: 'emotion', level: 't1', selection: { emotions: [...gateEmotions], bands: [...gateBands], seedsLimit: null }, workers: null, timeoutMinutes: 90, t1Report: null, rescore: null, fresh: false } })
  })

  it('accepts filters and dedupes repeated values', () => {
    const result = parse('emotion', '--level', 't1', '--emotions', 'angry,angry,sad', '--bands', 'strong', '--seeds', '5', '--workers', '2')

    expect(result).toMatchObject({ ok: true, command: { selection: { emotions: ['angry', 'sad'], bands: ['strong'], seedsLimit: 5 }, workers: 2 } })
  })

  it.each([
    [['emotion', '--level', 't1', '--emotions', 'not-an-emotion'], gateEmotions.join(', ')],
    [['emotion', '--level', 't1', '--emotions', 'neutral'], gateEmotions.join(', ')],
    [['emotion', '--level', 't1', '--bands', 'loud'], gateBands.join(', ')],
    [['emotion', '--level', 't1', '--seeds', '0'], '--seeds'],
    [['emotion', '--level', 't1', '--seeds', '2.5'], '--seeds'],
    [['emotion', '--level', 't1', '--workers', 'many'], '--workers'],
    [['emotion', '--level', 't1', '--workers', '0'], '--workers'],
    [['emotion'], '--level is required'],
    [['emotion', '--level', 't2'], '--rig forbooth'],
    [['emotion', '--level', 't2', '--rig', 'bear'], '--rig forbooth'],
    [['emotion', '--level', 't1', '--rig', 'forbooth'], '--level t2 or t3 only'],
    [['emotion', '--level', 't4'], 'Valid levels: t1, t2, t3'],
    [['emotion', '--level', 't3'], '--rig forbooth'],
    [['emotion', '--level', 't3', '--rig', 'forbooth', '--emotions', 'angry'], 'committed cells'],
    [['liveliness', '--level', 't3', '--rig', 'forbooth', '--workers', '2'], 'committed cells'],
    [['liveliness', '--level', 't3', '--rig', 'forbooth', '--t1-report', 'x'], '--t1-report'],
    [['emotion', '--level', 't1', '--t1-report', 'x'], '--t1-report'],
    [['liveliness', '--level', 't3', '--rig', 'forbooth', '--rescore', 'x'], '--rescore'],
    [['emotion', '--level', 't3', '--rig', 'forbooth', '--rescore', 'x', '--t1-report', 'y'], '--rescore'],
    [['loud', '--level', 't1'], 'Valid gates: emotion, liveliness'],
    [['liveliness', '--level', 't1', '--emotions', 'angry'], 'emotion gate only'],
    [['emotion', '--level', 't1', '--nope'], 'nope'],
    [['emotion', 'extra', '--level', 't1'], 'extra'],
  ])('rejects %j', (args, message) => {
    const result = parse(...args)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain(message)
  })

  it('accepts the T3 gates on ForBOOTH with an optional T1 reference', () => {
    expect(parse('emotion', '--level', 't3', '--rig', 'forbooth', '--t1-report', 'run-dir')).toMatchObject({ ok: true, command: { target: 'emotion', level: 't3', t1Report: 'run-dir' } })
    expect(parse('liveliness', '--level', 't3', '--rig', 'forbooth')).toMatchObject({ ok: true, command: { target: 'liveliness', level: 't3', t1Report: null, rescore: null } })
    expect(parse('emotion', '--level', 't3', '--rig', 'forbooth', '--rescore', 'old-run')).toMatchObject({ ok: true, command: { rescore: 'old-run' } })
  })

  it('runs T2 on ForBOOTH with its specified simulation budget and unchanged score rules', () => {
    expect(parse('emotion', '--level', 't2', '--rig', 'forbooth')).toMatchObject({ ok: true, command: { level: 't2' } })
    const gate = emotionGateFor('t2')
    expect(gate.seeds.full).toEqual({ start: 1, count: 30 })
    expect(gate.seeds.heldOnly).toEqual({ start: 1, count: 30 })
    expect({ ...gate, seeds: emotionGateFor('t1').seeds }).toEqual(emotionGateFor('t1'))
    const idle = livelinessGateFor('t2')
    expect(idle.seeds).toEqual([1, 2, 3])
    expect(idle.warmUpSeconds + idle.scoredSeconds).toBe(600)
  })
})

describe('resolveWorkers', () => {
  it('defaults to the grant and clamps a larger request to it', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      expect(resolveWorkers(null, 6)).toBe(6)
      expect(resolveWorkers(2, 6)).toBe(2)
      expect(info).not.toHaveBeenCalled()
      expect(resolveWorkers(20, 6)).toBe(6)
      expect(info.mock.calls.flat().join('\n')).toContain('--workers 20 clamped to grant 6')
    }
    finally {
      info.mockRestore()
    }
  })

  it('keeps the request when no grant applies', () => {
    expect(resolveWorkers(20, null)).toBe(20)
    expect(resolveWorkers(null, null)).toBeGreaterThanOrEqual(1)
  })
})

describe('runGateCli', () => {
  it.each([undefined, '{'])('exits 2 for an unusable T2 rig before creating a run: %s', async (json) => {
    const root = mkdtempSync(join(tmpdir(), 'qa-cli-t2-'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      if (json !== undefined)
        writeFileSync(join(root, 'bad.model3.json'), json)
      expect(await runGateCli(['emotion', '--level', 't2', '--rig', 'forbooth'], root, { AIRI_QA_RIG_FORBOOTH: root })).toBe(2)
      expect(readdirSync(root)).toEqual(json === undefined ? [] : ['bad.model3.json'])
    }
    finally {
      error.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('exits 2 for T3 without a rig before creating a run', async () => {
    vi.stubEnv('AIRI_CPU_SLOTS', 'off')
    const root = mkdtempSync(join(tmpdir(), 'qa-cli-t3-'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await runGateCli(['liveliness', '--level', 't3', '--rig', 'forbooth'], root, {})).toBe(2)
      expect(error.mock.calls.flat().join('\n')).toContain('AIRI_QA_RIG_FORBOOTH')
      expect(readdirSync(root)).toEqual([])
    }
    finally {
      vi.unstubAllEnvs()
      error.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('exits 2 on bad arguments without creating a run directory', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'qa-cli-'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await runGateCli(['emotion', '--level', 't1', '--emotions', 'not-an-emotion'], repoRoot)).toBe(2)
      expect(error.mock.calls.flat().join('\n')).toContain('angry')
      expect(readdirSync(repoRoot)).toEqual([])
    }
    finally {
      error.mockRestore()
      rmSync(repoRoot, { recursive: true, force: true })
    }
  })
})
