# Character mind: act moments from the mind's orders

Date: 2026-11-22
Status: accepted; CM9e implemented. Headless and rendered acceptance are recorded below.

Current rules are in [Autonomous behavior](../context/autonomous-behavior.md) (the Moment expression row) and the [glossary](../context/glossary.md) (Moment expression). The [CM9 plan](../../../.omo/plans/character-mind-cm9.md) records the split, the decisions table, and the checks. This slice builds on the [settle ADR](2026-11-22-character-mind-settle.md) and the [wander linger ADR](2026-11-22-character-mind-wander-linger.md).

## Context

`useIdleProps` marks moments with expression entries the user tagged. A moment the mind sends (`poked`, `petted`, `welcome-back`) already seeds its chance and pick from its intent id (`expressionSeed(intentId, 'moment')`). The moments that follow an idle act (`check-in`, `yawning`, `zoning-out`, `peering`), a `let-go` cue (`held-back`), and the end of a sleep (`waking`) drew from a local Mulberry32 stream that starts at 0 in every stage, so two stages fed the same orders could mark different entries, and a lab preview shifted every later pick. The behaviour reports carried only the phase and the kind, and the idle cue carried no intent id. Autonomous behavior Target rule 4 listed the moments as open.

## Decisions

### D14: seeds come from the intents that started the behaviour

- `IdleBehaviourRecord.intentId` keeps the intent that started a behaviour: the idle order, or the mind's `cue` intent. `IdleBehaviourReports` puts it on the start and the end report (`IdleBehaviourReport.intentId`), and `NaturalMotion.idleState` exposes it for the adapters.
- The idle cue carries the cue intent id: `StagePerformanceScene.idleCue(kind, intentId)`, both scenes, both adapters, `NaturalMotion.idleCue`, and `NaturalIdleActivities.cue`. A cue's `started` idle report now names that id as well; the mind's idle policy only compares it with its pending order.
- `onIdleBehaviour` seeds every act moment from its order's id and `held-back` from the `let-go` cue's id, with `expressionSeed`'s `moment` purpose, and `waking` from the sleep order's id with the new `waking` purpose, so the waking never shares a draw with a moment of the same order.
- Option (b), a mind `moment` intent for each act, was rejected: it doubles the intents for acts the mind already ordered.

### D15: previews keep the local stream

A forced lab moment, the preview pastime pick, and a report without an intent id draw from the local stream.

## Deviations

- **`stage-shared` changes.** `expressionSeed` gains the `waking` purpose in `packages/stage-shared/src/expression-performance/selection.ts`. The plan's table does not list `stage-shared` for CM9e.
- **Observer events unchanged.** `NaturalMotion`'s observer `idle` events are built from the phase and the kind only, so the reports' new field does not reach the observer and its traces.
- **Test fixtures.** The new required fields reach fixtures in `stage-ui` (`self.test.ts`, `use-motion-qa-bridge.test.ts`) and `stage-ui-mmd` (`arms.test.ts`, `intent.test.ts`); existing `useIdleProps` tests pass `intentId: null` and keep their local-stream draws.

## Consequences

- Two stages fed the same orders mark the same entries, and a lab preview no longer moves later act moments.
- No new persisted state, setting, or cross-process event. Neither headless runner runs `useIdleProps`.

## Headless and rendered acceptance

Placeholder for the oHeadless (orchestrator, macOS, 2026-11-22): lane B (CM9c, CM9d, CM9e) against the lane C tip, seed 1. All eleven `qa:motion3d` scenarios are `IDENTICAL` and both rig hashes are unchanged (`angry` `446b746a`, `happy` `a273e525`). The lane was later rebased onto `main` after PR #83; the only tree difference was two lines of the CM9f ADR, which no runner reads. Neither runner runs `useIdleProps`.

Rendered (orchestrator, macOS, 2026-11-22, ForBOOTH Live2D in the window, Natural, three entries tagged for `check-in`): eight `idle-play` `check-in` orders. In every trial the moment the stage picked matched the pick `expressionSeed` gives for the order's intent id: three trials marked an entry, and five drew a gate ticket of 0.6 or more and marked none. 0 renderer and 0 main-process errors.
