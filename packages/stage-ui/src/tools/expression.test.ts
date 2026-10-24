import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionToolPort } from './expression'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createExpressionToolPort, StagePerformanceConductor } from '../composables/performance/use-stage-performance-conductor'
import { createExpressionTools } from './expression'

type Overrides = Pick<CatalogEntry, 'kind'> & Partial<Pick<CatalogEntry, 'label' | 'exposedToLlm' | 'confirmed'>>

// `hat` is an outfit marked exposed on purpose: the outfit kind must still keep it away from the LLM.
const rig: Record<string, Overrides> = {
  'anger.exp3.json': { kind: 'face', label: 'Anger', exposedToLlm: true },
  'tear.exp3.json': { kind: 'effect', label: 'tear', exposedToLlm: true },
  'game.exp3.json': { kind: 'prop', label: 'game', exposedToLlm: true },
  'hat.exp3.json': { kind: 'outfit', label: 'hat', exposedToLlm: true },
  'watermark.exp3.json': { kind: 'system', label: 'watermark', exposedToLlm: true },
  'smile.exp3.json': { kind: 'face', label: 'smile', exposedToLlm: false },
}

function execute(entry: { execute?: unknown } | undefined, input: unknown) {
  if (!entry?.execute)
    throw new Error('Expected the tool to define an execute function.')
  return (entry.execute as (value: unknown, options: unknown) => Promise<string>)(input, { messages: [], toolCallId: 'call-1' })
}

async function mount(curate = true) {
  const store = useExpressionStore()
  store.registerDefinitions('rig', Object.keys(rig).map(id => ({ id, name: id, fadeIn: 0, fadeOut: 0, parameters: [{ id: `P-${id}`, value: 1, blend: 'Add' as const }] })))
  for (const [id, overrides] of curate ? Object.entries(rig) : [])
    store.updateEntry(id, { confirmed: true, ...overrides })
  const conductor = new StagePerformanceConductor({
    scene: () => ({
      setEmotion: () => {},
      applySlots: (commands, now) => store.applySlots(commands, now),
      applyHolds: () => {},
      onSpeech: (event, turnId, now) => store.onSpeech(event, turnId, now),
      setMuted: muted => store.setMuted(muted),
    }),
    driver: () => 'natural',
    playMotion: () => {},
    settings: () => defaultExpressionPerformanceSettings,
    catalog: () => store.catalog,
    seed: 1,
    clock: () => 10,
  })
  const tools = await createExpressionTools(createExpressionToolPort(conductor, store))
  return { store, tools: new Map(tools.map(tool => [tool.function.name, tool])) }
}

describe('expression tools', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('offers only exposed face, effect, and prop labels in the parameter schema', async () => {
    const { tools } = await mount()

    expect([...tools.keys()].sort()).toEqual(['clear_expression', 'list_expressions', 'set_expression'])
    const parameters = tools.get('set_expression')!.function.parameters as { properties: { expression: { enum: string[] } } }
    expect(new Set(parameters.properties.expression.enum)).toEqual(new Set(['Anger', 'tear', 'game']))
    expect(JSON.stringify([...tools.values()].map(tool => tool.function))).not.toMatch(/hat|watermark|smile|P-/)
  })

  it('lists a combo label in the schema enum and describes combos in the tool description', async () => {
    const port: ExpressionToolPort = {
      list: () => [{ label: 'smile', kind: 'face', active: false }, { label: 'Pair', kind: 'combo', active: false }],
      set: () => ({ success: true }),
      clear: () => ({ success: true }),
    }
    const tools = new Map((await createExpressionTools(port)).map(item => [item.function.name, item]))

    const set = tools.get('set_expression')!.function
    expect((set.parameters as { properties: { expression: { enum: string[] } } }).properties.expression.enum).toEqual(['smile', 'Pair'])
    expect(set.description).toContain('combos')
    expect((await tools.get('set_expression')!.validate!({ expression: 'Pair' })).issues).toBeUndefined()
    expect((await tools.get('set_expression')!.validate!({ expression: 'unknown' })).issues).toBeDefined()
  })

  it('offers derived face, effect, and prop labels without any manual curation', async () => {
    const { tools } = await mount(false)

    const parameters = tools.get('set_expression')!.function.parameters as { properties: { expression: { enum: string[] } } }
    // Labels fall back to the file basename; outfit (hat) and system (watermark) stay hidden.
    expect(new Set(parameters.properties.expression.enum)).toEqual(new Set(['anger', 'tear', 'game', 'smile']))
  })

  it('shows an exposed face by label and reports it active', async () => {
    const { store, tools } = await mount()

    const result = JSON.parse(await execute(tools.get('set_expression'), { expression: 'Anger' }))

    expect(result).toEqual({ success: true, active: [{ slot: 'face', label: 'Anger' }] })
    expect(store.leases.face).toMatchObject({ expressionId: 'anger.exp3.json' })
  })

  it.each(['hat', 'watermark', 'smile', 'missing'])('refuses %s and lists the exposed labels', async (name) => {
    const { store, tools } = await mount()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = JSON.parse(await execute(tools.get('set_expression'), { expression: name }))

    expect(result.success).toBe(false)
    expect(new Set(result.available)).toEqual(new Set(['Anger', 'tear', 'game']))
    expect(store.leases).toEqual({ face: null, effect: null, prop: null })
  })

  it.each([0, 0.5, 31, Number.NaN, '5'])('rejects hold_seconds %s outside 1-30', async (holdSeconds) => {
    const { store, tools } = await mount()

    const result = JSON.parse(await execute(tools.get('set_expression'), { expression: 'game', hold_seconds: holdSeconds }))

    expect(result).toEqual({ success: false, error: 'hold_seconds must be a number from 1 to 30.' })
    expect(store.leases.prop).toBeNull()
    expect((await tools.get('set_expression')!.validate!({ expression: 'game', hold_seconds: holdSeconds })).issues).toBeDefined()
  })

  it('holds a prop for the requested seconds, then clears it on request', async () => {
    const { store, tools } = await mount()

    await execute(tools.get('set_expression'), { expression: 'game', hold_seconds: 30 })
    expect(store.leases.prop).toMatchObject({ expressionId: 'game.exp3.json', holdSeconds: 30, until: 'hold' })
    const listed = JSON.parse(await execute(tools.get('list_expressions'), {}))
    expect(listed.success).toBe(true)
    expect(listed.expressions).toHaveLength(3)
    expect(listed.expressions).toContainEqual({ label: 'game', kind: 'prop', active: true })

    const cleared = JSON.parse(await execute(tools.get('clear_expression'), { slot: 'prop' }))

    expect(cleared).toEqual({ success: true, active: [] })
    expect(store.leases.prop).toBeNull()
  })
})
