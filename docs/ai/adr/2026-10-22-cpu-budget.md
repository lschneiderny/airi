# CPU slot budget and QA result cache

Date: 2026-10-22
Status: accepted

## Problem

Each worktree ran its verify steps, QA gates, Vitest workers, and Turbo tasks at full width. Several worktrees running at once could saturate the machine.

The browser measurements below were taken under the broker, so they do not describe the state before the broker. Under a grant of 4 and before the browser cap was fixed, the stage-ui browser run opened 12 renderers, with a mean of 5.05 and a peak of 8.99 effective cores (`task-7-gate-review.md`). After the cap, two leased workloads ran together under the broker, which held 12 of 12 slots. Their combined peak was 10.12 effective cores (`task-7-gate-review-r2.md`). Across 81 whole-machine samples, total CPU use went above 12 cores in 5 samples, by at most 0.86 cores, because unbrokered background programs used the rest.

Separately, a T1 gate run took about 12.9 s on every invocation, and nothing reused its result when no input had changed.

## Decision

1. Add `@proj-airi/cpu-slots`, a local broker with a default budget of 12 slots. Work declares a class, and each class has bounds. Requests are granted in FIFO order. The `exclusive` class takes the whole budget.
2. Route `pnpm verify` steps, the gate CLI, and every Vitest config through the broker. Parallel browser projects are capped per project. An explicit `--watch` run is capped by its own config, but it takes no lease and ignores current leases and inherited grants (see Limitations).
3. Add a content-addressed QA result cache in `packages/qa-tools`. A hit replays a stored T1 result without starting Vitest or taking a lease. A cached run cannot serve as T3 acceptance evidence.
4. Keep the verify pass cache. It stores only passing steps and is keyed by the working tree hash.

Unbrokered fallbacks stay available. `CI` or `AIRI_CPU_SLOTS=off` makes every lease a no-op (`acquire` in `packages/cpu-slots/src/acquire.ts`). A store that cannot be written runs the command unbrokered with a stderr warning.

## Rejected alternatives

- **`VITEST_MAX_WORKERS`.** Vitest 4.1.11 forces `maxWorkers` to 1 for a project with `fileParallelism: false` (`node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:223-225`). It applies `VITEST_MAX_WORKERS` afterwards, and the variable overwrites that value (`:380`). The variable therefore raises serial projects above 1 and sets one count for every project, while the wrapper only clamps each project downward and leaves serial projects serial.
- **A global virtual store** (pnpm `enableGlobalVirtualStore`). The cpu-budget plan rejects it. The plan states no separate reason for that rejection, so this ADR records the rejection only.

## Lock protocol

The store is guarded by a directory lock, `broker.lock`.

