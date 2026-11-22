import type { AttendIntent, CharacterMind, ChatReadIntent, ChatStimulus, CueGestureStimulus, MindIdleIntent, MindIntent, TouchReactionIntent, TouchReport } from '@proj-airi/character-mind'
import type { FaceBaseline } from '@proj-airi/motion-driver-natural/baseline'
import type { CueGestureKind } from '@proj-airi/motion-driver-natural/cue-gestures'
import type { CursorOrder, CursorReport } from '@proj-airi/motion-driver-natural/cursor-notice'
import type { IdleBehaviourKind, IdleCueKind, NaturalIdleDrive } from '@proj-airi/motion-driver-natural/idle-activities'
import type { IdleOrder, IdleReport, IdleView } from '@proj-airi/motion-driver-natural/idle-schedule'
import type { NaturalEpisode } from '@proj-airi/motion-driver-natural/mood'
import type { CharacterReading } from '@proj-airi/stage-shared/character-state'
import type { AffectSignal, AffectTrace, CatalogEntry, DeciderContext, ExpressionPerformanceSettings, HoldCommand, Moment, MoodDose, PerformanceDecision, PerformanceProfile, ReactionEpisode, SlotCommand, TimingEvent } from '@proj-airi/stage-shared/expression-performance'
import type { AffectTraceRequest } from '@proj-airi/stage-shared/expression-performance/affect-trace-diagnostics'
import type { PerformanceEvent } from '@proj-airi/stage-shared/performance-state'
import type { TouchObservation } from '@proj-airi/stage-shared/situation'

import type { StageExpressionBackend } from '../../features/performance/expression-backend'
import type { ActiveExpression, ExposedAction, ExposedExpression, ExposedExpressionGroup, PerformanceMoodSnapshot } from '../../features/performance/runtime-state'
import type { ExecutableTool } from '../../stores/ai/chat-llm/tools'
import type { ActionToolPort, ExposedToolAction } from '../../tools/action'
import type { BodyToolPort } from '../../tools/body'
import type { ExpressionToolPort } from '../../tools/expression'
import type { VoicePort } from './mind-voice'

