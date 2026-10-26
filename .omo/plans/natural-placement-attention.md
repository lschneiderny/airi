# natural-placement-attention - Work Plan

## TL;DR (For humans)

**Who this is for and what changes for them:** This is for anyone running the desktop app with a Live2D character on the Natural motion setting. When the character sits in a corner of the screen, she now rests very slightly turned toward the middle of the user's monitors. Her side glances lean into the screen rather than off its edge, and when she watches the screen she looks toward where the content is. She glances at the chat while the user types, reads a message when the user sends it, and looks at the chat when it opens. Her replies stay on the user.

**What you'll get:** All of the above behind one setting, "Screen-aware attention", which is on by default; turning it off brings back exactly today's behavior. The work also ships tests that keep every existing motion recording identical when the signal is absent, test hooks that let the automated motion checks drive the new behavior, and updated documentation.

**Why this approach:**
- The main window already tracks the cursor, so the window and display geometry travels the same path.
- The new behavior reshapes random choices that already exist rather than adding new ones, so nothing changes until a placement or chat signal is present.
- The head turns and each rig moves the body its own way, which follows how the artists built Bear and ForBOOTH.

**What it will NOT do:**
- Change VRM models, the Universal or MAGIC motion settings, or the web and mobile apps.
- Read or send chat text (only typing timing and a word count are used).
- Add sliders or translations beyond English.

**Effort:** Large
**Risk:** Medium - most of the risk is in keeping seeded motion recordings bit-identical with no signal, and in sending chat geometry between windows.
**Decisions to sanity-check:**
- The starting numbers: a turn of about 3°, glances 65/35 at the screen edge, a screen point at 0.30, and chat glances on 35% of fixation choices while typing. These get tuned in joint QA.
- No drag detector: the turn eases in over about 2 seconds.
- Voice-originated sends never trigger the reading glance.

Your next move: run `/ulw-execute natural-placement-attention` in this session or a new one once the review passes. Full execution detail follows below.

---

> TL;DR (machine): Large, Medium risk. Natural-only screen-aware attention: placement inwardness (stage-shared geometry), eased head-yaw bias, inward side draws, inward screen point (screen attention plus watching), chat target, typing, send, and unfold glances; one setting; scenario/T1/T3 QA hooks; zero-signal hash identity; docs and ADR.

## Scope
### Affected user and ideal state
**Affected users:**
- **Luke, the desktop user of Tamagotchi with a Live2D rig on the Natural driver.** Today the character rests facing straight out, and her side glances are random, so in a corner half of them go off the bezel. Screen-watching looks at a centered desk point, and she never looks at the chat. After this work she sits subtly angled toward the screen, glances into it, and reads along with the chat.
- **Future maintainers and agents working on Natural motion.** They rely on seeded, deterministic traces and golden hashes.
- **The QA tooling: T1 simulation, T3 rendered gates, and Vishot.** It consumes Natural traces.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | In a corner, the resting head turns subtly toward the horizontal center of the bottom layer of displays, and the body follows by each rig's own path. A centered model has no turn, and stacked upper displays never move the reference. | This gives the "real VTuber in the corner" feel without misreading multi-monitor setups. |
| IS-2 | The eyes stay on the camera while she is turned, and cursor engagement is unchanged because the offset fades while gaze is on the cursor. Moving or resizing the window never snaps the pose; the turn eases in. | The turn must never cost engagement or look mechanical. |
| IS-3 | Peripheral glances and aside cues lean inward at the edge, about 65/35, and stay exactly 50/50 when centered. | Glances off the bezel read as looking at nothing. |
| IS-4 | Desk fixations during screen attention or watching mode, and the screen-change reaction glance, aim at an inward screen point. Idle, listening, thinking, and talking keep the centered desk. | She watches where the content is. |
| IS-5 | While the user types, she periodically fixates the chat with a slight head follow. On a typed send she gives a reading glance sized by message length. When the chat unfolds or opens, she glances at it. Replies (talking) stay on the camera. Voice sends, a folded or hidden chat, and talking produce no chat glances. This works for the legacy window and the floating chat in attached, free, and danmaku placements. | She feels like she reads along. |
| IS-6 | One Live2D setting, "Screen-aware attention" (default on), has an English label and description and appears only when the Natural driver is selected. Off means exactly today's behavior. | Luke can disable it without side effects. |
| IS-7 | Only the Natural driver changes. The Universal and MAGIC drivers, the web and pocket hosts, and VRM are unchanged. | This is the scope decided with Luke. |
| IS-8 | With no signal (web, setting off, or QA default), every existing golden hash, mood hash, liveliness gate, and emotion gate passes without editing any expected value. The new behavior has its own seeded tests. | This is the determinism contract in packages/stage-ui-live2d/AGENTS.md. |
| IS-9 | T1 and T3 can drive placement and chat signals through the shared scenario contract. Existing T3 gates run with screen awareness explicitly off, which the bridge state verifies, so their Natural inputs are identical to today's. Existing T1 gate verdicts are unchanged. The final rendered T3 liveliness gate runs with the signal off and its verdict is recorded beside the last accepted T3 liveliness verdict. Rendered T3 verdicts are noise-limited (the motion-gate redesign measured about 4.4% per-check noise), so input identity, not verdict equality, is the binding proof. | Agent-executable QA must not depend on the real window position. |
| IS-10 | No chat text reaches Natural or the main window. Only typing timing, a send word count, and the chat window rectangle cross. | Privacy. |
| IS-11 | The stage-ui-live2d README Natural section, a new ADR, and the English settings strings describe the behavior. | Repository rule: documentation ships with code. |
| GAP-1 | Natural has no placement input and no yaw bias. The posture bias carries only cursor X and Y (`natural-motion.ts:477`). | Blocks IS-1 and IS-2. |
| GAP-2 | Side draws are fixed at 0.5 (`gaze.ts:166`, `gaze.ts:337`). | Blocks IS-3. |
| GAP-3 | The desk target is fixed at (0,-0.18) (`gaze.ts:25`, `pending-actions.ts:21`), and energy exposes only screen attention, not watching mode (`energy.ts:153-163`). | Blocks IS-4. |
| GAP-4 | The main window gets no chat geometry or visibility. `ChatFloatingState` goes only to the chat window (`floating.ts:141-152`), and the legacy window emits nothing. | Blocks IS-5. |
| GAP-5 | The typing signal exists (`chatComposerActivityChangedEvent`, `speech/bus.ts:37-43`, emitted by `use-chat-composer.ts:99-110`) but Stage does not consume it, and no typed-send event exists. | Blocks IS-5 and IS-10. |
| GAP-6 | Natural has no chat target, chat fixations, or chat glances. | Blocks IS-5. |
| GAP-7 | No setting, i18n string, or UI exists. | Blocks IS-6. |
| GAP-8 | The scenario contract, T1 sink, and T3 bridge have no placement or chat inputs (`motion-scenario/schema.ts:29-48`, `bridge.ts:23-46`, `scenario-sink.ts:247-305`, `use-motion-qa-bridge.ts:141-176`). | Blocks IS-9. |
| GAP-9 | No test proves zero-signal identity for the new inputs. | Blocks IS-8. |
| GAP-10 | The README and ADRs do not describe the behavior. | Blocks IS-11. |

