# @proj-airi/cpu-slots

## Purpose

A local broker that limits how many CPU-heavy developer processes run at once on one machine. Verify steps, QA gates, Vitest runs, and Turbo tasks from every worktree draw slots from one shared budget, which defaults to 12. A process waits for a grant before it starts.

This is a developer coordination tool. It is not an operating-system CPU quota, and it does not limit long-running development servers.

## Usage

The CLI runs a command under a class and reports the store:

- `pnpm slots run --class <class> [--min N] [--max N] -- <command...>` grants slots, substitutes `{grant}` in the command, and runs it. On Windows it stops the whole child tree with `taskkill /T /F` when it exits or is interrupted. Only `.cmd` and `.bat` shims go through cmd.exe.
- `pnpm slots status [--json]` lists the holders and the queue. It reads the store without creating it.

Code acquires a lease directly with `acquire({ class, cwd, command })`. The lease holds its slots until released. A heartbeat refreshes it every 10 s, and the heartbeat is unreferenced, so it never keeps a process alive.

## Classes

| Class | Min to max | Used by |
| --- | --- | --- |
| `test` | 2 to 6 | Root Vitest config |
| `browser` | 2 to 4 | Extra Vitest configs and browser-mode projects |
| `typecheck` | 2 to 6 | `turbo run typecheck` |
| `build` | 2 to 6 | Package builds |
| `lint` | 1 | `moeru-lint` chunks |
| `install` | 4 | Dependency installs |
| `gate` | 4 to 10 | QA gates |
| `exclusive` | whole budget | Work that must not share the machine |

`exclusive` uses infinite bounds and takes the whole budget.

## Environment

- `AIRI_CPU_BUDGET`: total slots. Defaults to 12. A value must be a positive safe integer, or the broker throws `CpuSlotsError('bad-budget')`.
- `AIRI_CPU_SLOTS_DIR`: store location. Without it, the store is `airi-cpu-slots` under `LOCALAPPDATA` on Windows, or under the temp directory elsewhere.
- `AIRI_CPU_SLOTS=off`, or a `CI` environment variable: every lease is a no-op. Nothing is queued.
- If the store path returns `EROFS`, `EACCES`, `ENOENT`, or `ENOTDIR`, the command runs unbrokered and prints one stderr line saying so.

## Grant rule

`decide(state, budget)` is pure. It grants the lowest ticket sequence first (FIFO). A waiting ticket reports one reason: `queue-empty`, `over-budget`, `exclusive-held`, `leases-held`, or `insufficient-slots`. Waiters poll every 500 ms, or every 50 ms right after a busy lock.

The store is written under a directory lock. Every mutation runs in one transaction. A grant is written as a lease, then checked again, and removed if the check fails. A lease is reclaimed only after its owner's death is observed and a process snapshot shows the workload is gone, with a 2 s cap on that snapshot. Measured on Windows, a lease was reclaimed 752 ms after its child died when the coordinator was killed without `/T` (`task-2-gate-review-r3.md`). Across eight coordinator-only kill repros, death to grant took 322 to 2203 ms, inside the 2.5 s bound, and no grant was made while the workload lived (`task-3-gate-review.md`).

Exit handlers share a 2 s budget (`EXIT_BUSY_BUDGET_MS`). A running snapshot can push the total to about 2.5 s.

## Vitest integration

`@proj-airi/cpu-slots/vitest` exports `withCpuSlots`. It caps `maxWorkers` only. The first wrapped config sets the root grant, and later configs can only lower it.

- Parallel browser projects receive the grant. NOTICE: Vitest 4.1.11's browser pool ignores the root `maxWorkers`, so browser projects are capped per project instead.
- Watch mode takes no lease when started with `--watch`. A bare `vitest` acquires at startup and releases once Vitest resolves to watch mode, through the `cpu-slots:release-in-watch-mode` plugin.
- NOTE-2: an explicit `--watch` capping ignores current leases and any inherited `AIRI_CPU_GRANT`. Two watch runs can therefore exceed the budget. The review measured an overlap of 2 at budget 2 against 8 for an unwrapped control, 6 at budget 12, and 1 for serial projects.
- The package's `dist/vitest.mjs` is built by `tsdown`. It records a sha256 of its bundled sources. `assertFreshBuild` throws `StaleBuildError` when the sources have changed since the build, so a stale bundle stops config loading.
- NOTE-6: IDEs and direct `tsc` runs read the stale `dist/vitest.d.mts` until `pnpm -F @proj-airi/cpu-slots build` runs again.

## Turbo cache cost

Typecheck depends on the cpu-slots build, and the build's input list is narrowed in `turbo.json`. The cost is still high. A README-only edit to this package invalidates the build and all 57 typecheck tasks on a quiet tree. Warm, all 57 tasks hit the cache in 802 ms. After a README edit, none hit, and the run took 2m 9.8s. The cause is the root `package.json` devDependency `"@proj-airi/cpu-slots": "workspace:^"`, which Turbo folds into the global hash. README.md is also in the typecheck default inputs. Until both paths are fixed, expect a full typecheck after any edit to this README. See the ADR for the fix plan.

## When to use

Use the grant rule and the classes to decide how many workers a developer task may start, and wrap any CPU-heavy command that should queue behind other worktrees.

## When not to use

Do not use it to limit long-running development servers, to set an operating-system CPU quota, or to coordinate processes on another machine. On POSIX, a grandchild that calls `setsid` is not tracked.
