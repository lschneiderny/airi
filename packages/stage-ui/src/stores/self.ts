import type { IdleBehaviourReport } from '@proj-airi/motion-driver-natural/idle-activities'
import type { SelfActivity, SelfObservation } from '@proj-airi/stage-shared/situation'

import { errorMessageFrom } from '@moeru/std'
import { defineStore } from 'pinia'

import { getSpeechBusContext } from '../services/speech/bus'
import { situationSelfObservedEvent } from './situation/self-bus'

/** A self-directed activity as a scene reports it; the store stamps the time. */
export type StageSelfReport = Pick<SelfObservation, 'activity' | 'phase' | 'label'>

/**
 * The situation's name for an idle behaviour of the Natural driver, or `null` for one the model is not told about.
 * Waiting to speak is not an activity of her own: the turn it belongs to says more than a line about it could. Letting
 * the thought go is told as one finished moment, when it starts.
 */
export function selfReportOf(report: IdleBehaviourReport): StageSelfReport | null {
  if (report.behaviour === 'about-to-speak')
    return null
  if (report.behaviour === 'let-go')
    return report.phase === 'start' ? { activity: 'held-back', phase: 'end' } : null
  return { activity: report.behaviour satisfies SelfActivity, phase: report.phase }
}

/**
 * Routes what the character does on her own from a rendered stage to the situation. Lives in the stage window:
 * `Stage.vue` hands it each Live2D and MMD scene report. Every report is forwarded to the leader's situation store as
 * a {@link SelfObservation} over {@link situationSelfObservedEvent}, where it becomes the line of the situation block
 * that tells the model what she was doing. It never reaches the reach-out gate as a topic.
 *
 * Each rendered stage reports for itself. When two stages render at once, the leader folds both, and the newer
 * report wins.
 */
export const useStageSelfStore = defineStore('stage-self', () => {
  function report(entry: StageSelfReport) {
    const observation: SelfObservation = { kind: 'self', ...entry, atMs: Date.now() }
    getSpeechBusContext().emit(situationSelfObservedEvent, observation).catch(error => console.error('[stage-self] Forwarding a self report to the situation leader failed:', errorMessageFrom(error)))
  }

  /** Reports an idle behaviour of the Natural driver. */
  function idle(behaviour: IdleBehaviourReport) {
    const entry = selfReportOf(behaviour)
    if (entry)
      report(entry)
  }

  return { report, idle }
})
