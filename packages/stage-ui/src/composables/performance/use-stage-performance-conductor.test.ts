import type { CharacterMind, MindStep, PerformerCapabilities } from '@proj-airi/character-mind'
import type { AffectSignal, AffectTrace, CatalogEntry, ExpressionPerformanceSettings, PerformanceProfile, SlotCommand, TimingEvent } from '@proj-airi/stage-shared/expression-performance'

import type { ActionToolPort } from '../../tools/action'
import type { BodyToolPort } from '../../tools/body'
import type { VoicePort } from './mind-voice'
import type { ListedAction, StagePerformanceConductorOptions, StagePerformanceScene } from './use-stage-performance-conductor'

import { DANCE_REFRACTORY_MS, NO_CAPABILITIES, SETTLE_SECONDS } from '@proj-airi/character-mind'
import { naturalEmotions } from '@proj-airi/motion-driver-natural/emotions'
import { createDecider, createPickerDecider, defaultExpressionPerformanceSettings, initialTouchAffectMemory, parseAffectTrace, parseExpressionPerformanceSettings, replayAffectTrace, touchAffect } from '@proj-airi/stage-shared/expression-performance'
import { LIVE2D_NATURAL_CAPABILITIES } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion-adapter'
import { useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { MMD_NATURAL_CAPABILITIES } from '@proj-airi/stage-ui-mmd/composables/mmd/natural/adapter'
import { useMMDExpressionStore } from '@proj-airi/stage-ui-mmd/stores'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { computed, effectScope, nextTick, ref } from 'vue'

import { useLive2DExpressionBackend, useMMDExpressionBackend } from '../../features/performance/expression-backend'
import { selectStagePerformanceRenderer } from '../../features/performance/renderer'
import { usePerformanceRuntimeState } from '../../features/performance/runtime-state'
import { useLlmToolsStore } from '../../stores/ai/chat-llm/tools'
import { useStageExpressionCatalogStore } from '../../stores/stage-expression-catalog'
import { naturalMind } from '../../test/natural-mind'
import { bodyToolIds, createBodyToolRegistration, createExpressionToolPort, createExpressionToolRegistration, expressionToolIds, maxAffectTraceEntries, StagePerformanceConductor, toExposedExpressions, useStagePerformanceConductor } from './use-stage-performance-conductor'

// `createDecider` stays the real factory, wrapped in a spy so the timing tests can replace the
// next decider with one that reports deadlines, which the picker never does (`mockReturnValueOnce`).
vi.mock('@proj-airi/stage-shared/expression-performance', async (importOriginal) => {
  const original = await importOriginal<typeof import('@proj-airi/stage-shared/expression-performance')>()
  return { ...original, createDecider: vi.fn(original.createDecider) }
})

/** Exact replay of an exported trace after a JSON round trip, as the replay CLI reads it. */
function replaySlots(trace: AffectTrace) {
  const parsed = parseAffectTrace(JSON.parse(JSON.stringify(trace)))
  return replayAffectTrace(parsed, { ...createPickerDecider(), kind: 'picker' }, { mode: 'exact' }).flatMap(({ decision }) => decision.slots)
}

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
    applyHolds: vi.fn<StagePerformanceScene['applyHolds']>(),
    onSpeech: vi.fn<StagePerformanceScene['onSpeech']>(),
    setMuted: vi.fn<StagePerformanceScene['setMuted']>(),
    gesture: vi.fn<NonNullable<StagePerformanceScene['gesture']>>(),
    addMood: vi.fn<NonNullable<StagePerformanceScene['addMood']>>(),
    reactToTouch: vi.fn<NonNullable<StagePerformanceScene['reactToTouch']>>(),
    wakeFromSleep: vi.fn<NonNullable<StagePerformanceScene['wakeFromSleep']>>(),
    reactToDesktop: vi.fn<NonNullable<StagePerformanceScene['reactToDesktop']>>(),
  }
}

function attendingScene() {
  return { ...fakeScene(), attend: vi.fn<NonNullable<StagePerformanceScene['attend']>>() }
}

type TestPerformer = 'natural' | 'basic'

function createConductor(driver: TestPerformer, scene: StagePerformanceScene = fakeScene(), settings: ExpressionPerformanceSettings = defaultExpressionPerformanceSettings, profile?: PerformanceProfile, entries: readonly CatalogEntry[] = catalog, touch: Pick<StagePerformanceConductorOptions, 'markMoment' | 'voice' | 'idleReports'> & { mindSeed?: number, capabilities?: PerformerCapabilities } = {}) {
  let now = 10
  // The mind counts the conductor's seconds as milliseconds, so both read 10 s at the start.
  const mind = naturalMind({ seed: touch.mindSeed ?? 7, clock: () => now * 1000 })
  const refusals = vi.fn()
  const conductor = new StagePerformanceConductor({
    scene: () => scene,
    capabilities: () => touch.capabilities ?? (driver === 'natural' ? MMD_NATURAL_CAPABILITIES : NO_CAPABILITIES),
    settings: () => settings,
    catalog: () => entries,
    seed: 7,
    mind,
    markMoment: touch.markMoment,
    voice: touch.voice,
    idleReports: touch.idleReports,
    clock: () => now,
    profile: () => profile,
    modelId: () => 'rig',
  })
  conductor.onRefusal(refusals)
  function advance(seconds: number) {
    now += seconds
  }
  return { conductor, mind, refusals, advance }
}

describe('performer dispatch declarations', () => {
  it.each(['masked-by-clip', 'masked-by-manual', 'masked-by-expression', 'missing-asset'] as const)('forwards one %s expression refusal with its entry id and no label', (reason) => {
    const scene = fakeScene()
    scene.applySlots.mockReturnValue([{ entryId: 'joy', reason }])
    const { conductor, refusals } = createConductor('natural', scene)
    conductor.emotion('happy', 0.9, 'act')
    expect(refusals.mock.calls).toEqual([[{ cause: null, kind: 'entry', entryId: 'joy', reason }]])
  })

  it('reports an exposed entry with no usable slots without starting an episode', () => {
    const scene = fakeScene()
    const broken = entry('combo:missing', 'combo', [], { exposedToLlm: true, slots: ['face'], members: [{ expressionId: 'missing', strength: 1 }] })
    const { conductor, refusals } = createConductor('natural', scene, undefined, undefined, [broken])
    expect(conductor.expression(broken.id, undefined, 'act')).toBeUndefined()
    expect(refusals.mock.calls).toEqual([[{ cause: null, kind: 'entry', entryId: broken.id, reason: 'missing-asset' }]])
    expect(scene.applySlots).not.toHaveBeenCalled()
    expect(scene.setEmotion).not.toHaveBeenCalled()
  })

  it('reports nothing for a shown expression', () => {
    const scene = fakeScene()
    scene.applySlots.mockReturnValue([])
    const { conductor, refusals } = createConductor('natural', scene)
    conductor.emotion('happy', 0.9, 'act')
    expect(scene.applySlots).toHaveBeenCalledOnce()
    expect(refusals).not.toHaveBeenCalled()
  })

  it.each(['picker', 'planner'] as const)('two conductors using %s agree on picks and recorded intent ids', (decider) => {
    let now = 10
    const entries = ['one', 'two', 'three'].map(id => entry(id, 'face', [{ emotion: 'happy', weight: 1, minBand: 'slight' }]))
    const scenes = [fakeScene(), fakeScene()]
    const conductors = scenes.map((scene, index) => new StagePerformanceConductor({
      scene: () => scene,
      capabilities: () => MMD_NATURAL_CAPABILITIES,
      settings: () => ({ ...defaultExpressionPerformanceSettings, decider }),
      catalog: () => entries,
      seed: index === 0 ? 7 : 9001,
      mind: naturalMind({ seed: 7, clock: () => now * 1000 }),
      clock: () => now,
    }))
    for (const conductor of conductors)
      conductor.startRecording()
    for (let i = 0; i < 20; i++) {
      for (const conductor of conductors)
        conductor.emotion('happy', 0.9, 'devtools')
      now += 10
    }
    expect(scenes[0].applySlots.mock.calls).toEqual(scenes[1].applySlots.mock.calls)
    expect(scenes[0].applySlots).toHaveBeenCalled()
    const traces = conductors.map(conductor => parseAffectTrace(conductor.exportTrace()))
    expect(traces[0].entries).toEqual(traces[1].entries)
    expect(traces[0].entries).toContainEqual({ type: 'signal', signal: expect.objectContaining({ kind: 'reaction', intentId: expect.any(String) }) })
    for (const conductor of conductors)
      conductor.dispose()
  })

  it('seeds a scene that attaches or becomes Natural again with the mind\'s mood, once per change', () => {
    let now = 10
    const mind = naturalMind({ seed: 7, clock: () => now * 1000 })
    const first = { ...fakeScene(), seedMood: vi.fn<NonNullable<StagePerformanceScene['seedMood']>>() }
    const second = { ...fakeScene(), seedMood: vi.fn<NonNullable<StagePerformanceScene['seedMood']>>() }
    let scene: StagePerformanceScene = first
    let capabilities: PerformerCapabilities = LIVE2D_NATURAL_CAPABILITIES
    const conductor = new StagePerformanceConductor({
      scene: () => scene,
      capabilities: () => capabilities,
      settings: () => defaultExpressionPerformanceSettings,
      catalog: () => catalog,
      seed: 7,
      mind,
      clock: () => now,
    })
    conductor.syncScene()
    expect(first.seedMood).toHaveBeenCalledOnce()
    conductor.emotion('happy', 0.9, 'act')
    now += 5
    conductor.syncScene()
    expect(first.seedMood).toHaveBeenCalledOnce()

    // Another stage attaches: it starts from her mood, decayed to now.
    scene = second
    conductor.syncScene()
    expect(second.seedMood).toHaveBeenCalledOnce()
    const level = second.seedMood.mock.calls[0][0]()
    expect(level).toEqual(mind.moodLevel())
    expect(level.valence).toBeGreaterThan(0)

    // A driver switch away and back seeds it again; the declaration without posture does not.
    capabilities = NO_CAPABILITIES
    conductor.syncScene()
    capabilities = LIVE2D_NATURAL_CAPABILITIES
    conductor.syncScene()
    expect(second.seedMood).toHaveBeenCalledTimes(2)
    conductor.dispose()
  })

  it.each([true, false])('puts the mind\'s emotion gesture on the Natural episode only with posture declared (%s)', (posture) => {
    const scene = fakeScene()
    const capabilities = { ...LIVE2D_NATURAL_CAPABILITIES, posture }
    const { conductor } = createConductor('natural', scene, undefined, undefined, undefined, { capabilities })
    conductor.emotion('happy', 0.8, 'act')
    expect(scene.setEmotion).toHaveBeenCalledTimes(1)
    const [episode] = scene.setEmotion.mock.calls[0]
    expect(episode.emotion).toBe('happy')
    expect(episode.gesture).toBe(posture ? 'laugh' : undefined)
  })

  it.each([
    ['none', NO_CAPABILITIES],
    ['Live2D', LIVE2D_NATURAL_CAPABILITIES],
    ['MMD', MMD_NATURAL_CAPABILITIES],
  ] as const)('dispatches only declared channels on %s and reports every denied request', (_name, capabilities) => {
    const scene = {
      ...fakeScene(),
      attend: vi.fn(),
      setAway: vi.fn(),
      chatRead: vi.fn(),
      cursorEpisode: vi.fn(),
      idle: vi.fn(),
      idleCue: vi.fn(),
    }
    const markMoment = vi.fn()
    const { conductor, refusals } = createConductor('natural', scene, undefined, undefined, undefined, { capabilities, markMoment })
    conductor.touch({ gesture: 'poke', region: 'body', point: { x: 0, y: 0 } })
    conductor.desktop([{ kind: 'presence', away: true, wake: null }])
    conductor.desktop([{ kind: 'presence', away: false, wake: { cause: 'unlock', atMs: 10_000 } }])
    conductor.chat('sent', 3)
    conductor.cursor([{ requestId: 1, band: 'near', opportunity: 'moved' }])
    conductor.gesture('nod', 1, 'act')
    conductor.gesture('shrug', 1, 'act')
    conductor.idleCue({ id: 'cue', cause: 20, channel: 'posture', kind: 'cue', cue: 'about-to-speak' })
    conductor.idle({ id: 'act', cause: 21, channel: 'posture', kind: 'idle-act', act: 'yawn', seed: 1, requested: true })
    conductor.idle({ id: 'errand', cause: 22, channel: 'posture', kind: 'idle-errand', errand: 'pastime', pick: 0.5, holdSeconds: 60 })
    conductor.emotion('happy', 0.8, 'act')
    conductor.expression('game', 3, 'act')
    conductor.clearExpression(undefined, 'act')
    expect(scene.reactToTouch).toHaveBeenCalledTimes(Number(capabilities.posture))
    // The poke's dose and the emotion's.
    expect(scene.addMood).toHaveBeenCalledTimes(capabilities.posture ? 2 : 0)
    expect(scene.reactToDesktop).toHaveBeenCalledTimes(Number(capabilities.posture))
    expect(scene.idleCue).toHaveBeenCalledTimes(Number(capabilities.posture))
    expect(scene.idle).toHaveBeenCalledTimes(capabilities.posture ? 2 : 0)
    expect(scene.chatRead).toHaveBeenCalledTimes(Number(capabilities.gaze))
    expect(scene.cursorEpisode).toHaveBeenCalledTimes(Number(capabilities.gaze))
    expect(scene.gesture).toHaveBeenCalledTimes((['nod', 'shrug'] as const).filter(kind => capabilities.gestures.includes(kind)).length)
    expect(scene.attend).toHaveBeenCalledTimes(capabilities.body ? 2 : 0)
    expect(scene.setAway).toHaveBeenCalledTimes(capabilities.body ? 2 : 0)
    expect(markMoment).toHaveBeenCalledTimes(capabilities.face ? 2 : 0)
    expect(scene.setEmotion).toHaveBeenCalledTimes(Number(capabilities.face))
    expect(scene.applySlots).toHaveBeenCalledTimes(capabilities.face ? 3 : 0)
    const refused = refusals.mock.calls.map(([refusal]) => refusal.kind)
    expect(refused).toEqual([
      ...capabilities.posture ? [] : ['touch-reaction', 'mood'],
      ...capabilities.face ? [] : ['moment'],
      ...capabilities.body ? [] : ['attend', 'away'],
      ...capabilities.posture ? [] : ['desktop-reaction'],
      ...capabilities.face ? [] : ['moment'],
      ...capabilities.body ? [] : ['away'],
      ...capabilities.gaze ? [] : ['chat-read'],
      ...capabilities.body ? [] : ['attend'],
      ...capabilities.gaze ? [] : ['cursor-episode'],
      ...capabilities.gestures.includes('nod') ? [] : ['gesture'],
      ...capabilities.gestures.includes('shrug') ? [] : ['gesture'],
      ...capabilities.posture ? [] : ['cue', 'idle-act', 'idle-errand'],
      ...capabilities.face ? [] : ['emotion', 'entry', 'release'],
    ])
    expect(refusals.mock.calls.every(([refusal]) => refusal.reason === 'not-declared-by-stage')).toBe(true)
  })
})

