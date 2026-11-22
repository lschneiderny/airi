# character-mind-notify-touch - Work Plan

## Departures during implementation (CM8)

Implementation base: `9ed509e3b`, after CM7a and CM7c. CM7a's capability contract and CM7c's behavior document are present. Their ADRs and Departures sections were read. The orchestrator restored the initially empty performers plan and roadmap in `6cfffa858`; CM8 adds only its row to the restored roadmap. CM8 retains the null idle-drive cutoff, capability gates, settings replay, renderer scene inputs, and independent catalog publication the CM7 departures describe.

**D2 owner ruling (2026-11-21): option (a), binding.** Touch changes apply only under Natural. Universal, MAGIC, and classic retain upstream thresholds, hover recognition, reaction timing and count, touch-off behavior, and spoken touch lines. The original all-driver design below is superseded wherever it conflicts with this ruling. Overlap 11 closes only for Natural and stays open as kept for upstream drivers. CM7a's posture requirement is retained; CM7c's `touchReactions` permission remains Natural-only.

1. Reminder ranking: confirmed that only critical reminders were sent as immediate, and the 60-second look-ahead could admit them early. Provenance now comes from the notebook producer rather than its source string. Explicit requeue creates a revision and a new occurrence topic; delivery preserves its timestamp and revision. The notebook owns consumption beyond situation eviction. D2 forbids the proposed intermediate downgrade of upstream avatar notifies, so their urgency and pacing remain unchanged.
2. Stored notices: confirmed the runtime's existing-identity early return and the chat-owned receipt/cancellation coupling. Storage now precedes the send FIFO; the former queued-before-storage cancellation regression therefore moves to a held target load, and a post-storage duplicate joins the same completion. `commitUserMessage` already provides the durable identity receipt and needs no new session operation. The existing `storeMessage` operation saves a narrowed continuation intersection before execution, preventing a notice chain from regaining removed tools. Core-agent exports built `dist` files, so its build must precede consumer tests; the first host run exposed stale exports, and rebuilding repaired the actual production boundary without mocks or alternate imports.
3. Voice policy: confirmed that one discriminated `VoiceLine` crosses the pure mind and its host, and that the gate evaluates urgent and ordinary selection together. The gate now yields ordinary selection to an eligible notice without a second evaluation or draw; an ineligible notice request does not tick the ordinary gate. The shared budget retains ordinary attempt accounting and adds only spoken notices. To keep this contract commit buildable, its notice execution consumer and control fixtures land here, using item 2's real execution operation; automatic producers remain disconnected until item 4. A reserved line now holds Natural touch voice before the runtime reports generation, preserving body responses and preventing a simultaneous second speak intent.
4. Notice routing: confirmed that the terminal handler in `apps/stage-tamagotchi/src/renderer/stores/tools/mcp.ts` already answers `stored` from the receipt with `waitForCompletion: false` and owns only pre-storage cancellation. It needs no change, so this commit has no stage-tamagotchi diff despite the planned scope; the routed path is covered at the chat boundary it calls. A notice's mind turn id is its stored message id, which is also the runtime turn id, so cancellation, first-literal settlement, and the shared caller table use one key. Notice requests reuse the widget caller table for exactly-once settlement. Inactive or archived targets are store-only at acceptance rather than waiting five minutes to expire. Chat contract tests that expected immediate notice generation now establish a quiet leader mind; one new test proves store-only behavior without a mind. The background-task browser fixtures had no leader mind, so their notices are now store-only: the stop regression asserts the stored result, and the tool-bound regression leads a mind, checks the first announcement's real provider tools, then switches conversations and checks the stored chained authority without a second request. Its first failure also cascaded into the next file test through a still-running fixture task; both pass after the fix. Observed consequence: `generating` counts any session, so a running background task holds every announcement, as it holds reach-outs.
5. Natural touch (D2): confirmed that both scenes' `reset` paths (model swap, pause, touch-off, requireHold change, and Live2D or MMD driver change) reported a normal `pet-end` with its elapsed duration, so cleanup could dose, mark a moment, and speak late. The classifier now reports `pet-cancel`, and the mind closes only a pet it granted, without a draw. A normal pointer leave keeps the leave grace. Under D2 the planned unification is not implemented: `createLive2DTouchGestureTracker`, the aggregator and its cooldown, the avatar-touch store, and the upstream realisers stay; the commit title and scopes follow the narrowed change. The QA scenario sink, a `NaturalTouchGesture` consumer, maps the new kind to keep qa-tools building. MMDTouch's one-line mapping is covered by the classifier and mind tests, not by a new mesh fixture. Natural pacing already lived in the mind; a new regression proves that leaving and returning to Natural keeps the 45 s refractory.
6. Integration coverage: most planned regressions landed with items 1 to 5. This item adds the conductor-level cancellation path (no situation observation, moment, or line) and a repeated terminal delivery at the chat boundary (one receipt, one stored notice, one announcement). The planned stage-tamagotchi coverage is not separate: its handler is unchanged, and its receipt contract is exercised through `notifyConversation`. No rendered Electron scenario was added, because this worker may not run Electron and an unrun scenario is not evidence; the rendered matrix stays with the orchestrator in the ADR placeholder.
7. Agent guidance: `packages/stage-ui/AGENTS.md` no longer says notices bypass the mind; `packages/stage-ui-live2d/AGENTS.md` keeps the posture-declared selection, which remains true under D2, and adds the cancellation rule.

## Commits (CM8)

| Item | Commit | Title |
| --- | --- | --- |
| 1 | `8c05bf2ec` | `feat(stage-shared,stage-ui): rank notebook reminders by source and due time` |
| 2 | `e86605d8c` | `feat(core-agent,stage-ui): separate notice storage from response execution` |
| 3 | `fe7844cd9` | `feat(character-mind,stage-shared): admit owner results through the voice policy` |
| 4 | `6fc77ce05` | `feat(stage-ui): route notice announcements through the mind` |
| 5 | `758a5a941` | `fix(character-mind,motion-driver-natural,stage-ui-live2d,stage-ui-mmd): cancel Natural pets without a pet response` |
| 6 | `867a9a863` | `test(stage-ui): cover touch and notice lifecycle integration` |
| 7 | `249349b5e` | `docs(stage-ui,stage-ui-live2d): align touch and notice agent guidance` |
| 8 | This final documentation commit | `docs(character-mind): record touch and notice decisions and close CM8` |

The [CM8 ADR](../../docs/ai/adr/2026-11-22-character-mind-touch-notices.md) leaves an explicit placeholder for the orchestrator's headless and rendered results. No worker `qa:*` run, Electron launch, or rendered result is claimed.

## Checks during implementation (CM8)

Suites run separately with existing timeouts and thresholds. Headless and rendered acceptance belongs to the orchestrator; no worker `qa:*` or Electron run is claimed.

