# fork-policy-and-tooling - Work Plan

## TL;DR (For humans)

**What changes:** Upstream's rules and the fork's rules stop being mixed together. The fork owns a few entry files, every other upstream guidance file goes back to upstream's exact text, and one ledger lists each upstream rule the fork overrides or drops, with the reason. Release and worktree tooling get fixed so they actually check what they claim to. Dead QA, test and packaging tooling is removed. The testing policy says what each check proves and which one runs when.

**Why:** Agents today read rules from two projects that disagree. `pnpm release` passes without checking anything. The fork has never merged upstream, and a merge-friendly layout keeps every later sync cheap.

**Order:** Land `luke/refactor/lock-in`. Then fork-only tooling fixes and cuts (Phase 1 and 2), which do not depend on upstream. Then the upstream sync, which carries the policy split and the test model (Phase 3). Then the character-mind refactor ([ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md)).

**Effort:** XL across phases. **Risk:** Medium. Phases 1 and 2 are low risk. Phase 3 is the 438-commit merge.

## Decisions (Luke, 2026-11-17)

| # | Decision |
| --- | --- |
| D1 | Take upstream by **merge** into a `luke/chore/upstream-sync` branch, fast-forwarded onto `main` (as root `AGENTS.md` already says). `CONTRIBUTING.md`'s cherry-pick text is wrong. |
| D2 | **Fork entry files plus a ledger.** The fork owns root `AGENTS.md`, `README.md`, `.github/CONTRIBUTING.md`, `.agents/skills/README.md`, and the TypeScript, Vitest, and xsai skills. Every other upstream policy file returns to upstream's exact bytes at sync, including guidance under kept-from-upstream paths. Fork-only rules live in fork-only files. `docs/ai/context/upstream-policy.md` lists every upstream rule the fork overrides or drops, the fork's rule, and why. Amended 2026-11-17: the fork owns every `AGENTS.md` and `CLAUDE.md`, including those under kept paths, and trims them to the root AGENTS.md policy; at sync it keeps its version and adds only upstream rules that meet that policy. |
| D3 | Platforms: Linux (KDE Wayland), macOS, Windows, and other Linux sessions all stay supported. Only macOS and KDE Wayland get active work and checks for now. Windows, sway, and X11 code stays in place, is not deleted or extended, and is documented as "planned, not checked". `README.md` stops claiming Windows releases. |
| D4 | `pnpm release` runs everything before uploading, on any branch: full typecheck, full test suite, lint, both bundle checks (including the production-bundle marker scan), and the clean-start smoke. `pnpm verify --gate` stays related-tests-only. |
| D5 | Adopt upstream's test model during the sync: per-package `test:run` through Turbo with caching. Rework verify's related-tests step to run per package. |
| D6 | Agent guidance targets **Claude Code** only. Keep the nested `CLAUDE.md` shims. Delete `.github/copilot-instructions.md`. |
| D7 | Live2D QA: keep the headless ForBOOTH runner (`packages/qa-tools/src/t2`) as Live2D's counterpart to `qa:motion3d`. Delete the statistical scorer, `gates/`, `validate-scorer`, `qa:report`, the T1 simulator, and the Live2D T3 modules. Keep the shared pieces: `src/motion/cache/closure*` and `key.ts`, and `src/evidence/run.ts`. After the mind refactor, add Live2D gates on `qa:motion3d`'s gate pattern if needed. |
| D8 | Restore the upstream rules that were dropped by accident: no nested ternaries; cohesive modules of about 200-400 lines with no `=====` separators; a why-comment on constants and `@moeru/std` merging for option defaults; single-page components in `components/scenarios/`; one assertion per line; no smoke-only tests. Keep the fork's test strictness, prose style, and JSDoc rules, recorded as overrides in the ledger. |

### Defaults adopted without asking (veto any)

| # | Default |
| --- | --- |
| A1 | Drop verify's shared pass cache (`verify-cache.ts`): 3 reuses in 778 step records. Keep the per-branch incremental record. |
| A2 | Shrink cpu-slots to leases taken by CLIs (verify, builds, QA sessions) and remove the wrapper from every Vitest config. Slot waits are under 80 ms at p90. |
| A3 | Retire the `web` host profile (`HOST_IDS`, `qa:host`, motion-qa skill), since the web app is retired. |
| A4 | `qa:bench` is the canonical frame-time tool. `qa:stage measure --perf-ab` goes. |
| A5 | Delete `scripts/ollama-bench` and `qa:model import-ollama-bench` after moving the legacy set's inputs into the model-eval set. |
| A6 | Keep `knip` (fix its schema link and scope) and drop `nolyfill`. |
| A7 | Keep `qa:display` where it is. Moving it into qa-tools needs a separate decision (`scripts/AGENTS.md`). |
| A8 | Root `build` keeps building `server/**` (kept from upstream). |
| A9 | `.omo/evidence` (74 GB) cleanup is not in this plan. It needs its own confirmation because it deletes local files. |

## Status (2026-11-17)

Phases 1 and 2 landed on `luke/refactor/lock-in` (49 commits; `pnpm verify --gate` passed). Carried forward:

- A2 (cpu-slots as CLI-level leases) is not done. It needs edits in qa-tools configs as well. Steps: verify and `test:run` pass `--maxWorkers=<grant>`; the browser root sets each project's worker limit from `AIRI_CPU_GRANT`; remove `withCpuSlots` from every config; delete `src/vitest.ts`, `stale-build.ts`, the tsdown build, the `./vitest` export, and the Turbo `cpu-slots#build` dependency; update the docs.
- A3 (`web` host profile) only left `qa:host --expect`. `HOST_IDS`, the host capability ADR, and several tests still use it.
- The three process-listing modules are not merged: the cpu-slots record has no command line, which qa-tools needs.
- `natural-emotion-t3` in `packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts` has no runner; its package tests still import `gates.ts`.
- The T1 touch and gesture coverage left with the Live2D simulator; mind-core tests replace it.
- The model-gated `t2-3d` tests were failing before the cleanup; run `pnpm qa:test:model`.

