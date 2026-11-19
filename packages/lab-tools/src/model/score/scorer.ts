import type { ChatOrchestratorStageConfig } from '@proj-airi/core-agent'

import type { ExposedAction } from '../exposed-actions'
import type { ReplyTranscriptRecord } from '../transcript/schema'

/** What a scorer may need besides the reply itself. `contract` is null when the run has no cue contract text. */
export interface ScoreContext {
  contract: { text: string, exampleLines: string[] } | null
  /** Stage rules of the live runtime, so the replay declines and recovers cues as the app does. */
  stage: ChatOrchestratorStageConfig
  /**
   * The clips the run exposed to the model. Without it the action fields resolve to no disposition and no tool call is
   * judged unknown, so default scoring does not depend on an exposed set; an empty list makes every label unknown.
   */
  exposedActions?: readonly ExposedAction[]
}

/** Scores one transcript record. Scoring is always `(transcripts.jsonl, scorer set)`. */
export interface ReplyScorer<T> {
  id: string
  version: number
  score: (record: ReplyTranscriptRecord, context: ScoreContext) => Promise<T> | T
}
