---
slug: fullscreen-stage-locomotion
status: approved
intent: clear
review_required: true
plan_path: .omo/plans/fullscreen-stage-locomotion.md
plan_sha256: 7ec9771528b378a67a9eec786065227d3f9d79455e8d9cacbf591869cfb8ef9e
review_round_id: r5-20261031
review_round_limit: 5
round_status: approved
pending-action: none (approved; execute with /ulw-execute)
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber-wt/fullscreen-stage
    runtime_home: null
    target: .omo/plans/fullscreen-stage-locomotion.md
    round_id: r5-20261031
    plan_sha256: 7ec9771528b378a67a9eec786065227d3f9d79455e8d9cacbf591869cfb8ef9e
    launch_id: l5-20261031
    session: st_01a191a6
    result: OKAY (approval with notes)
approach: Per-display full-screen transparent 3D stage window (reusing the desktop-overlay/inlay click-through contract and the existing canvas alpha readback) with a calibrated world/camera/floor contract; pure locomotion + arm/hand rest layers in motion-driver-humanoid; director extended with home/ground-line position behaviours; MMD adapter rebases foot anchors to world space and drives the model root; small refractory-gated LLM tools; settings, lab, gates, ADR; measured stage spike first with the classic window mode kept as the fallback.
---

# Draft: fullscreen-stage-locomotion

