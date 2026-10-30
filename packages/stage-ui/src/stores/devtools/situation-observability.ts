import type {
  Reason,
  ReasonCategory,
  ReasonKind,
  RenderedSituation,
  RitualDay,
  SituationState,
  Thread,
  ThreadKind,
  UrgeGateDecision,
  UrgeGateMemory,
  UrgeGatePhase,
  UrgeGateTrace,
} from '@proj-airi/stage-shared/situation'
import type { Message } from '@xsai/shared-chat'

import type { ChatUnpromptedResult } from '../chat'

import { defineInvoke, defineInvokeEventa, defineInvokeHandler } from '@moeru/eventa'
import { advanceSituation, initialSituationState, renderSituation } from '@proj-airi/stage-shared/situation'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'

import { DEVTOOLS_INSPECT_TIMEOUT_MS, getDevtoolsBusContext } from '../../services/devtools/bus'
import { actComplianceInspectInvoke, useActComplianceStore } from './act-compliance'
import { useContextObservabilityStore } from './context-observability'

/** Length cap of the render history: older renders are dropped first. */
export const SITUATION_RENDER_HISTORY_MAX = 100

/**
 * Length cap of the urge decision history and the urge history, counted in entries after collapsing.
 *
 * Tuning: a chat-active hour changes the hold reason every few seconds, so both histories reach their cap. 100 entries
 * each keep a full inspection under 60 KB; raise it only with the size test in `situation-observability.test.ts`.
 */
export const SITUATION_URGE_HISTORY_MAX = 100

/** Length cap of the thread extraction ledger: older entries are dropped first. */
export const SITUATION_EXTRACTION_LEDGER_MAX = 20

/**
 * A user turn this soon after a spoken unprompted turn counts that turn as engaged; a turn that waits longer, or no
 * turn at all, counts it as ignored.
 *
 * Tuning: long enough for a reply typed between other work, short enough that a later unrelated message does not
 * credit her opening.
 */
export const SITUATION_ENGAGEMENT_WINDOW_MS = 10 * 60_000

/** One situation block that was sent with a chat request. */
export interface SituationRenderRecord {
  id: string
  /** The `nowMs` the block was rendered at. */
  nowMs: number
  text: string
  /** Ids of the events the render marked as shown. */
  shownEventIds: string[]
}

/** The situation as seen by the window that answered an inspection. */
export interface SituationLiveState {
  /** Whether that window folds observations. Only the leader does; a host that never initialized the store does not. */
  leading: boolean
  state: SituationState
}

/** Unprompted turns of one chat session since this window started, by outcome. */
export interface SituationSessionSpend {
  sessionId: string
  spoken: number
  declined: number
}

/** Size of the newest provider request of an unprompted turn. */
export interface SituationUnpromptedRequest {
  sessionId: string
  turnId: string
  capturedAtMs: number
  messageCount: number
  /** Characters of message text: string contents plus text parts. Images, audio, and tool calls are not counted. */
  chars: number
}

export interface SituationSpend {
  sessions: SituationSessionSpend[]
  /** `null` until an unprompted turn sent a provider request. */
  lastUnpromptedRequest: SituationUnpromptedRequest | null
}

/** The newest urge gate decision, reduced to what the inspector lists. */
export interface SituationUrgeDecisionRecord {
  fire: boolean
  /** The fire reason of a fire, the hold reason of a hold. */
  reason: UrgeGateDecision['reason']
  /** The category of the picked reason; `null` for holds. */
  category: ReasonCategory | null
  /** The topic a fire started; `null` for holds. */
  topicKey: string | null
  atMs: number
}

/**
 * A run of consecutive urge gate decisions with the same outcome. Decisions collapse while `fire`, `reason`,
 * `category`, and `topicKey` stay equal.
 */
