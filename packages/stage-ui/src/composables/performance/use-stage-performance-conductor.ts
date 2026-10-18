import type { AffectSignal, CatalogEntry, ExpressionPerformanceSettings, PerformanceDecision, ReactionEpisode, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DMotionDriver } from '@proj-airi/stage-ui-live2d'

import { createDecider, isLlmEligible } from '@proj-airi/stage-shared/expression-performance'
import { useExpressionStore } from '@proj-airi/stage-ui-live2d/stores/expression-store'
import { computed } from 'vue'

import { EMOTION_EmotionMotionName_value, EMOTION_VALUES } from '../../constants/emotions'
import { useExpressionPerformanceSettings } from '../../features/performance/settings'

type SpeechEvent = Extract<AffectSignal, { kind: 'speech' }>['event']
type Decider = ReturnType<typeof createDecider>
type DeciderState = ReturnType<Decider['initial']>

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

  /** Only confirmed, LLM-exposed catalog entries are accepted; names are resolved by the caller. */
  expression(expressionId: string, holdSeconds: number | undefined, source: 'act' | 'tool', turnId?: string) {
    if (!this.options.catalog().some(entry => entry.id === expressionId && isLlmEligible(entry))) {
      console.warn('[performance-conductor] Expression is not exposed and was dropped:', expressionId)
      return
    }
    if (holdSeconds !== undefined && (!Number.isFinite(holdSeconds) || holdSeconds <= 0)) {
      console.warn('[performance-conductor] Expression hold must be a positive number:', holdSeconds)
      return
    }
    const at = this.clock()
    this.dispatchSlots(this.decide({ kind: 'expression', source, expressionId, holdSeconds, turnId, at }), at)
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

/**
 * Creates the stage window's conductor. Creating the performance settings store here also makes
 * the stage window, the synchronization leader in Electron, the owner of its leader-routed
 * actions, so switches changed in the settings window take effect.
 */
export function useStagePerformanceConductor(options: Pick<StagePerformanceConductorOptions, 'scene' | 'driver' | 'playMotion'>) {
  const performanceSettings = useExpressionPerformanceSettings()
  const expressions = useExpressionStore()
  // Character profiles are applied here in a later step; until then the document is effective as is.
  const settings = computed(() => performanceSettings.document)
  const conductor = new StagePerformanceConductor({
    ...options,
    settings: () => settings.value,
    catalog: () => expressions.catalog,
    seed: crypto.getRandomValues(new Uint32Array(1))[0],
  })
  return { conductor, settings }
}
