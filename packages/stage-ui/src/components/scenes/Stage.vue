<script setup lang="ts">
import type { SpeechClip, SpeechClipEnd } from '@proj-airi/core-agent'
import type { Live2DLipSync, Live2DLipSyncOptions } from '@proj-airi/model-driver-lipsync'
import type { Profile } from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import type { StreamingControlLook } from '@proj-airi/pipelines-audio'
import type { CaptionChannelEvent, PresenceBubbleState } from '@proj-airi/stage-shared'
import type { PerformanceCueAttention, PerformanceState, ResolverMemory } from '@proj-airi/stage-shared/performance-state'
import type { TachieEmotion } from '@proj-airi/stage-ui-tachie'
import type { VrmInteractionTarget } from '@proj-airi/stage-ui-three'

import type { EmotionPayload } from '../../constants/emotions'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom, sleep } from '@moeru/std'
import { BrowserPlayback } from '@proj-airi/audio/browser'
import { createLive2DLipSync } from '@proj-airi/model-driver-lipsync'
import { wlipsyncProfile } from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import { normalizeActPayload, Playback } from '@proj-airi/pipelines-audio'
import { presenceBubbleIdle, presenceBubbleThinking } from '@proj-airi/stage-shared'
import { isMotionQaBridgeEnabled } from '@proj-airi/stage-shared/motion-scenario/flag'
import { initialResolverMemory, resolvePerformanceState } from '@proj-airi/stage-shared/performance-state'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { defaultLive2DMotionControlDynamics, Live2DScene, useLive2DMotionControl, useLive2dParams, useSettingsLive2d } from '@proj-airi/stage-ui-live2d'
import { MMDScene } from '@proj-airi/stage-ui-mmd'
import { SpineScene } from '@proj-airi/stage-ui-spine'
import { TachieScene } from '@proj-airi/stage-ui-tachie'
import { ThreeScene } from '@proj-airi/stage-ui-three'
import { animations } from '@proj-airi/stage-ui-three/assets/vrm'
import { createQueue } from '@proj-airi/stream-kit'
import { Callout } from '@proj-airi/ui'
import { useBroadcastChannel, useDocumentVisibility, useEventListener, useIntervalFn } from '@vueuse/core'
// import { createTransformers } from '@xsai-transformers/embed'
// import embedWorkerURL from '@xsai-transformers/embed/worker?worker&url'
// import { embed } from '@xsai/embed'
import { storeToRefs } from 'pinia'
import { computed, getCurrentScope, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue'

import StageRenderError from './stage-render-error.vue'

import { useStagePerformanceConductor } from '../../composables/performance/use-stage-performance-conductor'
// import { useDuckDb } from '../../composables/use-duck-db'
import { Emotion, EMOTION_VRMExpressionName_value, EmotionThinkMotionName } from '../../constants/emotions'
import { live2dMotionMagicProfiles, useLive2DMotionMagic, useLive2DMotionMagicSettings } from '../../features/motions/live2d'
import { getSpeechBusContext, speechInputUserSpeakingChangedEvent, speechOutputGetPlaybackState, speechOutputPlaybackStateChangedEvent, voiceGenerationEnded } from '../../services/speech/bus'
import { useLlmStreamingControlStore } from '../../stores/ai/chat-llm/streaming-control'
import { useAudioContext, useSpeakingStore } from '../../stores/audio'
import { useBackgroundStore } from '../../stores/background'
import { useChatStore } from '../../stores/chat'
import { useChatSessionStore } from '../../stores/chat/session-store'
import { useActComplianceStore } from '../../stores/devtools/act-compliance'
import { useAiriCardStore } from '../../stores/modules/airi-card'
import { useSpeechStore } from '../../stores/modules/speech'
import { useNaturalPerformanceOverride } from '../../stores/natural-performance-override'
import { useSettingsPresenceBubble } from '../../stores/presence-bubble'
import { useSettings } from '../../stores/settings'
import { useSituationStore } from '../../stores/situation'
import { useSpeechOutputControlStore } from '../../stores/speech-output-control'
import { useVoiceStore } from '../../stores/voice'

const props = withDefaults(defineProps<{
  cursorPosition?: { x: number, y: number }
  enableOrbitControls?: boolean
  paused?: boolean
}>(), {
  enableOrbitControls: true,
  paused: false,
})

const emit = defineEmits<{ error: [error: Error] }>()
const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

// NOTICE: disabled together with the DuckDB start on mount below.
// const { getDb } = useDuckDb()
// const transformersProvider = createTransformers({ embedWorkerURL })

const vrmViewerRef = ref<InstanceType<typeof ThreeScene>>()
const live2dSceneRef = ref<InstanceType<typeof Live2DScene>>()
const spineSceneRef = ref<InstanceType<typeof SpineScene>>()
const tachieSceneRef = ref<InstanceType<typeof TachieScene>>()
const mmdSceneRef = ref<InstanceType<typeof MMDScene>>()

const settingsStore = useSettings()
const {
  stageModelRenderer,
  stageViewControlsEnabled,
  stageModelSelectedUrl,
  stageModelSelected,
  themeColorsHue,
  themeColorsHueDynamic,

} = storeToRefs(settingsStore)
const {
  live2dMotionDriver,
  live2dShadowEnabled,
  live2dMaxFps,
  live2dRenderScale,
} = storeToRefs(useSettingsLive2d())
const live2dMotionControl = useLive2DMotionControl()
const { exclusiveOwnerId: live2dMotionControlOwnerId } = storeToRefs(live2dMotionControl)
const {
  forceViewTarget: live2dMagicForceViewTarget,
  profileId: live2dMagicProfileId,
  skipMouthOpen: live2dMagicSkipMouthOpen,
} = storeToRefs(useLive2DMotionMagicSettings())
const live2dMagicMotion = useLive2DMotionMagic({
  dataset: () => live2dMotionMagicProfiles[live2dMagicProfileId.value].dataset,
  forceViewTarget: live2dMagicForceViewTarget,
  skipMouthOpen: live2dMagicSkipMouthOpen,
  disabled: () => live2dMotionControlOwnerId.value !== null,
  publishPose: pose => live2dMotionControl.setPose('stage:live2d-motion-magic', pose, defaultLive2DMotionControlDynamics),
  releasePose: () => live2dMotionControl.release('stage:live2d-motion-magic'),
})
let live2dMagicActivationRequest = 0

watch(
  [stageModelRenderer, live2dMotionDriver, live2dMagicProfileId, () => props.paused, live2dMotionControlOwnerId],
  async ([renderer, driver, , paused, controlOwnerId]) => {
    const request = ++live2dMagicActivationRequest
    if (renderer !== 'live2d' || driver !== 'magic' || paused || controlOwnerId !== null) {
      live2dMagicMotion.stop()
      return
    }

    if (live2dMagicMotion.status.value === 'idle')
      await live2dMagicMotion.initialize()

    if (
      request !== live2dMagicActivationRequest
      || stageModelRenderer.value !== 'live2d'
      || live2dMotionDriver.value !== 'magic'
      || props.paused
      || live2dMotionControlOwnerId.value !== null
    ) {
      return
    }

    live2dMagicMotion.start()
  },
  { immediate: true },
)
const {
  spinePremultipliedAlpha,
  spineDefaultMixDuration,
  spineIdleAnimationEnabled,
  spineMaxFps,
  spineRenderScale,
} = storeToRefs(settingsStore)
const { mouthOpenSize, nowSpeaking } = storeToRefs(useSpeakingStore())
/** `voicing` of `SpeechOutputPlaybackState` in the speech bus. The voice output below keeps it. */
const speechVoicing = shallowRef(false)
const disposePlaybackStateHandler = defineInvokeHandler(
  getSpeechBusContext(),
  speechOutputGetPlaybackState,
  () => ({ speaking: nowSpeaking.value, voicing: speechVoicing.value }),
)
// Emitted at once too, so a window that kept the state of a reloaded stage
// learns that the new stage voices nothing.
watch([nowSpeaking, speechVoicing], ([speaking, voicing]) => {
  getSpeechBusContext().emit(speechOutputPlaybackStateChangedEvent, { speaking, voicing })
}, { immediate: true })
const { audioContext } = useAudioContext()
const currentAudioSource = ref<AudioBufferSourceNode>()
const speechOutputControlStore = useSpeechOutputControlStore()
const { speechMuted } = storeToRefs(speechOutputControlStore)
const lastVrmInteractionAt = new Map<VrmInteractionTarget, number>()
const VRM_INTERACTION_COOLDOWN_MS = 450

function getVrmInteractionExpression(target: VrmInteractionTarget) {
  if (target === 'head')
    return 'happy'
  if (target === 'leftFoot' || target === 'rightFoot')
    return 'relaxed'
  return 'surprised'
}

function onVRMInteract(target: VrmInteractionTarget) {
  const now = Date.now()
  const lastTriggeredAt = lastVrmInteractionAt.get(target) ?? 0
  if (now - lastTriggeredAt < VRM_INTERACTION_COOLDOWN_MS)
    return
  lastVrmInteractionAt.set(target, now)
  vrmViewerRef.value?.setExpression(getVrmInteractionExpression(target), 1)
}

const { onBeforeMessageComposed, onBeforeSend, onTokenLiteral, onTokenSpecial, onStreamEnd, onAssistantResponseEnd } = useChatStore()
const chatHookCleanups: Array<() => void> = []
// WORKAROUND: clear previous handlers on unmount to avoid duplicate calls when this component remounts.
//             We keep per-hook disposers instead of wiping the global chat hooks to play nicely with
//             cross-window broadcast wiring.

const live2dStore = useLive2dParams()
const showStage = ref(true)
const stageRenderError = shallowRef<Error>()
const viewUpdateCleanups: Array<() => void> = []

function handleStageRenderError(error: Error) {
  stageRenderError.value = error
  emit('error', error)
}

function reportStageRenderError(error: unknown) {
  console.error(error)
  handleStageRenderError(new Error(errorMessageFrom(error) ?? 'Failed to render stage'))
}

async function retryStageRenderer() {
  stageRenderError.value = undefined
  showStage.value = false
  await nextTick()
  showStage.value = true
}

watch([stageModelRenderer, stageModelSelected, stageModelSelectedUrl], () => {
  stageRenderError.value = undefined
})

// Caption + Presentation broadcast channels
const { post: postCaption } = useBroadcastChannel<CaptionChannelEvent, CaptionChannelEvent>({ name: 'airi-caption-overlay' })
const assistantCaption = ref('')

type PresentEvent
  = | { type: 'assistant-reset' }
    | { type: 'assistant-append', text: string }
const { post: postPresent } = useBroadcastChannel<PresentEvent, PresentEvent>({ name: 'airi-chat-present' })

viewUpdateCleanups.push(live2dStore.onShouldUpdateView(async () => {
  showStage.value = false
  await settingsStore.updateStageModel()
  setTimeout(() => {
    showStage.value = true
  }, 100)
}))

const audioAnalyser = ref<AnalyserNode>()
const lipSyncStarted = ref(false)
const lipSyncLoopId = ref<number>()
const live2dLipSync = ref<Live2DLipSync>()
const live2dLipSyncOptions: Live2DLipSyncOptions = { mouthUpdateIntervalMs: 50, mouthLerpWindowMs: 50 }

function resetAssistantSpeechSurface(source: string) {
  nowSpeaking.value = false
  mouthOpenSize.value = 0
  assistantCaption.value = ''

  try {
    postCaption({ type: 'caption-assistant', text: '' })
  }
  catch (error) {
    console.warn(`[Stage] Failed to post caption reset for ${source} (channel may be closed)`, { error })
  }

  try {
    postPresent({ type: 'assistant-reset' })
  }
  catch (error) {
    console.warn(`[Stage] Failed to post present reset for ${source} (channel may be closed)`, { error })
  }
}

const { userSending: chatSending } = storeToRefs(useChatStore())
const { presenceOverride } = storeToRefs(useSettingsPresenceBubble())

// `userSending` spans a user's request until it settles, while the character
// has nothing to say yet. Nobody waits on an unprompted turn, so presence
// stays idle for it.
//
// Unread stays at zero: nothing reports whether the chat window is showing, so
// there is no read cursor to count against.
const chatPresence = computed<PresenceBubbleState>(() => chatSending.value ? presenceBubbleThinking : presenceBubbleIdle)
const presenceBubble = computed<PresenceBubbleState>(() => presenceOverride.value ?? chatPresence.value)
const speechStore = useSpeechStore()
const chatSession = useChatSessionStore()
const backgroundStore = useBackgroundStore()
const { activeBackgroundUrl } = storeToRefs(backgroundStore)

const { currentMotion } = storeToRefs(useLive2dParams())
const voice = useVoiceStore()
const cards = useAiriCardStore()

const { conductor: performanceConductor, settings: performanceSettings } = useStagePerformanceConductor({
  scene: () => live2dSceneRef.value,
  driver: () => live2dMotionDriver.value,
  playMotion: (group) => { currentMotion.value = { group } },
  mood: () => live2dSceneRef.value?.getMood() ?? null,
  profile: performanceProfileOf,
})

/**
 * The card performance profile of a performance signal: the character of the signal's turn
 * session, or the active card for lab pulses, tool calls, and turns that already ended.
 */
function performanceProfileOf(turnId: string | undefined) {
  const sessionId = turnId === undefined ? undefined : voice.activeTurns.find(turn => turn.turnId === turnId)?.sessionId
  const characterId = (sessionId === undefined ? undefined : chatSession.sessionMetas[sessionId]?.characterId) ?? cards.activeCardId
  try {
    return cards.getModules(characterId).performance
  }
  catch (error) {
    console.warn('[Stage] The performance profile is unavailable, so none applies:', errorMessageFrom(error))
    return undefined
  }
}

/** A performance cue with its origin; the turn id keeps speech-bound expressions inside their turn. */
interface StageCue {
  emotion?: EmotionPayload
  /** An LLM-named Live2D expression from an ACT marker. */
  expression?: string
  source: 'act' | 'devtools'
  turnId?: string
  /** Set when the ACT also named a Live2D motion, which the stage already played. */
  motionHandled?: boolean
}

const emotionsQueue = createQueue<StageCue>({
  handlers: [
    async (ctx) => {
      const { emotion, expression } = ctx.data
      if (stageModelRenderer.value === 'live2d') {
        // The conductor sends Natural episodes to the scene and plays the motion group for
        // Universal and MAGIC; the store defers a motion group while the model loads.
        if (emotion)
          performanceConductor.emotion(emotion.name, emotion.intensity, ctx.data.source, ctx.data.turnId, { suppressMotionGroup: ctx.data.motionHandled })
        // After the emotion, so an explicit expression replaces the auto pick for its slot.
        if (expression)
          performanceConductor.expression(expression, undefined, 'act', ctx.data.turnId)
        return
      }
      if (!emotion)
        return
      if (stageModelRenderer.value === 'vrm') {
        // console.debug('VRM emotion anime: ', ctx.data)
        const value = EMOTION_VRMExpressionName_value[emotion.name]
        if (!value)
          return

        await vrmViewerRef.value!.setExpression(value, emotion.intensity)
      }
      else if (stageModelRenderer.value === 'spine') {
        spineSceneRef.value?.setEmotion(emotion.name, emotion.intensity)
      }
      else if (stageModelRenderer.value === 'tachie') {
        tachieSceneRef.value?.setEmotion(toTachieEmotion(emotion.name), emotion.intensity)
      }
      else if (stageModelRenderer.value === 'mmd') {
        mmdSceneRef.value?.setEmotion(emotion.name, emotion.intensity)
      }
    },
  ],
})

const streamingControl = useLlmStreamingControlStore()

/**
 * Tachie archives only hold the nine original emotion images, so the newer stage emotions
 * show the nearest one: love as happy, flustered as awkward, and sleepy as neutral.
 */
function toTachieEmotion(name: Emotion): TachieEmotion {
  switch (name) {
    case Emotion.Love:
      return 'happy'
    case Emotion.Flustered:
      return 'awkward'
    case Emotion.Sleepy:
      return 'neutral'
    default:
      return name
  }
}

function toStageEmotionPayload(payload: { name: string, intensity: number }): EmotionPayload | undefined {
  switch (payload.name) {
    case 'happy':
      return { name: Emotion.Happy, intensity: payload.intensity }
    case 'sad':
      return { name: Emotion.Sad, intensity: payload.intensity }
    case 'angry':
      return { name: Emotion.Angry, intensity: payload.intensity }
    case 'think':
      return { name: Emotion.Think, intensity: payload.intensity }
    case 'surprised':
      return { name: Emotion.Surprise, intensity: payload.intensity }
    case 'awkward':
      return { name: Emotion.Awkward, intensity: payload.intensity }
    case 'question':
      return { name: Emotion.Question, intensity: payload.intensity }
    case 'curious':
      return { name: Emotion.Curious, intensity: payload.intensity }
    case 'neutral':
      return { name: Emotion.Neutral, intensity: payload.intensity }
    case 'love':
      return { name: Emotion.Love, intensity: payload.intensity }
    case 'flustered':
      return { name: Emotion.Flustered, intensity: payload.intensity }
    case 'sleepy':
      return { name: Emotion.Sleepy, intensity: payload.intensity }
    default:
      return undefined
  }
}

const cueAttentionByLook: Record<StreamingControlLook, PerformanceCueAttention> = {
  you: 'camera',
  screen: 'screen',
  away: 'aside',
}

/**
 * Attention that an ACT cue's `look` asked for, with the turn that asked. A later ACT of the
 * same turn without `look` keeps it; it ends when that turn leaves the active voice turns.
 */
const cueLook = shallowRef<{ turnId: string | undefined, attention: PerformanceCueAttention } | null>(null)

chatHookCleanups.push(streamingControl.onSignal(async (signal, context) => {
  if (signal.type === 'act') {
    const act = normalizeActPayload(signal.payload)
    if (act.look) {
      cueLook.value = { turnId: context.turnId, attention: cueAttentionByLook[act.look] }
    }
    else if (cueLook.value && cueLook.value.turnId !== context.turnId) {
      // A cue from another turn never carries its gaze over.
      cueLook.value = null
    }
    const motion = stageModelRenderer.value === 'live2d' && act.motion ? act.motion : undefined
    if (motion)
      currentMotion.value = { group: motion }
    const emotion = act.emotion ? toStageEmotionPayload(act.emotion) : undefined
    if (emotion || act.expression) {
      // eslint-disable-next-line no-console
      console.debug('performance cue detected', emotion, act.expression)
      emotionsQueue.enqueue({ emotion, expression: act.expression, source: 'act', turnId: context.turnId, motionHandled: motion !== undefined })
    }
    return
  }

  if (signal.type === 'delay') {
    // eslint-disable-next-line no-console
    console.debug('delay detected', signal.seconds)
    await sleep(signal.seconds * 1000)
  }
}))

// Play special token: plugin CALL, delay, or emotion.
async function playSpecialToken(
  special: string,
  options?: {
    turnId?: string
    intentId?: string
    streamId?: string
  },
) {
  await streamingControl.dispatchWith(special, {
    turnId: options?.turnId,
    intentId: options?.intentId,
    streamId: options?.streamId,
  })
}

// --- Performance state for the Natural motion driver
// This stage is the only writer. It resolves every 250 ms, so dwell and release timers advance
// without input changes, and at once when an input changes, so the listening release is anchored
// on the moment user speech ends.

/** User speech reported by a voice input host in another window. The local host is read from the voice store. */
const remoteUserSpeaking = shallowRef(false)
const disposeUserSpeakingListener = getSpeechBusContext().on(speechInputUserSpeakingChangedEvent, ({ body }) => {
  if (body)
    remoteUserSpeaking.value = body.speaking
})
const userSpeaking = computed(() => voice.userSpeaking || remoteUserSpeaking.value)
/** Epoch milliseconds of the last pointer move the stage received, or `null` before the first one. */
const cursorMovedAtMs = shallowRef<number | null>(null)
watch(() => props.cursorPosition, () => {
  cursorMovedAtMs.value = Date.now()
})
const { snapshot: desktopActivity } = storeToRefs(useDesktopActivityStore())
const visibility = useDocumentVisibility()
const { performanceOverride, emotionPulse } = storeToRefs(useNaturalPerformanceOverride())
// Only the leader window folds foreground samples; AIRI's own windows never become activity, and followers read null.
const situation = useSituationStore()
const foregroundCategory = computed(() => situation.foregroundCategory)
let performanceMemory: ResolverMemory = initialResolverMemory
const performance = shallowRef<PerformanceState>(resolvePerformance())

function resolvePerformance(): PerformanceState {
  const resolution = resolvePerformanceState({
    nowMs: Date.now(),
    speaking: nowSpeaking.value,
    userSpeaking: userSpeaking.value,
    generating: chatSending.value,
    cursorMovedAtMs: cursorMovedAtMs.value,
    desktop: desktopActivity.value,
    visible: visibility.value === 'visible',
    override: performanceOverride.value,
    cueAttention: cueLook.value?.attention ?? null,
    foregroundCategory: foregroundCategory.value,
  }, performanceMemory)
  performanceMemory = resolution.memory
  return resolution.state
}

function updatePerformance() {
  const next = resolvePerformance()
  const current = performance.value
  // A new object every tick would re-render the scene four times a second for nothing.
  if (next.mode !== current.mode || next.attention !== current.attention || next.away !== current.away
    || next.reactSeq !== current.reactSeq || next.reactKind !== current.reactKind) {
    performance.value = next
  }
}

useIntervalFn(updatePerformance, 250)
watch([nowSpeaking, userSpeaking, chatSending, cursorMovedAtMs, desktopActivity, visibility, performanceOverride, cueLook, foregroundCategory], updatePerformance)

// The devtools Natural lab fires emotions through the same queue the chat uses.
watch(() => emotionPulse.value?.seq, () => {
  const pulse = emotionPulse.value
  if (!pulse)
    return
  const emotion = toStageEmotionPayload({ name: pulse.name, intensity: pulse.nominal })
  if (emotion)
    emotionsQueue.enqueue({ emotion, source: 'devtools' })
})

// The dev-only motion QA bridge answers remote-debug commands through this stage's real input paths. The
// flag exists only when the Electron main process enabled the bridge and the renderer set it before mounting;
// production builds drop this block, and with it the only import of the handler module.
if (import.meta.env.DEV && isMotionQaBridgeEnabled()) {
  const scope = getCurrentScope()
  void import('../../composables/performance/use-motion-qa-bridge')
    .then((module) => {
      // The stage may unmount before the module arrives; a stopped scope must not gain handlers.
      if (scope?.active) {
        scope.run(() => module.useMotionQaBridge({
          emotionsQueue,
          dispatchAct: marker => streamingControl.dispatchWith(marker),
          renderError: () => stageRenderError.value,
        }))
      }
    })
    .catch(error => console.error('[Stage] The motion QA bridge could not start:', errorMessageFrom(error) ?? 'unknown error'))
}

const speechDestination = audioContext.createGain()
speechDestination.connect(audioContext.destination)
const playback = new Playback(new BrowserPlayback(audioContext, {
  destination: speechDestination,
  onSource: (source) => { currentAudioSource.value = source },
}))
let playingCount = 0

function resetSpeakingState() {
  nowSpeaking.value = false
  mouthOpenSize.value = 0
}

// A response leaves the active turns after its playback drains, or at once
// when it is canceled or interrupted. Each turn that leaves ends its own speech leases.
watch(() => voice.activeTurns, (turns) => {
  if (turns.length === 0)
    speechVoicing.value = false
  const cueTurnId = cueLook.value?.turnId
  if (cueLook.value && !turns.some(turn => turn.turnId === cueTurnId))
    cueLook.value = null
  performanceConductor.syncActiveTurns(turns.map(turn => turn.turnId))
})

const disconnectVoiceOutput = voice.connectOutput((turn) => {
  const output = {
    playback,
    onSpecial: (special: string) => void playSpecialToken(special, { turnId: turn.turnId }),
    onPlaybackStart: ({ id, text, sentenceStart }: SpeechClip) => {
      performanceConductor.clipStart(turn.turnId, id, sentenceStart)
      playingCount += 1
      nowSpeaking.value = true
      speechVoicing.value = true
      assistantCaption.value += ` ${text}`
      try {
        postCaption({ type: 'caption-assistant', text })
        postPresent({ type: 'assistant-append', text })
      }
      catch (error) {
        console.error('Speech presentation channel failed', error)
      }
    },
    onPlaybackEnd: ({ id }: SpeechClip, end: SpeechClipEnd) => {
      performanceConductor.clipEnd(turn.turnId, id, end.status)
      playingCount -= 1
      if (playingCount === 0)
        resetSpeakingState()
    },
  }
  if (speechMuted.value)
    return { ...output, synthesize: async () => null }
  try {
    const characterId = chatSession.sessionMetas[turn.sessionId]?.characterId
    if (!characterId)
      throw new Error('The response session has no character')
    return speechStore.createOutput(turn, cards.getModules(characterId).speech, output, audioContext)
  }
  catch (error) {
    // Text replies remain available when optional speech output is not configured.
    console.error('Speech output is unavailable', error)
    return { ...output, synthesize: async () => null }
  }
})

function startLipSyncLoop() {
  if (lipSyncLoopId.value)
    return

  const tick = () => {
    if (!nowSpeaking.value || !live2dLipSync.value) {
      mouthOpenSize.value = 0
    }
    else {
      mouthOpenSize.value = live2dLipSync.value.getMouthOpen()
    }
    performanceConductor.sampleVoiceLevel(mouthOpenSize.value)
    lipSyncLoopId.value = requestAnimationFrame(tick)
  }

  lipSyncLoopId.value = requestAnimationFrame(tick)
}

function stopLipSyncLoop() {
  if (lipSyncLoopId.value) {
    cancelAnimationFrame(lipSyncLoopId.value)
    lipSyncLoopId.value = undefined
  }

  mouthOpenSize.value = 0
}

function resetLive2dLipSync() {
  stopLipSyncLoop()

  live2dLipSync.value?.dispose()
  live2dLipSync.value = undefined
  lipSyncStarted.value = false
}

function syncLipSyncLoop() {
  if (stageModelRenderer.value === 'live2d' && !props.paused && lipSyncStarted.value) {
    startLipSyncLoop()
    return
  }

  stopLipSyncLoop()
}

async function setupLipSync() {
  if (stageModelRenderer.value !== 'live2d') {
    resetLive2dLipSync()
    return
  }

  if (lipSyncStarted.value)
    return

  try {
    const lipSync = await createLive2DLipSync(audioContext, wlipsyncProfile as Profile, live2dLipSyncOptions)
    live2dLipSync.value = lipSync
    speechDestination.connect(lipSync.input)
    await audioContext.resume()
    lipSyncStarted.value = true
    syncLipSyncLoop()
  }
  catch (error) {
    resetLive2dLipSync()
    console.error('Failed to setup Live2D lip sync', error)
  }
}

function setupAnalyser() {
  if (!audioAnalyser.value) {
    audioAnalyser.value = audioContext.createAnalyser()
    speechDestination.connect(audioAnalyser.value)
  }
}

watch(speechMuted, muted => performanceConductor.setMuted(muted), { immediate: true })

watch(speechMuted, (muted) => {
  if (muted) {
    for (const turn of voice.activeTurns)
      voice.getSpeech(turn)?.cancel('Speech muted')
  }
})

/**
 * Unprompted turns of the active session whose speech surface is reset at their first literal.
 * A declined turn emits no literal, so the previous caption stays.
 */
const deferredSurfaceResets = new Set<string>()

chatHookCleanups.push(onBeforeMessageComposed(async (_message, context) => {
  voice.startResponse(context)
  if (context.sessionId === chatSession.activeSessionId) {
    if (context.origin === 'unprompted')
      deferredSurfaceResets.add(context.turnId)
    else
      resetAssistantSpeechSurface('new-message')
  }
  setupAnalyser()
  await setupLipSync()
}))

chatHookCleanups.push(onBeforeSend(async (_message, context) => {
  // The model may still decline an unprompted turn, so the character does not look like she is answering.
  if (context.origin !== 'unprompted')
    currentMotion.value = { group: EmotionThinkMotionName }
}))

chatHookCleanups.push(onTokenLiteral(async (literal, context) => {
  if (deferredSurfaceResets.delete(context.turnId))
    resetAssistantSpeechSurface('unprompted-speech')
  if (!speechMuted.value)
    await voice.getSpeech(context)?.write(literal)
}))

chatHookCleanups.push(onTokenSpecial(async (special, context) => {
  if (speechMuted.value)
    await playSpecialToken(special, { turnId: context.turnId })
  else
    voice.getSpeech(context)?.special(special)
}))

// A held turn that is cancelled or fails before it speaks never reaches its stream end.
chatHookCleanups.push(getSpeechBusContext().on(voiceGenerationEnded, ({ body }) => {
  if (body)
    deferredSurfaceResets.delete(body.turnId)
}))

chatHookCleanups.push(onStreamEnd(async (context) => {
  deferredSurfaceResets.delete(context.turnId)
  void voice.finishResponse(context).catch(error => console.error('Speech response completion failed', error))
}))

// ACT compliance for the devtools Situation inspector. Rejections arrive while the speech of the turn plays.
const actCompliance = useActComplianceStore()
chatHookCleanups.push(onStreamEnd(async (context) => {
  actCompliance.recordStreamEnd(context, Date.now())
}))
chatHookCleanups.push(streamingControl.onRejected(({ turnId, special }) => {
  actCompliance.recordRejected(turnId, special)
}))

chatHookCleanups.push(onAssistantResponseEnd(async (_message, context) => {
  void voice.finishResponse(context).catch(error => console.error('Speech response completion failed', error))
}))

// Resume audio context on first user interaction (browser requirement)
let audioContextResumed = false
function resumeAudioContextOnInteraction() {
  if (audioContextResumed || !audioContext)
    return
  audioContextResumed = true
  audioContext.resume().catch(() => {
    // Ignore errors - audio context will be resumed when needed
  })
}

// The listeners close over this setup scope, so a listener that outlives the
// stage keeps the whole unmounted stage alive, including its WebGL canvas.
// `useEventListener` removes them on unmount if no interaction came first.
useEventListener(['click', 'touchstart', 'keydown'], resumeAudioContextOnInteraction, { once: true, passive: true })

// NOTICE:
// DuckDB stays off until a separate layer owns it. Nothing reads it yet,
// and its WebAssembly worker kept 320-390 MB of memory in iOS Safari.
// Restore when a feature uses DuckDB.
// onMounted(async () => {
//   await getDb()
// })

watch([stageModelRenderer, () => props.paused], ([renderer]) => {
  if (renderer === 'godot') {
    componentState.value = 'mounted'
  }

  if (renderer !== 'live2d') {
    resetLive2dLipSync()
    return
  }

  syncLipSyncLoop()
}, { immediate: true })

function canvasElement() {
  if (stageModelRenderer.value === 'live2d')
    return live2dSceneRef.value?.canvasElement()

  else if (stageModelRenderer.value === 'vrm')
    return vrmViewerRef.value?.canvasElement()

  else if (stageModelRenderer.value === 'spine')
    return spineSceneRef.value?.canvasElement()

  else if (stageModelRenderer.value === 'tachie')
    return tachieSceneRef.value?.canvasElement()

  else if (stageModelRenderer.value === 'mmd')
    return mmdSceneRef.value?.canvasElement()
}

function readRenderTargetRegionAtClientPoint(clientX: number, clientY: number, radius: number) {
  if (stageModelRenderer.value !== 'vrm')
    return null

  return vrmViewerRef.value?.readRenderTargetRegionAtClientPoint?.(clientX, clientY, radius) ?? null
}

async function captureCharacterFrame() {
  if (stageModelRenderer.value === 'live2d')
    return live2dSceneRef.value?.captureFrame()
  if (stageModelRenderer.value === 'vrm')
    return vrmViewerRef.value?.captureFrame()
  if (stageModelRenderer.value === 'spine')
    return spineSceneRef.value?.captureFrame()
  if (stageModelRenderer.value === 'tachie')
    return tachieSceneRef.value?.captureFrame()
  if (stageModelRenderer.value === 'mmd')
    return mmdSceneRef.value?.captureFrame()
}

onUnmounted(() => {
  disposePlaybackStateHandler()
  disposeUserSpeakingListener()
  resetLive2dLipSync()
  chatHookCleanups.forEach(dispose => dispose?.())
  viewUpdateCleanups.forEach(dispose => dispose?.())
  disconnectVoiceOutput()
  speechDestination.disconnect()
})

defineExpose({
  canvasElement,
  /**
   * The frame already carries the scene: every renderer paints it into the canvas it
   * draws to, so what comes back is the whole picture.
   */
  captureFrame: captureCharacterFrame,
  readRenderTargetRegionAtClientPoint,
  setExpression: async (expression: string, intensity = 1) => {
    if (stageModelRenderer.value === 'vrm') {
      await vrmViewerRef.value?.setExpression(expression, intensity)
    }
  },
})
</script>

<template>
  <div relative h-full w-full>
    <div relative h-full w-full>
      <Live2DScene
        v-if="stageModelRenderer === 'live2d' && showStage"
        ref="live2dSceneRef"
        v-model:state="componentState"
        :presence="presenceBubble"
        :performance="performance"
        :natural-energy="performanceOverride?.energy ?? undefined"
        :performance-settings="performanceSettings"
        min-w="50% <lg:full"
        h-full w-full flex-1
        :model-src="stageModelSelectedUrl"
        :model-id="stageModelSelected"
        :background-url="activeBackgroundUrl"
        :cursor-position="cursorPosition"
        :mouth-open-size="mouthOpenSize"
        :now-speaking="nowSpeaking"
        :paused="paused"
        :theme-colors-hue="themeColorsHue"
        :theme-colors-hue-dynamic="themeColorsHueDynamic"
        :live2d-shadow-enabled="live2dShadowEnabled"
        :live2d-max-fps="live2dMaxFps"
        :live2d-render-scale="live2dRenderScale"
        @error="handleStageRenderError"
      />
      <ThreeScene
        v-if="stageModelRenderer === 'vrm' && showStage"
        ref="vrmViewerRef"
        v-model:state="componentState"
        :presence="presenceBubble"
        :background-url="activeBackgroundUrl"
        min-w="50% <lg:full" h-full w-full flex-1
        :model-id="stageModelSelected"
        :model-src="stageModelSelectedUrl"
        :cursor-position="cursorPosition"
        :idle-animation="animations.idleLoop.toString()"
        :paused="paused"
        :show-axes="stageViewControlsEnabled"
        :enable-orbit-controls="props.enableOrbitControls"
        :audio-context="audioContext"
        :current-audio-source="currentAudioSource"
        @error="reportStageRenderError"
        @vrm-interact="onVRMInteract"
      />
      <SpineScene
        v-if="stageModelRenderer === 'spine' && showStage"
        ref="spineSceneRef"
        v-model:state="componentState"
        :background-url="activeBackgroundUrl"
        min-w="50% <lg:full"
        h-full w-full flex-1
        :model-src="stageModelSelectedUrl"
        :model-id="stageModelSelected"
        :paused="paused"
        :premultiplied-alpha="spinePremultipliedAlpha"
        :default-mix-duration="spineDefaultMixDuration"
        :idle-animation-enabled="spineIdleAnimationEnabled"
        :max-fps="spineMaxFps"
        :render-scale="spineRenderScale"
        @error="reportStageRenderError"
      />
      <TachieScene
        v-if="stageModelRenderer === 'tachie' && showStage"
        ref="tachieSceneRef"
        v-model:state="componentState"
        :background-url="activeBackgroundUrl"
        min-w="50% <lg:full"
        h-full w-full flex-1
        :model-src="stageModelSelectedUrl"
        :model-id="stageModelSelected"
        :paused="paused"
        :theme-colors-hue="themeColorsHue"
        :theme-colors-hue-dynamic="themeColorsHueDynamic"
        @error="reportStageRenderError"
      />
      <MMDScene
        v-if="stageModelRenderer === 'mmd' && showStage"
        ref="mmdSceneRef"
        v-model:state="componentState"
        :background-url="activeBackgroundUrl"
        min-w="50% <lg:full"
        h-full w-full flex-1
        :model-src="stageModelSelectedUrl"
        :model-id="stageModelSelected"
        :paused="paused"
        :cursor-position="cursorPosition"
        :enable-orbit-controls="props.enableOrbitControls"
        :audio-context="audioContext"
        :current-audio-source="currentAudioSource"
        @error="reportStageRenderError"
      />
      <div
        v-if="stageModelRenderer === 'godot'"
        :class="[
          'h-full w-full',
          'flex items-center justify-center',
          'px-4 py-6',
        ]"
      >
        <div
          :class="[
            'w-96 max-w-full',
            'min-h-32',
            'flex items-center justify-center',
          ]"
        >
          <Callout label="Godot Stage (Experimental)">
            <p>Godot Stage (experimental) is running...</p>
          </Callout>
        </div>
      </div>

      <StageRenderError
        v-if="stageRenderError"
        :error="stageRenderError"
        :renderer="stageModelRenderer === 'live2d' ? 'Live2D' : stageModelRenderer ?? 'Model'"
        :model-id="stageModelSelected"
        @retry="retryStageRenderer"
      />
    </div>
  </div>
</template>
