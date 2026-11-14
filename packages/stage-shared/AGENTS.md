# Stage Shared Guide

## CONVENTIONS

- Pure cores (`expression-performance`, `situation`, `performance-state`, `stage-contract`, `motion-scenario`) hold domain logic, not UI, and stay Vue- and Pinia-free.
- Prefer explicit exported subpaths for contracts shared across application boundaries. `README.md` lists per-entrypoint use and non-use rules.
- Model downloads share work per model. Only the final cancelled waiter aborts the transfer.
- A successful model installation requires the storage commit to finish.
- Ambient sampling excludes painted character pixels and uncaptured regions.
- Display luminance metering stays separate from character-relative lighting maps.
- Presence adapters upload changed painter revisions, using measured head bounds for placement.
- Shortcut equality compares physical combinations, not modifier order or display labels.
- Versioned storage pauses write feedback while applying read-side updates.
- Resolvers and deciders take explicit time and return memory for the next call. They never read clocks, global randomness, or stores.
- Transports such as `affect-trace-diagnostics` get their own subpath, never the decider barrel.
- The motion-scenario contract is shared with `qa-tools`.
- `composePrompt` builds every character-turn system prompt from budgeted segments. Order and budgets: [prompt composition ADR](../../docs/ai/adr/2026-11-01-prompt-composition.md).

## ANTI-PATTERNS

- Do not add application startup, persistence, or platform-specific side effects.
- Keep application Electron IPC in the Electron app and feature UI state in `stage-ui`.
- Keep extension runtime and manifest behavior in `plugin-sdk`.
- Do not place a client secret in `src/analytics/openpanel.ts`.
- Do not use character colors as their own ambient light source.
- Do not transmit raw shortcut driver errors. Use centrally defined failure reasons.
- Do not persist or replicate desktop activity snapshots, and do not sample desktop signals here. Host producers own sampling.
