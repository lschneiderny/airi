import type { MindIdleIntent, MindIntent, MindStep, PerformerCapabilities } from '@proj-airi/character-mind'
import type { IdleReport, IdleView } from '@proj-airi/motion-driver-natural/idle-schedule'
import type { ReactionDecision } from '@proj-airi/stage-shared/situation'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { CharacterMind, nextIdleWakeAt, NO_CAPABILITIES } from '@proj-airi/character-mind'
import { dormantIdleView } from '@proj-airi/motion-driver-natural/idle-schedule'
import { isBeatSyncSupported, listenBeatSyncBeatSignal } from '@proj-airi/stage-shared/beat-sync'
import { defineStore } from 'pinia'
import { markRaw, watch } from 'vue'

import { MindMusic } from '../composables/performance/mind-music'
import { MindVoice } from '../composables/performance/mind-voice'
import { useCharacterBehaviorSettings } from '../features/character-behavior/settings'
import { useCharacterStateStore } from './character-state'
import { useSituationObservabilityStore } from './devtools/situation-observability'
import { useSituationStore } from './situation'

/** What a mounted stage lends the mind: the body around a line and its idle acts. The conductor checks each complete intent against its own declaration. */
export interface MindStage {
  capabilities: () => PerformerCapabilities
  idleCue: (cue: Extract<MindIntent, { kind: 'cue' }>) => void
  /** Performs one idle intent; an undeclared stage reports a refusal. */
  idle: (intent: MindIdleIntent) => void
  /** Hands the mind's settle to the stage's body; a stage without posture drops it. */
  settle: (settled: boolean) => void
  /** Hands one detected beat to the stage's beat clock, which a groove plays on; a stage under another driver drops it. */
  beat: (intervalSeconds: number) => void
}

/** The handle `attachStage` returns. Only the newest attached stage's reports reach the mind. */
export interface MindStageHandle {
  /** Hands the mind what this stage's Natural performer saw; ignored unless this is the newest stage. */
  report: (reports: readonly IdleReport[]) => void
  /** Detaches the stage. When it was the reporting stage, the mind hears the dormant view and decides no more idle acts. */
  detach: () => void
}

/**
 * The voice decision a step made, or null when none of its stimuli reached the voice policy: only a poke or a
 * finished pet with a voice view does. The state keeps the last decision between steps, so it alone cannot tell.
 */
export function voiceDecisionOf({ stimuli, state }: Pick<MindStep, 'stimuli' | 'state'>): ReactionDecision | null {
  const decided = state.performer.posture && stimuli.some(stimulus => stimulus.kind === 'touch' && stimulus.voice !== null && stimulus.gesture !== 'pet-start')
  return decided ? state.voice.lastDecision : null
}

/**
 * Hosts the window's one character mind, seeded from the platform's random source. It is not synced: every window
 * that creates it constructs its own mind, but only the leader's connects to the situation store's voice port, so a
 * follower's mind answers touch and desktop steps of its own stage and decides no line.
 *
 * The mind outlives stage remounts. It feeds the devtools reaction inspector of this window from creation until
 * {@link dispose}.
 *
 * Its slow state is her pacing in the active card's character-state record. At each promotion, once the record has
 * loaded, and whenever the leader replaces that record (`leaderEpoch`: a card switch, an import over the active card,
 * a forget, "Delete all data"), the store resets the mind to the record's pacing and connects it again, so a widget
 * request the old state held answers `failed`. An away span open at the reset reopens at it, so the return after it
 * still gets its response. After every step that gives `state.slow.pacing` a new object, the store writes it back with
 * `recordPacing`, named by the card and epoch it loaded, so a write for a replaced record is dropped.
 *
 * Idle: every `idle-act`, `idle-errand`, and `settle` intent of any step goes to every attached stage, so two stages show the
 * same act from the same seed, and only the newest stage reports what its performer saw. After every step the store
 * arms one timer at `nextIdleWakeAt` and sends `idle-wake` when it fires. A reset clears the timer and hands the new
 * state the reporting stage's latest view, because a performer reports its view only when it changes. A newer stage
 * that attaches hands the mind the dormant view until it reports, so an act the older stage was asked for no longer
 * holds the mind.
 *
 * Music: while the window leads, `MindMusic` listens to upstream's beat sync beats where beat sync runs, and tells the
 * mind when music starts and stops. A demotion stops it and tells the mind the music stopped; a reset re-sends it.
 * Each beat also goes to every attached stage, for its Natural beat clock; the mind never hears a single beat.
 */
