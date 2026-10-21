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
| H1 | High | A packaged desktop build drops koffi's runtime code, so Windows foreground sensing is silently `null` in installed builds. | `apps/stage-tamagotchi/electron-builder.config.ts:100` excludes every dependency `src` directory. Both koffi entries (`index.js`, `index.cjs`) re-export `./src/koffi/*`. `debug` and `superjson` already need re-includes at `:101-102` for the same reason. | Re-include `**/node_modules/koffi/**/*` next to the existing re-includes. Verify with an unpacked build that `app.asar` contains `koffi/src`. |
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
- **An ESLint markdown crash on a local draft.** `.omo/drafts/situational-presence.md:15` (untracked) makes `markdown/no-invalid-label-refs`, `markdown/no-reference-like-urls`, and `markdown/no-space-in-emphasis` throw `getLoc()`/`getRange()` errors. This is an upstream plugin bug triggered by a local file. The lockfile did not change ESLint markdown in this range. Do not commit that draft until the plugin is fixed.
- **Partial results Luke already accepted.** These stay as recorded: natural-emotion task 12, expression tasks 26 and 35, QA tasks 13, 16, 22, 23, and 24, live2d-presence v2 tasks 14, 15, 20, and 25, and the open v1 F1-F4. This audit relabels none of them.
- **Missing raw evidence directories.** `.omo/evidence/natural-emotion-revamp/` keeps only four PNGs, and the qa-tooling task-17 run folder is gone. The ledger approvals survive. This is a record-keeping limit, not a code defect.

## Resolution

| ID | Status | Commit | Verification |
| --- | --- | --- | --- |
| H1 | open | | |
| M1 | open | | |
| M2 | open | | |
| M3 | open | | |
| M4 | open | | |
| M5 | open | | |
| L1 | open | | |
| L2 | open | | |
| L3 | open | | |
| L4 | open | | |
| L5 | open | | |
| L6 | open | | |
| L7 | open | | |