export interface SituationUrgeDecisionHistoryEntry {
  /** `nowMs` of the first and the newest decision of the run. */
  fromMs: number
  toMs: number
  count: number
  fire: boolean
  reason: UrgeGateDecision['reason']
  category: ReasonCategory | null
  topicKey: string | null
}

/**
 * A run of consecutive urge gate evaluations in the same phase with the same total hazard, rounded to 3 decimals.
 * It shows how her urge to reach out rose and fell over the last evaluations.
 */
export interface SituationUrgeHistoryEntry {
  fromMs: number
  toMs: number
  phase: UrgeGatePhase
  /** Total hazard per hour, rounded to 3 decimals. */
  hazardTotal: number
}

export interface SituationUrgeInspection {
  /** The complete trace of the newest evaluation; `null` until the gate evaluated once. */
  trace: UrgeGateTrace | null
  decision: SituationUrgeDecisionRecord | null
  /** Newest first, at most {@link SITUATION_URGE_HISTORY_MAX} entries. */
  history: SituationUrgeDecisionHistoryEntry[]
  /** The gate memory now, published after every change; `null` until the gate published once. */
  memory: UrgeGateMemory | null
}

/** One thread extraction attempt at the end of an exchange. */
export interface ThreadExtractionLedgerEntry {
  atMs: number
  sessionId: string
  /** Characters of conversation text sent to the model. */
  requestChars: number
  messageCount: number
  /**
   * `ok` stored at least one thread, `empty` found none, `invalid` got output that failed validation, `failed` got no
   * answer, `skipped` did not run because another extraction was in flight.
   */
  status: 'ok' | 'empty' | 'invalid' | 'failed' | 'skipped'
  threads: readonly { kind: ThreadKind, summary: string }[]
  error: string | null
}

export interface SituationExtraction {
  /** Newest first, at most {@link SITUATION_EXTRACTION_LEDGER_MAX} entries. */
  ledger: ThreadExtractionLedgerEntry[]
  inFlight: boolean
}

/** Outcomes of the gate's unprompted turns for one reason kind since this window started. */
export interface SituationReasonOutcome {
  spoken: number
  declined: number
  cancelled: number
  failed: number
  /** Spoken turns followed by a user turn within {@link SITUATION_ENGAGEMENT_WINDOW_MS}. */
  engaged: number
  /** Spoken turns without a user turn within {@link SITUATION_ENGAGEMENT_WINDOW_MS}. */
  ignored: number
}

export type SituationReasonOutcomes = Readonly<Record<ReasonKind, SituationReasonOutcome>>

export interface SituationInspection extends SituationLiveState {
  /** Clock of the answering window when it built the inspection. */
  nowMs: number
  /** Newest first, at most {@link SITUATION_RENDER_HISTORY_MAX}. */
  renders: SituationRenderRecord[]
  spend: SituationSpend
  urge: SituationUrgeInspection
  /** Newest first, at most {@link SITUATION_URGE_HISTORY_MAX} entries. */
  urgeHistory: SituationUrgeHistoryEntry[]
  /** The reasons of the newest evaluation. */
  reasons: readonly Reason[]
  /** The open threads of every chat session, as the gate holds them now. */
  threads: readonly Thread[]
  /** The ritual day of the newest evaluation. */
  rituals: RitualDay | null
  extraction: SituationExtraction
  outcomes: SituationReasonOutcomes
}

export interface SituationPreview extends RenderedSituation {
  leading: boolean
  nowMs: number
}

/**
 * Result of one "Evaluate now". `skipped` means nothing was evaluated: `unprompted-pending` while an unprompted turn
 * has no result yet, `gate-not-running` when the answering window runs no gate (no unprompted capability).
 */
export type SituationGateEvaluation
  = | { status: 'evaluated', decision: UrgeGateDecision, memory: UrgeGateMemory }
    | { status: 'skipped', reason: 'unprompted-pending' | 'gate-not-running' }