| Item | Command | Result |
| --- | --- | --- |
| 1 | `pnpm -F @proj-airi/stage-shared exec vitest run` | 96 files, 1,890 tests passed; this package has one unnamed Node project |
| 1 | `pnpm --filter "...@proj-airi/stage-shared" --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 28 packages, exit 0 |
| 1 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node` | Final run: 199 files, 1,979 tests passed |
| 1 | `pnpm -F @proj-airi/stage-ui exec vitest run --project browser` | Final run: 140 files, 1,024 tests passed, 5 existing skips |
| 1 | `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | 11 passed |
| 2 | `pnpm -F @proj-airi/core-agent build` | Exit 0; public runtime and declarations rebuilt |
| 2 | `pnpm -F @proj-airi/core-agent exec vitest run src/runtime/chat-orchestrator-runtime.test.ts src/runtime/chat-orchestrator-host-options.test.ts` | 248 passed |
| 2 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/features/notice/owner.test.ts src/stores/chat.contract.test.ts` | 131 passed after rebuilding the public exports; two later regressions are included in the full suite |
| 2 | `pnpm -F @proj-airi/core-agent exec vitest run` | 48 files, 913 tests passed |
| 2 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node` | 200 files, 1,985 tests passed |
| 2 | `pnpm -F @proj-airi/stage-ui exec vitest run --project browser` | 140 files, 1,024 tests passed, 5 existing skips |
| 2 | `pnpm --filter "...@proj-airi/core-agent" --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 11 packages, exit 0 after completing the public runtime interface and explicitly typing the self-referencing notice owner |
| 2 | `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | 11 passed |
| 3 | `pnpm -F @proj-airi/character-mind exec vitest run` | 12 files, 185 tests passed |
| 3 | `pnpm -F @proj-airi/stage-shared exec vitest run` | 97 files, 1,893 tests passed |
| 3 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node` | 200 files, 1,985 tests passed |
| 3 | `pnpm -F @proj-airi/stage-ui exec vitest run --project browser` | 140 files, 1,024 tests passed, 5 existing skips |
| 4 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/situation/index.test.ts src/features/notice/owner.test.ts` | 126 passed |
| 4 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/chat.contract.test.ts` | 129 passed |
| 4 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node` | 200 files, 1,990 tests passed |
| 4 | `pnpm -F @proj-airi/stage-ui exec vitest run --project browser` | First run: 6 failures in `chat-background-tasks.browser.test.ts`, which expected immediate notice replies; after the fixture changes the file passed 17 tests, and the full project passed 140 files, 1,024 tests, 5 existing skips |
| 4 | `pnpm --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 7 packages including the desktop app, exit 0 |
| 4 | `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | 11 passed |
| 5 | `pnpm -F @proj-airi/character-mind exec vitest run` | 188 passed |
| 5 | `pnpm -F @proj-airi/motion-driver-natural exec vitest run` | 29 files, 523 tests passed |
| 5 | `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node` | 46 files, 795 tests passed |
| 5 | `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project browser` | 6 files, 45 tests passed |
| 5 | `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node` | 49 files, 433 tests passed |
| 5 | `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser` | 7 files, 35 tests passed |
| 5 | `pnpm -F @proj-airi/qa-tools exec vitest run --project node` | 67 files, 880 passed, 9 existing environment-gated skips |
| 5 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node` | 200 files, 1,990 tests passed |
| 5 | `pnpm --filter "...@proj-airi/motion-driver-natural" --filter "...@proj-airi/character-mind" --filter "...@proj-airi/stage-ui-live2d" --filter "...@proj-airi/stage-ui-mmd" --filter "...@proj-airi/qa-tools" --workspace-concurrency=2 typecheck` | 11 packages, exit 0 |
| 5 | `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | 11 passed |
| 3 | `pnpm --filter "...@proj-airi/character-mind" --filter "...@proj-airi/stage-shared" --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 28 packages, exit 0 after typing two lint-rewritten cap fixtures as `number[]` |
| 6 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance/use-stage-performance-conductor.test.ts src/stores/chat.contract.test.ts` | 229 passed |
| 6 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node` | 200 files, 1,992 tests passed |
| 6 | `pnpm --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 7 packages, exit 0 |
| 7, 8 | `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | 11 passed; documentation and agent guidance only |

Rows are grouped by item; an earlier row number may follow a later one. Item 1's first stage-ui Node run found one remaining fixture on the retired `critical` field. It was migrated to plugin provenance; the next run passed all 1,978 tests. The final refusal regression adds one more case. Changed TypeScript passed ESLint; one existing comment-length warning remains in an unrelated chat-contract test comment.

## Rendered acceptance (CM8)

