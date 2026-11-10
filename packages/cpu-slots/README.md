# @proj-airi/cpu-slots

## Purpose

A local broker that limits how many CPU-heavy developer processes run at once on one machine. Verify steps, QA gates, Vitest runs, and Turbo tasks from every worktree draw slots from one shared budget, which defaults to 12. A process waits for a grant before it starts.

This is a developer coordination tool. It is not an operating-system CPU quota, and it does not limit long-running development servers.

## Usage

The CLI runs a command under a class and reports the store:

- `pnpm slots run --class <class> [--min N] [--max N] -- <command...>` grants slots, substitutes `{grant}` in the command, and runs it. On Windows, a SIGINT or SIGTERM stops the whole child tree with `taskkill /T /F`. A normal exit only releases the lease. Only `.cmd` and `.bat` shims go through cmd.exe.
- `pnpm slots status [--json]` lists the holders and the queue. It reads the store without creating it. A lease's command shows the substituted grant once it is granted. While the store is busy, status retries every 500 ms for up to 30 s, then exits 3 with a message that names the busy reason.

Code acquires a lease directly with `acquire({ class, cwd, command })`. The lease holds its slots until released. A heartbeat refreshes it every 10 s, and the heartbeat is unreferenced, so it never keeps a process alive.

A lease lasts as long as its workload. A registered process, or any descendant of the lease owner, keeps it held. A long-lived child keeps the lease for its whole life: a `dotnet build` that leaves its build server running (`dotnet build-server`, MSBuild node reuse) holds the slots until that server exits. Run `dotnet build-server shutdown`, or build with `-nodeReuse:false`, when the budget must be freed.

## Classes

| Class | Min to max | Used by |
| --- | --- | --- |
| `test` | 2 to 6 | Root Vitest config |
| `browser` | 2 to 4 | Extra Vitest configs and browser-mode projects |
| `live` | 4 to 6 | App QA sessions, for example `pnpm slots run --class live -- sleep 20` |
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
- `AIRI_CPU_SLOTS_HISTORY_DIR`: persistent history directory. Defaults to `$XDG_STATE_HOME/airi-cpu-slots`, or `~/.local/state/airi-cpu-slots` when unset. On Windows it defaults to `%LOCALAPPDATA%\airi-cpu-slots\history`.
- `AIRI_CPU_PRESSURE_FILE`: CPU PSI input, defaulting to `/proc/pressure/cpu` on Linux. An explicit override works on any platform. Missing, unreadable, or malformed input disables pressure admission and keeps the normal budget rules.
- `AIRI_CPU_PRESSURE_IDLE` and `AIRI_CPU_PRESSURE_HOLD`: integer percentages from 0 through 100, defaulting to 20 and 70. Invalid values throw `CpuSlotsError('bad-pressure-threshold')` naming the variable before a ticket is queued. If the thresholds overlap, hold takes precedence.
- `AIRI_CPU_SLOTS=off`, or a `CI` environment variable: every lease is a no-op. Nothing is queued.
- If the store path returns `EROFS`, `EACCES`, `ENOENT`, or `ENOTDIR`, the command runs unbrokered and prints one stderr line saying so.

## Telemetry

`pnpm slots history [--since <duration>] [--json]` summarizes retained history by policy class, including `live` even though its store wire class is `browser`. Durations take a positive integer and `ms`, `s`, `m`, `h`, or `d`, for example `--since 24h`.

Each acquisition appends `ticket`, the first `wait`, `grant`, `release`, signal `abort`, and `unreadable` events to `events.jsonl` after store transactions return. Records contain `ts` (Unix milliseconds), `event`, `id`, `seq`, `class`, `min`, `max`, `slots`, `budget`, `heldBefore`, `queueAhead`, `waitMs`, `heldMs`, `lastWaitReason`, `pid`, `cwd`, and `command`. Unknown sequence and queue observations are `null`; bounds are capped at the budget. A release records the owner's release call or exit cleanup; registered surviving workloads can still hold the store lease. Inherited calls do not duplicate their parent's events. The acquired handle exposes `waitMs`.

The summary counts grants, takes wait distributions from grants and hold distributions from releases, and lists the five longest granted waits with commands. Median averages the two middle values; p90 uses the nearest rank. Empty distributions are zero. `--since` filters each event by timestamp. Malformed lines are skipped and counted, including structurally invalid JSON records.

Grant and wait events also contain `pressure: { someAvg10 }`, or `pressure: null` when no sample is available. The sample is read before the transaction for that poll. A pressure-delayed grant retains `lastWaitReason: 'cpu-pressure'` even after a cooler reading permits it to start.

History survives temporary-store cleanup. Before an append, a file exceeding 5 MiB is renamed to `events.1.jsonl`, replacing the previous segment; summaries read both segments. Concurrent rotation tolerates a missing source. Appends run outside the broker lock, and write failures print a diagnostic without changing lease accounting. Commands and working directories are stored as supplied, so avoid putting secrets in command arguments.

