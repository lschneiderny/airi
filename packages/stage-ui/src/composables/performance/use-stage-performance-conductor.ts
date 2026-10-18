import type { AffectSignal, CatalogEntry, ExpressionPerformanceSettings, PerformanceDecision, ReactionEpisode, SlotCommand, TimingEvent } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DMotionDriver } from '@proj-airi/stage-ui-live2d'

import type { ActiveExpression, ExposedExpression, PerformanceMoodSnapshot } from '../../features/performance/runtime-state'
import type { ExecutableTool } from '../../stores/ai/chat-llm/tools'
import type { ExpressionToolPort } from '../../tools/expression'

import { errorMessageFrom } from '@moeru/std'
import { createDecider, isLlmEligible } from '@proj-airi/stage-shared/expression-performance'
import { SpeechOnsetDetector } from '@proj-airi/stage-ui-live2d/composables/live2d'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { useIntervalFn } from '@vueuse/core'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { EMOTION_EmotionMotionName_value, EMOTION_VALUES } from '../../constants/emotions'
import { usePerformanceRuntimeState } from '../../features/performance/runtime-state'
import { useExpressionPerformanceSettings } from '../../features/performance/settings'
import { useLlmToolsStore } from '../../stores/ai/chat-llm/tools'
import { createExpressionTools } from '../../tools/expression'

type SpeechEvent = Extract<AffectSignal, { kind: 'speech' }>['event']
type Decider = ReturnType<typeof createDecider>
type DeciderState = ReturnType<Decider['initial']>
type SlotName = SlotCommand['slot']
type TimerHandle = ReturnType<typeof setTimeout>

const slotNames: readonly SlotName[] = ['face', 'effect', 'prop']

/** The performer slot each LLM-reachable kind occupies; outfit and system kinds have none. */
const slotOfKind: Partial<Record<CatalogEntry['kind'], SlotName>> = { face: 'face', effect: 'effect', prop: 'prop' }

/**
 * Resolves an LLM-provided expression name among LLM-eligible entries only: an exact id,
 * else an exact case-insensitive label after trimming. There is no fuzzy matching.
 */
export function resolveExpressionName(name: string, eligible: readonly CatalogEntry[]): CatalogEntry | undefined {
  const byId = eligible.find(entry => entry.id === name)
  if (byId)
    return byId
  const wanted = name.trim().toLowerCase()
  return wanted ? eligible.find(entry => entry.label.trim().toLowerCase() === wanted) : undefined
}

/** The labels and kinds the LLM may see: confirmed, exposed face, effect, and prop entries only. */
export function toExposedExpressions(catalog: readonly CatalogEntry[]): ExposedExpression[] {
  return catalog.flatMap((entry) => {
    const kind = slotOfKind[entry.kind]
    return isLlmEligible(entry) && kind ? [{ label: entry.label, kind }] : []
  })
}

/** The Live2D scene surface the conductor dispatches to; `Live2DScene` exposes it. */
export interface StagePerformanceScene {
  setEmotion: (episode: ReactionEpisode) => void
  applySlots: (commands: SlotCommand[], now: number) => void
  onSpeech: (event: SpeechEvent, turnId: string, now: number) => void
  setMuted: (muted: boolean) => void
}

export interface StagePerformanceConductorOptions {
  /** Undefined while no Live2D model is mounted; decisions still advance the decider state. */
  scene: () => StagePerformanceScene | undefined
  driver: () => Live2DMotionDriver
  /** Plays a motion group for the Universal and MAGIC drivers. */
  playMotion: (group: string) => void
  settings: () => ExpressionPerformanceSettings
  catalog: () => readonly CatalogEntry[]
  /** Decider seed, fixed for the lifetime of the conductor so traces can replay it. */
  seed: number
  /**
   * Monotonic seconds shared with the Live2D performer, which composes on the same clock.
   * Tests inject a fake clock.
   *
   * @default () => performance.now() / 1000
   */
  clock?: () => number
  /**
   * Timer functions for decider deadlines and pause detection. Tests inject fakes.
   *
   * @default { setTimeout, clearTimeout }
   */
  timers?: {
    setTimeout: (callback: () => void, ms: number) => TimerHandle
    clearTimeout: (handle: TimerHandle) => void
  }
}

