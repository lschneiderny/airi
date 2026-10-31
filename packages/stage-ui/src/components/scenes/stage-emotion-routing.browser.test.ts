import type { NaturalEpisode } from '@proj-airi/motion-driver-natural/mood'
import type { GenerationProvider } from '@proj-airi/provider-inference'
import type { ExpressionPerformanceSettings, ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'
import type { Component, ComponentInternalInstance, VNode } from 'vue'

import type { StagePerformanceScene } from '../../composables/performance/use-stage-performance-conductor'

import { NaturalMotion } from '@proj-airi/motion-driver-natural'
import { presenceBubbleIdle, presenceBubbleThinking } from '@proj-airi/stage-shared'
import { createPickerDecider, defaultExpressionPerformanceSettings, replayAffectTrace } from '@proj-airi/stage-shared/expression-performance'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { defineComponent, getCurrentInstance, h, isVNode, nextTick, shallowRef, watch } from 'vue'
import { createI18n } from 'vue-i18n'

import { StagePerformanceConductor, useStagePerformanceConductor } from '../../composables/performance/use-stage-performance-conductor'
import { Emotion, EMOTION_EmotionMotionName_value, EmotionThinkMotionName } from '../../constants/emotions'
import { useExpressionPerformanceSettings } from '../../features/performance/settings'
import { useLLM } from '../../stores/ai/chat-llm/llm'
import { useLlmStreamingControlStore } from '../../stores/ai/chat-llm/streaming-control'
import { useChatStore } from '../../stores/chat'
import { useChatSessionStore } from '../../stores/chat/session-store'
import { useChatStreamStore } from '../../stores/chat/stream-store'
import { useAiriCardStore } from '../../stores/modules/airi-card'
import { useConsciousnessStore } from '../../stores/modules/consciousness'
import { useNaturalPerformanceOverride } from '../../stores/natural-performance-override'
import { useSettingsStageModel } from '../../stores/settings/stage-model'
import { ChatHistory } from '../scenarios/chat'

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

/** The loader the chat history shows for an assistant reply that has no text yet. */
const streamingPlaceholder = '[i-eos-icons\\:three-dots-loading]'

/**
 * Lets the real chat store send through a fake provider. Each request stays open until it is aborted or released.
 * Call it after `renderStage`, then wait on `requests` to see a request reach the provider.
 */
async function holdProviderRequests() {
  const cards = useAiriCardStore()
  await cards.initialize()
  const card = cards.getCard(cards.activeCardId)!
  await cards.updateCard(cards.activeCardId, {
    ...card,
    extensions: { ...card.extensions, airi: { ...card.extensions.airi, modules: { ...card.extensions.airi.modules, consciousness: { provider: 'openai', model: 'test-model' } } } },
  })
  const sessions = useChatSessionStore()
  await sessions.initialize()
  const sessionId = sessions.activeSessionId
  onTestFinished(() => sessions.deleteSession(sessionId))
  const consciousness = useConsciousnessStore()
  consciousness.activeProvider = 'openai'
  consciousness.activeModel = 'test-model'
  const provider: GenerationProvider = {
    generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://example.com/' } }),
  }
  vi.spyOn(consciousness, 'getChatProviderInstance').mockResolvedValue(provider)
  const requests = shallowRef<Array<{ signal: AbortSignal, release: () => void }>>([])
  vi.spyOn(useLLM(), 'stream').mockImplementation(async (_model, _provider, _messages, options) => {
    const signal = options!.abortSignal!
    const released = Promise.withResolvers<void>()
    requests.value = [...requests.value, { signal, release: released.resolve }]
    signal.addEventListener('abort', () => released.resolve(), { once: true })
    await released.promise
    if (signal.aborted)
      return
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'Sure.' })
    await options?.onStreamEvent?.({ type: 'finish' })
  })
  // Releases any request a test leaves open.
  onTestFinished(() => requests.value.forEach(request => request.release()))
  return { sessionId, requests }
}

