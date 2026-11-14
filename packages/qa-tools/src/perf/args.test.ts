import { describe, expect, it } from 'vitest'

import { parsePerfArgs, PerfUsageError } from './args'

const cwd = '/work'

describe('parsePerfArgs', () => {
  it('parses sessions with repeatable dirs resolved against the caller cwd and a since window', () => {
    expect(parsePerfArgs(['sessions', '--since', '7d', '--dir', 'a', '--dir', '/b', '--json'], cwd)).toEqual({ kind: 'sessions', dirs: ['/work/a', '/b'], sinceMs: 7 * 86_400_000, json: true })
    expect(parsePerfArgs(['sessions', '--since', '12h'], cwd)).toMatchObject({ dirs: null, sinceMs: 12 * 3_600_000, json: false })
  })

  it('parses the incident list and a single incident', () => {
    expect(parsePerfArgs(['incident', '--list'], cwd)).toEqual({ kind: 'incident-list', dirs: null, json: false })
    expect(parsePerfArgs(['incident', '2026-11-14T08-01-42-000Z-stall1', '--json'], cwd)).toEqual({ kind: 'incident', id: '2026-11-14T08-01-42-000Z-stall1', dirs: null, json: true })
  })

  it('parses features with defaults and an explicit feature, metric and seed', () => {
    expect(parsePerfArgs(['features'], cwd)).toEqual({ kind: 'features', dirs: null, feature: null, metric: 'p50FrameMs', seed: 1, json: false })
    expect(parsePerfArgs(['features', '--feature', 'mmdPhysics', '--metric', 'cpuPct', '--seed', '7', '--json'], cwd)).toMatchObject({ feature: 'mmdPhysics', metric: 'cpuPct', seed: 7, json: true })
  })

  it('parses compare with two sha prefixes and the dirty opt-in', () => {
    expect(parsePerfArgs(['compare', 'abc1234', 'DEF5678'], cwd)).toEqual({ kind: 'compare', dirs: null, shaA: 'abc1234', shaB: 'DEF5678', includeDirty: false, json: false })
    expect(parsePerfArgs(['compare', 'abc1234', 'def5678', '--include-dirty'], cwd)).toMatchObject({ includeDirty: true })
  })

  it('parses --help on its own', () => {
    expect(parsePerfArgs(['--help'], cwd)).toEqual({ kind: 'help' })
  })

  it.each([
    [['--bogus']],
    [['features', 'extra']],
    [['features', '--feature', 'unknown']],
    [['features', '--metric', 'fps']],
    [['features', '--seed', '-1']],
    [['features', '--include-dirty']],
    [['compare', 'abc1234']],
    [['compare', 'abc1234', 'not-a-sha']],
    [['compare', 'abc1234', 'def5678', '--feature', 'mmdPhysics']],
    [['sessions', '--seed', '2']],
    [[]],
    [['report']],
    [['sessions', 'extra']],
    [['sessions', '--since', '7x']],
    [['sessions', '--since', '0d']],
    [['sessions', '--list']],
    [['sessions', '--dir', ' ']],
    [['incident']],
    [['incident', '--list', 'some-id']],
    [['incident', '--since', '1d', '--list']],
    [['incident', '../escape']],
    [['incident', 'a/b']],
  ])('rejects %j as a usage error', (argv) => {
    expect(() => parsePerfArgs(argv, cwd)).toThrow(PerfUsageError)
  })
})
