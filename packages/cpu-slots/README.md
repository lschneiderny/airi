# @proj-airi/cpu-slots

## Purpose

A local broker that limits how many CPU-heavy developer processes run at once on one machine. Verify steps, QA gates, Vitest runs, and Turbo tasks from every worktree draw slots from one shared budget, which defaults to 12. A process waits for a grant before it starts.

This is a developer coordination tool. It is not an operating-system CPU quota, and it does not limit long-running development servers.

## Usage

The CLI runs a command under a class and reports the store:

- `pnpm slots run --class <class> [--min N] [--max N] -- <command...>` grants slots, substitutes `{grant}` in the command, and runs it. On Windows, a SIGINT or SIGTERM stops the whole child tree with `taskkill /T /F`. A normal exit only releases the lease. Only `.cmd` and `.bat` shims go through cmd.exe.
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

The store is written under a directory lock. Every mutation runs in one transaction. A grant is written as a lease, then checked again, and removed if the check fails. A lease is reclaimed only after its owner's death is observed and a process snapshot shows the workload is gone. Snapshots are rate-capped at one per 2 s per observer, and each snapshot process has a 10 s timeout (`packages/cpu-slots/src/store.ts:400-404`, `processes.ts:22`). Measured on Windows, a lease was reclaimed 752 ms after its child died when the coordinator was killed without `/T`. Across eight coordinator-only kill repros, death to grant took 322 to 2203 ms, inside the 2.5 s bound, and no grant was made while the workload lived.

Exit handlers share a 2 s budget (`EXIT_BUSY_BUDGET_MS`). A running snapshot can push the total to about 2.5 s.

## Inheritance

A process started under a lease can reuse it. `acquire` reads `AIRI_CPU_LEASE` from the environment. When the store holds a lease with that id, the child takes it without a new ticket. Its grant is `AIRI_CPU_GRANT`, capped at the parent's slots, and then at the request's `max`, or at the class default max when `max` is unset (`packages/cpu-slots/src/acquire.ts:163-164`, `:285-301`). When `AIRI_CPU_GRANT` is not a positive integer, the parent's slots are used. The child never releases the parent's lease. An exclusive request under a shared lease fails with `exclusive-under-shared` (`acquire.ts:167-170`), and `pnpm slots run` exits 2 (`cli.ts:137-142`).

## Vitest integration

`@proj-airi/cpu-slots/vitest` exports `withCpuSlots`. It caps `maxWorkers` only. The first wrapped config sets the root grant, and later configs can only lower it.

- Parallel browser projects receive the grant. Vitest 4.1.11's browser pool ignores the root `maxWorkers`, so browser projects are capped per project instead.
- Watch mode takes no lease when started with `--watch`. A bare `vitest` acquires at startup and releases once Vitest resolves to watch mode, through the `cpu-slots:release-in-watch-mode` plugin.
- An explicit `--watch` run is capped without checking current leases or any inherited `AIRI_CPU_GRANT`, so two watch runs can exceed the budget. In local measurements, two explicit watch runs at a budget of 2 overlapped 2 workloads, against 8 for an unwrapped control. At a budget of 12, the overlap was 6, and serial projects overlapped 1.
- The package's `dist/vitest.mjs` is built by `tsdown`. It records a sha256 of its bundled sources. `assertFreshBuild` throws `StaleBuildError` when the sources have changed since the build, so a stale bundle stops config loading.
- The build never cleans or writes `dist/` directly, because configs can load the wrapper while it runs. `tsdown` writes into `node_modules/.cache/dist-<pid>/`, and its `build:done` hook renames each file over `dist/`, skips files whose bytes match, and then deletes the staging directory. A config that loads during a rebuild therefore reads the complete old or the complete new file. A Turbo cache hit is the exception: Turbo restores a cached `dist/` file by rewriting it in place, which a concurrent load can read half-written. It does so only when `dist/` differs from its record of that cache entry.
- IDEs and direct `tsc` runs read the stale `dist/vitest.d.mts` until `pnpm -F @proj-airi/cpu-slots build` runs again.

## Turbo cache cost

Typecheck depends on the cpu-slots build, and the build's input list is narrowed in `turbo.json`. The cost is still high. A README-only edit to this package invalidates the build and all 57 typecheck tasks on a quiet tree. Warm, all 57 tasks hit the cache in 802 ms. After a README edit, none hit, and the run took 2m 9.8s. The cause is the root `package.json` devDependency `"@proj-airi/cpu-slots": "workspace:^"`, which Turbo folds into the global hash. README.md is also in the typecheck default inputs. Until both causes are fixed, expect a full typecheck after any edit to this README. The ADR's Follow-ups describe what removing the root dependency needs.

## Troubleshooting

- Stale build: `StaleBuildError` means `dist/vitest.mjs` no longer matches its sources. Run `pnpm -F @proj-airi/cpu-slots build`. IDEs and direct `tsc` runs also read the stale `dist/vitest.d.mts` until that build runs.
- Busy lock: a `lock-busy` error means another process holds the store lock. Waiters retry, and after 30 s the message names the holder, as `lock held by pid <p> for <s>s` (`packages/cpu-slots/src/store.ts:73-80`). Wait for that process to finish. Do not delete the lock directory unless its owner is confirmed dead.
- `AIRI_CPU_SLOTS=off`: every lease is a no-op, so no work queues behind the budget. Use it only when the broker should not coordinate the shell.
- `pnpm slots status`: lists the holders and the queue. It reads the store without creating it, and it retries every 500 ms while the lock is busy (`packages/cpu-slots/src/cli.ts:44-52`).
- Malformed tickets: a ticket file that fails validation is listed by `malformedTickets()` and shown by `pnpm slots status` as `queued malformed <file>`. The store prunes it once it is stale (`packages/cpu-slots/src/store.ts:375-376`, `cli.ts:63-64`). Wait for the pruning rather than editing the store by hand.

## When to use

Use the grant rule and the classes to decide how many workers a developer task may start, and wrap any CPU-heavy command that should queue behind other worktrees.

## When not to use

Do not use it to limit long-running development servers, to set an operating-system CPU quota, or to coordinate processes on another machine. On POSIX, a grandchild that calls `setsid` is not tracked.
