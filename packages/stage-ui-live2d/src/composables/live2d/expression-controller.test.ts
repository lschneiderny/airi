import type { PixiLive2DInternalModel } from './motion-manager'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import { useExpressionStore } from '../../stores/expression-store'
import { useExpressionController } from './expression-controller'

describe('useExpressionController', () => {
  let now = 0
  let storage: Map<string, string>

  beforeEach(() => {
    setActivePinia(createPinia())
    now = 0
    storage = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.spyOn(performance, 'now').mockImplementation(() => now * 1000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function rig() {
    const values = new Map<string, number>()
    const core = {
      getParameterValueById: (id: string) => values.get(id) ?? 0,
      setParameterValueById: (id: string, value: number) => values.set(id, value),
      getParameterIndex: () => 0,
      getParameterMinimumValue: () => -10,
      getParameterMaximumValue: () => 10,
    }
    const modelFixture: unknown = { coreModel: core }
    const controller = useExpressionController({
      internalModel: shallowRef(modelFixture as PixiLive2DInternalModel),
    })
    const coreFixture: unknown = core
    const modelCore = coreFixture as PixiLive2DInternalModel['coreModel']
    const frame = () => {
      controller.restoreExpressionBases(modelCore)
      controller.applyExpressions(modelCore)
    }
    return { controller, core, frame, store: useExpressionStore() }
  }

  const archive = [
    { name: 'game', fileName: 'model/game.exp3.json', data: { FadeInTime: 0, FadeOutTime: 0, Parameters: [{ Id: 'Param2', Value: 1, Blend: 'Add' }] } },
    { name: 'eat', fileName: 'model/eat.exp3.json', data: { FadeInTime: 0, FadeOutTime: 0, Parameters: [{ Id: 'Param2', Value: 0, Blend: 'Add' }, { Id: 'Param4', Value: 1, Blend: 'Add' }] } },
  ]

  it('forwards display names to derivation', async () => {
    const { controller, store } = rig()
    await controller.initialise('model', [], async () => '', [{
      name: 'expression1',
      fileName: 'expression1.exp3.json',
      data: { Parameters: [{ Id: 'opaque', Value: 1 }] },
    }], path => path, undefined, { Parameters: [{ Id: 'opaque', Name: '鼓脸' }] })
    expect(store.catalog[0]).toMatchObject({ kind: 'face', area: 'cheeks', labelSource: 'file' })
  })

  it('forwards model parameter ids and filters exp3 writes from offered free switches', async () => {
    const { controller, store } = rig()
    storage.set('expression-catalog:model', JSON.stringify({
      version: 1,
      overrides: [],
      customs: [{ id: 'custom:old', label: 'Old switch', kind: 'prop', parameterId: 'driven', delta: 0.5, mappings: [], exposedToLlm: true }],
    }))
    const parameter = (id: string) => ({ id, name: id, min: 0, max: 1, default: 0 })
    await controller.initialise('model', [], async () => '', archive, path => path, undefined, undefined, ['Param2', 'Param4', 'free', 'driven'], ['Param2', 'Param4', 'free'].map(parameter))
    expect(store.settingsSnapshot.freeParameters).toEqual([parameter('free')])
    expect(store.definitions.at(-1)).toEqual({ id: 'custom:old', name: 'Old switch', parameters: [{ id: 'driven', value: 0.5, blend: 'Add' }] })
  })

  it('registers unreferenced archive expressions and gives referenced names precedence without fetching', async () => {
    const { controller, store } = rig()
    const read = vi.fn(async () => '')
    await controller.initialise('model', [{ Name: 'Game prop', File: 'game.exp3.json' }], read, archive, path => `model/${path}`)
    expect(store.settingsSnapshot.entries).toMatchObject([
      { id: 'model/game.exp3.json', name: 'Game prop', active: false },
      { id: 'model/eat.exp3.json', name: 'eat', active: false },
    ])
    expect(read).not.toHaveBeenCalled()
    // The model3.json is in model/: its refs must match archive-relative ids.
    expect(store.catalog[0].label).toBe('Game prop')
    expect(store.catalog[0].kind).toBe('prop')
  })

  it('keeps A when B activates with Add zero on the shared parameter', async () => {
    const { controller, store, core, frame } = rig()
    await controller.initialise('model', [], async () => '', archive)
    store.updateEntry(archive[1].fileName, { group: null })
    store.toggle(archive[0].fileName)
    frame()
    expect(core.getParameterValueById('Param2')).toBe(1)
    store.toggle(archive[1].fileName)
    frame()
    expect(core.getParameterValueById('Param2')).toBe(1)
    expect(core.getParameterValueById('Param4')).toBe(1)
  })

  it('normalizes model3 refs from a subfolder before deriving catalog labels', async () => {
    const { controller, store } = rig()
    const model3 = {
      url: 'models/avatar/model3.json',
      FileReferences: { Expressions: [{ Name: 'Model-defined face', File: '../expressions/smile.exp3.json' }] },
    }
    const file = { ...archive[0], fileName: 'models/expressions/smile.exp3.json' }
    await controller.initialise('nested', model3.FileReferences.Expressions, async () => '', [file], (path) => {
      const base = new URL(model3.url, 'https://archive.invalid/')
      return new URL(path, base).pathname.slice(1)
    })
    expect(store.catalog[0].id).toBe('models/expressions/smile.exp3.json')
    expect(store.catalog[0].label).toBe('Model-defined face')
  })

  it('does not reset A when B releases the shared parameter', async () => {
    const { controller, store, core, frame } = rig()
    await controller.initialise('model', [], async () => '', archive)
    store.updateEntry(archive[1].fileName, { group: null })
    store.activate(archive[0].fileName)
    store.activate(archive[1].fileName)
    frame()
    store.deactivate(archive[1].fileName)
    frame()
    expect(core.getParameterValueById('Param2')).toBe(1)
    expect(core.getParameterValueById('Param4')).toBe(0)
  })

  it('resets to the saved rest set and reloads it per model', async () => {
    const { controller, store } = rig()
    await controller.initialise('model', [], async () => '', archive)
    store.activate(archive[0].fileName)
    store.saveDefaults()
    store.deactivate(archive[0].fileName)
    store.activate(archive[1].fileName)
    store.resetAll()
    expect(store.manualActive).toEqual([archive[0].fileName])
    expect(JSON.parse(storage.get('expression-rest:model')!)).toEqual({ version: 1, active: [archive[0].fileName] })
    await controller.initialise('another-model', [], async () => '', archive)
    expect(store.manualActive).toEqual([])
    await controller.initialise('model', [], async () => '', archive)
    expect(store.manualActive).toEqual([archive[0].fileName])
  })

  it('ignores the old defaults key', async () => {
    storage.set('expression-defaults:model', JSON.stringify({ Param2: 1 }))
    const { controller, store } = rig()
    await controller.initialise('model', [], async () => '', archive)
    expect(store.restSet).toEqual([])
    expect(store.manualActive).toEqual([])
  })

  it('does not publish an obsolete asynchronous load after a newer registration', async () => {
    const { controller, store } = rig()
    let complete!: (text: string) => void
    const pendingFile = new Promise<string>((resolve) => {
      complete = resolve
    })
    const pendingLoad = controller.initialise('old', [{ Name: 'Old', File: 'old.exp3.json' }], () => pendingFile)
    await controller.initialise('new', [], async () => '', archive)
    complete(JSON.stringify(archive[0].data))
    await pendingLoad
    expect(store.modelId).toBe('new')
    expect(store.definitions.map(definition => definition.id)).toEqual(archive.map(file => file.fileName))
  })

  it.each(['{broken', '{"version":1,"active":[42]}'])('discards invalid stored rest sets: %s', async (raw) => {
    storage.set('expression-rest:model', raw)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { controller, store } = rig()
    await controller.initialise('model', [], async () => '', archive)
    expect(store.restSet).toEqual([])
    expect(warning).toHaveBeenCalled()
  })

  it('rejects an exp3 file whose parameter value is not a number and never writes NaN', async () => {
    const { controller, store, core, frame } = rig()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = { name: 'bad', fileName: 'model/bad.exp3.json', data: { FadeInTime: 0, Parameters: [{ Id: 'ParamX', Value: 'bad', Blend: 'Add' }] } }
    await controller.initialise('model', [], async () => '', [bad, archive[0]])
    expect(store.definitions.map(definition => definition.id)).toEqual([archive[0].fileName])
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(bad.fileName), expect.any(String))
    store.activate(bad.fileName)
    store.activate(archive[0].fileName)
    frame()
    expect(Number.isNaN(core.getParameterValueById('ParamX'))).toBe(false)
    expect(core.getParameterValueById('Param2')).toBe(1)
  })

  it('uses a one-second fade when FadeInTime is missing', async () => {
    const { controller, store, core, frame } = rig()
    await controller.initialise('model', [], async () => '', [{
      ...archive[0],
      data: { Parameters: [{ Id: 'Param2', Value: 1, Blend: 'Add' }] },
    }])
    store.activate(archive[0].fileName)
    now = 0.5
    frame()
    expect(core.getParameterValueById('Param2')).toBeCloseTo(0.5)
  })

  it('restores the clean core values when the expression system is disposed', async () => {
    const { controller, store, core, frame } = rig()
    await controller.initialise('model', [], async () => '', archive)
    store.activate(archive[0].fileName)
    frame()
    expect(core.getParameterValueById('Param2')).toBe(1)
    controller.dispose()
    expect(core.getParameterValueById('Param2')).toBe(0)
    expect(store.definitions).toEqual([])
  })

  it('registers expressions with the identity of each loaded model', async () => {
    // A reused controller must scope persistence to each completed model load,
    // rather than retaining the model identity from component setup.
    setActivePinia(createPinia())

    const modelFixture: unknown = {
      coreModel: {
        getParameterDefaultValueById: () => 0,
      },
    }
    const internalModel = shallowRef(modelFixture as PixiLive2DInternalModel)
    const controller = useExpressionController({ internalModel })
    const expressionStore = useExpressionStore()
    const expressionRefs = [{ Name: 'Happy', File: 'happy.exp3.json' }]
    const readExpFile = async () => JSON.stringify({
      Type: 'Live2D Expression',
      Parameters: [{ Id: 'ParamMouthForm', Value: 1, Blend: 'Add' }],
    })

    await controller.initialise('model-a', expressionRefs, readExpFile)
    expect(expressionStore.modelId).toBe('model-a')

    await controller.initialise('model-b', expressionRefs, readExpFile)
    expect(expressionStore.modelId).toBe('model-b')
  })
})
