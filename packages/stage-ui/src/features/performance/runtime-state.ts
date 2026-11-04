import type { SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type {} from 'pinia-plugin-synced'

import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ExposedExpressionKind = SlotCommand['slot']

/** What the LLM sees an exposed expression as: a slot kind, or a combo that spans several slots. */
export type ExposedExpressionGroup = ExposedExpressionKind | 'combo'

/** An expression the LLM may name; labels only, never ids or parameters. */
export interface ExposedExpression {
  label: string
  kind: ExposedExpressionGroup
}

/** A clip the user labeled and exposed; gestures ride on ACT cues, actions and dances on `perform_action`. */
export interface ExposedAction {
  label: string
  kind: 'gesture' | 'action' | 'dance'
}

/** An exposed expression that currently occupies a performer slot. */
export interface ActiveExpression {
  slot: SlotCommand['slot']
  label: string
}

export interface PerformanceMoodSnapshot {
  valence: number
  arousal: number
  tension: number
}

export interface PerformanceRuntimeSnapshot {
  exposed: ExposedExpression[]
  /** Exposed clips of the loaded model; empty for scenes without a clip library. */
  exposedActions: ExposedAction[]
  active: ActiveExpression[]
  /** `null` while no Natural mood is published (other drivers, or state feedback off). */
  mood: PerformanceMoodSnapshot | null
}

/**
 * Replicates what the LLM may know about the stage performance.
 *
 * The stage renderer's performance conductor is the only writer; the chat and settings
 * windows read the replicated snapshot to build the runtime prompt.
 */
export const usePerformanceRuntimeState = defineStore('expression-performance-runtime-state', () => {
  const exposed = ref<ExposedExpression[]>([])
  const exposedActions = ref<ExposedAction[]>([])
  const active = ref<ActiveExpression[]>([])
  const mood = ref<PerformanceMoodSnapshot | null>(null)

  /**
   * Replaces only the fields whose content changed, so unchanged publications send no
   * synchronization proposal. Called only by the stage performance conductor.
   */
  function publish(snapshot: PerformanceRuntimeSnapshot) {
    if (JSON.stringify(snapshot.exposed) !== JSON.stringify(exposed.value))
      exposed.value = structuredClone(snapshot.exposed)
    if (JSON.stringify(snapshot.exposedActions) !== JSON.stringify(exposedActions.value))
      exposedActions.value = structuredClone(snapshot.exposedActions)
    if (JSON.stringify(snapshot.active) !== JSON.stringify(active.value))
      active.value = structuredClone(snapshot.active)
    if (JSON.stringify(snapshot.mood) !== JSON.stringify(mood.value))
      mood.value = snapshot.mood === null ? null : { ...snapshot.mood }
  }

  return { exposed, exposedActions, active, mood, publish }
}, {
  synced: {
    state: true,
  },
})