/** Runs one gate evaluation that skips the timing guards. It takes no options, so no caller can relax anything else. */
export type SituationGateEvaluator = () => SituationGateEvaluation

/** The leader window answers it with {@link SituationInspection} of its situation. */
export const situationInspectInvoke = defineInvokeEventa<SituationInspection>('eventa:devtools:situation:inspect')
/** The leader window answers it with the block its next request would carry at `nowMs`, without marking anything shown. */
export const situationPreviewInvoke = defineInvokeEventa<SituationPreview, { nowMs: number }>('eventa:devtools:situation:preview')
/**
 * The leader window evaluates its gate once with `forceTiming` and answers with the result. A fire starts its
 * unprompted turn like a timed one. The request carries no payload: hard suppressors always apply.
 */
export const situationGateEvaluateInvoke = defineInvokeEventa<SituationGateEvaluation>('eventa:devtools:situation:gate-evaluate')

const NO_OUTCOME: SituationReasonOutcome = Object.freeze({ spoken: 0, declined: 0, cancelled: 0, failed: 0, engaged: 0, ignored: 0 })

/** Every reason kind with zero outcomes. The record type makes the compiler check that no kind is missing. */
const NO_OUTCOMES: SituationReasonOutcomes = Object.freeze({
  'thread-question': NO_OUTCOME,
  'thread-event': NO_OUTCOME,
  'thread-later': NO_OUTCOME,
  'thread-topic': NO_OUTCOME,
  'ritual-greeting': NO_OUTCOME,
  'ritual-sign-off': NO_OUTCOME,
  'ritual-welcome-back': NO_OUTCOME,
  'own-day': NO_OUTCOME,
  'continuation': NO_OUTCOME,
  'double-text': NO_OUTCOME,
  'long-session': NO_OUTCOME,
  'returned': NO_OUTCOME,
  'notify': NO_OUTCOME,
})

const NO_REASONS: readonly Reason[] = Object.freeze([])
const NO_THREADS: readonly Thread[] = Object.freeze([])

function messageTextLength(message: Message): number {
  const content: unknown = message.content
  if (typeof content === 'string')
    return content.length
  if (!Array.isArray(content))
    return 0
  let length = 0
  for (const part of content) {
    if (typeof part === 'object' && part !== null && part.type === 'text' && typeof part.text === 'string')
      length += part.text.length
  }
  return length
}

/**
 * Collects what the devtools Situation inspector shows: the live situation, the blocks sent with chat requests, the
 * gate decisions and memory, and what unprompted turns cost.
 *
 * The situation store of each window publishes into its local copy of this store. Only the leader folds
 * observations, so a follower window (the Electron settings window, for example) reads the leader's copy through
 * {@link inspectLeader} and {@link previewLeader}. While this window leads, it answers them over the devtools
 * inspector bus, an Eventa BroadcastChannel context, together with the ACT compliance history of the same page.
 * The same bus carries "Evaluate now" ({@link evaluateGateLeader}) to the gate that the situation store serves.
 * The store is not synced: synced actions would keep every polled result in the shared domain state until their
 * call timeout, and the inspector polls every second.
 */