describe('stage performance renderer selection', () => {
  let pinia: ReturnType<typeof createPinia>
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    pinia = createPinia()
    setActivePinia(pinia)
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
    disposePinia(pinia)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function mountConductor(initialRenderer: string | undefined = 'live2d', mounted = true) {
    const renderer = ref<string | undefined>(initialRenderer)
    const scene = fakeScene()
    const store = useExpressionStore()
    store.registerDefinitions('rig', catalog.map(({ id }) => ({ id, name: id, fadeIn: 0, fadeOut: 0, parameters: [{ id, value: 1, blend: 'Add' as const }] })))
    for (const { id, kind, mappings, exposedToLlm } of catalog)
      store.updateEntry(id, { kind, mappings, exposedToLlm, confirmed: true })
    const backend = useLive2DExpressionBackend()
    const mmdScene = fakeScene()
    const mmdStore = useMMDExpressionStore()
    mmdStore.registerMorphs('mmd-rig', [{ index: 0, name: 'smile', type: 1, category: 2 }])
    mmdStore.updateEntry('mmd:0:smile', { kind: 'face', exposedToLlm: true, confirmed: true, mappings: [{ emotion: 'happy', weight: 1, minBand: 'clear' }] })
    const selected = computed(() => selectStagePerformanceRenderer(renderer.value, {
      scene: mounted ? scene : undefined,
      capabilities: MMD_NATURAL_CAPABILITIES,
      expressionBackend: backend,
    }, {
      scene: mounted ? mmdScene : undefined,
      capabilities: MMD_NATURAL_CAPABILITIES,
      expressionBackend: useMMDExpressionBackend(),
    }))
    const result = scope.run(() => useStagePerformanceConductor({
      renderer: () => renderer.value,
      scene: () => selected.value.scene,
      capabilities: () => selected.value.capabilities,
      expressionBackend: () => selected.value.expressionBackend,
      mind: naturalMind({ seed: 7 }),
      mood: () => null,
    }))
    if (!result)
      throw new Error('The conductor scope did not start')
    return { ...result, renderer, scene, mmdScene, mmdStore, selected, backend, store }
  }

  it.each(['vrm', 'unknown', undefined])('makes no scene calls with renderer %s', (renderer) => {
    const { conductor, scene, selected, renderer: activeRenderer } = mountConductor()
    activeRenderer.value = renderer

    conductor.emotion('happy', 0.7, 'devtools')
    conductor.setMuted(true)
    conductor.clipStart('turn-a', 'clip-a', true)
    conductor.turnEnd('turn-a')
    conductor.clearExpression(undefined, 'devtools')

    expect(Object.values(scene).map(method => method.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(selected.value.expressionBackend).toBeUndefined()
    expect(selected.value.capabilities).toBe(NO_CAPABILITIES)
  })

  it.each(['vrm'])('does not dispatch or throw for an ACT expression after switching to %s', async (renderer) => {
    const { conductor, scene, renderer: activeRenderer } = mountConductor()
    expect(conductor.expression('game', undefined, 'act', 'turn-a')?.id).toBe('game')
    expect(scene.applySlots).toHaveBeenCalledTimes(1)
    for (const method of Object.values(scene))
      method.mockClear()
    activeRenderer.value = renderer
    await nextTick()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => conductor.expression('game', undefined, 'act', 'turn-b')).not.toThrow()

    expect(Object.values(scene).map(method => method.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(useLlmToolsStore().tools).toEqual([])
  })

  it('dispatches MMD emotions and ACT expressions to its scene and catalog, not Live2D', () => {
    const { conductor, scene, mmdScene, mmdStore, selected, renderer } = mountConductor()
    renderer.value = 'mmd'
    conductor.emotion('happy', 0.7, 'act', 'mmd-turn')
    expect(mmdScene.setEmotion).toHaveBeenCalledWith(expect.objectContaining({ emotion: 'happy' }))
    expect(conductor.expression('smile', undefined, 'act', 'mmd-turn')?.id).toBe('mmd:0:smile')
    expect(mmdScene.applySlots).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ expressionId: 'mmd:0:smile' })]), expect.any(Number))
    expect(selected.value.expressionBackend?.catalog).toBe(mmdStore.catalog)
    expect(Object.values(scene).map(method => method.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('keeps the Live2D backend catalog and performer state live', () => {
    const { conductor, scene, backend, store } = mountConductor()
    store.applySlots([{ slot: 'prop', expressionId: 'game', holdSeconds: 4, until: 'speech' }], 10)

    expect(createExpressionToolPort(conductor, backend).list()).toEqual([{ label: 'game', kind: 'prop', active: true }])
    expect(backend.modelId).toBe('rig')
    expect(backend.catalog).toBe(store.catalog)
    conductor.emotion('happy', 0.7, 'act', 'turn-a')
    expect(scene.setEmotion).toHaveBeenCalledTimes(1)
    expect(scene.applySlots).toHaveBeenCalledTimes(1)
  })

  it('mirrors Live2D and MMD catalog edits and clears when the model unloads', async () => {
    const { store, mmdStore, renderer } = mountConductor()
    const mirror = useStageExpressionCatalogStore()
    expect(mirror.snapshot?.modelId).toBe('rig')
    expect(mirror.snapshot?.entries.map(entry => entry.id).sort()).toEqual(['anger', 'joy', 'tear'])
    store.updateEntry('anger', { label: 'Irritated', mappings: [{ emotion: 'angry', weight: 3, minBand: 'strong' }] })
    await nextTick()
    expect(mirror.snapshot?.entries.find(entry => entry.id === 'anger')).toEqual({
      id: 'anger',
      label: 'Irritated',
      mappings: [{ emotion: 'angry', weight: 3, minBand: 'strong' }],
    })

    renderer.value = 'mmd'
    await nextTick()
    expect(mirror.snapshot?.modelId).toBe('mmd-rig')
    mmdStore.updateEntry('mmd:0:smile', { label: 'Grin' })
    await nextTick()
    expect(mirror.snapshot?.entries[0].label).toBe('Grin')
    mmdStore.dispose()
    await nextTick()
    expect(mirror.snapshot).toBeNull()
  })

  it('clears the catalog when the stage conductor is disposed', () => {
    mountConductor()
    const mirror = useStageExpressionCatalogStore()
    expect(mirror.snapshot?.modelId).toBe('rig')
    scope.stop()
    expect(mirror.snapshot).toBeNull()
  })

  it('advances without throwing when the Live2D scene is undefined', () => {
    const { conductor } = mountConductor('live2d', false)

    expect(() => conductor.expression('game', undefined, 'act', 'turn-a')).not.toThrow()
    expect(() => conductor.emotion('happy', 0.7, 'act', 'turn-a')).not.toThrow()
  })

  it('answers an affect-trace request for live2d', async () => {
    const { conductor } = mountConductor()
    const diagnostics = useNaturalMotionDiagnostics()

    const id = diagnostics.requestAffectTrace('start')
    await nextTick()

    expect(diagnostics.affectTraceResult).toEqual({ id, action: 'start', entries: 0, truncated: false, savedPath: null })
    expect(diagnostics.affectTraceRequest).toBeNull()
    expect(conductor.exportTrace()).toMatchObject({ entries: [], truncated: false })
  })

  it('ignores an affect-trace request for mmd', async () => {
    const { conductor } = mountConductor('mmd')
    const diagnostics = useNaturalMotionDiagnostics()

    const id = diagnostics.requestAffectTrace('start')
    await nextTick()

    expect(diagnostics.affectTraceRequest).toEqual({ id, action: 'start' })
    expect(diagnostics.affectTraceResult).toBeNull()
    expect(conductor.exportTrace()).toBeUndefined()
  })
})

describe('stage performance conductor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('hands banded episodes to the Natural scene and plays no motion group', () => {
    const scene = fakeScene()
    const { conductor, refusals, advance } = createConductor('natural', scene)

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
    expect(refusals).not.toHaveBeenCalled()
  })

  it('hands the episode to the Natural scene at once under the planner, while its face waits for the sentence start', () => {
    const scene = fakeScene()
    const { conductor } = createConductor('natural', scene, { ...defaultExpressionPerformanceSettings, decider: 'planner' })

    conductor.emotion('happy', 0.6, 'act', 'turn-a')

    expect(scene.setEmotion.mock.calls.map(([episode]) => [episode.emotion, episode.band])).toEqual([['happy', 'clear']])
    expect(scene.applySlots).not.toHaveBeenCalled()

    conductor.clipStart('turn-a', 'clip-1', true)

    expect(scene.applySlots.mock.calls.flatMap(([commands]) => commands).map(command => command.expressionId)).toEqual(['joy'])
    conductor.dispose()
  })

  it.each(['basic'] as const)('reports undeclared face intents under %s without applying slots', (driver) => {
    const scene = fakeScene()
    const { conductor, refusals, advance } = createConductor(driver, scene)

    conductor.emotion('happy', 0.6, 'act', 'turn-a')
    // The repeat lands inside the 2 s escalation window, where the reaction tracker drops it.
    advance(1)
    conductor.emotion('happy', 0.6, 'act', 'turn-a')
    advance(1)
    conductor.emotion('neutral', 0.6, 'act', 'turn-a')

    expect(refusals.mock.calls.map(([refusal]) => refusal.kind)).toEqual(['emotion', 'release'])
    expect(scene.setEmotion).not.toHaveBeenCalled()
    expect(scene.applySlots).not.toHaveBeenCalled()
  })

  it('reports undeclared love, flustered, and sleepy episodes', () => {
    // Non-Natural drivers play the group unconditionally, so no clock advance is needed.
    const { conductor, refusals } = createConductor('basic')

    for (const emotion of ['love', 'flustered', 'sleepy'])
      conductor.emotion(emotion, 0.6, 'act', 'turn-a')

    expect(refusals.mock.calls.map(([refusal]) => refusal.kind)).toEqual(['emotion', 'emotion', 'emotion'])
  })

  it.each(['basic'] as const)('refuses a face request under %s independently of an ACT motion', (driver) => {
    const scene = fakeScene()
    const { conductor, refusals } = createConductor(driver, scene)

    conductor.emotion('happy', 0.6, 'act', 'turn-a')

    expect(refusals).toHaveBeenCalledWith({ cause: 2, kind: 'emotion', reason: 'not-declared-by-stage' })
    expect(scene.applySlots).not.toHaveBeenCalled()
  })

  it('keeps the Natural episode and hold when an ACT already played its motion', () => {
    const scene = fakeScene()
    const { conductor, refusals } = createConductor('natural', scene)

    conductor.emotion('happy', 0.6, 'act', 'turn-a')

    expect(refusals).not.toHaveBeenCalled()
    expect(scene.setEmotion).toHaveBeenCalledTimes(1)
    expect(scene.applyHolds.mock.calls).toEqual([[[expect.objectContaining({ emotion: 'happy', turnId: 'turn-a' })], 10]])
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
    const { conductor, refusals } = createConductor('basic', scene)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    conductor.expression('anger', undefined, 'act', 'turn-a')
    conductor.expression('missing', undefined, 'act', 'turn-a')
    conductor.emotion('furious', 0.6, 'act', 'turn-a')

    expect(scene.applySlots).not.toHaveBeenCalled()
    expect(refusals).not.toHaveBeenCalled()
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
      applyHolds: vi.fn<StagePerformanceScene['applyHolds']>(),
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
    // Turn A's face stays half of its 4 s hold after its speech ended at 15 s.
    store.tickLeases(17.1)

    expect(scene.onSpeech.mock.calls.filter(([event]) => event === 'turn-end').map(([, turnId]) => turnId)).toEqual(['turn-a'])
    expect(store.leases.face).toBeNull()
    expect(store.leases.effect).toMatchObject({ expressionId: 'tear', turnId: 'turn-b' })
    expect(store.leases.effect?.expressionId).toBe('tear')
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
      capabilities: () => MMD_NATURAL_CAPABILITIES,
      settings: () => defaultExpressionPerformanceSettings,
      catalog: () => local,
      seed: 7,
      mind: naturalMind({ seed: 7, clock: () => 10_000 }),
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

  describe('desktop events', () => {
    const lock = { kind: 'presence', away: true, wake: null } as const
    const unlock = { kind: 'presence', away: false, wake: { cause: 'unlock', atMs: 189_000 } } as const
    const gentleReturn = { kind: 'presence', away: false, wake: null } as const

    it.each(['natural', 'basic'] as const)('dispatches away edges only under Natural, driver %s', (driver) => {
      const scene = { ...fakeScene(), setAway: vi.fn<NonNullable<StagePerformanceScene['setAway']>>() }
      const { conductor, mind } = createConductor(driver, scene)

      conductor.desktop([lock])
      conductor.desktop([lock])
      conductor.desktop([gentleReturn])

      expect(scene.setAway.mock.calls).toEqual(driver === 'natural' ? [[true], [false]] : [])
      expect(mind.state.presence.away).toBe(false)
    })

    it('seeds an attached scene and a driver returning to Natural from the current mind presence', () => {
      const first = { ...fakeScene(), setAway: vi.fn<NonNullable<StagePerformanceScene['setAway']>>() }
      const second = { ...fakeScene(), setAway: vi.fn<NonNullable<StagePerformanceScene['setAway']>>() }
      let scene: StagePerformanceScene | undefined
      let driver: TestPerformer = 'basic'
      const mind = naturalMind({ seed: 7 })
      const conductor = new StagePerformanceConductor({ scene: () => scene, capabilities: () => driver === 'natural' ? MMD_NATURAL_CAPABILITIES : NO_CAPABILITIES, settings: () => defaultExpressionPerformanceSettings, catalog: () => catalog, seed: 7, mind })
      mind.receive(lock)
      conductor.syncScene()
      scene = first
      conductor.syncScene()
      expect(first.setAway).not.toHaveBeenCalled()

      driver = 'natural'
      conductor.syncScene()
      conductor.syncScene()
      expect(first.setAway.mock.calls).toEqual([[true]])

      scene = second
      conductor.syncScene()
      expect(second.setAway.mock.calls).toEqual([[true]])
      driver = 'basic'
      conductor.syncScene()
      mind.receive(gentleReturn)
      expect(second.setAway.mock.calls).toEqual([[true]])

      driver = 'natural'
      conductor.syncScene()
      expect(second.setAway.mock.calls).toEqual([[true], [false]])
    })

    it('hands the refractories to a body scene only, and seeds a new scene with what is left on the mind clock', () => {
      const first = { ...fakeScene(), setRefractory: vi.fn<NonNullable<StagePerformanceScene['setRefractory']>>() }
      const second = { ...fakeScene(), setRefractory: vi.fn<NonNullable<StagePerformanceScene['setRefractory']>>() }
      let scene: StagePerformanceScene | undefined = first
      let driver: TestPerformer = 'natural'
      let nowMs = 0
      const mind = naturalMind({ seed: 7, clock: () => nowMs })
      const conductor = new StagePerformanceConductor({ scene: () => scene, capabilities: () => driver === 'natural' ? MMD_NATURAL_CAPABILITIES : NO_CAPABILITIES, settings: () => defaultExpressionPerformanceSettings, catalog: () => catalog, seed: 7, mind })
      const none = { actionMs: 0, danceMs: 0, gesture: null, moveToolMs: 0, lookToolMs: 0 }
      conductor.syncScene()
      expect(first.setRefractory.mock.calls).toEqual([[none]])

      // The store hands the mind's answer to the stage, which hands it to the scene.
      conductor.performerReport({ kind: 'clip-ended', clip: 'dance', source: 'act' })
      conductor.refractory(mind.refractories())
      expect(first.setRefractory.mock.calls.at(-1)).toEqual([{ ...none, danceMs: DANCE_REFRACTORY_MS }])

      nowMs = 10_000
      scene = second
      conductor.syncScene()
      expect(second.setRefractory.mock.calls).toEqual([[{ ...none, danceMs: DANCE_REFRACTORY_MS - 10_000 }]])

      driver = 'basic'
      conductor.syncScene()
      conductor.refractory(mind.refractories())
      expect(second.setRefractory).toHaveBeenCalledOnce()
    })

    it('hands the settle to a posture scene only, and seeds it from the mind on attach and when posture returns', () => {
      const first = { ...fakeScene(), setSettled: vi.fn<NonNullable<StagePerformanceScene['setSettled']>>() }
      const second = { ...fakeScene(), setSettled: vi.fn<NonNullable<StagePerformanceScene['setSettled']>>() }
      let scene: StagePerformanceScene | undefined = first
      let driver: TestPerformer = 'natural'
      let nowMs = 0
      const mind = naturalMind({ seed: 7, clock: () => nowMs })
      const conductor = new StagePerformanceConductor({ scene: () => scene, capabilities: () => driver === 'natural' ? MMD_NATURAL_CAPABILITIES : NO_CAPABILITIES, settings: () => defaultExpressionPerformanceSettings, catalog: () => catalog, seed: 7, mind })
      conductor.syncScene()
      expect(first.setSettled.mock.calls).toEqual([[false]])

      // A body drive that starts no act settles her once its deadline passes.
      const drive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, rate: 0, body: true }
      mind.receive({ kind: 'idle', reports: [{ kind: 'view', view: { drive, active: true, mode: 'idle', away: false, blocked: false, current: null, errand: null } }] })
      nowMs = SETTLE_SECONDS * 1000
      const settle = mind.receive({ kind: 'idle-wake' }).find(intent => intent.kind === 'settle')
      expect(settle).toMatchObject({ channel: 'posture', settled: true })
      conductor.settle(true)
      expect(first.setSettled.mock.calls).toEqual([[false], [true]])

      scene = second
      conductor.syncScene()
      expect(second.setSettled.mock.calls).toEqual([[true]])
      driver = 'basic'
      conductor.syncScene()
      conductor.settle(false)
      expect(second.setSettled.mock.calls).toEqual([[true]])
      driver = 'natural'
      conductor.syncScene()
      expect(second.setSettled.mock.calls).toEqual([[true], [true]])
    })

    it('performs the posture intents on the scene under Natural and marks the welcome back', () => {
      const scene = fakeScene()
      const markMoment = vi.fn<NonNullable<StagePerformanceConductorOptions['markMoment']>>()
      const { conductor, advance } = createConductor('natural', scene, undefined, undefined, undefined, { markMoment })

      conductor.desktop([lock])
      expect(scene.wakeFromSleep).not.toHaveBeenCalled()
      expect(markMoment).not.toHaveBeenCalled()
      advance(60)
      conductor.desktop([gentleReturn])
      advance(60)
      conductor.desktop([lock])
      advance(60)
      conductor.desktop([unlock, { kind: 'screen-change' }])

      expect(scene.wakeFromSleep).toHaveBeenCalledTimes(1)
      // The wake wins over the screen change in the same step.
      expect(scene.reactToDesktop.mock.calls).toEqual([['wake']])
      expect(markMoment.mock.calls).toEqual([['welcome-back', expect.any(String)], ['welcome-back', expect.any(String)]])
    })

    it('refuses performer answers without declarations while the mind still steps', () => {
      const scene = fakeScene()
      const markMoment = vi.fn<NonNullable<StagePerformanceConductorOptions['markMoment']>>()
      const { conductor, mind, advance } = createConductor('basic', scene, undefined, undefined, undefined, { markMoment })
      const steps = vi.fn()
      mind.onStep(steps)

      conductor.desktop([lock])
      advance(60)
      conductor.desktop([unlock])
      conductor.desktop([])

      expect(steps).toHaveBeenCalledTimes(2)
      expect(scene.wakeFromSleep).not.toHaveBeenCalled()
      expect(scene.reactToDesktop).not.toHaveBeenCalled()
      expect(markMoment).not.toHaveBeenCalled()
    })

    it('records the wake and the return in the situation in intent order under a basic driver', () => {
      const voice = { observeTouch: vi.fn<VoicePort['observeTouch']>(() => null), speak: vi.fn<VoicePort['speak']>(async () => 'spoken'), observeReturn: vi.fn<VoicePort['observeReturn']>(), cancel: vi.fn<VoicePort['cancel']>(), drop: vi.fn<VoicePort['drop']>(), publishVoice: vi.fn<VoicePort['publishVoice']>(), connect: vi.fn<VoicePort['connect']>(() => () => {}) }
      const { conductor, advance } = createConductor('basic', fakeScene(), undefined, undefined, undefined, { voice: () => voice })

      conductor.desktop([lock])
      advance(60)
      conductor.desktop([unlock])

      expect(voice.observeReturn.mock.calls.map(([observation]) => observation)).toEqual([
        { kind: 'wake', cause: 'unlock', atMs: 189_000, awayMs: 179_000 },
        { kind: 'return', atMs: 70_000, awayMs: 60_000 },
      ])
    })
  })

  describe('touch, cue gestures, and moodless turns', () => {
    const point = { x: 0.2, y: -0.4 }
    /** A voice port that records nothing of its own: it answers every observation with `view`. */
    function fakeVoice(view: ReturnType<VoicePort['observeTouch']> = null) {
      return {
        observeTouch: vi.fn<VoicePort['observeTouch']>(() => view),
        speak: vi.fn<VoicePort['speak']>(async () => 'spoken'),
        observeReturn: vi.fn<VoicePort['observeReturn']>(),
        cancel: vi.fn<VoicePort['cancel']>(),
        drop: vi.fn<VoicePort['drop']>(),
        publishVoice: vi.fn<VoicePort['publishVoice']>(),
        connect: vi.fn<VoicePort['connect']>(() => () => {}),
      }
    }

    it('answers a poke once through the mind: the scene reacts, mood is dosed, and the moment is marked', () => {
      const scene = fakeScene()
      const markMoment = vi.fn<NonNullable<StagePerformanceConductorOptions['markMoment']>>()
      const { conductor } = createConductor('natural', scene, undefined, undefined, undefined, { markMoment })

      conductor.touch({ gesture: 'poke', region: 'head', point })

      expect(scene.reactToTouch.mock.calls).toEqual([[{ id: '2-touch-reaction', cause: 2, channel: 'posture', kind: 'touch-reaction', gesture: 'poke', region: 'head', point, surprise: true }]])
      // The mind's clock reads 10 000 ms, so the dose is paced at 10 s.
      const expected = touchAffect(initialTouchAffectMemory, { touch: 'poke', region: 'head', at: 10 }, defaultExpressionPerformanceSettings).dose
      expect(expected).not.toBeNull()
      expect(scene.addMood.mock.calls).toEqual([[expected]])
      expect(markMoment.mock.calls).toEqual([['poked', expect.any(String)]])
      expect(scene.setEmotion).not.toHaveBeenCalled()
      expect(scene.applySlots).not.toHaveBeenCalled()
    })

    it('grants and withdraws the pet through the scene, and marks only a finished pet', () => {
      const scene = fakeScene()
      const markMoment = vi.fn<NonNullable<StagePerformanceConductorOptions['markMoment']>>()
      const { conductor, advance } = createConductor('natural', scene, undefined, undefined, undefined, { markMoment })

      conductor.touch({ gesture: 'pet-start', region: 'head' })
      advance(4)
      conductor.touch({ gesture: 'pet-end', region: 'head', durationMs: 4000 })

      expect(scene.reactToTouch.mock.calls.map(([intent]) => intent)).toMatchObject([{ gesture: 'pet', phase: 'start' }, { gesture: 'pet', phase: 'end' }])
      expect(scene.addMood.mock.calls.map(([dose]) => dose.id)).toEqual(['touch-1-pet', 'touch-2-pet-long'])
      expect(markMoment.mock.calls).toEqual([['petted', expect.any(String)]])
    })

    it('withdraws a cancelled pet through the scene without a situation touch, a moment, or a line', () => {
      const scene = fakeScene()
      const voice = fakeVoice()
      const markMoment = vi.fn<NonNullable<StagePerformanceConductorOptions['markMoment']>>()
      const { conductor, advance } = createConductor('natural', scene, undefined, undefined, undefined, { markMoment, voice: () => voice })

      conductor.touch({ gesture: 'pet-start', region: 'head' })
      advance(4)
      conductor.touch({ gesture: 'pet-cancel', region: 'head' })

      expect(scene.reactToTouch.mock.calls.map(([intent]) => intent)).toMatchObject([{ gesture: 'pet', phase: 'start' }, { gesture: 'pet', phase: 'end' }])
      expect(scene.addMood.mock.calls.map(([dose]) => dose.id)).toEqual(['touch-1-pet'])
      expect(markMoment).not.toHaveBeenCalled()
      expect(voice.observeTouch).not.toHaveBeenCalled()
      expect(voice.speak).not.toHaveBeenCalled()
    })

    it('records a finished pet and a poke in the situation, and never a pet start', () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      onTestFinished(() => {
        vi.useRealTimers()
      })
      const T0 = 1_700_000_000_000
      vi.setSystemTime(T0)
      const voice = fakeVoice()
      const { conductor } = createConductor('natural', fakeScene(), undefined, undefined, undefined, { voice: () => voice })

      conductor.touch({ gesture: 'pet-start', region: 'head' })
      expect(voice.observeTouch).not.toHaveBeenCalled()

      conductor.touch({ gesture: 'pet-end', region: 'head', durationMs: 4200 })
      vi.setSystemTime(T0 + 1500)
      conductor.touch({ gesture: 'poke', region: 'body', point })

      expect(voice.observeTouch.mock.calls.map(([observation]) => observation)).toEqual([
        { kind: 'touch', gesture: 'pet', region: 'head', atMs: T0, durationMs: 4200 },
        { kind: 'touch', gesture: 'poke', region: 'body', atMs: T0 + 1500 },
      ])
      expect(voice.speak).not.toHaveBeenCalled()
    })

    it.each([
      ['its outcome', async (): Promise<'refused'> => 'refused', 'refused'],
      ['a failed outcome when it throws', async (): Promise<'refused'> => { throw new Error('No chat') }, 'failed'],
    ] as const)('speaks the line the mind decided and returns %s to the mind', async (_name, speak, outcome) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      // The conductor's clock reads 10 s, so the mind decides at 10 000 ms about a burst that ends then.
      const voice = { ...fakeVoice({ sessionId: 'session-1', eventId: 'touch-event', pet: null, pokeTimesMs: [8000, 9000, 10_000], lastCharacterLineAtMs: null, held: null }), speak: vi.fn<VoicePort['speak']>(speak) }
      // Seed 17 draws below the odds of a protest; the conductor's seed 7 would hold it.
      const { conductor, mind } = createConductor('natural', fakeScene(), undefined, undefined, undefined, { voice: () => voice, mindSeed: 17 })
      const settled = new Promise<Parameters<Parameters<CharacterMind['onStep']>[0]>[0]>((resolve) => {
        mind.onStep(step => step.stimuli.some(stimulus => stimulus.kind === 'voice-outcome') && resolve(step))
      })

      conductor.touch({ gesture: 'poke', region: 'head', point })

      expect(voice.speak.mock.calls).toEqual([['reaction:touch-event', { kind: 'reaction', reaction: 'poke-protest', eventId: 'touch-event' }]])
      expect(mind.state.voice.reaction.pending).toMatchObject({ eventId: 'touch-event' })
      expect((await settled).stimuli).toEqual([{ kind: 'voice-outcome', turnId: 'reaction:touch-event', outcome }])
      expect(mind.state.voice.reaction.pending).toBeNull()
    })

    it.each(['basic'] as const)('reports touch intents another stage declared but this %s scene cannot perform', (driver) => {
      const scene = fakeScene()
      const voice = fakeVoice()
      const markMoment = vi.fn<NonNullable<StagePerformanceConductorOptions['markMoment']>>()
      const { conductor, mind, refusals } = createConductor(driver, scene, undefined, undefined, undefined, { voice: () => voice, markMoment })

      conductor.touch({ gesture: 'pet-start', region: 'head' })
      conductor.touch({ gesture: 'poke', region: 'body', point })

      expect(mind.state.seq).toBe(3)
      expect(scene.reactToTouch).not.toHaveBeenCalled()
      expect(scene.addMood).not.toHaveBeenCalled()
      expect(voice.observeTouch).toHaveBeenCalledOnce()
      expect(markMoment).not.toHaveBeenCalled()
      expect(refusals.mock.calls.map(([refusal]) => refusal.kind)).toEqual(['touch-reaction', 'mood', 'attend', 'touch-reaction', 'mood', 'moment', 'attend'])
      expect(scene.setEmotion).not.toHaveBeenCalled()
    })

    it('sends the idle drive and reach-out cues to a Natural scene, and switches idle off under a basic driver', () => {
      const drive = { energy: 0.2, valence: 0, tension: 0, sleepiness: 0, solitude: 0.5, rate: 1 }
      const sent = (['natural', 'basic'] as const).map((driver) => {
        const scene = { ...fakeScene(), setIdleDrive: vi.fn<NonNullable<StagePerformanceScene['setIdleDrive']>>(), idleCue: vi.fn<NonNullable<StagePerformanceScene['idleCue']>>() }
        const { conductor } = createConductor(driver, scene)
        conductor.idleDrive(drive)
        conductor.idleCue({ id: 'cue-1', cause: 1, kind: 'cue', channel: 'posture', cue: 'about-to-speak' })
        return [driver, scene.setIdleDrive.mock.calls, scene.idleCue.mock.calls]
      })

      expect(sent).toEqual([
        ['natural', [[drive]], [['about-to-speak', 'cue-1']]],
        ['basic', [[null]], []],
      ])
    })

    it('asks the mind for a requested idle act under Natural only', () => {
      const asked = (['natural', 'basic'] as const).map((driver) => {
        const { conductor, mind } = createConductor(driver)
        const steps: MindStep[] = []
        mind.onStep(step => steps.push(step))
        conductor.idlePlay('yawn')
        return [driver, steps.map(step => [step.stimuli, step.intents.map(intent => intent.kind === 'idle-act' && [intent.act, intent.requested])])]
      })

      expect(asked).toEqual([
        ['natural', [[[{ kind: 'idle-play', act: 'yawn' }], [['yawn', true]]]]],
        ['basic', [[[{ kind: 'idle-play', act: 'yawn' }], [['yawn', true]]]]],
      ])
    })

    it('performs an idle intent as a scene order under Natural, and drops it under a basic driver with the dormant view', () => {
      const intents = [
        { id: '3-idle', cause: 3, channel: 'posture', kind: 'idle-act', act: 'yawn', seed: 99, requested: false },
        { id: '4-idle', cause: 4, channel: 'posture', kind: 'idle-errand', errand: 'pastime', pick: 0.5, holdSeconds: 120 },
      ] as const
      const performed = (['natural', 'basic'] as const).map((driver) => {
        const scene = { ...fakeScene(), idle: vi.fn<NonNullable<StagePerformanceScene['idle']>>() }
        const idleReports = vi.fn<NonNullable<StagePerformanceConductorOptions['idleReports']>>()
        const { conductor } = createConductor(driver, scene, undefined, undefined, undefined, { idleReports })
        for (const intent of intents)
          conductor.idle(intent)
        return [driver, scene.idle.mock.calls, idleReports.mock.calls]
      })

      expect(performed).toEqual([
        ['natural', [
          [{ id: '3-idle', kind: 'act', act: 'yawn', seed: 99, requested: false }],
          [{ id: '4-idle', kind: 'errand', errand: 'pastime', pick: 0.5, holdSeconds: 120 }],
        ], []],
        ['basic', [], [[[{ kind: 'view', view: expect.objectContaining({ drive: null }) }]]]],
      ])
    })

    it('hands a detected beat to the scene only under Natural', () => {
      for (const driver of ['natural', 'basic'] as const) {
        const scene = { ...fakeScene(), beat: vi.fn<NonNullable<StagePerformanceScene['beat']>>() }
        const { conductor } = createConductor(driver, scene)
        conductor.beat(0.5)
        expect(scene.beat.mock.calls, driver).toEqual(driver === 'natural' ? [[0.5]] : [])
      }
    })

    it('answers cursor reports under Natural on the reporting scene only, and drops them under a basic driver', () => {
      const mind = naturalMind({ seed: 7, clock: () => 10_000 })
      const stage = (driver: TestPerformer) => {
        const scene = { ...fakeScene(), cursorEpisode: vi.fn<NonNullable<StagePerformanceScene['cursorEpisode']>>() }
        const conductor = new StagePerformanceConductor({ scene: () => scene, capabilities: () => driver === 'natural' ? MMD_NATURAL_CAPABILITIES : NO_CAPABILITIES, settings: () => defaultExpressionPerformanceSettings, catalog: () => catalog, seed: 7, mind })
        return { scene, conductor }
      }
      const reporting = stage('natural')
      const other = stage('natural')
      const basic = stage('basic')
      const steps = mind.state.seq

      reporting.conductor.cursor([{ requestId: 4, band: 'near', opportunity: 'appeared' }, { requestId: 5, band: 'far', opportunity: 'moved' }])
      expect(mind.state.seq).toBe(steps + 2)
      expect(reporting.scene.cursorEpisode.mock.calls).toEqual([
        [{ requestId: 4, episode: expect.objectContaining({ band: 'near', engaging: true }) }],
        [{ requestId: 5, episode: expect.objectContaining({ band: 'far' }) }],
      ])
      expect(other.scene.cursorEpisode).not.toHaveBeenCalled()

      basic.conductor.cursor([{ requestId: 1, band: 'near', opportunity: 'appeared' }])
      expect(basic.scene.cursorEpisode).not.toHaveBeenCalled()
      expect(mind.state.seq).toBe(steps + 3)
    })

    it('sends the attend of a drag release to the scene under Natural only', () => {
      const attended = (['natural', 'basic'] as const).map((driver) => {
        const scene = attendingScene()
        const { conductor, mind } = createConductor(driver, scene)
        const steps: string[] = []
        mind.onStep(step => steps.push(step.stimuli.map(stimulus => stimulus.kind === 'interaction' ? stimulus.source : stimulus.kind).join(',')))
        conductor.interaction('drag')
        return [driver, steps, scene.attend.mock.calls.map(([intent]) => [intent.target, intent.attendCause, intent.target === 'cursor' ? intent.windowMs : null])]
      })

      expect(attended).toEqual([
        ['natural', ['drag'], [['cursor', 'drag', 60_000]]],
        ['basic', ['drag'], []],
      ])
    })

    it('steps the mind for chat activity under every driver and sends its read and attend to the scene under Natural only', () => {
      const read = (['natural', 'basic'] as const).map((driver) => {
        const scene = { ...attendingScene(), chatRead: vi.fn<NonNullable<StagePerformanceScene['chatRead']>>() }
        const { conductor, mind } = createConductor(driver, scene)
        const steps: string[] = []
        mind.onStep(step => steps.push(step.stimuli.map(stimulus => stimulus.kind === 'chat' ? `chat:${stimulus.cue}` : stimulus.kind).join(',')))
        conductor.chat('sent', 6)
        conductor.chat('unfold')
        return [driver, steps, scene.chatRead.mock.calls.map(([intent]) => [intent.cue, intent.words]), scene.attend.mock.calls.length]
      })

      expect(read).toEqual([
        ['natural', ['chat:sent', 'chat:unfold'], [['sent', 6], ['unfold', 0]], 2],
        ['basic', ['chat:sent', 'chat:unfold'], [], 0],
      ])
    })

    it('sends the attend of a poke to the scene after the touch reaction', () => {
      const scene = attendingScene()
      const { conductor } = createConductor('natural', scene)

      conductor.touch({ gesture: 'poke', region: 'head', point: { x: 0, y: 0 } })

      expect(scene.attend.mock.calls).toEqual([[{ id: '2-attend', cause: 2, channel: 'body', kind: 'attend', target: 'cursor', attendCause: 'touch', windowMs: 60_000 }]])
      expect(scene.reactToTouch.mock.invocationCallOrder[0]).toBeLessThan(scene.attend.mock.invocationCallOrder[0])
    })

    it('hands idle reports to the mind under Natural, the dormant view once it leaves, and the latest view again on return', () => {
      let driver: TestPerformer = 'natural'
      const idleReports = vi.fn<NonNullable<StagePerformanceConductorOptions['idleReports']>>()
      const conductor = new StagePerformanceConductor({ scene: () => fakeScene(), capabilities: () => driver === 'natural' ? MMD_NATURAL_CAPABILITIES : NO_CAPABILITIES, settings: () => defaultExpressionPerformanceSettings, catalog: () => catalog, seed: 7, mind: naturalMind({ seed: 7 }), idleReports })
      const view = { drive: { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, rate: 1 }, active: true, mode: 'idle', away: false, blocked: false, current: null, errand: null } as const
      conductor.idleReport([{ kind: 'view', view }])
      driver = 'basic'
      conductor.idleReport([{ kind: 'view', view: { ...view, active: false } }])
      conductor.idleDrive(null)
      driver = 'natural'
      conductor.idleDrive(null)

      expect(idleReports.mock.calls).toEqual([
        [[{ kind: 'view', view }]],
        [[{ kind: 'view', view: expect.objectContaining({ drive: null }) }]],
        [[{ kind: 'view', view: { ...view, active: false } }]],
      ])
    })

    it('leaves the idle intents of a touch step to the mind store', () => {
      const scene = { ...fakeScene(), idle: vi.fn<NonNullable<StagePerformanceScene['idle']>>() }
      const { conductor, mind, advance } = createConductor('natural', scene)
      mind.receive({ kind: 'idle', reports: [{ kind: 'view', view: { drive: { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, rate: 1 }, active: true, mode: 'idle', away: false, blocked: false, current: null, errand: null } }] })
      const steps: MindStep[] = []
      mind.onStep(step => steps.push(step))
      advance(3600)

      conductor.touch({ gesture: 'poke', region: 'head', point })

      expect(steps[0].intents.map(intent => intent.kind)).toContain('idle-act')
      expect(scene.reactToTouch).toHaveBeenCalledOnce()
      expect(scene.idle).not.toHaveBeenCalled()
    })

    it('steps the mind for a cue gesture under every driver and plays its gesture intent on the scene under Natural only', () => {
      const played = (['natural', 'basic'] as const).map((driver) => {
        const scene = fakeScene()
        const { conductor, mind } = createConductor(driver, scene)
        const stimuli: unknown[] = []
        mind.onStep(step => stimuli.push(...step.stimuli))
        conductor.gesture('nod', 2, 'act', 'turn-1')
        conductor.gesture('glance', 1, 'devtools')
        return [driver, stimuli, scene.gesture.mock.calls]
      })

      expect(played).toEqual((['natural', 'basic'] as const).map(driver => [
        driver,
        [
          { kind: 'cue-gesture', gesture: 'nod', count: 2, source: 'act', turnId: 'turn-1' },
          { kind: 'cue-gesture', gesture: 'glance', count: 1, source: 'devtools' },
        ],
        driver === 'natural' ? [['nod', 2], ['glance', 1]] : [],
      ]))
    })

    it('forwards an ACT action label and its cue gesture to the scene under every driver', () => {
      const forwarded = (['natural', 'basic'] as const).map((driver) => {
        const scene = { ...fakeScene(), action: vi.fn<NonNullable<StagePerformanceScene['action']>>() }
        const { conductor } = createConductor(driver, scene)
        conductor.action('wave')
        conductor.action('bow', { kind: 'nod', count: 2 })
        return [driver, scene.action.mock.calls]
      })

      expect(forwarded).toEqual([['natural', [['wave', undefined], ['bow', { kind: 'nod', count: 2 }]]], ['basic', []]])
    })

    it('drops an ACT action label without a scene or with a scene that plays no clips', () => {
      const clipless = fakeScene()
      const withoutScene = new StagePerformanceConductor({
        scene: () => undefined,
        capabilities: () => MMD_NATURAL_CAPABILITIES,
        settings: () => defaultExpressionPerformanceSettings,
        catalog: () => catalog,
        seed: 7,
        mind: naturalMind({ seed: 7, clock: () => 10_000 }),
        clock: () => 10,
        profile: () => undefined,
        modelId: () => 'rig',
      })

      expect(() => withoutScene.action('wave')).not.toThrow()
      expect(() => createConductor('natural', clipless).conductor.action('wave')).not.toThrow()
      expect(clipless.gesture).not.toHaveBeenCalled()
    })

    it('doses no mood for the episodes of a moodless turn and leaves other turns alone', () => {
      const scene = fakeScene()
      const { conductor, advance } = createConductor('natural', scene)

      conductor.markMoodless('reaction')
      conductor.emotion('happy', 0.6, 'act', 'reaction')
      advance(3)
      conductor.emotion('sad', 0.9, 'act', 'reaction')
      advance(3)
      conductor.emotion('angry', 0.6, 'act', 'user-turn')

      expect(scene.setEmotion.mock.calls.map(([episode]) => [episode.emotion, episode.band])).toEqual([['happy', 'clear'], ['sad', 'strong'], ['angry', 'clear']])
      const angry = scene.setEmotion.mock.calls[2][0]
      expect(scene.addMood.mock.calls.map(([dose]) => dose.id.split('@')[0])).toEqual([angry.id])
    })

    it('hands the mood dose to the scene right after the episode it belongs to', () => {
      const order: string[] = []
      const scene = fakeScene()
      scene.setEmotion.mockImplementation(() => order.push('episode'))
      scene.addMood.mockImplementation(() => order.push('dose'))
      createConductor('natural', scene).conductor.emotion('happy', 0.6, 'act')
      expect(order).toEqual(['episode', 'dose'])
    })
  })

  describe('combos', () => {
    const combo = entry('pair', 'combo', [], { label: 'Pair', exposedToLlm: true, members: [{ expressionId: 'anger', strength: 1 }, { expressionId: 'tear', strength: 1 }], slots: ['face', 'effect'], fileName: '', parameterIds: [] })
    const withCombos: CatalogEntry[] = [
      ...catalog,
      combo,
      entry('slotless', 'combo', [], { exposedToLlm: true, slots: [] }),
      entry('copy', 'face', [], { exposedToLlm: true, duplicateOf: 'anger' }),
      entry('expression19', 'unsorted', [], { exposedToLlm: true }),
    ]

    it('exposes a combo that spans slots as its own group and skips slotless, duplicate, and unsorted entries', () => {
      expect(toExposedExpressions(withCombos)).toEqual([{ label: 'game', kind: 'prop' }, { label: 'Pair', kind: 'combo' }])
    })

    it('resolves an exposed combo by label and carries its id on the expression signal', () => {
      const { conductor } = createConductor('natural', fakeScene(), defaultExpressionPerformanceSettings, undefined, withCombos)
      conductor.startRecording()

      expect(conductor.expression('pair', undefined, 'tool', 'turn-a')?.id).toBe('pair')

      const signals = conductor.exportTrace()!.entries.flatMap(item => item.type === 'signal' && item.signal.kind === 'expression' ? [item.signal] : [])
      expect(signals.map(signal => signal.expressionId)).toEqual(['pair'])
    })

    it('answers an unexposed or duplicate label with success false and the available labels', () => {
      const { conductor } = createConductor('natural', fakeScene(), defaultExpressionPerformanceSettings, undefined, withCombos)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const port = createExpressionToolPort(conductor, { leases: { face: null, effect: null, prop: null }, llmEligibleEntries: withCombos.filter(candidate => candidate.exposedToLlm && candidate.duplicateOf === undefined && candidate.kind !== 'unsorted') })

      for (const name of ['copy', 'expression19', 'anger'])
        expect(port.set(name)).toMatchObject({ success: false, available: ['game', 'Pair'] })
    })

    it('reports a combo active while any slot it spans holds it', () => {
      const { conductor } = createConductor('natural', fakeScene(), defaultExpressionPerformanceSettings, undefined, withCombos)
      const performer = (effect: { expressionId: string } | null) => ({ leases: { face: null, effect, prop: null }, llmEligibleEntries: [combo] })

      expect(createExpressionToolPort(conductor, performer(null)).list()).toEqual([{ label: 'Pair', kind: 'combo', active: false }])
      expect(createExpressionToolPort(conductor, performer({ expressionId: 'pair' })).list()).toEqual([{ label: 'Pair', kind: 'combo', active: true }])
    })
  })

  it('routes clears through the decider so an exact replay reproduces every dispatched slot command', () => {
    const scene = fakeScene()
    const { conductor, advance } = createConductor('natural', scene)

    conductor.startRecording()
    conductor.emotion('angry', 0.6, 'act', 'turn-a')
    conductor.expression('game', 4, 'tool', 'turn-a')
    advance(1)
    conductor.clearExpression('prop', 'tool')
    advance(1)
    conductor.expression('game', undefined, 'tool')
    conductor.clearExpression(undefined, 'tool')

    const trace = conductor.exportTrace()!
    const dispatched = scene.applySlots.mock.calls.flatMap(([commands]) => commands)

    expect(replaySlots(trace)).toEqual(dispatched)
    expect(trace.entries.flatMap(entry => entry.type === 'signal' && entry.signal.kind === 'clear' ? [entry.signal] : [])).toEqual([
      { kind: 'clear', intentId: '4-release', source: 'tool', slot: 'prop', at: 11 },
      { kind: 'clear', intentId: '6-release', source: 'tool', at: 12 },
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

  describe('held emotions', () => {
    const rage = entry('rage', 'face', [{ emotion: 'angry', weight: 1, minBand: 'clear' }], { exposedToLlm: true, label: 'Rage' })
    const heldCatalog = [...catalog, rage]

    it('dispatches one episode and one hold for a mapped LLM expression under Natural', () => {
      const scene = fakeScene()
      const { conductor } = createConductor('natural', scene, defaultExpressionPerformanceSettings, undefined, heldCatalog)

      conductor.expression('Rage', undefined, 'act', 'turn-a')

      expect(scene.setEmotion.mock.calls.map(([episode]) => [episode.emotion, episode.band])).toEqual([['angry', 'clear']])
      // The hold performs the accepted episode at the episode's own strength.
      expect(scene.applyHolds.mock.calls).toEqual([[
        [expect.objectContaining({ emotion: 'angry', strength: scene.setEmotion.mock.calls[0][0].intensity, turnId: 'turn-a' })],
        10,
      ]])
    })

    it('dispatches the hold of a Natural emotion', () => {
      const scene = fakeScene()
      const { conductor } = createConductor('natural', scene)

      conductor.emotion('happy', 0.6, 'act', 'turn-a')

      expect(scene.applyHolds.mock.calls).toEqual([[[expect.objectContaining({ emotion: 'happy', turnId: 'turn-a' })], 10]])
    })

    it('resends the mute before the holds of a hold-only decision to a scene that mounted after the mute', () => {
      const scene = fakeScene()
      let mounted = false
      const conductor = new StagePerformanceConductor({
        scene: () => mounted ? scene : undefined,
        capabilities: () => MMD_NATURAL_CAPABILITIES,
        settings: () => defaultExpressionPerformanceSettings,
        catalog: () => catalog,
        seed: 7,
        mind: naturalMind({ seed: 7, clock: () => 10_000 }),
        clock: () => 10,
      })
      conductor.setMuted(true)
      mounted = true

      // Surprised maps to no catalog entry, so the decision carries a hold and no slot command.
      conductor.emotion('surprised', 0.6, 'act', 'turn-a')

      expect(scene.applySlots).not.toHaveBeenCalled()
      expect(scene.applyHolds).toHaveBeenCalledTimes(1)
      expect(scene.setMuted).toHaveBeenCalledWith(true)
      expect(scene.setMuted.mock.invocationCallOrder[0]).toBeLessThan(scene.applyHolds.mock.invocationCallOrder[0])
    })

    it.each(['basic'] as const)('dispatches no holds or episodes under %s', (driver) => {
      const scene = fakeScene()
      const { conductor } = createConductor(driver, scene, defaultExpressionPerformanceSettings, undefined, heldCatalog)

      conductor.expression('Rage', undefined, 'act', 'turn-a')
      conductor.emotion('angry', 0.6, 'act', 'turn-a')

      expect(scene.applyHolds).not.toHaveBeenCalled()
      expect(scene.setEmotion).not.toHaveBeenCalled()
    })

    it.each(['basic'] as const)('refuses mapped expressions and emotion slots under %s without changing settings', (driver) => {
      for (const heldEmotions of [false, true]) {
        const scene = fakeScene()
        const settings = { ...defaultExpressionPerformanceSettings, heldEmotions }
        const { conductor, advance, refusals } = createConductor(driver, scene, settings, undefined, heldCatalog)
        conductor.expression('Rage', 5, 'act', 'turn-a')
        advance(1)
        conductor.emotion('angry', 0.6, 'act', 'turn-a')
        advance(3)
        conductor.emotion('angry', 0.9, 'act', 'turn-a')
        expect(scene.applySlots).not.toHaveBeenCalled()
        expect(refusals.mock.calls[0][0]).toMatchObject({ kind: 'entry', reason: 'not-declared-by-stage' })
        expect(refusals.mock.calls.length).toBeGreaterThan(1)
        expect(settings.heldEmotions).toBe(heldEmotions)
      }
    })

    it('releases the hold on a slotless clear and keeps it on a named slot clear', () => {
      const scene = fakeScene()
      const { conductor } = createConductor('natural', scene, defaultExpressionPerformanceSettings, undefined, heldCatalog)
      conductor.expression('Rage', undefined, 'act', 'turn-a')
      scene.applyHolds.mockClear()

      conductor.clearExpression('face', 'act', 'turn-a')
      expect(scene.applyHolds).not.toHaveBeenCalled()

      conductor.clearExpression(undefined, 'act', 'turn-a')
      expect(scene.applyHolds.mock.calls).toEqual([[[expect.objectContaining({ emotion: null })], 10]])
    })

    it('dispatches nothing for an unexposed expression', () => {
      const scene = fakeScene()
      const { conductor } = createConductor('natural', scene, defaultExpressionPerformanceSettings, undefined, heldCatalog)

      expect(conductor.expression('missing', undefined, 'act', 'turn-a')).toBeUndefined()

      expect(scene.setEmotion).not.toHaveBeenCalled()
      expect(scene.applyHolds).not.toHaveBeenCalled()
      expect(scene.applySlots).not.toHaveBeenCalled()
    })

    it('dispatches the slot commands of a deferred timing decision and no hold', () => {
      const picker = createPickerDecider()
      const command = { slot: 'face' as const, expressionId: 'joy', holdSeconds: 1, until: 'speech' as const, turnId: 'turn-a' }
      vi.mocked(createDecider).mockReturnValueOnce({
        ...picker,
        decide: (signal, ctx, state) => {
          const result = picker.decide(signal, ctx, state)
          return signal.kind === 'timing' ? { ...result, decision: { ...result.decision, slots: [command] } } : result
        },
      })
      const scene = fakeScene()
      const { conductor } = createConductor('natural', scene)

      conductor.clipStart('turn-a', 'clip-1', true)

      expect(scene.applySlots.mock.calls).toEqual([[[command], 10]])
      expect(scene.applyHolds).not.toHaveBeenCalled()
      conductor.dispose()
    })
  })

  describe('affect recording and character profiles', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('replays a recording started after 2,500 signals, across a mapping weight change, to exactly the dispatched slot commands', () => {
      // Fake timers fire the pause timers, so recorded timing signals take part as well.
      vi.useFakeTimers({ now: 10_000, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      const scene = fakeScene()
      let profile: PerformanceProfile | undefined
      const conductor = new StagePerformanceConductor({
        scene: () => scene,
        capabilities: () => MMD_NATURAL_CAPABILITIES,
        settings: () => defaultExpressionPerformanceSettings,
        catalog: () => catalog,
        seed: 7,
        mind: naturalMind({ seed: 7, clock: () => Date.now() }),
        clock: () => Date.now() / 1000,
        profile: () => profile,
        modelId: () => 'rig',
      })
      const emotions = ['angry', 'happy', 'sad', 'surprised', 'angry', 'neutral'] as const
      const nominals = [0.6, 0.9, 0.25, 0.6]
      let step = 0
      /** One cue of a speaking turn: playback, emotions, an LLM expression, and clears. */
      function cue() {
        const turnId = `turn-${Math.floor(step / 10)}`
        const phase = step % 10
        if (phase === 0)
          conductor.clipStart(turnId, `${turnId}-clip`, true)
        else if (phase === 7)
          conductor.expression('game', 3, 'tool', turnId)
        else if (phase === 8)
          conductor.clearExpression(step % 20 === 8 ? 'prop' : undefined, 'tool', turnId)
        else if (phase === 9)
          conductor.clipEnd(turnId, `${turnId}-clip`, 'ended')
        else
          conductor.emotion(emotions[step % emotions.length], nominals[step % nominals.length], 'act', turnId)
        step++
        vi.advanceTimersByTime(1700)
      }
      const anger = (commands: SlotCommand[]) => commands.filter(command => command.expressionId === 'anger').length

      // A throwaway recording counts the earlier signals.
      conductor.startRecording()
      while (conductor.exportTrace()!.entries.length < 2500) {
        for (let i = 0; i < 50; i++)
          cue()
      }
      conductor.startRecording()
      scene.applySlots.mockClear()
      for (let i = 0; i < 200; i++)
        cue()
      const before = scene.applySlots.mock.calls.flatMap(([commands]) => commands)
      profile = { mappingWeights: { rig: { anger: 0 } } }
      for (let i = 0; i < 200; i++)
        cue()
      const trace = conductor.exportTrace()!
      const dispatched = scene.applySlots.mock.calls.flatMap(([commands]) => commands)

      expect(replaySlots(trace)).toEqual(dispatched)
      expect(anger(before)).toBeGreaterThan(0)
      expect(anger(dispatched.slice(before.length))).toBe(0)
      expect(dispatched.some(command => command.expressionId === null)).toBe(true)
      expect(trace.entries.filter(entry => entry.type === 'context')).toEqual([
        { type: 'context', context: expect.objectContaining({ catalog: expect.arrayContaining([expect.objectContaining({ id: 'anger', mappings: [] })]) }) },
      ])
      expect(new Set(trace.entries.flatMap(entry => entry.type === 'signal' ? [entry.signal.kind] : []))).toEqual(new Set(['reaction', 'neutral', 'expression', 'clear', 'speech', 'timing']))
      // Without the context entry, replay keeps picking the disabled face.
      expect(replaySlots({ ...trace, entries: trace.entries.filter(entry => entry.type === 'signal') })).not.toEqual(dispatched)
    })

    it('marks the recording truncated once it would exceed the entry limit and refuses to replay it', () => {
      const { conductor } = createConductor('natural')

      conductor.startRecording()
      for (let i = 0; i < maxAffectTraceEntries; i++)
        conductor.setMuted(i % 2 === 0)
      expect(conductor.exportTrace()).toMatchObject({ truncated: false, entries: { length: maxAffectTraceEntries } })

      conductor.setMuted(true)
      const trace = conductor.exportTrace()!

      expect(trace).toMatchObject({ truncated: true, entries: { length: maxAffectTraceEntries } })
      expect(() => replaySlots(trace)).toThrow('Cannot replay a truncated affect trace')
    })

    it('scales a clear marker to strong with card expressiveness 1.5', () => {
      const scene = fakeScene()
      const { conductor } = createConductor('natural', scene, defaultExpressionPerformanceSettings, { expressiveness: 1.5 })

      conductor.startRecording()
      conductor.emotion('sad', 0.6, 'act', 'turn-a')

      const [episode] = scene.setEmotion.mock.calls[0]
      expect(episode.band).toBe('strong')
      expect(episode.nominal).toBeCloseTo(0.9)
      expect(conductor.exportTrace()!.entries).toEqual([
        { type: 'signal', signal: expect.objectContaining({ kind: 'reaction', episode: expect.objectContaining({ nominal: expect.closeTo(0.9) }) }) },
      ])
    })

    it('gives each Natural episode the mood gain of the profile its signal was decided under', () => {
      const scene = fakeScene()
      let now = 10
      const conductor = new StagePerformanceConductor({
        scene: () => scene,
        capabilities: () => MMD_NATURAL_CAPABILITIES,
        settings: () => defaultExpressionPerformanceSettings,
        catalog: () => catalog,
        seed: 7,
        mind: naturalMind({ seed: 7, clock: () => now * 1000 }),
        clock: () => now,
        profile: turnId => turnId === 'turn-a' ? { moodGainScale: 0 } : turnId === 'turn-b' ? { moodGainScale: 2 } : undefined,
      })
      const gains = defaultExpressionPerformanceSettings.moodDynamics

      conductor.emotion('angry', 0.6, 'act', 'turn-a')
      now += 3
      conductor.emotion('sad', 0.9, 'act', 'turn-b')
      now += 3
      conductor.emotion('happy', 0.6, 'devtools')

      const episodes = scene.setEmotion.mock.calls.map(([episode]) => episode)
      expect(episodes.map(episode => [episode.emotion, episode.band])).toEqual([['angry', 'clear'], ['sad', 'strong'], ['happy', 'clear']])
      // The zero-gain turn doses nothing; each other dose is its profile's band gain times the intensity and coefficient.
      const doses = scene.addMood.mock.calls.map(([dose]) => dose)
      expect(doses.map(dose => dose.id.split('@')[0])).toEqual([episodes[1].id, episodes[2].id])
      expect(doses[0].valence).toBeCloseTo(2 * gains.strongGain * episodes[1].intensity * naturalEmotions.sad.mood[0], 12)
      expect(doses[1].valence).toBeCloseTo(gains.clearGain * episodes[2].intensity * naturalEmotions.happy.mood[0], 12)
    })

    it('removes an expression from auto picks when the card maps it with weight 0 for the mounted model', () => {
      function picks(profile?: PerformanceProfile) {
        const scene = fakeScene()
        createConductor('natural', scene, defaultExpressionPerformanceSettings, profile).conductor.emotion('angry', 0.6, 'act', 'turn-a')
        return scene.applySlots.mock.calls.flatMap(([commands]) => commands).map(command => command.expressionId)
      }

      expect(picks()).toEqual(['anger'])
      expect(picks({ mappingWeights: { rig: { anger: 0 } } })).toEqual([])
      expect(picks({ mappingWeights: { 'other-model': { anger: 0 } } })).toEqual(['anger'])
    })
  })

  describe('timing events', () => {
    /** Frames of the stage's lipsync loop, in milliseconds. */
    const frameMs = 16

    afterEach(() => {
      vi.useRealTimers()
    })

    /**
     * A picker that records every signal and reports `deadline` until a deadline signal reaches it.
     * `onSignal` may return a new deadline (or null) after a signal, as a planner does when
     * playback takes or cancels a plan. The conductor runs on fake timers, with the fake epoch
     * clock as its monotonic clock.
     */
    function createTimingConductor(options: { deadline?: number, settings?: ExpressionPerformanceSettings, onSignal?: (signal: AffectSignal) => number | null | undefined } = {}) {
      vi.useFakeTimers({ now: 10_000, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      const picker = createPickerDecider()
      const signals: AffectSignal[] = []
      let pending = options.deadline ?? null
      vi.mocked(createDecider).mockReturnValueOnce({
        ...picker,
        nextDeadline: () => pending,
        decide: (signal, ctx, state) => {
          signals.push(signal)
          if (signal.kind === 'deadline' && pending !== null && signal.at >= pending)
            pending = null
          const next = options.onSignal?.(signal)
          if (next !== undefined)
            pending = next
          return picker.decide(signal, ctx, state)
        },
      })
      const settings = options.settings ?? defaultExpressionPerformanceSettings
      const conductor = new StagePerformanceConductor({
        scene: () => fakeScene(),
        capabilities: () => MMD_NATURAL_CAPABILITIES,
        settings: () => settings,
        catalog: () => catalog,
        seed: 7,
        mind: naturalMind({ seed: 7, clock: () => Date.now() }),
        clock: () => Date.now() / 1000,
      })
      function timing(kind?: TimingEvent['kind']) {
        return signals.flatMap(signal => signal.kind === 'timing' && (!kind || signal.event.kind === kind) ? [signal.event] : [])
      }
      function advance(seconds: number) {
        vi.advanceTimersByTime(seconds * 1000)
      }
      /** Feeds one lipsync level per frame, as the stage's animation-frame loop does. */
      function voice(level: number, frames: number) {
        for (let frame = 0; frame < frames; frame++) {
          vi.advanceTimersByTime(frameMs)
          conductor.sampleVoiceLevel(level)
        }
      }
      /** Signal kinds the decider received from `at` on, in order, with timing events by their event kind. */
      function kindsFrom(at: number) {
        return signals.filter(signal => signal.at >= at).map(signal => signal.kind === 'timing' ? signal.event.kind : signal.kind)
      }
      return { conductor, signals, timing, advance, voice, kindsFrom }
    }

    it('sends exactly one deadline signal at the decider\'s next deadline when no other input arrives', () => {
      const { conductor, signals, advance } = createTimingConductor({ deadline: 12.5 })

      conductor.emotion('happy', 0.6, 'act', 'turn-a')
      advance(10)

      expect(signals.filter(signal => signal.kind === 'deadline')).toEqual([{ kind: 'deadline', at: 12.5 }])
    })

    it('cancels the pending deadline on dispose', () => {
      const { conductor, signals, advance } = createTimingConductor({ deadline: 12.5 })

      conductor.emotion('happy', 0.6, 'act', 'turn-a')
      conductor.dispose()
      advance(10)

      expect(signals.filter(signal => signal.kind === 'deadline')).toEqual([])
    })

    it('sends one sentence_start per sentence across chunked sentences', () => {
      const { conductor, timing, advance } = createTimingConductor()

      // Two sentences of two chunks each, then a streaming-provider clip without sentence data.
      const clips: [string, boolean | undefined][] = [['c1', true], ['c2', false], ['c3', true], ['c4', false], ['c5', undefined]]
      for (const [clipId, sentenceStart] of clips) {
        conductor.clipStart('turn-a', clipId, sentenceStart)
        advance(1)
        conductor.clipEnd('turn-a', clipId, 'ended')
        advance(0.05)
      }

      expect(timing('sentence_start').map(event => [event.turnId, event.at])).toEqual([['turn-a', 10], ['turn-a', 12.1]])
    })

    it('sends no pause for a 0.1 s gap and one pause for a 0.3 s gap', () => {
      const { conductor, timing, advance } = createTimingConductor()

      conductor.clipStart('turn-a', 'c1', true)
      advance(1)
      conductor.clipEnd('turn-a', 'c1', 'ended')
      advance(0.1)
      conductor.clipStart('turn-a', 'c2', false)
      advance(1)
      conductor.clipEnd('turn-a', 'c2', 'ended')
      advance(0.3)
      conductor.clipStart('turn-a', 'c3', true)
      advance(1)

      expect(timing('pause').map(event => [event.turnId, event.at])).toEqual([['turn-a', 12.28]])
    })

    it('sends no pause after the turn ends', () => {
      const { conductor, timing, advance } = createTimingConductor()

      conductor.clipStart('turn-a', 'c1', true)
      advance(1)
      conductor.clipEnd('turn-a', 'c1', 'ended')
      advance(0.05)
      conductor.turnEnd('turn-a')
      advance(5)

      expect(timing('pause')).toEqual([])
    })

    it('sends a pause due with a deadline before the deadline', () => {
      const settings = parseExpressionPerformanceSettings({ timing: { pauseSeconds: 0.25 } }).value
      const { conductor, signals, advance } = createTimingConductor({ deadline: 11.25, settings })

      conductor.clipStart('turn-a', 'c1', true)
      advance(1)
      conductor.clipEnd('turn-a', 'c1', 'ended')
      advance(1)

      expect(signals.slice(-2)).toEqual([
        { kind: 'timing', event: expect.objectContaining({ kind: 'pause', turnId: 'turn-a', at: 11.25 }), at: 11.25 },
        { kind: 'deadline', at: 11.25 },
      ])
    })

    // Gate review probe B1. Fake timers delay a zero-delay timer created mid-tick by 1 ms, so the
    // test advances past the deadline's same-instant yield; the signal still carries 12.5.
    it('processes same-time clip playback before a deadline', () => {
      const { conductor, signals, kindsFrom, advance } = createTimingConductor({ deadline: 12.5 })

      conductor.emotion('happy', 0.6, 'act', 'turn-a')
      setTimeout(() => conductor.clipStart('turn-a', 'clip-a', true), 2500)
      advance(3)

      expect(kindsFrom(12.5)).toEqual(['speech', 'sentence_start', 'deadline'])
      expect(signals.filter(signal => signal.kind === 'deadline')).toEqual([{ kind: 'deadline', at: 12.5 }])
    })

    // The same-time pause makes the decider drop its
    // deadline, so the obsolete deadline must not be sent.
    it('sends no deadline that a same-time pause cancelled', () => {
      const settings = parseExpressionPerformanceSettings({ timing: { pauseSeconds: 0.25 } }).value
      const { conductor, signals, advance } = createTimingConductor({
        deadline: 11.25,
        settings,
        onSignal: signal => signal.kind === 'timing' && signal.event.kind === 'pause' ? null : undefined,
      })

      conductor.clipStart('turn-a', 'c1', true)
      advance(1)
      conductor.clipEnd('turn-a', 'c1', 'ended')
      advance(1)

      expect(signals.filter(signal => signal.kind === 'deadline')).toEqual([])
    })

    it('sends a deadline that same-time playback replaced at its new time only', () => {
      const { conductor, signals, advance } = createTimingConductor({
        deadline: 12.5,
        onSignal: signal => signal.kind === 'timing' && signal.event.kind === 'sentence_start' ? 14 : undefined,
      })

      conductor.emotion('happy', 0.6, 'act', 'turn-a')
      setTimeout(() => conductor.clipStart('turn-a', 'clip-a', true), 2500)
      advance(5)

      expect(signals.filter(signal => signal.kind === 'deadline')).toEqual([{ kind: 'deadline', at: 14 }])
    })

    // A zero-length pause armed by a same-time clip end is due with the deadline but queued after
    // it; it is sent first, and the deadline it cancels is not sent.
    it('sends no deadline that a same-time zero-length pause cancelled', () => {
      const settings = parseExpressionPerformanceSettings({ timing: { pauseSeconds: 0 } }).value
      const { conductor, kindsFrom, advance } = createTimingConductor({
        deadline: 12.5,
        settings,
        onSignal: signal => signal.kind === 'timing' && signal.event.kind === 'pause' ? null : undefined,
      })

      conductor.clipStart('turn-a', 'c1', true)
      setTimeout(() => conductor.clipEnd('turn-a', 'c1', 'ended'), 2500)
      advance(5)

      expect(kindsFrom(12.5)).toEqual(['speech', 'pause'])
    })

    // One turn's clip never cancels another turn's pause, and
    // dispose cancels a pending pause.
    it('isolates pauses by turn and cancels them on dispose', () => {
      const { conductor, timing, advance } = createTimingConductor()

      conductor.clipStart('turn-a', 'a', true)
      conductor.clipEnd('turn-a', 'a', 'ended')
      conductor.clipStart('turn-b', 'b', true)
      advance(0.3)

      expect(timing('pause').map(event => event.turnId)).toEqual(['turn-a'])

      conductor.clipEnd('turn-b', 'b', 'ended')
      conductor.dispose()
      advance(1)

      expect(timing('pause').map(event => event.turnId)).toEqual(['turn-a'])
    })

    it('sends utterance_end once when the turn end repeats', () => {
      const { conductor, timing } = createTimingConductor()

      conductor.syncActiveTurns(['turn-a'])
      conductor.turnEnd('turn-a')
      conductor.turnEnd('turn-a')
      conductor.syncActiveTurns([])

      expect(timing('utterance_end').map(event => event.turnId)).toEqual(['turn-a'])
    })

    it('sends one emphasis per onset: a dip that does not fall below the rearm level is not a new onset', () => {
      const settings = parseExpressionPerformanceSettings({ timing: { emphasisRefractory: 0 } }).value
      const { conductor, timing, voice } = createTimingConductor({ settings })

      conductor.clipStart('turn-a', 'c1', true)
      voice(0, 30)
      voice(0.8, 6)
      // This dip ends with the onset at 0.09: below the trigger level (0.10) but above the rearm
      // level (0.04), so the detector stays disarmed and the second rise is the same onset.
      voice(0.25, 4)
      voice(0.8, 6)
      // Silence lets the detector rearm; the next rise is a new onset.
      voice(0, 30)
      voice(0.8, 6)

      expect(timing('emphasis').map(event => event.turnId)).toEqual(['turn-a', 'turn-a'])
    })

    it('sends no emphasis inside the refractory period or while no clip plays', () => {
      const { conductor, timing, voice } = createTimingConductor()

      // Onsets 0.5 s apart; the default refractory period is 1.2 s.
      conductor.clipStart('turn-a', 'c1', true)
      const burst = () => {
        voice(0.8, 6)
        voice(0, 25)
      }
      burst()
      burst()
      burst()
      burst()
      conductor.clipEnd('turn-a', 'c1', 'ended')
      burst()

      expect(timing('emphasis').map(event => Math.round((event.at - 10) * 1000))).toEqual([32, 1504])
    })
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

  describe('body tools', () => {
    const result = { success: true, state: { position: 'home' as const, moving: false, refractorySeconds: 0 } }
    const port: BodyToolPort = {
      state: () => result.state,
      comeHere: async () => result,
      goHome: async () => result,
      lookAt: async () => result,
    }

    it('registers the body tools by id, replaces them with a new port, and removes them without one', async () => {
      setActivePinia(createPinia())
      const tools = useLlmToolsStore()
      const registration = createBodyToolRegistration(tools)

      await registration.sync(port)
      expect(tools.tools.map(tool => tool.id)).toEqual([...bodyToolIds])
      expect(tools.activeTools.map(tool => tool.function.name)).toEqual(['come_here', 'go_home', 'look_at'])

      await registration.sync(port)
      expect(tools.tools.map(tool => tool.id)).toEqual([...bodyToolIds])

      await registration.sync(undefined)
      expect(tools.tools).toEqual([])

      // A build that a newer, port-less sync overtakes must not register stale tools.
      const overtaken = registration.sync(port)
      await registration.sync(undefined)
      await overtaken
      expect(tools.tools).toEqual([])

      await registration.sync(port)
      registration.dispose()
      await registration.sync(port)
      expect(tools.tools).toEqual([])
    })

    it('exposes the body tools only while the active scene offers a body port', async () => {
      setActivePinia(createPinia())
      const tools = useLlmToolsStore()
      const bodyPort = ref<BodyToolPort | undefined>()
      const scope = effectScope()
      onTestFinished(() => scope.stop())
      scope.run(() => useStagePerformanceConductor({
        renderer: () => 'mmd',
        scene: () => undefined,
        capabilities: () => MMD_NATURAL_CAPABILITIES,
        expressionBackend: () => undefined,
        bodyPort: () => bodyPort.value,
        mind: naturalMind({ seed: 7 }),
        mood: () => null,
      }))
      await nextTick()
      expect(tools.tools.filter(tool => tool.id.startsWith('body:'))).toEqual([])

      bodyPort.value = port
      await vi.waitFor(() => expect(tools.tools.map(tool => tool.id)).toEqual([...bodyToolIds]))

      bodyPort.value = undefined
      await vi.waitFor(() => expect(tools.tools).toEqual([]))
    })
  })

  it('never lends body or action ports without body declared, and removes existing registrations on a switch', async () => {
    setActivePinia(createPinia())
    const tools = useLlmToolsStore()
    const capabilities = ref<PerformerCapabilities>(NO_CAPABILITIES)
    const bodyState = { position: 'home' as const, moving: false, refractorySeconds: 0 }
    const bodyPort = vi.fn((): BodyToolPort => ({ state: () => bodyState, comeHere: async () => ({ success: true, state: bodyState }), goHome: async () => ({ success: true, state: bodyState }), lookAt: async () => ({ success: true, state: bodyState }) }))
    const actionPort = vi.fn((): ActionToolPort => ({ exposed: () => [{ label: 'dance', kind: 'dance' }], perform: async () => ({ success: true }), state: () => ({ performing: null }) }))
    const scope = effectScope()
    onTestFinished(() => scope.stop())
    scope.run(() => useStagePerformanceConductor({
      renderer: () => 'mmd',
      scene: () => undefined,
      capabilities: () => capabilities.value,
      expressionBackend: () => undefined,
      bodyPort,
      actionPort,
      listActions: () => [{ label: 'dance', kind: 'dance', exposed: true }],
      mind: naturalMind({ seed: 1 }),
      mood: () => null,
    }))
    expect(bodyPort).not.toHaveBeenCalled()
    expect(actionPort).not.toHaveBeenCalled()
    expect(tools.tools).toEqual([])
    function nextTools(count: number) {
      return new Promise<void>((resolve, reject) => {
        let stop: (() => void) | undefined
        const timeout = setTimeout(() => {
          stop?.()
          reject(new Error('Tool registration did not settle'))
        }, 5000)
        stop = tools.$subscribe(() => {
          if (tools.tools.length === count) {
            clearTimeout(timeout)
            stop?.()
            resolve()
          }
        }, { flush: 'sync' })
      })
    }
    const registered = nextTools(4)
    capabilities.value = MMD_NATURAL_CAPABILITIES
    await registered
    expect(tools.tools.map(tool => tool.id).sort()).toEqual([...bodyToolIds, 'action:perform_action'].sort())
    const removed = nextTools(0)
    capabilities.value = LIVE2D_NATURAL_CAPABILITIES
    await removed
    expect(tools.tools).toEqual([])
    expect(usePerformanceRuntimeState().exposedActions).toEqual([])
  })

  it('action tools follow the exposed set: add, change, remove, and publish every exposed clip to the runtime state', async () => {
    setActivePinia(createPinia())
    const tools = useLlmToolsStore()
    const runtimeState = usePerformanceRuntimeState()
    const library = ref<ListedAction[]>([])
    const exposedOf = () => library.value.filter(clip => clip.exposed && clip.kind !== 'gesture').map(({ label, kind }) => ({ label, kind: kind as 'action' | 'dance' }))
    const actionPort = ref<ActionToolPort | undefined>({ exposed: exposedOf, perform: async () => ({ success: true }), state: () => ({ performing: null }) })
    const scope = effectScope()
    onTestFinished(() => scope.stop())
    scope.run(() => useStagePerformanceConductor({
      renderer: () => 'mmd',
      scene: () => undefined,
      capabilities: () => MMD_NATURAL_CAPABILITIES,
      expressionBackend: () => undefined,
      actionPort: () => actionPort.value,
      listActions: () => library.value,
      mind: naturalMind({ seed: 7 }),
      mood: () => null,
    }))
    const enumOf = () => (tools.tools.find(tool => tool.id === 'action:perform_action')?.function.parameters as { properties: { action: { enum: string[] } } } | undefined)?.properties.action.enum
    await nextTick()
    expect(tools.tools.filter(tool => tool.id.startsWith('action:'))).toEqual([])

    library.value = [{ label: 'moonwalk', kind: 'dance', exposed: true }, { label: 'wave', kind: 'gesture', exposed: true }, { label: 'bow', kind: 'action', exposed: false }]
    await vi.waitFor(() => expect(enumOf()).toEqual(['moonwalk', 'stop']))
    expect(runtimeState.exposedActions).toEqual([{ label: 'moonwalk', kind: 'dance' }, { label: 'wave', kind: 'gesture' }])

    library.value = library.value.map(clip => ({ ...clip, exposed: true }))
    await vi.waitFor(() => expect(enumOf()).toEqual(['moonwalk', 'bow', 'stop']))

    library.value = [{ label: 'wave', kind: 'gesture', exposed: true }]
    await vi.waitFor(() => expect(tools.tools.filter(tool => tool.id.startsWith('action:'))).toEqual([]))
    expect(runtimeState.exposedActions).toEqual([{ label: 'wave', kind: 'gesture' }])

    library.value = [{ label: 'moonwalk', kind: 'dance', exposed: true }]
    await vi.waitFor(() => expect(enumOf()).toEqual(['moonwalk', 'stop']))
    actionPort.value = undefined
    await vi.waitFor(() => expect(tools.tools.filter(tool => tool.id.startsWith('action:'))).toEqual([]))
  })
})
