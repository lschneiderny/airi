import type { ResolvedMMDModel } from '@proj-airi/stage-ui-mmd/utils/mmd-loader'
import type { ComponentInternalInstance } from 'vue'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { MMDScene } from '@proj-airi/stage-ui-mmd'
import { useMMD, useMMDExpressionStore } from '@proj-airi/stage-ui-mmd/stores'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { defineComponent, getCurrentInstance, h, ref, watch } from 'vue'

import { loadMMDModelFromSource } from '../../../../stage-ui-mmd/src/utils/mmd-loader'

/** PMX 2.0: one skinned triangle, one bone, one material and one vertex morph. No external assets. */
function modelBlob(morphName: string) {
  const buffer = new ArrayBuffer(1024)
  const view = new DataView(buffer)
  let offset = 0
  const byte = (value: number) => view.setUint8(offset++, value)
  const int = (value: number) => {
    view.setInt32(offset, value, true)
    offset += 4
  }
  const floats = (...values: number[]) => {
    for (const value of values) {
      view.setFloat32(offset, value, true)
      offset += 4
    }
  }
  const text = (value: string) => {
    const bytes = new TextEncoder().encode(value)
    int(bytes.length)
    new Uint8Array(buffer, offset, bytes.length).set(bytes)
    offset += bytes.length
  }
  // UTF-8, no additional UVs, one-byte indices throughout.
  ;[0x50, 0x4D, 0x58, 0x20].forEach(byte)
  floats(2)
  ;[8, 1, 0, 1, 1, 1, 1, 1, 1].forEach(byte)
  ;[morphName, '', '', ''].forEach(text)
  int(3)
  for (const position of [[0, 1, 0], [-1, -1, 0], [1, -1, 0]]) {
    floats(...position, 0, 0, 1, 0, 0)
    byte(0) // BDEF1, root bone.
    byte(0)
    floats(1)
  }
  int(3)
  ;[0, 1, 2].forEach(byte)
  int(0) // Textures.
  int(1) // Material.
  text('surface')
  text('')
  floats(1, 1, 1, 1, 0, 0, 0, 1, 0.5, 0.5, 0.5)
  byte(1) // Double-sided.
  floats(0, 0, 0, 1, 0)
  ;[255, 255, 0, 1, 0].forEach(byte) // No maps; shared toon 0.
  text('')
  int(3)
  int(1) // Bone.
  text('root')
  text('')
  floats(0, 0, 0)
  byte(255)
  int(0)
  byte(0)
  byte(0)
  floats(0, 1, 0)
  int(1) // Vertex morph.
  text(morphName)
  text('')
  byte(4)
  byte(1)
  int(1)
  byte(0)
  floats(0.5, 0, 0)
  int(0) // Display frames.
  int(0) // Rigid bodies.
  int(0) // Joints.
  return new Blob([buffer.slice(0, offset)], { type: 'application/octet-stream' })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderLifecycleScene(pinia: ReturnType<typeof createPinia>) {
  let host: ComponentInternalInstance | null = null
  const rendered = render(defineComponent({
    setup() {
      host = getCurrentInstance()
      return () => h(MMDScene, { style: 'width:640px;height:480px' })
    },
  }), { global: { plugins: [pinia] } })
  // Observe the real scene and lifecycle, without adding a production debug expose.
  const state = () => (host!.subTree.component as ComponentInternalInstance & {
    setupState: {
      loadModel: (src: string) => Promise<void>
      scene: { children: { type: string, children: object[] }[] }
      animation: import('@proj-airi/stage-ui-mmd/composables/mmd').MMDAnimationManager
      morphRuntime: ReturnType<typeof import('../../../../stage-ui-mmd/src/composables/mmd/morph-runtime').createMMDMorphRuntime>
    }
  }).setupState
  return { rendered, state }
}

it.each([2, 3])('keeps one scene group and runtime after %i overlapping loads finish out of order', async (count) => {
  const pinia = createPinia()
  setActivePinia(pinia)
  useMMD().physicsEnabled = false
  const expressions = useMMDExpressionStore()
  const register = vi.spyOn(expressions, 'registerMorphs')
  const urls = Array.from({ length: count }, (_, i) => URL.createObjectURL(modelBlob(`overlap-${i}`)))
  const exemplar = await loadMMDModelFromSource(urls[0])
  const runtimePrototype: ResolvedMMDModel['mmd'] = Object.getPrototypeOf(exemplar.mmd)
  const runtimeDispose = vi.spyOn(runtimePrototype, 'dispose')
  const geometryPrototype: ResolvedMMDModel['mesh']['geometry'] = Object.getPrototypeOf(exemplar.mesh.geometry)
  const geometryDispose = vi.spyOn(geometryPrototype, 'dispose')
  const skeletonPrototype: ResolvedMMDModel['mesh']['skeleton'] = Object.getPrototypeOf(exemplar.mesh.skeleton)
  const skeletonDispose = vi.spyOn(skeletonPrototype, 'dispose')
  const gates = urls.map(() => deferred<Response>())
  const responses = await Promise.all(urls.map(url => fetch(url)))
  const originalFetch = window.fetch.bind(window)
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const index = urls.indexOf(String(input))
    return index < 0 ? originalFetch(input, init) : gates[index].promise
  })

  const { rendered, state } = renderLifecycleScene(pinia)
  try {
    // All loads start before any loader promise resolves.
    const loads = urls.map(url => state().loadModel(url))
    const latest = count - 1
    gates[latest].resolve(responses[latest])
    await loads[latest]
    const animation = state().animation
    const morphRuntime = state().morphRuntime
    const pipelineDispose = vi.spyOn(animation.pipeline, 'dispose')
    const reset = vi.spyOn(morphRuntime!, 'resetToBase')
    for (let i = 0; i < latest; i++) {
      gates[i].resolve(responses[i])
      await loads[i]
    }

    const groups = state().scene.children.filter(child => child.type === 'Group')
    expect(groups).toHaveLength(1)
    expect(state().animation).toBe(animation)
    expect(state().morphRuntime).toBe(morphRuntime)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][2]).toBe(morphRuntime)
    expect(expressions.modelId).toBe(urls[latest])
    expect(runtimeDispose).toHaveBeenCalledTimes(latest)
    expect(geometryDispose).toHaveBeenCalledTimes(latest)
    expect(skeletonDispose).toHaveBeenCalledTimes(latest)
    expect(runtimeDispose.mock.contexts).toEqual(
      Array.from({ length: latest }, (_, i) => expect.objectContaining({
        mesh: expect.objectContaining({ morphTargetDictionary: { [`overlap-${i}`]: 0 } }),
      })),
    )
    expect(pipelineDispose).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()
    rendered.unmount()
    expect(pipelineDispose).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledTimes(1)
    expect(expressions.modelId).toBe('')
    expect(runtimeDispose).toHaveBeenCalledTimes(count)
    expect(geometryDispose).toHaveBeenCalledTimes(count)
    expect(skeletonDispose).toHaveBeenCalledTimes(count)
  }
  finally {
    rendered.unmount()
    exemplar.mmd.dispose()
    exemplar.mesh.geometry.dispose()
    disposePinia(pinia)
    for (const url of urls)
      URL.revokeObjectURL(url)
  }
})