## Grant rule

`decide(state, budget, now, pressure?, thresholds?)` is pure. The caller reads pressure and parses thresholds outside the store transaction; the store receives the same data when rechecking a grant. It blocks grants above capacity or while an exclusive lease is held. It grants the lowest ticket sequence (the head) whenever that request fits. Otherwise, it scans later tickets in sequence order and grants the first non-exclusive request whose minimum fits the free slots.

CPU PSI `some avg10` measures the percentage of the last ten seconds during which at least one task was waiting for CPU. At or above `PRESSURE_HOLD` (70), a nonempty broker grants nothing and reports `cpu-pressure`. An empty broker can still grant its first request using the normal budget, so external CPU load cannot deadlock its queue. Below `PRESSURE_IDLE` (20), shared grants may use `budget + floor(budget / 4)`, or 15 slots for the default budget of 12. At intermediate pressure, or without a reading, capacity stays at the normal budget. Existing leases never shrink as pressure changes.

`Store.fits()` enforces the fixed shared ceiling of `budget + floor(budget / 4)` when committing or adopting a lease, independent of pressure. Adoption recovers an already committed grant even if pressure rose since its write. Pressure admission belongs only to the decision rule. Exclusive grants always require zero held slots and receive exactly `budget`; idle pressure never expands or bypasses them.

Non-exclusive grants share the free slots among all queued non-exclusive tickets, including the selected ticket and any blocked shared head. With one such ticket, the grant is `min(max, free)`. With several, it is `clamp(floor(free / waiting), min, min(max, free))`, using the request's bounds capped by the budget. Exclusive tickets do not count toward `waiting`. Three queued tests with 12 free slots therefore receive 4, 4, and 4 slots in turn; a lone test receives up to 6. The same sizing rule applies to backfill. A lease keeps its grant for its entire lifetime; later arrivals and cancellations do not resize held leases.

After a non-exclusive head has waited 60 seconds (`HEAD_AGING_MS`), backfill stops with reason `head-aging` until enough running work drains for the head to fit. Exclusive heads never age: later shared work may continue, and exclusive tickets can wait indefinitely under steady load. An exclusive ticket is only granted at the head with zero held slots and takes the whole budget.

`pnpm slots status` shows each queued ticket's decision reason: `over-budget`, `exclusive-held`, `leases-held`, `insufficient-slots`, `head-aging`, or `cpu-pressure` when no grant is possible; `queue-ahead` when another ticket is selected; and `ready` for the selected ticket (`null` in JSON). An empty queue produces `queue-empty`. Waiters poll every 500 ms, or every 50 ms right after a busy lock. Each poll reads PSI once before taking the lock. The store rechecks the decision with its current time under the lock; a backfill rejected at the aging boundary retries on its next poll.

Scheduling QA must set both `AIRI_CPU_SLOTS_DIR` and `AIRI_CPU_SLOTS_HISTORY_DIR` to private temporary directories before starting any command. Set `AIRI_CPU_PRESSURE_FILE` to a fixture containing `some avg10=5.00 avg60=5.00 avg300=5.00 total=1` for idle pressure, or replace the three averages with `50.00` for intermediate pressure and `90.00` for hot pressure. Three queued tests receive 5, 5, 5 at idle pressure and 4, 4, 4 at intermediate pressure or with a missing fixture. A hot fixture holds a lint ticket behind one running test until rewritten to intermediate pressure.

On November 10, 2026, the Linux workstation's real `/proc/pressure/cpu` was sampled once per second before verification, during one `pnpm verify --only test`, and during three concurrently requested runs. Each verify also used `--base luke/feat/test-qa-revamp --gate --force` so it exercised the full task changes rather than a cached pass. All four runs exited 0. Admission used the intermediate fixture and private broker/history directories; only the measurements read the real kernel file.

| Phase | Samples | Minimum `someAvg10` | Median | Maximum |
| --- | ---: | ---: | ---: | ---: |
| This lane idle for ten seconds | 10 | 66.55 | 67.78 | 68.18 |
| One verify | 241 | 62.60 | 69.14 | 77.46 |
| Three requested verifies | 328 | 56.97 | 65.06 | 74.58 |

That sample was contaminated: it is a shared-workstation reading, not a machine-idle baseline. Other lanes were neither stopped nor inspected. The three concurrent commands initially received two six-slot leases while the third queued; existing grants do not shrink. The single run also rebuilt packages, whereas subsequent builds were cached. The baseline was already above the idle threshold, and the single-run peak exceeded the hold threshold, but the lower peak during the three-run phase does not establish that these thresholds are wrong for the workload. The defaults were therefore not tuned to this sample. The readings and command logs are in `.omo/evidence/test-qa-revamp/task-19-calibration.json` and `task-19-calibration-*.txt`.

