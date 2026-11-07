# Server Runtime Guide

## OVERVIEW

WebSocket channel authentication, peer lifecycle, routing, and server hosting. Score: 12. Distinct transport boundary.
Follow the [root guide](../../AGENTS.md) for shared rules and task skills.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Channel orchestration | `src/index.ts` | `setupApp`, registration, identity, disposal |
| Listener startup | `src/server/index.ts` | `createServer`, TLS, bind lifecycle |
| Route policy | `src/middlewares/route.ts` | Authentication and destination collection |
| Selector matching | `src/middlewares/route/match-expression.ts` | Recursive expressions and identity labels |
| Wire encoding | `src/server-ws/airi/codec.ts` | SuperJSON, plain JSON, validation |
| Consumer delivery | `src/server-ws/airi/consumers.ts` | Priority, sticky and round-robin selection |
| Connection state | `src/types/conn.ts` | Peer and liveness contracts |
| CLI configuration | `src/bin/run.ts`, `src/config/` | Environment and options |

## CONVENTIONS

- `setupApp` returns the app, peer closure, and disposal controls.
- Server startup deduplicates concurrent starts. Default binding is `127.0.0.1:6121`.
- Raw heartbeat frames affect liveness, not application event dispatch.
- Stamp the actual sender. Client-provided `metadata.source` is not trusted identity.
- Consumer selection excludes the sender, unauthenticated peers, and explicitly unhealthy peers.
- Sort consumer priority descending and registration order ascending.
- Preserve tuple-based sticky and round-robin keys and membership-change cursor resets.

## ANTI-PATTERNS

- Do not route to unauthenticated peers, including through policy bypass.
- Preserve explicit empty destinations. They are not broadcasts.
- Route-envelope destinations take precedence over payload destinations.
- Do not parse away the SuperJSON wrapper before codec detection.
- Keep codec workaround removal tied to clients sharing a non-wrapper format.
- Do not interpret `missedHeartbeats` as a count. Its current value is silence duration in milliseconds.

## CHECKS

- Typecheck: `pnpm -F @proj-airi/server-runtime typecheck`.
- Tests: `pnpm -F @proj-airi/server-runtime exec vitest run`.
- Build: `pnpm -F @proj-airi/server-runtime build`.