it('detaches the superseded pipeline and morph runtime while physics initializes', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  useMMD().physicsEnabled = false
  const expressions = useMMDExpressionStore()
  const registered = deferred<void>()
  const registerMorphs = expressions.registerMorphs
  vi.spyOn(expressions, 'registerMorphs').mockImplementationOnce((...args) => {
    registerMorphs(...args)
    registered.resolve()
  })
  const urls = ['initializing', 'latest'].map(name => URL.createObjectURL(modelBlob(name)))
  const { rendered, state } = renderLifecycleScene(pinia)
  try {
    const first = state().loadModel(urls[0])
    await registered.promise
    const oldAnimation = state().animation
    const oldRuntime = state().morphRuntime
    const pipelineDispose = vi.spyOn(oldAnimation.pipeline, 'dispose')
    const reset = vi.spyOn(oldRuntime, 'resetToBase')
    const clear = vi.spyOn(oldRuntime, 'clearChannel')
    expressions.applySlots([{ slot: 'face', expressionId: 'mmd:0:initializing', holdSeconds: 10, until: 'hold' }], 0)
    expressions.update(1)

    const second = state().loadModel(urls[1])
    await Promise.all([first, second])

    expect(state().scene.children.filter(child => child.type === 'Group')).toHaveLength(1)
    expect(pipelineDispose).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledWith('expression', 'initializing')
    expect(oldAnimation.pipeline.poseStages).toEqual([])
    expect(oldAnimation.pipeline.surfaceStages).toEqual([])
    expect(state().animation).not.toBe(oldAnimation)
    expect(state().morphRuntime).not.toBe(oldRuntime)
    expect(expressions.modelId).toBe(urls[1])
    expect(expressions.leases.face).toBeNull()
  }
  finally {
    rendered.unmount()
    disposePinia(pinia)
    urls.forEach(url => URL.revokeObjectURL(url))
  }
})

