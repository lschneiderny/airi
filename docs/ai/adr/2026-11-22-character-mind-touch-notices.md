# Character mind: Natural touch cleanup, owner-result notices, and reminder rank

Date: 2026-11-22
Status: accepted; CM8 implemented, with headless and rendered acceptance assigned to the orchestrator (placeholder below).

Current rules are in [Autonomous behavior](../context/autonomous-behavior.md), [LLM prompt](../context/llm-prompt.md), the [glossary](../context/glossary.md), and the [upstream policy ledger](../context/upstream-policy.md). The [notify and touch plan](../../../.omo/plans/character-mind-notify-touch.md) records departures, commands, and results.

## Context

Three overlaps remained after CM7a and CM7c. Touch under Universal and MAGIC used upstream's tracker and a separate avatar notify cooldown (overlap 11). Notice turns spoke outside the voice policy, its quiet rules, floor, and cap (overlap 12). Avatar touch notifies and task reminders reached the gate as unranked immediate notifies, and a critical reminder could fire during the scheduler's 60-second look-ahead (overlap 13).

This ADR implements CM8 under the direction ADR's decisions 3, 7, and 14 and fits the landed [performer capabilities](2026-11-22-character-mind-performers.md) and [behavior settings](2026-11-22-character-behavior-settings.md) decisions. Their bodies remain unchanged.

## Decisions

### D2 owner ruling (2026-11-21): touch changes only under Natural

The plan recommended one classifier and one spoken pacing for every driver. The owner instead chose option (a): Universal, MAGIC, and classic keep upstream's touch exactly as shipped, including thresholds, hover recognition, reaction timing and count, touch-off behavior, and classic's spoken touch lines. `createLive2DTouchGestureTracker`, the avatar notify aggregator and its 20-second cooldown, and the avatar-touch store stay. This also keeps decision 7 of the direction ADR and the CM7a assumption that no touch reaches the mind without posture.

Under Natural, Live2D and MMD already share `NaturalTouchGestures`, `answerTouch`, and the mind-owned `ReactionMemory`; a performer switch does not reset it. CM8 fixes the one defect found there: scene cleanup (model swap, pause, touch-off, the hold requirement, and driver changes) reported a normal `pet-end` with its elapsed duration, so cleanup could dose mood, mark a moment, and speak late. Cleanup now reports `pet-cancel`; the mind closes only a pet it granted, without a draw, dose, moment, attend, or line. A normal pointer leave keeps its leave grace.

Overlap 11 therefore stays open, recorded as kept for the upstream drivers. The roadmap row records the narrowed scope.

### D3 to D7: owner results are stored first and announced through the mind

`NoticeOwner` (`packages/stage-ui/src/features/notice/owner.ts`) commits one source-attributed notice through `commitUserMessage` before any response preparation. Its receipt is independent of generation; a delivery signal cancels only before the commit starts. Duplicate identities join the active delivery or return the stored receipt without a second announcement. Teardown settles every waiter. Inactive or archived targets and hosts without a leader mind keep the result stored without a reply.

The leader's mind receives a typed `notice-request` and may yield one `notice` line. An owner result skips reach-out enablement, chattiness and urge draws, and unanswered-opening holds, because the owner started the work. Every other hard suppressor, the shared floor, and the shared hourly cap apply. Waiting widget requests come first, then eligible urgent reasons, then the oldest eligible notice, then ordinary selection; the gate defers ordinary accrual and draws when a notice owns the slot. A spoken notice charges the floor and one cap entry and never an unanswered opening; other outcomes charge nothing. A request expires five minutes after acceptance on the mind's clock, or on a session, character, generation, owner-turn, or run change. Pending requests live only in leader memory and are never replayed.

The runtime's `submitNotice` answers the exact committed message, rechecking its session generation and source, without appending a second trigger. The notice prefix and silence option remain. A continuation intersects the loaded source turn's tools again at execution and stores any narrower set before tools run, so a chain of notices cannot restore a removed tool.

Rejected: queuing before storage, which breaks terminal receipts; a persisted announcement queue, which produces stale speech after restart; treating notices as ordinary reach-outs, which would silence requested work whenever reach-outs are off.

### D8 and D9: reminders carry trusted source, due time, and occurrence

The notebook builds trusted `task-reminder` provenance with task id, schedule revision, priority, and effective due time; protocol inputs, including a forged scheduler source, keep plugin provenance. Before its due time a reminder is context only. A due critical reminder ranks first among urgent reasons, then by due time and task id; other priorities enter the due hazard. Every settled attempt, including a decline, refusal, or failure, consumes the occurrence in the runtime notebook; only an explicit reschedule creates a new revision. Plugin urgency and the avatar notify route keep their existing meaning.

## Consequences

- No new persisted state, settings, dependency, or cross-process event was added.
- Overlaps 12 and 13 are closed; overlap 11 is closed for Natural and kept for the upstream drivers.
- `generating` counts any session, so a running background task holds every announcement, as it already holds reach-outs.
- A result delivered while its conversation is not selected stays readable but is never announced later.

## Orchestrator acceptance placeholder

**Pending; to be filled by the orchestrator.** This worker ran no `qa:*` command and no Electron launch. Record here the run directories, gate or report lines, scalar event kinds and counts without content, and renderer and main-process error counts for:

- Headless: `qa:test:model`, `qa:live2d-rig`, and `qa:motion3d` `touch`, `idle`, and `speak` at seed 1 with `--verify-determinism`, identical to the pre-change base except for cleanup paths.
- Rendered Live2D Natural: hover and held pets; pause, touch-off, model swap, and driver switch during a pet each release the hand with no pet line, mood dose, or moment afterward.
- Rendered Live2D Universal and MAGIC: taps, pats, impulses, touch motions, and avatar notifies behave as before CM8.
- Rendered MMD Natural and classic: Natural cleanup as above; classic unchanged.
- Notices: a background result is stored at once; with a draft open nothing speaks; clearing it lets one announcement run or decline; do-not-disturb, a quiet app, a full floor or cap, and a conversation switch leave it store-only; reach-outs off still allow it.
- Terminal outcome delivered twice with one action id returns one receipt and at most one announcement.
- Reminders: a critical reminder does not fire before its due time, ranks above an immediate plugin notify at due, and does not repeat after the scheduler requeues it.
