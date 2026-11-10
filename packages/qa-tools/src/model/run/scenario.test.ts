import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { REPLY_MAX_TOKENS } from '@proj-airi/stage-shared/stage-contract'
import { afterEach, describe, expect, it } from 'vitest'

import { loadScenario, parseScenario } from './scenario'

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const owned: string[] = []

afterEach(async () => {
  await Promise.all(owned.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function scenario(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'airi.model-scenario/v1',
    id: 'sample',
    version: 1,
    description: 'A sample.',
    prompt: { register: 'talking' },
    startsAt: '2026-11-10T09:00',
    configs: { default: { max_tokens: 320 } },
    turns: ['hello'],
    ...overrides,
  }
}

describe('parseScenario', () => {
  it('accepts a minimal scenario and one with stages, a flavor, and exposed gestures', () => {
    expect(parseScenario(scenario()).exposedActions).toEqual([])
    const parsed = parseScenario(scenario({
      prompt: { register: 'texting', textingFlavor: 'discord', exposedActions: 'wave:gesture,bow:gesture' },
      stages: ['stranger', 'intimate'],
      configs: { 'default': {}, 'temp-0.6': { temperature: 0.6, top_p: 0.9, max_tokens: 200, seed: 7, reasoning_effort: 'none' } },
    }))

    expect(parsed.exposedActions).toEqual([{ label: 'wave', kind: 'gesture' }, { label: 'bow', kind: 'gesture' }])
    expect(parsed.scenario.stages).toEqual(['stranger', 'intimate'])
  })

  it.each([
    ['an unknown top-level key', { tools: [] }, 'tools'],
    ['a context size, which the endpoint shape cannot set', { configs: { default: { num_ctx: 8192 } } }, 'configs.default.num_ctx'],
    ['an unknown reasoning effort', { configs: { default: { reasoning_effort: 'off' } } }, 'configs.default.reasoning_effort'],
    ['no config', { configs: {} }, 'define at least one config'],
    ['an unknown stage', { stages: ['married'] }, 'stages.0'],
    ['a repeated stage', { stages: ['close', 'close'] }, 'a stage appears twice'],
    ['no turns', { turns: [] }, 'turns'],
    ['a blank turn', { turns: ['  '] }, 'turns.0'],
    ['a start time with seconds', { startsAt: '2026-11-10T09:00:00' }, 'use YYYY-MM-DDTHH:MM'],
    ['an id that is not a slug', { id: 'My Scenario' }, 'id'],
    ['a prompt without a register', { prompt: {} }, 'prompt.register'],
    ['version zero', { version: 0 }, 'version'],
  ])('rejects %s', (_name, overrides, message) => {
    expect(() => parseScenario(scenario(overrides))).toThrow(message)
  })

  it('rejects an exposed action or dance, because a run sends no perform_action tool', () => {
    expect(() => parseScenario(scenario({ prompt: { register: 'talking', exposedActions: 'wave:gesture,twirl:dance' } })))
      .toThrow('"twirl" is a dance, which needs the perform_action tool')
    expect(() => parseScenario(scenario({ prompt: { register: 'talking', exposedActions: 'wave' } }))).toThrow('expected label:kind')
  })
})

describe('loadScenario', () => {
  it.each(['general', 'relationship-stages'])('loads the committed %s scenario with the app reply cap in every config', async (id) => {
    const loaded = await loadScenario(id, repoRoot)

    expect(loaded.scenario.id).toBe(id)
    expect(loaded.file).toBe(`packages/qa-tools/fixtures/model/scenarios/${id}.json`)
    expect(loaded.fileSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(loaded.cardPrompt).toBeNull()
    for (const config of Object.values(loaded.scenario.configs))
      expect(config.max_tokens).toBe(REPLY_MAX_TOKENS)
  })

  it('reads a scenario file and its card from the directory of the scenario', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'model-scenario-'))
    owned.push(dir)
    await writeFile(join(dir, 'card.txt'), 'You are Shuka.\n')
    await writeFile(join(dir, 'custom.json'), JSON.stringify(scenario({ prompt: { register: 'talking', cardFile: 'card.txt' } })))

    const loaded = await loadScenario(join(dir, 'custom.json'), repoRoot)

    expect(loaded.cardPrompt).toBe('You are Shuka.\n')
    expect(loaded.scenario.id).toBe('sample')
  })

  it('names the file of a missing, malformed, or invalid scenario', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'model-scenario-'))
    owned.push(dir)
    await writeFile(join(dir, 'broken.json'), '{')
    await writeFile(join(dir, 'invalid.json'), JSON.stringify(scenario({ turns: [] })))

    await expect(loadScenario('absent', repoRoot)).rejects.toThrow(/fixtures[\\/]model[\\/]scenarios[\\/]absent\.json: ENOENT/)
    await expect(loadScenario(join(dir, 'broken.json'), repoRoot)).rejects.toThrow('broken.json: ')
    await expect(loadScenario(join(dir, 'invalid.json'), repoRoot)).rejects.toThrow('invalid.json: turns')
  })
})
