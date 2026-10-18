import type { ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'
import type { Component, ComponentInternalInstance, VNode } from 'vue'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { defineComponent, getCurrentInstance, h, isVNode, nextTick, shallowRef, watch } from 'vue'
import { createI18n } from 'vue-i18n'

import { StagePerformanceConductor } from '../../composables/performance/use-stage-performance-conductor'
import { Emotion, EMOTION_EmotionMotionName_value } from '../../constants/emotions'
import { useExpressionPerformanceSettings } from '../../features/performance/settings'
import { useNaturalPerformanceOverride } from '../../stores/natural-performance-override'
import { useSettingsStageModel } from '../../stores/settings/stage-model'

/** Walks the rendered tree under `vnode` for the first instance of `type`, through child components, fragments and slots. */
function findInstance(vnode: VNode | null | undefined, type: Component): ComponentInternalInstance | undefined {
  if (!vnode)
    return undefined
  if (vnode.component) {
    if (vnode.component.type === type)
      return vnode.component
    return findInstance(vnode.component.subTree, type)
  }
  if (!Array.isArray(vnode.children))
    return undefined
  for (const child of vnode.children) {
    const found = isVNode(child) ? findInstance(child, type) : undefined
    if (found)
      return found
  }
  return undefined
}

/** Resolves once `source` satisfies `predicate`. Register it before the action under test; it rejects after 5 s. */
function until<T>(source: () => T, predicate: (value: T) => boolean): Promise<T> {
  if (predicate(source()))
    return Promise.resolve(source())
  return new Promise((resolve, reject) => {
    const signal = AbortSignal.timeout(5000)
    const stop = watch(source, (value) => {
      if (!predicate(value))
        return
      stop()
      resolve(value)
    }, { flush: 'sync' })
    signal.addEventListener('abort', () => {
      stop()
      reject(new Error('The stage did not reach the expected state'))
    })
  })
}

// pixi-live2d-display reads the Cubism core global when it is imported, so the
// Live2D scene and the stage load after the global exists.
let Stage: Component
let live2d: typeof import('@proj-airi/stage-ui-live2d')

beforeAll(async () => {
  Object.assign(window, { Live2DCubismCore: {} })
  live2d = await import('@proj-airi/stage-ui-live2d')
  Stage = (await import('./Stage.vue')).default
})

async function renderStage(driver: 'natural' | 'universal' | 'magic') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useSettingsStageModel().setStageModelRenderer('live2d')
  live2d.useSettingsLive2d().live2dMotionDriver = driver
  const params = live2d.useLive2dParams()
  params.currentMotion = { group: 'Idle', index: 0 }

  // Assigned in the host setup below; the cast keeps TypeScript from narrowing it to `null`.
  let host = null as ComponentInternalInstance | null
  render(defineComponent({
    setup() {
      host = getCurrentInstance()
      return () => h('div', { style: 'width:640px;height:480px' }, [h(Stage)])
    },
  }), {
    global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })] },
  })

  await nextTick()
  const scene = findInstance(host?.subTree, live2d.Live2DScene)!
  // Stage calls the scene through its template ref, which reads the exposed object,
  // so the recorder sees exactly the call the stage makes and still forwards it.
  const exposed = scene.exposed as { setEmotion: (episode: ReactionEpisode) => void }
  const forward = exposed.setEmotion
  const episodes = shallowRef<ReactionEpisode[]>([])
  exposed.setEmotion = (episode) => {
    episodes.value = [...episodes.value, episode]
    forward(episode)
  }
  // Recorded synchronously so a repeated group that replaces an equal value is still counted.
  const motionGroups = shallowRef<string[]>([])
  watch(() => params.currentMotion, (motion) => {
    motionGroups.value = [...motionGroups.value, motion.group]
  }, { flush: 'sync' })

  return { params, scene, episodes, motionGroups, override: useNaturalPerformanceOverride() }
}

describe('stage emotion routing on Live2D', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('hands a lab emotion to the Natural scene as a banded episode and leaves the motion group alone', async () => {
    const emotion = vi.spyOn(StagePerformanceConductor.prototype, 'emotion')
    const { params, episodes, override } = await renderStage('natural')

    const delivered = until(() => episodes.value.length, count => count === 1)
    override.pulseEmotion('happy', 0.7)

    await delivered
    expect(emotion).toHaveBeenCalledWith(Emotion.Happy, 0.7, 'devtools', undefined)
    expect(episodes.value).toEqual([{
      id: expect.any(String),
      emotion: Emotion.Happy,
      nominal: 0.7,
      // Jitter moves the intensity by at most 0.04 inside the clear band.
      intensity: expect.closeTo(0.7, 1),
      band: 'clear',
      escalation: false,
    }])
    expect(params.currentMotion).toEqual({ group: 'Idle', index: 0 })
  })

  it.each(['universal', 'magic'] as const)('plays a motion group for every emotion under %s, repeats and neutral included', async (driver) => {
    const { episodes, motionGroups, override } = await renderStage(driver)

    // The stage watches the pulse sequence, so each pulse waits for the previous one to land.
    // The repeat arrives well inside the 2 s window in which the reaction tracker drops it.
    for (const [index, name] of ['happy', 'happy', 'neutral'].entries()) {
      const played = until(() => motionGroups.value.length, count => count === index + 1)
      override.pulseEmotion(name, 0.7)
      await played
    }

    expect(motionGroups.value).toEqual([
      EMOTION_EmotionMotionName_value[Emotion.Happy],
      EMOTION_EmotionMotionName_value[Emotion.Happy],
      EMOTION_EmotionMotionName_value[Emotion.Neutral],
    ])
    expect(episodes.value).toEqual([])
  })

  it('passes the performance settings document to the Live2D scene', async () => {
    const { scene } = await renderStage('natural')

    expect(scene.props.performanceSettings).toMatchObject({ bands: true })
    const received = until(() => (scene.props.performanceSettings as { bands: boolean }).bands, bands => !bands)
    await useExpressionPerformanceSettings().update({ bands: false })

    expect(await received).toBe(false)
  })
})
