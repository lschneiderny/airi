import type { MotionQaEvent } from '@proj-airi/stage-shared/motion-scenario'

import { describe, expect, it } from 'vitest'

import { parseAppArgs } from './args'
import { buildPlan, buildSeedEntries } from './plan'
import { buildSummary, matchExpectations } from './summary'

describe('app session planning', () => {
  it('plans a nonexistent model without reading it and preserves repeated messages', () => {
    const options = parseAppArgs(['run', '--dry-run', '--model', 'rig.zip', '--say', 'hello', '--say', 'again', '--expect', 'act,tts'], '/work')
    const plan = buildPlan(options, '/run')
    expect(plan.model).toEqual({ path: '/work/rig.zip', kind: 'live2d' })
    expect(plan.messages).toEqual(['hello', 'again'])
    expect(plan.env.APP_USER_DATA_PATH).toBe('/run/profile')
    expect(JSON.stringify(plan)).not.toContain('"apiKey":"replay"')
    expect(plan.seed.entries['settings/providers/configured']).toContain('[REDACTED]')
    expect(plan.steps).toContain('teardown owned processes and remove temporary profile')
  })

  it.each([
    ['run', '--model', 'a.zip', '--say', 'x', '--script', 'a', '--set', 'b'],
    ['run', '--model', 'a.zip', '--say', 'x', '--timeout', 'NaN'],
    ['run', '--model', 'a.zip', '--say', 'x', '--expect', 'oops'],
    ['run', '--model', 'a.zip', '--say', ''],
    ['run', '--model', 'a.zip', '--say', 'x', '--kind', 'png'],
    ['launch'],
  ])('refuses invalid arguments %j', (...args) => {
    expect(() => parseAppArgs(args, '/work')).toThrow()
  })

  it.each([['avatar.vrm', 'vrm'], ['body.pmx', 'mmd'], ['model', 'live2d']])('infers %s without filesystem access', (path, kind) => {
    expect(parseAppArgs(['run', '--model', path, '--say', 'hi'], '/work').kind).toBe(kind)
  })

  it('seeds compatible chat and speech using storage encodings that the stores read', () => {
    const entries = buildSeedEntries('http://127.0.0.1:1234/v1/')
    const providers = JSON.parse(entries['settings/providers/configured'])
    expect(providers['openai-compatible'].config).toMatchObject({ api: 'chat-completions', baseUrl: 'http://127.0.0.1:1234/v1/', apiKey: 'replay', model: 'airi-replay' })
    expect(entries['settings/consciousness/active-model']).toBe('airi-replay')
    expect(entries['settings/speech/voice']).toBe('alloy')
    expect(entries['settings/speech/enabled']).toBe('true')
  })
})

describe('app expectations', () => {
  const events: MotionQaEvent[] = [
    { seq: 1, time: 1, kind: 'act' as const, payload: { emotion: 'happy' } },
    { seq: 2, time: 2, kind: 'turn' as const, payload: { phase: 'end', text: 'hello' } },
    { seq: 3, time: 3, kind: 'tts' as const, payload: { phase: 'start' } },
  ]
  it('ignores prior-turn events when matching a new send', () => {
    expect(matchExpectations(events, ['act', 'tts'], 1)).toEqual(['act'])
  })
  it('builds one failure summary with kind counts and missing expectations', () => {
    expect(buildSummary({ runDir: '/run', model: '/rig.zip', sendPaths: ['composer', 'chatSend'], events, missing: ['clip'], screenshot: '/run/stage.png', diagnostics: '/run/diagnostics.json', durationMs: 42, failed: false, pageErrors: 2 })).toEqual({
      ok: false,
      runDir: '/run',
      model: '/rig.zip',
      sendPath: 'mixed',
      events: { act: 1, turn: 1, tts: 1 },
      missing: ['clip'],
      screenshot: '/run/stage.png',
      diagnostics: '/run/diagnostics.json',
      durationMs: 42,
      pageErrors: 2,
    })
  })
})
