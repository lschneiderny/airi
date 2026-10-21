# Post-merge QA audit (2026-10-21)

Scope: `main` at `ec9e8bdba`, range `130fd4da0..HEAD`. The range covers natural motion v2 and touch, expression performance, the natural emotion revamp, situational presence (waves 0-7 and follow-ups), the QA tooling package and T3 gates, the developer tools (`pnpm verify`, `pnpm wt`, `pnpm dev:top`), the 60 FPS default, account-free clients, and the chess stub removal.

Method: a remerge-diff audit of every merge, a plan-to-source audit of six plans, a cross-package integration audit, and a baseline of `pnpm typecheck`, ESLint, and every suite that `pnpm test:run` runs. Raw evidence is under `.omo/evidence/post-merge-qa/` (local, not committed).

## Summary

- Merge conflict resolutions are sound. All 46 merges were checked with `git show --remerge-diff`: 43 are clean and 3 have manual resolutions that keep both sides (`7193f6140`, `3fdca2b0d`, `3b864a296`). No conflict markers remain, `git diff --check 130fd4da0 HEAD` is clean, and the T3 commits after `6ff2b87d5` touch no runtime package.
- `pnpm typecheck` passes.
- `pnpm lint` fails. One error is in a tracked file (finding M5). The rest come from untracked local state (finding L1).
- Tests: Live2D browser and stage-web pass. The other suites fail only on known or pre-existing failures, except for the four failures in findings M1 and M3.
- The plans match the shipped code. Every situational-presence amendment from the 2026-10-20 audit is implemented and wired. The remaining gaps are documentation drift and accepted partial results that Luke already decided on.

## Findings

Severity: High means users of a shipped surface lose a feature. Medium means a wrong surface, a broken test signal, or a failing repository check. Low means hygiene or documentation.

