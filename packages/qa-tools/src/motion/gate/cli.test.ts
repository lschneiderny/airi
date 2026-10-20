import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { parseGateArgs, runGateCli } from './cli'
import { gateBands, gateEmotions } from './options'

const parse = (...args: string[]) => parseGateArgs(args, 4)

describe('parseGateArgs', () => {
  it('defaults to every emotion and band and the given worker count', () => {
    const result = parse('emotion', '--level', 't1')

    expect(result).toEqual({ ok: true, command: { target: 'emotion', selection: { emotions: [...gateEmotions], bands: [...gateBands], seedsLimit: null }, workers: 4, timeoutMinutes: 90 } })
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
    [['emotion'], '--level is required'],
    [['emotion', '--level', 't2'], 'Valid levels: t1'],
    [['loud', '--level', 't1'], 'Valid gates: emotion, liveliness'],
    [['liveliness', '--level', 't1', '--emotions', 'angry'], 'emotion gate only'],
    [['emotion', '--level', 't1', '--nope'], 'nope'],
    [['emotion', 'extra', '--level', 't1'], 'extra'],
  ])('rejects %j', (args, message) => {
    const result = parse(...args)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain(message)
  })
})

describe('runGateCli', () => {
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
