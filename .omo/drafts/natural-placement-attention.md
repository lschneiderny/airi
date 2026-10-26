---
slug: natural-placement-attention
status: plan-approved
intent: clear
review_required: true
plan_path: .omo/plans/natural-placement-attention.md
plan_sha256: c5df7b20019024501ef16d516ebb49c13665baaac0bed16752975ae5ffa652f3
review_round_id: r7-46671d36
review_round_limit: 10
pending-action: review .omo/plans/natural-placement-attention.md
phase: review_round_initialized
round_status: approved
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/natural-placement-attention.md
    round_id: r7-46671d36
    plan_sha256: c5df7b20019024501ef16d516ebb49c13665baaac0bed16752975ae5ffa652f3
    launch_id: l7-7b4a0176
    session: st_01a179b8
    result: OKAY round 7 (unconditional)
approach: "Pure placement geometry in stage-shared; the Tamagotchi host passes displays, window bounds, and the chat target into Stage, Live2D, and Model.vue, which computes the inward value and the chat offset; Natural gains setPlacement/setChat/chat cues with exact zero-signal identity; main-process chat target over eventa mirroring the chat button state; typing via the existing bus event plus a new typed-send bus event; one setting; scenario/T1/T3 QA hooks; docs and ADR"
---

# Draft: natural-placement-attention

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Affected users:
- Luke as the desktop user of Tamagotchi with a Live2D rig on the Natural driver. Today the character rests facing straight out, her glances go left or right at random (half of them off the screen edge in a corner), screen-watching looks at a centered desk point, and she never looks at the chat. After: she sits subtly angled toward the screen, glances into the screen, and reads the chat while he types.
- Future maintainers and agents working on Natural motion, who rely on seeded, deterministic traces and golden hashes.
- The QA tooling (T1 simulation, T3 rendered gates, Vishot), which consumes deterministic Natural traces.