const browserTimers: Required<StagePerformanceConductorOptions>['timers'] = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle),
}

/**
 * Turns stage events into decider signals and dispatches the decisions to the Live2D scene.
 *
 * State model: the conductor owns one decider state (seeded once), the turn ids it last saw
 * active, and the last muted flag. It validates inputs and dispatches; every performance
 * decision belongs to the decider.
 *
 * Routing per driver:
 * - Natural: decided episodes go to `scene.setEmotion`.
 * - Universal and MAGIC: every recognized emotion plays its motion group, repeats and
 *   `neutral` (`Idle`) included, independently of episode filtering.
 * - Slot commands go to `scene.applySlots` for every driver.
 *
 * Timing events: the conductor derives `TimingEvent`s from playback and sends them to the
 * decider as `timing` signals, each carrying its turn id:
 * - `sentence_start` on a clip start whose clip begins a sentence;
 * - `pause` once per gap, when no clip of the turn starts within `timing.pauseSeconds` after a
 *   clip end and the turn has not ended;
 * - `utterance_end` once per turn, on its first turn end;
 * - `emphasis` on a voice onset while a clip plays, at most once per `timing.emphasisRefractory`.
 *
 * Deadlines: after every decision the conductor arms one timer for `decider.nextDeadline`; a newer
 * decision re-arms or cancels it. When the timer reaches the deadline, the conductor yields once
 * through a zero-delay timer, so playback callbacks queued for the same instant and pauses due by
 * then reach the decider first. The deadline is sent only if no decision since then cancelled or
 * replaced it. Its signal time is the deadline itself, or the latest signal time if that is later.
 * Timers start only from these inputs; `dispose` cancels every pending timer.
 */
export class StagePerformanceConductor {
  readonly seed: number
  private decider: Decider
  private deciderKind: ExpressionPerformanceSettings['decider']
  private state: DeciderState
  private activeTurnIds: readonly string[] = []
  private muted = false
  private readonly clock: () => number
  private readonly timers: Required<StagePerformanceConductorOptions>['timers']
  /** The armed deadline timer, or its same-instant yield, and the decider deadline it serves. */
  private deadline: { at: number, handle: TimerHandle } | undefined
  /** The latest signal time the decider received; deadline signals never go back before it. */
  private lastSignalAt = Number.NEGATIVE_INFINITY
  /** Pending pause timers by turn id, with the signal time each pause is due at. */
  private readonly pauses = new Map<string, { at: number, handle: TimerHandle }>()
  /** Turns whose utterance already ended; a repeated turn end sends no second `utterance_end`. */
  private readonly endedTurns = new Set<string>()
  /** The clip that plays now; voice onsets become emphasis events of its turn. */
  private playing: { turnId: string, clipId: string } | undefined
  private readonly onsets = new SpeechOnsetDetector()
  private lastLevelAt: number | undefined
  private lastEmphasisAt = Number.NEGATIVE_INFINITY
  private timingSeq = 0

  constructor(private readonly options: StagePerformanceConductorOptions) {
    this.seed = options.seed
    this.deciderKind = options.settings().decider
    this.decider = createDecider(this.deciderKind)
    this.state = this.decider.initial(this.seed)
    this.clock = options.clock ?? (() => performance.now() / 1000)
    this.timers = options.timers ?? browserTimers
  }

