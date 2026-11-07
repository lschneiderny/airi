# Core Agent

## OVERVIEW
Runtime orchestration, conversation projection, and voice coordination. Score: 8, with explicit host ports and built package exports.

Parent guidance: [root AGENTS.md](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Session queues and chat lifecycle | `src/runtime/chat-orchestrator-runtime.ts` |
| Provider requests and retries | `src/runtime/llm-service.ts`, `src/runtime/request-context.ts` |
| Protocol adapters | `src/runtime/chat-completions.ts`, `src/runtime/responses.ts` |
| Conversation projection and history | `src/messages/` |
| Host ports | `src/contracts/` |
| Voice input, output, plugins | `src/voice/` |
| Spark agents | `src/agents/spark-notify/`, `src/agents/spark-command/` |
| Streamed marker parsing | `src/runtime/llm-marker-parser.ts` |
| Build entries | `tsdown.config.ts`: root plus `./agents/spark-notify` and `./agents/spark-command` |

## CONVENTIONS
- Hosts own persistence and UI. Provider-inference owns provider definitions. The gateway owns authentication and billing.
- Keep one FIFO queue per session.
- Native continuation belongs to its protocol and provider, endpoint, model, and conversation scope.
- Refresh live settings between model requests without duplicating completed rounds.
- Keep display projections separate from inference input and native continuation.
- Voice input and output modules must not import the controller.
- Trusted plugins receive scoped controls, not unrestricted controller access.
- `src/runtime/chat-orchestrator-runtime.ts` is the integration hub for session queues, turn lifecycle, and request assembly. Add no new stage semantics or prompt text there: take them from the host as options or dependencies, the way `unpromptedTools` arrives. The decline marker and the recoverable cue names come from the required `deps.stage` (AIRI passes `STAGE_RUNTIME_CONFIG` from `@proj-airi/stage-shared/stage-contract`); a send's `declineMarker` option still overrides the marker. The eval oracle is the exception: the cue-compliance buckets (`src/runtime/cue-compliance.ts`) and the cue-contract fixtures (`src/runtime/cue-contract-fixtures.ts`) stay in core-agent and encode the live cue vocabulary directly, because they define what replay scoring expects (audit R4, `docs/ai/audits/2026-10-31-architecture-boundaries.md`).
- Follow the root TypeScript and Vitest task routing.

## ANTI-PATTERNS
- Never retry after an event reaches the consumer or repeat completed tool effects.
- Never commit generated turns before transport, tools, and consumers finish.
- Cancelled or failed generations must not commit a completed turn.
- Missing tool results mean pending execution, not success.
- Never execute sticker markers through speech or plugin hooks.
- The voice controller must not close its shared audio input.
- Normal input end must drain transcription rather than abort the provider.
- Keep transcript writes synchronous and revisions increasing.
- Reuse interruption event IDs during persistence retries.

## CHECKS
- `pnpm -F @proj-airi/core-agent typecheck`
- `pnpm -F @proj-airi/core-agent exec vitest run src/runtime src/messages src/voice src/agents`
- `pnpm -F @proj-airi/core-agent build`
- Evaluations use `eval:run` and require `OPENROUTER_API_KEY`.
