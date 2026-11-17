# Stage Shared Guide

## CONVENTIONS

- Prefer explicit exported subpaths for contracts shared across application boundaries.
- Model downloads share work per model. Only the final cancelled waiter aborts the transfer.
- A successful model installation requires the storage commit to finish.
- Ambient sampling excludes painted character pixels and uncaptured regions.
- Display luminance metering stays separate from character-relative lighting maps.
- Presence adapters upload changed painter revisions, using measured head bounds for placement.
- Shortcut equality compares physical combinations, not modifier order or display labels.
- Versioned storage pauses write feedback while applying read-side updates.
- Transports such as `affect-trace-diagnostics` get their own subpath, never the decider barrel.

## ANTI-PATTERNS

- Do not place a client secret in `src/analytics/openpanel.ts`.
- Do not use character colors as their own ambient light source.
- Do not transmit raw shortcut driver errors. Use centrally defined failure reasons.