| ID | Severity | Finding | Evidence | Fix |
| --- | --- | --- | --- | --- |
| H1 | High (withdrawn) | Suspected: a packaged desktop build drops koffi's runtime code, so Windows foreground sensing is silently `null` in installed builds. Packaging disproved this (see Resolution). | `apps/stage-tamagotchi/electron-builder.config.ts:100` excludes every dependency `src` directory. Both koffi entries (`index.js`, `index.cjs`) re-export `./src/koffi/*`. `debug` and `superjson` already need re-includes at `:101-102` for the same reason. | Re-include `**/node_modules/koffi/**/*` next to the existing re-includes. Verify with an unpacked build that `app.asar` contains `koffi/src`. |
| M1 | Medium | Settings pages and tests remain for the providers that `a2d14ad7c` removed from the app catalog. Opening those routes throws `Provider definition for <id> not found`. | 5 stage-pages browser failures (`minimax-speech.browser.test.ts` ×3, `provider-config-persistence.browser.test.ts` Comet ×2) and 18 unhandled errors. `packages/stage-ui/src/libs/providers/providers/index.ts` filters these IDs out. | Remove the orphan pages and tests for removed provider IDs, or move the Comet persistence cases to a retained provider. |
| M2 | Medium | Kirie exposes the Presence settings page, but Kirie never starts the situation runtime. Its toggles do nothing. | `apps/stage-tamagotchi-kirie/kirie.config.ts:147-158` lacks the `**/settings/presence/**` exclusion that the web and Pocket configs have. The page sets `settingsEntry: true`. | Add the exclusion. |
| M3 | Medium | The Windows UnoCSS scan globs still match zero files in the stage-tamagotchi and stage-pages browser test configs (stage-ui was fixed earlier). | `apps/stage-tamagotchi/vitest.config.ts:34-38` and `packages/stage-pages/vitest.config.ts:28-31` build absolute globs from `import.meta.dirname` (0 matches vs 99/145 matches relative). Probable symptoms: `chat-danmaku-feed-menu.browser.test.ts` fails deterministically (the switch never becomes stable), and the new Presence narrow-width test failed once in the full run (378 > 360) but passes in isolation. | Use package-root-relative globs as `packages/stage-ui/vitest.config.ts:45-49` does. Rerun both suites. |
| M4 | Medium | The Kirie model-settings browser test was updated in range, but no Vitest project includes it. | `apps/stage-tamagotchi-kirie/vitest.config.ts:26` only includes `host-context/**`. | Include the test in Kirie's browser project and make it pass, or document why it cannot run. |
| M5 | Medium | `pnpm lint` fails on two catalog entries that the chess stub removal (`bbab1496d`) left behind. | `pnpm-workspace.yaml:113` (`@ax-llm/ax`) and `:437` (`stockfish`), rule `pnpm/yaml-no-unused-catalog-item`. Their `allowBuilds` entries (`:513`, `:542`) are also stale. | Remove the catalog and `allowBuilds` entries, then refresh the lockfile. |
| L1 | Low | `.omo/ulw-loop/` state is not ignored. It adds 3,354 ESLint errors to local `pnpm lint` and clutters `git status`. | ESLint report: all untracked errors are in `.omo/ulw-loop/*/revisions/*.json`. `.gitignore` already ignores `.omo/evidence/` and `.omo/ulw-execute/`. | Add `.omo/ulw-loop/` to `.gitignore` (agent-configuration commit). |
| L2 | Low | One new English key has no consumer. | `packages/i18n/src/locales/en/tamagotchi/settings.yaml:262` (`live2d-natural-motion.emotions.intensity`). | Remove the key. |
| L3 | Low | A new test uses `any[]`, which repository rules forbid. | `packages/scenarios-stage-tamagotchi-electron/src/runtime/remote-debug.test.ts:18`. | Use `unknown[]`. |
| L4 | Low | The Natural lab browser test still polls, although expression-performance task 31 removed polling and the test rules forbid it. | `packages/stage-ui/src/features/devtools/motion/natural/devtools.browser.test.ts:117,120,124,137` (`expect.poll`). | Await the subscribed state change, as the pulse cases at `:150,164` do. |
| L5 | Low | ADRs and READMEs contradict the shipped behavior. | v2 ADR `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md:120,124,136,144` (cheek reserved, "never writes the mouth", `setEmotion` dedupe) and `packages/stage-ui-live2d/README.md:80-84`; the emotion ADR `2026-10-19-natural-emotion-revamp.md:11` contradicts its own `:135-136`; expression ADR `2026-10-18-expression-performance.md:340,398`; duplicate "Review report" sections in `packages/qa-tools/README.md:126,154`. | Correct the text to match the source and mark superseded contracts. |
| L6 | Low | The shared component reference does not mention the changed Live2D scene API. | `Live2D.vue` adds `naturalEnergy`, `performanceSettings`, the `touch` event, `applySlots`, and `applyHolds`. `docs/assets/ai/context/ui-components.md` covers `@proj-airi/ui` only. | Add a pointer to the Live2D README section that documents these. |
| L7 | Low | Stray scratch files sit at the repository root, and two approved plans are untracked. | `driver.err`, `driver.out`, `focus-godot.txt` (2026-10-20 session leftovers). `.omo/plans/qa-tooling.md` and `.omo/plans/situational-presence.md` are untracked, and the `natural-emotion-revamp.md` checkbox state is uncommitted. | Delete the scratch files. Commit the plans as they stand. |

## Deferred, with reasons

