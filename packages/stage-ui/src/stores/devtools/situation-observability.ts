import type { GateDecision, GateMemory, RenderedSituation, SituationState } from '@proj-airi/stage-shared/situation'

import { defineInvoke, defineInvokeEventa, defineInvokeHandler } from '@moeru/eventa'
import { advanceSituation, initialSituationState, renderSituation } from '@proj-airi/stage-shared/situation'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

import { DEVTOOLS_INSPECT_TIMEOUT_MS, getDevtoolsBusContext } from '../../services/devtools/bus'
import { actComplianceInspectInvoke, useActComplianceStore } from './act-compliance'

/** Length cap of the render history: older renders are dropped first. */
export const SITUATION_RENDER_HISTORY_MAX = 100

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

export interface SituationInspection extends SituationLiveState {
  /** Clock of the answering window when it built the inspection. */
  nowMs: number
  /** Newest first, at most {@link SITUATION_RENDER_HISTORY_MAX}. */
  renders: SituationRenderRecord[]
  /** `null` until the gate of the answering window evaluated once. */
  gate: SituationGateRecord | null
}

export interface SituationPreview extends RenderedSituation {
  leading: boolean
  nowMs: number
}

/** The leader window answers it with {@link SituationInspection} of its situation. */
export const situationInspectInvoke = defineInvokeEventa<SituationInspection>('eventa:devtools:situation:inspect')
/** The leader window answers it with the block its next request would carry at `nowMs`, without marking anything shown. */
export const situationPreviewInvoke = defineInvokeEventa<SituationPreview, { nowMs: number }>('eventa:devtools:situation:preview')

/**
 * Collects what the devtools Situation inspector shows: the live situation and the blocks sent with chat requests.
 *
 * The situation store of each window publishes into its local copy of this store. Only the leader folds
 * observations, so a follower window (the Electron settings window, for example) reads the leader's copy through
 * {@link inspectLeader} and {@link previewLeader}. While this window leads, it answers them over the devtools
 * inspector bus, an Eventa BroadcastChannel context, together with the ACT compliance history of the same page.
 * The store is not synced: synced actions would keep every polled result in the shared domain state until their
 * call timeout, and the inspector polls every second.
 */
export const useSituationObservabilityStore = defineStore('devtools:situation-observability', () => {
  const live = shallowRef<SituationLiveState>({ leading: false, state: initialSituationState })
  const renders = shallowRef<readonly SituationRenderRecord[]>([])
  const gate = shallowRef<SituationGateRecord | null>(null)
  const actCompliance = useActComplianceStore()
  let stopServing: (() => void) | undefined

  /** Answers the inspector bus from this window. Only the leader serves, so a follower's empty copy never answers. */
  function serve() {
    const context = getDevtoolsBusContext()
    const stops = [
      defineInvokeHandler(context, situationInspectInvoke, () => inspect()),
      defineInvokeHandler(context, situationPreviewInvoke, ({ nowMs }) => preview(nowMs)),
      defineInvokeHandler(context, actComplianceInspectInvoke, () => actCompliance.inspect()),
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

  /** Called by the situation store of this window after every gate evaluation. */
  function recordGateDecision(decision: GateDecision, memory: GateMemory) {
    gate.value = { decision, memory }
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

  /** Returns the live situation and the render history of this window. */
  async function inspect(): Promise<SituationInspection> {
    return {
      leading: live.value.leading,
      state: live.value.state,
      nowMs: Date.now(),
      renders: [...renders.value],
      gate: gate.value,
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

  return {
    liveState: computed(() => live.value),
    renders: computed(() => renders.value),
    gate: computed(() => gate.value),
    recordRender,
    recordGateDecision,
    publishLiveState,
    inspect,
    preview,
    inspectLeader,
    previewLeader,
  }
})

/** Lines and characters a block uses, counted the way `renderSituation` checks its budget. */
export function situationBlockUsage(text: string): { lines: number, chars: number } {
  return { lines: text === '' ? 0 : text.split('\n').length, chars: text.length }
}
