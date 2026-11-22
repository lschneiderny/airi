# Character mind: Natural touch cleanup, owner-result notices, and reminder rank

Date: 2026-11-22
Status: accepted; CM8 implemented and accepted on macOS (headless and rendered results below).

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

## Rendered acceptance (CM8)

Run on macOS from the CM8 tip (`51f32a7e9`) with the dev Electron app and AppSession drivers kept under `.temp/qa-drivers` (not committed). Run directories below are under `.temp/qa-drivers/runs/`. Live2D ran on the window stage host with the ForBOOTH rig; MMD ran on the desktop stage host with the local MMD model. Chat used the `qa:llm` replay server and silent replay TTS. Pointer input is CDP `Input.dispatchMouseEvent` on the stage page. The window lifecycle store's `minimized` flag stands in for a minimized window, a composer-activity event on the speech bus stands in for an open draft, and the desktop and foreground samplers are pinned to a present user so the gate does not hold on stale signals. The driver reads the event log before every setting change.

Every launch below reports 0 renderer and 0 main-process errors, except one reminder launch that is named in check 6. No product bug was found. Headless, seed 1: all ten `qa:motion3d` scenarios (`idle`, `idle-drive`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, `touch`, `music`) are `IDENTICAL` against `main`, the `pnpm qa:live2d-rig` trial's `sha256` is unchanged, and `qa:test:model` passed in `pnpm verify --gate`.

### 1. Live2D Natural cleanup

Runs `cm8-touch-natural-cm8-1795340236116` (56 `mind` events) and `cm8-touch-natural-cm8-touchoff-1795345894542` (18 `mind` events). Evidence is the mind steps' scalar fields and the `situation` store's action calls.

| Trial | Gestures | Intents after the pet starts |
| --- | --- | --- |
| Hover pet | `pet-start`, `pet-end` | start: touch reaction and mood; end: touch reaction and moment, voice `hold` (`pet-short`); no spoken line |
| Held pet | `pet-start`, `pet-end` | the same as the hover pet |
| Pause during a held pet | `pet-start`, `pet-cancel` | only the hand release; no `pet-end`, mood, moment, line, or `observeTouch` call |
| Driver switched to Universal during a held pet | `pet-start`, `pet-cancel` | none; no `pet-end`, mood, moment, line, or `observeTouch` call |
| Touch turned off during a held pet, button released at once | `pet-start` only | none; the scene withdraws the hand without a report, so no `pet-end`, mood, moment, line, or `observeTouch` call |

A first touch-off trial that kept rubbing after the setting changed let the scene classify a new pet; its `pet-end` reached the situation (`observeTouch`) with no intent from the mind. That path predates CM8: the conductor does not gate the scene's reports on `touchReactions`. It is recorded as a follow-up, not a CM8 defect.

### 2. Live2D Universal and MAGIC

Runs `cm8-touch-upstream-cm8-1795345050995` and `cm8-touch-upstream-main-1795344506766` (the main checkout without CM8), each with a 45 s gap between drivers; the earlier pair `cm8-touch-upstream-cm8-1795344027538` and `cm8-touch-upstream-main-1795344285003` used a 25 s gap. The bridge's `configure` accepted both drivers and reported them. Each driver trial pressed the head three times, petted it, and tapped the body.

- Both trees produced 0 mind touch steps and the same store calls for each driver: one `avatar-touch.notifyTouch` and one `situation.ingest` of a `notify`, nothing else touch-related.
- With the 25 s gap, CM8 notified for both drivers while main did not notify for MAGIC. The avatar aggregator's 20 s cooldown sits near that gap, so the difference is timing; with 45 s the two trees match.
- Touch motions are not in the QA event log, so they were not compared. The upstream touch module and its tests are unchanged by CM8.

### 3. MMD Natural and classic

Runs `cm8-touch-mmd-cm8-1795345333716` (28 `mind` events) and `cm8-touch-mmd-cm8-touchoff-1795345698552` (14).

- Hover and held pets matched Live2D (`pet-start` and `pet-end` with the same intents; no line).
- Driver switched to classic during a held pet: `pet-start`, a `performer` step, then `pet-cancel` with no intent; no `pet-end`, mood, moment, or line.
- Touch off during a held pet: `pet-start`, then `behavior` steps with no intent and no `pet-end`. The first attempt formed no pet, so the second launch repeated only this trial.
- Classic: three taps and a pat produced no mind step and no situation touch observation.
- Pause was not staged on the desktop stage; its cleanup shares the classifier's `reset` path covered by `motion-driver-natural` `touch-gestures.test.ts` and `character-mind` `touch.test.ts`.

### 4. Notices

Runs `cm8-notice-1795342358252` (reach-outs on, 15 `mind`, 4 `turn`, 4 `tts` events) and `cm8-notice-1795343660809` (reach-outs off, 18 `mind`, 4 `turn`, 4 `tts`).

- A result is stored 3 to 12 ms after delivery, before any announcement.
- With a draft open, the gate reason was `user-typing`, no line spoke, and no model request was made. After the draft cleared, exactly one `notice` line ran and was `spoken` (one chat request and one speech request). With reach-outs off the announcement still ran.
- Do-not-disturb and a quiet app: the gate reasons were `dont-disturb` and `quiet-app`, the result was stored, and no line spoke. A result held by do-not-disturb was announced once do-not-disturb lifted, inside its five-minute start window; that is the designed hold, not a drop.
- Switching conversation dropped every pending request (0 pending), left the new result stored, and produced no reply.
- A full floor (`floor`) held the next result stored with no reply. The hourly cap was not staged; the `character-mind` voice tests and the `stage-shared` urge-gate tests cover it.

### 5. One action id, twice

Two concurrent deliveries and one later delivery of `terminal:<id>` returned the same receipt, left one stored message with that id, and produced no reply (the floor held it). At most one reply holds. The chat contract test for a repeated terminal delivery covers the announced case.

### 6. Reminders

Runs `cm8-reminder-1795343292745` (14 `mind`, 6 `turn`, 6 `tts` events, 0 errors) and the earlier `cm8-reminder-1795342892423`, which reported 2 renderer errors (a failed blob fetch of the imported display model about 10 s after import, before any reminder step; the rerun reported none).

- A critical reminder due in 100 s produced no mind step and no line during the first 75 s. It was ingested as context 60 s ahead; the earlier run's only pre-due lines were an ordinary `ritual` reach-out and a plugin notify, and the reminder spoke 1.2 s after its due time.
- With the gate held by an open draft, a plugin `immediate` notify ingested 4 s before due, and the draft released 3 s after due, the first line's stated reason was the task reminder and the plugin alert followed second.
- No further `task-reminder` ingest occurred in the next 100 s, past the 30 s requeue delay. The only later line was an ordinary `ritual` reach-out.

### Observations for later

- The devtools forced evaluation (`Evaluate now`) can start an ordinary reach-out while a notice waits, because forced timing bypasses the notice deferral. It is a development path; normal ticks defer to the notice.
- Diagnostic launches `cm8-notice-1795340892605`, `1795340951067`, `1795341268250`, `1795341635524`, and `1795341984886` found only harness issues (module lookup, stale sensors, a forced evaluation that charged the floor) and are not evidence.