  emotion(name: string, nominal: number, source: 'act' | 'tool' | 'devtools', turnId?: string) {
    const emotion = EMOTION_VALUES.find(value => value === name)
    if (!emotion || !Number.isFinite(nominal)) {
      console.warn('[performance-conductor] Unrecognized emotion dropped:', name, nominal)
      return
    }
    const at = this.clock()
    const decision = this.decide({ kind: 'emotion', source, emotion, nominal: Math.min(1, Math.max(0, nominal)), turnId, at })
    const scene = this.options.scene()
    if (this.options.driver() === 'natural') {
      for (const episode of decision.episodes)
        scene?.setEmotion(episode)
    }
    else {
      this.options.playMotion(EMOTION_EmotionMotionName_value[emotion])
    }
    this.dispatchSlots(decision, at)
  }

  /**
   * Shows an LLM-named expression. Only confirmed, LLM-exposed face, effect, and prop entries
   * resolve (see {@link resolveExpressionName}); unknown names are dropped with a warning.
   *
   * Returns the resolved entry, or `undefined` when the request was dropped.
   */
  expression(name: string, holdSeconds: number | undefined, source: 'act' | 'tool', turnId?: string): CatalogEntry | undefined {
    const eligible = this.options.catalog().filter(isLlmEligible)
    const entry = resolveExpressionName(name, eligible)
    if (!entry) {
      console.warn('[performance-conductor] Expression is not exposed and was dropped:', name, 'available:', eligible.map(candidate => candidate.label))
      return undefined
    }
    if (holdSeconds !== undefined && (!Number.isFinite(holdSeconds) || holdSeconds <= 0)) {
      console.warn('[performance-conductor] Expression hold must be a positive number:', holdSeconds)
      return undefined
    }
    const at = this.clock()
    this.dispatchSlots(this.decide({ kind: 'expression', source, expressionId: entry.id, holdSeconds, turnId, at }), at)
    return entry
  }

  /**
   * Releases one slot, or the face, effect, and prop slots when none is named. Saved defaults
   * and manual toggles are not slot leases, so they stay. The clear is a decider signal, so an
   * affect trace replays it like any other decision.
   */
  clearExpression(slot: SlotName | undefined, source: 'act' | 'tool' | 'devtools', turnId?: string) {
    const at = this.clock()
    this.dispatchSlots(this.decide({ kind: 'clear', source, slot, turnId, at }), at)
  }

  /**
   * `sentenceStart` comes from the speech clip. Streaming-provider clips have no sentence
   * alignment and leave it undefined, so they produce no `sentence_start`.
   */
  clipStart(turnId: string, clipId: string, sentenceStart?: boolean) {
    this.cancelPause(turnId)
    this.playing = { turnId, clipId }
    this.speech('clip-start', turnId, clipId)
    if (sentenceStart)
      this.timing('sentence_start', turnId)
  }

  /** A stopped or failed clip ends its turn's speech leases at once; an ended clip extends them. */
  clipEnd(turnId: string, clipId: string, status: 'ended' | 'stopped' | 'failed') {
    if (this.playing?.clipId === clipId)
      this.playing = undefined
    this.speech(status === 'ended' ? 'clip-end' : 'clip-stopped', turnId, clipId)
    if (!this.endedTurns.has(turnId))
      this.armPause(turnId)
  }

  turnEnd(turnId: string) {
    this.cancelPause(turnId)
    if (this.playing?.turnId === turnId)
      this.playing = undefined
    this.speech('turn-end', turnId)
    if (this.endedTurns.has(turnId))
      return
    this.endedTurns.add(turnId)
    this.timing('utterance_end', turnId)
  }

  /**
   * Feeds the lipsync mouth level, unscaled in [0, 1], from the stage's animation-frame loop.
   * Onsets use the Natural emphasis detector. They become `emphasis` events only while a clip
   * plays, and the refractory period applies to emitted events only.
   */
  sampleVoiceLevel(level: number) {
    const at = this.clock()
    const dt = this.lastLevelAt === undefined ? 0 : Math.max(0, at - this.lastLevelAt)
    this.lastLevelAt = at
    if (!this.onsets.step(dt, level) || !this.playing)
      return
    if (at - this.lastEmphasisAt < this.options.settings().timing.emphasisRefractory)
      return
    this.lastEmphasisAt = at
    this.timing('emphasis', this.playing.turnId)
  }