The quiet-host calibration followed on November 10, 2026, on the same 16-CPU workstation with the default budget of 12, with only this lane running and the real broker and live `/proc/pressure/cpu` in use. `some avg10` readings, sampled every 5 seconds:

| Phase | Samples | Median | p90 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Idle baseline (2 minutes) | 25 | 0.00 | 0.00 | 0.00 |
| One `pnpm verify` (test, forced) | 18 | 0.00 | 1.43 | 2.14 |
| Two concurrent verifies (test and typecheck, forced) | 20 | 0.92 | 5.56 | 10.14 |

No grant was delayed by `cpu-pressure`. Idle pressure sits far below 20, so a quiet host gets the bounded overcommit, and no verify on its own approaches 70. The thresholds of 20 and 70 are confirmed (2026-11-10) and stay unchanged. The readings are in `.omo/evidence/test-qa-revamp/task-19-calibration-quiet.md`.

The store is written under a directory lock. Every mutation runs in one transaction. A grant is written as a lease, then checked again, and removed if the check fails. A lease is reclaimed only after its owner's death is observed and a process snapshot shows the workload is gone. Snapshots are rate-capped at one per 2 s per observer, and each snapshot process has a 30 s timeout (`Store.canRefresh` in `packages/cpu-slots/src/store.ts`, `PROCESS_LOOKUP_TIMEOUT_MS` in `processes.ts`). A snapshot takes about 0.5 s; the timeout only cuts off a hung PowerShell, because a timed-out lookup is retried and its work is lost.

No process lookup runs while the store lock is held, so a slow or hung PowerShell never blocks another broker client. Under the lock, a decision that needs a newer snapshot keeps the lease or ticket for now, and the snapshot is taken after the lock is released (`Store.transact`). `snapshot()` called on its own then reads the store again with it; a waiter polls again 50 ms later. A snapshot judges a dead owner's lease only when it began after that death was observed and the lease names no workload that was registered after the snapshot began; otherwise the lease keeps counting until a newer snapshot can judge it. A release takes its snapshot before the lock and checks again if the lease gained workload meanwhile. With a 300 ms injected snapshot, the lock was held 309 to 316 ms before this change and 6 to 9 ms after it.

A lock that a breaker moved aside is never published again. When the breaker's view was stale and it moved a live lock, that owner's next lock check fails (`lock-lost`) and its transaction is retried, so two stores never pass the lock check for overlapping intervals.

One `acquire` call uses one id for every ticket it queues and for the lease it is granted. `touchTicket` and `grant` compare that id, not only the ticket sequence, so a sequence that now holds another caller's ticket is never touched or granted. When a transaction reports busy after its grant committed, the next poll adopts the lease that carries the call's id (`Store.adopt`), after checking it again like a fresh grant, instead of queueing a second ticket behind its own lease. A cancelled call removes its ticket and any such lease (`Store.withdraw`).

A failed process lookup, such as a PowerShell snapshot that hits its timeout, proves nothing about any process. The store reports it as busy (`snapshot-failed`), waiters retry it, and lookups pause for 2 s after a failure. Measured on Windows, a lease was reclaimed 752 ms after its child died when the coordinator was killed without `/T`. Across eight coordinator-only kill repros, death to grant took 322 to 2203 ms, inside the 2.5 s bound, and no grant was made while the workload lived.

Exit handlers share a 2 s budget (`EXIT_BUSY_BUDGET_MS`). A running snapshot can push the total to about 2.5 s, or up to its 30 s timeout when PowerShell hangs. One process `exit` listener runs the exit cleanup of every lease, however many a process holds.

## Inheritance

A process started under a lease can reuse it. `acquire` reads `AIRI_CPU_LEASE` from the environment. When the store holds a lease with that id, the child takes it without a new ticket. Its grant is `AIRI_CPU_GRANT`, capped at the parent's slots, and then at the request's `max`, or at the class default max when `max` is unset (`reuse` and the inherited-lease check in `packages/cpu-slots/src/acquire.ts`). When `AIRI_CPU_GRANT` is not a positive integer, the parent's slots are used. The child never releases the parent's lease. An exclusive request under a shared lease fails with `exclusive-under-shared` (`assertShareable` in `acquire.ts`), and `pnpm slots run` exits 2 (the `main` rejection handler in `cli.ts`). `qa:motion t3` also exits 2 with a message that names the inherited lease.

## Vitest integration

`@proj-airi/cpu-slots/vitest` exports `withCpuSlots`. It caps `maxWorkers` only. The first wrapped config sets the root grant, and later configs can only lower it.

