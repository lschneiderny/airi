# Choosing a persistence tier for client state

Date: 2026-11-01
Status: accepted

## Context

The [architecture audit](../audits/2026-10-31-architecture-boundaries.md) (Lens 2) counted ten persistence tiers in the client and no rule for choosing one. Four of them store to localStorage and differ only in which window may write and how the write is guarded. Each new feature picked or invented a tier, and two consequences followed:

- "Delete all data" did not reach every tier. It left the gate's inner state (`settings/situation-inner`), the presence and expression settings documents, the per-model expression documents, and the MMD settings behind until 2026-11-01.
- Settings of the same kind use different tiers. Natural's settings are plain localStorage refs that any window may write, while the expression performance settings are a validated, leader-routed synced document.

## Decision

Choose the first tier below that fits the state. A store that persists anything is registered with `useDataMaintenance` (`packages/stage-ui/src/composables/use-data-maintenance.ts`) in the same commit, so "Delete all data" reaches it.

| # | State | Tier | Members |
| --- | --- | --- | --- |
| 1 | A user-facing settings document for one feature | **Synced settings document**: one Valibot-validated document, persisted privately through `useLocalStorageManualReset` with `listenToStorageChanges: false` and `writeDefaults: false`, in a synced store whose `update` and `reset` actions are leader-routed. Followers never write storage. | `settings/situation`, `settings/expression-performance` |
| 2 | Leader-only state that must survive a reload but must not replicate, because it holds personal content or grows with every save | **localStorage by explicit command with a leadership token**: the leader claims a token and every write carries it; a write over a newer save is refused. Clearing it is leader-routed (`useSituationStore().forget`), because the leader would otherwise write its in-memory copy back. | `settings/situation-inner` (named exception, see the [cadence ADR](2026-10-29-unprompted-reach-out-cadence.md)) |
| 3 | A document per display model that the stage writes | **localStorage keyed by model id**: the stage writes, other windows send commands. Delete-all removes the keys by prefix. | `expression-catalog:<id>`, `expression-rest:<id>` |
| 4 | Many records or large records | **IndexedDB**, behind a synced store with leader-routed actions when other windows need the records | chat sessions and control records (unstorage); long-term memory (localforage, see below) |
| 5 | Runtime state that another window reads, not persisted | **Synced Pinia memory**. Replicate values, never events: an event stored in replicated state is replayed with every snapshot. Do not replicate a value that a producer samples periodically unless another window consumes it. | `usePerformanceRuntimeState`, `useNaturalPerformanceOverride` |
| 6 | Sensor samples and the leader's observations | **Per-window memory, unsynced and not persisted** | desktop activity and foreground window holders, `useSituationStore` |

Two tiers are closed to new state:

- **Plain `useLocalStorageManualReset` refs that any window may write.** They are the upstream convention. New settings use tier 1. Natural's `settings/live2d/natural-*` and `settings/mmd/natural-*` keys are the migration target: fold them into a synced settings document per renderer.
- **A main-process ring with disk recording** stays specific to the IO trace hub. Use it only for diagnostics that must outlive a renderer.

Long-term memory is a recorded exception to tier 4's leader routing. Any window may write through `useMemoryStore`, which invalidates other windows over a BroadcastChannel and takes no lock. That is safe while only the leader runs chat turns, which are the only writers besides Settings. The [memory adoption ADR](2026-10-30-long-term-memory-adoption.md) records the same rule.

## Consequences

- Reviewers can check a new store against the table. A store outside it needs an amendment to this record first.
- The Natural settings migration is open work. Until it lands, those keys keep their any-window writes, and `resetState` of the Live2D and MMD settings stores clears them.
- Tier 2 and tier 3 keep explicit reset paths in `useDataMaintenance`: the situation store's `forget({ scope: 'everything' })` and the expression-document prefix sweep.

## Validation

`packages/stage-ui/src/composables/use-data-maintenance.browser.test.ts` checks that "Delete all data" clears the gate's inner state, every expression document, the presence and expression settings documents, and the MMD settings. `packages/stage-ui/src/stores/situation/index.test.ts` checks the leader-routed forget for a deleted session, for a follower's request over the speech bus, and with no leader.