## Status (2026-11-18)

Phase 3 is done on `luke/chore/upstream-sync`, which waits for the owner's word before `main` is fast-forwarded:

- Four stepped merges contain `upstream/main` at `b3a6d6071`: `4b1e405a4`, `9d9b45354`, `14c763cfb`, `e259d4c6e`. Each passed `pnpm verify --gate`, the classic and desktop-stage smokes, and a replayed chat turn.
- `docs/ai/context/upstream-policy.md` is the ledger. It records every departure from upstream, the files the fork owns, the upstream rules adopted and left out, and the steps of a sync.
- D5 is done: every package runs its own `test:run`, `pnpm test:run` goes through Turbo with caching, and `pnpm verify` runs related tests per package. A2 was not needed for it and stays carried forward.
- Decisions made while the owner was away, open to his veto: the update feed and error reporting are off in fork builds unless the build supplies its own endpoints, upstream's Live2D touch module runs only under upstream's drivers, and upstream's beat sync layer is inactive under Natural. The ledger has the reasons.

## Phase 1: Fix what is broken (fork-only, small commits to `main` after `pnpm verify`)

1. `pnpm release` gate: run the D4 checks instead of `verify --gate` on `main`. Fold `check-prod-bundle`'s marker scan into `scripts/dev-tools/bundle-check.ts`.
2. `pnpm wt`: count a branch as merged when `git cherry main <branch>` prints nothing, so rebase-merged branches are recognised.
3. Tests stop writing to the real CPU-slot history: set `AIRI_CPU_SLOTS_HISTORY_DIR` in `verify.test.ts` and qa-tools `stage/measure.test.ts`. Remove the `live`-as-`browser` shim, whose removal condition is met.
4. `qa:test:model`: find every gated test, not only `AIRI_QA_MMD_MODEL`.
5. `qa:doctor`: check `AIRI_QA_MMD_MODEL`, drop `AIRI_QA_RIG_BEAR`.
6. Doc contradictions: the sync method and branch naming in `CONTRIBUTING.md`; the Windows claim in `README.md`; the motion-qa skill's "MMD has no headless level yet"; the qa-tools README counts; the airi-qa MCP tool list in `AGENTS.md`; the skills README vault path.

## Phase 2: Cut and simplify (fork-only)

1. Delete: `.github/scripts/check-locales.ts`, its `github-scripts` Vitest project, and `.github/AGENTS.md`; `.github/copilot-instructions.md` (D6); `@electron/notarize` and its catalog entry; `bucket/airi.json`; `.prototools`; `ai.moeru.airi.desktop`; `scripts/build-airi-docs.sh` and its rule.
2. Root scripts: delete `dev:apps`, `dev:packages`, `build:apps`, and the eight `test-*:run` scripts (`test:run` loops over the browser projects). Point `build:tamagotchi` at `build`, and drop `app:build`, `app:dev`, and `build:win/mac/linux` if nothing else calls them. Rename `up` (it is shadowed by `pnpm up`). Call every `qa:*` script the same direct way.
3. qa-tools: delete `qa:test` and `src/known-failures`; `spikes/t2` and `bin/t2-probe.ts` (keep the verdict doc); `src/window-rects`; `src/t3/keyboard.ts` and `kwin-keyboard.py`; the evidence archive command; the D7 Live2D cluster. Collapse the ten `qa:motion3d` topic commands into `report <topic>`. Move the band-refit history out of the qa-tools README.
4. Merge the three process-listing modules into one.
5. Verify: A1; skip typecheck for doc-only changes and run tests for `.json` or `.yaml` changes.
6. A2 through A6.
7. Testing policy: rewrite `docs/ai/context/testing.md` and the root "Testing tiers" around what each check proves (mind core, headless rig per renderer, rendered smoke, release) and when it runs. Drop the empty flaky-test quarantine rule or give it a real registry.

## Phase 3: Upstream sync (branch, `pnpm verify --gate`)

1. Merge `upstream/main` (D1). Resolve policy files per D2: fork entry files and every `AGENTS.md` and `CLAUDE.md` keep the fork's version, with only the new upstream rules that meet the root AGENTS.md policy added; other upstream policy files take upstream's bytes, and fork additions inside them move to fork-only files first.
2. Write `docs/ai/context/upstream-policy.md`: one row per F-override and U-dropped rule (from the 2026-11-17 audit), plus the D8 restorations, and the upstream policy files that stay deleted at sync. Add a sync step: review upstream's policy diff and update the ledger.
3. Adopt upstream's test model (D5).
4. Decide the roughly 55 upstream rules added since the fork point. The audit lists them: Private Data, `date-fns`, the `Assisted-by` trailer, x18n `i18n:check`, and the ESLint bans on `awilix` and `localforage`.

## Open questions

- The README lists `engines/stage-tamagotchi-godot` and `integrations/minecraft` as Supported. Should `integrations/minecraft` join the full typecheck?
- Should the gate also run the full suite once Turbo caching makes it cheap (after D5)?
- Should the docs-screenshot chain (`capture:tamagotchi`, `scenarios-stage-tamagotchi-browser`) be retired?
- Is `qa:kwin-probe` still used, or is `qa:host smoke` enough?

## Evidence

The 2026-11-17 audit tables are in `.omo/evidence/fork-policy-and-tooling/`: `git-release-packaging.md`, `testing.md`, `qa-and-dev-tooling.md`, `policy-split.md`.
