# Audio Pipelines Guide

## OVERVIEW

UI-independent input, capture, observation, speech scheduling, and playback orchestration. Score: 12. Distinct stream boundary.
Follow the [root guide](../../AGENTS.md) for shared rules and test skills.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Source sharing | `src/audio-input.ts` | Live subscriptions and replay history |
| Capture lifetime | `src/capture.ts`, `src/scope.ts` | Abort ownership and outcomes |
| Detector windows | `src/observe.ts` | Windowing and detector scheduling |
| Playback contracts | `src/playback.ts` | Groups, driver clock, receipts |
| Voice capacity | `src/managers/playback-manager.ts` | Owner/global limits and stealing |
| Synthesis ordering | `src/speech-pipeline.ts` | Concurrent work, ordered playback |
| Streaming controls | `src/llm-streaming-control/` | Turns, CALL, ACT, DELAY |
| Text chunks | `src/processors/tts-chunker.ts` | Unicode boundaries and narrative filtering |

## CONVENTIONS

- Live sources are shared. File consumers open independent streams with native backpressure.
- Each connection has its own ID and stable format. Discontinuities discard replay history.
- Subscribers receive bounded queues. One slow subscriber cannot stall the shared source.
- Operational completion uses outcomes. Invalid configuration fails before resource allocation.
- Playback clips stay ordered within groups, using the driver's clock for receipts.
- Named timeline tracks execute serially. Concurrent synthesis preserves producer sequence before playback.
- CALL handlers run sequentially. Turn-local handlers override global handlers.
- Parsing has no side effects. Observer errors cannot break dispatch.

## ANTI-PATTERNS

- Do not mutate shared PCM arrays or reuse frame coordinates across connections.
- Do not reopen finished playback groups. Stop resolves only after actual silence.
- Match late playback completion by active entry identity, not a reusable item ID.
- Do not rebroadcast remotely dispatched control events.
- Keep CALL payloads inside their JSON array, not after `|>`.
- Keep Vue/Electron state, credentials, browser sources, and file encoding outside this package.

## CHECKS

- Run `pnpm -F @proj-airi/pipelines-audio typecheck`.
- Run `pnpm -F @proj-airi/pipelines-audio test:run`.
- Run `pnpm -F @proj-airi/pipelines-audio build` when exports change. Package `dev` builds once rather than watching.
