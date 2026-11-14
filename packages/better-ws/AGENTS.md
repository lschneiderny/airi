# Better WebSocket

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