## Affected user and ideal state
**Affected users**
- U1 Luke as end user (Tamagotchi, Windows primary; macOS secondary): an MMD companion that today lives in a 450x600 transparent window she cannot leave. After: she stands on the taskbar line of the display she lives on, with a home spot, walks over when he opens chat, wanders rarely if he allows it, follows the cursor after he interacts, returns home, and her arms and hands look relaxed and alive instead of the bind A-pose.
- U2 Luke as developer/QA: tunes and verifies motion through the Motion Lab, diagnostics store, Node tests and Electron QA recipes. After: the lab shows world/camera/locomotion/arm state, gates prove no foot skate and the frame budget, and the stage spike numbers are recorded.
- U3 The Live2D path and the Classic MMD driver: must keep behaving as today (window host still available as a mode).
- U4 The LLM/chat runtime: today it has expression tools only. After: a small body vocabulary with refractories, same registration pattern as `createExpressionTools`.
- U5 The future VRM adapter and M3/M4 authors: consume renderer-neutral world, locomotion and arm contracts (no three/vue/pinia imports).

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | A full-screen transparent always-on-top stage window covers the work area of the display she lives on; everything except her rendered pixels passes clicks through (same contract as the inlay and desktop-overlay windows); the stage never takes focus, never appears in the taskbar, and stays above other windows like the main window does today | The space model needs the whole display; click-through keeps the desktop usable |
| IS-2 | The stage is a real 3D world: floor plane y=0 at the work-area bottom, perspective camera calibrated so the floor line projects exactly to the bottom row and the model projects to the configured pixel height; positions, home and targets are Vec3 in world units; DIP<->world is a camera projection; the calibration survives resize, DPI and display changes | Luke: implement as a 3D space even if depth is unused now |
| IS-3 | She has a home per display (default near the chat's attached corner) and a ground line (work-area bottom); stance, sit, sleep and idle happen at home; with 'roams' she wanders rarely (minutes apart) and returns; with 'stays put' she leaves home only for a reason | Space model decision 2026-10-31 |
| IS-4 | She walks over to the chat when it unfolds, chases the cursor only after a user interaction (poke/pet/drag/chat), returns home afterwards, and never starts a relocation while speaking | Luke's answers 1, 4; Natural pacing research |
| IS-5 | Walking is procedural on the foot IK bones: stride matched to speed (foot skate < 0.05 units live, < 0.01 in Node), start/stop/turn-in-place, pelvis bob and sway, arm swing; hair and skirt feel the travel because the model root moves in the scene before physics | Nothing shipped; 3D-only life |
| IS-6 | Standing, her arms hang relaxed (per-rig rest-relative deltas from the bind A-pose), shoulders breathe, hands and fingers hold a relaxed curl; a VMD that animates arms or fingers owns them while it plays; nothing interpenetrates hips/skirt/chest on the four test models | Arms/hands were deferred from M0+M1; walking needs arm swing |
| IS-7 | The director owns position and stance; the LLM gets `come_here`, `go_home`, `look_at` tools with refractories and clear results; ACT/chat cannot make her pace | Luke's answer 2 |
| IS-8 | The floating chat attaches to her home rect (not her live position) and the attention target is derived from the same rect; drag on her body slides her along the ground line and sets home; window persistence saves home per display | Chat is a target she walks to; drag replaces window drag |
| IS-9 | Settings expose stage mode (stage / classic window), character pixel height, home display, roam mode; English strings in packages/i18n; Classic window mode keeps today's behaviour | U3; rollback path while the branch matures |
| IS-10 | Stage feasibility is measured first: FPS and per-stage timings on standard Chisa at the display's resolution, stage vs classic window, Natural on; the gate (stage FPS >= 0.9 x window FPS, p95 AIRI stages <= 4 ms) and the fallback are recorded before any behaviour work depends on the stage | Luke: 'if feasible'; unknown GPU cost of a full-screen transparent window |
| IS-11 | Motion Lab and diagnostics show world/camera calibration, character position/heading/goal, gait phase, foot skate, arm layer state; QA gates cover foot skate, frame budget, interpenetration; evidence per todo | U2 |
| IS-12 | New pure modules live in motion-driver-humanoid (locomotion, arm-rest, world math) with Node tests and the import guard; READMEs, AGENTS.md and an ADR record the stage architecture | U5, repo convention |

| Gap | Difference from today | Reason | Closed by |
| --- | --- | --- | --- |
| GAP-1 | The character renders in a 450x600 BrowserWindow (windows/main/index.ts:85-103); no per-display stage window exists; click-through is per-pixel on that window only (pages/index.vue:171-377) | IS-1 | stage host todos |
| GAP-2 | MMD.vue frames the camera by skeleton bounds (frameCamera 303-339, OrbitControls); no world/floor/calibration contract; targets are unprojected onto an ad-hoc plane at the head bone z (body/attention.ts:27-28) | IS-2 | world contract todos |
| GAP-3 | BodyIntent has stance+attention only, facingYaw always 0; director has no position, home, goal, pace or roam mode (director/index.ts:59-120) | IS-3, IS-4, IS-7 | director todos |
| GAP-4 | No gait generator; foot anchors, turn pivot (mesh origin) and facing are mesh-local and assume a fixed root (feet.ts, body/index.ts applyFacing, pose.ts:18-30, eyes.ts:17-30): translating the root makes planted feet slide | IS-5 | locomotion + adapter todos |
| GAP-5 | No arm/hand/finger layer; HumanoidBoneName stops at hands; bone-map has no finger/twist entries; rig profile reads a rest arm angle but nothing uses it | IS-6 | arm-rest todos |
| GAP-6 | LLM tools are expression-only (stage-ui/src/tools/expression.ts) | IS-7 | tools todo |
| GAP-7 | Chat attaches to the main window edge and the attention target is window bounds (chat/floating.ts, attention-target.ts); drag moves the window (electron-click-drag-plugin) | IS-8 | host integration todos |
| GAP-8 | No stage-mode, pixel-height, home or roam settings; no stage i18n strings | IS-9 | settings todo |
| GAP-9 | No measurement of a full-screen transparent WebGL window on this machine | IS-10 | spike todo |
| GAP-10 | Diagnostics snapshot has no world/locomotion/arm fields; lab has no world panel; no skate/interpenetration gate for walking | IS-11 | lab + QA todos |
| GAP-11 | No ADR, README or AGENTS.md text for the stage host, world contract, locomotion or arm layers | IS-12 | docs todo |

## Components (topology ledger)
| id | outcome | status | evidence |
| --- | --- | --- | --- |
| C1 Stage host | Per-display full-screen transparent click-through stage window in Electron, with home persistence, chat attachment to the home rect, in-scene drag, and the classic window mode kept behind a setting | active | notepad findings (inlay, desktop-overlay contracts) |
| C2 World contract | Renderer-neutral world/camera/floor contract with calibration math and DIP<->world; MMD.vue camera driven by it | active | MMD.vue 285-339, attention.ts |
| C3 Locomotion + arm rest (pure) | Gait generator, turn/start/stop, arm swing, relaxed arm/hand/finger pose, clip bone masks, Node-tested in motion-driver-humanoid | active | e1a report |
| C4 Director + tools | BodyIntent gains position/goal/pace/home; roam modes; approach/chase/return rules; refractory-gated LLM tools | active | director/index.ts |
| C5 MMD adapter | World-space foot anchors, root motion in the scene before physics, arm-rest pose stage, finger bone map, clip mask detection | active | feet.ts, pipeline |
| C6 Spike, settings, lab, QA, docs | Measured stage spike with recorded fallback; settings + i18n; diagnostics/lab panels; gates; ADR/READMEs | active | ADR, motion-diagnostics.ts |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| Rollback path | `stage.mode: 'window' \| 'desktop'` in a new `stage` config file, applied at next launch with a Relaunch button; `windows/main` untouched; removal condition in a NOTICE + ADR | transparency/flags fixed at window creation; eight main-window consumers | yes (flip setting) |
| Character pixel height | setting, default 560 DIP (today's 600 window minus margins) | matches current framing | yes |
| Roam cadence | seeded wander every 10-20 min in 'roams'; none in 'stays put' | Natural pacing research: rare acts | yes |
| LLM tools | `come_here`, `go_home`, `look_at` (target: camera/cursor/chat/away); 60 s refractory in director memory; results JSON like expression tools | small vocabulary, director primary | yes |
| Drag | pointer drag on her body slides her along the ground line; drag end saves home | replaces window drag; no native drag plugin in stage mode | yes |
| Stage mode scope | MMD renderer only; a Live2D/VRM/Spine selection runs in the classic window regardless of mode | Live2D byte-identical constraint; no Live2D stage adapter exists | yes |
| Hit mask | alpha readback is the authority (existing `isTransparentForMouseEvents` + stage-ui-three hit-test), projected skeleton rect is the broad phase, one read per frame while inside | exact silhouette incl. physics; readback already exists | yes |
| Physics reset rule | split: user transform edits reset physics; per-frame root motion does not; teleport (return home after display change) resets | hair must feel the travel | yes |
| Windows elevated-window caveat | accepted (documented Electron limitation of `forward: true`) | no fix exists | n/a |
| Camera | zero-pitch perspective, off-axis frustum with `s = Hm / P`, `D = 5 Hm`, eye height `0.5 Hm`, floor row `H - 8` (toe margin); floor y=0, root at y = -footBaselineY, character on z=0 | exact floor line and height mapping; toes never clip below the taskbar | yes |
| Display scale QA | agents never change the Windows display scale; checks run at the current scale, 125 %/150 % are Luke-run follow-ups | system-settings change on Luke's machine | n/a |
| Evidence hygiene | maximized Notepad behind the stage during runs; screenshots cropped to the placement rect; `.omo/evidence` is gitignored | privacy; model terms (nothing reaches the branch) | yes |
| Tool refractories | movement tools share 60 s; `look_at` has its own 15 s | a glance should not block a walk | yes |
| Linux | host selects the classic window (no Wayland click-through) with a NOTICE | a full-screen interactive window would block the desktop | yes |
| Home display QA | two-display scenario runs only when `getAllDisplays()` has >= 2 entries; else unit tests only | QA machine display count unknown | yes |
| Content protection | off for the stage window (OBS/screenshots see her); focusable true for island/touch | differs from desktop-overlay contract | yes |

## Findings (cited - path:lines)
Full ledger in the session notepad `H:/temp/ulw-2026-10-31T10-10-39-219Z.md`. Key facts:
- `motion-driver-humanoid/src/types/index.ts:59-67` BodyIntent {stance, attention, facingYaw}; `director/index.ts:71-120` decideBody stance+attention, facingYaw 0; memory {nowMs, idleSinceMs, stance, stanceSinceMs}; `foot-contact/index.ts:166-174` TurnStep + planFootSteps(turnSteps, anchors, pivot); look-at takes facingYaw.
- `stage-ui-mmd/src/composables/mmd/body/feet.ts` anchors mesh-local, pivot {0,0,0}; `body/index.ts` facing from look.step().facingYaw written to hips center; `pose.ts:45-53` rotate = clean * delta; `eyes.ts:17-30` basis once.
- `frame-pipeline.ts:21-24` MMDFrameStage {id, run(ctx{dt, mmd, mixer, clean})}; poseStages/surfaceStages; clipFootIK map; requestPhysicsReset; `MMD.vue:255-261` applyTransform requests reset on every transform change.
- `MMD.vue:274` WebGLRenderer alpha + preserveDrawingBuffer; `:285` PerspectiveCamera(fov,1,0.1,1000); `:303-339` frameCamera from resolveFrameBounds; `:689` screenInwardness(placement.displays, windowBounds.x + head.x*dipScale); `body/attention.ts:25-28` raycast onto plane z = head z.
- `apps/stage-tamagotchi/src/main/windows/main/index.ts:85-103` 450x600 transparent, 'panel' on mac, screen-saver level; `:121-154` bounds persisted in app/config.json windows[]; `:206-230` native drag plugin.
- `windows/desktop-overlay/window-contract.ts:17,56-59,78` full-display transparent click-through non-focusable window builders (tested); `windows/inlay/index.ts:59,66-74` forward click-through + display re-place.
- `renderer/pages/index.vue:171-182,331-377` per-pixel alpha click-through state machine; Wayland NOTICE ~:363-368; `renderer/composables/use-chat-floating-click-through.ts:31,140-198` painted hit test.
- `windows/chat/floating.ts:290-328` attachToMain via main move/resize; `floating-placement.ts` pure over Rectangle; `attention-target.ts` visibility+bounds; contracts `shared/eventa/index.ts:149-222`.
- `services/electron/screen.ts:16-46` cursor loop + display invokes; `electron-eventa/src/electron/{screen,window}.ts` event names; `services/electron/window.ts:82` setIgnoreMouseEvents invoke.
- `stage-shared/src/stage-placement/index.ts` PlacementRect/screenInwardness (pure subpath precedent); `eslint.config.ts:97-105` purity block per path.
- `stage-ui/src/tools/expression.ts:52-97` tool pattern (port + @xsai/tool + zod).
- Electron docs: `setIgnoreMouseEvents(ignore, {forward})` win+mac, Windows forward pauses while an elevated window is active (https://www.electronjs.org/docs/latest/api/browser-window); transparent overlay lag with hardware acceleration disabled (https://github.com/electron/electron/issues/28439).

## Decisions (with rationale)
- D1 (Luke 2026-10-31) Full-screen transparent stage replaces window-follow; real 3D space even if depth is unused; branch `luke/feat/fullscreen-stage` kept off main.
- D2 (Luke) Space model: home per display + ground line; windows-as-terrain deferred; free 2D and depth behaviour excluded.
- D3 (Luke) Director primary owner; LLM small tool vocabulary; both 'stays put' and 'roams' selectable; chase only after user interaction; closeness deferred; no motion panel UI.
- D4 (Luke, forks) One display at a time (home display setting); chat attaches to her home rect; Windows accepts, macOS smokes; TDD for pure math.
- D5 (architect, verified) World/camera contract lives in `packages/stage-shared/src/stage-world/` (new subpath, pure, added to the eslint purity block); promote to its own package when a second non-renderer consumer appears.
- D6 (architect, verified) Locomotion and rest-pose are new subpaths of `motion-driver-humanoid`; director owns goal/reason/refractories, locomotion owns position integration, gait phase, step targets, arm swing, rootYaw; MMDBody passes rootYaw as facingYaw to look-at.
- D7 (architect, verified) New `apps/stage-tamagotchi/src/main/windows/stage/` manager (ONE window on the home display, stage config with mode + activeRenderer + homes, CharacterPlacement relay); `windows/main` untouched; whichever is built becomes `userFacingMainWindow`; chat `attachToMain` generalised to `attachTo(getAnchorRect, onAnchorChange)`.
- D8 Arms/hands (M1.5) folded in: `rest-pose` module + finger bone map + clip bone-mask detection; walking needs arm swing.
- D9 Wave order: spike -> world contract -> stage host (standing at home) -> locomotion -> behaviours/tools -> settings/lab/gates/docs; display hand-off deferred to a later plan.

## Scope IN
- C1-C6 as in the topology ledger; IS-1..IS-12; GAP-1..GAP-11.
- Spike gate with recorded numbers and fallback before stage-dependent todos.
- MMD only in stage mode; classic window mode retained behind a setting with a removal condition.

## Scope OUT (Must NOT have)
- Cross-display walking or hand-off, windows-as-terrain, perching, drag-dangle physics, props, gesture/dance clip library, perform_action tool, VRM adapter, Live2D stage mode, closeness/relationship state, depth-using behaviours.
- No model, texture or VMD assets committed; no new third-party dependencies; no Ammo internals; no edits to three-mmd or node_modules.
- No numeric changes to Natural; Live2D path byte-identical.
- No merge to main from this branch inside the plan.

## Open questions
- none surviving (four forks answered 2026-10-31; defaults listed above are vetoable at the gate)

## Review ledger
- plan-reviewer round r5-20261031 (session st_01a191a6, plan sha 7ec9771528b378a67a9eec786065227d3f9d79455e8d9cacbf591869cfb8ef9e): OKAY - unconditional approval; remaining items are notes for the executor: (1) TDD wording: capture the failing run as evidence, then one commit per todo; (2) no strictTemplates, so the leftover spikeCalibration binding in index.vue between todos 8 and 7 does not break verify; (3) todo 3 come-here with chatX null (chat folded): refuse with retryAfterMs 0 and reason 'no-chat' (executor adds the test). Convergence: r1 B1,B2 -> closed r2; r2 B3 -> closed r3; r3 OKAY; lint-only byte change -> r4 raised B4,B5 (new) -> closed r5; r5 OKAY. Final live-plan validation before commit: sha 7ec9771528b378a67a9eec786065227d3f9d79455e8d9cacbf591869cfb8ef9e matches.
- plan-reviewer round r4-20261031 (session st_01a191a1, plan sha 28333703e335888a02bedc8f97d05e91bdde46ac530c31d7b30f3919b575d9d1): REJECT with two NEW blockers: B4 home unit/ownership inconsistent across todos 2/6/7 (main cannot compute a model-unit default; model-unit homes drift with character height); B5 drag has no re-base path once locomotion owns the root. Fixes: homes stored as DIP x on the floor row (schema xDip, state null when absent), renderer computes defaultHomeDipX and saves it (todo 7; acceptance + evidence moved from 6 to 7), stage-world gains defaultHomeDipX/homeDipToWorldX/worldToHomeDipX with tests, locomotion gains rebase() (todo 4 test), setRootX calls body.rebase for both teleport modes (todo 10 node test), todo 16 step 7b drag-after-walk, IS-3/IS-8 rows updated; note: single-instance guard lives in main/app/single-instance.ts (cited). New sha 7ec9771528b378a67a9eec786065227d3f9d79455e8d9cacbf591869cfb8ef9e.
- Pre-commit lint (nano-staged + moeru-lint) rejected the r3-approved bytes: unescaped '|' inside a GAP-7 table cell (plan) and the design notes' second H1 plus ts fences. Fixed with formatting-only edits (no content change); plan sha 4e714d755573ae3704fd69d5bc03eca5d1da8aa844c2ea54f3790f1049ee3733 -> 7ec9771528b378a67a9eec786065227d3f9d79455e8d9cacbf591869cfb8ef9e; r3 approval invalidated by the byte change, fresh round r4 launched on the final bytes.
- plan-reviewer round r3-20261031 (session st_01a1919d, plan sha 4e714d755573ae3704fd69d5bc03eca5d1da8aa844c2ea54f3790f1049ee3733): OKAY - unconditional approval; remaining items are notes. Notes for the executor: (1) todo 15 is also blocked by 13 (follow the matrix and wave text; the todo's Blocked-by line is incomplete); (2) if strict template type-checking flags the stale `spikeCalibration` binding in `pages/index.vue` after todo 8, drop it in todo 8's commit; (3) `computer-use` is a global skill, CDP `Input.dispatchMouseEvent` is the fallback. Convergence: r1 raised B1, B2 (closed in r2 input); r2 raised B3 (closed in r3 input); r3 approved. Final live-plan validation at handoff: sha 4e714d755573ae3704fd69d5bc03eca5d1da8aa844c2ea54f3790f1049ee3733 matches.
- plan-reviewer round r2-20261031 (session st_01a1919a, plan sha 74c4a1290c20b35e49152fdfe2e0a42b15d4541beef67a1677bf1b47d3c83d5e): REJECT. New blocker B3: todo 8 real-surface QA has no page passing stageWorld until todo 7 (IS-2 unproven). Notes: N4 todos 13 and 15 share MMD.vue in one wave; N5 F1 names windows/main/index.ts for the host if (it is src/main/index.ts); N6 readbackMs cross-package path unstated. Fixes: todo 8 QA = browser tests (feet row, height, placement, clamp) + classic diff; two-model real-surface placement moved to todo 7; IS-2 evidence repointed; 15 sequenced after 13 (waves + matrix); F1 corrected; reportReadback store action named. B1, B2 closed in r1 fixes (not re-raised). New sha 4e714d755573ae3704fd69d5bc03eca5d1da8aa844c2ea54f3790f1049ee3733.
- plan-reviewer round r1-20261031 (session st_01a19196, plan sha 585e419b5b1fb762c15224c07bfff7e8f78b1a8e8c61eeef612133fe6c6056b9): REJECT. Blockers (accepted, frozen ledger): B1 no classic-mode path records activeRenderer so desktop mode is unreachable (IS-9); B2 requestGoal defined two incompatible ways (todo 10 direct vs todo 12 director; IS-4). Notes: N1 CHASE_STOP_UNITS vs CHASE_STOP_LEGS; N2 single toolRefractoryUntilMs vs two timers; N3 todo 1 spikeCalibration through Stage.vue not in write scopes. Fixes: B1 use-stage-active-renderer composable called from index.vue and stage.vue, null counts as non-MMD, fresh-config relaunch QA in todo 14; B2 director gains debugGoal input + pendingGoal hold with PENDING_GOAL_TTL_MS 30 s, requestGoal routed through it from todo 12, todos 12/16 acceptance rewritten; N1-N3 fixed. New sha 4e714d755573ae3704fd69d5bc03eca5d1da8aa844c2ea54f3790f1049ee3733.
- plan-consultant st_01a19189 (2026-10-31): 13 contradictions, 11 citation defects, seam gaps; all folded (resequenced 10 -> 11 -> 12 and 16 -> 17; spike cleanup owners 7/8; store-field owners 7/12; `activeRenderer` + `electronStageSetActiveRenderer`; drag no-reset; command ownership 10/15; refractory split; `legLength` input; consumers table; Linux fallback; default home; skirt bodies in the arm test; `handBelowHip`; macOS single definition; K8 hygiene; `qa:stage` package.json edits; i18n `mmd.stage.*`; `touch.events/lastRegion/headScreenPoint`; `frame-metrics.ts`; center-window handler files; `pages/inlay/index.vue`; nested AGENTS.md limited to tracked guides). Not adopted: creating untracked nested AGENTS.md files (git-excluded in this fork).

## Approval gate
status: approved (Luke answered "Approve" 2026-10-31)
next-action (done): on Approve -> scaffold `.omo/plans/fullscreen-stage-locomotion.md`, run plan-consultant gap analysis, append todos (waves: spike; world contract; stage host; locomotion + rest pose; behaviours + tools; settings/lab/gates/docs; F1-F4), fill TL;DR, then plan-reviewer rounds (fresh session each) until approval; commit plan + draft on luke/feat/fullscreen-stage and push. Approval authorizes writing the plan only; execution starts separately via /ulw-execute.
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
