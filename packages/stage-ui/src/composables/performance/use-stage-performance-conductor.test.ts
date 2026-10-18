import type { AffectSignal, CatalogEntry, ExpressionPerformanceSettings, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DMotionDriver } from '@proj-airi/stage-ui-live2d'

import type { StagePerformanceScene } from './use-stage-performance-conductor'

import { createPickerDecider, defaultExpressionPerformanceSettings, parseAffectTrace, replayAffectTrace } from '@proj-airi/stage-shared/expression-performance'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useLlmToolsStore } from '../../stores/ai/chat-llm/tools'
import { createExpressionToolRegistration, expressionToolIds, StagePerformanceConductor, toExposedExpressions } from './use-stage-performance-conductor'

const recorded = vi.hoisted(() => ({ signals: [] as AffectSignal[] }))

// Records every signal the conductor hands its decider, as the affect-trace recorder does, by
// wrapping the real decider with the real trace wrapper; decisions are unchanged.
vi.mock('@proj-airi/stage-shared/expression-performance', async (importOriginal) => {
  const original = await importOriginal<typeof import('@proj-airi/stage-shared/expression-performance')>()
  return {
    ...original,
    createDecider: (kind: Parameters<typeof original.createDecider>[0]) => original.withAffectTrace(original.createDecider(kind), signal => recorded.signals.push(signal)),
  }
})

function entry(id: string, kind: CatalogEntry['kind'], mappings: CatalogEntry['mappings'], overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return { id, label: id, kind, group: null, confirmed: true, exposedToLlm: false, mappings, fileName: `${id}.exp3.json`, parameterIds: [id], ...overrides }
}

const catalog: CatalogEntry[] = [
  entry('anger', 'face', [{ emotion: 'angry', weight: 1, minBand: 'clear' }]),
  entry('joy', 'face', [{ emotion: 'happy', weight: 1, minBand: 'clear' }]),
  entry('tear', 'effect', [{ emotion: 'sad', weight: 1, minBand: 'strong' }]),
  entry('game', 'prop', [], { exposedToLlm: true }),
]

function fakeScene() {
  return {
    setEmotion: vi.fn<StagePerformanceScene['setEmotion']>(),
    applySlots: vi.fn<StagePerformanceScene['applySlots']>(),
    onSpeech: vi.fn<StagePerformanceScene['onSpeech']>(),
    setMuted: vi.fn<StagePerformanceScene['setMuted']>(),
  }
}

function createConductor(driver: Live2DMotionDriver, scene: StagePerformanceScene = fakeScene(), settings: ExpressionPerformanceSettings = defaultExpressionPerformanceSettings) {
  let now = 10
  const playMotion = vi.fn<(group: string) => void>()
  const conductor = new StagePerformanceConductor({
    scene: () => scene,
    driver: () => driver,
    playMotion,
    settings: () => settings,
    catalog: () => catalog,
    seed: 7,
    clock: () => now,
  })
  function advance(seconds: number) {
    now += seconds
  }
  return { conductor, playMotion, advance }
}