it.each(['unmount', 'reject'] as const)('ignores a pending load after %s without reviving or clearing the scene', async (ending) => {
  const pinia = createPinia()
  setActivePinia(pinia)
  useMMD().physicsEnabled = false
  const expressions = useMMDExpressionStore()
  const register = vi.spyOn(expressions, 'registerMorphs')
  const urls = ['pending', 'current'].map(name => URL.createObjectURL(modelBlob(name)))
  const response = await fetch(urls[0])
  const pending = deferred<Response>()
  const fetchOriginal = window.fetch.bind(window)
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => String(input) === urls[0] ? pending.promise : fetchOriginal(input, init))
  const { rendered, state } = renderLifecycleScene(pinia)
  const scene = state().scene
  try {
    const first = state().loadModel(urls[0])
    if (ending === 'unmount') {
      rendered.unmount()
      pending.resolve(response)
    }
    else {
      await state().loadModel(urls[1])
      pending.reject(new Error('superseded network failure'))
    }
    await first

    expect(scene.children.filter(child => child.type === 'Group')).toHaveLength(ending === 'unmount' ? 0 : 1)
    expect(register).toHaveBeenCalledTimes(ending === 'unmount' ? 0 : 1)
    expect(expressions.modelId).toBe(ending === 'unmount' ? '' : urls[1])
  }
  finally {
    rendered.unmount()
    disposePinia(pinia)
    urls.forEach(url => URL.revokeObjectURL(url))
  }
})

