import type { MindStep, VoiceView } from '@proj-airi/character-mind'
import type { IdleView } from '@proj-airi/motion-driver-natural/idle-schedule'
import type { CharacterPacingMemory } from '@proj-airi/stage-shared/situation'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { Mock } from 'vitest'

import type { VoicePort, VoiceStimulus } from '../composables/performance/mind-voice'

import { LOOK_TOOL_REFRACTORY_MS, nextIdleWakeAt, NO_CAPABILITIES, SETTLE_SECONDS } from '@proj-airi/character-mind'
import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { MUSIC_SETTLE_MS } from '@proj-airi/stage-shared/music'
import { initialSituationState, userGateMemoryOf } from '@proj-airi/stage-shared/situation'
import { MMD_NATURAL_CAPABILITIES } from '@proj-airi/stage-ui-mmd/composables/mmd/natural/adapter'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isReactive, ref, shallowReactive } from 'vue'

import { useCharacterBehaviorSettings } from '../features/character-behavior/settings'
import { useCharacterMindStore } from './character-mind'
import { useSituationObservabilityStore } from './devtools/situation-observability'

const idleView: IdleView = {
  drive: { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, rate: 1 },
  active: true,
  mode: 'idle',
  away: false,
  blocked: false,
  current: null,
  errand: null,
}

// The mind store reaches the situation store through the voice port, and the character state store through
// `ready`, the leader's record and epoch, and `recordPacing`. Both real stores need the chat runtime and IndexedDB.
// Fakes keep the spies unwrapped by Pinia; the fake record is reactive like real getters.
const voice = vi.hoisted(() => ({ port: undefined as VoicePort | undefined }))
const records = vi.hoisted(() => ({ state: undefined as FakeCharacterState | undefined }))
vi.mock('./situation', () => ({ useSituationStore: () => voice.port }))
vi.mock('./character-state', () => ({ useCharacterStateStore: () => records.state }))
// The beat sync detector needs a stage runtime; the fake hands the test the store's beat listener.
const beatSync = vi.hoisted(() => ({ listeners: new Set<(event: { energy: number, interval: number }) => void>() }))
vi.mock('@proj-airi/stage-shared/beat-sync', () => ({
  isBeatSyncSupported: () => true,
  listenBeatSyncBeatSignal: (listener: (event: { energy: number, interval: number }) => void) => {
    beatSync.listeners.add(listener)
    return () => beatSync.listeners.delete(listener)
  },
}))

interface FakeCharacterState {
  leaderRecord: { cardId: string, pacing: CharacterPacingMemory | null } | null
  leaderEpoch: number
  ready: () => Promise<void>
  recordPacing: Mock<(cardId: string, epoch: number, pacing: CharacterPacingMemory | null) => Promise<void>>
}

/** The leader's character state with the active card's pacing; `replace` swaps the record as `activate` or a forget does. */
function fakeCharacterState() {
  const state = shallowReactive<FakeCharacterState>({
    leaderRecord: { cardId: 'card-a', pacing: null },
    leaderEpoch: 1,
    ready: async () => {},
    // Drops a stale write, as the real store does.
    recordPacing: vi.fn(async (cardId, epoch, pacing) => {
      if (state.leaderRecord?.cardId === cardId && epoch === state.leaderEpoch)
        state.leaderRecord = { cardId, pacing }
    }),
  })
  return Object.assign(state, {
    replace(cardId: string, pacing: CharacterPacingMemory | null) {
      state.leaderRecord = { cardId, pacing }
      state.leaderEpoch += 1
    },
  })
}

let characterState: ReturnType<typeof fakeCharacterState>

