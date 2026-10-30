/** Mirrored source identities for scorer comparability; captureClosure sorts their hashes, computed after CRLF-to-LF normalization (since 13F). */
export const SCORE_CLOSURE_FILES = [
  'packages/core-agent/src/runtime/llm-marker-parser.ts',
  'packages/core-agent/src/runtime/recovered-cue.ts',
  'packages/core-agent/src/runtime/chat-orchestrator-runtime.ts',
  'packages/core-agent/src/runtime/response-categoriser.ts',
  'packages/core-agent/src/runtime/reply-replay.ts',
  'packages/core-agent/src/runtime/cue-compliance.ts',
  'packages/core-agent/src/runtime/cue-contract-fixtures.ts',
  'packages/pipelines-audio/src/llm-streaming-control/controller.ts',
  'packages/pipelines-audio/src/llm-streaming-control/payloads.ts',
  'packages/pipelines-audio/src/llm-streaming-control/parsers/act.ts',
  'packages/pipelines-audio/src/llm-streaming-control/parsers/delay.ts',
  'packages/pipelines-audio/src/llm-streaming-control/parsers/call.ts',
  'packages/qa-tools/src/model/score/cue-contract.ts',
  'packages/qa-tools/src/model/score/style.ts',
  'packages/qa-tools/src/model/score/legacy-score.ts',
  'packages/qa-tools/src/model/score/aggregate.ts',
] as const