### Must have
- Every IS row is delivered and proven by its QA scenario (see `## Success criteria`).
- Natural-only behavior. Every new controller input defaults to "no signal", and with no signal the per-step float math and RNG draw sequence are identical to today: no new draws, no reordered draws, and new terms are added only behind `!== 0` or non-null guards.
- The posture yaw bias is on posture bias index 0 (head X / `ParamAngleX`), never the roll slot (index 2).
- No separate body term. The body follows through `body.ts` (gain 0.99) on ForBOOTH and through physics on Bear.
- Chat randomness uses a new stream `chat: 14` appended to `streamIndex` (`natural-motion.ts:43`), and chat draws happen only while a chat signal is present.
- One setting key, `settings/live2d/natural-screen-awareness` (default `true`), gating both the placement and the chat effects.
- Eventa contracts live in `apps/stage-tamagotchi/src/shared/eventa/index.ts`. Speech-bus events live in `packages/stage-ui/src/services/speech/bus.ts`.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No edits to existing golden-hash expectations in `observer.test.ts` or `mood.test.ts`, to gate bands, to `reference-stats.ts`, or to `EmotionGate.version`. If any existing hash changes, the change is wrong.
- No changes to the Universal or MAGIC drivers, VRM (`packages/stage-ui-three`), `apps/stage-web`, `apps/stage-pocket`, or `apps/stage-tamagotchi-kirie`.
- No chat text, draft text, or message content in any new event. The only chat data allowed is `words` (an integer count), timing, and window rectangles.
- No sliders and no per-model facing settings.
- No changes to the randomness of gestures (`gestures.ts:253`), reaction glances (`impulses.ts:159`), or speech roll (`speech-emphasis.ts:104`).
- No drag-detector IPC. Easing covers drags.
- No edits to locales other than `en`. No `any`. No backward-compatibility shims.
- Do not touch or commit the pre-existing dirty files: `AGENTS.md`, `apps/stage-tamagotchi/electron.vite.config.ts`, `packages/i18n/AGENTS.md`, `server/AGENTS.md`, `server/apps/api/AGENTS.md`, `services/computer-use-mcp/AGENTS.md`. Stage only the files each todo names.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- **Test decision.** TDD with Vitest for the Natural controller (`packages/stage-ui-live2d/src/composables/live2d/natural-motion*`) and the stage-shared geometry: write the failing test first, run it to watch it fail, then implement. Tests-after (written within the same todo) for plumbing, the main process, the composer, settings, and QA wiring. Agent-run QA through T1 (`pnpm qa:motion` / the scenario sink) and a rendered T3 run is always included.
- **Test commands.**
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --config vitest.node.config.ts <paths>`
  - `pnpm -F @proj-airi/stage-shared exec vitest run <paths>`
  - `pnpm -F @proj-airi/stage-ui exec vitest run <paths>`; browser tests use the package's vitest browser project, e.g. `pnpm -F @proj-airi/stage-ui exec vitest run src/components/scenarios/settings/model-settings/live2d.browser.test.ts`
  - `pnpm -F @proj-airi/qa-tools exec vitest run <paths>`
  - `pnpm -F @proj-airi/stage-tamagotchi exec vitest run <paths>`
- **Typechecks.** `pnpm -F <package> typecheck`.
- **Each todo** finishes with `pnpm verify` green on its tree.
- **Evidence.** `.omo/evidence/natural-placement-attention/task-<N>-<slug>.<ext>`, or the ulw-execute attempt dir when run under `/ulw-execute`. Every artifact records the commit it exercised.
- **Skills the executor must read before each relevant todo.** `.agents/skills/enforce-rules-for-typescript/SKILL.md` (all code); `.agents/skills/enforce-rules-for-vitest/SKILL.md` (all tests); `.agents/skills/eventa/SKILL.md` (todos 4, 8); `.agents/skills/motion-qa/SKILL.md` (todos 9, 11); `.agents/skills/enforce-rules-for-unocss/SKILL.md` and `DESIGN.md` (todo 3); `packages/i18n/AGENTS.md` (todo 3).

## Execution strategy
### Parallel execution waves
> Waves 2-5 have fewer than 3 todos because of real dependencies on `natural-motion.ts`, `gaze.ts`, and `Model.vue`. Two todos editing the same file never run in parallel.
- **Wave 1 (disjoint write scopes, all parallel):** 1 placement geometry; 2 Natural placement core; 3 setting and UI; 4 main-process chat target; 5 typed-send bus event.
- **Wave 2:** 6 Natural chat core (after 2); 7 placement host plumbing (after 1, 2, 3). These are disjoint: todo 6 edits the Natural controller files, and todo 7 edits the Vue host files and the adapter.
- **Wave 3:** 8 chat host plumbing (after 4, 5, 6, 7).
- **Wave 4:** 9 QA contract, T1, and T3 hooks; 10 docs and ADR. Both depend on 8 and run in parallel because their write scopes are disjoint.
- **Wave 5:** 11 rendered end-to-end QA run (after 9, 10).
- **Final wave:** F1-F4 in parallel.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 7 | 2, 3, 4, 5 |
| 2 | - | 6, 7 | 1, 3, 4, 5 |
| 3 | - | 7 | 1, 2, 4, 5 |
| 4 | - | 8 | 1, 2, 3, 5 |
| 5 | - | 8 | 1, 2, 3, 4 |
| 6 | 2 | 8 | 7 |
| 7 | 1, 2, 3 | 8 | 6 |
| 8 | 4, 5, 6, 7 | 9, 10 | - |
| 9 | 8 | 11 | 10 |
| 10 | 8 | 11 | 9 |
| 11 | 9, 10 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. stage-shared: pure bottom-layer placement geometry (TDD)
  **What to do.** Create `packages/stage-shared/src/stage-placement/index.ts` and `index.test.ts`, and add the export `"./stage-placement": "./src/stage-placement/index.ts"` to `packages/stage-shared/package.json`, keeping the existing order style. The module is pure: no Electron, no DOM, no Vue. Export:
  - `interface PlacementRect { x: number, y: number, width: number, height: number }`
  - `bottomLayerDisplays(displays: readonly PlacementRect[]): PlacementRect[]`. A display D is excluded iff some other display E has `E.y + E.height / 2 > D.y + D.height / 2` and the x-overlap of D and E is at least `0.2 * min(D.width, E.width)`. The x-overlap is `max(0, min(D.x + D.width, E.x + E.width) - max(D.x, E.x))`.
  - `placementReference(displays): { center: number, halfSpan: number } | null`. This is the union x-span `[L, R]` of the bottom-layer displays, with `center = (L + R) / 2` and `halfSpan = (R - L) / 2`. Return `null` when the list is empty or `halfSpan <= 0`.
  - `screenInwardness(displays, headScreenX: number): number | null`. This is `u = clamp((center - headScreenX) / halfSpan, -1, 1)`. Return `null` when the reference is null or `headScreenX` is not finite. `u > 0` means inward is toward screen +x (right).
  - Each export gets a JSDoc stating its units: Electron DIP screen coordinates, y down.
  **Must NOT do.** No Electron imports. No easing or shaping (Natural owns shaping).
  **Closes.** GAP-1 (geometry half).
  **Parallelization.** Wave 1 | Blocked by: none | Blocks: 7.
  **References.**
  - Existing pure subpath modules: `packages/stage-shared/src/performance-state/index.ts`, and the package exports in `packages/stage-shared/package.json`.
  - Package test config: `packages/stage-shared/vitest.config.ts`.
  - Coordinate source: `packages/electron-eventa/src/electron/screen.ts`.
  - The decision record is the draft `.omo/drafts/natural-placement-attention.md` (Open assumptions).
  **Acceptance criteria.** First, the tests are written and fail (missing module). Then `pnpm -F @proj-airi/stage-shared exec vitest run src/stage-placement` passes all cases below and `pnpm -F @proj-airi/stage-shared typecheck` exits 0. The cases:
  - Single 1920x1080 display at (0,0), head x 100: `u` = 860/960 = 0.8958333333333333 (`toBeCloseTo(860 / 960, 12)`).
  - Two side-by-side 1920 displays at x 0 and x 1920, head x 3700: `u` = -1780/1920 = -0.9270833333333334 (`toBeCloseTo(-1780 / 1920, 12)`).
  - An upper display {x: 960, y: -1080, w: 1920, h: 1080} stacked over a bottom display {0, 0, 1920, 1080}: the upper display is excluded and the reference center is 960.
  - Staggered heights with a sliver overlap below 20%: both displays count as bottom layer.
  - A portrait display beside a landscape display.
  - Head left of all displays: `u` = 1. Head right of all displays: `u` = -1.
  - Empty list: `null`. `NaN` head: `null`.
  **QA scenarios.**
  - Happy path: `pnpm -F @proj-airi/stage-shared exec vitest run src/stage-placement --reporter=verbose > .omo/evidence/natural-placement-attention/task-1-geometry.txt`. PASS = every case reports ✓.
  - Failure path: temporarily change the overlap factor to 0 in a scratch copy, rerun, and confirm the sliver-overlap case FAILS (with factor 0, any vertically offset neighbor excludes the other). The stacked case is expected to keep passing. Capture to `task-1-geometry-mutation.txt`. Then restore.
  **Commit.** Y | `feat(stage-shared): add bottom-layer display placement geometry`
  **Recommended task executor category:** `deep-low` (pure algorithm with clear spec and edge-case tests)

- [ ] 2. stage-ui-live2d Natural: placement input, eased yaw bias, inward side draws, inward screen point (TDD)
  **What to do.**
  - **(a) New pure module `natural-motion/placement.ts`.**
    - `shapeInwardness(u: number): number` begins with `if (!(Math.abs(u) > 0.15)) return 0`, an explicit early return so the dead zone and `NaN` yield `+0`, never `-0`. Otherwise it returns `Math.sign(u) * smoothstep(Math.min(1, (Math.abs(u) - 0.15) / (0.80 - 0.15)))` with `smoothstep(t) = t*t*(3-2t)`. Its JSDoc states the handedness: positive = inward toward screen +x = positive gaze x = positive head X (`ParamAngleX`).
    - `class NaturalPlacement`:
      - `target: number`, default 0.
      - `value: number`, default 0.
      - `step(dt)`: exact first-order update `value = target + (value - target) * Math.exp(-dt / 2.0)`.
      - `set(u: number | null)`: a number sets `target = shapeInwardness(u)` and `enabled = true`, and eases toward it (a centered `u` eases back to 0). `null` is the DISABLED path: it sets `enabled = false` and immediately sets `value = 0` and `target = 0` (no easing), so the next grid step applies no yaw bias, a 0.5 side threshold, and the centered desk. This is how "setting off" and "no host signal" restore today's behavior at once.
      - Expose readonly diagnostics `value` and the controller getter `placementYawBias` (the last applied yaw bias term) for tests.
      - When `target === 0` and `value === 0`, the value stays exactly 0.
  - **(b) Controller `natural-motion.ts`.**
    - Public `setPlacement(u: number | null, nowSeconds: number)` follows the existing setter pattern (`advance(nowSeconds)` then mutate; see `setCursor` at `:264`).
    - Step the placement once per grid step.
    - Compute `yawBias = 0.10 * placement.value * (1 - this.onCursor)`. Pass it to posture as `[this.x.cursorX + yawBias, this.x.cursorY, 0]` only when `yawBias !== 0`; otherwise keep the existing literal array path unchanged (`:477`).
    - Call `gaze.setInward(placement.value)` every step.
    - Call `gaze.setScreenPointActive(energy.screen || energy.watching)` every step.
    - Use `pendingActions` so the screen-change glance uses `gaze.screenPoint()`.
  - **(c) `natural-motion/energy.ts`.** Add a public `watching = false` field, set in `setState` as `state.mode === 'watching'`. It is not subject to the cue gap.
  - **(d) `natural-motion/gaze.ts`.**
    - Add a private `inward = 0` with `setInward(w)`.
    - Change the peripheral side draw at `:337` and the aside side draw at `:166` to `this.random() < 0.5 - 0.15 * this.inward ? -1 : 1`. This is still exactly one draw, and the threshold is exactly 0.5 at `inward = 0`.
    - Add `screenPointActive` with `setScreenPointActive(b)`.
    - Add `screenPoint(): GazePoint` returning `{ x: 0.30 * this.inward, y: targets.desk.y }`.
    - In `drawTarget`, the desk branch returns `this.jittered(this.screenPointActive ? this.screenPoint() : targets.desk)`. This draws the same jitter count, and `x === 0` when `inward === 0`.
  - **(e) `natural-motion/pending-actions.ts`.** The screen-change branch glances at `gaze.screenPoint()` instead of `glanceTargets.desk`. Wake is unchanged.
  - **(f) Export.** Export `setPlacement` through the existing public surface used by the adapter. The adapter wiring itself belongs to todo 7.
  - **(g) Observer placement event.** Add `{ kind: 'placement', at: number, inward: number, yawBias: number }` to the observer event union in `natural-motion/frame-types.ts:38-76`.
    - The controller emits it through its observer whenever `|yawBias - lastEmittedYawBias| >= 0.005` or the disabled path runs.
    - It is observer-only: no pose or RNG effect, so frame hashes are unaffected.
    - Extend `natural-motion/trace.ts` serialization if it whitelists event kinds.
    - Test: in a seeded run with `setPlacement(1)` at t = 1 s, the last `placement` event before t = 30 s has `yawBias` within 0.10 ± 0.005. `setPlacement(null)` emits one event with `yawBias: 0`.
  **Must NOT do.**
  - No new RNG draws.
  - No change to body, gestures, impulses, or speech emphasis.
  - Do not edit any existing expected hash or gate band.
  - Do not use posture bias index 2 for yaw.
  **Closes.** GAP-1 (controller half), GAP-2, GAP-3, GAP-9 (placement part).
  **Parallelization.** Wave 1 | Blocked by: none | Blocks: 6, 7.
  **References.**
  - `packages/stage-ui-live2d/src/composables/live2d/natural-motion.ts`: `:43` streamIndex, `:176-178`, `:199-215` advance, `:264-285` setters, `:366-380`, `:468-494` (onCursor, follow, posture.step, slowPose compensation), `:554-563` follow.
  - `natural-motion/gaze.ts`: `:22-37` targets, `:155-173` setAside, `:189-204` glance and cursor target, `:315-345` drawTarget and jittered.
  - `natural-motion/energy.ts`: `:14-20`, `:72-163`.
  - `natural-motion/pending-actions.ts`: `:15-21`, `:85-96`.
  - `natural-motion/posture.ts`: `:136-151`.
  - `natural-motion/random.ts`: `:1-32`.
  - `natural-motion/body.ts`: `:6-8`.
  - Tests to extend: `natural-motion/gaze.test.ts`, `energy.test.ts`, `posture.test.ts`. Hash tests that must stay green unedited: `natural-motion/observer.test.ts:11-56,89-103`, `mood.test.ts:20-29,121-145`, `liveliness-gate.test.ts`.
  - `packages/stage-ui-live2d/AGENTS.md`: seeded streams, monotonic seconds, no Pixi, Vue, or window in natural-motion.
  - ADR context: `docs/ai/adr/2026-10-24-live2d-cursor-attention.md`, `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md`.
  **Acceptance criteria.** TDD order: write the new tests first and capture them failing. Then all of:
  - **(i) New `natural-motion/placement.test.ts`:** shape values at u = 0, 0.15, 0.475, 0.8, 1, and the negatives; `Object.is(shapeInwardness(x), 0)` for x in {-0, 0.1, -0.1, -0.15, NaN}; easing reaches 63.2% of the target after 2 s and stays exactly 0 with a 0 target; after a step change from 0 to 1, each 1/120 s grid step changes `value` by at most `1 - Math.exp(-(1/120)/2)` (no snap).
  - **(ii) `observer.test.ts` with `setPlacement(null)` and `setPlacement(0)`.** Add a test that runs the existing seeded idle timeline with `setPlacement(null, t)` and `setPlacement(0, t)` calls interleaved every 1 s and asserts the SAME hashes as the existing `idleHashes` for seeds 1-3.
  - **(iii) Seeded side-bias statistics in `gaze.test.ts`.** Seeded `NaturalGazeLayer`, 20 000 autonomous peripheral selections with `setInward(1)`: the share of `x > 0` is in [0.63, 0.67]; with `setInward(0)`, the share is in [0.48, 0.52]; with `setInward(-1)`, the share of `x < 0` is in [0.63, 0.67].
  - **(iv) Screen point.** With `screenPointActive` and inward 1, the mean x of desk-branch fixations is 0.30 ± 0.01. With inactive, it is 0 ± 0.01.
  - **(v) Yaw bias in a controller test.**
    - No-cursor run: seeded 120 s with `setPlacement(1)`. After 10 s, `placementYawBias` is within 0.10 ± 0.001, and mean head X minus the same seed with `setPlacement(null)` is POSITIVE and in [0.05, 0.15]. `setPlacement(-1)` mirrors both, negative.
    - Engaged-cursor run: a deterministic moving-cursor timeline, an orbit of radius 1 head width around (1.5, 0) with a 2 s period, refreshed every grid step so cursor attention stays engaged (`cursor-attention.ts:32-35` decays only a stationary cursor). On every grid step where the smoothed `onCursor` is at least 0.95, `|placementYawBias| <= 0.005`. At least 20% of the steps after warm-up meet that condition; otherwise the fixture is invalid and must be fixed.
    - **(v-b) Disable path.** After 30 s of `setPlacement(1)`, call `setPlacement(null)`. On the very next grid step, `placementYawBias === 0`, gaze `inward === 0` (side threshold exactly 0.5), and `screenPoint().x === 0`.
  - **(vi) Existing tests.** `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --config vitest.node.config.ts src/composables/live2d/natural-motion` passes with zero edits to existing expected values.
  - **(vii)** `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0.
  **QA scenarios.**
  - Happy path: `pnpm qa:motion gate liveliness --level t1` then `pnpm qa:motion gate emotion --level t1`. PASS = both verdicts identical to a baseline run on the parent commit (capture both `summary.txt` files to `task-2-t1-gates.txt`).
  - Failure paths (each a scratch edit, restored afterwards; capture both to `task-2-hash-mutation.txt`):
    - (1) Make the posture call unconditionally pass `[this.x.cursorX + 1e-6, this.x.cursorY, 0]`, which changes the head pose on every frame. Run (ii) and confirm the identity hash test FAILS.
    - (2) Flip the side remap to `0.5 + 0.15 * this.inward`. Run (iii) and confirm the side-share statistics FAIL.
  **Commit.** Y | `feat(stage-ui-live2d): bias Natural resting yaw, glance sides, and screen point toward screen placement`
  **Recommended task executor category:** `deep-low` (determinism-sensitive controller change with exact spec and hash proofs)