function fakePort() {
  return {
    observeTouch: vi.fn<VoicePort['observeTouch']>(() => null),
    observeReturn: vi.fn<VoicePort['observeReturn']>(),
    speak: vi.fn<VoicePort['speak']>(async () => 'spoken'),
    cancel: vi.fn<VoicePort['cancel']>(),
    drop: vi.fn<VoicePort['drop']>(),
    publishVoice: vi.fn<VoicePort['publishVoice']>(),
    connect: vi.fn<VoicePort['connect']>(() => vi.fn()),
    foregroundCategory: null,
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
function view(run: VoiceView['run'] = { id: 1, user: null }): VoiceView {
  return {
    run,
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

/** The send of the newest connection to the voice port. */
function latestSend() {
  return port.connect.mock.calls.at(-1)![0]
}

const herPacing: CharacterPacingMemory = { lastSpokenAtMs: T0 - 60_000, unanswered: 1, awaitingSinceMs: T0 - 60_000, damp: null, lastOwnDayAtMs: T0 - 60_000 }

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
    characterState = fakeCharacterState()
    records.state = characterState
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
  })

  afterEach(() => {
    useCharacterMindStore().dispose()
    vi.useRealTimers()
  })

  it('uses the newest declaration, observes a switch synchronously, and replays it after a reset', async () => {
    const store = useCharacterMindStore()
    const older = store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() })
    const capabilities = ref(NO_CAPABILITIES)
    const newer = store.attachStage({ capabilities: () => capabilities.value, idleCue: vi.fn(), idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() })
    expect(store.mind.state.performer).toEqual(NO_CAPABILITIES)
    capabilities.value = MMD_NATURAL_CAPABILITIES
    expect(store.mind.state.performer).toEqual(MMD_NATURAL_CAPABILITIES)
    await connected(store)
    characterState.replace('card-b', herPacing)
    expect(store.mind.state.performer).toEqual(MMD_NATURAL_CAPABILITIES)
    capabilities.value = NO_CAPABILITIES
    newer.detach()
    expect(store.mind.state.performer).toEqual(MMD_NATURAL_CAPABILITIES)
    older.detach()
    expect(store.mind.state.performer).toEqual(NO_CAPABILITIES)
  })

  it('reads the behavior document at creation and replays every switch after a reset', async () => {
    const settings = useCharacterBehaviorSettings()
    await settings.update({ idleActivities: false, touchReactions: false, chatAttention: false })
    const store = useCharacterMindStore()
    const disabled = { idleActivities: false, touchReactions: false, chatAttention: false }
    expect(store.mind.state.behavior).toEqual(disabled)
    await connected(store)
    characterState.replace('card-b', herPacing)
    expect(store.mind.state.behavior).toEqual(disabled)
    const sequence = store.mind.state.seq
    await settings.update({ speaking: { chattiness: 0.7 }, emotion: { bands: false } })
    expect(store.mind.state.seq).toBe(sequence)
  })

  it('observes a settings snapshot once without writing settings or pacing back', () => {
    const store = useCharacterMindStore()
    const settings = useCharacterBehaviorSettings()
    const action = vi.fn()
    settings.$onAction(action)
    let mutations = 0
    settings.$subscribe(() => mutations++, { flush: 'sync' })
    // The sync plugin replaces top-level values with a function patch; an object patch merges inside shallow refs.
    settings.$patch((current) => {
      current.document = { ...current.document, touchReactions: false }
    })
    const sequence = store.mind.state.seq
    expect(store.mind.state.behavior.touchReactions).toBe(false)
    expect(mutations).toBe(1)
    settings.$patch((current) => {
      current.document = { ...current.document, touchReactions: false }
    })
    expect(store.mind.state.seq).toBe(sequence)
    expect(mutations).toBe(2)
    expect(action).not.toHaveBeenCalled()
    expect(characterState.recordPacing).not.toHaveBeenCalled()
    store.dispose()
    settings.$patch((current) => {
      current.document = { ...current.document, touchReactions: true }
    })
    expect(store.mind.state.seq).toBe(sequence)
  })

  it('reports a refused request to the reaction inspector', async () => {
    const store = useCharacterMindStore()
    const cause = store.mind.state.seq + 1
    store.mind.receive({ kind: 'cue-gesture', gesture: 'shrug', count: 1, source: 'act' })
    const inspection = await useSituationObservabilityStore().inspect()
    expect(inspection.reactions.refusals).toEqual([{ cause, kind: 'gesture', reason: 'undeclared', atMs: T0 }])
  })

  it('hears music only while the window leads, and a demotion stops it', async () => {
    const store = useCharacterMindStore()
    const leadership = createLeadership(false)
    store.initialize(leadership.runtime)
    await flush()
    expect(beatSync.listeners.size).toBe(0)

    leadership.set(true)
    await flush()
    expect(beatSync.listeners.size).toBe(1)
    for (let ms = 0; ms <= MUSIC_SETTLE_MS; ms += 500) {
      vi.setSystemTime(T0 + ms)
      for (const listener of beatSync.listeners)
        listener({ energy: 1, interval: 0.5 })
    }
    expect(store.mind.state.music.playing).toBe(true)

    // A card switch resets the mind, which hears the music again.
    characterState.replace('card-b', null)
    expect(store.mind.state.music.playing).toBe(true)

    leadership.set(false)
    expect(beatSync.listeners.size).toBe(0)
    expect(store.mind.state.music.playing).toBe(false)
  })

  it('hands each beat to every attached stage while the window leads, and none after a demotion', async () => {
    const store = useCharacterMindStore()
    const leadership = createLeadership(false)
    store.initialize(leadership.runtime)
    const older = vi.fn()
    const newer = vi.fn()
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: older })
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: newer })
    await flush()
    leadership.set(true)
    await flush()
    for (const listener of beatSync.listeners)
      listener({ energy: 1, interval: 0.48 })
    expect(older.mock.calls).toEqual([[0.48]])
    expect(newer.mock.calls).toEqual([[0.48]])
    // The mind hears music edges, never a single beat.
    expect(store.mind.state.music.playing).toBe(false)

    leadership.set(false)
    expect(beatSync.listeners.size).toBe(0)
    expect(older).toHaveBeenCalledTimes(1)
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

    // The initial behavior snapshot precedes this touch.
    expect(store.mind.state.seq).toBe(2)
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
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue, idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() })
    const send = await connected(store)
    const outcome = settled(store)

    send(declinedWidget)
    await outcome

    expect(port.speak).toHaveBeenCalledOnce()
    expect(idleCue.mock.calls.map(([intent]) => [intent.cue])).toEqual([['about-to-speak'], ['let-go']])
  })

  it('drops the cues with no stage attached', async () => {
    const store = useCharacterMindStore()
    port.speak.mockResolvedValue('declined')
    const idleCue = vi.fn()
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue, idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() }).detach()
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
    const olderStage = store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: older, idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() })
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: newer, idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() })
    olderStage.detach()
    const send = await connected(store)
    const outcome = settled(store)

    send(declinedWidget)
    await outcome

    expect(older).not.toHaveBeenCalled()
    expect(newer.mock.calls.map(([intent]) => [intent.cue])).toEqual([['about-to-speak'], ['let-go']])
  })

  it('sends every idle intent to every attached stage, and takes idle reports only from the newest', () => {
    const store = useCharacterMindStore()
    const older = vi.fn()
    const newer = vi.fn()
    const olderStage = store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: older, settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() })
    const newerStage = store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: newer, settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() })

    olderStage.report([{ kind: 'view', view: idleView }])
    expect(store.mind.state.idle.view).toBeNull()
    newerStage.report([{ kind: 'view', view: idleView }])
    expect(store.mind.state.idle.view).toEqual(idleView)

    const [intent] = store.mind.receive({ kind: 'idle-play', act: 'yawn' })
    expect(intent).toMatchObject({ kind: 'idle-act', act: 'yawn', requested: true })
    expect(older.mock.calls).toEqual([[intent]])
    expect(newer.mock.calls).toEqual([[intent]])
  })

  it('sends each settle edge to every attached stage, and gets her up at a reset', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(T0)
    const store = useCharacterMindStore()
    const older = vi.fn()
    const newer = vi.fn()
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: vi.fn(), settle: older, refractory: vi.fn(), beat: vi.fn() })
    // A body drive that starts no act, so the only idle deadline is the settle.
    const still = { ...idleView, drive: { ...idleView.drive!, body: true, rate: 0 } }
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: vi.fn(), settle: newer, refractory: vi.fn(), beat: vi.fn() }).report([{ kind: 'view', view: still }])

    vi.advanceTimersByTime(SETTLE_SECONDS * 1000 - 1)
    expect(newer).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(older.mock.calls).toEqual([[true]])
    expect(newer.mock.calls).toEqual([[true]])

    await connected(store)
    expect(older.mock.calls).toEqual([[true], [false]])
    expect(newer.mock.calls).toEqual([[true], [false]])
  })

  it('sends each refractory intent to every attached stage, and clears the refractories at a reset', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(T0)
    const store = useCharacterMindStore()
    const older = vi.fn()
    const newer = vi.fn()
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: vi.fn(), settle: vi.fn(), refractory: older, beat: vi.fn() })
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: vi.fn(), settle: vi.fn(), refractory: newer, beat: vi.fn() })

    const [intent] = store.mind.receive({ kind: 'performer-report', report: { kind: 'tool-accepted', tool: 'look-at' } })
    expect(intent).toMatchObject({ kind: 'refractory', remaining: { lookToolMs: LOOK_TOOL_REFRACTORY_MS } })
    expect(older.mock.calls).toEqual([[intent?.kind === 'refractory' && intent.remaining]])
    expect(newer.mock.calls).toEqual(older.mock.calls)

    await connected(store)
    const cleared = { actionMs: 0, danceMs: 0, gesture: null, moveToolMs: 0, lookToolMs: 0 }
    expect(older.mock.calls.at(-1)).toEqual([cleared])
    expect(newer.mock.calls.at(-1)).toEqual([cleared])
  })

  it('tells the mind the dormant view when the reporting stage detaches', () => {
    const store = useCharacterMindStore()
    const olderStage = store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() })
    const newerStage = store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() })
    newerStage.report([{ kind: 'view', view: idleView }])

    // An older stage leaving changes nothing: it never reported.
    olderStage.detach()
    expect(store.mind.state.idle.view).toEqual(idleView)
    newerStage.detach()
    expect(store.mind.state.idle.view).toMatchObject({ drive: null })
    expect(nextIdleWakeAt(store.mind.state.idle)).toBeNull()
  })

  it('frees the mind from an idle act the older stage can no longer answer when a newer stage attaches', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const store = useCharacterMindStore()
    const older = vi.fn()
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: older, settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() }).report([{ kind: 'view', view: idleView }])
    vi.advanceTimersByTime(Math.ceil(nextIdleWakeAt(store.mind.state.idle)! - T0))
    expect(older).toHaveBeenCalledOnce()

    // The older stage's answer to that act no longer counts, so only the newer stage's view can free the mind.
    const newer = vi.fn()
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: newer, settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() }).report([{ kind: 'view', view: idleView }])
    const wakeAt = nextIdleWakeAt(store.mind.state.idle)
    expect(wakeAt).not.toBeNull()
    vi.advanceTimersByTime(Math.ceil(wakeAt! - Date.now()))

    expect(newer).toHaveBeenCalledOnce()
    expect(newer.mock.calls[0][0]).toMatchObject({ kind: 'idle-act', requested: false })
  })

  it('wakes the mind at its idle deadline, sends the act it decides, and stops the timer on dispose', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const store = useCharacterMindStore()
    const idle = vi.fn()
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle, settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() }).report([{ kind: 'view', view: idleView }])
    const wakeAt = nextIdleWakeAt(store.mind.state.idle)!
    expect(wakeAt).toBeGreaterThan(T0)

    vi.advanceTimersByTime(Math.ceil(wakeAt - T0) - 1)
    expect(idle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(idle).toHaveBeenCalledOnce()
    expect(idle.mock.calls[0][0]).toMatchObject({ channel: 'posture', kind: 'idle-act', requested: false })

    // The act was neither started nor refused, so nothing is due; once refused, the next deadline is armed again.
    expect(vi.getTimerCount()).toBe(0)
    store.mind.receive({ kind: 'idle', reports: [{ kind: 'refused', intentId: idle.mock.calls[0][0].id }] })
    expect(vi.getTimerCount()).toBe(1)
    store.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('feeds the reaction inspector a touch decision and clears it on dispose', () => {
    const store = useCharacterMindStore()
    store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() })
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

  describe('slow state', () => {
    it('loads the active record\'s pacing at promotion and restores the gate from it', async () => {
      characterState.leaderRecord = { cardId: 'card-a', pacing: herPacing }
      const store = useCharacterMindStore()
      const send = await connected(store)

      send({ kind: 'voice-tick', forceTiming: false, view: view() })

      expect(store.mind.state.slow.pacing).toBe(herPacing)
      expect(store.mind.state.voice.gate).toMatchObject(herPacing)
      expect(characterState.recordPacing).not.toHaveBeenCalled()
    })

    it('writes a pacing change to the record of the card and epoch it loaded', async () => {
      const store = useCharacterMindStore()
      const send = await connected(store)
      const outcome = settled(store)

      send({ kind: 'voice-tick', forceTiming: true, view: view() })
      await outcome

      expect(characterState.recordPacing.mock.calls).toEqual([['card-a', 1, store.mind.state.slow.pacing]])
      expect(characterState.leaderRecord?.pacing).toMatchObject({ unanswered: 1, lastSpokenAtMs: T0 })
    })

    it('reloads the new card\'s pacing at a card switch and keeps the user\'s floor and fires', async () => {
      const store = useCharacterMindStore()
      const send = await connected(store)
      const outcome = settled(store)
      send({ kind: 'voice-tick', forceTiming: true, view: view() })
      await outcome
      // The port carries the user's slice of the last published memory into the run.
      const user = userGateMemoryOf(port.publishVoice.mock.lastCall![0].memory)
      expect(user.fires).toHaveLength(1)

      const other = { ...herPacing, unanswered: 2 }
      characterState.replace('card-b', other)

      expect(port.connect).toHaveBeenCalledTimes(2)
      expect(store.mind.state.slow.pacing).toBe(other)
      expect(store.mind.state.voice.gate).toBeNull()
      latestSend()({ kind: 'voice-tick', forceTiming: false, view: view({ id: 1, user }) })
      expect(store.mind.state.voice.gate).toMatchObject({ ...other, lastFireAtMs: user.lastFireAtMs, fires: user.fires })
    })

    it.each(['the record', 'the run'])('leaves no pacing in the record after "Delete all data" when %s resets first', async (first) => {
      characterState.leaderRecord = { cardId: 'card-a', pacing: herPacing }
      const store = useCharacterMindStore()
      const send = await connected(store)
      send({ kind: 'voice-tick', forceTiming: false, view: view() })

      const forgotten = view({ id: 2, user: null })
      if (first === 'the run')
        send({ kind: 'voice-tick', forceTiming: false, view: forgotten })
      characterState.replace('card-a', null)
      latestSend()({ kind: 'voice-tick', forceTiming: false, view: first === 'the run' ? forgotten : view() })
      latestSend()({ kind: 'voice-tick', forceTiming: false, view: forgotten })

      expect(store.mind.state.slow.pacing).toBeNull()
      expect(characterState.leaderRecord?.pacing).toBeNull()
    })

    it('keeps an away span open across a card switch, so the return after it gets its response', async () => {
      const store = useCharacterMindStore()
      store.attachStage({ capabilities: () => MMD_NATURAL_CAPABILITIES, idleCue: vi.fn(), idle: vi.fn(), settle: vi.fn(), refractory: vi.fn(), beat: vi.fn() })
      await connected(store)
      store.mind.receive({ kind: 'presence', away: true, wake: null })
      vi.setSystemTime(T0 + 60_000)
      characterState.replace('card-b', herPacing)

      vi.setSystemTime(T0 + 120_000)
      const intents = store.mind.receive({ kind: 'presence', away: false, wake: null })

      expect(intents.map(intent => intent.kind)).toEqual(['wake', 'moment', 'observe-return', 'away'])
      // The span reopens at the switch, so the return counts from there.
      expect(intents.at(-2)).toMatchObject({ kind: 'observe-return', awayMs: 60_000 })
      expect(intents.at(-1)).toMatchObject({ channel: 'body', kind: 'away', away: false })
    })

    it('lets the outcome of a line opened before a card switch reach the reloaded mind without error', async () => {
      let speak!: (outcome: 'spoken') => void
      port.speak.mockReturnValue(new Promise((resolve) => {
        speak = resolve
      }))
      const store = useCharacterMindStore()
      const send = await connected(store)
      const outcome = settled(store)
      send({ kind: 'voice-tick', forceTiming: true, view: view() })
      expect(store.mind.state.voice.line?.kind).toBe('reach-out')

      characterState.replace('card-b', herPacing)
      latestSend()({ kind: 'voice-tick', forceTiming: false, view: view() })
      speak('spoken')
      await outcome

      // The reloaded mind has no line for it, so the outcome changes neither its line nor the new card's pacing.
      expect(store.mind.state.voice.line).toBeNull()
      expect(store.mind.state.slow.pacing).toBe(herPacing)
      expect(characterState.recordPacing).not.toHaveBeenCalled()
      expect(characterState.leaderRecord).toEqual({ cardId: 'card-b', pacing: herPacing })
    })
  })
})