it('loads, advances and detaches expression channels through the MMD scene frame loop', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const expressions = useMMDExpressionStore()
  const register = vi.spyOn(expressions, 'registerMorphs')
  const firstUrl = URL.createObjectURL(modelBlob('qa-face'))
  const secondUrl = URL.createObjectURL(modelBlob('qa-next'))
  useMMD().physicsEnabled = false

  // RAF is the only controlled boundary. Loader, store, renderer, pipeline and morph runtime stay real.
  let nextFrame = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => frames.delete(id))
  function step(now: number) {
    const callbacks = [...frames.values()]
    frames.clear()
    expect(callbacks).not.toHaveLength(0)
    for (const callback of callbacks)
      callback(now)
  }

  const modelId = ref('qa-first')
  const modelSrc = ref(firstUrl)
  const phase = ref<'pending' | 'loading' | 'mounted'>('pending')
  function nextMount() {
    return new Promise<void>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout>
      const stop = watch(phase, (value) => {
        if (value === 'mounted') {
          clearTimeout(timeout)
          stop()
          resolve()
        }
      }, { flush: 'sync' })
      timeout = setTimeout(() => {
        stop()
        reject(new Error('MMD scene did not mount the fixture'))
      }, 5000)
    })
  }
  let host = null as ComponentInternalInstance | null
  const mounted = nextMount()
  const rendered = render(defineComponent({
    setup() {
      host = getCurrentInstance()
      return () => h(MMDScene, {
        'style': 'width:640px;height:480px',
        'modelId': modelId.value,
        'modelSrc': modelSrc.value,
        'state': phase.value,
        'onUpdate:state': (value: typeof phase.value) => phase.value = value,
        'performanceSettings': {
          ...defaultExpressionPerformanceSettings,
          slots: { ...defaultExpressionPerformanceSettings.slots, defaultFadeSeconds: 0.1 },
        },
      })
    },
  }), { global: { plugins: [pinia] } })
  // Read the real loader-owned mesh without adding a test-only production expose.
  const mesh = () => (host!.subTree.component as ComponentInternalInstance & { setupState: { mesh: ResolvedMMDModel['mesh'] } }).setupState.mesh

  try {
    await mounted
    expect(register).toHaveBeenCalledTimes(1)
    expect(expressions.modelId).toBe('qa-first')
    expect(expressions.catalog.map(entry => entry.id)).toEqual(['mmd:0:qa-face'])
    const firstMesh = mesh()
    const firstSink = register.mock.calls[0][2]!
    const firstChannel = vi.spyOn(firstSink, 'setChannel')
    const firstClear = vi.spyOn(firstSink, 'clearChannel')
    const start = performance.now()
    expressions.applySlots([{ slot: 'face', expressionId: 'mmd:0:qa-face', holdSeconds: 10, until: 'hold' }], start / 1000)
    step(start + 50)
    expect(firstChannel).toHaveBeenLastCalledWith('expression', 'qa-face', expect.closeTo(0.5, 5))
    expect(firstMesh.morphTargetInfluences![0]).toBeCloseTo(0.5, 5)
    step(start + 150)
    expect(firstChannel).toHaveBeenLastCalledWith('expression', 'qa-face', 1)
    expect(firstMesh.morphTargetInfluences![0]).toBe(1)

    const firstBoneTexture = firstMesh.skeleton.boneTexture
    if (!firstBoneTexture)
      throw new Error('Rendered MMD fixture must allocate a bone texture')
    const firstBoneTextureDispose = vi.spyOn(firstBoneTexture, 'dispose')
    const switched = nextMount()
    modelId.value = 'qa-second'
    modelSrc.value = secondUrl
    await switched
    expect(firstBoneTextureDispose).toHaveBeenCalledTimes(1)
    expect(firstMesh.skeleton.boneTexture).toBeNull()
    expect(register).toHaveBeenCalledTimes(2)
    expect(firstClear).toHaveBeenCalledWith('expression', 'qa-face')
    expect(firstMesh.morphTargetInfluences![0]).toBe(0)
    expect(expressions.modelId).toBe('qa-second')
    expect(expressions.catalog.map(entry => entry.id)).toEqual(['mmd:0:qa-next'])
    expect(expressions.leases.face).toBeNull()
    firstChannel.mockClear()
    const secondMesh = mesh()
    const secondSink = register.mock.calls[1][2]!
    const secondChannel = vi.spyOn(secondSink, 'setChannel')
    const secondClear = vi.spyOn(secondSink, 'clearChannel')
    const switchedAt = performance.now()
    expressions.applySlots([{ slot: 'face', expressionId: 'mmd:0:qa-next', holdSeconds: 10, until: 'hold' }], switchedAt / 1000)
    step(switchedAt + 150)
    expect(secondChannel).toHaveBeenLastCalledWith('expression', 'qa-next', 1)
    expect(secondMesh.morphTargetInfluences![0]).toBe(1)
    expect(firstChannel).not.toHaveBeenCalled()
    expect(firstMesh.morphTargetInfluences![0]).toBe(0)

    const secondBoneTexture = secondMesh.skeleton.boneTexture
    if (!secondBoneTexture)
      throw new Error('Rendered replacement must allocate a bone texture')
    const secondBoneTextureDispose = vi.spyOn(secondBoneTexture, 'dispose')
    rendered.unmount()
    expect(secondBoneTextureDispose).toHaveBeenCalledTimes(1)
    expect(secondMesh.skeleton.boneTexture).toBeNull()
    expect(secondClear).toHaveBeenCalledWith('expression', 'qa-next')
    expect(secondMesh.morphTargetInfluences![0]).toBe(0)
    expect(expressions.modelId).toBe('')
    expect(expressions.catalog).toEqual([])
    expect(expressions.leases).toEqual({ face: null, effect: null, prop: null })
    expect(frames.size).toBe(0)
  }
  finally {
    rendered.unmount()
    disposePinia(pinia)
    URL.revokeObjectURL(firstUrl)
    URL.revokeObjectURL(secondUrl)
  }
})