- [ ] 3. Settings: "Screen-aware attention" toggle, English i18n, settings UI
  **What to do.**
  - In `packages/stage-ui-live2d/src/composables/live2d/live2d.ts`, add `live2dNaturalScreenAwareness = useLocalStorageManualReset<boolean>('settings/live2d/natural-screen-awareness', true)`. Mirror `live2dNaturalCursorAttention` (`:13`): include it in the reset list (`:109-137`) and in the returned store.
  - In `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`, add a `FieldCheckbox` directly after the cursor-attention checkbox (`:459-465`), with the same `v-if="live2dMotionDriver === 'natural'"`. Keys: `settings.live2d.animation.natural-screen-awareness.title` and `.description`.
  - In `packages/i18n/src/locales/en/settings.yaml`, add under `natural-cursor-attention` (`:232-235`):
    - title: `Screen-aware attention`
    - description: `Turn slightly toward the middle of your screens when the model sits off to one side, look into the screen, and glance at the chat while you type.`
  - Extend `live2d.browser.test.ts` (`:621-635`, `:939-945`) with a case: the checkbox is visible only for the natural driver, toggles the persisted key, and is restored by reset.
  **Must NOT do.** No other locales. No consumption logic (todos 7 and 8 consume the setting).
  **Closes.** GAP-7.
  **Parallelization.** Wave 1 | Blocked by: none | Blocks: 7.
  **References.** `live2d.ts:11-17,109-137`; `live2d.vue:452-470`; `settings.yaml:222-241`; `live2d.browser.test.ts:621-635,939-945`; `packages/i18n/AGENTS.md`; `DESIGN.md`.
  **Acceptance criteria.**
  - `pnpm -F @proj-airi/stage-ui exec vitest run src/components/scenarios/settings/model-settings/live2d.browser.test.ts` passes, including the new case.
  - `pnpm -F @proj-airi/stage-ui typecheck` and `pnpm -F @proj-airi/stage-ui-live2d typecheck` exit 0.
  **QA scenarios.**
  - Happy path: the browser test run captured to `task-3-settings.txt`. PASS = the new case ✓.
  - Failure path: switch the driver to `universal` in the test. The checkbox must be absent (an assertion in the same test). Capture the output.
  **Commit.** Y | `feat(stage-ui,stage-ui-live2d,i18n): add Natural screen-aware attention setting`
  **Recommended task executor category:** `unspecified-low` (follows an existing setting pattern exactly)

