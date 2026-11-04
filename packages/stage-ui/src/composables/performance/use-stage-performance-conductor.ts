import type { FaceBaseline } from '@proj-airi/motion-driver-natural/baseline'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'
import type { NaturalEpisode } from '@proj-airi/motion-driver-natural/mood'
import type { CharacterReading } from '@proj-airi/stage-shared/character-state'
import type { AffectSignal, AffectTrace, CatalogEntry, DeciderContext, ExpressionPerformanceSettings, HoldCommand, MoodDose, PerformanceDecision, PerformanceProfile, SlotCommand, TimingEvent, TouchAffectInput } from '@proj-airi/stage-shared/expression-performance'
import type { AffectTraceRequest } from '@proj-airi/stage-shared/expression-performance/affect-trace-diagnostics'

import type { StageExpressionBackend } from '../../features/performance/expression-backend'
import type { ActiveExpression, ExposedExpression, ExposedExpressionGroup, PerformanceMoodSnapshot } from '../../features/performance/runtime-state'
import type { ExecutableTool } from '../../stores/ai/chat-llm/tools'
import type { BodyToolPort } from '../../tools/body'
import type { ExpressionToolPort } from '../../tools/expression'

import { errorMessageFrom } from '@moeru/std'
import { SpeechOnsetDetector } from '@proj-airi/motion-driver-natural/speech-emphasis'
import { faceBaselineOf } from '@proj-airi/stage-shared/character-state'
import { applyMappingWeights, createDecider, isLlmEligible, resolveEffectiveSettings, withAffectTrace } from '@proj-airi/stage-shared/expression-performance'
import { useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { useIntervalFn } from '@vueuse/core'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { EMOTION_EmotionMotionName_value, EMOTION_VALUES } from '../../constants/emotions'
import { usePerformanceRuntimeState } from '../../features/performance/runtime-state'
import { useExpressionPerformanceSettings } from '../../features/performance/settings'
import { useLlmToolsStore } from '../../stores/ai/chat-llm/tools'
import { createBodyTools } from '../../tools/body'
import { createExpressionTools } from '../../tools/expression'

type SpeechEvent = Extract<AffectSignal, { kind: 'speech' }>['event']
type Decider = ReturnType<typeof createDecider>
type DeciderState = ReturnType<Decider['initial']>
type SlotName = SlotCommand['slot']
type TimerHandle = ReturnType<typeof setTimeout>

const slotNames: readonly SlotName[] = ['face', 'effect', 'prop']

/** A decider decision whose episodes carry the mood dose gain of the context they were decided in. */
type StageDecision = Omit<PerformanceDecision, 'episodes'> & { episodes: NaturalEpisode[] }

/** An affect recording keeps at most this many entries; the next one marks it truncated. */
export const maxAffectTraceEntries = 20_000

/**
 * Moodless turns the conductor remembers, oldest dropped first. Reaction turns are single-pending and short, so a
 * turn falls out of this window long after its last episode was decided.
 */
const maxMoodlessTurns = 32

/** The turn a signal belongs to; deadline, muted, and touch signals belong to none. */
function turnOf(signal: AffectSignal): string | undefined {
  if (signal.kind === 'timing')
    return signal.event.turnId
  return signal.kind === 'deadline' || signal.kind === 'muted' || signal.kind === 'touch' ? undefined : signal.turnId
}

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

/** The group the LLM sees an entry in: its slot kind, or `combo` when it spans slots. No group means no exposure. */
function exposedGroupOf(entry: CatalogEntry): ExposedExpressionGroup | undefined {
  if (entry.kind === 'combo')
    return entry.slots?.length ? 'combo' : undefined
  return slotOfKind[entry.kind]
}

/** The labels and kinds the LLM may see: exposed face, effect, prop, and combo entries only. */
export function toExposedExpressions(catalog: readonly CatalogEntry[]): ExposedExpression[] {
  return catalog.flatMap((entry) => {
    const kind = exposedGroupOf(entry)
    return isLlmEligible(entry) && kind ? [{ label: entry.label, kind }] : []
  })
}

/** The slots whose lease must hold the entry for it to count as shown: a combo's spanned slots, else its own. */
function shownSlotsOf(entry: CatalogEntry): SlotName[] {
  if (entry.kind === 'combo')
    return entry.slots ?? []
  const slot = slotOfKind[entry.kind]
  return slot ? [slot] : []
}

/** The active renderer's scene surface the conductor dispatches to. */
export interface StagePerformanceScene {
  setEmotion: (episode: NaturalEpisode) => void
  applySlots: (commands: SlotCommand[], now: number) => void
  /** Natural only: sets or releases the held emotion; `now` shares the conductor clock. */
  applyHolds: (commands: HoldCommand[], now: number) => void
  onSpeech: (event: SpeechEvent, turnId: string, now: number) => void
  setMuted: (muted: boolean) => void
  /**
   * Live2D and MMD Natural: plays an ACT cue gesture. A scene that renders no cue gestures, such as a scenario sink,
   * omits it and the gesture is dropped.
   */
  gesture?: (kind: CueGestureKind, count: number) => void
  /**
   * Plays the clip the user labeled `label` and exposed as a gesture; the MMD scene resolves the label and counts the
   * drops. The ACT's cue `gesture`, when set, travels along so the scene can record it as superseded by the clip.
   * A scene without clips, such as the Live2D scene, omits it and the label is dropped.
   */
  action?: (label: string, gesture?: { kind: CueGestureKind, count: number }) => void
  /**
   * Live2D and MMD Natural: adds a decided mood dose, deduplicated by id. A scene without it, such as a scenario sink,
   * drops the dose; the decider state still advances.
   */
  addMood?: (dose: MoodDose) => void
  /**
   * Live2D and MMD Natural: sets the resting face target from the character's slow mood; Natural filters it. A scene
   * without it, such as a scenario sink, drops it.
   */
  setFaceBaseline?: (baseline: FaceBaseline) => void
}

/**
 * How the scene performs. `natural` is Live2D or MMD under the Natural driver. `basic` is every
 * other driver (Live2D Universal and MAGIC, MMD Classic), which plays motion groups instead of episodes.
 */
export type StagePerformanceDriver = 'natural' | 'basic'

export interface StagePerformanceConductorOptions {
  /** Undefined while no performance scene is mounted; decisions still advance the decider state. */
  scene: () => StagePerformanceScene | undefined
  driver: () => StagePerformanceDriver
  /** Plays a motion group under a basic driver. */
  playMotion: (group: string) => void
  settings: () => ExpressionPerformanceSettings
  catalog: () => readonly CatalogEntry[]
  /** Decider seed, fixed for the lifetime of the conductor so traces can replay it. */
  seed: number
  /**
   * The card performance profile a signal plays under: the character of the signal's turn, or
   * the active card for a signal without a turn. `undefined` applies no profile.
   *
   * @default () => undefined
   */
  profile?: (turnId: string | undefined) => PerformanceProfile | undefined
  /**
   * The id of the mounted model, which keys the profile's mapping weights.
   *
   * @default () => ''
   */
  modelId?: () => string
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
 * - Natural: decided episodes go to `scene.setEmotion` and decided holds to `scene.applyHolds`.
 * - Basic (Live2D Universal and MAGIC, MMD Classic): every recognized emotion plays its motion group, repeats and
 *   `neutral` (`Idle`) included, independently of episode filtering.
 *   The decider context reports `heldEmotions` off there, so explicit expressions derive no
 *   reaction state and later slot decisions match the held-emotion-free behavior.
 * - Slot commands go to `scene.applySlots` for every driver.
 * - Touch mood doses go to `scene.addMood` and ACT cue gestures to `scene.gesture`, both under the Natural driver of
 *   Live2D and MMD. Universal, MAGIC, and MMD Classic have no touch path and ignore the gesture field.
 * - The resting face baseline goes to `scene.setFaceBaseline` for every driver. Natural composes it only while it
 *   drives the face, so Universal and MAGIC hold it without writing.
 *
 * Moodless turns: `markMoodless(turnId)` makes every later episode decided for that turn carry `moodGain` 0, so a
 * reaction to a touch shows on the face without dosing mood a second time; the touch already dosed it.
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
 *
 * Character profiles: every signal is decided under the effective context of its character
 * (see `profile`): `resolveEffectiveSettings` scales the mood dynamics, `applyMappingWeights`
 * scales or disables catalog mappings, and `expressiveness` scales an emotion's nominal
 * intensity, clamped to [0, 1], before the decider bands it. Each decided episode carries
 * `moodGain`, the mood dose gain of its band under that context, so Natural doses it under the
 * character that produced it even when a later decision uses another profile.
 *
 * Affect recording: an explicit session (see {@link StagePerformanceConductor.startRecording}).
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
  /** The open affect recording and the JSON of the last context it recorded. */
  private recording: { trace: Omit<AffectTrace, 'endAt'>, context: string } | undefined
  /** Turns whose episodes dose no mood, in insertion order; see {@link maxMoodlessTurns}. */
  private readonly moodlessTurns = new Set<string>()

  constructor(private readonly options: StagePerformanceConductorOptions) {
    this.seed = options.seed
    this.deciderKind = options.settings().decider
    this.decider = this.createTracedDecider(this.deciderKind)
    this.state = this.decider.initial(this.seed)
    this.clock = options.clock ?? (() => performance.now() / 1000)
    this.timers = options.timers ?? browserTimers
  }

  /**
   * Plays an emotion. `suppressMotionGroup` skips only the Universal and MAGIC motion group, for an
   * ACT that already set its own motion; Natural still gets its episodes and holds, and slots apply.
   */
  emotion(name: string, nominal: number, source: 'act' | 'tool' | 'devtools', turnId?: string, options: { suppressMotionGroup?: boolean } = {}) {
    const emotion = EMOTION_VALUES.find(value => value === name)
    if (!emotion || !Number.isFinite(nominal)) {
      console.warn('[performance-conductor] Unrecognized emotion dropped:', name, nominal)
      return
    }
    const at = this.clock()
    const { context, expressiveness } = this.effectiveContext(turnId)
    const scaled = Math.min(1, Math.max(0, nominal * expressiveness))
    const decision = this.decide({ kind: 'emotion', source, emotion, nominal: scaled, turnId, at }, context)
    if (this.options.driver() === 'natural')
      this.dispatchNatural(decision, at)
    else if (!options.suppressMotionGroup)
      this.options.playMotion(EMOTION_EmotionMotionName_value[emotion])
    this.dispatchSlots(decision, at)
  }

  /**
   * Shows an LLM-named expression. Only LLM-exposed face, effect, and prop entries
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
    const decision = this.decide({ kind: 'expression', source, expressionId: entry.id, holdSeconds, turnId, at })
    this.dispatchNatural(decision, at)
    this.dispatchSlots(decision, at)
    return entry
  }

  /**
   * Releases one slot, or the face, effect, and prop slots when none is named. Saved defaults
   * and manual toggles are not slot leases, so they stay. The clear is a decider signal, so an
   * affect trace replays it like any other decision.
   */
  clearExpression(slot: SlotName | undefined, source: 'act' | 'tool' | 'devtools', turnId?: string) {
    const at = this.clock()
    const decision = this.decide({ kind: 'clear', source, slot, turnId, at })
    this.dispatchNatural(decision, at)
    this.dispatchSlots(decision, at)
  }

  /**
   * Doses mood from a classified touch. The decider owns pacing and habituation (see `touchAffect`); the doses reach
   * `scene.addMood` under the Natural driver of Live2D and MMD, and Universal, MAGIC, and MMD Classic never receive one.
   * A touch belongs to no
   * turn, so it is decided under the active card's profile.
   */
  touch(input: Omit<TouchAffectInput, 'at'>) {
    const at = this.clock()
    const decision = this.decide({ kind: 'touch', ...input, at })
    if (this.options.driver() !== 'natural')
      return
    const scene = this.options.scene()
    for (const dose of decision.moods)
      scene?.addMood?.(dose)
  }

  /**
   * Plays an ACT cue gesture under the Natural driver of Live2D and MMD; Universal, MAGIC, and MMD Classic ignore it.
   * The decider is not involved.
   */
  gesture(kind: CueGestureKind, count: number) {
    if (this.options.driver() === 'natural')
      this.options.scene()?.gesture?.(kind, count)
  }

  /** Sets the resting face of the mounted scene; the decider is not involved. */
  faceBaseline(baseline: FaceBaseline) {
    this.options.scene()?.setFaceBaseline?.(baseline)
  }

  /**
   * Forwards an ACT action label to the scene under every driver: MMD Natural and Classic both play clips, so unlike
   * `gesture` there is no driver gate.
   */
  action(label: string, gesture?: { kind: CueGestureKind, count: number }) {
    this.options.scene()?.action?.(label, gesture)
  }

  /** Every episode decided for `turnId` from now on carries `moodGain` 0. Marking a turn again keeps it marked. */
  markMoodless(turnId: string) {
    this.moodlessTurns.delete(turnId)
    this.moodlessTurns.add(turnId)
    const oldest = this.moodlessTurns.values().next()
    if (this.moodlessTurns.size > maxMoodlessTurns && !oldest.done)
      this.moodlessTurns.delete(oldest.value)
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

  /**
   * Starts an affect recording and replaces any open one. The trace starts from a copy of the
   * decider state and the effective context of the active card. Every later signal is appended
   * in order. A context entry precedes the first signal whose effective context differs from the
   * last recorded one, so replay applies settings, catalog, and profile changes exactly where the
   * live decider saw them. A recording keeps at most {@link maxAffectTraceEntries} entries; the
   * next entry marks it truncated and stops it. A decider switch also marks it truncated, because
   * the switch resets the decider state.
   */
  startRecording() {
    const context = JSON.stringify(this.effectiveContext(undefined).context)
    this.recording = {
      context,
      trace: {
        version: 1,
        decider: this.deciderKind,
        checkpoint: structuredClone(this.state),
        initialContext: JSON.parse(context) as DeciderContext,
        entries: [],
        truncated: false,
      },
    }
  }

  /**
   * Returns the open recording as an affect trace that ends now, or `undefined` when no recording
   * is open. Recording continues, so a later export contains this one.
   */
  exportTrace(): AffectTrace | undefined {
    const trace = this.recording?.trace
    return trace && { ...trace, entries: [...trace.entries], endAt: this.clock() }
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

  /** Sends a timing or deadline decision: episodes and holds reach the Natural scene, and slots reach every driver. */
  private dispatch(decision: StageDecision, at: number) {
    this.dispatchNatural(decision, at)
    this.dispatchSlots(decision, at)
  }

  /** Natural only: episodes first, so a hold never precedes the episode it accompanies. */
  private dispatchNatural(decision: StageDecision, at: number) {
    if (this.options.driver() !== 'natural')
      return
    const scene = this.options.scene()
    for (const episode of decision.episodes)
      scene?.setEmotion(episode)
    if (decision.holds.length > 0) {
      // Like dispatchSlots: a scene that mounted after the last mute change has not heard it, and its
      // performer would keep an unstarted speech hold for the full unstarted expiry.
      scene?.setMuted(this.muted)
      scene?.applyHolds(decision.holds, at)
    }
  }

  /** Applies the card profile of a turn's character, or of the active card, to the settings and the catalog. */
  private effectiveContext(turnId: string | undefined): { context: DeciderContext, expressiveness: number } {
    const profile = this.options.profile?.(turnId)
    const { settings, expressiveness } = resolveEffectiveSettings(this.options.settings(), profile)
    const catalog = applyMappingWeights(this.options.catalog(), this.options.modelId?.() ?? '', profile)
    // Held emotions exist only in Natural. Elsewhere the flag is off in the effective copy only,
    // so the shared document stays untouched and no reaction state leaks into Universal and MAGIC.
    const effective = this.options.driver() === 'natural' ? settings : { ...settings, heldEmotions: false }
    return { context: { catalog, settings: effective }, expressiveness }
  }

  /** The trace wrapper records each signal before the decider sees it. */
  private createTracedDecider(kind: ExpressionPerformanceSettings['decider']): Decider {
    return withAffectTrace(createDecider(kind), signal => this.record({ type: 'signal', signal }))
  }

  private record(entry: AffectTrace['entries'][number]) {
    const trace = this.recording?.trace
    if (!trace || trace.truncated)
      return
    if (trace.entries.length >= maxAffectTraceEntries) {
      trace.truncated = true
      return
    }
    trace.entries.push(entry)
  }

  /** Records the context as plain JSON when it differs from the last recorded one. */
  private recordContext(context: DeciderContext) {
    const recording = this.recording
    if (!recording || recording.trace.truncated)
      return
    const json = JSON.stringify(context)
    if (json === recording.context)
      return
    recording.context = json
    this.record({ type: 'context', context: JSON.parse(json) as DeciderContext })
  }

  private decide(signal: AffectSignal, context = this.effectiveContext(turnOf(signal)).context): StageDecision {
    // A decider switch keeps the seed, so both deciders replay from the same randomness.
    if (context.settings.decider !== this.deciderKind) {
      this.deciderKind = context.settings.decider
      this.decider = this.createTracedDecider(this.deciderKind)
      this.state = this.decider.initial(this.seed)
      if (this.recording)
        this.recording.trace.truncated = true
    }
    this.recordContext(context)
    const result = this.decider.decide(signal, context, this.state)
    this.state = result.state
    this.lastSignalAt = Math.max(this.lastSignalAt, signal.at)
    this.armDeadline()
    // After the decider, so decisions and traces stay exactly what the decider produced.
    const mood = context.settings.moodDynamics
    const turnId = turnOf(signal)
    const moodless = turnId !== undefined && this.moodlessTurns.has(turnId)
    return { ...result.decision, episodes: result.decision.episodes.map(episode => ({ ...episode, moodGain: moodless ? 0 : mood[`${episode.band}Gain`] })) }
  }

  private dispatchSlots(decision: StageDecision, at: number) {
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

export const bodyToolIds = ['body:come_here', 'body:go_home', 'body:look_at'] as const

/**
 * Keeps the body tools registered while the active scene offers a body port.
 *
 * A missing port removes the tools, a new port replaces them by id, and `dispose` removes them for good.
 * A build that a newer port overtook is discarded.
 */
export function createBodyToolRegistration(host: ExpressionToolsHost) {
  let generation = 0
  let disposed = false

  async function sync(port: BodyToolPort | undefined) {
    const current = ++generation
    if (disposed)
      return
    if (!port) {
      host.removeToolsByIds(...bodyToolIds)
      return
    }
    const tools = await createBodyTools(port)
    if (current !== generation || disposed)
      return
    host.addTools(...tools.map(tool => ({ ...tool, id: `body:${tool.function.name}` } satisfies ExecutableTool)))
  }

  function dispose() {
    disposed = true
    generation++
    host.removeToolsByIds(...bodyToolIds)
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
      const kind = exposedGroupOf(entry)
      return kind ? [{ label: entry.label, kind, active: shownSlotsOf(entry).some(slot => performer.leases[slot]?.expressionId === entry.id) }] : []
    }),
    set: (name, holdSeconds) => {
      const entry = conductor.expression(name, holdSeconds, 'tool')
      if (!entry)
        return { success: false, error: `"${name}" is not an exposed expression.`, available: toExposedExpressions(performer.llmEligibleEntries).map(item => item.label) }
      // The performer can refuse a slot, for example to protect a saved default in its group.
      if (!shownSlotsOf(entry).some(slot => performer.leases[slot]?.expressionId === entry.id))
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

/** The diagnostics store actions the stage answers lab affect-trace requests with. */
type AffectTraceAnswers = Pick<ReturnType<typeof useNaturalMotionDiagnostics>, 'completeAffectTrace' | 'failAffectTrace'>

/** Starts or exports the stage conductor's affect recording for a lab request. */
export function answerAffectTraceRequest(conductor: StagePerformanceConductor, answers: AffectTraceAnswers, request: AffectTraceRequest) {
  if (request.action === 'start') {
    conductor.startRecording()
    answers.completeAffectTrace(request.id, null)
    return
  }
  const trace = conductor.exportTrace()
  if (trace)
    answers.completeAffectTrace(request.id, trace)
  else
    answers.failAffectTrace(request.id, 'no-recording')
}

/** Mood drifts slowly, so state feedback samples it at this period instead of every frame. */
const MOOD_SAMPLE_MS = 2000

/** The slow mood changes over minutes, so the resting face is recomputed at this period; Natural filters each step. */
export const FACE_BASELINE_SAMPLE_MS = 1000

/**
 * Creates the stage window's conductor. Creating the performance settings store here also makes
 * the stage window, the synchronization leader in Electron, the owner of its leader-routed
 * actions, so switches changed in the settings window take effect.
 *
 * The stage renderer is the only writer of the performance runtime state, the only owner of
 * the expression tool executors, and the only window that answers lab affect-trace requests.
 *
 * Every {@link FACE_BASELINE_SAMPLE_MS}, and once at creation, it reads `characterReading` and sends its face baseline
 * to the scene; no reading sends the neutral baseline.
 */
export function useStagePerformanceConductor(options: Pick<StagePerformanceConductorOptions, 'scene' | 'driver' | 'playMotion' | 'profile'> & {
  renderer: () => string | undefined
  expressionBackend: () => StageExpressionBackend | undefined
  /** The body tool port of the active scene; undefined when it has no body support (Live2D, classic MMD). */
  bodyPort?: () => BodyToolPort | undefined
  /** Reads the Natural mood of the mounted model, or `null` when none runs. */
  mood: () => PerformanceMoodSnapshot | null
  /**
   * The active card's replicated character reading the resting face follows, or `null` for none.
   *
   * @default () => null
   */
  characterReading?: () => CharacterReading | null
}) {
  const performanceSettings = useExpressionPerformanceSettings()
  const expressions: StageExpressionBackend = {
    get catalog() { return options.expressionBackend()?.catalog ?? [] },
    get modelId() { return options.expressionBackend()?.modelId ?? '' },
    get llmEligibleEntries() { return options.expressionBackend()?.llmEligibleEntries ?? [] },
    get leases() { return options.expressionBackend()?.leases ?? { face: null, effect: null, prop: null } },
  }
  const runtimeState = usePerformanceRuntimeState()
  // The shared document; the conductor applies each signal's character profile on top of it.
  const settingsDocument = computed(() => performanceSettings.document)
  /**
   * The settings the Natural scene performs with: the document under the active card's profile.
   * Mood doses do not depend on it, because each episode carries its own character's gain. The
   * continuous parameters, mood decay and the band shapes, follow the active card: one model
   * shows one character over time. An equal result keeps its identity, so the scene does not
   * re-apply unchanged settings.
   */
  const settings = computed<ExpressionPerformanceSettings>((previous) => {
    const next = resolveEffectiveSettings(settingsDocument.value, options.profile?.(undefined)).settings
    return previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next
  })
  const conductor = new StagePerformanceConductor({
    ...options,
    settings: () => settingsDocument.value,
    catalog: () => expressions.catalog,
    modelId: () => expressions.modelId,
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
  function sendFaceBaseline() {
    conductor.faceBaseline(faceBaselineOf(options.characterReading?.() ?? null, Date.now()))
  }
  useIntervalFn(sendFaceBaseline, FACE_BASELINE_SAMPLE_MS)
  sendFaceBaseline()

  watch([exposed, active, mood], () => {
    runtimeState.publish({ exposed: exposed.value, active: active.value, mood: mood.value })
  }, { immediate: true })

  const registration = createExpressionToolRegistration(useLlmToolsStore(), createExpressionToolPort(conductor, expressions))
  watch(() => JSON.stringify(exposed.value), () => {
    registration.sync(exposed.value).catch(error => console.error('[performance-conductor] Expression tools failed to register:', errorMessageFrom(error)))
  }, { immediate: true })
  const bodyRegistration = createBodyToolRegistration(useLlmToolsStore())
  watch(() => options.bodyPort?.(), (port) => {
    bodyRegistration.sync(port).catch(error => console.error('[performance-conductor] Body tools failed to register:', errorMessageFrom(error)))
  }, { immediate: true })
  const diagnostics = useNaturalMotionDiagnostics()
  watch(() => diagnostics.affectTraceRequest, (request) => {
    if (request && options.renderer() === 'live2d')
      answerAffectTraceRequest(conductor, diagnostics, request)
  })

  onScopeDispose(() => {
    registration.dispose()
    bodyRegistration.dispose()
    conductor.dispose()
  })

  return { conductor, settings }
}