Rendered runs on macOS, with 0 renderer and 0 main-process errors in every launch except one reminder launch (2 renderer errors from a failed model blob fetch after import; its rerun had none). Details, run directories, and event counts are in the [CM8 ADR](../../docs/ai/adr/2026-11-22-character-mind-touch-notices.md#rendered-acceptance-cm8). No product bug was found.

- Live2D Natural: hover and held pets end with `pet-end`; pause and a driver switch during a held pet give `pet-cancel` with no mood, moment, line, or situation touch; touch-off withdraws the hand silently.
- Live2D Universal and MAGIC: no mind touch steps, and the same avatar notify calls as main once the runs were spaced beyond the 20 s cooldown.
- MMD Natural: the same cleanup for driver switch and touch-off; MMD classic produced no mind step. MMD pause was not staged.
- Notices: stored in milliseconds; held by an open draft (`user-typing`), do-not-disturb, a quiet app, and the floor; dropped on a conversation switch; one announcement after the draft cleared, with reach-outs off. The hourly cap was not staged.
- A repeated terminal action id gave one receipt and one stored message. A critical reminder stayed silent before due, outranked an immediate plugin notify at due, and did not repeat after the requeue delay.
- Open: the headless rig checks, a touch-off follow-up (a held button still classifies a new pet), and the devtools forced evaluation that can pre-empt a waiting notice.

Status: planned on 2026-11-21. Evidence checked on 2026-11-22 against `main` at `92ee63665`, which contains upstream `bd4f30391`. Planning branch: `luke/feat/character-mind-notify-touch`. The owner's standing preference is to take the recommended options. That preference does not silently reverse the explicit ruling that Universal, MAGIC, and classic stay as upstream ships them; D2 below requires an explicit owner decision before its implementation.

This planning delivery contains two implementation slices. This file specifies proposed roadmap row **CM8**, overlaps 11 to 13 of [Autonomous behavior](../../docs/ai/context/autonomous-behavior.md). [character-mind-store-tiers.md](character-mind-store-tiers.md) specifies proposed row **S2**, State persistence Target rule 3. Neither row exists at the evidence revision. Add the rows when their implementation starts, with the dependencies and Done-when below. This planning commit changes no current-policy claims or product code.

Format reference: the finished `.omo/plans/character-mind-beat-lock.md` at `origin/luke/feat/character-mind-beat-lock`, because that file is absent at this branch's base. Coordination reference: `.omo/plans/character-mind-performers.md` at `origin/luke/feat/character-mind-performers`, particularly sections 2.1 to 2.7, 3.1 to 3.4, and 12.

## TL;DR (For humans)

**What changes:** One pointer recognizer reports pokes and pet spans on Live2D and MMD, regardless of motion driver. Natural keeps its coordinated body, mood, face, and occasional line. Universal and MAGIC keep upstream's additive reaction and authored touch motions as the visual realisers, but receive the common classified gesture and common spoken-reaction pacing. Classic gains touch observations and occasional voice, with no Natural body or face intents. This changes recognition, timing, and settings under the upstream drivers and needs D2's explicit approval.

Background results are saved immediately as notices in their original conversation. Their spoken follow-up waits for the mind to admit it. Because the owner started the work, an owner-result notice does not require the reach-out switch or an urge draw. It does respect do-not-disturb, quiet apps, the other hard suppressors, the floor, and the hourly budget. The model can decline. A held result remains readable even if no spoken follow-up ever runs.

Touches stop becoming urgent Spark Notifies. Notebook reminders gain explicit source, due time, and rank; only a genuinely due critical reminder takes the urgent route. Plugin urgency keeps its existing meaning. A scheduler source string supplied by a plugin cannot grant local-reminder authority.

**Why:** Driver changes currently change both touch vocabulary and speech cadence. Notices have no admission into the voice slot. Notify reduction discards the information needed to distinguish an urgent plugin event from touch and a scheduled reminder.

**Size and risk:** CM8 is large enough for several buildable commits, with a runtime boundary change for notices. S2 is independent and smaller than the Known gaps list suggests: nearly all listed stores are upstream-owned. It migrates only fork-owned fields, and records upstream exceptions honestly.

## 1. Upstream first

The baseline already contains the 2026-11-21 sync through `bd4f30391`; ancestry was checked locally. This is a pinned source review, not a claim about an upstream revision fetched later. Before implementing either slice after another sync, compare these named files against the newly adopted upstream version and adjust this plan.

The README's **Kept from upstream** projects are a separate boundary from upstream-origin files inside supported packages. No change is planned to those kept projects, including `services/computer-use-mcp` and `packages/agents`. Supported client packages may carry the explicitly named departures below under ADR decision 14. That permission does not itself override ADR decision 7's product ruling about the upstream drivers.

| Upstream behavior and file | Treatment in CM8 |
| --- | --- |
| `packages/stage-ui-live2d/src/composables/live2d/touch.ts`: pressed taps and repeated pats, touch impulses, authored motion-group lookup | Subject to D2, retire the tracker and its unused recognition types/tests. Keep the additive reaction calculations and authored motion-group selection. They consume a small translation from the common report. |
| `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`: pointer capture, immediate press reaction, pat emission, tap release motion | Subject to D2, remove the competing pointer recognizer and report stream. Keep pointer ownership/cancellation in one scene input path and invoke upstream realisers from classified reports. Immediate raw-press feedback becomes recognized-poke feedback. |
| `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`: model hit geometry, `react`, `playTouchMotion`, and the fork's Natural input path | Use one input path and common recognizer. Keep renderer geometry and upstream reaction methods; expose the report and the minimal upstream realisation entry point. |
| `packages/stage-ui-mmd/src/components/scenes/MMD.vue` | Enable the existing geometry/classifier for classic as an observation source; still issue no Natural body, gaze, face, or posture intent there. There is no upstream MMD tap/pat realiser to preserve. |
| `packages/stage-ui/src/components/scenes/Stage.vue`, `src/libs/avatar-touch/notify.ts`, `src/stores/character/avatar-touch.ts` | Remove the avatar-notify aggregator and its 20-second per-region cooldown after their last caller is gone. Wire the single report stream to the conductor. |
| `packages/stage-ui/src/stores/chat.ts`: `notifyConversation`, `runBackgroundTask`, the send queue | Keep background recipes and their result text. Replace notice admission with wiring to the fork-owned notice module and the voice port. Do not put voice timing in chat. |
| `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` | Add a narrow way to answer an already committed notice, reusing the ordinary execution path. Preserve stored notice attribution, its silence option, and assistant `proactive` metadata. No voice policy enters core-agent. |
| `packages/stage-ui/src/stores/chat/session-store.ts` | Reuse `commitUserMessage` and the durable, identity-based receipt. Change only if the narrow stored-notice execution contract needs an owner operation that is not already public. |
| `apps/stage-tamagotchi/src/renderer/stores/tools/mcp.ts` | Preserve the terminal outcome's immediate durable receipt and cancellation boundary; update wiring/types only if necessary. Do not change main-process terminal approval or the kept computer-use service. |
| `packages/stage-ui/src/stores/character/orchestrator/store.ts`, `src/stores/character/notebook.ts` | Preserve the notebook and ticker. Retain stable task identity; carry due time and priority into a trusted local observation rather than treating its wire urgency as the speech policy. |

The fork-only mind, situation reducer, reason collector, gate, conductor, and Natural classifier hold the new policy. Update the ledger's Touch on Live2D and Background task, scene, and notice turns rows, and add the reminder-ranking departure in the same commits as behavior changes.

## 2. Today's code and findings

### 2.1 Four driver gates, two recognizers

| Reader | Current decision |
| --- | --- |
| `Live2D.vue`, `touchGesturesActive` | Runs `createLive2DTouchGestureTracker` only when `live2dMotionDriver !== 'natural'`. |
| `live2d/Model.vue`, `touchActive` | Runs `NaturalTouchGestures` only when Natural is selected, the Natural `touch` setting is on, and the model is not paused. |
| `Stage.vue`, `onAvatarTouch` | Sends the upstream touch report to `createAvatarTouchAggregator` only outside Natural. |
| `StagePerformanceConductor.touch` | Returns before observing or stepping the mind outside Natural. |

MMD also has a `touchActive` driver check. Its `MMDTouch` in `packages/stage-ui-mmd/src/composables/mmd/touch/touch.ts` already uses `NaturalTouchGestures`, with posed analytic colliders and a mesh-raycast fallback. It emits no classic touch today.

The trackers do not have interchangeable thresholds:

- `NaturalTouchGestures` measures in head/model widths. A poke allows 400 ms and 0.05 widths; hover mode commits a still press after 90 ms. A pet needs 0.35 widths in a 1.5-second trail, at least half its time inside the head, and one reversal for hover pets. It has wider exit margins, 600 ms idle expiry, 250 ms leave grace, and an optional held-only mode. It reports `poke`, `pet-start`, and `pet-end` with duration.
- `createLive2DTouchGestureTracker` measures CSS pixels. It recognizes a release within 450 ms and 8 pixels as a tap, and each 70 pixels of held head travel after a 120-degree turn as a pat. Its direction segments are 8 pixels. It reports neither pet lifetime nor duration.
- Upstream's scene starts a body impulse on pointer-down before a tap is known, then starts the model touch motion only on a recognized release. Natural's scene shows nothing until the mind grants it. Merely renaming `tap` to `poke` would preserve two recognizers and would lose the duration needed by the common voice rule.

### 2.2 Two speech routes

Natural's `answerTouch` runs `reactionPolicy` on the mind's clock and seeded source. It records a poke or finished pet through `observeTouch`, emits body/mood/moment intents, and occasionally emits a `reaction` line. `ReactionMemory` belongs to the conversation and resets when its session changes. It survives stage remounts and driver switches because the mind outlives the stage.

`REACTION_REFRACTORY_MS` is 45 seconds after a spoken reaction; `REACTION_RETRY_MS` is 20 seconds after an attempt. Pets shorter than 3 seconds, the first counted pet, or pets within 20 seconds of another character line are silent. Pokes need a burst of three in 10 seconds, rolled once. Probabilities are 0.3 for an eligible pet and 0.8 for an eligible poke burst. Those are the existing rule, not new tuning.

The upstream route collects a burst after 1.5 seconds of quiet, uses a leader-owned 20-second cooldown per region, and emits `character:avatar-touch` with urgency `immediate`. It enters the ordinary notify reducer and urgent gate route. The Natural `touch` setting does not gate it.

### 2.3 Notices, including the caller absent from the policy prose

`notifyConversation` currently invokes `startSend(..., { notice: { source } })` directly. It checks that the target exists and has no scene binding, but it does not consult the voice slot, presence settings, floor, or hourly cap. `runBackgroundTask` invokes it for non-empty success and failure results. A cancelled background task does not announce a result.

There is another production caller: `apps/stage-tamagotchi/src/renderer/stores/tools/mcp.ts` handles `terminalOutcomeNotice`, gives it the stable message id `terminal:<actionId>`, and waits with `waitForCompletion: false` for a **stored** receipt. Its abort signal controls admission only until that receipt. `continueFrom` intersects the exact source turn's stored tool references with the current allowed selection; missing loaded history grants no restricted tools. The existing Node chat contract tests and background-task browser tests cover this. A plan that simply waits at the gate before storing the notice would delay or break this terminal delivery contract.

`commitUserMessage` is identity-based and acknowledges durable persistence. In core-agent, the ordinary send path returns without generating when that commit says `existing`. Therefore storing first and then calling today's `startSend` with the same id would produce no reply. The stored-notice execution operation must explicitly account for this, rather than weakening duplicate-send protection for every send.

The runtime lets a notice stay quiet and stores a visible reply as proactive. Notice user messages are excluded from owner-turn sensors. Background and scene turns do not speak. These distinctions must survive the new route.

### 2.4 What the gate actually limits

`evaluateUrgeGate` checks hard suppressors, then urgent notifies, then a due double text, then the ordinary timing holds. Hard suppressors include disabled reach-outs, do-not-disturb, hidden stage, away/unknown presence, stale desktop/foreground samples, user speech/typing, character speech, generation, queued sends, busy states, quiet apps/calls, and games when disabled. Urgency bypasses only the game hard hold, then bypasses the ordinary timing path.

`FLOOR_MS` is 120 seconds and `SAFETY_CAP_PER_HOUR` is 4. The cap's `fires` currently counts ordinary gate attempts, not all audible lines. Urgent fires do not add to it. `recordExternalSpeech` updates `lastFireAtMs`, `lastSpokenAtMs`, and clears a double text; it does **not** add a cap entry or an unanswered opening. Today spoken reaction and widget outcomes use it; notices do not. Applying that function alone would fix the floor but would not make notices obey the cap.

Widget requests also deliberately differ from reach-outs: they wait for the shared busy state but ignore reach-out hard settings and timing. CM8 does not reinterpret that accepted CM3b policy.

### 2.5 Rank information is lost before `VoiceView`

`notifyObservationFrom` keeps `sourceKey`, `eventId`, urgency, reminder, and critical flags. `applyNotify` uses those to choose a salience variant, then stores a generic `notify` event with text and a topic key. The reason collector infers `urgent` from initial salience at least 1. `pickUrgent` chooses highest decayed salience, then source event id. `VoiceView` contains this reduced situation; it does not independently restore source or rank.

The Known overlaps prose overstates reminders: `enqueueDueTasks` sends **critical** tasks as `immediate`, all others as `soon`. It looks up tasks due within 60 seconds, so a critical reminder may currently enter the urgent route before its due time. The 30-second scheduler requeue uses the same task `eventId`; the reducer deduplicates by topic while the event remains in its bounded history. Dedupe is not a guarantee against another announcement after eviction.

### 2.6 CM7 owns the driver boundary

CM7a replaces the conductor's `driver` option with capabilities, checks capabilities before decisions, reports refusals, restores upstream face routing, and stops the fork's director under classic. CM7b owns seeded expression picks and reports. CM7c owns the behavior document, the unified `touch` setting, screen-awareness/Presence settings, editable mapping weights, and the conversation-register decision. CM7d owns Live2D channel composition.

CM8 depends on **CM7a and CM7c**, plus the completed CM3b/S slices and the current upstream sync. It does not duplicate any of those changes. CM7a's draft currently says "no touch reaches the mind without posture" and makes the scene's input gates read capabilities. CM8 deliberately revises that one assumption: **recognition and voice observation do not require posture; performer intents do**. Keep CM7's capability type, `NO_CAPABILITIES`, refusal reporting, seeded picker design, and frame gates. Issue no undeclared intents just to have the conductor drop them.

If CM7's recommendation changes, reconcile this interface before CM8 starts. Do not copy the draft capabilities into a second CM8 abstraction.

## 3. Design

### 3.1 One recognizer, renderer geometry, separate realisers (D2, D3)

Reuse `NaturalTouchGestures` as the one implementation. It is already renderer-neutral and shared with MMD; its package/name does not require Natural motion to run. Keep it in `motion-driver-natural` for this slice, with documentation that the classifier serves all drivers. A package relocation adds no needed behavior here. Do not copy either tracker into a third implementation.

Each mounted model has one classifier instance, one pointer owner, and one normalized report stream. Live2D keeps its existing visible-bound/head geometry and model-space conversion; MMD keeps its existing collider/raycast geometry. No per-driver thresholds are introduced. The renderer's existing `touchPetRequiresHold` remains a realisation/input setting after CM7c. CM7c's common behavior `touch` switch gates touch recognition under every driver.

| Driver | Body and face | Voice |
| --- | --- | --- |
| Natural, Live2D and MMD | Existing single `answerTouch` decision: body, mood, moment, attend, under CM7's declared capabilities | Common `reactionPolicy`, once per poke or finished pet |
| Universal and MAGIC | Translate a recognized poke to upstream `react(tap)` and `playTouchMotion(region)`; translate a pet start to one upstream `react(pat)`. Keep impulse math and authored groups; no Natural intents | The same touch observation and `reactionPolicy`; no Spark Notify |
| Classic | No new body or face effect and no director activation | The same observation and occasional spoken reaction |

A sustained upstream-driver pet becomes one recognized span and one additive start pulse, rather than another pulse every 70 pixels. A poke effect starts on recognition instead of raw pointer-down. Hover petting, scale-relative thresholds, and the touch-off switch now work under those drivers. Those are explicit D2 behavior changes; this plan does not call them "upstream unchanged".

In `answerTouch`, keep the one coordinated step for Natural. Guard only performer-specific effects by the capabilities CM7 installed. Always evaluate the voice part for an eligible report with a voice view, including `NO_CAPABILITIES`; do not manufacture posture capabilities to obtain a line. The common situation touch observation feeds character state once. Natural's body/mood tuning and pet "melt into the hand" ruling remain unchanged.

After wiring every caller, remove `createLive2DTouchGestureTracker`, `createAvatarTouchAggregator`, `createAvatarTouchCooldown`, `toAvatarTouchSparkNotify`, the avatar-touch store, their obsolete exports, and their replaced tests. Keep upstream hit-test helpers only where an actual caller remains. The public stage-ui stores forwarding barrel remains; remove just its retired avatar-touch export.

### 3.2 Pacing, cancellation, and exactly one observation

Use the existing 45-second spoken refractory, 20-second attempt retry, pet eligibility, poke burst, and probabilities on every driver. Changing drivers must not reset `ReactionMemory`. Changing the actual conversation still does, as today. This is one touch pacing rule, not an assertion that widgets, touch, and ordinary reach-outs have identical eligibility.

Keep the reaction hard holds: reach-out permission, do-not-disturb, stage visibility, voice/channel occupancy, and quiet apps. A touch still proves current presence and therefore skips stale/away sensor holds just as today's reaction policy does. A spoken reaction starts the ordinary reach-out floor through its outcome. Do not add the ordinary two-minute floor to touch eligibility in this slice.

Pause, touch-off, model replacement, unmount, lost pointer capture, and driver changes release pointer ownership and clear transient classifier/realiser state. End a granted Natural pet so the hand cannot remain stuck, but mark this as cancellation/cleanup rather than a completed pet eligible for a line. Use an explicit cancellation report or terminal reason on the common report, tested through the public contract; do not encode cancellation as a zero-length normal pet. A normal pointer leave still gets the existing leave grace. Cancel queued upstream impulses on entry to Natural. No gesture may finish after a model/driver swap and speak late.

Only the leader's connected mind admits voice. The scene observes a physical gesture once; it must not also ingest a notify. If a second live stage is introduced later, its cross-window transport and arbitration remain the mind ADR's follow-up, not an Eventa transport invented here.

### 3.3 Owner-result notices enter the voice policy (D4 to D7)

Separate the durable result from the optional announcement:

1. **Store once.** `notifyConversation` delegates to a cohesive fork-owned module in `packages/stage-ui/src/features/notice/`. Validate the existing-session/owner-session condition and capture session id, character id, session generation, source, message id, and the restricted continuation references. Commit one notice through `commitUserMessage`. Aborting before commit settles as not accepted; after commit the old caller's abort no longer owns it. Duplicate delivery returns the existing receipt and creates no second announcement.
2. **Acknowledge.** `waitForCompletion: false` resolves the existing `{ sessionId, messageId }` receipt immediately after storage. The terminal handler still answers `stored`, even if speech is held. The default wait resolves after this notice's announcement outcome or store-only decision; it does not wait forever.
3. **Ask the mind.** Queue a typed notice request through the leader's existing voice port. The pure request carries identity, deadline, and policy inputs, not functions, tools, or a replicated chat record. The host keeps the stored text and continuation data. Add a `notice` line to the mind's existing discriminated voice contracts; do not masquerade it as a widget.
4. **Admit.** A notice is an owner-requested result, not a fresh conversational opening. It skips only `unpromptedEnabled`, chattiness/urge draws, unanswered-opening backoff, and the ordinary awaiting-reply hold. Apply the remaining `hardReason` checks with the explicit owner-result permission, including do-not-disturb, quiet apps, games, presence, freshness, and busy states. Apply the shared floor and cap before opening its line. Do not label it urgent to bypass them.
5. **Execute.** Only the voice port calls the narrow `submitNotice`/stored-notice execution operation. The runtime reuses send preparation and the ordinary generation machinery, but answers the exact stored notice without committing a duplicate trigger. It verifies that message id, notice source, session, and generation still match. Existing duplicate sends keep their early-return behavior. The request uses the session's character and the same composer; it keeps the notice prefix and explicit model veto. No new prompt segment is needed.
6. **Settle once.** A first literal or a spoken result records one notice outcome, starts the floor through `recordExternalSpeech`, and consumes one entry of the user's hourly budget. Declined/cancelled/failed/refused attempts consume no notice speech entry and no unanswered opening. Record the first literal only once; the completion callback must not charge again. Body cues are sent only to a performer that CM7 permits.

Use one small pure budget check shared by the urge gate and notice admission, preserving the urge gate's existing attempt accounting. `fires` then counts ordinary gate attempts plus spoken owner-result notices; document that precise meaning. Do not silently change widget, urgent-plugin, or touch cap accounting. Since only one line runs, a notice needs no speculative cap reservation while waiting. The user's floor/cap remain shared across character switches, with the current hourly-fire restart-on-launch rule unchanged.

**Freshness and target (D6).** A notice waits at most five minutes from durable acceptance, measured by the mind's clock, then becomes store-only. This is a named initial policy value, not borrowed from the widget's 30-second caller deadline. Do not replay pending announcements after restart. A character/session switch, archive, reset, deletion, leadership loss, or a newer owner turn in the target conversation makes the pending announcement store-only; a newer owner turn already receives the stored result in its history. An inactive or archived target stores the result but does not start an announcement. Never speak another character's result through the active mind, change the selected conversation, or copy it into the active one.

**Terminal continuation (D7).** Recheck the original loaded source-turn references and the current request selection at execution. Queuing cannot broaden permissions, and a chained notice cannot restore a tool removed in the earlier intersection. Preserve recipe prohibitions and the rule that notice text is not owner text for memory authority. Do not replay a provider turn after tool execution starts.

Pending notices live only in leader memory; stored notices remain in the existing tier 4 chat repository. No durable queue, storage key, or second persistence owner is introduced. The host resolves every waiter on cancellation, reset, teardown, and failure. The mind stores no promises, abort controllers, or runtime clients.

### 3.4 Source and rank are explicit (D8, D9)

Keep protocol compatibility at the boundary. The server's `spark:notify` shape does not need to change. Add internal typed provenance to notify observations/events/reasons, populated by trusted client producers. Do not overload the existing situation `origin: world | self`, and do not parse topic-key text to recover policy.

| Input | Source and rank | Admission |
| --- | --- | --- |
| Classified touch | Existing typed `touch` observation; local avatar interaction | `reactionPolicy`, never an urgent notify or an ordinary opening reason |
| Owner-result notice | Typed `notice` voice request, original session/message identity | Deterministic result admission in section 3.3; not a situation urgent candidate |
| Notebook critical task, at or after its due time | Trusted local `task-reminder`, critical rank, task id and effective due time | Urgent candidate; existing urgent hard-hold/game exception remains |
| Notebook critical task before its due time, or noncritical task | Trusted local `task-reminder`, scheduled rank | Can be context before due; becomes a `due` reason at the due instant and uses the existing due hazard, floor, cap, and unanswered rules. Never an urgent timing bypass merely because it is within the 60-second look-ahead. |
| Plugin notify | Plugin provenance plus validated `immediate`, `soon`, or `later` | Preserve existing plugin urgency; `immediate` is urgent, others enter ordinary selection. Plugin-supplied task-looking source/payload cannot become a trusted local task. |
| Widget request | Existing typed widget request and deadline | Keep CM3b semantics; do not treat it as a notebook reminder or notice. |

The scheduler builds its trusted reminder observation directly from the notebook record. Generic `notifyObservationFrom` classifies external inputs as plugin provenance even when the string source is `character:task-scheduler`. The source key still identifies the sender for topic keys, privacy filtering, and diagnostics.

Carry `dueAtMs` and priority through reduction into `VoiceView`. For a queued task with no `dueAt`, use its stable creation time as the effective due time, not a moving `now`. Preserve a reminder's original event timestamp through requeue and update its due/priority metadata when the same task is rescheduled. The gate ranks eligible critical reminders before ordinary immediate plugin notifies, then earliest due time, then stable task id; among plugin urgent candidates preserve decayed salience and the existing stable tie-break.

After a reminder's one attempt settles, mark that scheduled occurrence addressed for all outcomes, including a model decline. The scheduler's 30-second requeue is delivery bookkeeping, not another permission to ask the model. Track the addressed occurrence in the existing runtime notebook task state, using task id plus a schedule revision changed only by explicit scheduling/requeue actions; `markTaskNotified` must not increment that revision. Completion/drop invalidates its pending reason. No new task persistence is introduced. A genuine reschedule creates a fresh occurrence; event-buffer eviction alone does not.

### 3.5 Voice arbitration and starvation

Do not preempt an already running line. User turns keep their existing right to cancel unprompted work. Preserve widget deadlines and busy gating. At an idle slot, retain waiting widgets first, then an eligible urgent candidate, then an eligible owner-result notice (oldest accepted first), then ordinary gate selection. A held notice does not block the urge gate wholesale; its topic is held only from duplicate selection. Ordinary work still sees the same hard/budget holds. Touch is event-driven and is refused while a line is open; it never accumulates into a deferred touch queue.

Splitting urgent selection from ordinary gate evaluation must preserve the ordinary RNG draw sequence and avoid evaluating/accruing the gate twice in one tick. Use the existing collector and urgent picker through a cohesive gate result, not a parallel ranking implementation. Test simultaneous widget/urgent/notice/touch arrivals explicitly.

## 4. Where the code lives

Paths below are the implementation allowlist by responsibility, not authorization to rewrite their unrelated systems.

| Paths | Responsibility |
| --- | --- |
| `packages/motion-driver-natural/src/touch-gestures.ts`, its Node tests | Common classifier contract and cancellation; preserve Natural thresholds |
| `packages/character-mind/src/{types,touch,voice,step,index}.ts`, corresponding tests | Voice-only touch under empty capabilities; notice admission, deadlines, one slot, outcomes |
| `packages/stage-shared/src/situation/{types,reducer,gate,urge-gate}.ts`, `reasons/{types,collect}.ts`, corresponding tests | Typed notify provenance and due metadata; common budget check and ranking |
| `packages/stage-ui/src/features/notice/` (new cohesive module and Node tests) | Stored result, waiter lifecycle, exact target/epoch, continuation data |
| `packages/stage-ui/src/stores/{chat,character-mind}.ts`, `stores/situation/index.ts`, `stores/situation/sensors/notify.ts`, `composables/performance/{mind-voice,use-stage-performance-conductor}.ts` | Thin host wiring, chat controls, routing and stale-outcome handling. Chat payload contracts currently live in `chat.ts`; `SituationChatControls` lives in the situation store. |
| `packages/stage-ui/src/stores/character/{notebook,orchestrator/store}.ts` | Trusted task provenance, stable occurrence, delivery/attempt distinction |
| Live2D and MMD scenes and touch modules named in section 1 | One report stream, lifecycle, upstream realisation translation |
| `packages/stage-ui/src/libs/avatar-touch/notify.ts`, `stores/character/avatar-touch.ts`, their tests/exports | Delete the retired notify path after cutover |
| `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`, its Node tests | Execute the exact precommitted notice with existing send machinery |
| `apps/stage-tamagotchi/src/renderer/stores/tools/mcp.ts`, its tests | Durable terminal receipt and continued tool-selection constraints |
| `packages/stage-ui/src/composables/performance/use-motion-qa-events.ts`, situation observability, `packages/stage-shared/src/motion-scenario/` | Scalar source/rank/admission/outcome evidence; never notice text |
| `packages/scenarios-stage-tamagotchi-electron/src/scenarios/`, its README, affected scene stories | Reusable rendered acceptance where a second run warrants it; use existing app/session helpers |

Do not add a dependency, a new cross-process event system, or a second settings document for touch. Shared component API changes update `ui-components.md` and the corresponding stories.

## 5. Work items and commit titles

Implementation branch: **`luke/feat/character-mind-touch-notices`**. Add roadmap CM8 as planned/in progress after CM7a/CM7c. Each numbered item is buildable and passes the implementation checks; documentation moves in the same item. Scopes name packages.

1. **`feat(stage-shared,stage-ui): rank notebook reminders by source and due time`**. Section 3.4 excluding removal of avatar notifies. Introduce trusted metadata, due selection, occurrence consumption, and Node tests. While the old touch route still exists, classify its local avatar source as ordinary low-rank context so it cannot use the urgent bypass; this is a bounded intermediate behavior removed by item 5, documented in the ledger. Update autonomous behavior, glossary, and the ledger in this commit.
2. **`feat(core-agent,stage-ui): separate notice storage from response execution`**. Preserve current immediate notice behavior through the new operation until item 4 connects policy. Commit result first, execute by exact stored id, preserve receipt/abort/tool intersection, and cover dedupe. Update the notice storage contract in LLM prompt and package READMEs.
3. **`feat(character-mind,stage-shared): admit owner results through the voice policy`**. Add typed notice requests/lines, common budget checks, deadline/target cancellation inputs, explicit arbitration, outcome accounting, and pure tests. No production notice enters it until item 4.
4. **`feat(stage-ui,stage-tamagotchi): route notice announcements through the mind`**. Wire the fork notice owner, situation controls, voice port, and terminal receipt. Remove direct automatic notice generation. Update current autonomous/LLM/glossary/ledger claims and close overlap 12 only after integration checks.
5. **`feat(character-mind,stage-ui,stage-ui-live2d,stage-ui-mmd): unify touch recognition and spoken pacing`**. After explicit D2 approval and CM7 integration, reuse the one classifier, capability-gate performer effects, retire the aggregator/cooldown/store, and update cancellation tests. Update current touch policy, glossary, body ownership, scene API docs/stories, and ledger; close overlaps 11 and 13 only with the complete cutover.
6. **`test(stage-ui,stage-tamagotchi): cover touch and notice lifecycle integration`**. Finish deterministic host-boundary regressions and reusable rendered scenario coverage not already colocated with items 1 to 5. Scenario README and QA docs move here. This is additional integration coverage, not a delay of regression tests until the end.
7. **`docs(stage-ui,stage-ui-live2d): align touch and notice agent guidance`**. Agent configuration only: remove the now-false "notices bypass the mind" and "touch never reaches the mind" statements, retaining the Natural-only performer rule. This separate commit belongs to the same PR.
8. **`docs(character-mind): record touch and notice decisions and close CM8`**. Add `docs/ai/adr/<implementation-date>-character-mind-notify-touch.md` and mark CM8 done after all acceptance below. Record the D2 exception to ADR decision 7 and the CM7a touch-input assumption; do not edit frozen ADR bodies.

If D2 is refused, items 1 to 4 still form useful notice/rank work, but **CM8 cannot be marked complete**. Record the narrower delivered row and leave overlap 11 open under the retained upstream behavior. Do not ship two recognizers and report the original scope done.

## 6. Tests (Node, deterministic, no DOM-heavy tests)

Use explicit time and seeded draws. Test the real policy and store integration at their owning boundaries. Do not mount settings pages to assert labels.

- **Classifier:** Same model-relative samples yield identical reports under every driver; different screen scales do not change the report. Pin hover reversal, held-only mode, 90 ms commit, drag rejection, pet margins, leave grace, missing head geometry, primary-pointer ownership, and one pet end. Cancellation, pause, model/driver switch, and touch-off produce cleanup with no spoken candidate. Preserve existing Natural classification expectations.
- **Mind touch:** Natural receives the original performer intents plus at most one line; empty capabilities receive voice only. The same view/seed and gesture sequence produce the same voice decisions under all drivers. Switching drivers within 45 seconds cannot evade refractory; session change keeps its existing reset semantics. No duplicate slow-state dose or Spark Notify.
- **Admission:** For every hard suppressor, assert notice held; for disabled reach-outs alone, assert owner-result notice allowed when floor/cap are clear. Assert no draw is spent for notice admission, no unanswered increment, exact floor boundary, cap entries shared across cards, and no cap charge for decline/cancel/failure/refusal. Include backwards clock normalization and a first literal followed by duplicate completion.
- **Arbitration:** A pending notice does not suppress an urgent plugin or already waiting widget. A widget's deadline still expires correctly. An ineligible notice does not drain urge or draw twice. A concurrent reaction finds the slot occupied and is refused; all caller results settle once.
- **Stored notice execution:** Commit-before-response, stable receipt while held, abort before/after receipt, duplicate terminal delivery, no double user message, existing-send dedupe unchanged, model decline, cancelled generation, tools-only result, failed result, and no notice for a stopped/empty background task. Reply uses the original session's character/composer and never reaches a scene session.
- **Targets and permissions:** Inactive/archived/different-character target is store-only; newer owner input consumes context without late announcement; reset/delete/demotion cancels pending work. Recheck the exact continuation intersection at execution and across a notice chain. Do not upgrade stored result text to owner/system authority.
- **Ranking:** Critical reminder at `dueAt - 1` is not urgent, at `dueAt` is urgent; normal/high/low reminders are due reasons. No-due tasks use stable time. Critical reminder beats immediate plugin, plugins preserve salience ties, a forged scheduler source is still plugin, requeue/eviction cannot repeat an addressed occurrence, explicit reschedule can. The local touch path creates no notify after cutover.
- **Host integration:** Keep `chat.contract.test.ts` assertions on durable receipts, async cancellation, and tool references. If an existing DOM-heavy test is touched, move logic coverage to Node with a named replacement and preserve every actual regression. Do not rewrite unrelated browser tests.

Inner loops use package configs: `pnpm -F @proj-airi/character-mind exec vitest run src/voice.test.ts src/touch.test.ts`; `pnpm -F @proj-airi/motion-driver-natural exec vitest run src/touch-gestures.test.ts`; stage-shared/stage-ui/Live2D/MMD/core-agent/desktop tests use their declared Node project where present. Resolve final filenames from each package config before execution; a no-tests-found result is not a pass.

## 7. Rendered and motion checks on macOS

These are implementation acceptance, **not checks performed by this planning task**. Before each implementation commit run `pnpm verify`; before landing run `pnpm verify --gate`. Keep at most three heavy checks active. Run policy guards whenever a context doc changes. Do not weaken a test or retune a motion gate to obtain a pass.

Use macOS directly, with **no `qa:display`**. Before driving the cursor, give the owner notice that the app will receive pointer input. Use a disposable profile, synthetic text, and replayed LLM/TTS. Read rig/model paths only from `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`; do not publish those values or recorded personal content. Use `qa:doctor`, `qa:smoke`, `qa:app`/`airi-qa`, and the existing `AppSessionCore` lifecycle; shut down every app session.

**Headless:** Run `qa:test:model` and `qa:live2d-rig`. Run `qa:motion3d affected` and the existing `touch`, `idle`, and `speak` scenarios with seed 1 and `--verify-determinism`. Existing already-classified Natural touch and no-touch motion must remain identical to captured pre-change traces; input recognition changes are tested separately. The headless runner does not prove hit testing. Keep baseline evidence before editing in the implementation checkout; this planning task creates no other worktree. Run `pnpm perf status` before and after the input/frame integration work.

**Rendered matrix:**

1. Live2D Natural, Universal, and MAGIC: poke head/body, hover pet, held pet, crossing the canvas boundary, drag away, touch-off, pause, and switch driver during a pet. Observe one report sequence, no stuck hand or late pulse, and zero avatar Spark Notifies. Under Natural the body/mood response remains; under Universal/MAGIC the retained additive impulse and authored group play from the classified report. Inspect at ordinary and reduced window widths and at two model scales; capture the touch overlay and real character.
2. MMD Natural and classic on the desktop stage: repeat poke/pet/off/switch cases. Natural has its original body reaction. Classic records touch and can produce the paced line while its director and Natural channels remain inactive. Inspect front and side views for hit-region correspondence and cancellation, without judging motion feel as an automated pass.
3. Keep touching across driver switches. Use fixed replay and controlled test time at the pure-policy boundary for exact cooldown proof; in the real app verify scalar decision/outcome events and that no second voice route fires. Do not add a production force-speak escape hatch to make the replay convenient.
4. Start a synthetic background recipe, then hold the chat draft while its result settles. The stored notice appears immediately and no new speech starts. Clear the hold with budget available: one follow-up can run and decline. Repeat with DND, quiet app, reach-outs off, floor active, and cap full. For the last two, stored evidence remains and admission follows the scripted boundary.
5. Deliver a synthetic terminal outcome twice with one action id while another line runs. Both calls receive the same durable receipt; only one notice and at most one subsequent line exist. Cancel before receipt and after receipt in separate cases, and verify the source-turn tool intersection without executing real terminal commands.
6. Switch conversation/card, archive the target, reset data, and close/reopen while a notice waits. No late announcement appears in the wrong session; the stored result follows the specified retention/deletion behavior.
7. Offer critical/normal reminders and immediate/soon plugin notifies together. Verify provenance/rank in the inspector, no critical early fire, stable ties, and no duplicate after scheduler requeue. A touch during the same window is never the urgent notify.

Every launch must have zero unexpected renderer/main-process errors. Store scalar event excerpts, counts, and screenshots in local QA output, not in commits. Record any intentional visible recognition change for later human motion review; scores and screenshots do not prove naturalness.

## 8. Docs that move with the code

- Items 1 and 5: `autonomous-behavior.md` Deciders, Precedence, overlaps 11 and 13; `glossary.md` Touch reaction, Spark Notify, Voice policy, Stimulus and the conflicting Touch usage; `upstream-policy.md` explicit departures. Correct the current "all task reminders are immediate" overstatement when item 1 lands.
- Items 2 and 4: `llm-prompt.md` Notice and Unprompted paths, durable notice versus trigger distinction, output/result semantics; `autonomous-behavior.md` notice admission and overlap 12; `glossary.md` Notice, including terminal results. Preserve existing privacy gaps as gaps unless this slice actually changes their code.
- Item 5: `body-ownership.md` only where the new input/realiser boundary changes its current statements; `ui-components.md` and stories for changed scene events; Natural/Live2D/MMD/stage-ui READMEs for public touch and lifecycle contracts.
- Item 6: scenario and QA READMEs, event field documentation; no private fixture content.
- Item 7: the two nested agent guides named above, in the separate agent-configuration commit.
- Item 8: a new dated ADR and proposed roadmap row CM8 with its actual PR/check evidence. Add the row at implementation start; move it to done only at acceptance. The ADR records decisions about upstream drivers, owner-result admission, ranking, cap accounting, cancellation, and the deliberate CM7a assumption revision.
- S2's own plan names all persistence documentation. CM8 does not claim State persistence rule 3 or CM7's rule 4.

## 9. Risks

| Risk | Required mitigation |
| --- | --- |
| Calling upstream impulse code unchanged hides a recognition behavior change | D2 explicitly names timing, hover, pulse count, classic voice, and touch-off; require the owner ruling and a ledger departure. |
| CM7 and CM8 both edit the same gates | Implement after CM7a/c; use their actual contracts; change only the touch input assumption, not capability architecture. |
| Durable notice plus duplicate-send guard prevents any reply | Add the narrow precommitted-notice execution contract and assert one stored message plus one optional reply. |
| Delaying terminal storage loses the receipt or old cancellation ownership | Commit first, return receipt independently, detach the old signal after storage. |
| Notice permissions expand while waiting | Capture and intersect exact source-turn references again; never infer permission from the notice text. |
| A full cap creates an announcement hours later | Five-minute start deadline, store-only outcome, no restart replay. |
| A newer owner turn gets an unsolicited stale reply afterward | Cancel that pending announcement; history already contains its result. |
| Repeated reminder delivery evades a bounded event buffer | Consume a stable scheduled occurrence in the notebook's runtime state, independently of event retention. |
| Storage repair or host cleanup accidentally lands in CM8 | Keep persistence in S2 and keep terminal service/approval code outside the allowlist. |

## 10. Follow-ups

- General archived-conversation admission for existing reach-outs/widgets remains the upstream ledger's owner question; CM8 resolves only its new notice path.
- Multi-stage touch arbitration and leadership hand-off remain the mind ADR's open questions.
- Touch threshold tuning, richer upstream pet visuals, renderer-neutral naming/relocation of the classifier, and human motion feel remain later work.
- General plugin urgency authentication/rate limits, persistent notebook scheduling, and task-result privacy filtering are separate policies. CM8 prevents a forged scheduler source from obtaining **local** rank, but does not change existing plugin urgency authority.
- S2 covers only fork-owned persistence gaps. It does not promise to remove every upstream plain ref.

## Must not do

- Do not implement D2 under an assumed approval, claim two recognizers are one, or call changed upstream-driver behavior unchanged.
- Do not give Universal, MAGIC, or classic Natural performer capabilities; do not reimplement CM7's settings or expression work.
- Do not turn touches into urgent notifications, turn ordinary reminder delivery into repeated speech, or let a queue block the voice policy behind itself.
- Do not make an owner-started task result count as an owner turn or an unanswered opening.
- Do not put timing policy in chat/core-agent, bypass the composer, weaken duplicate-send checks, or broaden terminal continuation tools.
- Do not introduce a persistent notice queue, extra clock, polling retry path, or second touch pacing memory.
- Do not edit frozen ADR bodies, kept-from-upstream projects, unrelated tests, or private user data.

## Done when

**CM8:** With D2 explicitly approved, one classifier and one reaction policy serve Live2D Natural/Universal/MAGIC and MMD Natural/classic. A physical touch yields one observation and no avatar Spark Notify; only declared performers receive intents. Every automatic notice reply is admitted by the mind with the owner-result exception precisely bounded, durable receipt and tool authority preserved, one voice slot, model veto, floor, and cap accounting. Reminder/plugin source and rank survive into `VoiceView`, and one scheduled occurrence cannot repeatedly prompt. Overlaps 11 to 13 are closed with current docs, a new ADR, and all Node/headless/rendered checks above passing or a real environmental blocker explicitly reported; an unexercised behavior is not a pass.

**S2:** See its independent [Done when](character-mind-store-tiers.md#done-when). It may land without waiting for CM8's owner decision.

## Decisions for the owner

The recommendations are the design above. Only **D2** requires a fresh owner ruling beyond the standing preference, because it reverses a specific previous upstream-driver product guarantee. Other visible choices are stated so they can be vetoed before implementation.

| # | Fork | Options | Trade-off | Recommendation |
| --- | --- | --- | --- | --- |
| D1 | Slice boundary | (a) One PR for touch/notice/persistence; (b) CM8 for behavior and S2 for fork persistence | One PR mixes voice contracts with a storage migration; separate PRs let S2 land while D2 is unresolved. | (b), two plans and two implementation branches. |
| D2 **OWNER RULING 2026-11-21; visible** | Natural-only touch changes | (a) Retain upstream tracker/pacing and leave overlap 11 open there; (b) common classifier/pacing for every driver; (c) give every driver Natural capabilities | The owner rejected changes to upstream thresholds, hover, timing/count, touch-off, and classic voice. | **(a), binding.** Natural alone changes. Upstream touch remains exactly as shipped; overlap 11 remains open as kept there. |
| D3 | Recognizer choice and home | (a) Extend upstream pressed-pat tracker with hover/lifetime; (b) reuse existing `NaturalTouchGestures`; (c) create a new generic tracker | (a) rebuilds Natural's existing behavior and risks its touch rulings; (c) adds a third implementation. (b) already serves both renderers and needs no new dependency or relocation. | (b); keep the implementation where it is for this slice. |
| D4 **visible** | Owner-result voice permission | (a) Treat as an ordinary reach-out; (b) treat as an explicit owner result, skipping reach-out enablement/urge/backoff but obeying hard quiet rules and budget; (c) use widget busy-only policy | (a) can make requested work inaudible solely because reach-outs are off; (c) preserves quiet-setting violations. (b) preserves the owner-started nuance and caps interruptions. | (b). |
| D5 **visible** | Notice floor and cap | (a) Only call `recordExternalSpeech`; (b) check floor/cap before admission and charge a spoken notice once; (c) make every voice source consume the same cap | (a) fixes only the floor. (c) changes accepted widget/touch/urgent policy beyond this scope. (b) extends the existing user budget precisely for notices. | (b), no unanswered-opening charge. |
| D6 **visible** | Delayed result delivery | (a) Queue before storage; (b) store first, announce within five minutes only for the still-current open target; (c) persist a cross-launch speech queue | (a) breaks prompt terminal receipts; (c) produces stale late announcements and adds a durable owner. (b) keeps the result available and makes speech best-effort without losing it. | (b); cancel announcement on target/owner-turn changes. |
| D7 | Runtime and tools | (a) Re-send the same stored id through today's path; (b) narrow execution of an exact committed notice with existing machinery; (c) convert to a tools-free generic unprompted trigger | (a) hits duplicate-send early return. (c) loses notice attribution and intended terminal continuation. (b) adds one explicit execution contract without weakening dedupe. | (b), preserve the restricted tool intersection. |
| D8 **visible** | Reminder rank | (a) Keep wire urgency as the whole policy; (b) typed local source and due time, due critical above immediate plugin, normal tasks as due reasons; (c) no reminder can ever interrupt | (a) makes early critical reminders urgent and loses source. (c) weakens explicit critical reminders. (b) separates relevance from urgency without changing plugin wire contracts. | (b). |
| D9 | Repeat reminder delivery | (a) Trust bounded situation dedupe; (b) consume each scheduled occurrence after one settled attempt; (c) keep retrying until she speaks | (a) repeats after eviction. (c) removes the model's veto in practice. (b) requires a small runtime occurrence marker but makes silence final until rescheduled. | (b). |
| D10 | CM7 ordering | (a) Recreate capability/settings gates here; (b) depend on CM7a/c and revise its touch-input assumption only | (a) duplicates in-flight work. (b) delays this cutover but keeps one owner for the boundary. | (b); S2 can proceed independently. |

No product implementation or runtime acceptance is claimed by this planning commit.