- [ ] 4. stage-tamagotchi main: chat attention target pushed to the main window
  **What to do.**
  - **Contracts** in `apps/stage-tamagotchi/src/shared/eventa/index.ts`, next to the chat contracts:
    - `interface ChatAttentionTarget { visible: boolean, bounds: { x: number, y: number, width: number, height: number } | null }`, with a JSDoc noting Electron DIP screen coordinates and that the payload carries only the chat window rectangle.
    - `electronGetChatAttentionTarget = defineInvokeEventa<ChatAttentionTarget>('eventa:invoke:electron:windows:chat:attention-target:get')`
    - `electronChatAttentionTargetChanged = defineEventa<ChatAttentionTarget>('eventa:event:electron:windows:chat:attention-target-changed')`
  - **ChatWindowManager** (`apps/stage-tamagotchi/src/main/windows/chat/index.ts:73-84`) gains `getAttentionTarget(): ChatAttentionTarget` and `onAttentionTargetChange(listener): () => void`, mirroring `getButtonState`/`onButtonStateChange`.
  - **Visibility rules:**
    - Floating: `visible` is true only when the window exists, is shown, is not folded, and is not relocating, for all placements (attached, free, danmaku). Bounds come from `boundsOf(target)` (`floating.ts:119-123`).
    - Legacy: `visible` is true when the legacy window exists, is visible, and is not minimized. Bounds come from `getBounds()`.
    - Emit on change only, comparing the previous value deeply. Triggers:
      - Floating: fold or unfold (`setFolded`), relocating changes, the chat window's `move`, `resize`, `show`, `hide`, `closed`, and main-window `move` (attached chat follows).
      - Legacy: `show`, `hide`, `minimize`, `restore`, `move`, `resize`, `closed`.
      - A mode switch (`mode-switch.ts`).
  - **Main-window RPC** (`apps/stage-tamagotchi/src/main/windows/main/rpc/index.electron.ts:94-97`): register `defineInvokeHandler(context, electronGetChatAttentionTarget, () => params.chatWindow.getAttentionTarget())`, and emit on change with cleanup on `params.window.once('closed', ...)`, exactly like the chat button state.
  - **Tests:**
    - Unit-test the pure visibility and diffing logic: extract a pure `chatAttentionTargetOf(...)` helper in `apps/stage-tamagotchi/src/main/windows/chat/attention-target.ts` with `attention-target.test.ts`, covering folded, relocating, hidden, minimized legacy, and each placement.
    - Extend `mode-switch.test.ts` if mode switching changes the emitted target.
  **Must NOT do.** No renderer code (todo 8). No chat content. No new window contexts: use the existing main-window context in rpc/index.electron.ts.
  **Closes.** GAP-4.
  **Parallelization.** Wave 1 | Blocked by: none | Blocks: 8.
  **References.**
  - `floating.ts:94-160,204-241,280-341,346-486`; `chat/index.ts:73-200` (legacy creation `:153-184`); `mode-switch.ts`; `floating-placement.ts`.
  - `main/windows/main/index.ts:221-225`; `main/windows/main/rpc/index.electron.ts:42-98`; `libs/electron/window-context.ts`.
  - Rules: `apps/stage-tamagotchi/AGENTS.md` ("register window RPC before renderer load", typed eventa); `.agents/skills/eventa/SKILL.md`.
  **Acceptance criteria.**
  - `pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/main/windows/chat` passes, including the new tests.
  - `pnpm -F @proj-airi/stage-tamagotchi typecheck` exits 0.
  **QA scenarios.**
  - Happy path: unit run captured to `task-4-chat-target.txt`. PASS = all new cases ✓.
  - Failure path: a case where `folded: true` must yield `visible: false` and `relocating: true` must yield `visible: false` (both asserted).
  - Live check is deferred to todo 11.
  **Commit.** Y | `feat(stage-tamagotchi): push the chat attention target to the main window`
  **Recommended task executor category:** `unspecified-high` (Electron main-process window lifecycle across two window modes)

- [ ] 5. stage-ui: typed-send speech-bus event with word count
  **What to do.**
  - In `packages/stage-ui/src/services/speech/bus.ts`, add `chatComposerSentEvent = defineEventa<{ sourceId: string, words: number }>('eventa:chat:composer-sent')`. Its JSDoc says it carries no text, only the word count of a typed message that started sending.
  - In `packages/stage-ui/src/components/scenarios/chat/composables/use-chat-composer.ts` `submit()` (`:154-195`), right after `submitOptions?.afterSendStarted?.(submission)` (`:174`), emit `chatComposerSentEvent` with the composer's existing `activitySourceId` and `words`.
  - `words` = the count of `Intl.Segmenter(undefined, { granularity: 'word' })` segments with `isWordLike` in `submittedDraft`. Use 0 when the draft is attachments-only.
  - Do not emit for `'ignored'` returns.
  **Must NOT do.** No text in the payload. No change to send semantics or the existing activity event.
  **Closes.** GAP-5 (send half), IS-10.
  **Parallelization.** Wave 1 | Blocked by: none | Blocks: 8.
  **References.** `bus.ts:35-70`; `use-chat-composer.ts:14-17,90-115,154-206`; `use-chat-composer.test.ts:132-140` (`recordReports` pattern); `packages/stage-ui/AGENTS.md`.
  **Acceptance criteria.**
  - New tests in `use-chat-composer.test.ts`:
    - A typed send of "hello there world" emits `{ words: 3 }` once.
    - An attachments-only send emits `{ words: 0 }`.
    - An ignored submit emits nothing.
    - The payload has exactly the keys `sourceId` and `words`.
  - `pnpm -F @proj-airi/stage-ui exec vitest run src/components/scenarios/chat/composables/use-chat-composer.test.ts` passes.
  - Typecheck exits 0.
  **QA scenarios.**
  - Happy path: test run captured to `task-5-sent-event.txt`.
  - Failure path: the keys assertion fails if any text field is added (verify by a scratch mutation that adds `text`, then restore). Capture to `task-5-mutation.txt`.
  **Commit.** Y | `feat(stage-ui): announce typed chat sends with a word count on the speech bus`
  **Recommended task executor category:** `quick` (one event plus one emit with tests)

