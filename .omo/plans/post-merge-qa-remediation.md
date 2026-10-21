# Post-merge QA remediation plan (2026-10-21)

Source: `docs/ai/audits/2026-10-21-post-merge-qa.md`. Branch `luke/fix/post-merge-qa` in worktree `dtuber-wt/post-merge-qa` (or the path `pnpm wt new` printed), off `main` at `9eedea98f`. Each unit lands as its own Conventional Commit. Agent-configuration changes go in a separate commit.

| Unit | Finding | Files | Commit | Verify |
| --- | --- | --- | --- | --- |
| U1 (dropped: H1 false positive) | H1 | `apps/stage-tamagotchi/electron-builder.config.ts` | `fix(stage-tamagotchi): keep koffi runtime sources in packaged builds` | Unpacked `electron-builder --dir` build; `app.asar` lists `node_modules/koffi/src/koffi/index.cjs` |
| U2 | M1 | `packages/stage-pages/src/pages/settings/providers/**` for removed provider IDs | `fix(stage-pages): drop settings pages for providers removed from the catalog` | stage-pages suite passes with no `Provider definition ... not found` errors |
| U3 | M2 | `apps/stage-tamagotchi-kirie/kirie.config.ts` | `fix(stage-tamagotchi-kirie): hide Presence settings until Kirie runs situational presence` | Kirie route scan no longer includes `/settings/presence` |
| U4 | M3 | `apps/stage-tamagotchi/vitest.config.ts`, `packages/stage-pages/vitest.config.ts` | `test: scan UnoCSS sources with relative globs on Windows` | Danmaku test and the Presence narrow-width test pass in their full suites |
| U5 | M4 | `apps/stage-tamagotchi-kirie/vitest.config.ts` (+ test setup if needed) | `test(stage-tamagotchi-kirie): run the model settings runtime browser test` | The test is collected and passes |
| U6 | M5 | `pnpm-workspace.yaml`, `pnpm-lock.yaml` | `chore: drop catalog entries left by the chess stub removal` | `pnpm lint` reports no tracked-file errors |
| U7 | L1 | `.gitignore` | `chore(agents): ignore ulw-loop execution state` | `git status` no longer lists `.omo/ulw-loop/` |
| U8 | L2, L3, L4 | i18n en YAML, `remote-debug.test.ts`, `devtools.browser.test.ts` | one commit per package | Typecheck and affected tests pass |
| U9 | L5, L6 | ADRs, READMEs, `docs/assets/ai/context/ui-components.md` | `docs: align ADRs and READMEs with shipped motion behavior` | Text matches the cited source lines |
| U10 | L7 | stray root files, `.omo/plans/*.md` | `docs(plan): record the qa-tooling and situational presence plans` | `git status` clean of the scratch files |

Order: U1-U5 and U8-U9 in parallel (disjoint files). U6 after them, because it reinstalls. U7 and U10 in the main checkout. Then `pnpm verify`, the affected suites, and a real-surface check of Electron (Presence page, Situation inspector, danmaku menu), followed by a fast-forward of `main`.

Outcome: U2-U10 landed (see the Resolution table in the audit). U1 was dropped after a before/after packaged build showed that koffi already loads from app.asar without the change.
