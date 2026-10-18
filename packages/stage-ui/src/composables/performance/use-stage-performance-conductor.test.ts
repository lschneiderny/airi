import type { CatalogEntry, ExpressionPerformanceSettings, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DMotionDriver } from '@proj-airi/stage-ui-live2d'

import type { StagePerformanceScene } from './use-stage-performance-conductor'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StagePerformanceConductor } from './use-stage-performance-conductor'

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
})