- **Owner identity decides liveness.** The owner's `owner.json` records its token, its pid, and its start time from `performance.timeOrigin`. A lock is stale only when `isAlive` or `isSameProcess` fails.
- **Age alone never breaks a lock. A live owner is never displaced on age.** A waiter reports a holder that has kept the lock for more than 30 s as `lock held by pid <p> for <s>s` (`StoreBusyError` in `packages/cpu-slots/src/store.ts`).
- **Atomic publication.** The owner creates `broker.lock.<token>.tmp` with `owner.json` inside it, then renames it to `broker.lock`. A `.tmp` directory is removed once no transaction can hold it, or after 10 s without an owner (`Store.cleanTemporaryLocks`).
- **Tampered lock.** A `broker.lock` with no `owner.json` has no owner to check. It is broken after 10 s through a tombstone.
- **Retirement marker.** A finished owner writes `broker.lock.<token>.retired` at the store root, outside every lock directory (`Store.markerPath`). A marker that fails to write is retried on the instance's next lock, after each release, and at process exit. The store treats a lock as reclaimable when its owner has written that marker, when it is this instance's own lock whose marker is not yet written, or when its owner is gone (`Store.reclaimable`). Retiring a lock never fails a committed transaction: a busy failure is expected, and any other failure is reported on stderr while the lock is marked retired.
- **Hand deletion is the one exception.** Store files deleted by hand fall outside the accounting guarantee, and the store restores the lease even when that puts usage over budget (`Store.heartbeat`).
- **Ticket identity.** One `acquire` call uses one id for every ticket it queues and for its lease. `touchTicket` and `grant` compare that id, so a sequence number that now holds another caller's ticket is never touched or granted.
- **A committed grant is never retried as ungranted.** A transaction can report busy after its grant committed: the post-commit lock check, or a step of `grant` after the lease write, fails busy. The next poll adopts the lease that carries the call's id (`Store.adopt`) after checking it again like a fresh grant, and `enqueue` returns a ticket already queued under that id. Before this, the retry queued a second ticket, so the process held two leases, and an exclusive request or a full budget waited forever on its own lease. Letting `transact` return any result whose writes committed was rejected, because `grant` can fail between its own steps, which no rule at the transaction boundary can classify.
- **Windows sharing errors.** A rename that fails with EPERM or EBUSY is retried five times with pauses of 1 to 16 ms, then reported busy (`entry-busy` with the path), never as a fatal error. When the same entry stays busy for 30 s, the waiting line names it, and for the lock's `owner.json` the pid that last held the lock. After 5 minutes on the same entry, `acquire` rejects with `CpuSlotsError('entry-unreadable')` naming the path.
- **Failed process lookups.** A process snapshot that fails or times out is reported busy (`snapshot-failed`) and retried by waiters, by `pnpm verify` lease acquisition, and by `pnpm slots status`; lookups pause 2 s after a failure. It never rejects a waiter. Because a timed-out lookup is retried and its work is lost, the timeout is 30 s, far above a slow success, so it only cuts off a hung PowerShell. A hung lookup delays only its own caller, or process exit, for up to 30 s; it never holds the store lock.
- **Process snapshots run outside the lock.** Under the lock, a decision that needs a newer snapshot keeps the lease or ticket and asks for one; `Store.transact` takes it after the lock is released, and `snapshot()` then reads the store once more, while a waiter polls again 50 ms later. A snapshot judges a dead owner's lease only when its capture began after that death was observed (the existing observation order) and the lease names no workload that was not in the record read before the capture began. A release captures before the lock and checks again, up to three times, if the lease gained workload meanwhile; otherwise it keeps the lease. With a 300 ms injected snapshot, the lock was held 309 to 316 ms before and 6 to 9 ms after. Rejected: taking the snapshot before every lock (it would spawn PowerShell every 2 s for a steady queue that needs none), and retrying every transaction after a capture (a `grant` that committed would be run again and lose its lease).
- **A lock moved aside is never published again (F07).** A breaker renames `broker.lock` to a tombstone and then reads its owner. When its view was stale and the tombstone holds a newer, live lock, the breaker leaves it there. That owner's next `checkToken` fails with `lock-lost`, its transaction is retried, and it marks its lock retired so the tombstone is cleaned up. Each token therefore holds `broker.lock` for one unbroken interval. Before, the breaker renamed the tombstone back, so a whole foreign transaction could run while the lock was aside, and the restored owner then passed its lock checks and wrote from a stale view: with a stale owner read injected, the restored owner's `enqueue` committed after the foreign store had queued a ticket, from the counter it read before that ticket existed (test `f07` in `store.test.ts`; it fails on the old code because that `enqueue` does not throw `lock-lost`).

## Behavior that must match

- A lease is reclaimed only after its owner's death is observed and a process snapshot shows the workload is gone. Snapshots are rate-capped at one per 2 s per observer, and each snapshot process has a 30 s timeout (`Store.canRefresh`, `PROCESS_LOOKUP_TIMEOUT_MS`). The timeout was 10 s until snapshots timed out with nine heavy lanes running on 2026-10-22; a snapshot otherwise takes about 0.5 s (median 520 ms at 62% CPU load).
- On Windows, a lease was reclaimed 752 ms after its child died when the coordinator was killed without `/T`.
- Across eight coordinator-only kill repros, death to grant took 322 to 2203 ms, inside the 2.5 s bound. No grant was made while the workload lived.
- Exit handlers share a 2 s budget (`EXIT_BUSY_BUDGET_MS` in `packages/cpu-slots/src/acquire.ts`). In three measured exit runs, the exit handlers took 2478, 2515, and 2509 ms. The skipped lease was pruned after 1488, 1517, and 1512 ms, inside the 2.5 s bound.
- The Vitest bundle refuses to load when its sources differ from its build stamp (`StaleBuildError`). Rebuilding `@proj-airi/cpu-slots` clears it.
- A QA cache hit requires byte-identical closure files and an identical key. A corrupt entry is a miss.

## Measured numbers

- Cache hit: 0.3 s run time, 2.7 s with pnpm and tsx startup. A miss ran Vitest for 12.9 s.
- Refusals: a cached run given to T3 exits 2 in 2645 ms. A path that is not a run directory exits 2 in 2400 ms. Both exit before any lease is taken.
- Stale-build guard: median 1.34 ms and maximum 2.01 ms over 11 files. A cold process starts in 4.7 to 5.0 ms.
- Warm `pnpm typecheck` with a full Turbo cache: 562 ms, 57 of 57 tasks cached.
- Browser lease under a grant of 4: mean 3.47 to 3.66 cores, with peaks of 5.8 to 6.4 cores (`task-7-gate-review-r2.md:106`).
- Two leases together, a browser lease and a forced whole-repo typecheck: the broker held 12 of 12 slots, and the leased workloads peaked at 10.12 effective cores (`task-7-gate-review-r2.md:112-117`).

## Limitations