  /** Cancels the pending deadline and pause timers; the conductor sends no further timed signals. */
  dispose() {
    if (this.deadline)
      this.timers.clearTimeout(this.deadline.handle)
    this.deadline = undefined
    for (const turnId of [...this.pauses.keys()])
      this.cancelPause(turnId)
  }

  /**
   * Emits `turnEnd` for every turn that left the active list since the previous call.
   * Turns end independently: one turn draining never ends another, even when both overlap.
   */
  syncActiveTurns(turnIds: readonly string[]) {
    const ended = this.activeTurnIds.filter(turnId => !turnIds.includes(turnId))
    this.activeTurnIds = [...turnIds]
    for (const turnId of ended)
      this.turnEnd(turnId)
  }

  setMuted(muted: boolean) {
    const at = this.clock()
    this.muted = muted
    this.options.scene()?.setMuted(muted)
    this.dispatchSlots(this.decide({ kind: 'muted', muted, at }), at)
  }

  private speech(event: SpeechEvent, turnId: string, clipId?: string) {
    const at = this.clock()
    const decision = this.decide({ kind: 'speech', event, turnId, clipId, at })
    this.options.scene()?.onSpeech(event, turnId, at)
    this.dispatchSlots(decision, at)
  }

  private timing(kind: TimingEvent['kind'], turnId: string) {
    const at = this.clock()
    const event: TimingEvent = { id: `timing-${++this.timingSeq}`, kind, turnId, at }
    // NOTICE:
    // Live QA reads timing signals from this log through CDP `Runtime.consoleAPICalled`.
    // The lab affect trace (plan todo 22) does not exist yet, so the log is the only observable channel.
    // Source: .omo/plans/emotion-expression-performance.md, todo 21 QA scenarios.
    // Remove once todo 22 records timing signals in the affect trace.
    // eslint-disable-next-line no-console
    console.debug('[performance-conductor] timing', kind, turnId, at)
    this.dispatch(this.decide({ kind: 'timing', event, at }), at)
  }

  private armPause(turnId: string) {
    this.cancelPause(turnId)
    const seconds = this.options.settings().timing.pauseSeconds
    const handle = this.timers.setTimeout(() => {
      this.pauses.delete(turnId)
      this.timing('pause', turnId)
    }, seconds * 1000)
    this.pauses.set(turnId, { at: this.clock() + seconds, handle })
  }

  private cancelPause(turnId: string) {
    const pause = this.pauses.get(turnId)
    if (!pause)
      return
    this.timers.clearTimeout(pause.handle)
    this.pauses.delete(turnId)
  }

  /** Re-arms the deadline timer for the decider's current state; an unchanged deadline keeps its timer. */
  private armDeadline() {
    const at = this.decider.nextDeadline(this.state)
    if (at === this.deadline?.at)
      return
    if (this.deadline)
      this.timers.clearTimeout(this.deadline.handle)
    this.deadline = undefined
    if (at === null)
      return
    const handle = this.timers.setTimeout(() => this.fireDeadline(at), Math.max(0, (at - this.clock()) * 1000))
    this.deadline = { at, handle }
  }

  /**
   * The timer reached `due`. Playback callbacks queued for the same instant run before a timer
   * created now, so the deadline yields once; the yield replaces the record, which keeps
   * `armDeadline` able to cancel or replace the deadline meanwhile.
   */
  private fireDeadline(due: number) {
    const handle = this.timers.setTimeout(() => this.deliverDeadline(due), 0)
    this.deadline = { at: due, handle }
  }