- [ ] 6. stage-ui-live2d Natural: chat attention (TDD)
  **What to do.**
  - **(a) Stream.** Append `chat: 14` to `streamIndex` (`natural-motion.ts:43`) and create the chat stream like the others (`:177`).
  - **(b) Controller input.** Add a public `setChat(chat: NaturalChatInput | null, nowSeconds: number)` with `interface NaturalChatInput { target: GazePoint | null, typing: boolean, sentSeq: number, sentWords: number, unfoldSeq: number }`.
    - `target` is the eye-anchored offset in head widths, Y up, the same units as the cursor in `setCursor`. It is mapped through `mapCursor` from `cursor-attention.ts`.
    - **Sequence lifecycle.** The host sends a non-null `NaturalChatInput` whenever the setting is on and the host supplies a chat target prop, EVEN WHILE THE CHAT IS HIDDEN (then `target: null`). `null` means the feature is off or the host is unsupported.
      - The controller keeps `seenSentSeq` and `seenUnfoldSeq` as `undefined` until the first NON-NULL input. That input only records them (no glance), exactly like `reactSeq` (`:273-285`).
      - A later non-null input whose `sentSeq` or `unfoldSeq` differs from the seen value queues a pending action and updates the seen value.
      - A `null` input leaves the seen values untouched.
      - Result: a chat that starts hidden and then opens glances exactly once (`unfoldSeq` goes 0 -> 1 after the baseline), and a chat already visible at startup does not glance.
  - **(c0) Observer glance event.** Add `{ kind: 'glance', at: number, cause: 'chat-sent' | 'chat-unfold' | 'chat-typing' | 'screen-change', point: GazePoint, hold: number }` to the Natural observer event union in `natural-motion/frame-types.ts:38-76`. Emit it through the observer `notify`, which is already threaded into pending actions at `pending-actions.ts:84`; the controller holds the same observer. Emit it when a chat glance actually starts, when the screen-change glance starts, and when a chat-branch typing fixation starts (`cause: 'chat-typing'`, `hold` = its drawn hold). Extend `natural-motion/trace.ts` serialization if it whitelists event kinds. The event is observer-only (no pose or RNG effect), so frame hashes are unaffected.
  - **(c) PendingAction.** Add `{ kind: 'chat', cue: 'sent' | 'unfold', words: number }` to `pending-actions.ts`.
    - **sent:** store `chatGlance = { at: at + delay, point: mapCursor(target).eye, hold, cause: 'chat-sent' }` with `delay = 0.18 + 0.12 * chatRandom()` and `hold = clamp(0.5 + 0.25 * words, 0.6, 3.0)`. On the first grid step with `stepStart >= chatGlance.at`, call `gaze.glance(point, hold, stepStart)`. `glance` passes an explicit hold to `saccadeTo`, so it makes no gaze-stream draw (`gaze.ts:189-191,314`). Then emit the observer event and clear `chatGlance`.
    - **unfold:** delay 0.25 and hold 0.8, with no draw.
    - Implement the delay as a controller deadline field checked each step, not a timer.
    - Skip either cue (consume it without glancing) when the target is null, the mode is talking, the pet override is active, or `stepStart < petGlanceUntil`.
  - **(d) Gaze.** Add `setChatTarget(point: GazePoint | null, typing: boolean)`.
    - In `drawTarget`, after the override and aside branches and before the cursor branch, add `if (this.chatPoint && this.chatTyping && this.chatRandom() < 0.35) { this.onChat = true; return this.jitteredWith(this.chatPoint, this.chatRandom) }`.
    - Add a private `jitteredWith(point, random)` that applies the same two-gaussian jitter as `jittered()` but draws from the given stream. `jittered()` itself is unchanged and keeps using the gaze stream.
    - The fixation hold of a chat-branch fixation also draws from `chatRandom`. `saccadeTo(target, at, hold?, catchUp)` (`gaze.ts:301-317`) draws `hold ?? this.drawHold()` (`:314`, `drawHold` at `:348`).
      - Give `drawHold` an optional `random = this.random` parameter.
      - Replace the four `this.saccadeTo(this.drawTarget(), ...)` call sites (`gaze.ts:140,148,181,199`) with a private `fixateNext(at)` that does `const target = this.drawTarget(); this.saccadeTo(target, at, this.onChat ? this.drawHold(this.chatRandom) : undefined)`.
      - When the chat branch was not taken, `hold` is `undefined`, so `saccadeTo` draws exactly as today and no-signal behavior is unchanged.
    - The gaze layer receives the chat stream as a constructor or setter dependency (`chatRandom`). EVERY chat-related draw (branch, jitter, send delay) uses `chatRandom`, never the gaze stream.
    - Expose an `onChat` flag that is cleared when another target is chosen.
    - With no chat point or not typing, there is no draw and no branch.
  - **(e) Head follow.** Smooth `this.onChatLevel` like `onCursor` (`:470`).
    - When `onChatLevel > 0`, add `0.6 * onChatLevel * mapCursor(target).head` to the follow target, in the same way as the cursor term at `:472-475`. Guard with `!== 0` so the no-chat path is untouched.
    - Typing fixations are suppressed while talking (`energy` mode talking).
    - **Disable path.** `setChat(null)` immediately does all of the following:
      - clears the gaze chat point and typing;
      - sets `onChat = false` and `onChatLevel = 0`, so no head-follow term is added on the next step;
      - cancels any scheduled chat-glance deadline;
      - if the current fixation came from the chat branch, starts a new fixation at once through `fixateNext(at)`.
      The same applies to a non-null input whose `target` becomes `null` (chat hidden), except that the sequences are kept.
  - **(f) Typing gate.** `typing` arrives already computed by the host as "last input within 1.5 s"; the controller does not read clocks.
  **Must NOT do.**
  - No draws on the gaze or posture streams for chat.
  - No change at `setChat(null)` or without chat input.
  - Do not edit existing hashes.
  **Closes.** GAP-6, GAP-9 (chat part).
  **Parallelization.** Wave 2 | Blocked by: 2 | Blocks: 8.
  **References.**
  - `natural-motion.ts:41-43,170-200,264-285,330-420,468-494,554-563`.
  - `gaze.ts:155-204,315-345`; `cursor-attention.ts:52-66` (mapCursor); `pending-actions.ts:15-100`; `energy.ts:14-20,94-163`.
  - Priority source of truth: the draft's Open assumptions (chat timings) and this todo.
  **Acceptance criteria.** TDD: write the tests first and capture them failing. Then:
  - **(i) Identity.** An observer-hash test interleaving `setChat(null)` every 1 s matches the existing `idleHashes` (seeds 1-3).
  - **(ii) Chat share.** Seeded 300 s idle run with `setChat({ target: {x: -3, y: -1}, typing: true, ... })`: the share of fixation time with `onChat` is in [0.25, 0.45]. With `typing: false`, it is 0.
  - **(iii) Sent cue.** Incrementing `sentSeq` with words 8 produces exactly one observer `glance` event with `cause: 'chat-sent'`, a hold of 2.5 s ± 1 grid step, starting 0.18-0.30 s after the call. While in talking mode the same cue produces no glance event. With a null target (folded or minimized chat), the cue is consumed with no glance; this is the intended rule, and the ADR records it.
  - **(iv) Unfold cue and lifecycle.**
    - Incrementing `unfoldSeq` produces a `glance` with `cause: 'chat-unfold'` 0.25 s later, held 0.8 s.
    - Hidden-first: inputs `{target: null, unfoldSeq: 0}` then `{target: X, unfoldSeq: 1}` produce exactly one unfold glance.
    - Visible-first: a first input `{target: X, unfoldSeq: 0}` produces none.
    - `null` -> `{target: X, unfoldSeq: 0}` produces none.
    - A `null` input between two non-null inputs with an unchanged `unfoldSeq` produces none.
  - **(iv-b) No chat-stream use without chat.** In `gaze.test.ts`, construct `NaturalGazeLayer` with a spy `chatRandom` and run 10 000 selections with no chat point, and again with a chat point but `typing: false`. The spy has 0 calls. With chat and typing, it has more than 0 calls. A second spy wraps the gaze stream: across fixations started by the chat branch (`onChat` true afterwards), covering selection, jitter, and the fixation hold drawn by `saccadeTo`/`drawHold`, the gaze spy records 0 calls. So chat fixations draw only from `chatRandom`. Exact no-signal identity stays proven by test (i).
  - **(v) Head follow.** Mean head X moves toward the chat side by at least 0.03 during chat fixations versus none.
  - **(v-b) Chat disable path.** During an active chat fixation with a pending sent-glance deadline, call `setChat(null)`. On the next grid step, `onChat` is false, the chat head-follow term is 0, the fixation target is not the chat point, and the pending glance never fires: no `glance` event with `cause: 'chat-sent'` within the following 5 s.
  - **(vi)** The full natural-motion suite passes, and `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0.
  **QA scenarios.**
  - Happy path: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --config vitest.node.config.ts src/composables/live2d/natural-motion` captured to `task-6-chat.txt`.
  - Failure path: a scratch mutation that calls `chatRandom()` in `drawTarget` even without a chat point makes test (iv-b) FAIL (the spy counts more than 0). A second scratch mutation that uses `this.jittered(this.chatPoint)` (the gaze stream) makes the (iv-b) gaze-spy assertion (0 gaze-stream calls on chat-branch selections) FAIL. Capture both to `task-6-mutation.txt`, then restore.
  **Commit.** Y | `feat(stage-ui-live2d): add Natural chat attention with typing fixations and read glances`
  **Recommended task executor category:** `deep-low` (behavior spec is fixed; determinism proofs are tests)