- **A grant caps worker and renderer count, not CPU time.** A browser lease under a grant of 4 averages about 3 to 3.7 cores and peaks around 6. Chromium GPU and utility processes, and the vitest node process, run outside the renderer count. Two leases together peaked at 10.12 of 12 effective cores. The budget therefore bounds parallelism rather than CPU use (`task-7-gate-review-r2.md:106-117`, `:161`).
- **Browser projects are capped per project.** Vitest 4.1.11's browser pool ignores the root `maxWorkers`.
- **Explicit `--watch` is not capped by leases.** It takes no lease and ignores current leases and inherited grants, so two watch runs can exceed the budget.
- **Any `packages/cpu-slots` edit invalidates every Turbo task cache.** The root `package.json` devDependency `"@proj-airi/cpu-slots": "workspace:^"` folds the package into Turbo's global hash (`task-turbo-inputs-gate-review.md`, B1), and `README.md` is in the default inputs of `@proj-airi/cpu-slots#typecheck`. Measured on one tree, a warm `pnpm typecheck` took 802 ms with 57 of 57 tasks cached. After a README-only edit, it took 2m 9.8s with 0 of 57 cached. This cost is accepted (decision D6, authorized by Luke on 2026-10-22): edits to `packages/cpu-slots` are rare, and removing the root dependency needs the larger change in the Follow-ups. The cost is in the cpu-slots README under "Turbo cache cost".
- **The root devDependency moves a cpu-slots-only change to the directory scope in `pnpm verify`.** The root `vitest.config.ts` and `scripts/dev-tools` import `@proj-airi/cpu-slots`, so the root `package.json` depends on it. Turbo's `--filter=...[base]` would reach the root workspace through that dependency and from there all 74 packages, including `engines/`, `integrations/`, and `plugins/`. The trigger is a change confined to a package the root depends on, such as `packages/cpu-slots`. It is not a root config change. `verify.ts` reads the root `workspace:` dependencies (`verify.ts:37-44`), and `planVerify` maps such a change to scope `all` (`verify-plan.ts:50-54`), the scope a root config change already uses (`verify-plan.ts:47-48`). Scope `all` runs `-F=./packages/* -F=./apps/* -F=./server/** -F=./services/*` (`verify.ts:52-54`), so verify no longer typechecks `engines/`, `integrations/`, or `plugins/` for this case. Seven packages outside that scope fail typecheck on `main` `2bf057c12` with the same errors: `@proj-airi/stage-tamagotchi-godot` (it needs the .NET SDK), `airi-plugin-claude-code`, `telegram-bot`, `discord-bot`, `minecraft-bot`, `satori-bot`, and `twitter-services` (`task-12-gate-review-r2.md`, BLK-R2-1). Verify on `main` never selects them. A full `pnpm typecheck` or a `...[base]` filter that reaches the root would.
- **Stale dist.** IDEs and direct `tsc` runs read the stale `dist/vitest.d.mts` until `pnpm -F @proj-airi/cpu-slots build` runs again (`task-6-gate-review-r3.md`, NOTE-6).
- **Residual check-then-act window (N1, F07).** The restore that let two stores pass the lock check is removed (see Lock protocol). `checkToken` and the rename or delete after it are still two filesystem calls, not one atomic step. A foreign transaction can interleave only if a breaker moves the lock aside and another store publishes and writes between one passing check and the single call that follows it. That window is normally microseconds, but a scheduler stall of the owner can stretch it. Write-then-verify remains the backstop for grants. Closing it fully needs an atomic compare-and-rename, which Windows directory renames do not offer.
- **QA cache stale hits.** An environment variable outside the filtered prefixes does not enter the cache key. Neither does a relative import written with a `.js` suffix for a `.ts` file, so either can return a stale hit.

## Verification

- Gate reviews covered the browser cap, lease reclaim and FIFO behavior under stress, the cache probes, and the Turbo input change. The Turbo change was rejected as described above.
- The measurements above come from local runs. The gate-review files named above are kept outside this repository, so the numbers are not reproducible from the committed tree alone.

## Follow-ups

- Remove the root devDependency on `@proj-airi/cpu-slots`. That needs both changes: move the dev tools into their own workspace package, and give the root `vitest.config.ts` a different way to import the wrapper (it imports `@proj-airi/cpu-slots/vitest` at line 1). Moving the dev tools alone does not remove the dependency. Removing it would fix the Turbo global hash and make the `verify.ts` root-dependency mapping unnecessary. Until then, any cpu-slots edit still invalidates every Turbo task cache.
- Exclude `packages/cpu-slots/README.md` from the typecheck inputs.
- Track descendants on POSIX through `setsid`, which the cpu-slots README notes is not tracked today.
- Add an opt-out for indexing of the cache and store directories.
- Add Defender guidance for the store and cache paths.
- Add a worktree pool, so new worktrees inherit a warm budget.
- Add an idle reaper for leases whose owners stay alive without doing work.
- Add a T2 result cache, with the same closure rules, because T2 results are not cached today.
- Add an adaptive budget that follows the machine's load.
