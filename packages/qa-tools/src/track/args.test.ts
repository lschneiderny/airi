import { describe, expect, it } from 'vitest'

import { parseTrackArgs, TrackUsageError } from './args'

const SUBJECT = 'b'.repeat(40)
const BASELINE = 'a'.repeat(40)

const parse = (argv: string[], env: Record<string, string> = {}) => parseTrackArgs(argv, env)

describe('parseTrackArgs tick', () => {
  it('defaults to an automatic manual-trigger tick, five runs and no parsed deadline', () => {
    expect(parse(['tick'])).toEqual({ kind: 'tick', manual: null, scenario: null, runs: 5, deadline: null, planOnly: false, trigger: 'manual' })
  })

  it('gives a manual pair no deadline unless --deadline is given', () => {
    expect(parse(['tick', '--subject', 'head', '--baseline', 'base'])).toMatchObject({ manual: { subject: 'head', baseline: 'base' }, deadline: null })
    expect(parse(['tick', '--subject', 'head', '--baseline', 'base', '--deadline', '05:45'])).toMatchObject({ deadline: '05:45' })
  })

  it('takes a subject and a baseline together as a manual tick', () => {
    expect(parse(['tick', '--subject', SUBJECT, '--baseline', BASELINE, '--scenario', 'mmd-idle'])).toMatchObject({
      manual: { subject: SUBJECT, baseline: BASELINE },
      scenario: 'mmd-idle',
    })
  })

  it('refuses --subject without --baseline and --baseline without --subject', () => {
    expect(() => parse(['tick', '--subject', SUBJECT])).toThrow(TrackUsageError)
    expect(() => parse(['tick', '--baseline', BASELINE])).toThrow(TrackUsageError)
  })

  it('needs at least three whole runs', () => {
    expect(parse(['tick', '--runs', '3'])).toMatchObject({ runs: 3 })
    expect(parse(['tick', '--runs', '10000'])).toMatchObject({ runs: 10000 })
    expect(() => parse(['tick', '--runs', '-3'])).toThrow(TrackUsageError)
    expect(() => parse(['tick', '--runs', '99999999999999999999'])).toThrow(TrackUsageError)
    expect(() => parse(['tick', '--runs', '2'])).toThrow(TrackUsageError)
    expect(() => parse(['tick', '--runs', '3.5'])).toThrow(TrackUsageError)
    expect(() => parse(['tick', '--runs', 'five'])).toThrow(TrackUsageError)
  })

  it('takes a deadline as HH:MM only', () => {
    expect(parse(['tick', '--deadline', '05:45'])).toMatchObject({ deadline: '05:45' })
    expect(() => parse(['tick', '--deadline', '6:30'])).toThrow(TrackUsageError)
    expect(() => parse(['tick', '--deadline', '24:00'])).toThrow(TrackUsageError)
    expect(() => parse(['tick', '--deadline', '06:60'])).toThrow(TrackUsageError)
  })

  it('takes plan-only from the flag or from AIRI_PERF_TRACK_PLAN_ONLY=1', () => {
    expect(parse(['tick', '--plan-only'])).toMatchObject({ planOnly: true })
    expect(parse(['tick'], { AIRI_PERF_TRACK_PLAN_ONLY: '1' })).toMatchObject({ planOnly: true })
    expect(parse(['tick'], { AIRI_PERF_TRACK_PLAN_ONLY: '0' })).toMatchObject({ planOnly: false })
  })

  it('takes a timer or manual trigger only', () => {
    expect(parse(['tick', '--trigger', 'timer'])).toMatchObject({ trigger: 'timer' })
    expect(parse(['tick', '--trigger', 'manual'])).toMatchObject({ trigger: 'manual' })
    expect(() => parse(['tick', '--trigger', 'cron'])).toThrow(TrackUsageError)
  })

  it('refuses an empty scenario and positionals', () => {
    expect(() => parse(['tick', '--scenario', ' '])).toThrow(TrackUsageError)
    expect(() => parse(['tick', 'extra'])).toThrow(TrackUsageError)
  })
})

describe('parseTrackArgs close', () => {
  it('closes one id with a resolution, no fix sha and an empty note by default', () => {
    expect(parse(['close', 'mmd-idle:fps:aaaaaaa..bbbbbbb', '--resolution', 'noise'])).toEqual({
      kind: 'close',
      id: 'mmd-idle:fps:aaaaaaa..bbbbbbb',
      resolution: 'noise',
      at: null,
      note: '',
    })
  })

  it('takes the fix sha and a note', () => {
    expect(parse(['close', 'x', '--resolution', 'fixed', '--at', SUBJECT, '--note', 'reverted the extra pass'])).toMatchObject({
      resolution: 'fixed',
      at: SUBJECT,
      note: 'reverted the extra pass',
    })
  })

  it('takes each resolution', () => {
    expect(parse(['close', 'x', '--resolution', 'fixed'])).toMatchObject({ resolution: 'fixed' })
    expect(parse(['close', 'x', '--resolution', 'accepted'])).toMatchObject({ resolution: 'accepted' })
    expect(parse(['close', 'x', '--resolution', 'noise'])).toMatchObject({ resolution: 'noise' })
  })

  it('refuses a missing or unknown resolution, a bad sha and a wrong id count', () => {
    expect(() => parse(['close', 'x'])).toThrow(TrackUsageError)
    expect(() => parse(['close', 'x', '--resolution', 'wontfix'])).toThrow(TrackUsageError)
    expect(() => parse(['close', 'x', '--resolution', 'fixed', '--at', 'HEAD'])).toThrow(TrackUsageError)
    expect(() => parse(['close', '--resolution', 'noise'])).toThrow(TrackUsageError)
    expect(() => parse(['close', 'x', 'y', '--resolution', 'noise'])).toThrow(TrackUsageError)
  })

  it('refuses tick flags', () => {
    expect(() => parse(['close', 'x', '--resolution', 'noise', '--runs', '5'])).toThrow(TrackUsageError)
  })
})

describe('parseTrackArgs timer and help', () => {
  it('parses install-timer with an optional ref and uninstall-timer bare', () => {
    expect(parse(['install-timer'])).toEqual({ kind: 'install-timer', ref: null })
    expect(parse(['install-timer', '--ref', 'origin/main'])).toEqual({ kind: 'install-timer', ref: 'origin/main' })
    expect(parse(['uninstall-timer'])).toEqual({ kind: 'uninstall-timer' })
    expect(() => parse(['uninstall-timer', '--ref', 'origin/main'])).toThrow(TrackUsageError)
  })

  it('parses --help on its own', () => {
    expect(parse(['--help'])).toEqual({ kind: 'help' })
  })

  it('refuses an unknown or missing subcommand and an unknown flag with the usage text', () => {
    expect(() => parse(['status'])).toThrow(/Usage: pnpm perf:track/)
    for (const word of ['toString', 'constructor', '__proto__'])
      expect(() => parse([word])).toThrow(/Unknown subcommand/)
    expect(() => parse([])).toThrow(/Usage: pnpm perf:track/)
    expect(() => parse(['tick', '--bogus'])).toThrow(/Usage: pnpm perf:track/)
  })
})