export const useCharacterMindStore = defineStore('character-mind', () => {
  const situation = useSituationStore()
  const characterState = useCharacterStateStore()
  const observability = useSituationObservabilityStore()
  const behaviorSettings = useCharacterBehaviorSettings()

  // markRaw: the mind's state is replaced on every step and must not become reactive.
  const mind = markRaw(new CharacterMind({ seed: crypto.getRandomValues(new Uint32Array(1))[0] }))
  /** Mounted stages, oldest first; the newest receives the cues. */
  const stages: MindStage[] = []
  const capabilityWatches = new Set<() => void>()
  /** Answers the voice port's stimuli; its cues go to the newest attached stage, or nowhere. */
  const voice = new MindVoice(mind, () => situation, cue => stages.at(-1)?.idleCue(cue))

  /** Hears music for the mind while the window leads. */
  const music = new MindMusic(mind, {
    // The detector's `interval` is already in seconds of the worklet's audio clock (`currentTime`).
    listen: onBeat => listenBeatSyncBeatSignal(event => onBeat({ intervalSeconds: event.interval })),
    category: () => situation.foregroundCategory,
    // A copy: a stage that detaches while it takes the beat must not skip the next one.
    onBeat: ({ intervalSeconds }) => [...stages].forEach(stage => stage.beat(intervalSeconds)),
  })
  const stopCategoryWatch = watch(() => situation.foregroundCategory, () => music.observeCategory())

  /** The reporting stage's latest view, which a reset hands the new state; null without one. */
  let reportedView: IdleView | null = null
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  /** The wake the timer is armed for, in epoch milliseconds of the mind's clock. */
  let idleWakeAt: number | null = null

  function clearIdleWake() {
    if (idleTimer !== undefined)
      clearTimeout(idleTimer)
    idleTimer = undefined
    idleWakeAt = null
  }

  /** Arms the one idle wake timer at the mind's next idle deadline, when it moved. */
  function armIdleWake() {
    const wakeAt = nextIdleWakeAt(mind.state.idle)
    if (wakeAt === idleWakeAt)
      return
    clearIdleWake()
    if (wakeAt === null)
      return
    idleWakeAt = wakeAt
    idleTimer = setTimeout(() => {
      idleTimer = undefined
      idleWakeAt = null
      mind.receive({ kind: 'idle-wake' })
    }, Math.max(0, wakeAt - Date.now()))
  }

  let stopIdle: (() => void) | undefined = mind.onStep(({ intents }) => {
    for (const intent of intents) {
      // A copy: a stage that detaches while it performs must not skip the next one.
      if (intent.kind === 'idle-act' || intent.kind === 'idle-errand')
        [...stages].forEach(stage => stage.idle(intent))
      else if (intent.kind === 'settle')
        [...stages].forEach(stage => stage.settle(intent.settled))
    }
    armIdleWake()
  })

  observability.publishReactionMemory(mind.state.voice.reaction)
  let stopInspector: (() => void) | undefined = mind.onStep((step) => {
    observability.recordMindRefusals(step.refusals, step.atMs)
    const { reaction } = step.state.voice
    const decision = voiceDecisionOf(step)
    if (decision)
      observability.recordReactionDecision(decision, reaction, step.atMs)
    else if (step.stimuli.some(stimulus => stimulus.kind === 'voice-outcome'))
      observability.publishReactionMemory(reaction)
  })

  /** The record the mind's slow state came from; null outside the leader, where nothing is written back. */
  let loaded: { cardId: string, epoch: number } | null = null
  /** The last pacing object the store saw, so a step that kept it writes nothing. */
  let lastPacing = mind.state.slow.pacing
  let stopPacing: (() => void) | undefined = mind.onStep(({ state }) => {
    const { pacing } = state.slow
    if (pacing === lastPacing)
      return
    lastPacing = pacing
    if (loaded)
      void characterState.recordPacing(loaded.cardId, loaded.epoch, pacing)
  })

  function replayBehavior() {
    const { idleActivities, touchReactions, chatAttention } = behaviorSettings.document
    mind.receive({ kind: 'behavior', idleActivities, touchReactions, chatAttention })
  }

  // Primitive sources ignore emotion and speaking updates, and a replicated snapshot never writes back.
  const stopBehaviorWatch = watch([
    () => behaviorSettings.document.idleActivities,
    () => behaviorSettings.document.touchReactions,
    () => behaviorSettings.document.chatAttention,
  ], replayBehavior, { immediate: true, flush: 'sync' })

  let stopLeadershipListener: (() => void) | undefined
  let disconnectVoice: (() => void) | undefined
  /** Bumped at every leadership change, so a promotion that a demotion overtook does not connect. */
  let leadership = 0

  /** Resets the mind to the pacing of the leader's active record and connects it to the gate, which ticks it at once. */
  function loadAndConnect() {
    disconnectVoice?.()
    const record = characterState.leaderRecord
    // Presence reaches the mind only as edges, so a reset while the user is away would lose the span and her return.
    const away = mind.state.presence.away
    mind.reset({ pacing: record?.pacing ?? null })
    // A reset gets her up: the new state has not settled, and no edge would tell the stages.
    stages.forEach(stage => stage.settle(mind.state.idle.settle.settled))
    loaded = record && { cardId: record.cardId, epoch: characterState.leaderEpoch }
    lastPacing = mind.state.slow.pacing
    clearIdleWake()
    mind.receive({ kind: 'performer', capabilities: stages.at(-1)?.capabilities() ?? NO_CAPABILITIES })
    replayBehavior()
    // The span reopens at the reset; the return after it still gets its response.
    if (away)
      mind.receive({ kind: 'presence', away: true, wake: null })
    // The performer reports its view only when it changes, so the new state hears the latest one now.
    if (reportedView && stages.length > 0)
      mind.receive({ kind: 'idle', reports: [{ kind: 'view', view: reportedView }] })
    music.replay()
    disconnectVoice = situation.connect(stimulus => voice.answer(stimulus))
  }

  async function startLeading() {
    const promotion = ++leadership
    await characterState.ready()
    if (promotion !== leadership || disconnectVoice)
      return
    loadAndConnect()
    if (isBeatSyncSupported())
      music.start()
  }

  function stopLeading() {
    leadership += 1
    disconnectVoice?.()
    disconnectVoice = undefined
    loaded = null
    music.stop()
  }

  // Sync: the record changed inside the character state's leader task, so the reset reads it before any later step.
  // Before the promotion connects, the promotion itself loads the record.
  const stopRecordWatch = watch(() => characterState.leaderEpoch, () => {
    if (disconnectVoice)
      loadAndConnect()
  }, { flush: 'sync' })

  /** Lends the mind a stage's body. Cues go to the newest stage, idle intents to every stage, and only the newest reports. */
  function attachStage(next: MindStage): MindStageHandle {
    const attached = { ...next }
    // The previous reporting stage stops reporting, so an order the mind waits on would never be answered: the mind
    // hears the dormant view until the new stage reports its own.
    if (reportedView !== null) {
      reportedView = null
      mind.receive({ kind: 'idle', reports: [{ kind: 'view', view: dormantIdleView() }] })
    }
    stages.push(attached)
    const stopCapabilities = watch(attached.capabilities, (capabilities) => {
      if (stages.at(-1) === attached)
        mind.receive({ kind: 'performer', capabilities })
    }, { immediate: true, deep: true, flush: 'sync' })
    capabilityWatches.add(stopCapabilities)
    return {
      report(reports) {
        if (stages.at(-1) !== attached)
          return
        for (const report of reports) {
          if (report.kind === 'view')
            reportedView = report.view
        }
        mind.receive({ kind: 'idle', reports })
      },
      detach() {
        const index = stages.indexOf(attached)
        if (index === -1)
          return
        const reporting = index === stages.length - 1
        stopCapabilities()
        capabilityWatches.delete(stopCapabilities)
        stages.splice(index, 1)
        if (reporting) {
          mind.receive({ kind: 'performer', capabilities: stages.at(-1)?.capabilities() ?? NO_CAPABILITIES })
          reportedView = null
          mind.receive({ kind: 'idle', reports: [{ kind: 'view', view: dormantIdleView() }] })
        }
      },
    }
  }

  /** Binds the mind to leadership: it connects to the gate while the window leads. Repeated calls keep the first. */
  function initialize(syncedPinia: SyncedPiniaRuntime) {
    stopLeadershipListener ??= syncedPinia.onLeadershipChange(isLeader => isLeader ? void startLeading() : stopLeading())
  }

  /** Stops the leadership subscription, disconnects from the gate, and clears the inspector's memory. */
  function dispose() {
    for (const stop of capabilityWatches)
      stop()
    capabilityWatches.clear()
    stopLeadershipListener?.()
    stopLeadershipListener = undefined
    stopLeading()
    stopInspector?.()
    stopInspector = undefined
    stopPacing?.()
    stopPacing = undefined
    stopIdle?.()
    stopIdle = undefined
    clearIdleWake()
    stopRecordWatch()
    stopCategoryWatch()
    stopBehaviorWatch()
    observability.publishReactionMemory(null)
  }

  return { mind, attachStage, initialize, dispose }
})