export const useSituationObservabilityStore = defineStore('devtools:situation-observability', () => {
  const live = shallowRef<SituationLiveState>({ leading: false, state: initialSituationState })
  const renders = shallowRef<readonly SituationRenderRecord[]>([])
  const sessionSpend = shallowRef<ReadonlyMap<string, SituationSessionSpend>>(new Map())
  const lastUnpromptedRequest = shallowRef<SituationUnpromptedRequest | null>(null)
  const urgeTrace = shallowRef<UrgeGateTrace | null>(null)
  const urgeDecision = shallowRef<SituationUrgeDecisionRecord | null>(null)
  const urgeDecisionHistory = shallowRef<readonly SituationUrgeDecisionHistoryEntry[]>([])
  const urgeMemory = shallowRef<UrgeGateMemory | null>(null)
  const urgeHistory = shallowRef<readonly SituationUrgeHistoryEntry[]>([])
  const threads = shallowRef<readonly Thread[]>(NO_THREADS)
  const extractionLedger = shallowRef<readonly ThreadExtractionLedgerEntry[]>([])
  const extractionInFlight = shallowRef(false)
  const outcomes = shallowRef<SituationReasonOutcomes>(NO_OUTCOMES)
  /** Spoken turns whose engagement is not settled yet, oldest first. */
  let awaitingEngagement: readonly { kind: ReasonKind, spokenAtMs: number }[] = []
  const actCompliance = useActComplianceStore()
  const contextObservability = useContextObservabilityStore()
  let stopServing: (() => void) | undefined
  let gateEvaluator: SituationGateEvaluator | undefined

  // A user request replaces the context store's projection, so the newest unprompted request is kept here.
  watch(() => contextObservability.lastPromptProjection, (projection) => {
    if (projection?.origin !== 'unprompted' || !projection.turnId || !projection.composedMessage)
      return
    lastUnpromptedRequest.value = {
      sessionId: projection.sessionId,
      turnId: projection.turnId,
      capturedAtMs: projection.capturedAt,
      messageCount: projection.composedMessage.length,
      chars: projection.composedMessage.reduce((total, message) => total + messageTextLength(message), 0),
    }
  }, { flush: 'sync' })

  /** Answers the inspector bus from this window. Only the leader serves, so a follower's empty copy never answers. */
  function serve() {
    const context = getDevtoolsBusContext()
    const stops = [
      defineInvokeHandler(context, situationInspectInvoke, () => inspect()),
      defineInvokeHandler(context, situationPreviewInvoke, ({ nowMs }) => preview(nowMs)),
      defineInvokeHandler(context, actComplianceInspectInvoke, () => actCompliance.inspect()),
      defineInvokeHandler(context, situationGateEvaluateInvoke, () => evaluateGate()),
    ]
    return () => stops.forEach(stop => stop())
  }

  /** Records a block that `renderForRequest` sent, before its events are marked shown. */
  function recordRender(nowMs: number, rendered: RenderedSituation) {
    const record: SituationRenderRecord = {
      id: nanoid(),
      nowMs,
      text: rendered.text,
      shownEventIds: [...rendered.shownEventIds],
    }
    renders.value = [record, ...renders.value].slice(0, SITUATION_RENDER_HISTORY_MAX)
  }

  /** Called by the situation store of this window after every urge gate evaluation, with the memory it left. */
  function recordUrgeDecision(decision: UrgeGateDecision, memory: UrgeGateMemory) {
    const { trace } = decision
    const atMs = trace.nowMs
    settleEngagement(atMs)
    urgeTrace.value = trace
    urgeMemory.value = memory

    const category = decision.fire ? decision.category : null
    const topicKey = decision.fire ? decision.topicKey : null
    urgeDecision.value = { fire: decision.fire, reason: decision.reason, category, topicKey, atMs }
    const [newestDecision, ...olderDecisions] = urgeDecisionHistory.value
    if (newestDecision && newestDecision.fire === decision.fire && newestDecision.reason === decision.reason && newestDecision.category === category && newestDecision.topicKey === topicKey) {
      urgeDecisionHistory.value = [{ ...newestDecision, toMs: atMs, count: newestDecision.count + 1 }, ...olderDecisions]
    }
    else {
      const entry: SituationUrgeDecisionHistoryEntry = { fromMs: atMs, toMs: atMs, count: 1, fire: decision.fire, reason: decision.reason, category, topicKey }
      urgeDecisionHistory.value = [entry, ...urgeDecisionHistory.value].slice(0, SITUATION_URGE_HISTORY_MAX)
    }

    const hazardTotal = Math.round(trace.hazardPerHour.total * 1_000) / 1_000
    const [newestUrge, ...olderUrge] = urgeHistory.value
    if (newestUrge && newestUrge.phase === trace.phase && newestUrge.hazardTotal === hazardTotal) {
      urgeHistory.value = [{ ...newestUrge, toMs: atMs }, ...olderUrge]
    }
    else {
      const entry: SituationUrgeHistoryEntry = { fromMs: atMs, toMs: atMs, phase: trace.phase, hazardTotal }
      urgeHistory.value = [entry, ...urgeHistory.value].slice(0, SITUATION_URGE_HISTORY_MAX)
    }
  }

  /** Called by the situation store of this window whenever its urge gate memory or its open threads change. */
  function publishUrgeState(memory: UrgeGateMemory, openThreads: readonly Thread[]) {
    urgeMemory.value = memory
    threads.value = openThreads
  }

  function countOutcome(kind: ReasonKind, field: keyof SituationReasonOutcome) {
    const current = outcomes.value[kind]
    outcomes.value = { ...outcomes.value, [kind]: { ...current, [field]: current[field] + 1 } }
  }

  /** Counts every awaited spoken turn older than the engagement window at `nowMs` as ignored. */
  function settleEngagement(nowMs: number) {
    const expired = awaitingEngagement.filter(spoken => nowMs - spoken.spokenAtMs > SITUATION_ENGAGEMENT_WINDOW_MS)
    if (expired.length === 0)
      return
    awaitingEngagement = awaitingEngagement.filter(spoken => !expired.includes(spoken))
    for (const spoken of expired)
      countOutcome(spoken.kind, 'ignored')
  }

  /**
   * Called by the situation store of this window when a gate-fired unprompted turn has its outcome, with the kind of
   * the reason it was about. A spoken turn waits for its engagement: the next user turn settles it, or the first
   * evaluation after {@link SITUATION_ENGAGEMENT_WINDOW_MS} counts it as ignored.
   */
  function recordReasonOutcome(kind: ReasonKind, outcome: ChatUnpromptedResult['status'], atMs: number) {
    settleEngagement(atMs)
    countOutcome(kind, outcome)
    if (outcome === 'spoken')
      awaitingEngagement = [...awaitingEngagement, { kind, spokenAtMs: atMs }]
  }

  /** Called by the situation store of this window for every user-origin turn. Settles every awaited spoken turn. */
  function recordUserTurn(atMs: number) {
    const awaited = awaitingEngagement
    awaitingEngagement = []
    for (const spoken of awaited)
      countOutcome(spoken.kind, atMs - spoken.spokenAtMs <= SITUATION_ENGAGEMENT_WINDOW_MS ? 'engaged' : 'ignored')
  }

  /** Called by the thread extractor of this window after every extraction attempt, `skipped` included. */
  function recordExtraction(entry: ThreadExtractionLedgerEntry) {
    extractionLedger.value = [entry, ...extractionLedger.value].slice(0, SITUATION_EXTRACTION_LEDGER_MAX)
  }

  /** Called by the thread extractor of this window when an extraction starts and when it settles. */
  function publishExtractionInFlight(inFlight: boolean) {
    extractionInFlight.value = inFlight
  }

  /** Called by the chat store of this window when an unprompted turn has its result. Counts spoken and declined. */
  function recordUnpromptedOutcome(sessionId: string, status: ChatUnpromptedResult['status']) {
    if (status !== 'spoken' && status !== 'declined')
      return
    const current = sessionSpend.value.get(sessionId) ?? { sessionId, spoken: 0, declined: 0 }
    const next = new Map(sessionSpend.value)
    next.set(sessionId, { ...current, [status]: current[status] + 1 })
    sessionSpend.value = next
  }

  /**
   * Lets the situation store of this window answer "Evaluate now" while its gate runs. Returns the function that
   * withdraws the evaluator; it withdraws only an evaluator that is still registered.
   */
  function serveGateEvaluation(evaluate: SituationGateEvaluator) {
    gateEvaluator = evaluate
    return () => {
      if (gateEvaluator === evaluate)
        gateEvaluator = undefined
    }
  }

  /** Evaluates the gate of this window once, skipping the timing guards. */
  async function evaluateGate(): Promise<SituationGateEvaluation> {
    return gateEvaluator?.() ?? { status: 'skipped', reason: 'gate-not-running' }
  }

  /** Called by the situation store of this window whenever its state or leadership changes. */
  function publishLiveState(leading: boolean, state: SituationState) {
    live.value = { leading, state }
    if (leading) {
      stopServing ??= serve()
    }
    else {
      stopServing?.()
      stopServing = undefined
    }
  }

  /** Returns the live situation, the render and gate history, and the spend of this window. */
  async function inspect(): Promise<SituationInspection> {
    return {
      leading: live.value.leading,
      state: live.value.state,
      nowMs: Date.now(),
      renders: [...renders.value],
      spend: { sessions: [...sessionSpend.value.values()], lastUnpromptedRequest: lastUnpromptedRequest.value },
      urge: { trace: urgeTrace.value, decision: urgeDecision.value, history: [...urgeDecisionHistory.value], memory: urgeMemory.value },
      urgeHistory: [...urgeHistory.value],
      reasons: urgeTrace.value?.reasons ?? NO_REASONS,
      threads: threads.value,
      rituals: urgeTrace.value?.rituals ?? null,
      extraction: { ledger: [...extractionLedger.value], inFlight: extractionInFlight.value },
      outcomes: outcomes.value,
    }
  }

  /**
   * Renders the block the next request would carry at `nowMs`, without marking any event as shown.
   * `shownEventIds` lists the events a real request would mark.
   */
  async function preview(nowMs: number): Promise<SituationPreview> {
    const { leading, state } = live.value
    const rendered = renderSituation(advanceSituation(state, nowMs), nowMs)
    return { leading, nowMs, text: rendered.text, shownEventIds: [...rendered.shownEventIds] }
  }

  /** Returns {@link inspect} of the leader window. Rejects when no window answers in time. */
  async function inspectLeader(): Promise<SituationInspection> {
    return defineInvoke(getDevtoolsBusContext(), situationInspectInvoke)(undefined, { signal: AbortSignal.timeout(DEVTOOLS_INSPECT_TIMEOUT_MS) })
  }

  /** Returns {@link preview} of the leader window. Rejects when no window answers in time. */
  async function previewLeader(nowMs: number): Promise<SituationPreview> {
    return defineInvoke(getDevtoolsBusContext(), situationPreviewInvoke)({ nowMs }, { signal: AbortSignal.timeout(DEVTOOLS_INSPECT_TIMEOUT_MS) })
  }

  /** Asks the leader window for {@link evaluateGate}. Rejects when no window answers in time. */
  async function evaluateGateLeader(): Promise<SituationGateEvaluation> {
    return defineInvoke(getDevtoolsBusContext(), situationGateEvaluateInvoke)(undefined, { signal: AbortSignal.timeout(DEVTOOLS_INSPECT_TIMEOUT_MS) })
  }

  return {
    liveState: computed(() => live.value),
    renders: computed(() => renders.value),
    recordRender,
    recordUrgeDecision,
    publishUrgeState,
    recordReasonOutcome,
    recordUserTurn,
    recordExtraction,
    publishExtractionInFlight,
    recordUnpromptedOutcome,
    serveGateEvaluation,
    evaluateGate,
    publishLiveState,
    inspect,
    preview,
    inspectLeader,
    previewLeader,
    evaluateGateLeader,
  }
})

/** Lines and characters a block uses, counted the way `renderSituation` checks its budget. */
export function situationBlockUsage(text: string): { lines: number, chars: number } {
  return { lines: text === '' ? 0 : text.split('\n').length, chars: text.length }
}
