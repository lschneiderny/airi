# Character mind: settling in the idle policy

Date: 2026-11-22
Status: accepted; CM9c implemented. Headless and rendered acceptance are recorded below.

Current rules are in [Autonomous behavior](../context/autonomous-behavior.md) (Precedence rules 6 and 8, the Body director row) and the [glossary](../context/glossary.md) (Idle policy, Intent, Stance). The [CM9 plan](../../../.omo/plans/character-mind-cm9.md) records the split, the decisions table, and the checks.

## Context

Natural's idle layer (`NaturalIdleActivities`) timed when she settled in: 120 s of continuous `idle` mode with a body drive and no frame-level interrupt. It reported `settled` in its idle view and in its body intent, the mind's idle schedule read it for the settled pool and the yawn after a long sleep, and the MMD director sat her or rested her on it (`directorIdleStates`). Each stage's controller kept its own count, so a model reload or a second stage restarted or duplicated it. Autonomous behavior Target rule 4 listed it as open.

## Decisions

### The mind's idle policy decides the settle

`MindIdleState.settle` keeps `since` and `settled` in the idle policy's active seconds. The count starts when the view is in `idle` mode and its drive performs a body, clears on any other view and on a dormant view, and turns `settled` true `SETTLE_SECONDS` (120) after `since`. An inactive view keeps the count, because the idle clock stops with it. `nextIdleWakeAt` includes the settle deadline, also while an idle order waits for its answer, so the host wakes the mind on time. A span that crosses the deadline runs the schedule standing up to it and settled after it, so a decision on either side reads the pool of its own time.

The mind sends a posture `settle` intent on each edge. The schedule reads `IdleContext.settled`; `IdleView.settled` is deleted.

### D11: what restarts the count

The mind's own interrupting stimuli restart it: a touch, an emotion, an `expression-request` that started an episode, a cue gesture, a presence stimulus with a desktop wake, a screen change, a chat cue, an engaged cursor episode, and every posture `cue` around a line (`interruptSettle`, called from `step`). A frame-level interrupt that the mind does not see, such as a cursor Natural noticed while the mind refused to engage it, no longer restarts the count. Option (b), a per-frame interrupt report from Natural, was rejected as a frame-rate report for an episode decision.

### Realisation

- Natural drops `settleSeconds`, `idleSince`, and `settled`; `NaturalBodyIntent.idle` no longer carries `settled`.
- The mind store hands every `settle` intent to every attached stage, as it does idle orders, and sends the reset state's settle (false) to every stage after a reset.
- `StagePerformanceConductor` `settle` passes it to a posture scene (`setSettled`); `syncScene` seeds the mind's current settle when a scene attaches or its posture returns. A performer stimulus without posture clears the count without an edge, because no stage could take it.
- `MMD.vue` keeps the last settle and hands it with Natural's behaviour to `directorIdleStates`; the headless runner does the same. Live2D has no `setSettled` and drops it.
- `IDLE_TO_SIT_MS` stays as the onset that reports read, and its comment cites `SETTLE_SECONDS`.

## Deviations

- **Commit split.** The plan's first item removes Natural's `settled` with the mind change. Natural's body intent fed the director, so removing it there would leave the MMD scene and the runner without a settle until the second commit. The first commit moves the decision and the schedule's reading into the mind and deletes `IdleView.settled`; the second deletes Natural's own timer with the scene, store, conductor, and runner wiring, and so also touches `motion-driver-natural`. Both commits pass the package checks.
- **Upstream file outside the plan's table.** `packages/stage-ui/src/components/scenes/Stage.vue` gains one line: the stage it lends the mind store (`MindStage`) forwards `settle` to the conductor. The plan's upstream table lists `Stage.vue` only for CM9e and CM10.
- **Reset.** The plan does not say what a mind reset does to a settled stage. The store sends the new state's settle to every stage, which gets her up; a reset is a card switch or a promotion, and fast state resets there.
- **Runner test.** The plan asks for a test that the runner dispatches `settle`. The runner's dispatch is a closure inside `runMotion3dScenario`, which needs a model, and the gated model tests run at most 31 s. No test-only export was added; the orchestrator's headless `rest` report at both ends covers it.

## Consequences

- No new persisted state, setting, or cross-process event. The settle is fast state and resets at a card switch and on launch.
- The settle onset may move by at most one frame against the old one, and an interrupt Natural saw but the mind does not see no longer restarts it (plan section 8).

## Headless and rendered acceptance

Placeholder for the oHeadless (orchestrator, macOS, 2026-11-22): lane B (CM9c, CM9d, CM9e) against the lane C tip, seed 1. All eleven `qa:motion3d` scenarios are `IDENTICAL` and both rig hashes are unchanged (`angry` `446b746a`, `happy` `a273e525`). The lane was later rebased onto `main` after PR #83; the only tree difference was two lines of the CM9f ADR, which no runner reads. No scenario reaches 120 s of continuous idle, so the settle onset never fires in a headless run and the rest verdicts cannot move.

Rendered (orchestrator, macOS, 2026-11-22, the QA MMD model on the desktop stage, Natural, desktop idle pinned at 60 s, no sit clip imported): the mind's `idle-wake` step carried `settle` true 119.7 s after the stage went idle, and the director, with no sit slot, kept her standing with the reason `rest-fallback`. A poke then produced an `idle` step carrying `settle` false before the poke's touch reaction, and the director read `active`. 0 renderer and 0 main-process errors.
