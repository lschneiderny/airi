# Stage Shared Guide

## OVERVIEW

The client domain layer: stage contracts (`composePrompt` builds every character-turn system prompt), the pure decision cores of the fork's character systems (`expression-performance`, `situation`, `performance-state`, `stage-contract`, `motion-scenario`), and runtime-neutral helpers with explicit platform adapters. Score: 12. Cross-application boundary.
Pure cores hold domain logic, not UI; their Vue- and Pinia-free rule is the decider rule under CONVENTIONS. Small host-written holder stores live under `src/stores/`.
Follow the [root guide](../../AGENTS.md) for shared rules and task skills.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Model downloads | `src/model-assets/` | Repository and storage adapter contracts |
| Screen light sampling | `src/screen-ambient-light/` | Linear-light environments and synthetic-frame tests |
| Presence bubble | `src/presence-bubble/` | Canvas painter, placement, following, animation |
| Shortcut contracts | `src/global-shortcut/` | Physical keys and Electron serialization |
| Godot view state | `src/godot-stage/` | Strict schemas and patch validation |
| Plugin snapshots | `src/plugin-host.ts` | Serializable host state, not extension runtime |
| Storage feedback | `src/composables/` | Manual reset and versioned persistence |
| Diagnostics | `src/perf/`, `src/webgpu/` | Tracing leases and capability detection |
| Performance and expression deciders | `src/performance-state/`, `src/expression-performance/` | Pure resolvers with returned memory. Transports such as `affect-trace-diagnostics` get their own subpath, never the decider barrel. |
| Situation and motion scenarios | `src/situation/`, `src/motion-scenario/` | Scenario contract shared with `qa-tools` |
| Stage contract and prompt composer | `src/stage-contract/` | `composePrompt` builds the character-turn system prompt from budgeted segments. Order and budgets: [prompt composition ADR](../../docs/ai/adr/2026-11-01-prompt-composition.md) |
| Subpath contract catalogue | `README.md` | Per-entrypoint use and non-use rules |

## CONVENTIONS

- Prefer explicit exported subpaths for contracts shared across application boundaries.
- Model downloads share work per model. Only the final cancelled waiter aborts the transfer.
- A successful model installation requires the storage commit to finish.
- Ambient sampling excludes painted character pixels and uncaptured regions.
- Display luminance metering stays separate from character-relative lighting maps.
- Presence adapters upload changed painter revisions, using measured head bounds for placement.
- Shortcut equality compares physical combinations, not modifier order or display labels.
- Versioned storage pauses write feedback while applying read-side updates.
- Resolvers and deciders take explicit time and return memory for the next call. They never read clocks, global randomness, or stores.

## ANTI-PATTERNS

- Do not add application startup, persistence, or platform-specific side effects.
- Keep application Electron IPC in the Electron app and feature UI state in `stage-ui`.
- Keep extension runtime and manifest behavior in `plugin-sdk`.
- Do not place a client secret in `src/analytics/openpanel.ts`.
- Do not use character colors as their own ambient light source.
- Do not transmit raw shortcut driver errors. Use centrally defined failure reasons.
- Do not persist or replicate desktop activity snapshots, and do not sample desktop signals here. Host producers own sampling.

## CHECKS

- Typecheck: `pnpm -F @proj-airi/stage-shared typecheck`.
- Tests: `pnpm -F @proj-airi/stage-shared exec vitest run`.