- [ ] 7. Placement host plumbing: Tamagotchi -> Stage -> Live2D -> Model.vue -> adapter
  **What to do.**
  - **(a) Tamagotchi page.** In `apps/stage-tamagotchi/src/renderer/pages/index.vue`, build `screenPlacement = computed(() => ({ displays: allDisplays.value.map(d => d.bounds), windowBounds: { x, y, width, height } }))` from `useElectronAllDisplays()` and `useElectronWindowBounds()` (`packages/electron-vueuse`). Pass `:screen-placement` to `WidgetStage` next to `:cursor-position` (`:463-469`). Web and pocket are untouched, so their prop stays undefined.
  - **(b) Stage.** `packages/stage-ui/src/components/scenes/Stage.vue` adds the optional prop `screenPlacement?: { displays: PlacementRect[], windowBounds: PlacementRect }`, using the type from `@proj-airi/stage-shared/stage-placement`. It forwards the prop only on the Live2D branch (`:898-902`).
  - **(c) Live2D.** `packages/stage-ui-live2d/src/components/scenes/Live2D.vue` declares the prop and forwards it to Model.
  - **(d) Model.**
    - In `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`, the attention callback (`:610-656`) computes `placement: number | null`:
      - `null` unless `live2dNaturalScreenAwareness` is true and `screenPlacement` is present.
      - Otherwise compute `headRect = headViewportRect()` (`:1234-1255`) and `scale = windowBounds.width / document.documentElement.clientWidth`, which converts CSS px to DIP and handles zoom. `clientWidth` excludes scrollbars, and the main window is frameless, so `getBounds()` equals the content bounds (`apps/stage-tamagotchi/src/main/windows/shared/window.ts:34-36`).
      - Then `headScreenX = windowBounds.x + (headRect.x + headRect.width / 2) * scale`, and `placement = screenInwardness(displays, headScreenX)`.
    - A QA override `naturalDiagnostics.placementOverride` (new `shallowRef<number | null | undefined>(undefined)` in `packages/stage-ui-live2d/src/stores/natural-motion-diagnostics.ts`, exposed in its return object near `:393`) wins when not `undefined`. A `null` override forces no signal.
  - **(e) Adapter.** `Live2DNaturalMotionAttention` (`:23-54`) gains `placement: number | null`, and the adapter forwards `controller.setPlacement(attention.placement, this.time)` right after `setCursor` (`:323`). T1 `scenario-sink.ts` must still compile: pass `placement: null` there (todo 9 adds events).
  **Must NOT do.**
  - No geometry math outside `@proj-airi/stage-shared/stage-placement`.
  - No placement for non-natural drivers: the adapter is only active for natural, `natural-motion-adapter.ts:289`.
  - No changes to web or pocket pages.
  - Do not reuse `headAnchor()`, which is in parent space.
  **Closes.** GAP-1 (host half).
  **Parallelization.** Wave 2 | Blocked by: 1, 2, 3 | Blocks: 8.
  **References.**
  - `apps/stage-tamagotchi/src/renderer/pages/index.vue:76,420-423,463-469`.
  - `packages/electron-vueuse/src/composables/use-electron-all-displays.ts:7-17`, `use-electron-window-bounds.ts:14-30`; `apps/stage-tamagotchi/src/main/services/electron/window.ts:36-41`.
  - `Stage.vue:60-64,898-902`; `Live2D.vue:28-55,135-140,198-228`.
  - `Model.vue:82-130,167-169,610-670,1143-1145,1234-1255`.
  - `natural-motion-adapter.ts:23-54,283-335`; `natural-motion-diagnostics.ts:170-200,380-400`; `packages/qa-tools/src/motion/scenario-sink.ts:174-212`.
  - `packages/stage-ui/AGENTS.md` (component API edits update `docs/assets/ai/context/ui-components.md` only for shared primitives; Stage is a scene, so record the prop in the Stage JSDoc).
  **Acceptance criteria.**
  - A unit test for the pure host math: extract `headScreenX(windowBounds, clientWidth, headRect)` into `packages/stage-ui-live2d/src/composables/live2d/screen-placement.ts`, with a test for zoom 1 and 1.25.
  - The adapter test (existing adapter tests, or a new `natural-motion-adapter.test.ts` case) verifies that `placement` is forwarded to `setPlacement`, and that a `null` placement equals the old behavior.
  - Typecheck exits 0 for stage-ui, stage-ui-live2d, stage-tamagotchi, and qa-tools.
  - `pnpm verify` is green.
  **QA scenarios.**
  - Happy path: unit runs captured to `task-7-plumbing.txt`.
  - QA bridge support, added here because this todo's live check needs it:
    - `natural-motion-diagnostics.ts` gains a readonly `lastPlacement: number | null`, updated by Model.vue each time the attention callback builds `placement`. It also gains `lastPlacementYawBias: number`, copied after each adapter step from the controller getter `placementYawBias` (todo 2).
    - In `packages/stage-shared/src/motion-scenario/bridge.ts`, `MotionQaConfigureInputSchema` (`:40-46`) gains `screenAwareness: optional(boolean())`. `MotionQaStateSchema` (`:23-37`) gains `screenAwareness: boolean()`, `placement: nullable(pipe(number(), finite()))`, and `placementYawBias: pipe(number(), finite())`.
    - In `use-motion-qa-bridge.ts`, configure (`:245-248`) writes `live2d.live2dNaturalScreenAwareness` when it is defined, and state (`:90-100`) reads `screenAwareness`, `placement`, and `placementYawBias`.
    - Extend `bridge.test.ts` and `use-motion-qa-bridge.test.ts` for the configure round-trip and the new state fields.
  - Live check: start the app with the QA bridge enabled the way `packages/qa-tools/src/t3/run-t3.ts` launches it (dev, `APP_MOTION_QA_BRIDGE`, `APP_REMOTE_DEBUG`). Import ForBOOTH through the bridge `importModelFromInput`, as run-t3 does, and NEVER call `runScenario` during this check: from todo 9 on, `runScenario` pins the overrides to no-signal, and only real host signals are under test here. The same rule applies to todo 8's live check and to F3. Then:
    - Call the bridge `state` through the same client `run-t3.ts` uses, from a tsx script saved under `.omo/evidence/natural-placement-attention/`.
    - Configure `screenAwareness: true`, move the main window to the right edge through the main-window invoke `electron.window.setBounds` (`packages/electron-eventa/src/electron/window.ts:9`), wait about 1 s, and read `state.placement`. PASS = it is below -0.5.
    - Capture `task-7-live.json`.
  - Failure path: configure `screenAwareness: false`. `state.placement` must be `null`.
  - Tear down Electron and record a receipt.
  **Commit.** Y | `feat(stage-tamagotchi,stage-ui,stage-ui-live2d): feed screen placement into Natural`
  **Recommended task executor category:** `unspecified-high` (cross-package Vue/Electron plumbing with live verification)

- [ ] 8. Chat host plumbing: chat target, typing, send, and unfold into Natural
  **What to do.**
  - **(a) Tamagotchi page.** In `apps/stage-tamagotchi/src/renderer/pages/index.vue`, subscribe with the app's eventa renderer context: `useElectronEventaContext` / `useElectronEventaInvoke`, as `App.vue:5,86` does. Subscribe to `electronChatAttentionTargetChanged` before invoking `electronGetChatAttentionTarget` for the snapshot, the same order as `chat-floating.vue:32-51`. Pass `:chat-target="chatTarget"` (type `ChatAttentionTarget | null`) to `WidgetStage`.
  - **(b) Stage.**
    - `Stage.vue` declares `chatTarget?: { visible: boolean, bounds: PlacementRect | null }` and subscribes on `getSpeechBusContext()` to `chatComposerActivityChangedEvent` and `chatComposerSentEvent`, like `speechInputUserSpeakingChangedEvent` at `:477-482`, with disposal.
    - It derives `chatActivity = { typing, sentSeq, sentWords }`:
      - `typing` = some composer source reported `hasDraft` with `Date.now() - lastInputAtMs <= 1500`, re-evaluated on the existing 250 ms performance tick.
      - `sentSeq` increments per sent event, and `sentWords` is the last count.
    - It forwards `chatTarget` and `chatActivity` on the Live2D branch.
  - **(c) Live2D.** `Live2D.vue` forwards both.
  - **(d) Model.**
    - `Model.vue` computes `chat: NaturalChatInput | null` in the attention callback.
      - It is `null` only when the setting is off, or the `chatTarget` prop is `undefined` (web, pocket).
      - Otherwise it is an object: `target` is `null` unless `chatTarget.visible` and bounds and `screenPlacement` exist, and `typing`/`sentSeq`/`sentWords` come straight from `chatActivity`.
      - This follows the sequence lifecycle defined in todo 6 (b): hidden chat sends an object with a null target, so opening later glances once.
    - `target` = the chat bounds center converted to client CSS px: `(center - windowBounds.x) / scale`, using `screenPlacement.windowBounds` and the same `scale` as todo 7. Then convert to an eye-anchored head-width offset, Y up, with the SAME conversion the cursor uses at `:614-631`.
    - `unfoldSeq` increments on each `visible` false -> true transition observed in Model. The first observation does not increment.
    - `naturalDiagnostics.chatOverride` (new `shallowRef<NaturalChatInput | null | undefined>(undefined)`) wins when defined.
  - **(e) Adapter.** `Live2DNaturalMotionAttention` gains `chat: NaturalChatInput | null`, and the adapter forwards `controller.setChat(attention.chat, this.time)` after `setPlacement`. `scenario-sink.ts` passes `chat: null`.
  **Must NOT do.**
  - No chat text anywhere.
  - Constraint, stated in a code comment at the subscription: the speech bus is one shared BroadcastChannel per page (`bus.ts:55-67`), and BroadcastChannel never delivers to its own posting object. Only composers in OTHER windows (the Tamagotchi floating and legacy chat) reach Stage; a composer in the same page as Stage (web, pocket) is not heard. Web and pocket pass no `chatTarget`, so their counters stay inert.
  - No new BroadcastChannel names: reuse `getSpeechBusContext()`.
  - No changes to `chat.ts` store semantics.
  - Do not trigger the read glance from voice sends, which never emit `chatComposerSentEvent`.
  **Closes.** GAP-4 (renderer half), GAP-5.
  **Parallelization.** Wave 3 | Blocked by: 4, 5, 6, 7 | Blocks: 9, 10.
  **References.**
  - Todo 4 and todo 5 outputs.
  - `Stage.vue:260-285,466-530`; `speech/bus.ts:35-70`; `use-chat-composer.ts:14-17,90-115`.
  - `Model.vue:610-656` (cursor offset conversion), `:1234-1255`.
  - `apps/stage-tamagotchi/src/renderer/App.vue:5,86`; `chat-floating.vue:32-51`.
  - `packages/stage-ui/AGENTS.md` (chat and store rules); `.agents/skills/eventa/SKILL.md`.
  **Acceptance criteria.**
  - **Unit:**
    - A pure helper `chatActivityFrom(reports, nowMs)` in `packages/stage-ui/src/components/scenes/chat-activity.ts`, with tests: typing true within 1.5 s with a draft; false at 1.6 s; false with `hasDraft: false`; and multiple sources combined. Add an attention-builder test that with `chatTarget` undefined the chat input is `null` even after sent events, so web stays inert.
    - A pure `chatTargetOffset(...)` in `packages/stage-ui-live2d/src/composables/live2d/screen-placement.ts`, with a test that the left-of-window chat yields negative x.
  - Typecheck exits 0 for all four packages, and `pnpm verify` is green.
  **QA scenarios.**
  - **Live (agent-browser-electron against the dev app):**
    - Open the floating chat via `electronOpenChat`.
    - QA readout, needed here: `natural-motion-diagnostics.ts` gains a readonly `lastChat: { hasTarget: boolean, typing: boolean, sentSeq: number, unfoldSeq: number } | null`, updated by Model.vue. `MotionQaStateSchema` gains `chat: nullable(strictObject({ hasTarget: boolean(), typing: boolean(), sentSeq: number(), unfoldSeq: number() }))`, read in the bridge state. Extend the bridge tests.
    - Natural observer events are read from a Natural capture started through the bridge `startCapture`/`awaitCapture`, as `run-t3.ts` does.
    - Focus the composer and type "testing the glance" with real key events. Within 1 s, bridge `state.chat` shows `hasTarget: true, typing: true`. This live check proves signal delivery only. The rendered controller is unseeded (`Model.vue:655`), so typing-glance counts are proven by the seeded tests in todo 6 (ii) and the seeded T1 run in todo 9, not here.
    - Send with Enter, then assert an observer event `{ kind: 'glance', cause: 'chat-sent' }` with a hold of 1.25 s ± 0.1 is recorded, captured through the devtools Natural Motion Lab trace capture or the QA bridge capture.
    - Fold the chat, then assert bridge `state.chat` is non-null with `hasTarget: false`, and that no `glance` with a `chat-*` cause follows in the next 5 s. A whole-input `null` is reserved for the setting being off or an unsupported host.
    - Capture `task-8-live.json` plus a screenshot.
  - **Failure path:** with the setting off, there is no chat input and no glance. Assert it and capture.
  - Tear down Electron and record a receipt.
  **Commit.** Y | `feat(stage-tamagotchi,stage-ui,stage-ui-live2d): feed chat target, typing, and sends into Natural`
  **Recommended task executor category:** `unspecified-high` (cross-window signals with live Electron verification)