  private deliverDeadline(due: number) {
    const pending = this.deadline
    // Pauses due by the deadline are playback-derived events, so the decider sees them first.
    for (const [turnId, pause] of [...this.pauses].sort(([, a], [, b]) => a.at - b.at)) {
      if (pause.at > due)
        break
      this.cancelPause(turnId)
      this.timing('pause', turnId)
    }
    // A decision since the timer fired cancelled or replaced this deadline; it is obsolete.
    if (this.deadline !== pending)
      return
    this.deadline = undefined
    const at = Math.max(due, this.lastSignalAt)
    this.dispatch(this.decide({ kind: 'deadline', at }), at)
  }

  /** Sends a timing or deadline decision: episodes reach the Natural scene, and slots reach every driver. */
  private dispatch(decision: PerformanceDecision, at: number) {
    if (this.options.driver() === 'natural') {
      for (const episode of decision.episodes)
        this.options.scene()?.setEmotion(episode)
    }
    this.dispatchSlots(decision, at)
  }

  private decide(signal: AffectSignal): PerformanceDecision {
    const settings = this.options.settings()
    // A decider switch keeps the seed, so both deciders replay from the same randomness.
    if (settings.decider !== this.deciderKind) {
      this.deciderKind = settings.decider
      this.decider = createDecider(this.deciderKind)
      this.state = this.decider.initial(this.seed)
    }
    const result = this.decider.decide(signal, { catalog: this.options.catalog(), settings }, this.state)
    this.state = result.state
    this.lastSignalAt = Math.max(this.lastSignalAt, signal.at)
    this.armDeadline()
    return result.decision
  }

  private dispatchSlots(decision: PerformanceDecision, at: number) {
    if (decision.slots.length === 0)
      return
    const scene = this.options.scene()
    // The model, and with it the performer's muted flag, can mount after the last mute change.
    scene?.setMuted(this.muted)
    scene?.applySlots(decision.slots, at)
  }
}

/** The parts of the LLM tools store the registration uses. */
type ExpressionToolsHost = Pick<ReturnType<typeof useLlmToolsStore>, 'addTools' | 'removeToolsByIds'>

export const expressionToolIds = ['expression:set_expression', 'expression:clear_expression', 'expression:list_expressions'] as const

/**
 * Keeps the expression tools registered for the current exposed set.
 *
 * A changed set replaces the three tools by id, an empty set removes them, and `dispose`
 * removes them for good. A build that a newer set overtook is discarded.
 */
export function createExpressionToolRegistration(host: ExpressionToolsHost, port: ExpressionToolPort) {
  let generation = 0
  let disposed = false

  async function sync(exposed: readonly ExposedExpression[]) {
    const current = ++generation
    if (disposed)
      return
    if (exposed.length === 0) {
      host.removeToolsByIds(...expressionToolIds)
      return
    }
    // NOTICE: these tools carry no `defaultActive: false` and no `requiresExplicitSelection`;
    // the shared `activeTools` filter drops both, as noted beside the Home Assistant tools in
    // apps/stage-tamagotchi/src/renderer/stores/tools/home-assistant.ts.
    const tools = await createExpressionTools(port)
    if (current !== generation || disposed)
      return
    host.addTools(...tools.map(tool => ({ ...tool, id: `expression:${tool.function.name}` } satisfies ExecutableTool)))
  }

  function dispose() {
    disposed = true
    generation++
    host.removeToolsByIds(...expressionToolIds)
  }

  return { sync, dispose }
}

/** The expression store surface the tool port reads; leases are the performer's slot occupants. */
export interface ExpressionToolPerformer {
  readonly llmEligibleEntries: readonly CatalogEntry[]
  readonly leases: Readonly<Record<SlotName, { expressionId: string } | null>>
}

/** Exposed expressions that occupy a slot now. Auto picks of unexposed entries stay hidden. */
export function activeExpressionsOf(performer: ExpressionToolPerformer): ActiveExpression[] {
  return slotNames.flatMap((slot) => {
    const id = performer.leases[slot]?.expressionId
    const entry = id === undefined ? undefined : performer.llmEligibleEntries.find(candidate => candidate.id === id)
    return entry ? [{ slot, label: entry.label }] : []
  })
}