/** Mounts the chat history with the bindings of the stage-layouts `InteractiveArea`. */
function renderHistory() {
  const chat = useChatStore()
  const sessions = useChatSessionStore()
  const stream = useChatStreamStore()
  return render(defineComponent({
    setup() {
      return () => h(ChatHistory, {
        messages: sessions.messages,
        sending: chat.activeTurns.some(turn => turn.sessionId === sessions.activeSessionId),
        streamingMessage: stream.streamingMessage,
        style: 'height: 400px; width: 360px;',
      })
    },
  }), {
    global: { plugins: [getActivePinia()!, createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })] },
  })
}

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
  const exposed = scene.exposed as { setEmotion: (episode: ReactionEpisode) => void, applyHolds: StagePerformanceScene['applyHolds'] }
  const forward = exposed.setEmotion
  const episodes = shallowRef<ReactionEpisode[]>([])
  exposed.setEmotion = (episode) => {
    episodes.value = [...episodes.value, episode]
    forward(episode)
  }
  const forwardHolds = exposed.applyHolds
  const holds = shallowRef<Array<Parameters<StagePerformanceScene['applyHolds']>[0]>>([])
  exposed.applyHolds = (commands, now) => {
    holds.value = [...holds.value, commands]
    forwardHolds(commands, now)
  }
  // Recorded synchronously so a repeated group that replaces an equal value is still counted.
  const motionGroups = shallowRef<string[]>([])
  watch(() => params.currentMotion, (motion) => {
    motionGroups.value = [...motionGroups.value, motion.group]
  }, { flush: 'sync' })

  return { params, scene, episodes, holds, motionGroups, override: useNaturalPerformanceOverride() }
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
    expect(emotion).toHaveBeenCalledWith(Emotion.Happy, 0.7, 'devtools', undefined, { suppressMotionGroup: undefined })
    expect(episodes.value).toEqual([{
      id: expect.any(String),
      emotion: Emotion.Happy,
      nominal: 0.7,
      // Jitter moves the intensity by at most 0.04 inside the clear band.
      intensity: expect.closeTo(0.7, 1),
      band: 'clear',
      escalation: false,
      moodGain: defaultExpressionPerformanceSettings.moodDynamics.clearGain,
    }])
    expect(params.currentMotion).toEqual({ group: 'Idle', index: 0 })
  })

  it('plays the ACT motion and its emotion as one cue, with the emotion episode and its hold under Natural', async () => {
    const { params, episodes, holds } = await renderStage('natural')

    const delivered = until(() => episodes.value.length, count => count === 1)
    await useLlmStreamingControlStore().dispatchWith('<|ACT {"emotion":{"name":"happy","intensity":0.7},"motion":"Nod"}|>')
    await delivered

    expect(params.currentMotion).toEqual({ group: 'Nod' })
    expect(episodes.value.map(episode => [episode.emotion, episode.band])).toEqual([[Emotion.Happy, 'clear']])
    expect(holds.value).toHaveLength(1)
  })

  it.each(['universal', 'magic'] as const)('requests only the ACT motion group under %s, with no emotion motion group', async (driver) => {
    // The spy wraps the real method, and a reactive counter lets `until` observe each call.
    const original = StagePerformanceConductor.prototype.emotion
    const calls = shallowRef(0)
    const emotion = vi.spyOn(StagePerformanceConductor.prototype, 'emotion').mockImplementation(function (this: StagePerformanceConductor, ...args: Parameters<StagePerformanceConductor['emotion']>) {
      calls.value++
      return original.apply(this, args)
    })
    const { params, motionGroups } = await renderStage(driver)

    const delivered = until(() => calls.value, count => count === 1)
    await useLlmStreamingControlStore().dispatchWith('<|ACT {"emotion":{"name":"happy","intensity":0.7},"motion":"Nod"}|>')
    await delivered

    expect(emotion).toHaveBeenCalledWith(Emotion.Happy, 0.7, 'act', undefined, { suppressMotionGroup: true })
    expect(params.currentMotion).toEqual({ group: 'Nod' })
    expect(motionGroups.value).toEqual(['Nod'])
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

  it('keeps presence idle, plays no Think motion, and shows no placeholder while an unprompted request is undecided', async () => {
    const { scene, motionGroups } = await renderStage('universal')
    const { sessionId, requests } = await holdProviderRequests()
    const chat = useChatStore()
    const history = renderHistory()

    const unpromptedStarted = until(() => requests.value.length, count => count === 1)
    const unprompted = chat.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'unprompted-1' })
    await unpromptedStarted
    await nextTick()

    // The request is at the provider, and the model has not decided yet.
    expect(chat.sending).toBe(true)
    expect(scene.props.presence).toEqual(presenceBubbleIdle)
    expect(motionGroups.value).not.toContain(EmotionThinkMotionName)
    expect(history.container.querySelector('[data-chat-message-role="assistant"]')).toBeNull()
    expect(history.container.querySelector(streamingPlaceholder)).toBeNull()

    // A user request in flight shows all three, so the checks above can fail.
    const thinking = until(() => scene.props.presence, presence => presence === presenceBubbleThinking)
    const userStarted = until(() => requests.value.length, count => count === 2)
    const user = chat.send({ sessionId, messageId: 'user-1', text: 'hello' })
    await Promise.all([thinking, userStarted])
    expect(await unprompted).toEqual({ status: 'cancelled' })
    expect(motionGroups.value).toContain(EmotionThinkMotionName)
    await vi.waitFor(() => expect(history.container.querySelector(streamingPlaceholder)).not.toBeNull())

    requests.value[1].release()
    await user
  })

  it('drops the deferred caption reset of a held unprompted turn that is cancelled', async () => {
    await renderStage('universal')
    const { sessionId, requests } = await holdProviderRequests()
    const chat = useChatStore()
    const present = new BroadcastChannel('airi-chat-present')
    const sentinel = new BroadcastChannel('airi-chat-present')
    onTestFinished(() => {
      present.close()
      sentinel.close()
    })
    const received = shallowRef<string[]>([])
    present.onmessage = (event: MessageEvent<{ type: string }>) => {
      received.value = [...received.value, event.data.type]
    }

    const started = until(() => requests.value.length, count => count === 1)
    const unprompted = chat.submitUnprompted({ topicKey: 'qa', topicText: 'QA topic', messageId: 'held-1' })
    await started
    await chat.cancelTurn({ sessionId, turnId: 'held-1' })
    expect(await unprompted).toEqual({ status: 'cancelled' })

    // A later literal with the same turn id resets nothing. The sentinel is delivered after any reset it posts.
    await chat.emitTokenLiteralHooks('Hi', {
      sessionId,
      turnId: 'held-1',
      message: { role: 'user', content: 'hello' },
      contexts: {},
      composedMessage: [],
    })
    const delivered = until(() => received.value, types => types.includes('sentinel'))
    sentinel.postMessage({ type: 'sentinel' })
    expect(await delivered).toEqual(['sentinel'])
  })

  it('passes the performance settings document to the Live2D scene', async () => {
    const { scene } = await renderStage('natural')

    expect(scene.props.performanceSettings).toMatchObject({ bands: true })
    const received = until(() => (scene.props.performanceSettings as { bands: boolean }).bands, bands => !bands)
    await useExpressionPerformanceSettings().update({ bands: false })

    expect(await received).toBe(false)
  })

  it('applies the active card\'s mood multipliers to the Natural scene without changing the shared document', async () => {
    const { scene, episodes, override } = await renderStage('natural')
    const cards = useAiriCardStore()
    await cards.initialize()
    const defaults = defaultExpressionPerformanceSettings.moodDynamics
    const sceneMood = () => (scene.props.performanceSettings as ExpressionPerformanceSettings).moodDynamics

    const applied = until(() => sceneMood().valenceTau, tau => tau === 2 * defaults.valenceTau)
    const card = cards.getCard(cards.activeCardId)!
    await cards.updateCard(cards.activeCardId, {
      ...card,
      extensions: { ...card.extensions, airi: { ...card.extensions.airi, modules: { ...card.extensions.airi.modules, performance: { moodGainScale: 0, moodDecayScale: 2 } } } },
    })
    await applied

    expect(sceneMood()).toEqual({
      ...defaults,
      slightGain: 0,
      clearGain: 0,
      strongGain: 0,
      valenceTau: 2 * defaults.valenceTau,
      arousalTau: 2 * defaults.arousalTau,
      tensionTau: 2 * defaults.tensionTau,
    })
    expect(useExpressionPerformanceSettings().document.moodDynamics).toEqual(defaults)

    // A lab pulse is decided under the same profile, and the scene keeps the scaled mood.
    const delivered = until(() => episodes.value.length, count => count === 1)
    override.pulseEmotion('happy', 0.6)
    await delivered
    expect(sceneMood()).toMatchObject({ clearGain: 0, valenceTau: 2 * defaults.valenceTau })
  })
})

