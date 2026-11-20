import type { MindStep, VoiceView } from '@proj-airi/character-mind'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { VoicePort, VoiceStimulus } from '../composables/performance/mind-voice'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { initialSituationState } from '@proj-airi/stage-shared/situation'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isReactive } from 'vue'

import { useCharacterMindStore } from './character-mind'
import { useSituationObservabilityStore } from './devtools/situation-observability'

// The mind store reaches the situation store only through the voice port, and the character state store only through
// `ready`. Both real stores need the chat runtime and IndexedDB. Plain objects keep the port's spies unwrapped by Pinia.
const voice = vi.hoisted(() => ({ port: undefined as VoicePort | undefined }))
vi.mock('./situation', () => ({ useSituationStore: () => voice.port }))
vi.mock('./character-state', () => ({ useCharacterStateStore: () => ({ ready: async () => {} }) }))

function fakePort() {
  return {
    observeTouch: vi.fn<VoicePort['observeTouch']>(() => null),
    observeReturn: vi.fn<VoicePort['observeReturn']>(),
    speak: vi.fn<VoicePort['speak']>(async () => 'spoken'),
    cancel: vi.fn<VoicePort['cancel']>(),
    drop: vi.fn<VoicePort['drop']>(),
    publishVoice: vi.fn<VoicePort['publishVoice']>(),
    connect: vi.fn<VoicePort['connect']>(() => vi.fn()),
  }
}

let port: ReturnType<typeof fakePort>

/** A synced runtime whose leadership the test flips. It reports the current role on subscribe, like the plugin. */
function createLeadership(initiallyLeader: boolean) {
  let isLeader = initiallyLeader
  const listeners = new Set<(isLeader: boolean) => void>()
  const runtime: SyncedPiniaRuntime = {
    addRole: vi.fn(() => vi.fn()),
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
    getParticipants: vi.fn(() => []),
    getRoles: vi.fn(() => []),
    isLeader: () => isLeader,
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      listeners.add(listener)
      listener(isLeader)
      return () => listeners.delete(listener)
    }),
    participantId: 'character-mind-test',
    plugin: vi.fn(),
  }
  return {
    runtime,
    set(next: boolean) {
      isLeader = next
      for (const listener of listeners)
        listener(next)
    },
  }
}

const T0 = 10_000

/** A view from the gate's first run: a user at the desk who accepts remarks, at the mind's clock. */
function view(): VoiceView {
  return {
    run: { id: 1, memory: null, saved: null },
    situation: { ...initialSituationState, presence: { state: 'here', reason: null, sinceMs: 0 }, busy: { state: 'accepts', atMs: T0 }, nowMs: T0 },
    threads: { threads: { threads: [] } },
    local: { dayKey: '1970-01-01', minuteOfDay: 16 * 60 },
    sessionId: 'chat-a',
    signals: { userSpeaking: false, userTyping: false, characterSpeaking: false, generating: false, queued: 0, desktopFresh: true, foregroundFresh: true, stageVisible: true },
    settings: { enabled: true, chattiness: 0.5, dontDisturb: false, quietApps: [], speakDuringGames: true },
    moodFactor: 1,
    unpromptedPending: false,
  }
}

/** Lets the promotion's wait for the character state finish; only `Date` is faked. */
function flush() {
  return new Promise(resolve => setImmediate(resolve))
}

/** Promotes the store and returns the voice port's send of its connection. */
async function connected(store: ReturnType<typeof useCharacterMindStore>) {
  store.initialize(createLeadership(true).runtime)
  await flush()
  expect(port.connect).toHaveBeenCalledOnce()
  return port.connect.mock.calls[0][0]
}

/** Resolves with the step that answers a line's outcome. */
function settled(store: ReturnType<typeof useCharacterMindStore>) {
  return new Promise<MindStep>((resolve) => {
    store.mind.onStep(step => step.stimuli.some(stimulus => stimulus.kind === 'voice-outcome') && resolve(step))
  })
}

const declinedWidget: VoiceStimulus = {
  kind: 'voice-request',
  request: { turnId: 'spark:1', topicKey: 'notify:weather', topicText: 'Rain at five', supplement: null, timeoutMs: 30_000 },
  view: { ...view(), situation: initialSituationState },
}