- [ ] 9. QA hooks: scenario events, T1 sink, T3 bridge pin and overrides
  **What to do.**
  - **(a) Scenario events** in `packages/stage-shared/src/motion-scenario/schema.ts` (`:29-48`). Add:
    - `strictObject({ kind: literal('placement'), at, inward: nullable(pipe(number(), finite(), minValue(-1), maxValue(1))) })`
    - `strictObject({ kind: literal('chat-target'), at, x: optional(finite), y: optional(finite), clear: optional(literal(true)) })`, with the same pairing validation as `cursor` (`:97-98`).
    - `strictObject({ kind: literal('chat-typing'), at, active: boolean() })`
    - `strictObject({ kind: literal('chat-sent'), at, words: pipe(number(), integer(), minValue(0)) })`
    - `strictObject({ kind: literal('chat-unfold'), at })`
    - These are allowed at T1, T2, and T3. Document them in the schema JSDoc.
  - **(b) T1 sink.** `packages/qa-tools/src/motion/scenario-sink.ts` (`:247-305`) applies the events to the adapter attention:
    - `placement` sets `placement`.
    - `chat-target`, `chat-typing`, `chat-sent`, and `chat-unfold` maintain a `NaturalChatInput`: a sent event increments `sentSeq` and sets `sentWords`; an unfold event increments `unfoldSeq`.
  - **(c) Bridge configure and state.** Todo 7 already added the `screenAwareness` configure field, the `screenAwareness` and `placement` state fields, and their tests. Todo 8 added the `chat` state field. This todo only uses them; do not re-add them.
  - **(d) Bridge dispatch.**
    - `use-motion-qa-bridge.ts` `dispatchEvent` (`:141-176`) handles the new kinds by writing `naturalDiagnostics.placementOverride` and `chatOverride`, maintaining the sequences like the T1 sink.
    - At the start of each `runScenario`, set both overrides to explicit NO-SIGNAL values: `placementOverride = null` and `chatOverride = null`. This means a scenario never sees the real window position or real chat activity; only its own events drive these inputs.
    - On bridge disposal, restore both to `undefined`, which hands control back to the host signals. This follows the postureHome lifecycle in `packages/qa-tools/README.md:112`.
    - Test in `use-motion-qa-bridge.test.ts`: after `runScenario` of a scenario without placement events, the override is `null`, not `undefined`. After disposal, it is `undefined`.
  - **(e) T3 runner default.** `packages/qa-tools/src/t3/run-t3.ts` (`:157-159`) MUST pass `screenAwareness` explicitly on EVERY T3 configure, because the T3 profile persists localStorage and the setting defaults to `true`: `true` iff the scenario contains a `placement` or `chat-*` event, otherwise `false`. `t3-scenario.ts` gate scenarios configure `false` and extend the assertion list at `:367-385` with `bridge.configured.screenAwareness === false`.
  - **(f) Builtin scenario.** Add `builtin:t3-screen-attention` in the qa-tools builtin scenario registry, next to `t3-smoke` and `t3-touch`. Use home `desk` and no pointer events. The timeline:

    | Time | Event |
    | --- | --- |
    | 0 s | `placement` 0 |
    | 20 s | `placement` 1 |
    | 50 s | `placement` -1 |
    | 80 s | `chat-target` {x: -3, y: -1}, `chat-typing` true |
    | 100 s | `chat-sent` words 8, `chat-typing` false |
    | 110 s | `chat-unfold` |
    | 130 s | end |
  **Must NOT do.** Do not change existing gate scenarios, bands, or verdict logic. Do not enable screen awareness for existing T3 gates.
  **Closes.** GAP-8, IS-9.
  **Parallelization.** Wave 4 | Blocked by: 8 | Blocks: 11.
  **References.**
  - `packages/stage-shared/src/motion-scenario/schema.ts:20-101`, `bridge.ts:1-95`, and the tests `bridge.test.ts`, `scenario.test.ts`, `dispatch.test.ts`.
  - `packages/qa-tools/src/motion/scenario-sink.ts:174-305`; `packages/qa-tools/src/t3/run-t3.ts:91-93,157-190`; `packages/qa-tools/src/motion/gate/t3-scenario.ts:50-53,367-385`.
  - `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts:90-300` and `use-motion-qa-bridge.test.ts:150-175`.
  - `packages/qa-tools/README.md`; `.agents/skills/motion-qa/SKILL.md`.
  **Acceptance criteria.**
  - **Schema tests:** each new event validates, and malformed ones are rejected: `inward` 1.5, a chat-target with only x, negative words.
  - **Sink test:** a scenario with the new events drives `setPlacement`/`setChat` with the expected values.
  - **Bridge test:** the configure/state round-trip of `screenAwareness`, and the overrides reset on `runScenario` and disposal.
  - **T3 gate scenario test:** asserts `screenAwareness: false`.
  - `pnpm -F @proj-airi/stage-shared exec vitest run src/motion-scenario`, `pnpm -F @proj-airi/qa-tools exec vitest run`, and `pnpm -F @proj-airi/stage-ui exec vitest run src/composables/performance` pass. Typechecks exit 0.
  **QA scenarios.**
  - Happy path: `pnpm qa:motion gate liveliness --level t1` and `pnpm qa:motion gate emotion --level t1` give verdicts identical to the todo-2 baseline. Capture `task-9-t1-gates.txt`.
  - A T1 run of `builtin:t3-screen-attention` via the T1 path documented in the qa-tools README shows mean head X during 20-50 s greater than during 50-80 s by at least 0.12. Across T1 runs of that scenario with seeds 1-10, the observer events contain at least 10 `glance` events with `cause: 'chat-typing'` in total during 80-100 s, and every seed has exactly one `chat-sent` glance and one `chat-unfold` glance. Capture `task-9-t1-screen.json`.
  - Failure path: the schema rejects `{kind:'placement', inward: 2}` (asserted in the test output).
  **Commit.** Y | `feat(stage-shared,qa-tools,stage-ui): drive Natural placement and chat attention from motion scenarios`
  **Recommended task executor category:** `unspecified-high` (spans the shared contract, QA harness, and bridge)

- [ ] 10. Docs: README Natural section and ADR
  **What to do.**
  - Update the `packages/stage-ui-live2d/README.md` Natural section (around line 50) and its settings section. Describe:
    - the placement inwardness and its bottom-layer reference;
    - the eased yaw bias that fades on cursor;
    - the inward side draws and the screen point (screen attention plus watching mode, a choice to revisit later per Luke);
    - chat attention (typing fixations, send and unfold glances, replies on camera);
    - the "Screen-aware attention" setting, and Natural-only scope.
  - Create `docs/ai/adr/2026-10-26-natural-screen-aware-attention.md` following the format of `docs/ai/adr/2026-10-24-live2d-cursor-attention.md`. Record:
    - the decisions and their rationale: head-only turn per rig physics (Bear `PhysicsSetting1` AngleX->BodyAngleX at weight 100; ForBOOTH BodyAngleX as a physics input, body follower 0.99); the differential-rotation reason for a subtle turn; one toggle; Natural only;
    - the constants with their sources;
    - the determinism contract (no new draws, appended stream 14);
    - the QA hooks;
    - the open tuning items for joint QA.
  - Add a one-line mention in `packages/qa-tools/README.md` of the new scenario events and `builtin:t3-screen-attention`.
  **Must NOT do.** No translations. No restating of code. No marketing tone.
  **Closes.** GAP-10.
  **Parallelization.** Wave 4 | Blocked by: 8 | Blocks: 11.
  **References.** `packages/stage-ui-live2d/README.md`; `docs/ai/adr/2026-10-24-live2d-cursor-attention.md`; `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md`; `docs/ai/adr/2026-10-25-natural-idle-reshape-and-emotion-ducking.md`; root `AGENTS.md` Unique Styles; `packages/qa-tools/README.md`.
  **Acceptance criteria.**
  - `pnpm lint` on the changed markdown passes, via the `pnpm verify` lint step.
  - The ADR contains sections Context, Decision, Consequences, and Open items.
  - The README names the setting key `settings/live2d/natural-screen-awareness`.
  - `git diff --check` is clean.
  **QA scenarios.**
  - Happy path: `pnpm verify` output captured to `task-10-verify.txt`.
  - Failure path: `rg -n "natural-screen-awareness" packages/stage-ui-live2d/README.md docs/ai/adr/2026-10-26-natural-screen-aware-attention.md` must return at least 2 hits. Zero hits fails. Capture the output.
  **Commit.** Y | `docs(stage-ui-live2d): document Natural screen-aware attention`
  **Recommended task executor category:** `writing` (prose documentation)

