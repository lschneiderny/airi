import type { GateDecision, GateMemory, RenderedSituation, SituationState } from '@proj-airi/stage-shared/situation'
import type { Message } from '@xsai/shared-chat'

import type { ChatUnpromptedResult } from '../chat'

import { defineInvoke, defineInvokeEventa, defineInvokeHandler } from '@moeru/eventa'
import { advanceSituation, initialGateMemory, initialSituationState, renderSituation } from '@proj-airi/stage-shared/situation'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'

import { DEVTOOLS_INSPECT_TIMEOUT_MS, getDevtoolsBusContext } from '../../services/devtools/bus'
import { actComplianceInspectInvoke, useActComplianceStore } from './act-compliance'
import { useContextObservabilityStore } from './context-observability'

/** Length cap of the render history: older renders are dropped first. */
export const SITUATION_RENDER_HISTORY_MAX = 100

/** Length cap of the gate history, counted in entries after collapsing: older entries are dropped first. */
export const SITUATION_GATE_HISTORY_MAX = 200

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

/** The newest decision of the leader's opportunity gate and the memory it left. */
export interface SituationGateRecord {
  decision: GateDecision
  memory: GateMemory
}

/**
 * A run of consecutive gate decisions with the same outcome. Decisions collapse while `fire`, `reason`, `topicKey`
 * and `forced` stay equal, so a gate that holds for an hour with one reason takes one entry.
 */
export interface SituationGateHistoryEntry {
  id: string
  fire: boolean
  reason: GateDecision['reason']
  /** The topic a fire started; `null` for holds. */
  topicKey: string | null
  /** Whether "Evaluate now" asked for the decision, which skips the timing guards only. */
  forced: boolean
  /** `nowMs` of the first and the newest decision of the run. */
  firstAtMs: number
  lastAtMs: number
  count: number
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

export interface SituationInspection extends SituationLiveState {
  /** Clock of the answering window when it built the inspection. */
  nowMs: number
  /** Newest first, at most {@link SITUATION_RENDER_HISTORY_MAX}. */
  renders: SituationRenderRecord[]
  /** `null` until the gate of the answering window evaluated once. */
  gate: SituationGateRecord | null
  /** Newest first, at most {@link SITUATION_GATE_HISTORY_MAX} entries. */
  gateHistory: SituationGateHistoryEntry[]
  /**
   * The gate memory now. It differs from `gate.memory` when a turn outcome or a user turn changed it after the
   * newest decision, for example while an unprompted turn is pending and the gate does not evaluate.
   */
  gateMemory: GateMemory
  spend: SituationSpend
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
  = | { status: 'evaluated', decision: GateDecision, memory: GateMemory }
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
  const gate = shallowRef<SituationGateRecord | null>(null)
  const gateHistory = shallowRef<readonly SituationGateHistoryEntry[]>([])
  const gateMemory = shallowRef<GateMemory>(initialGateMemory)
  const sessionSpend = shallowRef<ReadonlyMap<string, SituationSessionSpend>>(new Map())
  const lastUnpromptedRequest = shallowRef<SituationUnpromptedRequest | null>(null)
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

  /** Called by the situation store of this window after every gate evaluation, with the memory it left. */
  function recordGateDecision(decision: GateDecision, memory: GateMemory) {
    gate.value = { decision, memory }
    gateMemory.value = memory

    const atMs = decision.trace.nowMs
    const topicKey = decision.fire ? decision.topicKey : null
    const forced = decision.trace.forceTiming
    const [newest, ...older] = gateHistory.value
    if (newest && newest.fire === decision.fire && newest.reason === decision.reason && newest.topicKey === topicKey && newest.forced === forced) {
      gateHistory.value = [{ ...newest, lastAtMs: atMs, count: newest.count + 1 }, ...older]
      return
    }
    const entry: SituationGateHistoryEntry = { id: nanoid(), fire: decision.fire, reason: decision.reason, topicKey, forced, firstAtMs: atMs, lastAtMs: atMs, count: 1 }
    gateHistory.value = [entry, ...gateHistory.value].slice(0, SITUATION_GATE_HISTORY_MAX)
  }

  /** Called by the situation store of this window whenever its gate memory changes outside a decision. */
  function publishGateMemory(memory: GateMemory) {
    gateMemory.value = memory
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
      gate: gate.value,
      gateHistory: [...gateHistory.value],
      gateMemory: gateMemory.value,
      spend: { sessions: [...sessionSpend.value.values()], lastUnpromptedRequest: lastUnpromptedRequest.value },
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
    gate: computed(() => gate.value),
    gateHistory: computed(() => gateHistory.value),
    gateMemory: computed(() => gateMemory.value),
    recordRender,
    recordGateDecision,
    publishGateMemory,
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