describe('character mind store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    port = fakePort()
    voice.port = port
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
  })

  afterEach(() => {
    useCharacterMindStore().dispose()
    vi.useRealTimers()
  })

  it('keeps the mind out of Vue reactivity', () => {
    expect(isReactive(useCharacterMindStore().mind)).toBe(false)
  })

  it('connects to the voice port on promotion and disconnects on demotion', async () => {
    const store = useCharacterMindStore()
    const disconnect = vi.fn()
    port.connect.mockReturnValue(disconnect)
    const leadership = createLeadership(false)

    store.initialize(leadership.runtime)
    await flush()
    expect(port.connect).not.toHaveBeenCalled()

    leadership.set(true)
    await flush()
    expect(port.connect).toHaveBeenCalledOnce()
    leadership.set(false)

    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('does not connect when a demotion overtakes the promotion', async () => {
    const store = useCharacterMindStore()
    const leadership = createLeadership(true)

    store.initialize(leadership.runtime)
    leadership.set(false)
    await flush()

    expect(port.connect).not.toHaveBeenCalled()
  })

  it('gives a follower a mind that answers its own stage and is not connected', () => {
    const store = useCharacterMindStore()
    store.initialize(createLeadership(false).runtime)

    store.mind.receive({ kind: 'touch', gesture: 'poke', region: 'head', point: { x: 0.2, y: -0.4 }, settings: defaultExpressionPerformanceSettings, voice: null })

    expect(store.mind.state.seq).toBe(1)
    expect(port.connect).not.toHaveBeenCalled()
  })

  it('speaks the reach-out of a gate tick with no stage attached and publishes the gate', async () => {
    const store = useCharacterMindStore()
    const send = await connected(store)
    const outcome = settled(store)

    send({ kind: 'voice-tick', forceTiming: true, view: view() })

    const turnId = store.mind.state.voice.line?.turnId
    expect(port.speak.mock.calls).toEqual([[turnId, { kind: 'reach-out', topicKey: 'own-day', topicText: expect.any(String), reason: { kind: 'own-day', category: 'open' } }]])
    expect(port.publishVoice.mock.calls).toEqual([[{ runId: 1, memory: store.mind.state.voice.gate, decision: expect.objectContaining({ fire: true }), wakeAtMs: null }]])
    await outcome
    expect(store.mind.state.voice.line).toBeNull()
    expect(port.publishVoice).toHaveBeenLastCalledWith({ runId: 1, memory: expect.objectContaining({ lastSpokenAtMs: T0 }), decision: null, wakeAtMs: null })
  })

  it('performs the cues around a declined widget line on the attached stage', async () => {
    const store = useCharacterMindStore()
    port.speak.mockResolvedValue('declined')
    const idleCue = vi.fn()
    store.attachStage({ idleCue })
    const send = await connected(store)
    const outcome = settled(store)

    send(declinedWidget)
    await outcome

    expect(port.speak).toHaveBeenCalledOnce()
    expect(idleCue.mock.calls).toEqual([['about-to-speak'], ['let-go']])
  })

  it('drops the cues with no stage attached', async () => {
    const store = useCharacterMindStore()
    port.speak.mockResolvedValue('declined')
    const idleCue = vi.fn()
    store.attachStage({ idleCue })()
    const send = await connected(store)
    const outcome = settled(store)

    send(declinedWidget)
    await outcome

    expect(port.speak).toHaveBeenCalledOnce()
    expect(idleCue).not.toHaveBeenCalled()
  })

  it('keeps the newer stage attached when the older one detaches', async () => {
    const store = useCharacterMindStore()
    port.speak.mockResolvedValue('declined')
    const older = vi.fn()
    const newer = vi.fn()
    const detachOlder = store.attachStage({ idleCue: older })
    store.attachStage({ idleCue: newer })
    detachOlder()
    const send = await connected(store)
    const outcome = settled(store)

    send(declinedWidget)
    await outcome

    expect(older).not.toHaveBeenCalled()
    expect(newer.mock.calls).toEqual([['about-to-speak'], ['let-go']])
  })

  it('feeds the reaction inspector a touch decision and clears it on dispose', () => {
    const store = useCharacterMindStore()
    const observability = useSituationObservabilityStore()
    const recordReactionDecision = vi.spyOn(observability, 'recordReactionDecision')
    const publishReactionMemory = vi.spyOn(observability, 'publishReactionMemory')

    store.mind.receive({
      kind: 'touch',
      gesture: 'poke',
      region: 'head',
      point: { x: 0.2, y: -0.4 },
      settings: defaultExpressionPerformanceSettings,
      voice: { sessionId: 'session-1', eventId: 'touch-event', pet: null, pokeTimesMs: [T0], lastCharacterLineAtMs: null, held: null },
    })
    store.dispose()

    expect(recordReactionDecision.mock.calls).toEqual([[store.mind.state.voice.lastDecision, store.mind.state.voice.reaction, T0]])
    expect(store.mind.state.voice.lastDecision).not.toBeNull()
    expect(publishReactionMemory).toHaveBeenLastCalledWith(null)
  })
})