IS-1 | In a corner, the resting head (and body, through the rig's own path) turns subtly toward the horizontal center of the bottom display layer; a centered model has no turn; stacked upper displays never move the reference | the "real vtuber in the corner" feel without misreading the setup
IS-2 | The eyes stay on the camera while turned; cursor engagement is unchanged (the offset fades while gaze is on the cursor); moving the window never snaps the pose (eased) | the turn must never cost engagement or look mechanical
IS-3 | Peripheral glances and aside cues lean inward at the edge (about 65/35) and stay 50/50 when centered | glances off the bezel read as looking at nothing
IS-4 | Desk fixations during screen attention and watching mode, and the screen-change reaction glance, aim at an inward screen point; idle, listening, and talking keep the centered desk | she watches where the content is
IS-5 | Chat: while he types, she periodically fixates the chat; on a typed send she gives a reading glance sized by the message length; when the chat unfolds she glances at it; replies stay on camera; voice sends, folded or hidden chat, and talking produce no chat glances; works for legacy and floating (attached, free, danmaku) chat | feels like she reads along
IS-6 | One Live2D setting "screen-aware attention" (default on) with an English label and description; off means exactly today's behavior | Luke can disable it without side effects
IS-7 | Only the Natural driver changes; the universal and magic drivers, the web and pocket hosts, and VRM are unchanged | scope decided with Luke
IS-8 | With no signal (web, toggle off, or QA), every existing golden hash, mood hash, and liveliness/emotion gate passes unedited; new behavior has its own seeded tests | the determinism contract in packages/stage-ui-live2d/AGENTS.md
IS-9 | T1 and T3 can drive placement and chat signals through the shared scenario contract; existing T3 gates and Vishot flows run with the signal off and stay unchanged | agent-executable QA without depending on window position
IS-10 | No chat text reaches Natural or the main window; only typing timing, a send word count, and the chat window rectangle | privacy
IS-11 | Docs describe the new behavior: the stage-ui-live2d README Natural section, a new ADR in docs/ai/adr, and the settings i18n | repository rule: docs ship with code

GAP-1 | Natural has no placement input and no yaw bias; the posture bias carries only cursor X/Y (natural-motion.ts:477) | IS-1, IS-2 | todos TBD
GAP-2 | Side draws are fixed at 0.5 (gaze.ts:166,337) | IS-3
GAP-3 | The desk target is fixed at (0,-0.18) in gaze.ts:25 and pending-actions.ts:21; energy exposes only screen attention, not watching mode | IS-4
GAP-4 | The main window gets no chat geometry or visibility (ChatFloatingState goes only to the chat window, floating.ts:141-152; legacy emits nothing) | IS-5
GAP-5 | The typing signal exists (chatComposerActivityChangedEvent, speech/bus.ts:37-43, emitted by use-chat-composer.ts:99-110) but Stage does not consume it, and there is no typed-send event | IS-5, IS-10
GAP-6 | Natural has no chat target, chat fixations, or chat glances | IS-5
GAP-7 | No setting, i18n string, or UI exists | IS-6
GAP-8 | The scenario contract, T1 sink, and T3 bridge have no placement or chat inputs (bridge.ts:24-46, schema.ts, scenario-sink.ts:174-212) | IS-9
GAP-9 | No tests pin zero-signal identity for the new inputs | IS-8
GAP-10 | The README and ADRs do not describe the behavior | IS-11

## Components (topology ledger)
C1 | Placement geometry: a pure bottom-layer reference and inwardness function in stage-shared, plus host plumbing from Tamagotchi index.vue through Stage and Live2D to Model.vue | active
C2 | Natural placement behaviors: eased yaw bias, side-draw remap, inward screen point (including watching mode) | active
C3 | Chat signals: main-process chat target (rectangle and visibility) to the main window over eventa; typing activity (existing bus event); typed-send bus event | active
C4 | Natural chat attention: chat target, typing fixations with head follow, send and unfold glances, priority rules | active
C5 | Settings toggle, i18n, README, ADR | active
C6 | QA: scenario contract events, T1 sink, T3 bridge pin and override, zero-signal identity tests, new seeded tests | active
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

## Open assumptions (announced defaults)
- Drag handling | no drag detector; the inward value eases with a 2 s first-order filter, so a drag reads as a slow settle | the main process has no move-ended event (window.ts:36-41 emits bounds every loop tick) | reversible
- Geometry location | pure functions in packages/stage-shared/src/stage-placement; Model.vue computes the head's screen x as window bounds x plus the headViewportRect center (Model.vue:1234-1255) | the head rect is renderer-only; this keeps Electron free of head geometry | reversible
- Bottom-layer predicate | a display is excluded when another display's center is lower and their x overlap is at least 20% of the narrower display; reference = the midpoint of the union x-span of the bottom layer; u = clamp((ref - headX)/half, -1, 1); w = sign(u) * smoothstep over |u| from 0.15 (dead zone) to 0.80 | advisory spec from ultrabrain | reversible
- Magnitudes | yaw bias 0.10 * w * (1 - onCursor) on posture index 0 (yaw); side threshold 0.5 - 0.15 * w; screen point x = 0.30 * w, y = -0.18 | Luke tunes these in joint QA | reversible
- Chat timings | typing active when the last input is within 1.5 s; chat branch drawn with p = 0.35 only while typing and a chat target exists; send glance after a U(0.18, 0.30) s delay, held clamp(0.5 + 0.25 * words, 0.6, 3.0) s; unfold glance after 0.25 s, held 0.8 s; head follows a chat fixation at 0.6 * the mapped head; chat randomness on a new stream index 14 | advisory spec with literature citations | reversible
- Chat trigger sources | typing = existing chatComposerActivityChangedEvent; send = a new chatComposerSentEvent { sourceId, words } emitted by use-chat-composer on a successful typed send (voice sends never emit it); unfold = the chat target's visible rising edge | reversible
- Chat target contract | ChatWindowManager gains getAttentionTarget/onAttentionTargetChange, mirroring getButtonState/onButtonStateChange; main RPC emits electronChatAttentionTargetChanged on the main window context, as at rpc/index.electron.ts:94-97 | reversible
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)
- Glance sides are random today: peripheral `gaze.ts:337` (`side = random() < 0.5 ? -1 : 1`), aside cue `gaze.ts:166`. Targets `gaze.ts:22-31` (camera 0,0; desk 0,-0.18; peripheral .12; peripheralUp .15,.12; aside .55,-.15).
- Cursor head pull already uses posture bias: `natural-motion.ts:471-477` (`headShare`, `this.follow`, `posture.step(step, [this.x.cursorX, this.x.cursorY, 0])`); eye compensation uses `slowPose` which includes bias (`posture.ts:150`, `natural-motion.ts:479-492`).
- Body follower gain 0.99 normalized (`natural-motion/body.ts:6-8`); physics-owned body axes are null (`natural-motion.ts:227`).
- Bear physics3 PhysicsSetting1: ParamAngleX -> ParamBodyAngleX weight 100. ForBOOTH: ParamBodyAngleX is a physics INPUT to 13 groups (BodyAngleX2/Z2, hair, clothes), not an output. Luke's VTS recordings: head/body corr >0.999.
- Screen attention: `energy.ts:153-163` (`attention==='screen'` -> desk weight 2; cursor dropped `natural-motion.ts:368`); watching preset `energy.ts:16`; resolver `packages/stage-shared/src/performance-state/index.ts` (watching = recent desktop activity; screen attention when game/media settled 2 s, or ACT look cue while talking/thinking).
- Screen-change reaction glance: `natural-motion/pending-actions.ts:15-21,93-95` (desk 0,-0.18 for 0.4 s).
- Other random side choosers left alone: `gestures.ts:253`, `impulses.ts:159`, `speech-emphasis.ts:104`.
- Default motion driver is `universal` (`composables/live2d/live2d.ts:11`); feature is Natural-only.
- Chat: `ChatFloatingState.side` (`apps/stage-tamagotchi/src/shared/eventa/index.ts:~96-100`) goes only to the chat renderer; attached side chosen in `main/windows/chat/floating-placement.ts:51-65`; free/danmaku report side 'left'.
- View-control `position` offsets model inside window (`stores/view-control.ts:12-13`); head anchor exists (`Model.vue:1560`).
- Motion-manager already keys ambient re-measure on window placement (`motion-manager.ts:486-490`).

