# Core Agent

## CONVENTIONS
- Keep one FIFO queue per session.
- Add no new stage semantics or prompt text to `src/runtime/chat-orchestrator-runtime.ts`: take them from the host as options or dependencies, the way `unpromptedTools` arrives. The eval oracle is the exception: the cue-compliance buckets (`src/runtime/cue-compliance.ts`) and the cue-contract fixtures (`src/runtime/cue-contract-fixtures.ts`) stay in core-agent and encode the live cue vocabulary directly, because they define what replay scoring expects (audit R4, `docs/ai/audits/2026-10-31-architecture-boundaries.md`).

## ANTI-PATTERNS
- Missing tool results mean pending execution, not success.
- Keep transcript writes synchronous and revisions increasing.
- Reuse interruption event IDs during persistence retries.
