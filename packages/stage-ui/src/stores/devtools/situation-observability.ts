import type { RenderedSituation, SituationState } from '@proj-airi/stage-shared/situation'

import { advanceSituation, initialSituationState, renderSituation } from '@proj-airi/stage-shared/situation'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

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

export interface SituationInspection extends SituationLiveState {
  /** Clock of the answering window when it built the inspection. */
  nowMs: number
  /** Newest first, at most {@link SITUATION_RENDER_HISTORY_MAX}. */
  renders: SituationRenderRecord[]
}

export interface SituationPreview extends RenderedSituation {
  leading: boolean
  nowMs: number
}

/**
 * Collects what the devtools Situation inspector shows: the live situation and the blocks sent with chat requests.
 *
 * The situation store of each window publishes into its local copy of this store. Only the leader folds
 * observations, so a follower window (the Electron settings window, for example) reads the leader's copy through
 * the leader-routed {@link inspect} and {@link preview} actions. No state is synchronized between windows.
 */
export const useSituationObservabilityStore = defineStore('devtools:situation-observability', () => {
  const live = shallowRef<SituationLiveState>({ leading: false, state: initialSituationState })
  const renders = shallowRef<readonly SituationRenderRecord[]>([])

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

  /** Called by the situation store of this window whenever its state or leadership changes. */
  function publishLiveState(leading: boolean, state: SituationState) {
    live.value = { leading, state }
  }

  /** Returns the live situation and the render history of the leader window. */
  async function inspect(): Promise<SituationInspection> {
    return {
      leading: live.value.leading,
      state: live.value.state,
      nowMs: Date.now(),
      renders: [...renders.value],
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

  return {
    liveState: computed(() => live.value),
    renders: computed(() => renders.value),
    recordRender,
    publishLiveState,
    inspect,
    preview,
  }
}, {
  synced: {
    actions: ['inspect', 'preview'],
    state: false,
  },
})

/** Lines and characters a block uses, counted the way `renderSituation` checks its budget. */
export function situationBlockUsage(text: string): { lines: number, chars: number } {
  return { lines: text === '' ? 0 : text.split('\n').length, chars: text.length }
}