## Decisions (with rationale)
- Natural driver only (Luke 2026-10-26).
- Live2D only; web passes no signal (Luke).
- Reference = horizontal center of bottom layer of all displays combined; stacked upper displays never shift it (Luke).
- Resting turn via head posture bias only, body follows per rig (research: Bear physics-owned body, ForBOOTH follower 0.99); no manual sliders (Luke doubted sliders).
- Offset fades while gaze on cursor (Luke accepted recommendation).
- Glance-side bias peripheral + aside only (~65/35 edge); other side choosers stay random (emotion QA records side).
- Screen point applies in attention 'screen' AND mode 'watching' (Luke: both for now, may change later) + screen-change glance.
- Chat: send reading glance, typing-driven fixation, unfold glance ALL in first version (Luke); replies stay on camera.
- One toggle default on; numbers tuned in joint QA later (Luke).
- Fork Toggle (2026-10-26): ONE setting "Screen-aware attention" (settings/live2d/natural-screen-awareness, default true) covers the placement effects AND the chat glances (Luke chose the recommended option).
- Fork Tests (2026-10-26): TDD for the Natural controller and the stage-shared geometry (write the failing seeded test or zero-signal hash check first); tests-after for plumbing and UI; agent QA (T1 + T3) always (Luke chose the recommended option).
- Constraint sweep: budget none (no paid services); stack mandated by the repo (Vue 3, Electron, eventa, Valibot, Vitest); scale is a single desktop user; audience is Luke's personal fork, English-only i18n edits.

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

## Approval gate
status: approved (Luke, 2026-10-26, 'Approve' via question tool; review default-on kept)
next-action: on approval, rerun scaffold without --draft-only, run plan-consultant, append todos, then plan-reviewer rounds (max 5)
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

