# character-mind-gaze - Work Plan

Status: planned on 2026-11-20; not started. Roadmap row: step CM6 in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Rulings: the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md) (decisions 2 and 5), the [core ADR](../../docs/ai/adr/2026-11-18-character-mind-core.md) (D15: realisation details stay in the performers), the [return ADR](../../docs/ai/adr/2026-11-19-character-mind-return.md) (its "Not decided" item for CM6), the [idle ADR](../../docs/ai/adr/2026-11-20-character-mind-idle.md) (the report-and-order pattern this plan reuses), the [Live2D cursor attention ADR](../../docs/ai/adr/2026-10-24-live2d-cursor-attention.md) (D2: she does not always notice), and the [fullscreen stage and locomotion ADR](../../docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md). Branch: `luke/feat/character-mind-gaze`, cut from CM4b's tip `754e30da1` on `luke/feat/character-mind-idle` (PR #58). CM4b stacks on CM4a (#57) and the earlier character mind PRs, none merged. Step H is done and is in this branch. The PR's base is `luke/feat/character-mind-idle`. When a PR below merges, rebase this branch onto the new base and retarget the PR.

CM5a is planned and built on the unmerged branch `luke/feat/character-mind-music` (PR #59), which also stacks on CM4b. CM6 does not depend on it, and CM7 depends on both. This plan must not contradict CM5a; [section 6.1](#61-expected-conflicts-with-cm5a) lists the files both slices edit, so the later rebase conflict is expected.

The owner is away and runs these slices without a plan review. Every design fork below is taken on the recommended option and listed in [Decisions open to the owner's veto](#11-decisions-open-to-the-owners-veto). Where the owner must decide (a user-visible default, a removed behavior), the plan takes the conservative option and lists it under [Blocked: needs the owner](#blocked-needs-the-owner).

**Split (D1).** CM6 is split into two PRs, as CM4 and CM5 were.

- **CM6a, planned in full below: cursor notice and the attend window in the mind, and the press-miss fix.** It meets two of the three Done-when clauses: overlap 8 closed, and presses aimed at her no longer miss after she walks toward a resting pointer. It lands Body ownership Target rule 8 for locomotion toward the cursor only.
- **CM6b, in outline ([section 12](#12-cm6b-in-outline)): glances through the mind with one gaze arbiter, and the director's remaining raw inputs moved onto intents.** It meets the rest: overlap 7 closed, and Target rule 8 lands in full.

The two halves share no state. CM6a's work is the cursor: one decision (notice) in Natural's cursor layer and one (the chase window) in the director, both answering the same pointer. CM6b's work is every other glance caller (nine call sites in four modules, two of them, chat cues and ACT cue gestures, not yet stimuli of the mind) and the director's other raw inputs (away, chat unfold and send, drags, `performance.mode` and `attention`). Done together, the PR would touch Natural's gaze layer, all glance callers, the conductor, both scenes, the director, and the runner in one switch commit, which is the size CM4b's plan judged as its highest risk. Each half leaves one decider for what it moves, so the split keeps no compatibility path.

## TL;DR (For humans)

**What changes (CM6a):** The character mind decides when she notices the cursor. Natural still sees the cursor and tells the mind when a notice is possible and how far away the cursor is (near, medium, far). The mind draws the episode on its own seeded stream: whether she engages, how long her interest lasts, how long she takes to settle on it, and her cooldown afterwards. Natural plays the episode. The mind also decides that she attends to her user after a poke, a pet, a drag, or a sent chat message, and tells the MMD body director to keep the chase window open. The director walks toward the cursor only inside that window. A walk aimed at the cursor now ends at once when the cursor comes to rest on or next to her, and a visit no longer walks her away from a pointer resting on her.

**Why:** Autonomous behavior Target rules 4 and 5 and overlap 8: today Natural decides notice and the director decides the chase, separately, from the same pointer. The press-miss bug: during a 5 s pointer rest she walked 200 to 250 px toward the pointer's previous rest point, so a press aimed at her hit empty floor (`.omo/plans/linux-sensor-parity.md` todo 29).

**What does not change:** No engagement odds, interest span, dwell, cooldown, band distance, stop distance, linger, or gait constant. The chase window stays 60 s. Natural's tracking of the cursor (weight, rest fade, release) stays a frame matter in Natural. Live2D's Cursor attention setting, `aside`, and `screen` still dismiss attention in Natural. No new setting; no storage key changes. Glances, chat cues, and the director's other inputs wait for CM6b.

**Effort:** M. **Risk:** Medium. Item 3 changes `gaze-shift` traces on purpose; item 2 changes how she stops under a pointer, which a user can see.

## 1. Upstream first

Read from the tree at `754e30da1`. `upstream/main` is `b3a6d6071`, which the stack already contains, so no newer upstream commit touches these paths.

| Upstream has | Code | Fork difference |
| --- | --- | --- |
| MAGIC motion turns toward the cursor (`84df1c2df`, #3285) | `packages/stage-ui-live2d` MAGIC focus bias | Adopted under MAGIC only (roadmap sync table). CM6a leaves it untouched; Natural's cursor attention never runs under MAGIC |
| Universal eye tracking that follows the mouse | `packages/stage-ui-live2d` focus controller | Unchanged. It has no episodes and is not cursor attention (glossary) |
| The Live2D scene and model, the stage scene | `Model.vue`, `Stage.vue` | Fork-edited already for touch, idle, and the cursor setting. CM6a adds one report and one method on the same seams |
| No Natural, no body director, no character mind | None | `motion-driver-natural`, `motion-driver-humanoid` (director, locomotion), `character-mind`, the conductor, the MMD scene's stage mode, and `qa-tools` are fork-only |

Nothing upstream decides cursor notice or a walk toward the cursor, so `docs/ai/context/upstream-policy.md` gains no row.

## 2. Today's code

**Cursor notice is drawn in Natural.** `NaturalCursorAttention` (`packages/motion-driver-natural/src/cursor-attention.ts`) runs inside `NaturalMotion`'s 120 Hz grid on active seconds and draws from its own stream (`streamIndex.cursorAttention`, 13). Each step it maps the cursor (head widths from the eye anchor) to a band: near up to `nearDistance` (2), medium up to `farDistance` (6), else far. An opportunity is the cursor appearing, moving after a rest of `restHold` (0.6 s), moving while idle or ignored, or coming nearer than the running episode's band, each only when the cooldown is over and permission is `full`; a reopened permission with no episode also draws. `drawEpisode(band)` then draws, in this order: `engaging` (always for near; `engageMedium` 0.55 or `engageFar` 0.2 otherwise), `span` (infinite for near; `truncatedLognormal` around `interestMedian` within 0.8 to 8 s), `dwell` (0.25 to 0.5 s), and `cooldown` (4 to 10 s). The class then plays the episode: notice, engage after the dwell, the weight's capture and fade, release, and the cooldown. `NaturalMotion.integrate` turns the events into `gaze.orient`, `disengage`, `dismiss`, the pet override, and `notify({ kind: 'attention' })`, and a notice interrupts idle acts.

**Permission is decided around it.** Live2D passes `cursorDismissed: !live2dNaturalCursorAttention || performance.attention === 'aside'` (`Model.vue`, `natural-motion-adapter.ts`); `NaturalMotion` also dismisses for `screen` attention. MMD's adapter passes the cursor with no dismissed mode (`packages/stage-ui-mmd/src/composables/mmd/natural/adapter.ts`), so MMD has no setting.

**The chase is decided in the director.** `decideBody` (`packages/motion-driver-humanoid/src/director/index.ts`) chases while `interactionAtMs` is within `CHASE_WINDOW_MS` (60 s), the cursor is on the stage, and it is more than `CHASE_STOP_LEGS` (1) legs from the root. The goal is the cursor minus one leg toward her (`approach-cursor`). The MMD scene stamps `interactionAtMs` on its director clock for a poke and a pet start (`reactToTouch`, after the mind's touch answer), a drag release (`props.interactionSeq`), and a sent chat message (`props.chatActivity.sentSeq`). Under MMD's classic driver the conductor has no touch path, so only drags and sent messages open the window there. The director also reads `interactionSeq` and `chatSendSeq` to end clips, and `cursorX` for visits.

**Visits.** A wander errand (decided by the mind since CM4b) becomes a visit with `VISIT_SHARE` 0.6 while idle, and always while `watching`. The visit goal is `cursorX - sign(cursorX - rootX) * VISIT_STOP_LEGS * leg` (1.5 legs), used when it is at least one leg from the root.

**Goals keep for 3 s.** `canIssue` refuses a new goal within `GOAL_MIN_DWELL_MS` (3 s) of the last one, and nothing ends a goal before arrival except a stance change, a clip, or talking.

**The headless runner** (`packages/qa-tools/src/t2-3d/runner/run.ts`) drives a mind for idle (CM4b), passes `interaction: { interactionSeq: 0, chatSendSeq: 0, interactionAtMs: null, ... }`, and plays pokes on the adapter directly, so it never chases. Its cursor cues are head-relative (`Motion3dLookTarget.resolve`), so the cursor moves with her. Only `gaze-shift` has cursor cues.

### 2.1 The press-miss finding

The root cause is in the director and is independent of the platform. A closed loop of `decideBody` and `createLocomotion` with the locomotion tests' fixture traits (leg 10, ground of 60 legs each side) reproduces it. The scripts are `.temp/cm6/press-miss.ts` and `.temp/cm6/press-fix.ts`, not committed; run them with `node --import tsx` from the worktree.

1. A chase goal toward the pointer's earlier rest point stays for `GOAL_MIN_DWELL_MS` (3 s) after the pointer moves onto her. A cursor within `CHASE_STOP_LEGS` neither ends nor re-aims it.
2. After the dwell, the chase re-aims at one leg short of the pointer, so she settles one leg from a pointer resting on her.
3. A visit with the pointer resting on her aims 1.5 legs to the far side of the pointer, so she walks 1.3 to 1.5 legs away from it.

Her offset from where the pointer rests (L = leg lengths), at a press that many seconds after the pointer lands on her:

| Case | +0.3 s | +0.6 s | +1 s | +2 s | At rest |
| --- | --- | --- | --- | --- | --- |
| Today: chase, pointer lands at 2 s into the walk | 0.27 L | 0.55 L | 0.91 L | 1.44 L | 1.00 L |
| Today: chase, pointer lands at 4 s | | | 0.82 L | 1.31 L | 1.00 L |
| Today: visit, pointer resting on her | | | | | -1.50 L |
| With the rule of D15: chase, lands at 1 s | | | | | 0.00 L |
| With the rule: chase, lands at 2 s | 0.20 L | 0.31 L | | | 0.33 L |
| With the rule: chase, lands at 4 s | 0.22 L | 0.36 L | | | 0.41 L |
| With the rule: visit, pointer resting on her | | | | | -0.20 L (she stays; the pointer is 0.2 L off) |

With the pointer resting far away, the rule changes nothing: in the same loop (`.temp/cm6/press-fix-far.ts`), a chase toward a pointer 8 legs away rests 1.00 L short of it and a visit toward one 6 legs away rests 1.50 L short, with and without the rule, because the rule only fires as she arrives.

The leftover 0.2 to 0.4 L is the gait's braking distance. Shortening it is gait tuning, so it stays out (D16) and the rendered check in section 8 decides whether it still makes presses miss.

## 3. The design

### 3.1 The split: the mind decides episodes, the performers play frames

| Decided by the mind, on its clock and seeded source | Realised by the performers |
| --- | --- |
| Whether a cursor opportunity becomes an episode she engages in, and its span, dwell, and cooldown (`drawCursorEpisode`) | Natural: the band, the opportunity, permission, the weight's capture and fade, notice and engage timing, release, the cooldown's clock, and the gaze writes |
| That she attends to her user after a poke, a pet start, a drag release, or a sent chat message, and for how long (`ATTEND_WINDOW_MS`, 60 s) | The MMD director: whether a walk toward the cursor is possible in its world (ground, zones, stance, clips, speech), where the cursor is, the goal, and when it ends |

The director still reads the cursor's position from its world, but only to aim a walk that an attend intent or a visit asked for, never to start one (D14).

### 3.2 The pure rule

Item 1 moves `drawEpisode` out of the class into `packages/motion-driver-natural/src/cursor-notice.ts` as `drawCursorEpisode(band: CursorBand, random: () => number): CursorEpisode`, with `CursorBand`, `CursorEpisode`, and the constants it reads (`engageMedium`, `engageFar`, `interestMedian`, `interestLogSd`, `interestSpan`, `noticeDwell`, `cooldown`). `cursor-attention.ts` re-imports them; its other constants stay. The draw order stays engaging, span, dwell, cooldown. The `airi/idle-schedule-pure` lint block gains the file, with its comment widened to the pure rules the mind composes, so the module takes time and random draws only as arguments. The package's `./*` export already serves the subpath `@proj-airi/motion-driver-natural/cursor-notice`, which the mind imports (CM4b D2).

Item 2 adds the contract types to the same module:

```ts
export type CursorOpportunity = 'appeared' | 'restarted' | 'moved' | 'nearer' | 'reopened'
export interface CursorReport { requestId: number, band: CursorBand, opportunity: CursorOpportunity }
export interface CursorOrder { requestId: number, episode: CursorEpisode }
```

### 3.3 The mind's attention policy

`packages/character-mind/src/attention.ts` (new) holds two answers and one constant.

- **Stimulus `cursor`** (`{ kind: 'cursor', report: CursorReport }`). `answerCursor` draws `drawCursorEpisode(report.band, stream)` from `MindState.attention.random`, a Mulberry32 state seeded by one draw of the step's `rng` at the first `cursor` stimulus (CM4b's idle stream pattern, D8). It returns one intent `{ channel: 'gaze', kind: 'cursor-episode', requestId, episode }`. It changes no other state, so a stale order costs only its draw (D7).
- **Stimulus `interaction`** (`{ kind: 'interaction', source: 'drag' | 'chat-send' }`) and the touch answer. `answerInteraction` returns `{ channel: 'body', kind: 'attend', target: 'cursor', windowMs: ATTEND_WINDOW_MS }`. `answerTouch` appends the same intent to its answer for a poke and a pet start, after its other intents, and not for a pet end.
- **`ATTEND_WINDOW_MS = 60_000`**, moved from the director's `CHASE_WINDOW_MS` with its value unchanged. The intent carries a span, not a time, because the director stamps it on its own clock (render loop rule; D12).

`step` dispatches both kinds; like every stimulus they first let the idle clock catch up. `MindState` gains `attention: { random: number | null }`, in `initialMindState`, so a JSON round trip of the state continues identically. A `cursor` or `interaction` stimulus yields no voice, face, or posture intent.

### 3.4 Natural reports and plays

`NaturalCursorAttention` keeps everything except the draw. Where it called `drawEpisode` it now records an awaiting opportunity `{ requestId, band, at }` (a counter it owns), emits a `CursorReport`, and starts nothing. While it awaits, it reports no other opportunity, its phase stays as it was, and the weight's goal is the one that phase gives (idle: 0). `order(order)` is queued by the adapters and applied at the next grid step. It applies only when `requestId` matches the awaiting one and permission is still `full` and the cursor present; then it sets the episode, starts the cooldown for an ignored episode, and calls `start(at)` at that grid step, exactly as the draw did. Otherwise it drops the order. A dropped order clears the awaiting record only when its id matches, and the next step may report anew. The `reopened` path with an existing episode still starts without a report, because it never drew.

`NaturalMotion` gains `onCursorReports(listener)` and `cursorEpisode(order)`, beside `onIdleReports` and `idle(intent)`. `streamIndex.cursorAttention` is deleted; the other indices keep their numbers, so no other stream moves.

**Latency (D6).** The report leaves the frame and the order comes back as an event from outside the loop, so it is queued to the next frame: one frame at 60 Hz (about 17 ms) before the dwell of 0.25 to 0.5 s starts. The dwell and span are counted from the application step on Natural's active seconds, so no clock other than Natural's enters a sampled value.

### 3.5 Hosting in the app

- **Live2D.** `natural-motion-adapter.ts` forwards `onCursorReports` and queues `cursorEpisode`; `Model.vue` and `Live2D.vue` emit `cursor-reports`; `Stage.vue` hands them to the conductor.
- **MMD.** `MMDNaturalAdapter` and `MMD.vue` do the same. `MMD.vue` gains `attend(intent)`: `attendUntilMs = directorNowMs + intent.windowMs`, at the last frame's director time. `noteInteraction()` keeps `interactionSeq++` and loses the stamp; the chat `sentSeq` watch keeps `chatSendSeq++` and loses the stamp.
- **Conductor.** `StagePerformanceConductor.cursor(reports)` steps the mind once per report under Natural only and sends each `cursor-episode` intent back to its own scene's `cursorEpisode`; under another driver it drops the report. `interaction(source)` steps the mind under every driver and sends `attend` to `scene.attend` under every driver, because the MMD director runs under the classic driver too and opens its chase there today (D13). The touch dispatch sends `attend` the same way. A scene without `attend` (Live2D) ignores it.
- **Stage.vue.** It forwards `cursor-reports`, calls `interaction('drag')` when its `interactionSeq` prop changes (it still passes the prop to MMD for clip endings), and calls `interaction('chat-send')` where `chatComposerSentEvent` increments `chatSentSeq`.
- **Two stages.** Each stage's conductor sends its own reports and receives its own orders, because cursor geometry is per stage. Both draw from the one mind stream (D10).
- **QA events.** `use-motion-qa-events.ts` emits `mind` events for `cursor` and `interaction` steps (D22). Opportunities are rare: an ignored or released episode starts a 4 to 10 s cooldown.

### 3.6 The director

`BodyDirectorInput.interactionAtMs` becomes `attendUntilMs: number | null` (director clock), and `MMDStanceInteraction` follows. The chase condition reads `attendUntilMs !== null && nowMs <= attendUntilMs` in place of `nowMs - interactionAtMs <= CHASE_WINDOW_MS`; everything else in it stays. `CHASE_WINDOW_MS` is deleted from the director.

**The press rule (item 2, D15).** Before the goal requests, a goal whose reason is `approach-cursor` or `visit` ends at once while the cursor is on the stage and within that reason's stop distance of the root (`CHASE_STOP_LEGS` or `VISIT_STOP_LEGS` legs). The rule overrides `GOAL_MIN_DWELL_MS`, sets the goal to null and the reason to `stay`, and for a visit counts as arrival, drawing the linger exactly as an arrival does. The chase already issues nothing within `CHASE_STOP_LEGS`. A due visit whose cursor is within `VISIT_STOP_LEGS` of the root becomes an arrival in place: no walk, the wander answered accepted, and the linger drawn (D17). In idle mode the `VISIT_SHARE` draw still happens first, so the director's draws keep their order.

### 3.7 The headless runner

The runner forwards `onCursorReports` to its mind and queues the `cursor-episode` orders, as it does for idle. It passes `attendUntilMs: null`, because it plays pokes on the adapter directly and sends no interactions, so it still never chases. No new scenario or cue (D18).

## 4. Where the code lives

| Path | Change |
| --- | --- |
| `packages/motion-driver-natural/src/cursor-notice.ts` (new) | The pure draw [1]; `CursorReport`, `CursorOrder` [2] |
| `packages/motion-driver-natural/src/cursor-attention.ts` | Calls the draw [1]; reports and plays orders [3] |
| `packages/motion-driver-natural/src/natural-motion.ts` | `onCursorReports`, `cursorEpisode`; no `cursorAttention` stream [3] |
| `packages/motion-driver-humanoid/src/director/index.ts` | The press rule [2]; `attendUntilMs`, no `CHASE_WINDOW_MS` [4] |
| `packages/character-mind/src/attention.ts` (new), `types.ts`, `step.ts`, `touch.ts`, `index.ts` | The policy, stimuli, intents, `MindState.attention` [2 for cursor, 4 for attend] |
| `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` | `cursor` [3]; `interaction`, `attend` dispatch [4] |
| `packages/stage-ui/src/components/scenes/Stage.vue` | Forward `cursor-reports` [3]; send interactions [4] |
| `packages/stage-ui/src/composables/performance/use-motion-qa-events.ts` | `cursor` and `interaction` steps [3, 4] |
| `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts`, `components/scenes/live2d/Model.vue`, `components/scenes/Live2D.vue` | Queue orders, emit reports [3] |
| `packages/stage-ui-mmd/src/composables/mmd/natural/adapter.ts`, `components/scenes/MMD.vue` | Queue orders, emit reports [3]; `attend`, no stamp [4] |
| `packages/stage-ui-mmd/src/composables/mmd/stance.ts` | `attendUntilMs` [4] |
| `packages/qa-tools/src/t2-3d/runner/run.ts` | Cursor through the mind [3]; `attendUntilMs: null` [4] |
| `eslint.config.ts` | `cursor-notice.ts` in `airi/idle-schedule-pure` [1]; `cursor-notice` in the mind's allowed Natural subpaths [2] |

## 5. What is deleted

- `NaturalCursorAttention.drawEpisode` and its `random` constructor argument [3]; `streamIndex.cursorAttention` [3].
- `CHASE_WINDOW_MS`, `BodyDirectorInput.interactionAtMs`, and the scene's `interactionAtMs` stamps [4].

After item 4, `git grep -nE "interactionAtMs|CHASE_WINDOW_MS|drawEpisode\b"` prints nothing outside `.omo/` and `docs/ai/adr/`.

## 6. Docs that move with the code

Policy docs change in the commit that makes their statement false; the work item is named in brackets. Run `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after each policy doc edit.

- **`docs/ai/context/autonomous-behavior.md`.** [2] The Locomotion row and the goal-request precedence rule gain the press rule and the visit-in-place rule. [3] The Cursor attention row names the mind (`packages/character-mind/src/attention.ts`) as the decider and Natural as the realiser. A new Precedence rule after the last one states that the mind draws every cursor episode on its own stream and Natural plays it. Target rule 4 notes that cursor notice landed as that rule. The Cursor ruling in "Rulings the slices keep" names the code that carries it. [4] The Body director and Locomotion rows say that the chase opens only on the mind's `attend` intent. The new rule gains the attend window. Overlap 8 leaves Known overlaps and its row leaves the Target table. Target rule 5 notes that the chase landed and that CM6b moves the rest.
- **`docs/ai/context/body-ownership.md`** [4]. Target rule 8 notes that locomotion toward the cursor answers the `attend` intent and that CM6b moves the rest; the rule stays in Target until CM6b. The Root row is unchanged: the director is still the only source of goals.
- **`docs/ai/context/glossary.md`.** [3] Cursor attention (the mind decides, Natural tracks), Stimulus (`cursor`; the count), Intent (`gaze` `cursor-episode`). [4] Stimulus (`interaction`; the count), Intent (`body` `attend`), Locomotion (code: `attendUntilMs`, `ATTEND_WINDOW_MS`), Cursor attention's "Not to be confused with" (the chase opens on the attend intent). A new term **Attend window** if the doc's entries need it, parallel to Idle policy.
- **`docs/ai/context/character-mind-roadmap.md`** [5]. The CM6 row splits into CM6a (done) and CM6b (not started), CM7 depends on CM6b, and the Feature row for screen-aware attention waits for CM6b.
- **READMEs.** `packages/character-mind/README.md` (stimuli and intents) [2, 4]; `packages/motion-driver-natural/README.md` (who draws cursor episodes; the module) [1, 3]; `packages/motion-driver-humanoid/README.md` (the chase opens on `attendUntilMs`; the input list; the press rule) [2, 4]; `packages/stage-ui-mmd/README.md` ("chases the cursor after a poke ...") [4]; `packages/stage-ui-live2d/README.md` (Cursor attention: the mind decides notice) [3]; `packages/stage-ui/README.md` (the conductor's `cursor` and `interaction`) [3, 4]; `packages/qa-tools/README.md` (the runner's cursor episodes come from its mind) [3].
- **Nested guidance.** `packages/stage-ui-live2d/AGENTS.md` says each Natural layer gets its own seeded stream; after item 3 the cursor layer has none and plays the mind's episodes. Fix that line in a `chore(agents)` commit of its own in this PR (item 3a).
- **ADR** [5]: `docs/ai/adr/2026-11-20-character-mind-gaze.md` records D1 to D22 as taken or vetoed. It supersedes the cursor attention ADR's statement that Natural draws the episode and the locomotion ADR's chase window owner. Existing ADR bodies are not edited.

### 6.1 Expected conflicts with CM5a

CM5a (PR #59) and CM6a both stack on CM4b and edit these files, so whichever lands second rebases with conflicts. Resolve by keeping both changes.

- **Code:** `packages/character-mind/src/types.ts`, `step.ts`, `index.ts` (CM5a adds `music`; both add `else if` branches); `Stage.vue`; the conductor; `use-motion-qa-events.ts` (CM5a adds `music` to the mind event); `qa-tools/src/t2-3d/runner/run.ts`; the character-mind, stage-ui, and qa-tools READMEs.
- **`autonomous-behavior.md`:** CM5a appends Precedence rule 19 and a Groove row. CM6a's new rule takes the next number: 19 on this base, 20 after CM5a.
- **`glossary.md`:** the Stimulus count. Thirteen today; CM5a makes fourteen; CM6a adds two (fifteen alone, sixteen with CM5a).
- **`body-ownership.md`:** CM5a edits the groove rows and Target rule 2; CM6a edits Target rule 8. Different lines, same file.
- **`character-mind-roadmap.md`:** CM5a splits CM5 into CM5a/CM5b and makes CM7 depend on CM5a; CM6a splits CM6 and makes CM7 depend on CM6b. CM7's "Depends on" ends as "CM5a, CM6b" (or CM5b if CM5a's plan says so).

Nothing in CM6a contradicts CM5a: the groove is a posture episode under Natural, and CM6a moves no posture decision.

## 7. Work items

Each item is one commit that passes `pnpm verify` and `pnpm verify --gate --base luke/feat/character-mind-idle`.

1. **`refactor(motion-driver-natural): extract the cursor episode draw as a pure rule`.** `cursor-notice.ts` with `drawCursorEpisode`, the band and episode types, and the constants it reads; the lint block's new file. `NaturalCursorAttention` calls it on its own stream. Docs `[1]`. Tests: `cursor-notice.test.ts` pins the draw order (a recorded fake source sees engaging, span, dwell, cooldown, in that order, and near draws no engagement), the bounds, and the medium and far engagement shares over 10,000 seeded draws within four binomial standard deviations of 0.55 and 0.2. Every `cursor-attention.test.ts` and Live2D `observer.test.ts` pin stays green with no re-pin. Acceptance: `qa:motion3d diff` prints `IDENTICAL` for all nine scenarios against `754e30da1`.
2. **`fix(motion-driver-humanoid): stop a walk aimed at the cursor once the cursor rests on her`.** Section 3.6's press rule and visit rule. Docs `[2]`. Tests in `director/index.test.ts`: a chase goal ends on the decision where the cursor comes within one leg, before `GOAL_MIN_DWELL_MS`; no chase is issued while the cursor stays within one leg; a visit due with the cursor within 1.5 legs issues no goal, answers the wander accepted, and draws a linger; a visit in progress ends with a linger when the cursor comes within 1.5 legs; idle mode still draws `VISIT_SHARE` first (the director's draw count is unchanged for that case). One closed-loop test (`director/press.test.ts`) steps `decideBody` and `createLocomotion` with the locomotion tests' fixture traits: with the pointer landing on her 1, 2, and 4 s into a chase, she comes to rest within 1 s and within 0.5 L of the pointer; with the visit, she does not move. Acceptance: the same loop against the base code fails these bounds (section 2.1 has its numbers), and `qa:motion3d diff` prints `IDENTICAL` for all nine scenarios, because no headless scenario chases or visits with a cursor.
3. **`feat(motion-driver-natural,character-mind,stage-ui,stage-ui-live2d,stage-ui-mmd,qa-tools): move cursor notice into the character mind`.** The contract types, `attention.ts` with the `cursor` answer, `MindState.attention`, the dependency allowance, and sections 3.4, 3.5 (cursor parts), and 3.7. Docs `[3]`. Tests: `attention.test.ts` (Node, seeded): the first `cursor` stimulus seeds the stream with one `rng` draw and later ones draw none from `rng`; equal seeds give equal episodes; the stream continues identically after a JSON round trip; no other channel's intent appears; idle draws are unchanged by interleaved cursor stimuli. `cursor-attention.test.ts`: an opportunity reports instead of drawing; no second report while awaiting; an order with the wrong id, after the cursor left, or after a dismissal is dropped; a matching order notices and engages after its dwell; an ignored episode starts its cooldown at application; a `nearer` opportunity reports during a running episode; the existing behavior cases pass when a fake mind answers each report with `drawCursorEpisode` on a seeded stream. Both adapter tests queue orders and emit reports. The conductor test drops reports outside Natural and returns orders to the reporting scene only. The Live2D `observer.test.ts` hashes are re-pinned only if they move, once, with the reason in the commit body. Acceptance: section 8's headless expectations for item 3.
   - **3a. `chore(agents): say that the Live2D cursor layer plays the mind's episodes`.** The `packages/stage-ui-live2d/AGENTS.md` line only.
4. **`feat(character-mind,motion-driver-humanoid,stage-ui,stage-ui-mmd,qa-tools): open the director's chase on the mind's attend intent`.** The `interaction` stimulus, the `attend` intent from interactions and touch, `ATTEND_WINDOW_MS`, and sections 3.5 (attend parts) and 3.6 (`attendUntilMs`). Docs `[4]`. Tests: the mind answers a poke, a pet start, a drag, and a chat send with one `attend` of 60,000 ms and a pet end with none; the director chases inside `attendUntilMs` and not after it, and never with a null window; the existing chase cases in `director/index.test.ts` and `stance.test.ts` move from `interactionAtMs` to `attendUntilMs` with the same expectations; the conductor sends `attend` to the scene under the Natural and the basic drivers. Acceptance: `qa:motion3d diff` prints `IDENTICAL` for every scenario against item 3's runs.
5. **`docs(ai): record the gaze decisions and close CM6`.** The ADR, the roadmap `[5]`, and any policy doc bookkeeping the earlier items left (the Target table rows). The title is kept as fixed for this step; in this split, "close CM6" closes the CM6a row it creates (D2). Last, after the checks in section 8 pass.
6. **`docs(plan): mark the gaze slice of the character mind done`.** This plan: Status, Departures, Checks run, Commits.

**Order.** 1, 2, 3, 3a, 4, 5, 6. Item 2 goes before the switch because it is small and independent, so the switch commits carry no press change.

## 8. Checks

- **Each commit:** `pnpm verify`, then `pnpm verify --gate --base luke/feat/character-mind-idle`. Inner loops: `pnpm -F @proj-airi/motion-driver-natural exec vitest run src/cursor-notice.test.ts src/cursor-attention.test.ts`; `pnpm -F @proj-airi/motion-driver-humanoid exec vitest run src/director`; `pnpm -F @proj-airi/character-mind exec vitest run src/attention.test.ts src/touch.test.ts`; `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance/use-stage-performance-conductor.test.ts`; `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion-adapter.test.ts`; `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node src/composables/mmd/natural/adapter.test.ts src/composables/mmd/stance.test.ts`.
- **Policy docs:** `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after each policy doc edit and at the tip.
- **Smoke on both hosts.** If `.env.qa` is not in this worktree, create it there (it is ignored) or export `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`.
  - `pnpm qa:display run -- pnpm qa:smoke`
  - `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"`
- **Headless rigs.** `pnpm qa:live2d-rig` passes with trace hash `4853812851e60da048e340407e481f9a14209df2f7aadd1548f48d4c67d1ed36`, the same as at `754e30da1`: its trial has one emotion event, no cursor, and no interaction, so no episode is drawn at either end. If the hash moves, stop and find why; this slice does not change Live2D head output under the rig on purpose. `pnpm qa:test:model` passes.
- **Headless motion.** Base runs come from a worktree made with `pnpm wt new cm6-base --base 754e30da1 --branch luke/tmp/cm6-base --qa`, removed afterward with `pnpm wt rm cm6-base`. Tip runs come from this branch. Both trees are clean.
  - Runs: `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario <name> --seed 1 --out <dir>` for `idle`, `idle-drive`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, and `touch`. Add `--verify-determinism` to the tip's `gaze-shift` run, because its episodes now come from the runner's mind.
  - After items 1 and 2: `pnpm qa:motion3d diff <base run> <item run>` prints `IDENTICAL` for all nine.
  - After item 3 and at the tip: `IDENTICAL` for every scenario except `gaze-shift`, which prints `DIFFERENT`. `DIFFERENT` is expected there: the episodes are drawn from the mind's stream, and each starts one frame later. It is not a pass by itself; the reports are.
  - Reports, each end on its own code: `pnpm qa:motion3d gate <gaze-shift run>` and `pnpm qa:motion3d report gaze-order <gaze-shift run>`. Pass: every gate line and every `gaze-order` line reads the same status at both ends. Record the number of head-turn episodes `gaze-order` finds at each end.
  - **Seed sweep.** If any status differs, run seeds 1 to 5 of `gaze-shift` at both ends and compare the status counts. A flip that follows the seed at both ends is the draw moving to another stream; a flip at the tip only is a defect. Stop on a defect: never retune a gate or a report to make a run pass (motion QA skill).
  - Required wording for the PR: "Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review."
- **Rendered checks.** A driver under `.temp/cm6/` (not committed), modeled on `.temp/cm4b/driver.ts` and `.temp/cm5/driver.ts`: an HTTP verb server inside `pnpm qa:display run --name cm6 -- node --import tsx .temp/cm6/driver.ts`, with `AppSessionCore`, the replay LLM server, the warning collector, page-side evaluation over CDP, and the verbs `launch`, `stop`, `eventsSince`, `setLive2dDriver`, `screenshot`, and `errors`. New verbs: `pointer(x, y)` and `press(x, y, dwellMs)`, through `packages/qa-tools/scripts/linux/kwin-pointer.py play` (stdin: a `<startAtMs> <pressDwellMs>` line and a `tMs,x,y,phase;...` table; phase 1 down, 2 up), and `placement()`, which reads the MMD diagnostics snapshot's `characterPlacement`, `locomotion` (`mode`, `goalX`, `reason`), and `touch.hitBody` from the diagnostics BroadcastChannel and adds the window's screen origin, as `qa:stage measure` does. Stop the display with `pnpm qa:display down --name cm6`. The driver prints no model path.
  1. **Live2D notice, Natural, rig from `AIRI_QA_RIG_FORBOOTH`.** Move the pointer from outside the window onto her face and rest. Pass: a `mind` event with a `cursor` stimulus of band `near` and a `gaze` `cursor-episode` intent with `engaging: true`. Then ten moves to medium and far range, each after a 12 s rest: every opportunity has its `mind` event; record how many engaged (report only; the odds are unchanged by construction).
  2. **The Live2D setting off, and Universal.** Turn Cursor attention off, repeat the moves: no `cursor` stimulus. Switch with `setLive2dDriver` to Universal: no `cursor` stimulus.
  3. **MMD notice, desktop stage, `AIRI_QA_MMD_MODEL`, Natural.** The pointer onto her head. Pass: a `cursor` stimulus and an engaged near episode.
  4. **The attend window.** A drag release on her, and separately a sent chat message (replayed turn). Pass: each gives a `mind` event with an `interaction` stimulus and a `body` `attend` intent of 60,000 ms. A poke gives a `touch` stimulus with an `attend` intent. After each, with the pointer resting four placement widths to one side, `placement()` shows `reason: approach-cursor` within 3 s. Repeat the drag case under MMD's classic driver: the chase still starts (D13).
  5. **The press check, base against tip.** In the base worktree and on this branch, under Natural on the desktop stage: poke her to open the window; rest the pointer four placement widths to one side; when `placement()` shows `approach-cursor` and `mode` walking, move the pointer onto the centre of her current placement (x at the centre, y at 55 % of the height) and rest it R seconds, then press there (80 ms dwell). R in {0.3, 0.6, 1.0, 2.0}, three trials each, at walk times of about 1, 2, and 4 s. For each press record the pointer x, her placement centre x at the press, the offset in placement widths, and whether a `touch` stimulus with a poke followed within 500 ms. Pass on the tip: every press with R of at least 0.6 s gives a poke, and after the rest `locomotion.goalX` is null. The base is expected to miss some presses at R of 1.0 and 2.0 s (it keeps walking for 3 s and settles one leg away); record its counts. Presses at R = 0.3 s are recorded, not judged, because the gait is still braking (D16). If a tip press with R of at least 0.6 s misses, stop and report it as an owner question about the braking distance; do not tune the gait.
  6. **The visit under a resting pointer.** The lab's `requestIdle` requests acts only, so a wander cannot be forced. With the pointer resting on her and the user idle, watch `placement()` for up to 10 minutes for a `mind` event with an `idle-errand` `wander` intent. Pass: no goal follows it and she stays within 0.5 placement widths for 10 s. If no wander comes, record the step as not exercised and rely on item 2's tests.
  Every launch: 0 renderer and 0 main-process errors.
- Record the run directories, the gate and report lines at both ends, the seed sweep if run, the press table, and event excerpts (kinds and counts, no content) in the PR description.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| The awaiting state in `NaturalCursorAttention` misses an edge (a cursor that leaves and returns before the order) and she never notices again | The order is dropped when it no longer matches, and the awaiting record clears on a drop, so the next step reports anew. Node tests cover leave-and-return, dismissal, and a stale id |
| One frame of latency shifts every notice | The dwell is 250 to 500 ms; 17 ms is under 7 % of it. `gaze-order` statuses must match at both ends |
| `gaze-shift` changes and hides a real fault | The gate and `gaze-order` statuses must match; the seed sweep separates a draw move from a defect |
| The press rule stops her too far from the pointer because of braking | Rendered step 5 gates presses after 0.6 s; a miss stops the slice for the owner (D16) |
| The press rule makes her stop short of a pointer that only passes over her mid-walk | The rule needs the cursor within one leg of her root, which a pointer crossing her also meets. Accepted: she stops and the chase re-aims after it leaves, as the chase does today after its dwell |
| A visit under a resting pointer now never walks | Intended (D17); she lingers beside the user instead. An owner question |
| `attend` sent under MMD's classic driver contradicts Body ownership Target rule 1 | Conservative: today's classic chase is kept. An owner question; CM7 decides the classic driver's place |
| Return home or a wander can still move her from under a resting pointer | Outside this Done-when, which names walking toward the pointer. A follow-up |
| The CM5a rebase | Section 6.1 lists every shared file and the numbering rule |

## 10. Follow-ups this plan does not do

- CM6b (section 12).
- Whether a walk toward the user implies noticing the cursor (D11, option B).
- Braking distance at a stop under the pointer, if the owner wants it shorter (gait tuning).
- Return home and wander under a resting pointer.
- A world-anchored pointer cue and an interaction cue in `qa:motion3d`, so a headless scenario can chase (D18).
- An MMD Cursor attention setting: CM7's character-behavior settings document.
- `MMDStanceDiagnostics` documents the locomotion reasons without `visit`; fix the comment when that file is next edited for another reason.

## 11. Decisions open to the owner's veto

| # | Fork | Options | Taken | Why |
| --- | --- | --- | --- | --- |
| D1 | Split CM6 | One PR; split cursor (notice and chase) from glances and the director's other inputs; split gaze from the director | CM6a cursor and the press fix; CM6b glances and the rest of the director | Each half closes one overlap with one decider and no compatibility path. One PR would carry CM4b's highest-risk shape twice |
| D2 | The fixed closing titles under a split | Keep `docs(ai): record the gaze decisions and close CM6`; retitle to "close CM6a" | Keep, closing the CM6a row it creates | The titles were fixed for this step. The ADR file name stays `2026-11-20-character-mind-gaze.md`; CM6b writes its own ADR |
| D3 | Home of the episode draw | `motion-driver-natural/src/cursor-notice.ts` by subpath; move into `character-mind` | `motion-driver-natural` | CM4b D2's precedent. The constants stay beside the tracking constants that `cursor-attention.ts` and its ADR describe |
| D4 | What the mind draws | The whole episode (engaging, span, dwell, cooldown); only `engaging`, the rest from a seed | The whole episode | One call keeps the draw order, so item 1 proves itself `IDENTICAL`. Span and cooldown are episode decisions on the mind's side of Target rule 4; dwell rides along as a span, never a sampled value |
| D5 | Who detects an opportunity | Natural (band in head widths, rest and move detection); the mind from the raw cursor | Natural | Opportunities need the head geometry and the 120 Hz rest detection, which are frame matters. Target rule 4: tracking is the performer's |
| D6 | When the order applies | Queued to the next frame; answered synchronously inside the grid step | Queued | Render loop rule for events from outside the loop, and CM4b's precedent. 17 ms against a 250 to 500 ms dwell |
| D7 | Where the pending guard lives | Natural holds the awaiting opportunity and drops stale orders; the mind holds a pending id and takes refusals | Natural | The mind keeps no cursor state but its stream; a stale order only spends a draw, as a spent fire does (CM4b D16) |
| D8 | The mind's source | Its own Mulberry32 stream seeded by one `rng` draw at the first `cursor` stimulus; the step's `rng` | Own stream | Cursor opportunities come at any rate; on the shared `rng` they would shift voice and touch draws |
| D9 | Permission (the Live2D setting, `aside`, `screen`) | Stays in Natural; the mind decides it | Stays | The setting is a renderer page setting until CM7's settings document (Target rule 8 of Autonomous behavior). `aside` and `screen` come from the performance resolver |
| D10 | Which stage gets an order | The stage that reported, through its conductor; every stage | The reporter | Cursor geometry is per stage. One stream keeps the draws once per character |
| D11 | What opens the attend window | Today's interactions (poke, pet start, drag release, sent message); a noticed cursor episode; both | Today's interactions | Keeps when she walks. Tying the walk to notice would make her chase less often, a user-visible change. Owner question |
| D12 | How the window is timed | A span the director stamps on its clock; an absolute time on the mind's clock | A span | The director's clock is the frame's; no mind time enters a frame value |
| D13 | `attend` under MMD's classic driver | Sent under every driver; Natural only | Every driver | The director runs under classic and opens its chase on drags and sent messages today. Natural only would remove that. Contradicts Body ownership Target rule 1's wording; owner question |
| D14 | The cursor's position in the director | World input used only to aim an attended walk or a visit; carried in the intent | World input | The mind has no world coordinates. Rule 5 forbids subscribing to the cursor as a trigger, not reading where it is |
| D15 | The press rule | End a cursor-aimed goal at once within its stop distance and issue none there; shorten the dwell for cursor goals; re-aim on every cursor move; ignore the cursor while it rests | End at once | It is the only option that stops her where she is. A shorter dwell is tuning and still walks; re-aiming settles one leg away; rest detection would add a raw input to the director |
| D16 | Braking distance at that stop | Unchanged; shortened | Unchanged | Gait tuning, not needed unless step 5 shows misses after 0.6 s. Then it goes to the owner |
| D17 | A visit with the pointer resting on her | Arrive in place and linger; today's walk 1.5 legs past; turn it into a wander | Arrive in place | A visit is a walk toward the user, so today's case is part of the Done-when. Arriving keeps the director's draw order |
| D18 | Headless evidence for the press fix | A Node closed loop with the real gait plus the rendered check; a new world-anchored pointer scenario | Node loop and rendered | The runner cannot chase today, and a new cue kind is evidence tooling outside this slice |
| D19 | Item order | Press fix before the switch; after it | Before | It is independent and small, and its diffs stay `IDENTICAL` |
| D20 | `interactionSeq` and `chatSendSeq` in the director | Keep for clip endings until CM6b; move now | Keep | They feed clip endings, not the chase. Moving them is CM6b's rule 8 work |
| D21 | `BodyIntent.attention` | Leave it diagnostics-only; make it the attend intent's realisation | Leave it | No consumer moves the body from it; CM6b decides it with the gaze arbiter |
| D22 | QA events for the new steps | Emit `mind` events for `cursor` and `interaction`; skip them | Emit | They are rare and are the rendered evidence |

## Blocked: needs the owner

None of these block CM6a; each is taken on the conservative option above.

- **Classic chase (D13).** Body ownership Target rule 1 says classic receives no intents, and Target rule 8 says the director acts on intents. The director runs under MMD's classic driver and chases today. CM6a keeps that chase by sending `attend` under every driver. The alternative removes the chase under classic.
- **Notice and walking (D11).** Should a walk toward the user imply that she notices the cursor? Today the two are independent, and CM6a keeps that.
- **Visits under a resting pointer (D17).** She now stays and lingers instead of walking past the pointer.
- **Braking (D16).** If rendered step 5 shows misses after 0.6 s, the braking distance needs a ruling.
- **The split (D1) and the closing titles (D2).**
- **An MMD Cursor attention setting.** Overlap 8 mentions that MMD has none. CM6a adds none; CM7's settings document is the place.

## Must not do

- Do not tune an engagement odd, interest span, dwell, cooldown, band distance, rest or fade constant, stop distance, `GOAL_MIN_DWELL_MS`, linger, the 60 s window, or the gait, and do not retune a report or gate line to make a run pass.
- Do not draw a cursor episode anywhere but the mind, and do not keep Natural's draw beside it.
- Do not send `cursor-episode` orders outside Natural.
- Do not let the director start a walk from the cursor, a touch, a drag, or a chat send; it reads them only through `attendUntilMs` and its world.
- Do not feed `Date.now`, the mind's clock, or a director time into a value Natural samples.
- Do not move glances, chat cues, cue gestures, or the director's other inputs: that is CM6b.
- Do not add an Eventa contract or cross-window mind traffic; the round trip stays in-process like idle's.
- Do not edit the body of an existing ADR, and do not rename a diagnostics field the MMD guide marks append-only.
- Do not commit a model path or any other local path; use `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`.

## Done when

CM6a is done when the mind draws every cursor episode on its own seeded stream and Natural only plays it; the director chases only inside a window the mind's `attend` intent opened; a walk aimed at the cursor ends when the cursor comes within its stop distance and a visit does not walk her away from a pointer resting on her; overlap 8 has left Known overlaps; Body ownership Target rule 8 records the chase as landed; the roadmap shows CM6a done and CM6b open; and every check in section 8 passes, with `gaze-order` and the `gaze-shift` gate reading the same statuses at both ends and every tip press of rendered step 5 with a rest of at least 0.6 s producing a poke.

## 12. CM6b in outline

CM6b is planned in full when CM6a has landed. It meets the rest of CM6's Done-when: overlap 7 closed, and Body ownership Target rule 8 lands in full.

- **One gaze arbiter.** Every glance goes through one owner of the gaze channel (Body ownership Target rule 3) with stated priorities instead of "the latest wins". The callers today: in `pending-actions.ts` `startPending`, the poke camera glance, the emotion impulse glance, the desktop wake glance, and the screen-change glance; in `natural-motion.ts`, the pet-end camera glance and the chat sent and unfold glances; in `idle-activities.ts`, the act glances and the wake glance; in `cue-gestures.ts`, the `glance` gesture. The mind already decides pokes, emotions, desktop reactions, and idle acts, so their glances become parts of those intents; chat activity and ACT cue gestures become stimuli first. Natural's frame shapes (where a glance lands, its hold) stay in Natural (core ADR D15).
- **The director on intents.** `away` from the mind's presence answer; chat unfold and send as body intents (approach the chat, end looping clips); drags and touches as clip-ending intents in place of `interactionSeq` and `chatSendSeq`; `performance.mode` and `attention` from intents or the director's world, decided by the plan; the `VISIT_SHARE` draw into the mind's errand pick. `BodyIntent.attention` is decided with the arbiter.
- **Docs.** Overlap 7 leaves Known overlaps; Target rule 8 moves into the current sections; its own ADR.
- **Before planning it,** read CM5a's groove path for any director input it adds, and add the cursor coupling and braking rulings if the owner gave them.

## Departures during implementation

None yet.

## Checks run

None yet.

## Commits

None yet.
