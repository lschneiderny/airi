# browser-test-flakes - Work Plan

Status: planned on 2026-11-20; no work item has started. Roadmap row: step T in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps), flake half only. Policy: [Testing and QA](../../docs/ai/context/testing.md#flaky-tests) ("A flaky test is a bug"). Branch: `luke/fix/browser-test-flakes`, cut from `luke/refactor/testing-redesign` at `41de317aa` (PR #54, which removes the CPU slot broker). The PR for this plan targets `luke/refactor/testing-redesign` until #54 merges, then `main`.

The cpu-slots half of step T is superseded: PR #54 deletes `@proj-airi/cpu-slots` ([testing redesign ADR](../../docs/ai/adr/2026-11-19-testing-redesign.md), decision 1), so the A2 steps of [`fork-policy-and-tooling.md`](fork-policy-and-tooling.md) (leases taken by CLIs, `--maxWorkers=<grant>`, `AIRI_CPU_GRANT`) are moot. #54 already rewrote the T row to say so. This plan does not touch cpu-slots.

The owner is away. Every design fork below is taken on the recommended option and listed in [Decisions](#decisions-open-to-the-owners-veto).

## TL;DR (For humans)

**What changes:** Two test fixes and one test diagnostic, then the roadmap record. The pixi "Texture loading error" flake has a proven cause: the MMD routing tests in `stage-emotion-routing.browser.test.ts` mount the MMD scene with the Live2D preset's model id, and the MMD OPFS cache deletes the Live2D cache directory of that id while a Live2D load from an earlier test still reads its textures from it. A second flake found here, in stage-ui's `history.browser.test.ts`, measures message positions before the bottom alignment has run. The chat viewport flake and the "Failed to fetch dynamically imported module" flake did not reproduce; the plan records their explanations and leaves a diagnostic for the next viewport failure.

**Why:** Each of these failures makes an agent rerun the gate and teaches it to ignore red browser runs.

**Effort:** S, five commits. **Risk:** low; no product code changes.

## The problem

`pnpm verify` and `pnpm verify --gate` fail now and then in a browser-mode Vitest project while the same file passes alone and on a rerun. Briefs for agent lanes now say "Rerun the gate once if one of them is the only failure"; the testing policy calls a flaky test a bug to fix, not to rerun. Three failures were reported:

1. **"Failed to fetch dynamically imported module"** before any assertion of a browser test file, in stage-ui, stage-pages, and stage-tamagotchi. This is the one the T row names.
2. **Two `Error: Texture loading error` unhandled rejections** from pixi-live2d-display in `packages/stage-ui/src/components/scenes/stage-emotion-routing.browser.test.ts`. Every test passes; Vitest fails the run on the two errors.
3. **`apps/stage-tamagotchi/src/renderer/components/chat-viewport-layout.browser.test.ts`**, "keeps an automatically scrolled long-history tail above the fixed composer", fails with `expected 280 to be less than or equal to 225`.

## How often they happen

The verify history in the git common directory (`airi-verify/runs.jsonl`, read with `pnpm verify --stats --since 2d` and a script over the records) holds 48 executed test steps from 2026-11-19 21:34 UTC (the oldest record it keeps) to 2026-11-20 13:47 UTC. Two failed: one on flake 2 (2026-11-20 01:18 UTC, `luke/feat/character-mind-slow-state`) and one whose cause the history does not keep. Agent transcripts add one flake 3 failure on 2026-11-19 at 17:16 UTC, before the oldest record, whose failure screenshot is still in this worktree, and the last sightings of flake 1 are on 2026-11-16 (two stage-pages files in one run). Flake 1 appeared in 29 transcripts on 2026-11-08 and 20 on 2026-11-09, and in none after 2026-11-16.

So in the window the history keeps, a flake failed the test step in one or two of 48 runs, not repeatedly. Flake 1 has not been seen since `pnpm verify` started running one package's browser at a time (see its findings).

## Findings

Evidence lives in this worktree under `.temp/t/` (gitignored): `runs.tsv` has one line per run (label, exit code, duration, load average, and counts of each flake signature), `logs/<label>-<n>.log` has each run's output, and `logs/<label>-<n>.network.jsonl` has the failed requests, HTTP errors, and per-page request peaks that `net-reporter.mjs` records. `run.sh <label> <count> <package dir> <vitest args>` repeats a run; `burn.sh <n> <seconds>` adds `n` busy Node processes. The machine is a 16-core, 31 GB workstation.

### Flake 2: Texture loading error. Root cause, proven

**Cause.** Both renderer caches keep one top-level OPFS directory per display-model id in the same origin:

- `packages/stage-ui-live2d/src/utils/opfs-loader.ts` writes the archive's files and a `__meta.json` with `version: 4`.
- `packages/stage-ui-mmd/src/utils/opfs-loader.ts` writes `__source.bin` and a `__meta.json` with `version: 1`. Its `OPFSCache.get` removes the whole directory when the version differs.

The `stage performance routing on MMD` tests call `setStageModelRenderer('mmd')` while the selected model stays `preset-live2d-1`, so `MMD.vue` calls `loadMMDModelFromSource(src, { cacheKey: 'preset-live2d-1' })`. The MMD cache finds the Live2D directory, reads version 4, and removes it. A Live2D load that a Live2D test started earlier, and that nothing cancels when its test ends, holds `File` objects from that directory. Once the directory is gone, its texture images fail. pixi-live2d-display creates the texture promises before the moc step (`setupEssentials`) and awaits them only after it; the moc step always fails in this file because the Cubism core is a stub, so nobody handles the texture rejections. One rejection per texture gives the two errors. Load decides whether an earlier Live2D load is still reading its textures when the MMD test starts, which is why the file passes alone and on a rerun.

The Live2D Web Lock from `c4c357ab8` does not help: the MMD cache never takes it.

**Evidence.**

- The 2026-11-20 failure attributes both errors to "sends synthesized speech level to MMD and the conductor, then stops sampling on VRM", a test of the MMD block.
- A setup-file probe (`.temp/t/texture-probe.ts`, run through `.temp/t/vitest.stage-ui.config.ts`) logs every `removeEntry`. In a passing run of the file it logged one removal of `/preset-live2d-1`, from `OPFSCache.get` in `stage-ui-mmd/src/utils/opfs-loader.ts:58` called by `loadMMDModelFromSource` (`logs/er-probe-1.log`). The precondition happens on every run.
- A forced reproduction (`.temp/t/tests-ui/opfs-collision.browser.test.ts`, through `.temp/t/vitest.stage-ui-scratch.config.ts`) loads the hiyori preset twice through the real middlewares with the stubbed core. When the MMD cache's `get` for the same id finishes after the second load's cache hit and before its texture images read their files, the load fails with the same moc error as the test (`Cannot read properties of undefined (reading 'fromArrayBuffer')`) and exactly two `Texture loading error` rejections follow: 3 of 3 runs. Without the MMD call: 0 of 3 (`logs/collision4-*.log`).
- The natural failure did not appear in 16 runs of the file alone (8 quiet, 8 beside a 16-process burn) or in 9 runs of the whole stage-ui browser project (3 quiet, 4 beside an 8-process burn, 2 with cold optimizer caches).

**Can the app hit it?** Not that I found. `loadStageModel` in `packages/stage-ui/src/stores/settings/stage-model.ts` publishes the renderer and the model together from the model's format, so the MMD scene never receives a Live2D model id. Only `godot` overrides the renderer. The shared namespace stays a latent hazard; see [Owner questions](#owner-questions).

### Flake 1: Failed to fetch dynamically imported module. Not reproduced; explained

**Prior analysis.** Two earlier investigations exist. `.omo/evidence/test-qa-revamp/f3-imports-diagnosis.md` in the main checkout (2026-11-10, vault inbox notes "stage-ui browser suites intermittently fail to import" and "pnpm verify browser batches fail intermittently with Failed to fetch dynamically imported module") logged the browser's failed requests: Chromium aborted bursts of module requests with `net::ERR_INSUFFICIENT_RESOURCES` before they reached Vite, in 2 of 4 cold full stage-ui runs on `main`. The limit was shared across the browser's pages. About 112 unbundled `@proj-airi/i18n` locale modules, which `stores/settings/general.ts` imports eagerly through `@proj-airi/i18n/locales`, made up most of the first failures. Shared Vite caches, optimizer reloads, file descriptor limits, and serial execution were ruled out then. The host capability contract plan's todo 24 tracked it and stayed `[~]`.

**What changed since.** At that time `pnpm verify` ran six browser projects in one Vitest process, one Chromium with four pages per project. `6b6a8cbae` (2026-11-13) gave each browser project its own process, and `c0205bf27` (2026-11-18) runs each package's tests from the package, one package at a time. One Chromium now serves one project's four pages. The flake's sightings stop on 2026-11-16.

**Reproduction attempts on this branch, all with `net-reporter.mjs` logging failed requests:**

| Runs | Load | Import failures | `ERR_INSUFFICIENT_RESOURCES` |
| --- | --- | ---: | ---: |
| stage-ui browser project, 3 | quiet | 0 | 0 |
| stage-ui browser project, 4 | 8-process burn | 0 | 0 |
| stage-tamagotchi browser project, 4 | quiet | 0 | 0 |
| stage-tamagotchi browser project, 4 | 16-process burn | 0 | 0 |
| Cold optimizer caches (the package's `node_modules/.vite` deleted first): stage-tamagotchi 3, stage-ui 2 | the other checks of this investigation | 0 | 0 |
| stage-pages browser suite, 2 | quiet | 0 | 0 |
| Single files (viewport, emotion routing, history, probes), about 90 | quiet to a 32-process burn | 0 | 0 |

Per-page peaks of pending requests were 150 to 410, close to the 160 to 271 of 2026-11-10, without a single resource failure. The cold runs logged one optimizer scan and bundle at startup and no "optimized dependencies changed" reload. Two cold stage-pages runs were invalid (a wrong `--project` filter) and are not counted.

**Outcome: explained, not fixed.** The mechanism of 2026-11-10 is the strongest hypothesis: a burst of module requests from many pages of one Chromium exceeds Chromium's shared limit on outstanding requests. Its main multiplier, several projects' pages in one browser, is gone. What would confirm a recurrence: a `requestfailed` record with `net::ERR_INSUFFICIENT_RESOURCES` in the failing session, or an optimizer reload line before the failure (see [Records](#records)).

### Flake 3: chat viewport tail. Not reproduced; hypothesis

**The failing state.** Every recorded failure (13 transcript lines from 2026-11-08 and 2026-11-19) is the same: `expected 280 to be less than or equal to 225` at line 133, inside `expectVisibleTail`. The failure screenshot of 2026-11-19 (`apps/stage-tamagotchi/src/renderer/components/__screenshots__/chat-viewport-layout.browser.test.ts/`) shows "Appended tail" just above the composer and "Streaming tail" behind it. That is the position before the scroll for the streaming item: the previous tail sits at the composer's edge, and the new item one row below it. The scroll was not late; it never happened within the one-second `vi.waitFor`. Both failure sessions ran beside heavy lanes (2026-11-08: during an exclusive 12-slot `qa:host smoke`).

**Attempts, 0 failures in about 150 executions of the test:** the file alone 15 times quiet and 15 times beside a 16-process burn; the whole stage-tamagotchi browser project 11 times (4 quiet, 4 beside a 16-process burn, 3 with cold optimizer caches); a timing probe (`.temp/t/tests/viewport-timing.browser.test.ts`) that runs the test body 10 times per run, 2 runs quiet, 3 beside a 16-process burn, and 3 beside a 32-process burn (load average 34). The slowest step after the first took 188 ms, against the 1,000 ms budget.

**Pointer hypothesis, tested and not confirmed.** Vitest reuses a browser page for later files and leaves the native pointer where the last file put it (`.omo/evidence/test-qa-revamp/f3-diagnosis.md`). `useChatHistoryScroll` skips the tail scroll while `pointerover` marks an older message. A probe that parks the pointer over older messages (`.temp/t/tests/viewport-pointer*.browser.test.ts`) confirmed that Chromium sends `pointerover` to older messages as they scroll under a still pointer, but the scroll still ran in 36 executions, with and without load.

**Outcome: could not reproduce.** The strong hypothesis is that the scroll request for the new last item was skipped or lost, not slowed: one of the gates in `use-chat-history-scroll.ts` (pointer, focus, or selection on an older message, or `isFollowingConversation` turned off by a scroll that it read as the user's), or the `useRafFn` loop in `use-virtualizer-scroll.ts` that never issued the queued request. W3 makes the next failure report which.

### Found here: chat history bottom alignment. Root cause

`packages/stage-ui/src/components/scenarios/chat/components/history.browser.test.ts`, "bottom-aligns a newly sent mobile message and its streaming placeholder", failed 2 of 4 runs of the whole stage-ui browser project beside an 8-process burn, with `expected 154 to be less than or equal to 16` (`logs/ui-load-2.log`, `logs/ui-load-3.log`), and 0 of 3 quiet runs and 0 of 8 runs of the file alone beside 16- and 32-process burns. The test waits only for `.chat-message-item-visible`, which `history-message-frame.vue` sets from an `IntersectionObserver`, and then reads positions once. `useVirtualizerBottomAlignment` applies its translation in a later `requestAnimationFrame`. When four pages compete for one starved renderer, the frame lands after the read, and 154 px is the top-aligned position. The test reads before the completion signal it depends on.

### Found here, out of scope

- `apps/stage-tamagotchi/src/renderer/window-bounds-readiness.browser.test.ts` timed out (15 s) in 9 of 11 runs of the whole stage-tamagotchi browser project, quiet and loaded, and passed 2 of 2 runs alone. `pnpm verify` runs related files only, so it has rarely been in the gate. Beside a 16-process burn, `app.browser.test.ts` also failed in each of 5 runs, its expected reports missing.
- Browser tests send requests to upstream's live analytics endpoints (events and feature flags); `logs/ui-quiet-1.network.jsonl` records them as aborted. A test run should not reach a live analytics endpoint.

## Decisions open to the owner's veto

| # | Fork | Options | Taken | Why |
| --- | --- | --- | --- | --- |
| D1 | The cpu-slots half of T | Plan leases again; record it as superseded | Superseded | PR #54 deletes the broker; the T row already says so |
| D2 | Fix for flake 2 | Give the MMD tests a model id that no Live2D test uses; namespace the OPFS directories per renderer (`live2d/<id>`, `mmd/<id>`); make the MMD cache leave directories it did not write | The test fixture | The app cannot reach the state (see flake 2's findings); the other two change the OPFS layout or the cache's ownership rules, which the state registry and "Delete all data" depend on. The namespace hazard goes to the owner questions |
| D3 | Unhandled texture promises in pixi-live2d-display | Extend `patches/pixi-live2d-display.patch` so a failed moc step handles its texture promises; leave it | Leave it in this plan | It turns a failed load into an unhandled rejection in the app too, but it is a library fix with its own risk; recorded as an owner question |
| D4 | Flake 1 | Pre-bundle `@proj-airi/i18n/locales` in the browser projects' `optimizeDeps.include`; lower browser `maxWorkers`; no change | No change | It did not reproduce in 22 whole-project project runs, and repetition cannot prove a fix of a flake that does not occur. Pre-bundling a linked workspace package can serve stale locale strings after an i18n rebuild until the optimizer cache is cleared |
| D5 | Flake 3 | Change nothing; add a failure message that reports the scroll state; change the composable | A failure message (W3) | The cause is unknown and does not reproduce here; the next failure in a gate then names the gate that stopped the scroll. The message adds no wait and weakens no assertion |
| D6 | The history alignment flake | Fix it here; leave it for another step | Fix it here (W2) | Same failure family in the same gate step, reproduced, and a one-line wait |
| D7 | `testing.md` | Add a flake rule or a signature list; no change | No change | No rule changes. The policy already says a flaky test is a bug and forbids sleeps and weaker assertions; signatures belong in the plan and the roadmap row |
| D8 | The rerun-once lines in agent briefs | Keep; drop | Not this plan's | They live in lane briefs, not in the repository. After W1 and W2, a gate failure should be read, not rerun |

## Work items

Each item is one commit for one low-effort worker. Each passes `pnpm verify --gate --base origin/luke/refactor/testing-redesign` (checked with `--dry-run` on 2026-11-20; it accepts the remote branch as base). Run checks through `pnpm verify --detach` and `pnpm verify --wait`.

1. **W1 `test(stage-ui): give the MMD routing tests a model that no Live2D test loads`.** In `packages/stage-ui/src/components/scenes/stage-emotion-routing.browser.test.ts`, make `renderMMD` (and the preview-stage test that calls it) mount the MMD scene with a model id other than `preset-live2d-1`, so `loadMMDModelFromSource` never sees the Live2D cache directory. Read `loadStageModel` in `stores/settings/stage-model.ts` first: setting only the selected id can make the store publish another renderer after the test sets `mmd`. Keep every MMD assertion. Add a comment above `renderMMD` that says why the id must differ (the two OPFS caches share one namespace). Do not touch either OPFS loader. Check in [Checks](#checks).
2. **W2 `test(stage-ui): wait for the bottom alignment before measuring a new mobile message`.** In `history.browser.test.ts`, "bottom-aligns a newly sent mobile message and its streaming placeholder": move the two position assertions into a `vi.waitFor`, after the visibility wait, keeping their bounds (16 and 64). Add a `// ROOT CAUSE:` comment in the file's style: visibility comes from an `IntersectionObserver`, and the alignment from a later animation frame.
3. **W3 `test(stage-tamagotchi): report the scroll state when the chat tail stays behind the composer`.** In `chat-viewport-layout.browser.test.ts`, give the assertion in `expectVisibleTail` a message with the history viewport's `scrollTop`, `scrollHeight`, and `clientHeight`, the keys of the mounted message items, `document.activeElement`'s tag, the message item under `:hover` (`querySelector('.chat-message-item:hover')`), and whether the selection is collapsed. Change no bound and no timeout. The comment names roadmap step T and says to read the message before rerunning.
4. **W4 `docs(ai): record the browser test flake outcomes in the roadmap`.** The T row as written in [Records](#records). No `testing.md` change (D7).
5. **W5 `docs(plan): mark the browser test flakes plan done`.** Status line, a "Checks run" section with each check's command and result, and any departures.

**Order.** W1, W2, and W3 are independent. W4 follows them; W5 is last.

## Checks

- **W1, the precondition, deterministic.** Recreate the probe if `.temp/t/` is gone: a setup file that wraps `FileSystemDirectoryHandle.prototype.removeEntry` and logs `this.name/name` with a stack, added to the stage-ui browser project's `setupFiles` by a scratch config that imports `packages/stage-ui/vitest.config.ts`. Run `pnpm -F @proj-airi/stage-ui exec vitest run --config <scratch config> --project browser src/components/scenes/stage-emotion-routing.browser.test.ts` 5 times. Before W1 each run logs a removal of `/preset-live2d-1` from the MMD cache; after W1 no run may log a removal of a directory that a Live2D load used.
- **W1, the symptom.** The file alone 10 times beside `.temp/t/burn.sh 16 600`, and the whole stage-ui browser project 4 times beside `burn.sh 8 1200`: zero `Texture loading error`. The symptom never appeared in 25 runs before the fix, so these runs only show that W1 breaks nothing; the precondition check is the proof.
- **W2.** The whole stage-ui browser project (`pnpm -F @proj-airi/stage-ui exec vitest run --project browser`) 6 times beside `burn.sh 8 1200`. Before W2 it failed 2 of 4 such runs; at that rate, 6 clean runs leave about a 1.6% chance that the flake is still there. Also the file alone 5 times quiet.
- **W3.** The file alone 5 times quiet: it passes, so the message changed no outcome. Then a scratch copy with the composer inset forced to 0 fails once and prints the message, to show the message renders.
- **Every item:** `pnpm verify --gate --base origin/luke/refactor/testing-redesign`. If the local branch is ahead of the remote one, use `--base luke/refactor/testing-redesign`.
- **W4:** `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts`.
- Use at most three heavy lanes at once, burns included (root `AGENTS.md`).

## Records

**Roadmap T row** (W4), the What-lands and Status cells:

- What lands: "The intermittent browser-test failures of `pnpm verify`: the 'Failed to fetch dynamically imported module' import failure, the pixi 'Texture loading error' rejections in `stage-emotion-routing.browser.test.ts`, the chat tail checks in `chat-viewport-layout.browser.test.ts` and `history.browser.test.ts`. The cpu-slots half is void: the testing redesign ADR removed the broker (PR #54)."
- Done when: unchanged, "The flake is fixed or explained".
- Status: "Done (`<W1>`..`<W4>`): the texture rejections and the history alignment are fixed at their causes; the import failure is explained (Chromium's `ERR_INSUFFICIENT_RESOURCES` under many pages of one browser, gone since verify runs one package's browser at a time; not reproduced in 22 whole-project project runs); the viewport tail did not reproduce in about 150 runs, and its failure message now names the state. Plan: `.omo/plans/browser-test-flakes.md`."

**If flake 1 comes back,** record before rerunning: the failing package and files; whether the log has an `[optimizer]` or "optimized dependencies changed. reloading" line before the failure; and a rerun of that package's browser project with `.temp/t/net-reporter.mjs` as a reporter, whose `requestfailed` records name the error. `ERR_INSUFFICIENT_RESOURCES` points at D4's first option; a reload line points at a missing `optimizeDeps.include` entry.

**Vault.** After W5, `/vault-sync` can mark the two inbox notes on the import failure as explained, with this plan as the reference.

## Risks

| Risk | Mitigation |
| --- | --- |
| W1 changes which store state the MMD tests start from, and an assertion passes for a different reason | The worker keeps every assertion and reads each MMD test's setup; the precondition check shows the MMD cache no longer touches the Live2D entry |
| W2's `vi.waitFor` hides a real regression in the alignment | The bounds stay; a broken alignment still fails after the wait times out |
| W3's message reads layout that the failing state does not have | It reads only what the assertion already reads, plus `activeElement`, `:hover`, and the selection, which always exist |
| Flake 1 returns under a new load shape | [Records](#records) says what to capture first |
| Burns in the checks disturb other lanes | Three heavy lanes at most; the burns end on their own |

## Owner questions

1. **Shared OPFS namespace.** The Live2D and MMD caches both use the bare display-model id as a top-level OPFS directory, and each deletes a directory whose metadata it does not recognize. Ids are unique per model today, so the app is safe. Should the caches move to per-renderer directories in a later step (an OPFS layout change that the state registry and "Delete all data" must follow)?
2. **pixi-live2d-display texture promises.** A Live2D load whose moc step fails leaves its texture promises unhandled, in the app too (a broken archive). Extend `patches/pixi-live2d-display.patch` so `setupEssentials` handles them when `next()` throws?
3. **`window-bounds-readiness.browser.test.ts`** times out in most whole-project runs of the stage-tamagotchi browser project (9 of 11) and passes alone, and `app.browser.test.ts` fails under load. `pnpm test:run` and `pnpm release` run the whole suite. Should they get their own step, in T or in L?
4. **Analytics from tests.** Browser tests reach upstream's analytics endpoints. Should the test configs block those hosts?

## Must not do

- Do not add `retry` to any config or test, skip a test, or raise a timeout to make a flake pass.
- Do not add sleeps. W2 waits on the condition it asserts.
- Do not change the OPFS loaders, the OPFS layout, `optimizeDeps`, or worker counts in this plan.
- Do not edit `testing.md` or the root `AGENTS.md`.
- Do not plan or touch cpu-slots.
- Do not commit anything under `.temp/`, and no local path in a commit.

## Done when

W1 to W5 are committed on `luke/fix/browser-test-flakes`; the W1 precondition check shows no removal of a Live2D cache directory; the W2 check passes 6 of 6 loaded project runs; the T row records each flake's outcome and the superseded cpu-slots half; and every check in [Checks](#checks) passed and is recorded in the plan.