- Parallel browser projects receive the grant. Vitest 4.1.11's browser pool ignores the root `maxWorkers`, so browser projects are capped per project instead.
- Watch mode takes no lease when started with `--watch`. A bare `vitest` acquires at startup and releases once Vitest resolves to watch mode, through the `cpu-slots:release-in-watch-mode` plugin.
- An explicit `--watch` run is capped without checking current leases or any inherited `AIRI_CPU_GRANT`, so two watch runs can exceed the budget. In local measurements, two explicit watch runs at a budget of 2 overlapped 2 workloads, against 8 for an unwrapped control. At a budget of 12, the overlap was 6, and serial projects overlapped 1.
- The package's `dist/vitest.mjs` is built by `tsdown`. It records a sha256 of its bundled sources. `assertFreshBuild` throws `StaleBuildError` when the sources have changed since the build, so a stale bundle stops config loading.
- The build never cleans or writes `dist/` directly, because configs can load the wrapper while it runs. `tsdown` writes into `node_modules/.cache/dist-<pid>/`, and its `build:done` hook renames each file over `dist/`, skips files whose bytes match, and then deletes the staging directory. A build that crashes leaves its staging directory behind, so the `build:prepare` hook deletes every `dist-<pid>` directory whose process is no longer alive. A config that loads during a rebuild therefore reads the complete old or the complete new file. A Turbo cache hit is the exception: Turbo restores a cached `dist/` file by rewriting it in place, which a concurrent load can read half-written. Turbo compares file metadata, not content: it rewrites a `dist/` file whenever its metadata, such as its modification time, differs from its record of that cache entry, even when the bytes are identical.
- IDEs and direct `tsc` runs read the stale `dist/vitest.d.mts` until `pnpm -F @proj-airi/cpu-slots build` runs again.

## Turbo cache cost

Typecheck depends on the cpu-slots build, and the build's input list is narrowed in `turbo.json`. The cost is still high. A README-only edit to this package invalidates the build and all 57 typecheck tasks on a quiet tree. Warm, all 57 tasks hit the cache in 802 ms. After a README edit, none hit, and the run took 2m 9.8s. The cause is the root `package.json` devDependency `"@proj-airi/cpu-slots": "workspace:^"`, which Turbo folds into the global hash. README.md is also in the typecheck default inputs. Until both causes are fixed, expect a full typecheck after any edit to this README. The ADR's Follow-ups describe what removing the root dependency needs.

## Troubleshooting

- Stale build: `StaleBuildError` means `dist/vitest.mjs` no longer matches its sources. Run `pnpm -F @proj-airi/cpu-slots build`. IDEs and direct `tsc` runs also read the stale `dist/vitest.d.mts` until that build runs.
- Busy lock: a `lock-busy` error means another process holds the store lock. Waiters retry, and after 30 s the message names the holder, as `lock held by pid <p> for <s>s` (`StoreBusyError` in `packages/cpu-slots/src/store.ts`). Wait for that process to finish. Do not delete the lock directory unless its owner is confirmed dead.
- Busy entry: an `entry-busy: <path>` error means a store file could not be read or replaced, usually a Windows sharing error (EPERM or EBUSY) while another process renames, deletes, or scans it, for example an antivirus scanner. A rename is retried five times with pauses of 1 to 16 ms before it is reported busy. Waiters retry. When the same path stays busy on every poll for 30 s, the waiting line names that path, and for the lock's `owner.json` the pid that last held the lock. After 5 minutes on the same path, `acquire` rejects with `CpuSlotsError('entry-unreadable')`, whose message names the path. Check what holds that file open; deleting store files by hand is outside the accounting guarantee.
- Failed process snapshot: `snapshot-failed` means a process lookup failed or timed out. Waiters retry it; it never rejects them. A snapshot that fails after a transaction committed never undoes that transaction; the store keeps the leases it could not judge and retries the snapshot after 2 s.
- `AIRI_CPU_SLOTS=off`: every lease is a no-op, so no work queues behind the budget. Use it only when the broker should not coordinate the shell.
- `pnpm slots status`: lists the holders and the queue. It reads the store without creating it. It retries every 500 ms while the store is busy, for up to 30 s, and then exits 3 with the busy reason (`readStatusWithin` in `packages/cpu-slots/src/status.ts`).
- Malformed tickets: a ticket file that fails validation is listed by `malformedTickets()` and shown by `pnpm slots status` as `queued malformed <file>`. The store prunes it once it is stale (`Store.records` in `packages/cpu-slots/src/store.ts`, and the `queued malformed` line in `cli.ts`). Wait for the pruning rather than editing the store by hand.

## When to use

Use the grant rule and the classes to decide how many workers a developer task may start, and wrap any CPU-heavy command that should queue behind other worktrees.

## When not to use

Do not use it to limit long-running development servers, to set an operating-system CPU quota, or to coordinate processes on another machine. On POSIX, a grandchild that calls `setsid` is not tracked.
