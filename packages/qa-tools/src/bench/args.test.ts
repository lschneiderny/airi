import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseBenchArgs } from './args'
import { BenchUsageError } from './matrix'

describe('qa:bench arguments', () => {
  it('runs every scenario five times by default and resolves --out against the caller directory', () => {
    const command = parseBenchArgs(['--out', 'bench'], '/work')

    expect(command).toMatchObject({ kind: 'run', runs: 5, out: '/work/bench' })
    expect(command.kind === 'run' && command.scenarios.map(scenario => scenario.id)).toEqual(['mmd-idle', 'mmd-talk', 'live2d-idle'])
  })

  it('refuses fewer than three runs, which the bench comparison cannot use', () => {
    expect(() => parseBenchArgs(['--runs', '2'], '/work')).toThrow(BenchUsageError)
    expect(parseBenchArgs(['--runs', '3', '--scenario', 'mmd-idle'], '/work')).toMatchObject({ kind: 'run', runs: 3, out: null })
  })

  it.each([['--runs', '3.5'], ['--scenario', 'vrm-idle'], ['--bogus'], ['extra']])('refuses %j', (...argv) => {
    expect(() => parseBenchArgs(argv, '/work')).toThrow(BenchUsageError)
  })

  it('leaves the checkout and the deadline unset by default', () => {
    expect(parseBenchArgs([], '/work')).toMatchObject({ kind: 'run', repoRoot: null, notAfter: null })
  })

  it('resolves --repo-root against the caller directory to an absolute checkout path', () => {
    const repoRoot = resolve(import.meta.dirname, '../../../..')

    expect(parseBenchArgs(['--repo-root', '../..'], resolve(repoRoot, 'packages/qa-tools'))).toMatchObject({ kind: 'run', repoRoot })
  })

  it('refuses a --repo-root without apps/stage-tamagotchi/package.json', () => {
    expect(() => parseBenchArgs(['--repo-root', 'no-such-checkout'], import.meta.dirname)).toThrow(BenchUsageError)
  })

  it('parses --not-after as an ISO time with an offset', () => {
    expect(parseBenchArgs(['--not-after', '2026-11-21T06:30:00+01:00'], '/work')).toMatchObject({ kind: 'run', notAfter: new Date('2026-11-21T05:30:00Z') })
  })

  it('accepts a --not-after leap day without seconds', () => {
    expect(parseBenchArgs(['--not-after', '2028-02-29T06:30-05:45'], '/work')).toMatchObject({ kind: 'run', notAfter: new Date('2028-02-29T12:15:00Z') })
  })

  it.each(['tomorrow', '1', '2026-11-21', '2026-11-21T06:30:00', '2026-13-40T99:00:00Z', '2026-02-30T06:00:00Z', '2026-11-21T24:00:00Z', '2026-11-21T06:00:00+25:00'])('refuses --not-after %j', (value) => {
    expect(() => parseBenchArgs(['--not-after', value], '/work')).toThrow(BenchUsageError)
  })

  it('answers --help without other checks', () => {
    expect(parseBenchArgs(['--help'], '/work')).toEqual({ kind: 'help' })
  })
})
