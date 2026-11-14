# Server Runtime Guide

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