/** Implements the expression tools over the conductor; results report the performer's real slots. */
export function createExpressionToolPort(conductor: StagePerformanceConductor, performer: ExpressionToolPerformer): ExpressionToolPort {
  return {
    list: () => performer.llmEligibleEntries.flatMap((entry) => {
      const kind = slotOfKind[entry.kind]
      return kind ? [{ label: entry.label, kind, active: performer.leases[kind]?.expressionId === entry.id }] : []
    }),
    set: (name, holdSeconds) => {
      const entry = conductor.expression(name, holdSeconds, 'tool')
      if (!entry)
        return { success: false, error: `"${name}" is not an exposed expression.`, available: toExposedExpressions(performer.llmEligibleEntries).map(item => item.label) }
      // The performer can refuse a slot, for example to protect a saved default in its group.
      const slot = slotOfKind[entry.kind]
      if (!slot || performer.leases[slot]?.expressionId !== entry.id)
        return { success: false, error: `"${entry.label}" cannot be shown now.`, active: activeExpressionsOf(performer) }
      return { success: true, active: activeExpressionsOf(performer) }
    },
    clear: (slot) => {
      conductor.clearExpression(slot, 'tool')
      return { success: true, active: activeExpressionsOf(performer) }
    },
  }
}

function roundMood(value: number) {
  return Math.round(value * 10) / 10
}

/** Mood drifts slowly, so state feedback samples it at this period instead of every frame. */
const MOOD_SAMPLE_MS = 2000

/**
 * Creates the stage window's conductor. Creating the performance settings store here also makes
 * the stage window, the synchronization leader in Electron, the owner of its leader-routed
 * actions, so switches changed in the settings window take effect.
 *
 * The stage renderer is the only writer of the performance runtime state and the only owner of
 * the expression tool executors.
 */
export function useStagePerformanceConductor(options: Pick<StagePerformanceConductorOptions, 'scene' | 'driver' | 'playMotion'> & {
  /** Reads the Natural mood of the mounted model, or `null` when none runs. */
  mood: () => PerformanceMoodSnapshot | null
}) {
  const performanceSettings = useExpressionPerformanceSettings()
  const expressions = useExpressionStore()
  const runtimeState = usePerformanceRuntimeState()
  // Character profiles are applied here in a later step; until then the document is effective as is.
  const settings = computed(() => performanceSettings.document)
  const conductor = new StagePerformanceConductor({
    ...options,
    settings: () => settings.value,
    catalog: () => expressions.catalog,
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
  })

  const exposed = computed(() => toExposedExpressions(expressions.llmEligibleEntries))
  const active = computed(() => activeExpressionsOf(expressions))
  const moodWanted = computed(() => settings.value.stateFeedback && settings.value.mood && options.driver() === 'natural')
  const mood = shallowRef<PerformanceMoodSnapshot | null>(null)
  function sampleMood() {
    const value = moodWanted.value ? options.mood() : null
    const next = value && { valence: roundMood(value.valence), arousal: roundMood(value.arousal), tension: roundMood(value.tension) }
    if (JSON.stringify(next) !== JSON.stringify(mood.value))
      mood.value = next
  }
  useIntervalFn(sampleMood, MOOD_SAMPLE_MS)
  watch(moodWanted, sampleMood, { immediate: true })
  watch([exposed, active, mood], () => {
    runtimeState.publish({ exposed: exposed.value, active: active.value, mood: mood.value })
  }, { immediate: true })

  const registration = createExpressionToolRegistration(useLlmToolsStore(), createExpressionToolPort(conductor, expressions))
  watch(() => JSON.stringify(exposed.value), () => {
    registration.sync(exposed.value).catch(error => console.error('[performance-conductor] Expression tools failed to register:', errorMessageFrom(error)))
  }, { immediate: true })
  onScopeDispose(() => {
    registration.dispose()
    conductor.dispose()
  })

  return { conductor, settings }
}
