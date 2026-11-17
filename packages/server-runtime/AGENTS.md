# Server Runtime Guide

## CONVENTIONS

- Stamp the actual sender. Client-provided `metadata.source` is not trusted identity.

## ANTI-PATTERNS

- Do not route to unauthenticated peers, including through policy bypass.
- Preserve explicit empty destinations. They are not broadcasts.
- Route-envelope destinations take precedence over payload destinations.
- Do not parse away the SuperJSON wrapper before codec detection.
- Do not interpret `missedHeartbeats` as a count. Its current value is silence duration in milliseconds.