import { errorMessageFrom } from '@moeru/std'
import { idleOrderOf } from '@proj-airi/character-mind'
import { dormantIdleView } from '@proj-airi/motion-driver-natural/idle-schedule'
import { SpeechOnsetDetector } from '@proj-airi/motion-driver-natural/speech-emphasis'
import { faceBaselineOf, idleDriveOf } from '@proj-airi/stage-shared/character-state'
import { applyMappingWeights, createDecider, explicitExpressionCommand, isLlmEligible, primaryMapping, resolveEffectiveSettings, withAffectTrace } from '@proj-airi/stage-shared/expression-performance'
import { useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { useIntervalFn } from '@vueuse/core'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { EMOTION_EmotionMotionName_value, EMOTION_VALUES } from '../../constants/emotions'
import { usePerformanceRuntimeState } from '../../features/performance/runtime-state'
import { useExpressionPerformanceSettings } from '../../features/performance/settings'
import { useLlmToolsStore } from '../../stores/ai/chat-llm/tools'
import { useStageExpressionCatalogStore } from '../../stores/stage-expression-catalog'
import { createActionToolRegistration } from '../../tools/action'
import { createBodyTools } from '../../tools/body'
import { createExpressionTools } from '../../tools/expression'
import { MindVoice } from './mind-voice'

type SpeechEvent = Extract<AffectSignal, { kind: 'speech' }>['event']
type Decider = ReturnType<typeof createDecider>
type DeciderState = ReturnType<Decider['initial']>
type SlotName = SlotCommand['slot']
type TimerHandle = ReturnType<typeof setTimeout>

const slotNames: readonly SlotName[] = ['face', 'effect', 'prop']

/** An affect recording keeps at most this many entries; the next one marks it truncated. */
export const maxAffectTraceEntries = 20_000

/**
 * Moodless turns the conductor remembers, oldest dropped first. Reaction turns are single-pending and short, so a
 * turn falls out of this window long after its last episode was decided.
 */
const maxMoodlessTurns = 32

/** The turn a signal belongs to; deadline and muted signals belong to none. */
function turnOf(signal: AffectSignal): string | undefined {
  if (signal.kind === 'timing')
    return signal.event.turnId
  return signal.kind === 'deadline' || signal.kind === 'muted' ? undefined : signal.turnId
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
   * Live2D and MMD Natural: adds the mood dose the mind decided, deduplicated by id. A scene without it, such as a
   * scenario sink, drops the dose; the mind's state still advances.
   */
  addMood?: (dose: MoodDose) => void
  /**
   * Live2D and MMD Natural: performs the mind's reaction to a touch. A poke starts at its point. A pet `start` lets
   * the pet hand reach Natural and `end` withdraws it, so no pet shows that the mind did not grant.
   */
  reactToTouch?: (intent: TouchReactionIntent) => void
  /** Live2D and MMD Natural: ends idle sleep gently; awake, she ignores it. A scene without it drops the intent. */
  wakeFromSleep?: () => void
  /** Live2D and MMD Natural: a brief reaction to the desktop; a `wake` also rouses her from sleep with a start. */
  reactToDesktop?: (reaction: 'wake' | 'screen-change') => void
  /**
   * Live2D and MMD Natural: sets the resting face target from the character's slow mood; Natural filters it. A scene
   * without it, such as a scenario sink, drops it.
   */
  setFaceBaseline?: (baseline: FaceBaseline) => void
  /**
   * Live2D and MMD Natural: sets what shapes her self-directed idle behaviour, or switches it off with `null`. A scene
   * without it, such as a scenario sink, performs none.
   */
  setIdleDrive?: (drive: NaturalIdleDrive | null) => void
  /** Live2D and MMD Natural: plays the body language around a reach-out. A scene without it drops the cue. */
  idleCue?: (kind: IdleCueKind) => void
  /**
   * Live2D and MMD Natural: hands one detected beat, `intervalSeconds` after the previous, to Natural's beat clock, on
   * which a groove plays. A scene without it drops the beat.
   */
  beat?: (intervalSeconds: number) => void
  /**
   * Live2D and MMD Natural: plays what the character mind's idle policy decided. The scene's Natural performer answers
   * it in its idle reports. A scene without it, such as a scenario sink, drops the order.
   */
  idle?: (order: IdleOrder) => void
  /**
   * Live2D and MMD Natural: plays the cursor episode the character mind drew for one of this scene's cursor reports.
   * A scene without it drops the order.
   */
  cursorEpisode?: (order: CursorOrder) => void
  /**
   * MMD under the Natural driver: opens the body director's attend window, inside which she may walk toward the
   * cursor. A scene without a body director, such as the Live2D scene, drops it.
   */
  attend?: (intent: AttendIntent) => void
  /**
   * Live2D and MMD Natural: reads the chat, as the mind decided for a sent message or an unfolded chat. Natural draws
   * the read's delay and hold and drops it without a chat target or while she talks. A scene without it drops the read.
   */
  chatRead?: (intent: ChatReadIntent) => void
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
  /**
   * The character mind. It decides every emotion, its strength, and its hold before the decider picks entries.
   *
   * The mind answers on its own clock, in epoch milliseconds, and the conductor never passes it a time. A caller
   * that injects `clock` gives the mind the same clock in milliseconds, so that both count the same seconds.
   */
  mind: CharacterMind
  /**
   * Marks a moment the mind decided with one of the model's own expressions. The performer keeps the chance, the
   * pick, and the entry rest. Without it the moment is dropped.
   */
  markMoment?: (moment: Moment) => void
  /**
   * The voice channel, or undefined when this stage has none; the mind then decides no line and the situation
   * learns of no return.
   *
   * @default () => undefined
   */
  voice?: () => VoicePort | undefined
  /**
   * Hands the scene's idle reports to the character mind: the stage's handle from `attachStage`. Without it the mind
   * hears nothing of the idle performer, and decides no idle act.
   *
   * @default undefined
   */
  idleReports?: (reports: readonly IdleReport[]) => void
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
 * Turns stage events into stimuli for the character mind and signals for the asset decider, and dispatches what
 * they decide to the scene.
 *
 * State model: the conductor owns one decider state (seeded once), the turn ids it last saw
 * active, and the last muted flag. It validates inputs and dispatches. The mind decides each emotion, its strength,
 * and its hold, and owns the reaction history; the decider picks the entries that show it. An emotion, a named
 * expression, and a clear reach the mind first, and the decider then receives what the mind decided.
 *
 * Routing per driver:
 * - Natural: the mind's episodes go to `scene.setEmotion` and its holds to `scene.applyHolds`.
 * - Basic (Live2D Universal and MAGIC, MMD Classic): every recognized emotion plays its motion group, repeats and
 *   `neutral` (`Idle`) included, independently of episode filtering.
 *   The mind's settings report `heldEmotions` off there, so explicit expressions derive no
 *   reaction state and later slot decisions match the held-emotion-free behavior.
 * - Slot commands go to `scene.applySlots` for every driver.
 * - A touch reaches the mind only under Natural (see {@link StagePerformanceConductor.touch}). ACT and devtools cue
 *   gestures step the mind under every driver, and its `gesture` intent goes to `scene.gesture` only under the Natural
 *   driver of Live2D and MMD (see {@link StagePerformanceConductor.gesture}). Universal, MAGIC, and MMD Classic have no
 *   touch path and play no cue gestures.
 * - Presence and screen-change events reach the mind under every driver (see {@link StagePerformanceConductor.desktop});
 *   only Natural performs the posture intents it answers with.
 * - A cursor report reaches the mind only under Natural, and its episode returns to this conductor's scene (see
 *   {@link StagePerformanceConductor.cursor}).
 * - A drag release reaches the mind under every driver, and its `attend` goes to `scene.attend` only under Natural,
 *   because the MMD body walks only under Natural (see {@link StagePerformanceConductor.interaction}). A touch's
 *   `attend` goes the same way.
 * - A sent chat message and an unfolded chat reach the mind under every driver, and its `chat-read` and `attend` go to
 *   the scene only under Natural (see {@link StagePerformanceConductor.chat}).
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
 * intensity, clamped to [0, 1], before the mind bands it. Each decided episode carries
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
  /** Every mind step that may touch the voice state goes through it, so the voice port sees what changed. */
  private readonly voice: MindVoice
  /** The latest idle view the scene reported under any driver, and whether the mind was last told the dormant view. */
  private idleView: IdleView | null = null
  private idleDormant = false

  constructor(private readonly options: StagePerformanceConductorOptions) {
    this.seed = options.seed
    this.voice = new MindVoice(options.mind, () => options.voice?.(), cue => this.idleCue(cue))
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
    // A repeat that neither starts nor escalates an episode yields no intent, and the decider hears nothing.
    // An idle intent that fell due before the stimulus comes first; the store dispatches it.
    const intent = this.options.mind.receive({ kind: 'emotion', source, emotion, nominal: scaled, turnId, settings: context.settings }).find(each => each.kind === 'emotion' || each.kind === 'release')
    let slots: SlotCommand[] = []
    if (intent?.kind === 'emotion') {
      slots = this.decide({ kind: 'reaction', episode: intent.episode, turnId, at }, context).slots
      this.dispatchNatural(this.dosed(intent.episode, context, turnId), intent.hold, at)
    }
    else if (intent?.kind === 'release') {
      slots = this.decide({ kind: 'neutral', turnId, at }, context).slots
      this.dispatchNatural(null, intent.hold, at)
    }
    if (this.options.driver() !== 'natural' && !options.suppressMotionGroup)
      this.options.playMotion(EMOTION_EmotionMotionName_value[emotion])
    this.dispatchSlots(slots, at)
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
    const { context } = this.effectiveContext(turnId)
    // The mind reads no catalog, so the conductor reads the entry's lease and its primary emotion mapping for it.
    // An entry without slots shows nothing and derives no reaction.
    const lease = explicitExpressionCommand({ expressionId: entry.id, holdSeconds, turnId }, context)?.[0]
    const mapping = primaryMapping(context.catalog.find(candidate => candidate.id === entry.id))
    const intent = (lease
      ? this.options.mind.receive({
          kind: 'expression-request',
          source,
          entryId: entry.id,
          lease: { holdSeconds: lease.holdSeconds, until: lease.until },
          mapping: mapping && { emotion: mapping.emotion, minBand: mapping.minBand },
          turnId,
          settings: context.settings,
        })
      : []).find(each => each.kind === 'entry')
    const request = intent?.kind === 'entry' ? intent : undefined
    const episode = request?.episode ?? null
    const decision = this.decide({ kind: 'expression', source, expressionId: entry.id, holdSeconds, episode, turnId, at }, context)
    this.dispatchNatural(episode && this.dosed(episode, context, turnId), request?.hold ?? null, at)
    this.dispatchSlots(decision.slots, at)
    return entry
  }

  /**
   * Releases one slot, or the face, effect, and prop slots when none is named. Saved defaults
   * and manual toggles are not slot leases, so they stay. The mind releases the held emotion when no slot is named.
   * The clear is also a decider signal, so an affect trace replays it like any other decision.
   */
  clearExpression(slot: SlotName | undefined, source: 'act' | 'tool' | 'devtools', turnId?: string) {
    const at = this.clock()
    const intent = this.options.mind.receive({ kind: 'expression-clear', source, slot, turnId }).find(each => each.kind === 'release')
    const decision = this.decide({ kind: 'clear', source, slot, turnId, at })
    this.dispatchNatural(null, intent?.kind === 'release' ? intent.hold : null, at)
    this.dispatchSlots(decision.slots, at)
  }

  /**
   * Answers a classified touch once, under the Natural driver of Live2D and MMD; Universal, MAGIC, and MMD Classic
   * have no touch path and never reach the mind. The mind decides the response and the conductor dispatches it:
   * - `touch-reaction` to `scene.reactToTouch` and `mood` to `scene.addMood`;
   * - `moment` to `markMoment`;
   * - `speak` to the voice port, whose outcome returns to the mind as a `voice-outcome` stimulus;
   * - `attend` to `scene.attend`.
   *
   * A finished pet and a poke are first recorded in the situation (`voice().observeTouch`), on the wall clock the
   * situation counts in; a pet start is not, because the situation reports a pet once, when it ends. A touch belongs
   * to no turn, so it is decided under the active card's profile. The asset decider is not involved.
   */
  touch(report: TouchReport) {
    if (this.options.driver() !== 'natural')
      return
    let observation: TouchObservation | undefined
    if (report.gesture === 'pet-end')
      observation = { kind: 'touch', gesture: 'pet', region: 'head', atMs: Date.now(), durationMs: report.durationMs }
    else if (report.gesture === 'poke')
      observation = { kind: 'touch', gesture: 'poke', region: report.region, atMs: Date.now() }
    const voice = observation ? this.options.voice?.()?.observeTouch(observation) ?? null : null
    const { settings } = this.effectiveContext(undefined).context
    this.performTouch(this.voice.receive({ kind: 'touch', ...report, settings, voice }))
  }

  /**
   * Sends the performance resolver's events of one call to the mind as one step, under every driver, and dispatches
   * the response: `wake` to `scene.wakeFromSleep` and `desktop-reaction` to `scene.reactToDesktop` only under Natural,
   * `moment` to `markMoment` under every driver, and `observe-wake` and `observe-return` to `voice().observeReturn`
   * under every driver, in intent order.
   */
  desktop(events: readonly PerformanceEvent[]) {
    if (events.length === 0)
      return
    const natural = this.options.driver() === 'natural'
    const scene = this.options.scene()
    for (const intent of this.voice.receive(...events)) {
      if (intent.kind === 'wake' && natural)
        scene?.wakeFromSleep?.()
      else if (intent.kind === 'desktop-reaction' && natural)
        scene?.reactToDesktop?.(intent.reaction)
      else if (intent.kind === 'moment')
        this.options.markMoment?.(intent.moment)
      else if (intent.kind === 'observe-wake')
        this.options.voice?.()?.observeReturn({ kind: 'wake', cause: intent.wakeCause, atMs: intent.atMs, awayMs: intent.awayMs })
      else if (intent.kind === 'observe-return')
        this.options.voice?.()?.observeReturn({ kind: 'return', atMs: intent.atMs, awayMs: intent.awayMs })
    }
  }

  /**
   * Sends an ACT or devtools cue gesture to the mind as a `cue-gesture` stimulus under every driver, and plays the mind's
   * `gesture` intent on the scene under the Natural driver of Live2D and MMD only; Universal, MAGIC, and MMD Classic play
   * none. The decider is not involved.
   */
  gesture(kind: CueGestureKind, count: number, source: CueGestureStimulus['source'], turnId?: string) {
    const natural = this.options.driver() === 'natural'
    const stimulus: CueGestureStimulus = { kind: 'cue-gesture', gesture: kind, count, source, ...turnId !== undefined && { turnId } }
    for (const intent of this.options.mind.receive(stimulus)) {
      if (natural && intent.kind === 'gesture')
        this.options.scene()?.gesture?.(intent.gesture, intent.count)
    }
  }

  /** Sets the resting face of the mounted scene; the decider is not involved. */
  faceBaseline(baseline: FaceBaseline) {
    this.options.scene()?.setFaceBaseline?.(baseline)
  }

  /**
   * Sets the idle drive of the mounted scene. Only the Natural driver performs idle behaviour, so every other driver
   * receives `null`. The decider is not involved.
   */
  idleDrive(drive: NaturalIdleDrive | null) {
    this.options.scene()?.setIdleDrive?.(this.options.driver() === 'natural' ? drive : null)
    this.followIdleDriver()
  }

  /** Plays the body around a reach-out or widget line under the Natural driver; other drivers drop it. The mind decides it. */
  idleCue(kind: IdleCueKind) {
    if (this.options.driver() === 'natural')
      this.options.scene()?.idleCue?.(kind)
  }

  /**
   * Hands a detected beat to the scene's Natural beat clock under the Natural driver. Under another driver it is
   * dropped: there, upstream's beat sync hears every beat on its own.
   */
  beat(intervalSeconds: number) {
    if (this.options.driver() === 'natural')
      this.options.scene()?.beat?.(intervalSeconds)
  }

  /**
   * Asks the mind for one idle act by name under the Natural driver, for the devtools lab and scripted QA runs. The mind
   * answers with a requested `idle-act`, which the mind store sends to every stage; other drivers drop the request.
   */
  idlePlay(kind: IdleBehaviourKind) {
    if (this.options.driver() === 'natural')
      this.voice.receive({ kind: 'idle-play', act: kind })
  }

  /**
   * Performs one idle intent of the mind under the Natural driver. Under another driver it is dropped, and the mind
   * hears the dormant view, so it waits on no answer and decides nothing that no performer would show.
   */
  idle(intent: MindIdleIntent) {
    if (this.options.driver() !== 'natural') {
      this.followIdleDriver()
      return
    }
    this.options.scene()?.idle?.(idleOrderOf(intent))
  }

  /**
   * Answers the scene's cursor reports under the Natural driver: the mind steps once per report and draws the
   * episode, which goes back to this conductor's scene, because cursor geometry belongs to the stage that saw it.
   * Under another driver the reports are dropped and the mind draws nothing.
   */
  cursor(reports: readonly CursorReport[]) {
    if (this.options.driver() !== 'natural')
      return
    for (const report of reports) {
      for (const intent of this.options.mind.receive({ kind: 'cursor', report })) {
        if (intent.kind === 'cursor-episode')
          this.options.scene()?.cursorEpisode?.({ requestId: intent.requestId, episode: intent.episode })
      }
    }
  }

  /**
   * Tells the mind that the user dragged her and let go, under every driver, and sends its `attend` to `scene.attend`
   * only under Natural: the MMD body walks only under Natural, so the classic director gets no attend window (Body
   * ownership Target rule 1).
   */
  interaction(source: 'drag') {
    const natural = this.options.driver() === 'natural'
    for (const intent of this.options.mind.receive({ kind: 'interaction', source })) {
      if (intent.kind === 'attend' && natural)
        this.options.scene()?.attend?.(intent)
    }
  }

  /**
   * Tells the mind that the user sent a typed message of `words` words (`sent`), or that the chat unfolded (`unfold`),
   * under every driver. Its `chat-read` goes to `scene.chatRead` and its `attend` to `scene.attend`, both only under
   * Natural: no other driver reads the chat, and the classic director gets no attend window.
   */
  chat(cue: 'sent' | 'unfold', words = 0) {
    const natural = this.options.driver() === 'natural'
    const stimulus: ChatStimulus = cue === 'sent' ? { kind: 'chat', cue, words } : { kind: 'chat', cue }
    for (const intent of this.options.mind.receive(stimulus)) {
      if (!natural)
        continue
      if (intent.kind === 'chat-read')
        this.options.scene()?.chatRead?.(intent)
      else if (intent.kind === 'attend')
        this.options.scene()?.attend?.(intent)
    }
  }

  /** Hands the scene's idle reports to the mind under the Natural driver; under another one the mind hears the dormant view. */
  idleReport(reports: readonly IdleReport[]) {
    for (const report of reports) {
      if (report.kind === 'view')
        this.idleView = report.view
    }
    if (this.options.driver() !== 'natural') {
      this.followIdleDriver()
      return
    }
    this.idleDormant = false
    this.options.idleReports?.(reports)
  }

  /**
   * Tells the mind the dormant view once the driver left Natural, and the scene's latest view again once it is back:
   * a performer reports its view only when it changes, and a scene that stopped advancing Natural reports nothing.
   */
  private followIdleDriver() {
    const natural = this.options.driver() === 'natural'
    if (!natural && !this.idleDormant) {
      this.idleDormant = true
      this.options.idleReports?.([{ kind: 'view', view: dormantIdleView() }])
    }
    else if (natural && this.idleDormant) {
      this.idleDormant = false
      if (this.idleView)
        this.options.idleReports?.([{ kind: 'view', view: this.idleView }])
    }
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
   * decider state and the effective context of the active card. Every later decider signal is appended
   * in order, with the episode the mind decided, so a replay needs no mind. A context entry precedes
   * the first signal whose effective context differs from the last recorded one, so replay applies
   * settings, catalog, and profile changes exactly where the live decider saw them. A recording keeps at most {@link maxAffectTraceEntries} entries; the
   * next entry marks it truncated and stops it. A decider switch also marks it truncated, because
   * the switch resets the decider state.
   */
  startRecording() {
    const context = JSON.stringify(this.effectiveContext(undefined).context)
    this.recording = {
      context,
      trace: {
        version: 2,
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
    this.dispatchSlots(this.decide({ kind: 'muted', muted, at }).slots, at)
  }

  private speech(event: SpeechEvent, turnId: string, clipId?: string) {
    const at = this.clock()
    const decision = this.decide({ kind: 'speech', event, turnId, clipId, at })
    this.options.scene()?.onSpeech(event, turnId, at)
    this.dispatchSlots(decision.slots, at)
  }

  private timing(kind: TimingEvent['kind'], turnId: string) {
    const at = this.clock()
    const event: TimingEvent = { id: `timing-${++this.timingSeq}`, kind, turnId, at }
    this.dispatchSlots(this.decide({ kind: 'timing', event, at }).slots, at)
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
    this.dispatchSlots(this.decide({ kind: 'deadline', at }).slots, at)
  }

  /**
   * The episode with the mood dose gain of its band under the context it was decided in, or 0 for a moodless turn.
   * Natural doses it under the character that produced it even when a later decision uses another profile.
   */
  private dosed(episode: ReactionEpisode, context: DeciderContext, turnId: string | undefined): NaturalEpisode {
    const moodless = turnId !== undefined && this.moodlessTurns.has(turnId)
    return { ...episode, moodGain: moodless ? 0 : context.settings.moodDynamics[`${episode.band}Gain`] }
  }

  /** Dispatches the response to one touch in the mind's order: body, mood, moment, line, attend. */
  private performTouch(intents: readonly MindIntent[]) {
    const scene = this.options.scene()
    for (const intent of intents) {
      if (intent.kind === 'touch-reaction')
        scene?.reactToTouch?.(intent)
      else if (intent.kind === 'mood')
        scene?.addMood?.(intent.dose)
      else if (intent.kind === 'moment')
        this.options.markMoment?.(intent.moment)
      else if (intent.kind === 'speak')
        void this.voice.speak(intent)
      else if (intent.kind === 'attend')
        scene?.attend?.(intent)
    }
  }

  /** Natural only: the episode first, so a hold never precedes the episode it accompanies. */
  private dispatchNatural(episode: NaturalEpisode | null, hold: HoldCommand | null, at: number) {
    if (this.options.driver() !== 'natural')
      return
    const scene = this.options.scene()
    if (episode)
      scene?.setEmotion(episode)
    if (hold) {
      // Like dispatchSlots: a scene that mounted after the last mute change has not heard it, and its
      // performer would keep an unstarted speech hold for the full unstarted expiry.
      scene?.setMuted(this.muted)
      scene?.applyHolds([hold], at)
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

  private decide(signal: AffectSignal, context = this.effectiveContext(turnOf(signal)).context): PerformanceDecision {
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
    return result.decision
  }

  private dispatchSlots(commands: SlotCommand[], at: number) {
    if (commands.length === 0)
      return
    const scene = this.options.scene()
    // The model, and with it the performer's muted flag, can mount after the last mute change.
    scene?.setMuted(this.muted)
    scene?.applySlots(commands, at)
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

/** A labeled clip of the active scene's library as the scene lists it; `kind` is the effective clip kind. */
export interface ListedAction {
  label: string
  kind: string
  exposed: boolean
}

const exposedActionKinds = ['gesture', 'action', 'dance'] as const satisfies readonly ExposedAction['kind'][]

/** The clips the LLM may name: exposed gestures, actions, and dances, labels and kinds only. */
export function toExposedActions(clips: readonly ListedAction[]): ExposedAction[] {
  return clips.flatMap(({ label, kind, exposed }) => {
    const exposedKind = exposed ? exposedActionKinds.find(value => value === kind) : undefined
    return exposedKind ? [{ label, kind: exposedKind }] : []
  })
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
 * and its idle drive to the scene; no reading sends the neutral baseline and a drive that follows only the hour.
 */
export function useStagePerformanceConductor(options: Pick<StagePerformanceConductorOptions, 'scene' | 'driver' | 'playMotion' | 'profile' | 'mind' | 'markMoment' | 'voice' | 'idleReports'> & {
  renderer: () => string | undefined
  expressionBackend: () => StageExpressionBackend | undefined
  /** The body tool port of the active scene; undefined when it has no body support (Live2D, classic MMD). */
  bodyPort?: () => BodyToolPort | undefined
  /** The action tool port of the active scene; undefined when it has no clip library (Live2D). Not stage-gated. */
  actionPort?: () => ActionToolPort | undefined
  /** The labeled clips of the active scene, exposed or not; read reactively. */
  listActions?: () => readonly ListedAction[]
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
  const catalogMirror = useStageExpressionCatalogStore()
  let publishedModelId = ''
  // Only the local renderer is watched. Receiving the mirrored snapshot in another window never republishes it.
  watch([() => expressions.modelId, () => expressions.catalog], ([modelId, catalog]) => {
    catalogMirror.publish(modelId, catalog)
    publishedModelId = modelId
  }, { immediate: true, deep: true })
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
  const exposedActions = computed(() => toExposedActions(options.listActions?.() ?? []))
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
  function sendIdleDrive() {
    const now = new Date()
    conductor.idleDrive({
      ...idleDriveOf(options.characterReading?.() ?? null, now.getTime(), now.getHours() + now.getMinutes() / 60),
      // The scene narrows this, and the user's setting turns the drive off.
      rate: 1,
    })
  }
  useIntervalFn(sendIdleDrive, FACE_BASELINE_SAMPLE_MS)
  sendIdleDrive()

  watch([exposed, exposedActions, active, mood], () => {
    runtimeState.publish({ exposed: exposed.value, exposedActions: exposedActions.value, active: active.value, mood: mood.value })
  }, { immediate: true })

  const registration = createExpressionToolRegistration(useLlmToolsStore(), createExpressionToolPort(conductor, expressions))
  watch(() => JSON.stringify(exposed.value), () => {
    registration.sync(exposed.value).catch(error => console.error('[performance-conductor] Expression tools failed to register:', errorMessageFrom(error)))
  }, { immediate: true })
  const bodyRegistration = createBodyToolRegistration(useLlmToolsStore())
  watch(() => options.bodyPort?.(), (port) => {
    bodyRegistration.sync(port).catch(error => console.error('[performance-conductor] Body tools failed to register:', errorMessageFrom(error)))
  }, { immediate: true })
  // The tool enum names actions and dances only; the key changes whenever that set does.
  const toolActionsKey = computed(() => JSON.stringify(exposedActions.value.filter((entry): entry is ExposedToolAction => entry.kind !== 'gesture')))
  const actionRegistration = createActionToolRegistration(useLlmToolsStore())
  watch([() => options.actionPort?.(), toolActionsKey], ([port, key]) => {
    actionRegistration.sync(port, key).catch(error => console.error('[performance-conductor] Action tools failed to register:', errorMessageFrom(error)))
  }, { immediate: true })
  const diagnostics = useNaturalMotionDiagnostics()
  watch(() => diagnostics.affectTraceRequest, (request) => {
    if (request && options.renderer() === 'live2d')
      answerAffectTraceRequest(conductor, diagnostics, request)
  })

  onScopeDispose(() => {
    catalogMirror.clear(publishedModelId)
    registration.dispose()
    bodyRegistration.dispose()
    actionRegistration.dispose()
    conductor.dispose()
  })

  return { conductor, settings }
}