- [ ] 11. Rendered end-to-end QA on ForBOOTH (T3) plus live chat check
  **What to do.**
  - Run `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-screen-attention` with `AIRI_QA_RIG_FORBOOTH` set. Warn Luke before starting, since T3 parks the cursor; see `.agents/skills/motion-qa/SKILL.md`.
  - Score from the captured `trace.json`:

    | Check | Window | Pass condition |
    | --- | --- | --- |
    | (a) The last observer `placement` event at or before 45 s, and at or before 75 s, in the capture's Natural events | at 45 s and at 75 s | `yawBias` 0.10 ± 0.01 at 45 s; -0.10 ± 0.01 at 75 s. This is deterministic, because no cursor runs in T3 and easing finishes within 10 s. The mean `ParamAngleX` difference between 30-50 s and 60-80 s is REPORTED for Luke's visual QA but is not a gate, since unseeded idle motion makes it noisy. |
    | (b) Bridge `state.chat` sampled once | 85-95 s | `hasTarget: true, typing: true` (signal delivery; typing-glance counts are proven by the seeded T1 run in todo 9) |
    | (c) Observer `glance` with `cause: 'chat-sent'` | Starts within 0.35 s of the `chat-sent` event | Hold 2.5 s ± 0.2 |
    | (d) Observer `glance` with `cause: 'chat-unfold'` | Starts within 0.35 s of `chat-unfold` | — |
    | (e) Screenshots | 45 s and 75 s | Files exist (the visual comparison is Luke's later QA, not an acceptance gate) |

  - Then rerun `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-smoke` and confirm that it passes as before, with the bridge state `screenAwareness: false`.
  - Then run the existing rendered liveliness gate on this HEAD: `pnpm qa:motion gate liveliness --level t3 --rig forbooth`. Warn Luke first, because this is a long cursor-parked run. Assert that every session's recorded bridge state shows `screenAwareness: false` and `cursorAttention: false`. Record its verdict next to the most recent accepted T3 liveliness verdict under `.omo/evidence/qa-tooling/` or `.omo/evidence/motion-gate-redesign/`, with a note that verdicts are noise-limited and that input identity is the binding proof. Write this as `task-11-t3-gates.md`. The emotion T3 gate is not rerun: its inputs are proven identical by the same bridge-state assertion, and its known persistent noise failures make verdict comparison non-probative.
  - Write a `.omo/evidence/natural-placement-attention/task-11-report.md` summarizing (a)-(e), with the run directories.
  **Must NOT do.** No unattended long gate reruns without warning Luke. Do not change bands.
  **Closes.** Proves IS-1, IS-2, IS-3 (indirectly through the T1 statistics in todo 2), IS-4, IS-5, IS-9 on the real renderer.
  **Parallelization.** Wave 5 | Blocked by: 9, 10 | Blocks: F1-F4.
  **References.** `packages/qa-tools/README.md` (T3 runs, cursor parking); `.agents/skills/motion-qa/SKILL.md`; `packages/qa-tools/src/t3/run-t3.ts`; `packages/stage-ui-live2d/src/composables/live2d/natural-motion/trace.ts`.
  **Acceptance criteria.**
  - Checks (a)-(d) PASS numerically from the trace (a script in the evidence directory computes them).
  - The screenshots exist.
  - The t3-smoke run passes.
  **QA scenarios.**
  - Happy path: the two T3 run directories plus `task-11-report.md`.
  - Failure path (control run, which shows the measurement is sensitive): build a control scenario file `.omo/evidence/natural-placement-attention/t3-screen-attention-control.json` that is `builtin:t3-screen-attention` with every `placement` event replaced by `noop`. Use `packages/stage-shared/src/motion-scenario/strip.ts`, or edit the JSON with the same timeline and `{kind:'noop', replaced:...}` semantics; if `noop` cannot replace `placement`, delete those events. Run it as a NEW T3 capture: `pnpm qa:motion t3 --rig forbooth --scenario <that file>`. On that new capture, check (a) must FAIL: there is no `placement` event with a nonzero `yawBias`, because the scenario pins placement to no signal. Capture the run dir and the score output.
  - Teardown: confirm no Electron or stage-tamagotchi process of this worktree remains (process list output saved as a receipt).
  **Commit.** N (evidence only) | -
  **Recommended task executor category:** `unspecified-high` (rendered QA run and trace scoring)

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
  Check every todo's acceptance criteria and Must-NOT against the diff (`git diff <base>..HEAD`). Confirm that no existing hash expectations, gate bands, other locales, or pre-existing dirty files were touched. Recommended task executor category: `unspecified-high`.
- [ ] F2. Code quality review
  Review against `.agents/skills/enforce-rules-for-typescript` and `enforce-rules-for-vitest`: no `any`, Valibot at the edges, eventa contracts centralized, no defensive checks inside trusted code, deterministic tests with no sleeps. Recommended task executor category: `unspecified-high`.
- [ ] F3. Real manual QA
  Run the live Electron scenarios from todos 7, 8, and 11 again on the final HEAD:
  - Window at the right edge, then the left edge.
  - Typing and send in the floating chat in attached placement and in free placement.
  - The legacy chat window opened.
  - The setting toggled off, which must restore today's behavior: placement and chat inputs `null`.
  Capture screenshots and trace excerpts, and verify the ParamAngleX sign on ForBOOTH (mirrored-rig risk). Recommended task executor category: `unspecified-high`.
- [ ] F4. Ideal-state fidelity
  Check the delivered behavior against IS-1..IS-11 one to one, using the Success criteria table. Any shortfall becomes new `- [ ] N.` todos. Recommended task executor category: `unspecified-high`.

## Commit strategy
- One Conventional Commit per implementation todo (1-10), each green on its own: tests, typecheck, and `pnpm verify`. Todo 11 is evidence only.
- Scopes use package names without `@proj-airi/` (for example `stage-ui-live2d`, `stage-tamagotchi`, `stage-shared`, `qa-tools`, `stage-ui`, `i18n`), matching `git log`, e.g. `fix(stage-ui): ...`.
- Stage only the files the todo names. Never stage the pre-existing dirty files listed in Must NOT have.
- Documentation lives in todo 10's commit. No agent-configuration changes in this plan.
- Final commit footer: `Plan: .omo/plans/natural-placement-attention.md`

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 1, 2, 7 | Todo 1 geometry cases (stacked, staggered); todo 2 (v) yaw bias; todo 7 live right-edge placement; todo 11 (a) and (e) | task-1-geometry.txt, task-2-*.txt, task-7-live.json, task-11-report.md |
| IS-2 | 2, 7 | Todo 2 (v) cursor fade and easing test (placement.test.ts); F3 drag check | task-2-*.txt, F3 artifacts |
| IS-3 | 2 | Todo 2 (iii) seeded side-share statistics | task-2-*.txt |
| IS-4 | 2, 9 | Todo 2 (iv) screen point; todo 9 T1 screen scenario; todo 11 | task-2-*.txt, task-9-t1-screen.json |
| IS-5 | 4, 5, 6, 8, 11 | Todo 6 (ii)-(iv); todo 8 live typing/send/fold; todo 11 (b)-(d); F3 legacy and free placement | task-6-chat.txt, task-8-live.json, task-11-report.md |
| IS-6 | 2, 3, 6, 7, 8 | Todo 3 browser test; todo 2 (v-b) and todo 6 (v-b) immediate disable paths; todo 7 and 8 setting-off failure paths | task-2-*.txt, task-3-settings.txt, task-6-chat.txt, task-7-live.json, task-8-live.json |
| IS-7 | 2, 7 | Adapter active only for natural (`natural-motion-adapter.ts:289`); F1 diff audit shows no VRM, web, or pocket edits | F1 report |
| IS-8 | 2, 6, 9 | Observer identity tests (todo 2 (ii), todo 6 (i)); T1 gate verdict equality (todos 2, 9) | task-2-t1-gates.txt, task-9-t1-gates.txt |
| IS-9 | 9, 11 | Todo 9 schema, sink, and bridge tests (including the t3-scenario `screenAwareness === false` assertion); T1 gate verdict equality; todo 11 T3 screen-attention run, t3-smoke rerun, and T3 liveliness gate with the bridge-state input check | task-9-*.txt, task-11-report.md, task-11-t3-gates.md |
| IS-10 | 4, 5, 8 | Todo 5 payload-keys test; todo 4 contract shape; F2 review | task-5-*.txt, F2 report |
| IS-11 | 10 | Todo 10 rg check and verify | task-10-verify.txt |
