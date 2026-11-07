# Better WebSocket

## OVERVIEW
Protocol-neutral WebSocket client and server primitives. Score: 9, including measured client symbol density and exported declarations.

Parent guidance: [root AGENTS.md](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Public client surface | `src/index.ts`, `src/client/index.ts` |
| Server peers, groups, liveness | `src/server/index.ts`, `src/server/peers.ts` |
| Shared send and lifecycle contracts | `src/shared/` |
| Event wait ownership | `src/shared/utils/event-wait-for.ts` |
| CrossWS connector | `src/client/crossws/` |
| H3 adapter | `src/server/h3/` |
| Lifecycle regression tests | `src/index.test.ts`, `src/server/liveness.test.ts` |

## CONVENTIONS
- Keep server APIs behind `@proj-airi/better-ws/server`.
- Callers and connectors own message parsing and serialization.
- Connection epochs reject stale asynchronous connection results.
- Raw peer identity isolates replaced peers that reuse the same ID.
- Server liveness is opt-in and requires scheduler-driven `checkLiveness()`.
- Client heartbeat behavior depends on connector support and configured response matching.
- Package `dev` builds once rather than starting a server.
- Follow the root TypeScript and Vitest task routing.

## ANTI-PATTERNS
- Do not impose application event envelopes, authentication, or extension protocols here.
- Browser WebSocket connectors cannot send native ping frames.
- Server heartbeat configuration alone does not schedule pings or classify responses.
- A late close or message from a replaced peer must not affect its replacement.
- Event waits must release registrations after settlement.
- An undefined event payload is valid and must not mean that no event arrived.

## CHECKS
- `pnpm -F @proj-airi/better-ws typecheck`
- `pnpm -F @proj-airi/better-ws exec vitest run`
- `pnpm -F @proj-airi/better-ws build`
