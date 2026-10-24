import type { AffectSignal, AffectTrace, CatalogEntry, ExpressionPerformanceSettings, PerformanceProfile, SlotCommand, TimingEvent } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DMotionDriver } from '@proj-airi/stage-ui-live2d'

import type { StagePerformanceScene } from './use-stage-performance-conductor'

import { createDecider, createPickerDecider, defaultExpressionPerformanceSettings, parseAffectTrace, parseExpressionPerformanceSettings, replayAffectTrace } from '@proj-airi/stage-shared/expression-performance'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useLlmToolsStore } from '../../stores/ai/chat-llm/tools'
import { createExpressionToolPort, createExpressionToolRegistration, expressionToolIds, maxAffectTraceEntries, StagePerformanceConductor, toExposedExpressions } from './use-stage-performance-conductor'

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
  }
}

function createConductor(driver: Live2DMotionDriver, scene: StagePerformanceScene = fakeScene(), settings: ExpressionPerformanceSettings = defaultExpressionPerformanceSettings, profile?: PerformanceProfile, entries: readonly CatalogEntry[] = catalog) {
  let now = 10
  const playMotion = vi.fn<(group: string) => void>()
  const conductor = new StagePerformanceConductor({
    scene: () => scene,
    driver: () => driver,
    playMotion,
    settings: () => settings,
    catalog: () => entries,
    seed: 7,
    clock: () => now,
    profile: () => profile,
    modelId: () => 'rig',
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

  it('plays the fallback motion group for love, flustered, and sleepy under Universal', () => {
    // Non-Natural drivers play the group unconditionally, so no clock advance is needed.
    const { conductor, playMotion } = createConductor('universal')

    for (const emotion of ['love', 'flustered', 'sleepy'])
      conductor.emotion(emotion, 0.6, 'act', 'turn-a')

    expect(playMotion.mock.calls).toEqual([['Happy'], ['Awkward'], ['Idle']])
  })

  it.each(['universal', 'magic'] as const)('skips the emotion motion group under %s when an ACT already played its motion, and still applies slots', (driver) => {
    const scene = fakeScene()
    const { conductor, playMotion } = createConductor(driver, scene)

    conductor.emotion('happy', 0.6, 'act', 'turn-a', { suppressMotionGroup: true })

    expect(playMotion).not.toHaveBeenCalled()
    expect(scene.applySlots.mock.calls.flatMap(([commands]) => commands)).toEqual([
      expect.objectContaining({ expressionId: 'joy', turnId: 'turn-a' }),
    ])
  })

  it('keeps the Natural episode and hold when an ACT already played its motion', () => {
    const scene = fakeScene()
    const { conductor, playMotion } = createConductor('natural', scene)

    conductor.emotion('happy', 0.6, 'act', 'turn-a', { suppressMotionGroup: true })

    expect(playMotion).not.toHaveBeenCalled()
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

  describe('combos', () => {
    const combo = entry('pair', 'combo', [], { label: 'Pair', exposedToLlm: true, slots: ['face', 'effect'], fileName: '', parameterIds: [] })
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
        driver: () => 'natural',
        playMotion: () => {},
        settings: () => defaultExpressionPerformanceSettings,
        catalog: () => catalog,
        seed: 7,
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

    it.each(['universal', 'magic'] as const)('dispatches no holds or episodes under %s', (driver) => {
      const scene = fakeScene()
      const { conductor } = createConductor(driver, scene, defaultExpressionPerformanceSettings, undefined, heldCatalog)

      conductor.expression('Rage', undefined, 'act', 'turn-a')
      conductor.emotion('angry', 0.6, 'act', 'turn-a')

      expect(scene.applyHolds).not.toHaveBeenCalled()
      expect(scene.setEmotion).not.toHaveBeenCalled()
    })

    it.each(['universal', 'magic'] as const)('keeps the held-emotion-free slot history under %s after a mapped expression', (driver) => {
      const run = (settings: ExpressionPerformanceSettings) => {
        const scene = fakeScene()
        const { conductor, advance } = createConductor(driver, scene, settings, undefined, heldCatalog)
        conductor.expression('Rage', 5, 'act', 'turn-a')
        advance(1)
        conductor.emotion('angry', 0.6, 'act', 'turn-a')
        advance(3)
        conductor.emotion('angry', 0.9, 'act', 'turn-a')
        return scene.applySlots.mock.calls.map(([commands]) => commands)
      }

      const base = run({ ...defaultExpressionPerformanceSettings, heldEmotions: false })
      expect(run(defaultExpressionPerformanceSettings)).toEqual(base)
      // The sequence does drive slots, so equality is not vacuous.
      expect(base.length).toBeGreaterThan(1)
      expect(defaultExpressionPerformanceSettings.heldEmotions).toBe(true)
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

    it('dispatches the holds of a deferred timing decision', () => {
      const picker = createPickerDecider()
      const hold = { emotion: 'happy' as const, strength: 0.6, holdSeconds: 1, until: 'speech' as const, turnId: 'turn-a' }
      vi.mocked(createDecider).mockReturnValueOnce({
        ...picker,
        decide: (signal, ctx, state) => {
          const result = picker.decide(signal, ctx, state)
          return signal.kind === 'timing' ? { ...result, decision: { ...result.decision, holds: [hold] } } : result
        },
      })
      const scene = fakeScene()
      const { conductor } = createConductor('natural', scene)

      conductor.clipStart('turn-a', 'clip-1', true)

      expect(scene.applyHolds.mock.calls).toEqual([[[hold], 10]])
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
        driver: () => 'natural',
        playMotion: () => {},
        settings: () => defaultExpressionPerformanceSettings,
        catalog: () => catalog,
        seed: 7,
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
      expect(new Set(trace.entries.flatMap(entry => entry.type === 'signal' ? [entry.signal.kind] : []))).toEqual(new Set(['emotion', 'expression', 'clear', 'speech', 'timing']))
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
        { type: 'signal', signal: expect.objectContaining({ kind: 'emotion', nominal: expect.closeTo(0.9) }) },
      ])
    })

    it('gives each Natural episode the mood gain of the profile its signal was decided under', () => {
      const scene = fakeScene()
      let now = 10
      const conductor = new StagePerformanceConductor({
        scene: () => scene,
        driver: () => 'natural',
        playMotion: () => {},
        settings: () => defaultExpressionPerformanceSettings,
        catalog: () => catalog,
        seed: 7,
        clock: () => now,
        profile: turnId => turnId === 'turn-a' ? { moodGainScale: 0 } : turnId === 'turn-b' ? { moodGainScale: 2 } : undefined,
      })
      const gains = defaultExpressionPerformanceSettings.moodDynamics

      conductor.emotion('angry', 0.6, 'act', 'turn-a')
      now += 3
      conductor.emotion('sad', 0.9, 'act', 'turn-b')
      now += 3
      conductor.emotion('happy', 0.6, 'devtools')

      expect(scene.setEmotion.mock.calls.map(([episode]) => [episode.emotion, episode.band, episode.moodGain])).toEqual([
        ['angry', 'clear', 0],
        ['sad', 'strong', 2 * gains.strongGain],
        ['happy', 'clear', gains.clearGain],
      ])
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
        driver: () => 'natural',
        playMotion: () => {},
        settings: () => settings,
        catalog: () => catalog,
        seed: 7,
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
})
