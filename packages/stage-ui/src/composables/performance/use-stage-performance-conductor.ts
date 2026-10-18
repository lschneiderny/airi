import type { AffectSignal, CatalogEntry, ExpressionPerformanceSettings, PerformanceDecision, ReactionEpisode, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DMotionDriver } from '@proj-airi/stage-ui-live2d'

import type { ActiveExpression, ExposedExpression, PerformanceMoodSnapshot } from '../../features/performance/runtime-state'
import type { ExecutableTool } from '../../stores/ai/chat-llm/tools'
import type { ExpressionToolPort } from '../../tools/expression'

import { errorMessageFrom } from '@moeru/std'
import { createDecider, isLlmEligible } from '@proj-airi/stage-shared/expression-performance'
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
   * Timer functions for decider deadlines. Tests inject fakes; the timing scheduler consumes them.
   *
   * @default { setTimeout, clearTimeout }
   */
  timers?: {
    setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
  }
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
 */
export class StagePerformanceConductor {
  readonly seed: number
  private decider: Decider
  private deciderKind: ExpressionPerformanceSettings['decider']
  private state: DeciderState
  private activeTurnIds: readonly string[] = []
  private muted = false
  private readonly clock: () => number

  constructor(private readonly options: StagePerformanceConductorOptions) {
    this.seed = options.seed
    this.deciderKind = options.settings().decider
    this.decider = createDecider(this.deciderKind)
    this.state = this.decider.initial(this.seed)
    this.clock = options.clock ?? (() => performance.now() / 1000)
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

  clipStart(turnId: string, clipId: string) {
    this.speech('clip-start', turnId, clipId)
  }

  /** A stopped or failed clip ends its turn's speech leases at once; an ended clip extends them. */
  clipEnd(turnId: string, clipId: string, status: 'ended' | 'stopped' | 'failed') {
    this.speech(status === 'ended' ? 'clip-end' : 'clip-stopped', turnId, clipId)
  }

  turnEnd(turnId: string) {
    this.speech('turn-end', turnId)
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
  onScopeDispose(() => registration.dispose())

  return { conductor, settings }
}
