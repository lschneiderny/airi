# CPU slot budget and QA result cache

Date: 2026-10-22
Status: proposed

## Problem

Each worktree ran its own verify steps, QA gates, Vitest workers, and Turbo tasks at full width. Several worktrees at once could saturate the machine. In one measured run, a solo stage-ui pass reached 12 renderers and a peak of 8.99 cores. A concurrent run with a forced whole-repo typecheck reached a combined peak of 10.12 effective cores, and the machine was above 12 cores in 5 of 81 samples, by at most 0.86 cores, with unbrokered background programs accounting for the excess (`task-7-gate-review-r2.md`).

Separately, an unchanged T1 gate reran Vitest on every invocation, about 12.9 s each time, even when no input had changed.

## Decision

1. Add `@proj-airi/cpu-slots`, a local broker with a default budget of 12 slots. Work declares a class, and each class has bounds. Requests are granted in FIFO order. `exclusive` takes the whole budget.
2. Route `pnpm verify` steps, the gate CLI, and every Vitest config through the broker. Parallel browser projects and explicit watch runs are capped as described in the package README.
3. Add a content-addressed QA result cache in `packages/qa-tools`. A hit replays a stored T1 result without Vitest or a lease. A cached run cannot serve as T3 acceptance evidence.
4. Keep the verify pass cache, which stores only passing steps and is keyed by the tree hash.

Unbrokered fallbacks stay available. `CI` and `AIRI_CPU_SLOTS=off` make leases no-ops, and a store that cannot be written runs the command with a stderr warning.

## Behavior that must match

- A lease is reclaimed only after the owner's death is observed and the workload is gone. Measured on Windows, reclaim took 752 ms after the child died. Across eight coordinator-only kill repros, death to grant took 322 to 2203 ms, within the 2.5 s bound (`task-2-gate-review-r3.md`, `task-3-gate-review.md`).
- A grant is written as a lease, then verified, and removed if the verification fails. A reclaim race that could republish an orphaned lock was found in review (B1) and fixed, with the reclaim rename moved aside to a retired marker (`task-3r-gate-review.md`).
- The Vitest bundle refuses to load when its sources differ from its build stamp (`StaleBuildError`). A rebuild clears it.
- A QA cache hit requires byte-identical closure files and an identical key. A corrupt entry is a miss.

## Measured numbers

- Cache hit: 0.3 s run time, 2.7 s with pnpm and tsx startup. A miss ran Vitest for 12.9 s (`task-11-cache.txt`).
- Refusals: a cached run given to T3 exits in 2645 ms, and a path that is not a run directory exits in 2400 ms, both before any lease (`task-11-gate-review-r2.md`).
- Stale-build guard: median 1.34 ms and max 2.01 ms over 11 files. A cold process starts in 4.7 to 5.0 ms (`task-6-gate-review-r3.md`).
- Warm `pnpm typecheck`: 562 ms, FULL TURBO, 57 tasks (`task-6-gate-review-r3.md`).
- Lease reclaim during the Windows kill test: 752 ms (above).
- A plain unchanged T1 rerun was not separately timed. The cached 0.3 s figure is the run time of a replayed result, not a measured target. The brief's approximately 2 s goal has not been measured as a rerun.

## TURBO CACHE COST

Typecheck depends on the cpu-slots build, and `turbo.json` narrows the build inputs (a 5-line change). That part is correct. The cost is still open:

- A README-only edit to `packages/cpu-slots` invalidates the build and all 57 typecheck tasks. Warm, the run took 802 ms with 57 of 57 cached. After the README edit, it took 2m 9.8s with 0 of 57 cached.
- The cause is the root `package.json` devDependency `"@proj-airi/cpu-slots": "workspace:^"`. Turbo folds the root's internal dependencies into the global hash, so the build hash changes even though its 19 inputs are identical. A probe that removed the devDependency kept the build hash unchanged.
- README.md is also in the default inputs of the typecheck task, so 45 typecheck hashes change even without the global path. Raising dependents from 2 to 43 comes from this package's typecheck dependency edges.
- The turbo gate review verdict was REJECT (needs-fix). Both paths must be fixed: remove the root devDependency or move the dev tools into their own workspace package, and exclude the README from the typecheck inputs.

Until that fix lands, expect a full typecheck after any change to this README.

## Verification

- Gate reviews: task-6 r3 (BLK-1 and BLK-2 fixes, cpu-slots suite 7 files and 209 passed, whole-repo typecheck exit 0, 57 of 57), task-7 r2 (approved browser cap), task-3r r2 (reclaim stress and FIFO tests), task-11 r2 (cache probes), and task-turbo-inputs (REJECT, as above).
- The spot-check and probe record is in `.omo/evidence/cpu-budget/spot-checks.md`.

## Follow-ups

- Opt-out for indexing of the cache and store directories.
- Defender guidance for the store and cache paths.
- A worktree pool, so new worktrees inherit a warm budget.
- An idle reaper for leases whose owners stay alive without doing work.
- A T2 result cache, with the same closure rules.
- An adaptive budget that follows the machine's load.
- POSIX descendant tracking through `setsid`.
- Move the dev tools into their own workspace package, so the cpu-slots package leaves the root's internal dependencies and the Turbo cost above goes away.

## Residual risks

- N1: a stale view in the breaker is still a gap. Write-then-verify keeps the invariant that no two grants overlap.
- N4: the FIFO test polls the queue every 20 ms with a 30 s bound, so it can be slow under load.
- Stale dist: IDEs and direct `tsc` runs can read an old `dist/vitest.d.mts` until a build runs.
- Browser mode: the Vitest browser pool ignores the root `maxWorkers`, so browser projects are capped per project.
- NOTE-2: explicit `--watch` capping ignores current leases and inherited grants, so watch runs can exceed the budget.
- T3 lease wait is bounded by the default gate timeout of 90 minutes, and a timeout exits 2 with `Nothing was launched`.
- QA cache: relative imports written with a `.js` suffix for `.ts` files, and environment variables outside the key prefixes, can return stale hits.
