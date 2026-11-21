import type { MindStimulus } from '@proj-airi/character-mind'
import type { IdleBehaviourReport } from '@proj-airi/motion-driver-natural/idle-activities'
import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'
import type { PerformanceInputs, PerformanceMode } from '@proj-airi/stage-shared/performance-state'
import type { SituationState, TouchVoiceView } from '@proj-airi/stage-shared/situation'
import type { NaturalCaptureResult } from '@proj-airi/stage-ui-live2d/stores'
import type { Mock } from 'vitest'

import type { SituationGateEvaluation } from '../../stores/devtools/situation-observability'
import type { MotionQaFrames } from './use-motion-qa-bridge'

import { defineInvoke } from '@moeru/eventa'
import { CharacterMind } from '@proj-airi/character-mind'
import { createChatHooks } from '@proj-airi/core-agent'
import { normalizeActPayload } from '@proj-airi/pipelines-audio'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'
import { createMotionQaContext, createMotionQaDispatcher, motionQaRunScenarioInvokeEventa } from '@proj-airi/stage-shared/motion-scenario'
import { initialResolverMemory, resolvePerformanceState } from '@proj-airi/stage-shared/performance-state'
import { HOUR_MS, initialSituationState } from '@proj-airi/stage-shared/situation'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { useLive2DNaturalSettings, useSettingsLive2d } from '@proj-airi/stage-ui-live2d/composables/live2d'
import { useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { createEventHook } from '@vueuse/core'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, watch } from 'vue'

import { usePerformanceRuntimeState } from '../../features/performance/runtime-state'
import { useExpressionPerformanceSettings } from '../../features/performance/settings'
import { useLlmStreamingControlStore } from '../../stores/ai/chat-llm/streaming-control'
import { useNaturalPerformanceOverride } from '../../stores/natural-performance-override'
import { useMotionQaBridge } from './use-motion-qa-bridge'

/** Frames advance only when the test steps them, so scenario time is exactly the stepped time. */
function controlledFrames() {
  let now = 5_000
  let pending: (() => void) | undefined
  let requested = Promise.withResolvers<void>()
  const frames: MotionQaFrames = {
    now: () => now,
    request(callback) {
      pending = callback
      requested.resolve()
      return 1
    },
    cancel() {
      pending = undefined
    },
  }
  return {
    frames,
    /** Waits until the bridge requests a frame, moves the clock, and runs that frame. */
    async step(milliseconds: number) {
      await requested.promise
      requested = Promise.withResolvers<void>()
      now += milliseconds
      const callback = pending
      pending = undefined
      callback?.()
    },
  }
}

/** Steps frames until `reply` settles; a scenario that never finishes fails after `maxFrames`. */
async function drive<T>(clock: ReturnType<typeof controlledFrames>, reply: Promise<T>, maxFrames = 100): Promise<T> {
  let settled = false
  void reply.finally(() => {
    settled = true
  })
  for (let frame = 0; frame < maxFrames; frame++) {
    if (settled)
      break
    await Promise.race([clock.step(500), reply])
  }
  expect(settled).toBe(true)
  return reply
}

function scenario(events: MotionScenario['events']): MotionScenario {
  return { version: 1, id: 'bridge-test', seed: 1, durationSeconds: 10, levels: ['t3'], events }
}

/** A gate tick for a user at the desk who accepts remarks, with nothing on the screen worth a word. */
function voiceTick(forceTiming: boolean, nowMs: number): MindStimulus {
  const situation: SituationState = {
    ...initialSituationState,
    presence: { state: 'here', reason: null, sinceMs: nowMs - HOUR_MS },
    busy: { state: 'accepts', atMs: nowMs },
    nowMs,
  }
  return {
    kind: 'voice-tick',
    forceTiming,
    view: {
      run: { id: 1, user: null },
      situation,
      threads: { threads: { threads: [] } },
      local: { dayKey: '2023-11-14', minuteOfDay: 16 * 60 },
      sessionId: 'session-1',
      signals: { userSpeaking: false, userTyping: false, characterSpeaking: false, generating: false, queued: 0, desktopFresh: true, foregroundFresh: true, stageVisible: true },
      settings: { enabled: true, chattiness: 0.5, dontDisturb: false, quietApps: [], speakDuringGames: true },
      moodFactor: 1,
      unpromptedPending: false,
    },
  }
}

const report: NaturalCaptureResult['report'] = { metrics: {}, hardFailures: [], warnings: [], score: 100, pass: true }

