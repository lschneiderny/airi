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

  it.each([
    [['--bogus']],
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