describe('per-signal character profiles at the Natural consumer', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('consumes a zero-gain turn episode at zero mood when a turnless signal is decided before the Natural frame', async () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.advance(0)
    // Model.vue queues episodes until its next frame; this queue stands in for it.
    const pending: NaturalEpisode[] = []
    const pinia = createPinia()
    setActivePinia(pinia)
    let api: ReturnType<typeof useStagePerformanceConductor> | undefined
    render(defineComponent({
      setup() {
        api = useStagePerformanceConductor({
          scene: () => ({ setEmotion: episode => pending.push(episode), applySlots: () => {}, applyHolds: () => {}, onSpeech: () => {}, setMuted: () => {} }),
          driver: () => 'natural',
          playMotion: () => {},
          mood: () => motion.moodState,
          profile: turnId => turnId === 'turn-a' ? { moodGainScale: 0, moodDecayScale: 2 } : undefined,
        })
        // The scene settings reach Natural through a deferred watch, as through Model.vue.
        watch(api.settings, settings => motion.setPerformanceSettings(settings), { immediate: true })
        return () => h('div')
      },
    }), {
      global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })] },
    })
    const { conductor } = api!

    conductor.startRecording()
    conductor.emotion('happy', 0.6, 'act', 'turn-a')
    conductor.setMuted(true)
    await nextTick()

    // The decider is unchanged: exact replay reproduces the dispatched episodes.
    const replayed = replayAffectTrace(conductor.exportTrace()!, { ...createPickerDecider(), kind: 'picker' }, { mode: 'exact' })
      .flatMap(({ decision }) => decision.episodes)
    expect(pending.map(({ moodGain: _moodGain, ...episode }) => episode)).toEqual(replayed)
    expect(pending).toHaveLength(1)

    for (const episode of pending)
      motion.impulse(episode, 0)
    // Two 120 Hz grid steps, so Natural consumes the queued impulse.
    motion.advance(2 / 120)

    expect(motion.moodState.valence).toBe(0)
  })
})

describe('stage emotion routing on Tachie', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('hands the Tachie scene an archive emotion for love, flustered, and sleepy and leaves the original emotions as they are', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useSettingsStageModel().setStageModelRenderer('tachie')
    const tachie = await import('@proj-airi/stage-ui-tachie')

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

    // The recorder replaces the exposed call the stage makes; no archive is loaded, so nothing is forwarded.
    const exposed = findInstance(host?.subTree, tachie.TachieScene)!.exposed as { setEmotion: (emotion: string, intensity?: number) => void }
    const calls = shallowRef<Array<[string, number | undefined]>>([])
    exposed.setEmotion = (emotion, intensity) => {
      calls.value = [...calls.value, [emotion, intensity]]
    }

    // The stage watches the pulse sequence, so each pulse waits for the previous one to land.
    const override = useNaturalPerformanceOverride()
    for (const [index, name] of ['love', 'flustered', 'sleepy', 'sad'].entries()) {
      const delivered = until(() => calls.value.length, count => count === index + 1)
      override.pulseEmotion(name, 0.7)
      await delivered
    }

    expect(calls.value).toEqual([['happy', 0.7], ['awkward', 0.7], ['neutral', 0.7], ['sad', 0.7]])
  })
})
