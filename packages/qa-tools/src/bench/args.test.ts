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

  it('answers --help without other checks', () => {
    expect(parseBenchArgs(['--help'], '/work')).toEqual({ kind: 'help' })
  })
})