## Review ledger
- plan-consultant st_01a179a3: findings 1,5,7,8,9,10,11,14 folded into todos 2,6,7,8,9,11 (dead-zone -0 guard, clientWidth scale, explicit T3 screenAwareness, observer glance event, sign assertions, no-snap easing test, web-inert test, numeric T3 checks); 3,4 documented; 6,12,13 notes.
- Round 1: round_id r1-97b9dd23, plan_sha256 4f34e63fc2dd5b06999081bc61aae6fabe10d6daf57fae9a801a5d350e4088e3, launch l1-ef8489b4
- Round 1 result: changes_requested (st_01a179a7). Accepted blockers (ledger frozen): B1 chat jitter consumed gaze stream (todo 6 now jitteredWith(chatRandom)); B2 first-open unfold lost (todo 6 sequence lifecycle + todo 8 non-null hidden input + lifecycle tests); B3 failure scenarios could not fail (todo 6 spy-based chat-stream test (iv-b); todo 11 new control T3 run). Fixed with smallest edits.
- Round 2: round_id r2-893e8556, plan_sha256 70add7f34760b79c7d1fce38ac73082993439a2c98c2425755e4c88d0329c001, launch l2-6a9ce705
- Round 2 result: changes_requested (st_01a179a8). Both are regressions introduced by round-1 fixes (eligible): R2-1 iv-b gaze draw-count equality contradicted chat branch -> replaced with gaze-spy 0 calls on chat-branch selections; R2-2 todo 8 fold check expected null input -> now target===null with no glance.
- Round 3: round_id r3-57b5fe8f, plan_sha256 09a161d67037af1fea6e6efc8c189403de01d113743b10503807028ba272f077, launch l3-13261376
- Round 3 result: changes_requested (st_01a179aa). R3-1 (regression from R2 fix): chat fixation hold drew gaze stream via saccadeTo/drawHold -> fixateNext() passes drawHold(chatRandom) for chat fixations (gaze.ts:140,148,181,199,301-317,348 verified). R3-2 (accepted-requirement: todo 1 checks unpassable): exact expected ratios 860/960 and -1780/1920; mutation must fail the sliver case only.
- Round 4: round_id r4-de475d9b, plan_sha256 56cd0358383212a343f2c26dad6e04a9a70faa4542d2e18ebdc5469fdd20702b, launch l4-c9f7912c
- Round 4 result: changes_requested (st_01a179ac). R4-1 (IS-6 unreachable): setPlacement(null) is now an immediate disabled path + test (v-b); setChat(null) disable path + test (v-b) added preemptively. R4-2 (unexecutable fixture): moving-cursor orbit + placementYawBias getter + >=20% engaged steps. R4-3 (IS-9 unproven): IS-9 restated to input identity (bridge-state screenAwareness false) + T1 verdict equality + final T3 liveliness gate run recorded; rationale: T3 verdict noise ~4.4%/check. Self-review extras: chat-typing observer glance cause, deadline-based send glance, bridge state readouts placement/chat for live checks in todos 7/8, todo 11 (b) uses observer events.
- Round 5 (final, cap): round_id r5-ade8b614, plan_sha256 22dac4841f24e27f81e9a632355eac68b3c23e38d061b0d0f1b7cdefd44c4dd7, launch l5-1092b727
- Round 5 result: changes_requested (st_01a179af), CAP REACHED. All three practical: R5-1 todo 7 live check needed bridge screenAwareness configure (moved into todo 7; todo 9 (c) now reuses); R5-2 todo 2 hash mutation (+1e-12) not reliably observable (replaced with unconditional +1e-6 posture mutation and a flipped-remap statistics mutation); R5-3 overrides reset to undefined let real host signals leak into scenarios (runScenario now pins null, disposal restores undefined; live checks never call runScenario). Fixes applied, UNREVIEWED. Current plan sha 19301d4942dca37df0140e6a5c29d66ce42938244687026f8b4596835f641ab5. Awaiting Luke: extend review rounds or accept.
- Luke 2026-10-26: extend review by 5 more rounds (cap 10).
- Round 6: round_id r6-3076ad6f, plan_sha256 19301d4942dca37df0140e6a5c29d66ce42938244687026f8b4596835f641ab5, launch l6-e7b8261e
- Round 6 result: changes_requested (st_01a179b4). R6-1 nondeterministic typing-glance counts in unseeded rendered checks: todo 8 live now proves signal delivery only; todo 11 (b) samples bridge chat state; counts moved to seeded T1 seeds 1-10 (todo 9). Preemptive same-class fix: todo 11 (a) now scores the deterministic observer 'placement' yawBias events (new todo 2 (g)); ParamAngleX difference report-only.
- Round 7: round_id r7-46671d36, plan_sha256 c5df7b20019024501ef16d516ebb49c13665baaac0bed16752975ae5ffa652f3, launch l7-7b4a0176
- Round 7 result: OKAY (st_01a179b8), unconditional. Live plan sha256 re-validated = c5df7b20019024501ef16d516ebb49c13665baaac0bed16752975ae5ffa652f3 (matches round). Handoff ready.