- **New situation stores are missing from the forwarding barrel.** No change. Consumers already import through explicit subpaths, which resolve, and AGENTS.md asks only that the barrel be preserved.
- **Pre-existing test failures in packages this range never touched.** No change; they are not merge regressions. Root Vitest has 23 failures in cap-vite, auth-server, ui-server-auth, plugin-sdk, api-server, the Electron static-asset paths test, and the stage-shared localStorage test. They are Windows path and CRLF expectations, Node 26 `localStorage`, and server environment issues. Six of them are already in `packages/qa-tools/known-failures.json`. The stage-ui node failures (24, Node 26 `localStorage`) are all registered.
- **The ESLint markdown crash on a local draft (resolved).** `.omo/drafts/situational-presence.md:15` (untracked) crashed every lint run, including `pnpm verify`. A bare URL inside brackets, such as `[see https://example.com]`, makes `markdown/no-invalid-label-refs`, `markdown/no-reference-like-urls`, and `markdown/no-space-in-emphasis` throw `getLoc()` errors on nodes that the GFM autolink transform creates without positions ([eslint/markdown#619](https://github.com/eslint/markdown/issues/619), still open in 8.0.3, the latest release). `eslint.config.ts` now turns off those three rules for Markdown, with a `NOTICE` comment saying when to remove it. `pnpm verify` passes in the main checkout with the draft present.
- **Partial results Luke already accepted.** These stay as recorded: natural-emotion task 12, expression tasks 26 and 35, QA tasks 13, 16, 22, 23, and 24, live2d-presence v2 tasks 14, 15, 20, and 25, and the open v1 F1-F4. This audit relabels none of them.
- **Missing raw evidence directories.** `.omo/evidence/natural-emotion-revamp/` keeps only four PNGs, and the qa-tooling task-17 run folder is gone. The ledger approvals survive. This is a record-keeping limit, not a code defect.

## Resolution

The fixes landed on `main` through `luke/fix/post-merge-qa` and were verified at the final tree with `pnpm verify` (typecheck 55/55, lint 0 errors, related tests passing) and a full serial rerun of every `test:run` suite.

| ID | Status | Commit | Verification |
| --- | --- | --- | --- |
| H1 | false positive | none | Unpacked `electron-builder --dir --win --x64` builds with and without the re-include both package `node_modules/koffi/src/**`. Each loads koffi from `app.asar` under `ELECTRON_RUN_AS_NODE` and calls `user32!GetForegroundWindow` (`KOFFI_OK version=3.3.3 hwnd=true`). The static file-matcher probe was wrong, so no change shipped. |
| M1 | fixed | `898455bd5` | Nine orphan pages and the MiniMax test are removed. The two Comet-only #2449 cases are removed, and the three OpenAI-compatible #2449 cases remain. Full stage-pages run: 14 files, 44 tests, 0 failures, no `Provider definition ... not found` errors. |
| M2 | fixed | `fdd3f8229` | `kirie build web`: the bundle contains `/settings/presence` once without the exclusion and zero times with it. The control route `/settings/airi-card` is present in both builds. |
| M3 | fixed | `c44e75fc1`, `801ff9b19` | Danmaku test: fails before (timeout), passes after (2/2). Full Electron browser project: 171/171. The Presence overflow came from the test fixture missing the Tailwind reset that the hosts load (content-box textareas measured 380 px). Two full stage-pages runs pass. |
| M4 | fixed | `25ee5a9fd` | Kirie browser project now collects the test: 3 files, 8 tests pass. |
| M5 | fixed | `337899d3a` | `eslint pnpm-workspace.yaml` exits 0. Before the change it reported 2 errors. The lockfile is unchanged. |
| L1 | fixed | `63ae1320d` | `git status` no longer lists `.omo/ulw-loop/`. |
| L2 | fixed | `521eb49af` | Repository search finds no consumer; dynamic keys only use `bands.*` and `names.*`. |
| L3 | fixed | `8eb11a17f` | Package typecheck exits 0, and the test passes 5/5. |
| L4 | fixed | `0091856a9` | The lab browser test passes 9/9 twice, with subscribe-before-click waits. |
| L5 | fixed | `d3104d529` | Each corrected sentence cites its source line (`.omo/evidence/post-merge-qa/l5-l6.txt`). |
| L6 | fixed | `d3104d529` | A pointer section is appended to `ui-components.md`. |
| L7 | fixed | `0eaaad756` | The scratch files are deleted and the plans are committed. |

Final test state compared with the baseline:

- Electron browser project: 171/171 (baseline: 1 failure, the danmaku menu).
- stage-pages: 44/44 in 14 files (baseline: 6 failures and 18 unhandled errors).
- Kirie: 40/40 in 13 files, now including the model settings runtime test.
- Live2D browser: 25/25. stage-web was not rerun: its single test passed at baseline, and no change touches stage-web.
- Root Vitest: the same 23 pre-existing failures as the baseline, none new.
- stage-ui: the 24 registered Node 26 `localStorage` failures, plus one `airi-card-sync.browser.test.ts` failure in the full run. That test passes 14/14 twice in isolation, and earlier notes record it as flaky under machine load. No change touches it.