describe('useMotionQaBridge', () => {
  let pinia: ReturnType<typeof createPinia>
  let scope: ReturnType<typeof effectScope>
  let log: string[]
  let clock: ReturnType<typeof controlledFrames>
  let dispatch: (command: unknown) => Promise<{ ok: boolean, result?: unknown, error?: string, issues?: { path: string }[] }>
  let chat: ReturnType<typeof createChatHooks>
  const voicing = ref(false)
  const mode = ref<PerformanceMode>('idle')
  let deleteAllData: () => Promise<void>
  let performanceInputs: PerformanceInputs
  let mind: CharacterMind
  /** Epoch milliseconds of the mind's clock; a test moves it by hand. */
  let mindNowMs: number
  let idle: ReturnType<typeof createEventHook<IdleBehaviourReport>>
  let evaluateVoice: Mock<() => Promise<SituationGateEvaluation>>

  /** Stands in for the capture that Model.vue runs: scenario events stamped into it land in the log. */
  function recordCaptureMarks() {
    useNaturalMotionDiagnostics().setCaptureMarker(event => log.push(event.kind === 'marker' ? `mark:marker:${event.label}` : `mark:${event.kind}`))
  }

  beforeEach(() => {
    vi.stubGlobal('window', { screenX: -1200, screenY: 20, devicePixelRatio: 1.5 })
    pinia = createPinia()
    setActivePinia(pinia)
    log = []
    clock = controlledFrames()
    chat = createChatHooks()
    mindNowMs = 1_700_000_000_000
    // Seed 17 speaks the protest of the first burst of three pokes.
    mind = new CharacterMind({ seed: 17, clock: () => mindNowMs })
    idle = createEventHook<IdleBehaviourReport>()
    evaluateVoice = vi.fn(async (): Promise<SituationGateEvaluation> => ({ status: 'skipped', reason: 'gate-not-running' }))
    voicing.value = false
    mode.value = 'idle'
    deleteAllData = async () => {
      log.push('delete-all-data')
    }
    performanceInputs = { nowMs: 0, speaking: false, userSpeaking: false, generating: false, cursorMovedAtMs: null, desktop: null, userTurnAtMs: null, visible: true, override: null, cueAttention: null, foregroundCategory: null }
    const streaming = useLlmStreamingControlStore()
    const dispatcher = createMotionQaDispatcher()
    dispatch = async command => JSON.parse(await dispatcher(JSON.stringify(command)))
    scope = effectScope()
    scope.run(() => {
      // Stage.vue enqueues a parsed ACT emotion from this signal; the recording queue stands in for its emotion queue.
      streaming.onSignal(async (signal) => {
        if (signal.type === 'act')
          log.push(`queue:${normalizeActPayload(signal.payload).emotion?.name}:act`)
      })
      watch(() => useNaturalPerformanceOverride().overrideMode, mode => log.push(`mode:${mode}`), { flush: 'sync' })
      useMotionQaBridge({
        chat,
        sendChat: async (text) => { log.push(`send:${text}`) },
        voicing: () => voicing.value,
        mind,
        onIdle: idle.on,
        emotionsQueue: { enqueue: cue => log.push(`queue:${cue.emotion.name}:${cue.source}:${cue.emotion.intensity}`) },
        dispatchAct: marker => streaming.dispatchWith(marker),
        renderError: () => undefined,
        chatRead: (cue, words) => log.push(`chat-read:${cue}:${words}`),
        performance: () => ({ inputs: performanceInputs, state: { ...resolvePerformanceState(performanceInputs, initialResolverMemory).state, mode: mode.value } }),
        evaluateVoice: () => evaluateVoice(),
        deleteAllData: () => deleteAllData(),
        frames: clock.frames,
      })
    })
  })

  it('sends user text through the supplied real send boundary', async () => {
    expect(await dispatch({ name: 'chatSend', input: { text: 'hello' } })).toEqual({ ok: true, result: { sent: true } })
    expect(log).toEqual(['send:hello'])
  })

  it('runs delete all data through the supplied maintenance call and reports the first failure as a result', async () => {
    expect(await dispatch({ name: 'deleteAllData' })).toEqual({ ok: true, result: { ok: true } })
    expect(log).toEqual(['delete-all-data'])

    deleteAllData = async () => {
      throw new Error('Model storage unavailable')
    }
    expect(await dispatch({ name: 'deleteAllData' })).toEqual({ ok: true, result: { ok: false, error: 'Model storage unavailable' } })

    deleteAllData = async () => {
      // An Error whose message is empty, as some DOM and driver errors are.
      throw Object.assign(new Error('placeholder'), { message: '' })
    }
    expect(await dispatch({ name: 'deleteAllData' })).toEqual({ ok: true, result: { ok: false, error: 'unknown error' } })
  })

  it('records turn boundaries and truncates assistant text', async () => {
    const context = { sessionId: 'session', turnId: 'turn', message: { role: 'user' as const, content: 'hello' }, contexts: {}, composedMessage: [] }
    await chat.emitBeforeMessageComposedHooks('hello', context)
    await chat.emitChatTurnCompleteHooks({ output: { role: 'assistant', content: 'reply', slices: [], tool_results: [] }, outputText: 'r'.repeat(700), toolCalls: [] }, context)
    expect(await dispatch({ name: 'events', input: {} })).toMatchObject({
      result: { events: [
        { kind: 'turn', payload: { phase: 'start', turnId: 'turn' } },
        { kind: 'turn', payload: { phase: 'end', turnId: 'turn', text: 'r'.repeat(500) } },
      ] },
    })
  })

  it('records parsed ACT, applied expressions and playback transitions with cursors', async () => {
    await useLlmStreamingControlStore().dispatchWith('<|ACT {"emotion":"happy","gesture":"nod"}|>')
    const runtime = usePerformanceRuntimeState()
    runtime.publish({ exposed: [], exposedActions: [], active: [{ slot: 'face', label: 'smile' }], mood: null })
    voicing.value = true
    voicing.value = false
    expect(await dispatch({ name: 'events', input: {} })).toMatchObject({
      ok: true,
      result: { lastSeq: 4, dropped: 0, events: [
        { seq: 1, kind: 'act', payload: { emotion: 'happy', gesture: 'nod' } },
        { seq: 2, kind: 'expression', payload: { phase: 'start', label: 'smile' } },
        { seq: 3, kind: 'tts', payload: { phase: 'start' } },
        { seq: 4, kind: 'tts', payload: { phase: 'end' } },
      ] },
    })
    expect(await dispatch({ name: 'events', input: { sinceSeq: 3 } })).toMatchObject({ result: { events: [{ seq: 4 }] } })
  })

  it('records each step of the mind with its stimulus, its intents, and its voice decision, and no content', async () => {
    type Touch = Extract<MindStimulus, { kind: 'touch' }>
    const settings = defaultExpressionPerformanceSettings
    const pokeTimesMs: number[] = []
    function poke(): Touch {
      pokeTimesMs.push(mindNowMs)
      const voice: TouchVoiceView = { sessionId: 'session-1', eventId: 'touch-event', pet: null, pokeTimesMs: [...pokeTimesMs], lastCharacterLineAtMs: null, held: null }
      return { kind: 'touch', gesture: 'poke', region: 'head', point: { x: 0.2, y: -0.4 }, settings, voice }
    }

    mind.receive({ kind: 'touch', gesture: 'pet-start', region: 'head', settings, voice: null })
    mindNowMs += 5_000
    mind.receive(poke())
    mindNowMs += 1_000
    mind.receive(poke())
    mindNowMs += 1_000
    mind.receive(poke())
    mind.receive({ kind: 'voice-outcome', turnId: 'reaction:touch-event', outcome: 'spoken' })

    const reply = await dispatch({ name: 'events', input: {} }) as { ok: boolean, result: { events: { kind: string, payload: Record<string, string | null> }[] } }
    expect(reply.ok).toBe(true)
    const steps = reply.result.events.map(event => ({ kind: event.kind, ...event.payload, intents: JSON.parse(event.payload.intents ?? '') as unknown }))
    expect(steps).toEqual([
      {
        kind: 'mind',
        stimulus: 'touch',
        gesture: 'pet-start',
        outcome: null,
        intents: [
          { channel: 'posture', kind: 'touch-reaction', id: '1-touch-reaction', cause: 1 },
          { channel: 'posture', kind: 'mood', id: '1-mood', cause: 1 },
          { channel: 'body', kind: 'attend', id: '1-attend', cause: 1, windowMs: 60_000 },
        ],
        voice: null,
        voiceLine: null,
        voiceReason: null,
        lines: null,
        cues: null,
        music: null,
      },
      {
        kind: 'mind',
        stimulus: 'touch',
        gesture: 'poke',
        outcome: null,
        intents: [
          { channel: 'posture', kind: 'touch-reaction', id: '2-touch-reaction', cause: 2 },
          { channel: 'posture', kind: 'mood', id: '2-mood', cause: 2 },
          { channel: 'face', kind: 'moment', id: '2-moment', cause: 2 },
          { channel: 'body', kind: 'attend', id: '2-attend', cause: 2, windowMs: 60_000 },
        ],
        voice: 'hold',
        voiceLine: 'poke-protest',
        voiceReason: 'poke-count',
        lines: null,
        cues: null,
        music: null,
      },
      expect.objectContaining({ gesture: 'poke', voice: 'hold', voiceReason: 'poke-count' }),
      {
        kind: 'mind',
        stimulus: 'touch',
        gesture: 'poke',
        outcome: null,
        intents: [
          { channel: 'posture', kind: 'touch-reaction', id: '4-touch-reaction', cause: 4 },
          { channel: 'posture', kind: 'mood', id: '4-mood', cause: 4 },
          { channel: 'face', kind: 'moment', id: '4-moment', cause: 4 },
          { channel: 'voice', kind: 'speak', id: '4-speak', cause: 4 },
          { channel: 'body', kind: 'attend', id: '4-attend', cause: 4, windowMs: 60_000 },
        ],
        voice: 'speak',
        voiceLine: 'poke-protest',
        voiceReason: null,
        lines: 'reaction',
        cues: null,
        music: null,
      },
      { kind: 'mind', stimulus: 'voice-outcome', gesture: null, outcome: 'spoken', intents: [], voice: null, voiceLine: null, voiceReason: null, lines: null, cues: null, music: null },
    ])
    // Neither the poke's point nor the situation's event and session ids leave the window.
    expect(JSON.stringify(reply)).not.toMatch(/touch-event|session-1|-0\.4/)
  })

  it('records a presence step with its away state and wake cause, and each idle report', async () => {
    mind.receive({ kind: 'presence', away: true, wake: null })
    await idle.trigger({ phase: 'start', behaviour: 'sleep' })
    mindNowMs += 60_000
    mind.receive({ kind: 'presence', away: false, wake: { cause: 'unlock', atMs: mindNowMs } })
    await idle.trigger({ phase: 'end', behaviour: 'sleep' })

    const reply = await dispatch({ name: 'events', input: {} }) as { result: { events: { kind: string, payload: Record<string, unknown> }[] } }
    expect(reply.result.events.map(({ kind, payload }) => ({ kind, ...payload, intents: undefined }))).toEqual([
      expect.objectContaining({ kind: 'mind', stimulus: 'presence', away: true, wake: null }),
      { kind: 'idle', phase: 'start', behaviour: 'sleep', intents: undefined },
      expect.objectContaining({ kind: 'mind', stimulus: 'presence', away: false, wake: 'unlock' }),
      { kind: 'idle', phase: 'end', behaviour: 'sleep', intents: undefined },
    ])
  })

  it('records a music step with the edge it carries', async () => {
    mind.receive({ kind: 'music', playing: true })
    mindNowMs += 10_000
    mind.receive({ kind: 'music', playing: false })

    const reply = await dispatch({ name: 'events', input: {} }) as { result: { events: { kind: string, payload: Record<string, unknown> }[] } }
    expect(reply.result.events.map(({ kind, payload }) => ({ kind, stimulus: payload.stimulus, intents: payload.intents, music: payload.music }))).toEqual([
      { kind: 'mind', stimulus: 'music', intents: '[]', music: true },
      { kind: 'mind', stimulus: 'music', intents: '[]', music: false },
    ])
  })

  it('records a cursor step with its band, opportunity, and the episode it drew', async () => {
    mind.receive({ kind: 'cursor', report: { requestId: 3, band: 'near', opportunity: 'appeared' } })

    const reply = await dispatch({ name: 'events', input: {} }) as { result: { events: { kind: string, payload: Record<string, unknown> }[] } }
    expect(reply.result.events).toEqual([expect.objectContaining({ kind: 'mind', payload: expect.objectContaining({ stimulus: 'cursor', band: 'near', opportunity: 'appeared' }) })])
    expect(JSON.parse(reply.result.events[0].payload.intents as string)).toEqual([expect.objectContaining({ channel: 'gaze', kind: 'cursor-episode', band: 'near', engaging: true })])
  })

  it('records an interaction step with its source and the attend window it opened', async () => {
    mind.receive({ kind: 'interaction', source: 'drag' })

    const reply = await dispatch({ name: 'events', input: {} }) as { result: { events: { kind: string, payload: Record<string, unknown> }[] } }
    expect(reply.result.events).toEqual([expect.objectContaining({ kind: 'mind', payload: expect.objectContaining({ stimulus: 'interaction', source: 'drag' }) })])
    expect(JSON.parse(reply.result.events[0].payload.intents as string)).toEqual([expect.objectContaining({ channel: 'body', kind: 'attend', windowMs: 60_000 })])
  })

  it('records a chat step with its cue and the read it decided, never the message', async () => {
    mind.receive({ kind: 'chat', cue: 'sent', words: 4 })

    const reply = await dispatch({ name: 'events', input: {} }) as { result: { events: { kind: string, payload: Record<string, unknown> }[] } }
    expect(reply.result.events).toEqual([expect.objectContaining({ kind: 'mind', payload: expect.objectContaining({ stimulus: 'chat', chat: 'sent' }) })])
    expect(JSON.parse(reply.result.events[0].payload.intents as string)).toEqual([
      expect.objectContaining({ channel: 'gaze', kind: 'chat-read', cue: 'sent', words: 4 }),
      expect.objectContaining({ channel: 'body', kind: 'attend', windowMs: 60_000 }),
    ])
  })

  it('records a cue gesture step with the gesture it decided', async () => {
    mind.receive({ kind: 'cue-gesture', gesture: 'glance', count: 1, source: 'devtools' })

    const reply = await dispatch({ name: 'events', input: {} }) as { result: { events: { kind: string, payload: Record<string, unknown> }[] } }
    expect(reply.result.events).toEqual([expect.objectContaining({ kind: 'mind', payload: expect.objectContaining({ stimulus: 'cue-gesture' }) })])
    expect(JSON.parse(reply.result.events[0].payload.intents as string)).toEqual([expect.objectContaining({ channel: 'posture', kind: 'gesture', gesture: 'glance', count: 1 })])
  })

  it('records a gate tick with its gate reason, fired category, line kind, and cues, a decline with its cue, and skips an unforced tick that yields nothing', async () => {
    // A new run eases her in, so the first unforced tick holds without an intent.
    mind.receive(voiceTick(false, mindNowMs))
    mindNowMs += 2_000
    mind.receive(voiceTick(true, mindNowMs))
    // The reach-out line is open, so the forced tick skips the gate.
    mindNowMs += 2_000
    mind.receive(voiceTick(true, mindNowMs))
    const turnId = mind.state.voice.line?.turnId
    if (!turnId)
      throw new Error('The forced tick opened no line')
    mind.receive({ kind: 'voice-outcome', turnId, outcome: 'declined' })

    const reply = await dispatch({ name: 'events', input: {} }) as { result: { events: { kind: string, payload: Record<string, unknown> }[] } }
    expect(reply.result.events.map(({ kind, payload }) => ({ kind, ...payload }))).toEqual([
      expect.objectContaining({ kind: 'mind', stimulus: 'voice-tick', gate: 'forced', category: 'open', intents: expect.stringContaining('"kind":"speak"'), lines: 'reach-out', cues: 'about-to-speak' }),
      expect.objectContaining({ kind: 'mind', stimulus: 'voice-tick', gate: null, category: null, intents: '[]', lines: null, cues: null }),
      expect.objectContaining({ kind: 'mind', stimulus: 'voice-outcome', outcome: 'declined', lines: null, cues: 'let-go' }),
    ])
    expect(JSON.stringify(reply)).not.toMatch(/session-1/)
  })

  it('skips an idle step that yields no intent', async () => {
    // No stage has reported an idle view, so the mind has nothing to order.
    mind.receive({ kind: 'idle', reports: [] })
    mind.receive({ kind: 'idle-wake' })

    const reply = await dispatch({ name: 'events', input: {} }) as { result: { events: unknown[] } }
    expect(reply.result.events).toEqual([])
  })

  it('serves voiceEvaluate with the leader evaluation as plain JSON', async () => {
    expect(await dispatch({ name: 'voiceEvaluate' })).toEqual({ ok: true, result: { status: 'skipped', reason: 'gate-not-running' } })
    mind.receive(voiceTick(true, mindNowMs))
    const { lastGate: decision, gate: memory } = mind.state.voice
    if (!decision || !memory)
      throw new Error('The forced tick did not evaluate the gate')
    evaluateVoice.mockResolvedValueOnce({ status: 'evaluated', decision, memory })
    const reply = await dispatch({ name: 'voiceEvaluate' })
    expect(reply).toMatchObject({ ok: true, result: { status: 'evaluated', decision: { fire: true, reason: 'forced', category: 'open' } } })
    expect(reply.result).toEqual(JSON.parse(JSON.stringify({ status: 'evaluated', decision, memory })))
  })

  it('evicts old records from its bounded window and removes subscriptions on disposal', async () => {
    for (let index = 0; index < 514; index++)
      voicing.value = !voicing.value
    const reply = await dispatch({ name: 'events', input: {} })
    expect(reply).toMatchObject({ result: { lastSeq: 514, dropped: 2, events: expect.arrayContaining([{ seq: 3, time: expect.any(Number), kind: 'tts', payload: { phase: 'start' } }]) } })
    expect((reply.result as { events: unknown[] }).events).toHaveLength(512)
    scope.stop()
    voicing.value = !voicing.value
    expect(await dispatch({ name: 'events', input: {} })).toMatchObject({ ok: false })
  })

  afterEach(async () => {
    scope.stop()
    useSettingsLive2d().resetState()
    await useLive2DNaturalSettings().reset()
    disposePinia(pinia)
    vi.unstubAllGlobals()
  })

  it('writes the settings that configure names and reports them back', async () => {
    const reply = await dispatch({ name: 'configure', input: { driver: 'natural', cursorAttention: false, expressionEnabled: true, heldEmotions: false } })

    const live2d = useSettingsLive2d()
    expect([live2d.live2dMotionDriver, useLive2DNaturalSettings().document.cursorAttention, live2d.live2dExpressionEnabled]).toEqual(['natural', false, true])
    expect(useExpressionPerformanceSettings().document.heldEmotions).toBe(false)
    expect(reply).toMatchObject({ ok: true, result: { driver: 'natural', cursorAttention: false, expressionEnabled: true, heldEmotions: false, captureActive: false, head: null, screen: { x: -1200, y: 20, devicePixelRatio: 1.5 } } })
  })

  it('writes the screen-aware setting and reports it back', async () => {
    const natural = useLive2DNaturalSettings()
    expect(natural.document.screenAwareness).toBe(true)

    expect(await dispatch({ name: 'configure', input: { screenAwareness: false } })).toMatchObject({ ok: true, result: { screenAwareness: false } })
    expect(natural.document.screenAwareness).toBe(false)
    // Omitting the field leaves the setting as it is.
    expect(await dispatch({ name: 'configure', input: {} })).toMatchObject({ ok: true, result: { screenAwareness: false } })
    expect(await dispatch({ name: 'configure', input: { screenAwareness: true } })).toMatchObject({ ok: true, result: { screenAwareness: true } })
    expect(natural.document.screenAwareness).toBe(true)
  })

  it('reports the placement the stage last handed to Natural and the applied yaw bias', async () => {
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { placement: null, placementYawBias: 0 } })

    useNaturalMotionDiagnostics().reportPlacement(-0.8, -0.0973)
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { placement: -0.8, placementYawBias: -0.0973 } })

    useNaturalMotionDiagnostics().reportPlacement(null, 0)
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { placement: null, placementYawBias: 0 } })
  })

  it('reports the chat input the stage last handed to Natural as flags', async () => {
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { chat: null } })

    const diagnostics = useNaturalMotionDiagnostics()
    diagnostics.reportChat({ target: { x: -3, y: -1 }, typing: true })
    const reply = await dispatch({ name: 'state' })
    // The target point stays inside the stage; the bridge only says whether a target exists.
    expect(reply).toMatchObject({ ok: true, result: { chat: { hasTarget: true, typing: true } } })
    expect(Object.keys((reply as { result: { chat: object } }).result.chat).sort()).toEqual(['hasTarget', 'typing'])

    diagnostics.reportChat({ target: null, typing: false })
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { chat: { hasTarget: false, typing: false } } })

    diagnostics.reportChat(null)
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { chat: null } })
  })

  it('reads the host snapshot, desktop idle and resolved mode from the live stores on every call', async () => {
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { host: null, desktopIdleSeconds: null, performanceMode: 'idle' } })

    const host = capabilitiesForHost('linux-xwayland')
    useHostCapabilitiesStore().set(host)
    useDesktopActivityStore().setSnapshot({ idleSeconds: 42, locked: false, suspendedAtMs: null, resumedAtMs: null, unlockedAtMs: null, systemAudioLevel: null, screenChange: null, sampledAtMs: 0 })
    mode.value = 'watching'
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { host, desktopIdleSeconds: 42, performanceMode: 'watching' } })

    useDesktopActivityStore().setSnapshot({ idleSeconds: 43, locked: false, suspendedAtMs: null, resumedAtMs: null, unlockedAtMs: null, systemAudioLevel: null, screenChange: null, sampledAtMs: 0 })
    useHostCapabilitiesStore().reset()
    mode.value = 'talking'
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { host: null, desktopIdleSeconds: 43, performanceMode: 'talking' } })
  })

  it('reports the foreground sample without its title, path or pid', async () => {
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { foreground: null } })
    useForegroundWindowStore().setSample({ exePath: '/usr/bin/konsole', exeName: 'konsole', title: 'secret title', pid: 42, ownProcess: false, busy: 'fullscreen', sampledAtMs: 1 })
    const reply = await dispatch({ name: 'state' }) as { ok: boolean, result: { foreground: object } }
    expect(reply.result.foreground).toEqual({ exeName: 'konsole', busy: 'fullscreen', ownProcess: false })
    expect(JSON.stringify(reply)).not.toContain('secret title')
    useForegroundWindowStore().reset()
    expect(await dispatch({ name: 'state' })).toMatchObject({ result: { foreground: null } })
  })

  it('reports the stage face-feature head unit without applying another scale', async () => {
    const head = { x: 100, y: 50, width: 80, height: 100 }
    const release = useNaturalMotionDiagnostics().registerStageReader(() => ({ naturalActive: true, hold: null, head }))
    expect(await dispatch({ name: 'state' })).toMatchObject({ ok: true, result: { head, screen: { x: -1200, y: 20, devicePixelRatio: 1.5 } } })
    release()
  })

  it('serializes the last resolver inputs and actual away state without substituting newer desktop readings', async () => {
    const desktop = { idleSeconds: 301, locked: false, suspendedAtMs: null, resumedAtMs: null, unlockedAtMs: null, systemAudioLevel: 0.2, screenChange: 0.3, sampledAtMs: 301_000 }
    performanceInputs = { ...performanceInputs, nowMs: 301_250, cursorMovedAtMs: 1000, desktop }
    useDesktopActivityStore().setSnapshot({ ...desktop, idleSeconds: 0, sampledAtMs: 302_000 })

    expect(await dispatch({ name: 'state' })).toMatchObject({
      ok: true,
      result: {
        performanceMode: 'idle',
        desktopIdleSeconds: 0,
        performance: { away: true, resolvedAtMs: 301_250, cursorMovedAtMs: 1000, desktop },
      },
    })

    performanceInputs = { ...performanceInputs, nowMs: 302_250, desktop: null, cursorMovedAtMs: null }
    expect(await dispatch({ name: 'state' })).toMatchObject({
      result: { performance: { away: false, resolvedAtMs: 302_250, cursorMovedAtMs: null, desktop: null } },
    })
  })

  it('dispatches emotion, ACT and mode events in scenario order through the real paths', async () => {
    recordCaptureMarks()
    const reply = drive(clock, dispatch({ name: 'runScenario', input: { scenario: scenario([
      { kind: 'emotion', at: 1, emotion: 'happy', band: 'clear', source: 'devtools' },
      { kind: 'act', at: 2, marker: '<|ACT {"emotion":"angry"}|>' },
      { kind: 'mode', at: 3, mode: 'thinking', energy: 0.4 },
      { kind: 'expression', at: 3.2, expressionId: 'missing', on: true },
      { kind: 'marker', at: 3.5, label: 'end' },
    ]) } }))

    expect(await reply).toEqual({ ok: true, result: { dispatched: 4, rejected: [{ at: 3.2, kind: 'expression', reason: expect.any(String) }] } })
    const clear = useExpressionPerformanceSettings().document.intensity.clear
    expect(log).toEqual([`queue:happy:devtools:${clear}`, 'mark:emotion', 'queue:angry:act', 'mark:act', 'mode:thinking', 'mark:mode', 'mark:marker:end'])
    expect(useNaturalPerformanceOverride().performanceOverride).toEqual({ mode: 'thinking', energy: 0.4 })
  })

  it('rejects speech events that reach the handler without dispatching them', async () => {
    recordCaptureMarks()
    const run = defineInvoke(createMotionQaContext(), motionQaRunScenarioInvokeEventa)
    const reply = drive(clock, run({ scenario: scenario([
      { kind: 'speech', at: 1, turnId: 'turn', seconds: 2, envelopeSeed: 1 },
      { kind: 'marker', at: 1.5, label: 'after' },
    ]) }))

    expect(await reply).toEqual({ dispatched: 1, rejected: [{ at: 1, kind: 'speech', reason: expect.any(String) }] })
    expect(log).toEqual(['mark:marker:after'])
  })

  it.each([
    { kind: 'placement', at: 1, inward: 1 },
    { kind: 'pointer', at: 1, phase: 'move', x: 1, y: 0 },
    { kind: 'mode', at: 1, mode: 'watching' },
  ] satisfies MotionScenario['events'])('refuses a host-profile $kind even when the dispatcher is bypassed', async (event) => {
    useHostCapabilitiesStore().set(capabilitiesForHost('linux-wayland'))
    recordCaptureMarks()
    const run = defineInvoke(createMotionQaContext(), motionQaRunScenarioInvokeEventa)
    const input = { ...scenario([event]), settings: { host: 'linux-wayland' as const } }

    expect(await drive(clock, run({ scenario: input }))).toEqual({
      dispatched: 0,
      rejected: [{ at: 1, kind: event.kind, reason: expect.stringContaining(event.kind) }],
    })
    expect(log.filter(line => line.startsWith('mark:'))).toEqual([])
  })

  it.each([null, 'windows'] as const)('refuses a declared host that differs from live host %s', async (host) => {
    if (host)
      useHostCapabilitiesStore().set(capabilitiesForHost(host))
    const reply = await dispatch({ name: 'runScenario', input: { scenario: { ...scenario([]), settings: { host: 'linux-wayland' } } } })
    expect(reply).toMatchObject({ ok: false, error: expect.stringContaining('host-mismatch') })
  })

  it('clears earlier overrides before a host-profile run and leaves real placement and chat flowing', async () => {
    useHostCapabilitiesStore().set(capabilitiesForHost('linux-wayland'))
    await drive(clock, dispatch({ name: 'runScenario', input: { scenario: scenario([
      { kind: 'mode', at: 0, mode: 'thinking', energy: 0.8 },
      { kind: 'placement', at: 0, inward: 1 },
      { kind: 'chat-typing', at: 0, active: true },
    ]) } }))
    const override = useNaturalPerformanceOverride()
    expect(override.performanceOverride).toEqual({ mode: 'thinking', energy: 0.8 })

    expect(await drive(clock, dispatch({ name: 'runScenario', input: { scenario: { ...scenario([]), settings: { host: 'linux-wayland' } } } }))).toMatchObject({ ok: true })

    expect([override.overrideEnabled, override.overrideMode, override.overrideEnergy, override.performanceOverride]).toEqual([false, null, null, null])
    const diagnostics = useNaturalMotionDiagnostics()
    expect([diagnostics.placementOverride, diagnostics.chatOverride]).toEqual([undefined, undefined])
  })

  it.each([undefined, 'desk', 'product'] as const)('applies scenario home %s before dispatch and retains it until disposal', async (home) => {
    const diagnostics = useNaturalMotionDiagnostics()
    expect(diagnostics.postureHome).toBe('product')
    diagnostics.setPostureHome(home === 'product' ? 'desk' : 'product')
    scope.run(() => watch(() => diagnostics.postureHome, value => log.push(`home:${value}`), { flush: 'sync' }))
    const input = { ...scenario([{ kind: 'emotion', at: 0, emotion: 'happy' as const, band: 'clear' as const, source: 'devtools' as const }]), home }
    expect(await drive(clock, dispatch({ name: 'runScenario', input: { scenario: input } }))).toMatchObject({ ok: true })
    expect(diagnostics.postureHome).toBe(home ?? 'desk')
    expect(log[0]).toBe(`home:${home ?? 'desk'}`)
    expect(log.at(-1)).toContain('queue:happy:')
    scope.stop()
    expect(diagnostics.postureHome).toBe('product')
  })

  it('pins the placement and chat overrides to no signal for a scenario without those events, and hands them back on disposal', async () => {
    const diagnostics = useNaturalMotionDiagnostics()
    expect([diagnostics.placementOverride, diagnostics.chatOverride]).toEqual([undefined, undefined])

    expect(await drive(clock, dispatch({ name: 'runScenario', input: { scenario: scenario([{ kind: 'marker', at: 1, label: 'only' }]) } }))).toMatchObject({ ok: true })
    // `null`, not `undefined`: the real window placement and chat activity never reach a scenario.
    expect(diagnostics.placementOverride).toBeNull()
    expect(diagnostics.chatOverride).toBeNull()

    scope.stop()
    expect(diagnostics.placementOverride).toBeUndefined()
    expect(diagnostics.chatOverride).toBeUndefined()
  })

  it('drives the placement and chat overrides from scenario events and sends chat reads through the stage', async () => {
    const diagnostics = useNaturalMotionDiagnostics()
    // Stale values from an earlier run must not leak into the next scenario.
    diagnostics.placementOverride = 0.5
    diagnostics.chatOverride = { target: { x: 1, y: 1 }, typing: true }
    scope.run(() => {
      watch(() => diagnostics.placementOverride, value => log.push(`placement:${value}`), { flush: 'sync' })
      watch(() => diagnostics.chatOverride, value => log.push(`chat:${JSON.stringify(value)}`), { flush: 'sync' })
    })

    const reply = await drive(clock, dispatch({ name: 'runScenario', input: { scenario: scenario([
      { kind: 'placement', at: 1, inward: 1 },
      { kind: 'chat-target', at: 2, x: -3, y: -1 },
      { kind: 'chat-typing', at: 2, active: true },
      { kind: 'chat-sent', at: 3, words: 8 },
      { kind: 'chat-target', at: 4, clear: true },
      { kind: 'chat-unfold', at: 5 },
      { kind: 'placement', at: 6, inward: null },
    ]) } }))

    expect(reply).toEqual({ ok: true, result: { dispatched: 7, rejected: [] } })
    expect(log).toEqual([
      'placement:null',
      'chat:null',
      'placement:1',
      'chat:{"target":{"x":-3,"y":-1},"typing":false}',
      'chat:{"target":{"x":-3,"y":-1},"typing":true}',
      'chat-read:sent:8',
      'chat:{"target":null,"typing":true}',
      'chat-read:unfold:0',
      'placement:null',
    ])
  })

  it('returns schema errors as replies with their paths', async () => {
    const reply = await dispatch({ name: 'configure', input: { driver: 'magic' } })
    expect(reply.ok).toBe(false)
    expect(reply.issues?.map(issue => issue.path)).toEqual(['input.driver'])

    const t1Only = await dispatch({ name: 'runScenario', input: { scenario: { ...scenario([]), levels: ['t1'] } } })
    expect(t1Only).toEqual({ ok: false, error: expect.stringContaining('t3') })
  })

  it('fails a capture that no stage model starts and leaves nothing pending', async () => {
    const reply = await dispatch({ name: 'startCapture', input: { durationSeconds: 5, label: 'idle' } })

    expect(reply.ok).toBe(false)
    expect(useNaturalMotionDiagnostics().pendingRequest).toBeNull()
  })

  it('starts a capture with rig parameters and returns its trace when the stage completes it', async () => {
    const diagnostics = useNaturalMotionDiagnostics()
    // Stands in for Model.vue, which starts sampling when a request arrives.
    const stopStage = watch(() => diagnostics.pendingRequest, (request) => {
      if (request)
        recordCaptureMarks()
    })

    const started = await dispatch({ name: 'startCapture', input: { durationSeconds: 5, extraParameterIds: ['Param60'], label: 'idle' } })
    const captureId = diagnostics.pendingRequest?.id
    if (!captureId)
      throw new Error('the capture must be pending')
    expect(started).toEqual({ ok: true, result: { captureId } })
    expect(diagnostics.pendingRequest?.extraParameterIds).toEqual(['Param60'])
    expect(log).toEqual(['mark:marker:capture:idle'])

    const awaited = dispatch({ name: 'awaitCapture', input: { captureId } })
    const trace = { version: 2 as const, t: [0], channels: { Param60: [1] }, ranges: { Param60: { min: 0, max: 1, default: 0 } }, events: [], meta: { model: 'rig', driver: 'natural', energy: 0.5, home: 'desk' as const, adapter: { weightMean: 1, bodyWrites: 0, physicsOutputSkips: 0 }, capturedAt: '2026-10-20T00:00:00.000Z', durationSeconds: 5 } }
    diagnostics.completeCapture(captureId, trace, report)

    expect(await awaited).toEqual({ ok: true, result: { trace } })
    expect(await dispatch({ name: 'awaitCapture', input: { captureId } })).toEqual({ ok: false, error: expect.any(String) })
    stopStage()
  })
})
