import type { ChatOrchestratorStageConfig } from '@proj-airi/core-agent'

import type { ReplyTranscriptRecord } from '../transcript/schema'

/** What a scorer may need besides the reply itself. `contract` is null when the run has no cue contract text. */
export interface ScoreContext {
  contract: { text: string, exampleLines: string[] } | null
  /** Stage rules of the live runtime, so the replay declines and recovers cues as the app does. */
  stage: ChatOrchestratorStageConfig
}

/** Scores one transcript record. Scoring is always `(transcripts.jsonl, scorer set)`. */
export interface ReplyScorer<T> {
  id: string
  version: number
  score: (record: ReplyTranscriptRecord, context: ScoreContext) => Promise<T> | T
}