describe('stage performance conductor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('hands banded episodes to the Natural scene and plays no motion group', () => {
    const scene = fakeScene()
    const { conductor, playMotion, advance } = createConductor('natural', scene)

    conductor.emotion('angry', 0.6, 'act', 'turn-a')
    advance(3)
    conductor.emotion('sad', 0.9, 'act', 'turn-a')
    advance(3)
    conductor.emotion('happy', 0.25, 'act', 'turn-a')

    expect(scene.setEmotion.mock.calls.map(([episode]) => [episode.emotion, episode.band])).toEqual([
      ['angry', 'clear'],
      ['sad', 'strong'],
      ['happy', 'slight'],
    ])
    expect(playMotion).not.toHaveBeenCalled()
  })

  it.each(['universal', 'magic'] as const)('plays a motion group for every recognized emotion under %s and still applies slots', (driver) => {
    const scene = fakeScene()
    const { conductor, playMotion, advance } = createConductor(driver, scene)

    conductor.emotion('happy', 0.6, 'act', 'turn-a')
    // The repeat lands inside the 2 s escalation window, where the reaction tracker drops it.
    advance(1)
    conductor.emotion('happy', 0.6, 'act', 'turn-a')
    advance(1)
    conductor.emotion('neutral', 0.6, 'act', 'turn-a')

    expect(playMotion.mock.calls).toEqual([['Happy'], ['Happy'], ['Idle']])
    expect(scene.setEmotion).not.toHaveBeenCalled()
    expect(scene.applySlots.mock.calls.map(([commands]) => commands)).toEqual([
      [{ slot: 'face', expressionId: 'joy', holdSeconds: defaultExpressionPerformanceSettings.naturalBands.clear.faceHold, until: 'speech', turnId: 'turn-a' }],
      [
        { slot: 'face', expressionId: null, holdSeconds: 0, until: 'speech', turnId: 'turn-a' },
        { slot: 'effect', expressionId: null, holdSeconds: 0, until: 'speech', turnId: 'turn-a' },
      ],
    ])
  })

  it('carries the turn id of emotion, expression, and speech signals', () => {
    const scene = fakeScene()
    const { conductor } = createConductor('natural', scene)

    conductor.emotion('angry', 0.6, 'act', 'turn-a')
    conductor.expression('game', 4, 'tool', 'turn-b')
    conductor.clipStart('turn-a', 'clip-1')

    const commands = scene.applySlots.mock.calls.flatMap(([slots]) => slots)
    expect(commands.map(command => [command.expressionId, command.turnId])).toEqual([
      ['anger', 'turn-a'],
      ['game', 'turn-b'],
    ])
    expect(scene.onSpeech).toHaveBeenCalledWith('clip-start', 'turn-a', 10)
  })

  it('drops expressions that are not exposed to the LLM and emotions it does not know', () => {
    const scene = fakeScene()
    const { conductor, playMotion } = createConductor('universal', scene)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    conductor.expression('anger', undefined, 'act', 'turn-a')
    conductor.expression('missing', undefined, 'act', 'turn-a')
    conductor.emotion('furious', 0.6, 'act', 'turn-a')

    expect(scene.applySlots).not.toHaveBeenCalled()
    expect(playMotion).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('forwards clip and turn events to the scene speech handler', () => {
    const scene = fakeScene()
    const { conductor } = createConductor('natural', scene)

    conductor.clipStart('turn-a', 'clip-1')
    conductor.clipEnd('turn-a', 'clip-1', 'ended')
    conductor.clipEnd('turn-a', 'clip-2', 'stopped')
    conductor.clipEnd('turn-a', 'clip-3', 'failed')
    conductor.turnEnd('turn-a')

    expect(scene.onSpeech.mock.calls.map(([event, turnId]) => [event, turnId])).toEqual([
      ['clip-start', 'turn-a'],
      ['clip-end', 'turn-a'],
      ['clip-stopped', 'turn-a'],
      ['clip-stopped', 'turn-a'],
      ['turn-end', 'turn-a'],
    ])
  })

  it('forwards the muted flag to the scene', () => {
    const scene = fakeScene()
    const { conductor } = createConductor('natural', scene)

    conductor.setMuted(true)

    expect(scene.setMuted).toHaveBeenCalledWith(true)
  })

  it('ends only the turn that left the active list, once', () => {
    const scene = fakeScene()
    const { conductor } = createConductor('natural', scene)

    conductor.syncActiveTurns(['turn-a', 'turn-b'])
    conductor.syncActiveTurns(['turn-b'])
    conductor.syncActiveTurns(['turn-b'])
    conductor.syncActiveTurns([])

    expect(scene.onSpeech.mock.calls.map(([event, turnId]) => [event, turnId])).toEqual([
      ['turn-end', 'turn-a'],
      ['turn-end', 'turn-b'],
    ])
  })

  it('keeps an interleaved turn\'s expression when the other turn ends', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    setActivePinia(createPinia())
    const store = useExpressionStore()
    store.registerDefinitions('rig', catalog.map(({ id }) => ({ id, name: id, fadeIn: 0, fadeOut: 0, parameters: [{ id, value: 1, blend: 'Add' as const }] })))
    for (const { id, kind, mappings } of catalog)
      store.updateEntry(id, { kind, mappings, confirmed: true })
    const scene = {
      setEmotion: vi.fn<StagePerformanceScene['setEmotion']>(),
      applySlots: vi.fn((commands: SlotCommand[], now: number) => store.applySlots(commands, now)),
      onSpeech: vi.fn<StagePerformanceScene['onSpeech']>((event, turnId, now) => store.onSpeech(event, turnId, now)),
      setMuted: vi.fn((muted: boolean) => store.setMuted(muted)),
    }
    const { conductor, advance } = createConductor('natural', scene)

    conductor.syncActiveTurns(['turn-a', 'turn-b'])
    conductor.emotion('angry', 0.6, 'act', 'turn-a')
    conductor.emotion('sad', 0.9, 'act', 'turn-b')
    conductor.clipStart('turn-a', 'clip-a')
    conductor.clipStart('turn-b', 'clip-b')
    advance(5)
    conductor.clipEnd('turn-a', 'clip-a', 'ended')
    conductor.syncActiveTurns(['turn-b'])
    advance(1)
    store.tickLeases(15.9)

    expect(scene.onSpeech.mock.calls.filter(([event]) => event === 'turn-end').map(([, turnId]) => turnId)).toEqual(['turn-a'])
    expect(store.leases.face).toBeNull()
    expect(store.leases.effect).toMatchObject({ expressionId: 'tear', turnId: 'turn-b' })
    expect(store.slotActive).toEqual(['tear'])
  })

  it('resolves an ACT expression by exact id or case-insensitive trimmed label, and drops other names', () => {
    const scene = fakeScene()
    const local = [
      ...catalog,
      entry('blush.exp3.json', 'face', [], { label: 'Blush', exposedToLlm: true }),
      entry('hat', 'outfit', [], { exposedToLlm: true }),
    ]
    const conductor = new StagePerformanceConductor({
      scene: () => scene,
      driver: () => 'natural',
      playMotion: () => {},
      settings: () => defaultExpressionPerformanceSettings,
      catalog: () => local,
      seed: 7,
      clock: () => 10,
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(conductor.expression('  bLuSh ', undefined, 'act', 'turn-a')?.id).toBe('blush.exp3.json')
    expect(conductor.expression('blush.exp3.json', undefined, 'act', 'turn-a')?.id).toBe('blush.exp3.json')
    for (const name of ['Blus', 'blush.exp3', 'hat', 'anger', ''])
      expect(conductor.expression(name, undefined, 'act', 'turn-a')).toBeUndefined()

    expect(scene.applySlots.mock.calls.flatMap(([commands]) => commands).map(command => [command.slot, command.expressionId, command.turnId])).toEqual([
      ['face', 'blush.exp3.json', 'turn-a'],
      ['face', 'blush.exp3.json', 'turn-a'],
    ])
    expect(warn).toHaveBeenCalledTimes(5)
    expect(warn).toHaveBeenCalledWith('[performance-conductor] Expression is not exposed and was dropped:', 'hat', 'available:', ['game', 'Blush'])
  })

  it('routes clears through the decider so an exact replay reproduces every dispatched slot command', () => {
    recorded.signals.length = 0
    const scene = fakeScene()
    const { conductor, advance } = createConductor('natural', scene)

    conductor.emotion('angry', 0.6, 'act', 'turn-a')
    conductor.expression('game', 4, 'tool', 'turn-a')
    advance(1)
    conductor.clearExpression('prop', 'tool')
    advance(1)
    conductor.expression('game', undefined, 'tool')
    conductor.clearExpression(undefined, 'tool')

    // The trace goes through JSON, as an exported recording does.
    const trace = parseAffectTrace(JSON.parse(JSON.stringify({
      version: 1,
      decider: 'picker',
      checkpoint: createPickerDecider().initial(7),
      initialContext: { catalog, settings: defaultExpressionPerformanceSettings },
      entries: recorded.signals.map(signal => ({ type: 'signal', signal })),
      truncated: false,
      endAt: 12,
    })))
    const replayed = replayAffectTrace(trace, { ...createPickerDecider(), kind: 'picker' }, { mode: 'exact' }).flatMap(({ decision }) => decision.slots)
    const dispatched = scene.applySlots.mock.calls.flatMap(([commands]) => commands)

    expect(replayed).toEqual(dispatched)
    expect(recorded.signals.filter(signal => signal.kind === 'clear')).toEqual([
      { kind: 'clear', source: 'tool', slot: 'prop', at: 11 },
      { kind: 'clear', source: 'tool', at: 12 },
    ])
    expect(dispatched.map(command => [command.slot, command.expressionId])).toEqual([
      ['face', 'anger'],
      ['prop', 'game'],
      ['prop', null],
      ['prop', 'game'],
      ['face', null],
      ['effect', null],
      ['prop', null],
    ])
  })

  it('registers the expression tools by id, replaces them when the exposed set changes, and removes them when empty', async () => {
    setActivePinia(createPinia())
    const tools = useLlmToolsStore()
    let current = catalog.filter(item => item.exposedToLlm)
    const port = {
      list: () => toExposedExpressions(current).map(item => ({ ...item, active: false })),
      set: () => ({ success: true }),
      clear: () => ({ success: true }),
    }
    const registration = createExpressionToolRegistration(tools, port)
    const labelsOf = () => (tools.tools.find(tool => tool.id === 'expression:set_expression')?.function.parameters as { properties: { expression: { enum: string[] } } } | undefined)?.properties.expression.enum

    await registration.sync(toExposedExpressions(current))
    expect(tools.tools.map(tool => tool.id)).toEqual([...expressionToolIds])
    expect(tools.activeTools.map(tool => tool.function.name)).toEqual(['set_expression', 'clear_expression', 'list_expressions'])
    expect(labelsOf()).toEqual(['game'])

    current = [...current, entry('blush', 'face', [], { exposedToLlm: true })]
    await registration.sync(toExposedExpressions(current))
    expect(tools.tools.map(tool => tool.id)).toEqual([...expressionToolIds])
    expect(labelsOf()).toEqual(['game', 'blush'])

    await registration.sync([])
    expect(tools.tools).toEqual([])

    // A build that a newer, empty set overtakes must not register stale tools.
    const overtaken = registration.sync(toExposedExpressions(current))
    await registration.sync([])
    await overtaken
    expect(tools.tools).toEqual([])

    await registration.sync(toExposedExpressions(current))
    registration.dispose()
    await registration.sync(toExposedExpressions(current))
    expect(tools.tools).toEqual([])
  })
})
