# cpu-budget - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** This is for agents working side by side on your machine, and for you at your desk.
- Today every test, type check, gate, and install sizes itself to the whole machine. When several run at once, tests time out, browser tests flake, and rendered captures get spoiled.
- Afterwards, they share a budget of 12 of the 16 cores. Work that doesn't fit waits its turn and says what it is waiting for, and a rendered capture can claim the whole machine while it runs.

**What you'll get:**
- A small shared coordinator that hands each heavy command a number of workers and takes them back afterwards. It covers every test setup in the repository and the motion QA commands.
- A status view showing who holds what.
- A cache that answers a repeated motion gate or scorer check almost instantly when nothing it depends on has changed. Cached answers are clearly marked, never count as acceptance evidence, and can always be bypassed.

**Why this approach:**
- The tools already accept a worker count. They just each pick one on their own, so one coordinator that hands out the counts fixes the overload without rewriting the tools.
- The gates already prove they produce identical results for identical inputs. That makes reuse safe as long as the cache records everything a run actually read, including the scoring code that runs outside the test runner.

**What it will NOT do:**
- It won't throttle dev servers or open windows.
- It won't change antivirus, search indexing, or drive settings.
- It won't cache rendered or browser runs, and it won't change any gate rule, recipe, or test.

**Effort:** Large
<!-- Effort is exactly ONE band, never hours/days. Quick = single edit, minutes of agent work; Short = one focused change, a few files; Medium = multi-file feature in one session; Large = several waves, one long session; XL = multi-session or architectural work. A written duration is rewritten to a band. -->
**Risk:** Medium. A coordinator bug could make commands wait. Leases expire when their owner dies, the coordinator steps aside when its storage is unavailable, and one switch turns it off entirely.

**Decisions to sanity-check:**
- The per-kind worker ranges. Gates now top out at 10 of today's 15 workers, so a lone full gate runs about 1.5 times slower.
- Capping all 48 test setups, not just the heavy ones. That adds the new package as a dependency of most packages.
- Packaging builds are run through the coordinator by hand, since there's no script to wrap.

Your next move: start execution with `/ulw-execute cpu-budget`. The plan went through 8 review rounds; the last round's three fixes were applied without a ninth review, at your direction. Full execution detail follows below.

---

> TL;DR (machine): Large, medium risk.
> - A zero-dependency `@proj-airi/cpu-slots` lease broker, run with tsx: 12-slot budget, strict FIFO, token-checked mkdir lock, heartbeat liveness, env inheritance.
> - Wired into the root turbo scripts (`{grant}`), verify per command, wt install, all 48 vitest configs through `withCpuSlots`, and the qa-tools gate, validate, T3, and qa:test commands.
> - A T1 gate and validate-scorer result cache keyed by the Vite plus CLI module closure, used as a local check only.
> - 13 todos + F1-F4.

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected users:**
- **Agents in parallel worktrees.** They run `pnpm verify`, `pnpm typecheck`, `pnpm build*`, `pnpm test:run`, `pnpm qa:test`, `pnpm qa:motion ...`, `pnpm wt new`, and direct `vitest` (`pnpm -F <pkg> exec vitest run ...`, `node_modules/.bin/vitest`).
  - Today: each run sizes itself to the whole 16-core machine (vitest and the gates default to cores − 1 = 15).
  - After: every such run takes a slice of a shared 12-slot budget, runs with that many workers, waits in line when the budget is used, and prints why.
- **Luke at his desk,** including T3 rendered captures.
  - Today: agent load slows the desktop and spoiled the 2026-10-20 T3 verdicts.
  - After: about 4 cores stay free, and T3 holds the machine exclusively.
- **CI** (`.github/workflows`, `CI=true`) and the pre-commit hook (`nano-staged` → `moeru-lint --fix`). They behave exactly as today.
- **Gate reviewers and evidence consumers** (T3 `--t1-report`, the final-wave reviewers, `evidence archive`). They never receive a cached result as acceptance evidence.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Brokered work never holds more than the budget: 12 slots by default, overridable with `AIRI_CPU_BUDGET`. The only exception is store files deleted by hand; then no new grants happen until usage is back under budget. | Several agents must not oversubscribe the machine. |
| IS-2 | Every brokered command that accepts a worker count runs with one equal to its grant: vitest `--maxWorkers` or the config `maxWorkers`, turbo `--concurrency`, and gate or validate `--workers`. Under an inherited lease, the child vitest process's own config wrapper enforces `min(parentGrant, classMax(detectedClass))`. The detected class is `browser` whenever its config or any inline project enables browser mode, so a browser suite never exceeds 4, whatever flags its spawner used. Commands with no worker knob (`build:tamagotchi`, `typecheck:engines`, packaging) hold a lease of their class without a flag. | A cap the tools ignore does nothing. A browser suite under a `test` lease must still stay within the browser class. |
| IS-3 | Grants follow strict FIFO. An exclusive lease (T3, packaging) waits until no lease is held, then blocks new grants until it releases. | T3 needs a quiet machine, and today's lock is prose only. |
| IS-4 | A lease stops counting once its owner process and its whole workload have exited: every workload process it registered, plus their descendants. That is observed by any broker call, at the latest within 2.5 s by a waiter (one 2 s snapshot window plus one 500 ms poll, M4), and on the next fresh snapshot in `status`. A workload that outlives its coordinator (`taskkill /F` without `/T`, POSIX-detached suites) keeps the lease counting until it exits. A lease whose owner is alive keeps counting, even when its heartbeat stalls (sleep, suspend, a blocked event loop), so the broker never hands out slots that are still in use. Nested commands inherit the parent lease and never deadlock. An exclusive request under a non-exclusive parent fails fast with exit 2. | This prevents a repeat of the PID-reuse and lock misfires, and it is what keeps IS-1 and IS-3 strict. `wt new` → install → postinstall build, and gate → vitest, are nested. |
| IS-5 | With `CI=true` or `AIRI_CPU_SLOTS=off`, the broker creates no files, does not wait, and every command keeps today's parallelism. | CI and emergency bypass. |
| IS-6 | `pnpm slots status [--json]` and `pnpm dev:top` show holders, classes, grants, the queue, and wait times. A waiting command prints one waiting line, then its grant. | Agents and Luke must see why work waits. |
| IS-7 | A T1 `gate` or T1 `validate-scorer` rerun whose recorded inputs are unchanged returns the stored verdict and exit code in seconds, marked `CACHED`. Changing any recorded input, CLI-side or worker-side, misses the cache. | A deterministic rerun is minutes of wasted all-core CPU. |
| IS-8 | A cached result is a local check only. Its `run.json` carries `cache.hit`, `--t1-report` refuses it, and the motion-qa skill requires `--fresh` for acceptance evidence. | Luke's decision, 2026-10-21. |
| IS-9 | Verify's pass-cache key does not depend on the granted worker count. | The grant varies between runs; a key that includes it would never hit. |
| IS-10 | Every vitest config in the repository is capped, not only the heavy ones. Watch mode never holds a lease. | Agents run package suites directly, and an uncapped small suite still spawns 15 workers. |
| GAP-1 | No concurrency cap exists anywhere: turbo has none and neither does root vitest. Vitest defaults to cores − 1 (vitest 4.1.11 `dist/chunks/cli-api.CnMVyzaz.js:3832-3838`). The gate and validate-scorer default to `cpus - 1` (`packages/qa-tools/src/motion/gate/cli.ts:68`, `src/motion/validation/cli.ts:43`). | Violates IS-1 and IS-2. |
| GAP-2 | Exclusivity is prose only (`.agents/skills/motion-qa/SKILL.md:70`, `H:/llm/ollama/tmp/qa-tooling-heavy.lock`). | Violates IS-3. |
| GAP-3 | No lease, liveness, or inheritance mechanism exists. | Violates IS-4 and IS-5. |
| GAP-4 | `dev:top` shows processes only (`scripts/dev-tools/top.ts:13-19`). | Violates IS-6. |
| GAP-5 | Gates and validation always recompute. The report is sealed by `determinismHash = sha256(body)` (`packages/qa-tools/src/motion/gate/aggregate.ts:46-47`) and is identical for identical inputs. | Violates IS-7. |
| GAP-6 | `RunManifest` has no cache field (`packages/qa-tools/src/evidence/run.ts:38-52`). `t3-gate.ts:215` checks only `determinismHash`. | Violates IS-8. |
| GAP-7 | `verifyCacheKey` hashes the full command (`scripts/dev-tools/verify.ts:96-97`, `scripts/dev-tools/verify-cache.ts:23`). | Violates IS-9. |
| GAP-8 | 48 vitest configs (`git ls-files "*vitest*.config.ts"`) set their own workers or none. | Violates IS-10. |

### Must have
- **M1, package.** `packages/cpu-slots`, named `@proj-airi/cpu-slots`.
  - private, `type: module`, version `0.12.0-beta.5` (matching qa-tools), and zero runtime dependencies.
  - Run with `tsx`, like every other dev tool (`package.json:53-55`). Use extensionless relative imports.
  - `exports`: `.` → `./src/index.ts`, and `./vitest` → `./src/vitest.ts`.
  - Scripts: `typecheck` (`tsc --noEmit`).
  - Ships a structured README.
  - Tests run in a root Vitest project, `packages/cpu-slots`, added to `vitest.config.ts` projects.
- **M2, store.**
  - Root: `process.env.AIRI_CPU_SLOTS_DIR`. Otherwise, on win32, `join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'airi-cpu-slots')`; elsewhere, `join(os.tmpdir(), 'airi-cpu-slots')`. LOCALAPPDATA is stable across PowerShell, Git Bash, and a different per-shell `TEMP`, so the budget is not silently split.
  - If the root cannot be created or written (`EROFS`, `EACCES`, `ENOENT` from a sandboxed build), print one `cpu-slots: store unavailable (<code>), running unbrokered` warning and return a no-op lease.
  - Layout:
    - `broker.lock/` holds `owner.json {token, pid, startedAt, at}`. It only ever becomes visible already containing `owner.json` (M3).
    - `counter.json` holds `{next}`.
    - `tickets/<seq>.json` holds `{seq, id, pid, class, min, max, exclusive, cwd, command, createdAt}`.
    - `leases/<id>.json` holds `{id, pid, startedAt, class, slots, exclusive, cwd, command, createdAt, workload: [{pid, startedAt}]}`. `workload` is appended through `lease.addWorkload(pid)`, using the same temp + rename write.
  - Every write is temp file + `rename`. Listings skip `*.tmp`.
  - A file that fails to parse counts 0 and is pruned once stale.
- **M3, lock.**
  - **Atomic publication.**
    - Build the lock off to the side: `mkdir broker.lock.<token>.tmp`, then write `owner.json` inside it.
    - Publish it with `rename(broker.lock.<token>.tmp, broker.lock)`. A directory rename onto an existing non-empty directory fails, so the lock is never visible without an owner.
    - If publication fails because `broker.lock` exists, delete your own `.tmp` directory and wait.
    - A crash before the rename leaves only a `broker.lock.<token>.tmp` directory, which never blocks anyone. Every acquirer first removes `.tmp` directories whose `owner.json` names a gone owner (dead pid or a different process), or that have no `owner.json` and are older than 10 s. A writer still mid-publication is always under 10 s.
  - A `broker.lock` without `owner.json` can only come from hand tampering, since publication is atomic. Break it after 10 s through the tombstone path below.
  - `owner.json` also records `startedAt`, the owner's process start time (`performance.timeOrigin`).
  - A lock is stale only when its owner is gone: `isAlive(pid)` is false, or `isSameProcess(pid, startedAt)` is false (PID reuse).
  - Age alone never breaks a lock. When a live owner has held it for over 30 s, waiters say so in the waiting line (`lock held by pid <p> for <s>s`) and keep waiting.
  - Break a stale lock by renaming `broker.lock` to `broker.lock.<random>.tomb`, then reading the token inside. If the token differs from the stale one observed, rename it back and treat the lock as busy. Otherwise delete the tombstone.
  - Every commit re-reads `owner.json` and aborts on a token mismatch.
  - Publication `rename` errors `EEXIST`, `ENOTEMPTY`, `EPERM`, `EACCES`, and `EBUSY` mean busy: delete your `.tmp` directory and retry on the next poll. `ENOENT` on the store root means create it recursively and retry.
  - `rename` errors `EPERM` and `EBUSY` are retried up to 5 times.
- **M4, liveness.**
  - The heartbeat is `utimesSync(file, now, now)` every 10 s, using the injected clock.
  - Lease and ticket files record `startedAt`, as in M3.
  - A lease is live when `isAlive(pid)` and either:
    - its heartbeat is fresh (`now - mtimeMs < 45_000`), or
    - `isSameProcess(pid, startedAt)` is true. This identity check runs only when the heartbeat is stale.
  - A lease is pruned only when its owner is gone and its workload is gone. A live owner with a stalled heartbeat is never pruned.
    - One function, `workloadAlive(lease, snapshot)` in `src/liveness.ts`, decides this for pruning, `release()`, and exit cleanup alike. The workload is gone when no recorded workload pid is alive and the same process, and no live process descends from the owner or any recorded workload pid, dead or alive.
    - Descent: on win32, walk each live process's `ParentProcessId` chain, which Windows keeps after a parent dies. A process counts if any link equals the owner pid or a recorded workload pid, and the process was created after the lease's `createdAt`. A grandchild whose parent, the registered workload, has exited still matches through that recorded pid. On POSIX, the process group: a workload spawned `detached` leads its own group, so any live process with `pgid` equal to a workload pid counts.
    - **Stated POSIX limitation:** a descendant that itself detaches (`setsid`, Node `detached: true`) after its registered ancestor exits has no kernel-visible link left, so it is not tracked. Nothing in the repo spawns such grandchildren under a lease; the qa:test suites it detaches are direct children and are registered. Win32, the primary platform, tracks them through the `ParentProcessId` chain. The README and ADR state this limitation.
    - The descent check needs a process snapshot, implemented in `src/processes.ts` with no dependencies:
      - win32: one `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress"`, the same source `scripts/dev-tools/lib/processes.ts` reads;
      - POSIX: `ps -A -o pid=,ppid=,pgid=,lstart=`.
      - The snapshot is injectable for tests.
      - It runs only on the slow path: the owner is dead, or its heartbeat is stale and the identity check is needed. One observer takes at most one snapshot per 2 s.
  - `isAlive` is `process.kill(pid, 0)`: `ESRCH` means dead, `EPERM` means alive.
  - `isSameProcess` compares the pid's OS creation time with `startedAt`, within a 2 s tolerance:
    - win32: `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` `CreationDate`, the same lookup `scripts/dev-tools/top.ts:44-58` already uses;
    - POSIX: `ps -o lstart= -p <pid>`.
    - It is injectable for tests.
  - Tickets hold no slots. A ticket is pruned when its owner is gone or when it is older than 45 s without a touch. A waiter that finds its ticket gone enqueues again at the back.
  - Waiters touch their ticket on every 500 ms poll.
  - If an observer's own tick gap is over 30 s (sleep or a clock jump), it skips ticket pruning for that tick.
  - A holder whose lease file is gone (`ENOENT` on heartbeat) can only have lost it through external tampering, since the broker never prunes a live owner. The holder re-registers the lease, and no new grants happen until usage is back under budget. Hand-deleted store files are outside the IS-1 guarantee; the README says so.
- **M5, grant rule.** A pure function `decide(state, now)`.
  - Clamp each request: `min = min(min, budget)`, `max = min(max, budget)`.
  - Grant only to the queue head.
  - Non-exclusive: grant when no exclusive lease is held and `free >= min`, with `grant = min(max, free)`.
  - Exclusive: grant when `held == 0`, with `grant = budget`.
  - While anything is over budget, no new grants.
  - **Write-then-verify commit.** This keeps IS-1 and IS-3 even if two brokers ever commit concurrently.
    - After writing its lease file, the granter re-reads every lease file.
    - It keeps the grant only if (a) the live total, including its own, is at or under the budget, and (b) the exclusivity rules still hold: an exclusive lease sees no other lease, and a non-exclusive one sees no exclusive lease.
    - Otherwise it deletes its own lease and retries on the next poll.
    - A later writer always sees an earlier writer's file, so two conflicting grants cannot both survive their verification.
- **M6, classes.** `src/classes.ts`, slots as `min-max`:
  - `test` 2-6
  - `browser` 2-4
  - `typecheck` 2-6
  - `build` 2-6
  - `lint` 1-1
  - `install` 4-4
  - `gate` 4-10 (Luke, 2026-10-21)
  - `exclusive` uses the whole budget
- **M7, acquire API.**
  - Signature: `acquire({ class, min?, max?, command, cwd }) → Promise<Lease>`, where `Lease = { id, grant, exclusive, env: { AIRI_CPU_LEASE, AIRI_CPU_GRANT, AIRI_CPU_CLASS }, addWorkload(pid: number): void, release(): void }`. Every caller that spawns work under a lease calls `addWorkload(child.pid)` right after the spawn. `release()` and the exit cleanup share one guard, `releaseIfIdle()`:
    - It takes a synchronous process snapshot (`spawnSync` of the M4 snapshot command; allowed inside `exit` handlers) and calls `workloadAlive(lease, snapshot)`, the same rule pruning uses.
    - It deletes the lease file only when that returns false, meaning no registered workload and no descendant of the owner or of a registered workload is alive.
    - It always takes the snapshot, even when nothing was registered. The owner's own unregistered children, such as vitest pool workers orphaned by a crash, are descendants of the owner pid and must keep the lease. Todo 3 records the snapshot's cost per release on win32 in its evidence; it is informational, not asserted.
    - Otherwise it leaves the file, now owner-dead with a live workload. M4 keeps it counting, and pruning removes it once the workload and its descendants are gone.
    - CLI `run` and the qa-tools spawners call `release()` on the child's `close` event, when the workload is normally gone.
  - When `CI` is truthy or `AIRI_CPU_SLOTS=off`, it returns a no-op lease with `grant = null` and touches no files.
  - Inheritance: if `process.env.AIRI_CPU_LEASE` names a live lease, return `{ grant: min(max, AIRI_CPU_GRANT), inherited: true }` without queueing. An exclusive request under a non-exclusive inherited lease throws `CpuSlotsError('exclusive-under-shared')`.
  - While a lease is held, repeat calls in the same process reuse it. After `release()`, the next call queues again.
  - `process.env` is never mutated.
  - Cleanup: `process.on('exit')` calls `releaseIfIdle()` synchronously. It never deletes a lease while `workloadAlive` is true, which covers registered workloads and all their descendants. There are no SIGINT or SIGTERM handlers in library mode.
  - Waiting prints `cpu-slots: waiting for <min> slot(s) of <class> (held <h>/<budget>, <q> ahead)` once to stderr, then `cpu-slots: granted <g> (<class>)`.
  - `AIRI_CPU_BUDGET` must be a positive integer; anything else throws.
- **M8, CLI.** `tsx packages/cpu-slots/src/cli.ts`.
  - `run --class <c> [--min N] [--max N] -- <cmd...>`:
    - substitutes `{grant}` in each argument;
    - drops any argument containing `{grant}` when the lease is a no-op;
    - spawns the command with the lease env merged in and `shell: process.platform === 'win32'`, so pnpm and turbo shims work, then calls `lease.addWorkload(child.pid)`;
    - forwards SIGINT and SIGTERM to the child and exits with the child's code.
  - `status [--json]`: the first line is the resolved store path. Then leases (class, slots, worktree from `cwd`, age, command), the queue (class, min-max, wait), and held/budget.
  - Exit codes: 2 for usage errors and `exclusive-under-shared`.
- **M9, wiring.**
  - Root scripts `typecheck`, `build`, `build:web`, `build:apps`, `build:packages`, and `build:engines` become `tsx packages/cpu-slots/src/cli.ts run --class <typecheck|build> -- turbo run ... --concurrency={grant}`.
  - `build:tamagotchi` (a non-turbo `app:build`) and `typecheck:engines` (dotnet) use `run --class build -- <existing>`; they are lease-only, with no flag.
  - `capture:tamagotchi` (vishot capture) uses `run --class exclusive -- <existing>`.
  - Packaging through `pnpm -F @proj-airi/stage-tamagotchi exec electron-builder` has no root script. It stays unbrokered, and the docs tell agents to run it as `pnpm slots run --class exclusive -- <command>`.
  - New root script: `"slots": "tsx packages/cpu-slots/src/cli.ts"`.
  - `verify.ts`:
    - acquires per command in-process:
      - `typecheck`, passing `--concurrency=<grant>` to turbo;
      - `lint`;
      - for each `vitest related` command, `browser` for every `extraTestConfigs` entry (`scripts/dev-tools/verify-plan.ts:16-21`; all four configs contain browser projects) and `test` for the root config;
      - no `--maxWorkers` flag for vitest. The child's wrapper enforces the cap (M11), because a CLI `--maxWorkers` would override the wrapper's root value;
    - releases after each command;
    - removes `--maxWorkers=*` and `--concurrency=*` from `command` before `verifyCacheKey`.
  - `wt.ts install()` acquires the `install` lease in-process, from the caller's own checkout (`import { acquire } from '@proj-airi/cpu-slots'`, resolved through the root devDependency of the checkout running `pnpm wt`). It then spawns `pnpm install --frozen-lockfile --prefer-offline` with `cwd` set to the new worktree and the lease env merged in, calls `addWorkload(child.pid)`, and releases on the child's `close`. It never runs a broker CLI inside the new worktree, which may predate cpu-slots.
  - qa-tools, per M10.
  - Every vitest config, per M11.
- **M10, qa-tools.**
  - `parseGateArgs` and `parseValidateArgs` drop their `cpus()` default. The default becomes the grant, resolved after acquire; an explicit `--workers` is clamped to the grant, with a `--workers N clamped to grant G` line.
  - `runGateCli` acquires `gate` for T1/T2 and `exclusive` for T3 captures. T3 `--rescore` launches nothing (`t3-gate.ts:187-195`) and takes no lease. `runValidateCli` acquires `gate`.
  - `runT3Cli` acquires `exclusive`. With `--keep-open` (`t3/cli.ts:21`), it keeps the lease until the window closes, so the machine stays quiet for Luke's inspection; `pnpm slots status` shows the holder's command.
  - `bin/test.ts` acquires per suite: `browser` when the project is `browser` or the suite's config enables browser mode, and `test` otherwise. It passes the lease env and no `--maxWorkers` flag; the suite's wrapper enforces the cap (M11).
  - The lease env is merged into the existing spawn env objects (`gate/cli.ts:145-152`, `validation/cli.ts:86`, `bin/test.ts:61`, the T3 launch in `src/t3/launch.ts`). Each spawned child pid is registered with `lease.addWorkload(child.pid)`.
  - The grant is recorded in `timing.json` and gate timing fields only. The `determinismHash` body must not change.
- **M11, vitest wrapper.** `withCpuSlots(config)` in `src/vitest.ts` returns an async config function.
  - It does nothing in watch mode (`config.test?.watch === true`, or argv without `run`/`related` when run as `vitest`) and when disabled.
  - It acquires `browser` when the root `test.browser.enabled` or any inline project's `test.browser.enabled` is true, and `test` otherwise.
  - `detectedClass` is `browser` when the root `test.browser.enabled` or any inline project's `test.browser.enabled` is true, and `test` otherwise.
  - Let `G` be the effective grant:
    - with a fresh lease, the grant;
    - with an inherited lease from another process, `min(classMax(detectedClass), AIRI_CPU_GRANT)`. The exception is a parent class (`AIRI_CPU_CLASS`) of `gate` or `exclusive`: then `G = AIRI_CPU_GRANT`, because those parents size their child runs explicitly through `--maxWorkers`, as in `gate/cli.ts:148` and `validation/cli.ts:86`;
    - with an in-process reuse, the G already chosen by the first call in this process.
  - The first `withCpuSlots` call in a vitest process is its top-level config, because Vitest loads the root config before its projects. Later calls in the same process are project configs.
  - Clamp rules, applied to the wrapped file's own config object:
    - (a) For the first call in the process, whether its lease is fresh or inherited: when the root has no `maxWorkers`, set root `test.maxWorkers = G`. A root-level value never triggers the group check, because every project without its own value inherits it. Project configs (later calls) never get a root value added.
    - (b) Clamp every existing numeric `maxWorkers`, root or inline-project, to `min(existing, G)`. It never raises a value, and never adds a project-level value where none existed.
    - (c) Never touch `fileParallelism`, `isolate`, or `sequence`, so serial projects stay at 1.
  - When the wrapped file is loaded as a project of the root config, its `test` block is project-level. Rule (b) is what caps qa-tools' `maxWorkers: 4` (`packages/qa-tools/vitest.config.ts:19`, `vitest.node.config.ts:13`) under a smaller grant. Project limits win over root limits (`cli-api.CnMVyzaz.js:3832-3834`), so the clamp must happen where the limit is declared.
  - Applied to all 48 vitest configs. Each owning package adds `"@proj-airi/cpu-slots": "workspace:^"` to devDependencies; the root adds it too.
- **M12, QA cache.** `packages/qa-tools/src/motion/cache/{key,closure,store,lookup}.ts`. Store: `<git common dir>/airi-qa-cache/<key>/<entryId>/`, holding `entry.json` plus copied artifacts, newest 20 per key.
  - **Key:** sha256 over canonical JSON of:
    - the target, level, selection (emotion order as given), bands, seeds, and sections;
    - the env after CLI overrides minus `QA_RUN_DIR`, limited to `QA_*`, `NODE_OPTIONS`, `NODE_ENV`, `VITE_*`, `VITEST_*`, and `TZ`;
    - the gate `fileSha`;
    - raw-byte sha256 of root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and every file under `patches/`. `.npmrc` is excluded: install effects reach the run only through the lockfile, and `verifyDepsBeforeRun: error` guards drift;
    - `process.version`, `process.platform`, and `process.arch`;
    - the vitest version, plus the raw-byte sha256 of the resolved `vitest/package.json`. Content, not path: each worktree has its own virtual store (`node_modules/.modules.yaml`), so a realpath would differ between worktrees and defeat B12, while the content hash and `pnpm-lock.yaml` still invalidate on any dependency change.
  - **Closure:** stored as `{repoPath, sha256}` entries. It is the union of:
    - (a) the Vite module graph of the gate project;
    - (b) the CLI-process module closure;
    - (c) `packages/qa-tools/vitest.config.ts`;
    - (d) every `package.json` and `tsconfig*.json` of workspace packages that own a closure file. `tsconfig` stays in: Vite's esbuild transform honors compiler options such as `useDefineForClassFields` and `jsx`.
  - **Hit:** every closure file's current raw-byte sha256 matches.
  - **Normalization:** strip `?query`, skip `\0` and `/@id/` ids, decode `/@fs/`, `realpath`, use forward slashes, lowercase the drive letter, keep paths inside the repo, then drop `node_modules`.
  - **Not stored** when exit is 2, on timeout, or when any closure file's mtime is at or after the run start.
  - **On a hit:** create a new run with the same tool and label. Copy `report.json`/`validation.json` and the summary. Set `run.json` `cache: { hit: true, sourceRunId, entryId }`. Print `CACHED from <sourceRunId>`, and exit with the stored code.
  - `--fresh` skips lookup but still stores.
  - `t3-gate.ts` refuses a `--t1-report` whose `run.json` has `cache.hit`, exiting 2.
  - **Scope:** T1 `gate emotion|liveliness` and T1 `validate-scorer` only.
- **M13, docs.**
  - Product docs: cpu-slots README; `scripts/dev-tools/README.md` (verify grant flags, cache key); `packages/qa-tools/README.md` (cache, `--fresh`, grant); ADR `docs/ai/adr/2026-10-22-cpu-budget.md`.
  - Agent config, in separate `chore(agents)` commits: `AGENTS.md` COMMANDS (`pnpm slots status`, `AIRI_CPU_SLOTS=off`) and `.agents/skills/motion-qa/SKILL.md` (replace the heavy-lock paragraph; require `--fresh` for evidence).

### Must NOT have (guardrails, anti-slop, scope boundaries)
- **No `VITEST_MAX_WORKERS`** anywhere. vitest 4.1.11 applies it after it forces one worker for `fileParallelism: false` (`dist/chunks/coverage.DM_a_rWm.js:223-225` vs `:380`).
- **No new external dependency** in any package. The only added dependency is the workspace package `@proj-airi/cpu-slots`.
- **No change to gate rules, recipes, Natural code, test assertions, or test timeouts:**
  - `packages/stage-ui-live2d/src/composables/live2d/natural-motion/**` is untouched;
  - `packages/qa-tools/gates/**` changes only to register the closure reporter;
  - no `it.skip` and no weakened expectation.
- **No caching** of T2, T3, browser, or qa:test results.
- **No brokering of long-running dev servers** (`pnpm dev*`, `dev:*`, Electron dev sessions, `story:dev`). No killing or throttling of processes.
- **No Defender, indexing, Dev Drive, or power-plan change.**
- **No fixed sleeps in tests.** Use the injectable clock, the fs adapter, and the pre-commit interleave hook. Process tests await `GRANTED`/`RELEASED` stdout lines with bounded timeouts.
- **No SIGINT or SIGTERM handlers** in library mode. **No `process.env` mutation.**
- **No compatibility shim for the prose heavy lock.** Remove the convention in todo 13.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- **Test decision:** tests-after (Luke, 2026-10-21), using Vitest 4.1.11.
  - Each todo adds its tests in the same commit.
  - The cpu-slots tests use an injectable clock, an `isAlive` function, an fs adapter, and a pre-commit interleave hook. There are no fixed sleeps.
  - Multi-process tests await child `GRANTED <n>` / `RELEASED` stdout lines, with a 30 s bounded timeout each.
- **Evidence:** `.omo/evidence/cpu-budget/task-<N>-<name>.<ext>`. Under ulw-loop, use `<attemptDir>/task-<N>-cpu-budget.<ext>`, where attemptDir is `result.currentAttemptDir` from `await agentToolkit.status()` after `await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`)`.
- **Every todo also runs:**
  - `pnpm verify --base origin/main`, plus `--force` once the broker is wired;
  - `git diff --check`;
  - `git diff --stat -- packages/stage-ui-live2d/src/composables/live2d/natural-motion`, which must print nothing.
- **Pre-existing failures** are judged against `packages/qa-tools/known-failures.json` with `pnpm qa:test --package <name>`. Report new failures; do not register them.
- **Measuring method** (the F3 before/after numbers): sample `os.cpus()` busy time before and after a command, as in the 2026-10-21 investigation, and record wall time. This is informational only.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

- **Wave 1, broker core:** todos 1 → 2 → 3, sequential, because each builds on the previous module. Todo 10 (closure spike) runs in parallel; it touches only qa-tools.
- **Wave 2, wiring, parallel after todo 3:** todos 4, 5, 6, 8, 9.
- **Wave 3:** todo 7 (wrapper adoption across all configs) after todo 6. Todo 11 (QA cache) after todos 8 and 10.
- **Wave 4, docs:** todos 12 and 13 after todos 4-11.
- **Final wave:** F1-F4 in parallel.

Heavy-run rule while executing: until todo 8 lands, keep T1 gate runs and browser suites serial across lanes, using today's convention. After todo 8, rely on the broker.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2 | 10 |
| 2 | 1 | 3 | 10 |
| 3 | 2 | 4, 5, 6, 8, 9 | 10 |
| 4 | 3 | 12 | 5, 6, 8, 9, 10 |
| 5 | 3 | 12 | 4, 6, 8, 9, 10 |
| 6 | 3 | 7 | 4, 5, 8, 9, 10 |
| 7 | 4, 6 | 12 | 11 |
| 8 | 3 | 11, 13 | 4, 5, 6, 9, 10 |
| 9 | 3 | 12 | 4, 5, 6, 8, 10 |
| 10 | - | 11 | 1-9 |
| 11 | 8, 10 | 12, 13 | 7 |
| 12 | 4, 5, 7, 9, 11 | F1-F4 | 13 |
| 13 | 8, 11 | F1-F4 | 12 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. cpu-slots package skeleton, classes, and pure grant rule
  - **What to do:**
    - Create `packages/cpu-slots/` with `package.json` (M1), `tsconfig.json`, `README.md` (stub; finished in todo 12), and `src/index.ts`.
    - `src/classes.ts` holds the M6 table as a `const` record, plus `type CpuClass`.
    - `src/grant.ts` exports `decide(state: BrokerState, budget: number): Decision`, the M5 rule:
      - `BrokerState = { leases: LeaseRecord[], tickets: TicketRecord[] }`, already pruned;
      - `Decision = { kind: 'grant', ticketSeq, slots } | { kind: 'wait', reason }`.
    - `src/budget.ts` parses `AIRI_CPU_BUDGET`: a positive integer, default 12, otherwise `CpuSlotsError('bad-budget')`.
    - `src/errors.ts` exports `class CpuSlotsError extends Error` with a `code` union.
    - Add `'packages/cpu-slots'` to the root `vitest.config.ts` projects.
  - **Must NOT do:** no filesystem access in `grant.ts`, and no dependencies.
  - **Closes:** GAP-1, partly: the grant rule IS-1 depends on.
  - **Parallelization:** Wave 1 | Blocked by: none | Blocks: 2
  - **References:**
    - `packages/qa-tools/package.json:1-43` (private package shape and version);
    - `scripts/dev-tools/verify-plan.ts:56-100` (pure-plan-plus-tests style);
    - `scripts/dev-tools/tsconfig.json`;
    - root `vitest.config.ts:7-58` (project list);
    - AGENTS.md CONVENTIONS (kebab-case, no `any`, Valibot not needed for env ints);
    - the draft ledger `.omo/drafts/cpu-budget.md`.
  - **Acceptance criteria:**
    - `pnpm exec vitest run --project packages/cpu-slots` (or the project name the package config declares) passes `test/grant.test.ts`. That file covers: head-only granting; the min/max boundaries; exclusive requiring `held == 0`; exclusive blocking later non-exclusive requests; clamping (`install 4-4` under budget 2 is granted 2); no grant while over budget; and the budget parse errors.
    - `pnpm -F @proj-airi/cpu-slots typecheck` exits 0.
  - **QA scenarios:**
    - **Happy:** `tsx -e "import('./packages/cpu-slots/src/grant.ts').then(m=>console.log(JSON.stringify(m.decide({leases:[],tickets:[{seq:1,class:'test',min:2,max:6,exclusive:false}]},12))))"` prints a grant of 6.
    - **Failure:** `AIRI_CPU_BUDGET=0` makes `parseBudget()` throw `bad-budget`.
    - Evidence: `.omo/evidence/cpu-budget/task-1-grant.txt`.
  - **Commit:** Y | `feat(cpu-slots): add slot classes and the grant rule`
  - **Recommended task executor category:** `deep-low` (a pure algorithm with a fully specified rule).

- [x] 2. Lease store: lock with owner token, tickets, leases, heartbeat, and liveness
  - **What to do:** implement `src/store.ts`, a `Store` class built over `{ root, now(), isAlive(pid), fs }`, covering M2, M3, and M4.
    - Methods:
      - `transact(fn)`: lock, re-check the token, run `fn`, commit, unlock;
      - `enqueue(request)` returns a ticket;
      - `touchTicket`, `removeTicket`, `grant(ticketSeq, slots)` returns a lease, `heartbeat(lease)` (re-registers on `ENOENT`), `release(lease)`;
      - `snapshot()` returns the pruned `BrokerState`.
    - The default `fs` adapter wraps `node:fs` sync APIs. Tests pass a fake that can throw `EPERM`, `EACCES`, `EBUSY`, and `ENOENT` on demand.
    - Add an optional `beforeCommit` hook so tests can interleave two stores.
  - **Must NOT do:** no `setTimeout`-based waiting inside `Store`, because polling lives in todo 3. No `process.env` reads, because the root is passed in.
  - **Closes:** GAP-3 (liveness), and the mechanics IS-1 and IS-4 rely on.
  - **Parallelization:** Wave 1 | Blocked by: 1 | Blocks: 3
  - **References:**
    - `scripts/dev-tools/verify-cache.ts:27-53` (temp + rename writes, parse-error tolerance);
    - `scripts/dev-tools/top.ts:44-58` (PID-reuse caution);
    - `.omo/drafts/cpu-budget.md` "Ultrabrain lane" bullet (the protocol and test list A2-A9, A12).
  - **Acceptance criteria:** `test/store.test.ts` passes cases A2-A9, A12, A17, A18, and A19 below. They supersede the draft's ultrabrain list where they differ. In order:
    - A2: a lock held by a live, same-process owner stays busy even at +120 s of injected time. One held by a dead pid, or by a reused pid (`isSameProcess` false), is broken.
    - A3: double break; A's token survives B's tombstone check.
    - A4: slow live holder paused at `beforeCommit` while the clock advances 120 s. B never breaks the lock and only waits; after A resumes and releases, B commits, with strictly increasing seqs.
    - A5: a dead waiter's head ticket is pruned.
    - A6: a waiter whose ticket went untouched for 45 s is pruned, and it re-enqueues at the back on its next poll.
    - A7, expiry without replacement: a lease whose heartbeat is stale (+46 s) but whose owner is alive and the same process is kept. A queued request that needs those slots is not granted.
    - A7b, death with replacement: the same lease with `isAlive` false is pruned, and the queued request is granted on the next decide.
    - A7c, PID reuse: `isAlive` true but `isSameProcess` false is pruned and replaced.
    - A8: a tick gap over 30 s skips ticket pruning.
    - A9, recovery after tampering: a holder whose lease file was deleted by hand re-registers, and no new grants happen until usage is back under budget.
    - A17, forced concurrent commit: two stores both pass the lock check through the interleave hook (simulated lock failure) and each write a lease that would total over budget. After verification at most one lease survives, and the survivors total at or under budget.
    - A18: the same with one exclusive and one non-exclusive request; they never both survive.
    - A12: an injected `EPERM`/`EACCES`/`EBUSY`/`ENOTEMPTY` on the publication rename, and `EPERM`×2 on lease renames, are retried and never counted as acquired. The acquirer's own `.tmp` directory is removed.
    - A19, interrupted publication:
      - The fs adapter throws (simulated crash) after `owner.json` is written inside `broker.lock.<t>.tmp` and before the rename. The injected `isAlive` reports that owner as dead.
      - A second store then acquires the lock on its first attempt and removes the orphaned `.tmp`.
      - In a variant where the orphan's owner is alive and younger than 10 s, the second store still acquires `broker.lock`. The `.tmp` directory never blocks anyone; it is only cleaned up later.
      - A third store facing a published `broker.lock` whose owner is alive and the same process never breaks it, even at +120 s.
  - **QA scenarios:**
    - **Happy:** `test/store.test.ts` green.
    - **Failure:** mutate `isAlive` to always return true in a scratch copy and confirm that A2's dead-pid case fails. Revert the scratch copy afterwards.
    - Evidence: `.omo/evidence/cpu-budget/task-2-store.txt`.
  - **Commit:** Y | `feat(cpu-slots): add the lease store with token-checked locking`
  - **Recommended task executor category:** `deep-high` (correctness rests on invariants of a concurrent protocol with no in-repo pattern).

- [~] 3. acquire API, inheritance, CLI run/status (STOP: 3 attempts; residual defects R2-B1, R2-B1b, R2-B2 moved to 3R; see ledger)
  - **What to do:**
    - `src/acquire.ts` implements M7 over `Store`:
      - polls every 500 ms with a referenced `setTimeout`, not unref'd, until the lease is acquired or the wait is cancelled. A queued CLI process often has nothing else keeping its event loop alive, and Node would exit before an unref'd timer fires;
      - heartbeats every 10 s with an unref'd interval, started only after acquisition, so it never keeps a finished process alive;
      - prints the waiting line once, then the granted line;
      - calls `releaseIfIdle()` synchronously in `process.on('exit')`, which deletes the lease only when `workloadAlive` is false.
    - A21, graceful coordinator exit with a surviving workload, event-driven:
      - A fixture script under `packages/cpu-slots/test/fixtures/` acquires a `test` lease of 6 under `AIRI_CPU_BUDGET=6`. It spawns a detached workload, `node -e "process.stdout.write('W-RUN '+process.pid+'\n'); setInterval(()=>{},1000)"`, with `detached: true` and `stdio` piped to the test, then calls `addWorkload`, prints `COORD-EXIT`, and calls `process.exit(0)`.
      - After `COORD-EXIT` and the coordinator's exit event, assert that the lease file still exists and that `pnpm slots status --json` lists it.
      - Assert that an exclusive waiter (`run --class exclusive -- node -e "console.log('B-RUN')"`) prints its waiting line and no `B-RUN`.
      - Kill the workload with `taskkill /PID <w> /T /F` on win32 or `process.kill(-w)` on POSIX, then assert that the waiter prints `B-RUN` and exits 0.
      - Every wait is on a stdout line or an exit event, with a 30 s bounded timeout and no fixed sleeps.
    - A21b, surviving descendant of an exited workload. Win32 only (`it.runIf(process.platform === 'win32')`), per the stated POSIX limitation in M4:
      - Same fixture, but the registered workload W spawns a detached grandchild D (`node -e "process.stdout.write('D-RUN '+process.pid+'\n'); setInterval(()=>{},1000)"`, with D's stdout piped back through W's to the test).
      - W prints `W-EXIT` and exits once D has printed `D-RUN`. Then the coordinator calls `process.exit(0)`.
      - Assert that W and the coordinator are dead and D is alive, and that the lease file still exists.
      - Assert that an exclusive waiter prints its waiting line and no `B-RUN`.
      - Kill D (`taskkill /PID <d> /F`; on POSIX `process.kill(d)`), then assert that the waiter prints `B-RUN` and exits 0.
      - Waits are event-driven, as in A21.
    - Unit, with an injected snapshot:
      - `releaseIfIdle()` keeps the file for a live registered workload, and for a dead registered workload with a live descendant (win32 chain through the dead pid; POSIX `pgid`);
      - it deletes the file when all are gone;
      - with nothing registered, an owner-descendant (an orphaned pool worker) still keeps the file;
      - pruning and release give the same answer for every fixture row, because both call `workloadAlive`.
    - `src/cli.ts` implements M8: `run` with `{grant}` substitution and drop, `shell` on win32, signal forwarding, and exit-code passthrough; plus `status [--json]`.
    - `src/index.ts` re-exports `acquire`, `CpuSlotsError`, `classes`, and the types.
  - **Must NOT do:** no SIGINT or SIGTERM handlers in `acquire.ts`; no `process.env` mutation.
  - **Closes:** GAP-3 and GAP-4 (the status CLI). Delivers IS-4, IS-5, and the CLI half of IS-6.
  - **Parallelization:** Wave 1 | Blocked by: 2 | Blocks: 4, 5, 6, 8, 9
  - **References:**
    - `scripts/dev.mjs` and `scripts/dev-launcher.mjs` (Windows spawn and Ctrl+C handling, exit code passthrough);
    - `packages/qa-tools/bin/test.ts:37-43` (taskkill tree kill);
    - `scripts/dev-tools/lib/exec.ts`;
    - draft cases A10, A11, A13-A16.
  - **Acceptance criteria:** `test/acquire.test.ts` and `test/cli.test.ts` pass.
    - A10: a live inherited lease creates no ticket file; a released one queues; exclusive under `test` throws `exclusive-under-shared`; `process.env` is unchanged.
    - A11: release, then re-acquire with a new class, queues again.
    - A13: `CI=1` and `AIRI_CPU_SLOTS=off` create no files.
    - A14: 20 in-process acquires plus 3 processes are granted in ticket order.
    - Integration: 3 children request `test` 2-6 under budget 8 with `AIRI_CPU_SLOTS_DIR` set to a temp dir. Assert grants 6 and 2, then 6 after the first releases, with the sum never above 8 at any `GRANTED`/`RELEASED` event.
    - A15: a coordinator whose whole tree is killed (`taskkill /T /F` on win32, SIGKILL to the process group on POSIX) is pruned on the next poll.
    - A20, coordinator-only death:
      - Child A runs `pnpm slots run --class test --min 6 --max 6 -- node -e "process.stdout.write('W-RUN '+process.pid+'\n'); process.stdin.resume()"` under `AIRI_CPU_BUDGET=6`. Its workload prints `W-RUN <pid>`.
      - Kill only the coordinator: `taskkill /PID <coordinator> /F` without `/T` on win32, SIGKILL to the coordinator pid alone on POSIX.
      - Assert the workload pid is still alive (`process.kill(pid, 0)` succeeds), and that a waiter B (`run --class exclusive -- node -e "console.log('B-RUN')"`) prints its waiting line and does not print `B-RUN` while the workload lives.
      - Kill the workload, then assert B prints `B-RUN` and exits 0.
      - Every wait is on a stdout line or an exit event, with a 30 s bounded timeout and no fixed sleeps.
    - Unit coverage with an injected snapshot: a lease with a dead owner and a live workload pid is kept; with a dead owner and a live grandchild (win32 `ParentProcessId` chain, or POSIX `pgid`) it is kept; with everything gone it is pruned; a reused workload pid (`isSameProcess` false) does not keep it alive.
    - Queued-survival test, in `cli.test.ts`, run as a standalone process:
      - with `AIRI_CPU_BUDGET=2` and a temp `AIRI_CPU_SLOTS_DIR`, child A runs `pnpm slots run --class test --min 2 -- node -e "process.stdout.write('A-RUN\n'); process.stdin.resume()"`, so it holds until its stdin closes;
      - after A prints `A-RUN`, child B runs `pnpm slots run --class test --min 2 -- node -e "console.log('B-RUN')"`;
      - assert that B prints the waiting line and stays alive (no exit event) while A holds;
      - close A's stdin, then assert that B prints `B-RUN` and exits 0;
      - every wait is on a stdout line or an exit event, with a 30 s bounded timeout and no fixed sleeps.
    - `cli.test.ts`: `{grant}` substitution, drop when off, exit-code passthrough (child `exit 3` gives 3), and `status --json` shape (its first field is the store path).
      - Exact check: `AIRI_CPU_SLOTS=off tsx packages/cpu-slots/src/cli.ts run --class typecheck -- node -e "console.log(JSON.stringify(process.argv.slice(1)))" --concurrency={grant}` prints argv with no `--concurrency` element.
      - Exact check: `AIRI_CPU_BUDGET=8 AIRI_CPU_SLOTS_DIR=<tmp> tsx packages/cpu-slots/src/cli.ts run --class test -- node -e "console.log(process.env.AIRI_CPU_GRANT)"` prints `6`.
    - Store fallback: with `AIRI_CPU_SLOTS_DIR` pointing at a path under an existing regular file, so mkdir fails with `ENOTDIR`/`ENOENT`, `acquire` prints the unbrokered warning, returns a no-op lease, and the command still runs.
  - **QA scenarios:**
    - **Happy:** `pnpm slots run --class test -- node -e "console.log(process.env.AIRI_CPU_GRANT)"` prints 2-6 and exits 0.
    - **Failure:** a run with `AIRI_CPU_GRANT`/`AIRI_CPU_LEASE` of a live `test` lease plus `--class exclusive` exits 2 with `exclusive-under-shared`.
    - Evidence: `.omo/evidence/cpu-budget/task-3-cli.txt`.
  - **Commit:** Y | `feat(cpu-slots): add acquire, inheritance, and the run/status CLI`
  - **Recommended task executor category:** `deep-low` (built on the specified store; behavior fully specified).

- [x] 3R. Broker remediation from todo 3's final review: lock retirement can never wedge the store (R2-B2), acquire() rejects malformed requests (R2-B1), and status lists every live ticket (R2-B1b)

  Added during execution (orchestrator decomposition, ledger decision 3R). Evidence: `.omo/evidence/cpu-budget/task-3-gate-review-r2.md`. Worktree: cpu-budget-w1. Category: deep-high. Acceptance: the reviewer's deterministic injected-EPERM repro and the malformed-acquire repro become permanent tests that fail before the fix and pass after; the loaded inherited-run repro (holder + hammer + 6 inherited runs under 12 busy loops) exits 5 in 6 of 6 runs; the full cpu-slots suite, typecheck, lint, and pnpm verify pass; an independent gate review confirms.

- [x] 14. Broker remediation from final review F4: a Windows sharing error on a lock-entry read is treated as busy, so a waiting command waits instead of failing (F4 B1, IS-6)

  Added during execution (orchestrator decomposition, ledger decision 14). Evidence: `.omo/evidence/cpu-budget/final-F4.md`. Worktree: cpu-budget-w6. Category: deep-high. Acceptance: a deterministic fs-adapter EPERM test on a `.tmp`/`.tomb` owner read fails before the fix and passes after; a 5-process, 45 s real-fs store hammer shows 0 non-busy errors in 2 of 2 runs; a 6-process real `acquire()` probe shows 0 rejected acquires; the full cpu-slots suite, typecheck, lint, and pnpm verify pass; an independent gate review confirms.

- [x] 15. Build remediation from final review F3: rebuilding @proj-airi/cpu-slots never leaves `dist/vitest.mjs` missing or partial, so wrapped vitest configs that load during a rebuild still start (F3 B1)

  Added during execution (orchestrator decomposition, ledger decision 15). Evidence: `.omo/evidence/cpu-budget/final-F3.md`. Worktree: cpu-budget-w7. Category: deep-high. Acceptance: a repro that loads a wrapped vitest config in a tight loop while cpu-slots rebuilds repeatedly shows ERR_MODULE_NOT_FOUND before the fix and 0 load failures after; the stale-build sha256 guard still refuses an outdated dist; `pnpm typecheck --force` started together with `pnpm qa:test --package @proj-airi/stage-ui` passes in 3 of 3 runs; the cpu-slots suite, typecheck, lint, and pnpm verify pass; an independent gate review confirms.

- [x] 4. Root scripts and root devDependency
  - **What to do:** edit root `package.json`.
    - Add the `slots` script.
    - Wrap `typecheck`, `build`, `build:web`, `build:apps`, `build:packages`, and `build:engines` with `tsx packages/cpu-slots/src/cli.ts run --class <typecheck|build> -- <existing turbo command> --concurrency={grant}`.
    - Wrap `build:tamagotchi` and `typecheck:engines` with `--class build`, with no flag.
    - Wrap `capture:tamagotchi` with `--class exclusive`.
    - Add `"@proj-airi/cpu-slots": "workspace:^"` to root devDependencies.
    - Run `pnpm install` once.
    - Leave `test`, `test:run`, `dev*`, and `lint` unwrapped. `test:run` steps are covered by the config wrappers in todo 7.
  - **Must NOT do:** do not change `postinstall`'s command string except through the `build:packages` wrap. Do not wrap `dev*`.
  - **Closes:** GAP-1 for turbo-driven scripts. Delivers IS-2 for typecheck and build.
  - **Parallelization:** Wave 2 | Blocked by: 3 | Blocks: 12
  - **References:**
    - root `package.json:13-60` (scripts), `:15` (postinstall), `:98` (tsx devDependency);
    - turbo 2.10.11 `--concurrency` (`node node_modules/turbo/bin/turbo run --help`);
    - `.github/workflows/ci.yml` (`pnpm install` and `pnpm typecheck` run under `CI=true`).
  - **Acceptance criteria:**
    - `pnpm typecheck` passes, and its log shows `cpu-slots: granted N (typecheck)` with turbo `--concurrency=N`.
    - `CI=true pnpm build:packages` shows no cpu-slots line, and the turbo command has no `--concurrency`.
    - `pnpm install --frozen-lockfile` succeeds in a fresh `pnpm wt new cpu-budget-probe` worktree. Remove it with `pnpm wt rm cpu-budget-probe --force`.
  - **QA scenarios:**
    - **Happy:** the `pnpm typecheck` log.
    - **Failure:** `AIRI_CPU_BUDGET=abc pnpm typecheck` exits 2 with `bad-budget`.
    - Evidence: `.omo/evidence/cpu-budget/task-4-root-scripts.txt`.
  - **Commit:** Y | `feat(cpu-slots): run root typecheck and build scripts under the slot budget`
  - **Recommended task executor category:** `unspecified-low` (mechanical script edits plus one install).

- [x] 5. verify and wt under the budget
  - **What to do:**
    - `scripts/dev-tools/verify.ts`: per M9, acquire the class of each command in-process right before running it, and release right after.
      - Classes: `typecheck`; `lint`; `browser` for every `extraTestConfigs` entry; `test` for the root-config `vitest related` command.
      - Append `--concurrency=<grant>` to the turbo command, only when the grant is non-null. Pass no `--maxWorkers` to vitest commands; the lease env reaches the child, and its wrapper enforces the cap.
      - `scripts/dev-tools/lib/exec.ts` `run()` gains an optional `onSpawn(pid)` callback. verify passes `lease.addWorkload` through it, and releases the lease only after the child's exit.
      - Add `export function stripWorkerFlags(command: string[]): string[]` in `verify-plan.ts`, and use it for the key.
    - `scripts/dev-tools/wt.ts install()`, per M9: acquire `install` in-process through `@proj-airi/cpu-slots` from the running checkout. Spawn `pnpm install --frozen-lockfile --prefer-offline` with `cwd` set to the new worktree, the lease env, and `shell` on win32 as today. Then `addWorkload(child.pid)`, and release on `close`. The acceptance probe `pnpm wt new cpu-budget-probe` is run from the feature worktree (which has cpu-slots) against a base of `main` (which does not), and must install successfully.
  - **Must NOT do:** do not change the verify step order, the cache directory, or the skip rules.
  - **Closes:** GAP-7, and GAP-1 for verify and wt. Delivers IS-9.
  - **Parallelization:** Wave 2 | Blocked by: 3 | Blocks: 12
  - **References:**
    - `scripts/dev-tools/verify.ts:33-61` (commands), `:86-99` (key);
    - `scripts/dev-tools/verify-plan.ts:64-100`;
    - `scripts/dev-tools/verify-plan.test.ts`;
    - `scripts/dev-tools/wt.ts:80-84`.
  - **Acceptance criteria:**
    - The `dev-tools` Vitest project passes with new tests: `stripWorkerFlags` removes both flags and nothing else, and the key is equal for commands that differ only in those flags.
    - `pnpm verify --base origin/main --dry-run` prints the turbo grant flag and the class chosen for each vitest command.
    - Browser-cap probe:
      - Hold a parent `test` lease of 6 with `pnpm slots run --class test --min 6 --max 6 -- <command>`, with no other leases and `AIRI_CPU_BUDGET=12`.
      - Inside it, run `node node_modules/vitest/vitest.mjs related --run --passWithNoTests --config packages/stage-ui/vitest.config.ts <one stage-ui file>` and the same for `packages/stage-pages/vitest.config.ts`, each with a scratch reporter (`--reporter=<abs path to scratch reporter>`) that prints each project's effective `maxWorkers`, read as `project.config.maxWorkers ?? ctx.config.maxWorkers` in `onInit`.
      - Expected: stage-ui browser ≤ 4 and stage-ui node = 1 (its `fileParallelism: false`); stage-pages ≤ 4.
      - Delete the scratch reporter afterwards.
    - Two concurrent `pnpm verify --base origin/main --force` runs from two worktrees never hold more than 12 slots. Sample `pnpm slots status --json` every 2 s into the evidence file.
  - **QA scenarios:**
    - **Happy:** the two concurrent runs.
    - **Failure:** with `AIRI_CPU_SLOTS=off`, `--dry-run` shows no grant flags.
    - Evidence: `.omo/evidence/cpu-budget/task-5-verify.jsonl`.
  - **Commit:** Y | `feat(dev-tools): run verify steps and worktree installs under the slot budget`
  - **Recommended task executor category:** `deep-low` (a contained change with tests).

- [x] 6. Vitest config wrapper and worker probe
  - **What to do:**
    - Implement `src/vitest.ts`, `withCpuSlots(config)`, per M11: watch detection, browser/test class detection, and root `maxWorkers` set only for a freshly acquired lease. Type it with `vitest/config` `ViteUserConfig` imports only.
    - Write a probe: a scratch test, under `packages/cpu-slots/test/fixtures/`, that logs `process.env.VITEST_WORKER_ID`. Run it through a scratch config with `fileParallelism: false`, one with project `maxWorkers: 4`, and one with neither, all under a forced grant of 2 (`AIRI_CPU_BUDGET=2`).
      - Expected maxima: 1, 2, and 2. The project-level 4 is clamped to 2 by M11 rule (b).
      - Also prove that CLI `--maxWorkers=2` leaves a `fileParallelism: false` project at 1.
      - Also run the real root `vitest run` with the root wrapper forcing root `maxWorkers` to 6 (`AIRI_CPU_BUDGET=6`, no other leases). It must start without the `different 'maxWorkers' but same 'sequence.groupOrder'` error (`cli-api.CnMVyzaz.js:3890-3893`), and `stage-tamagotchi`'s node project (`apps/stage-tamagotchi/vitest.node.config.ts:17-18`) must still run with one worker. Expected reason: `maxWorkers: 1` with `isolate` and default `groupOrder` goes to the sequential group at `:3884`. Record the outcome. If it errors, give that project's config `sequence.groupOrder: 2` and record why; that is the only allowed project-level edit.
    - Record the probe results in evidence. Delete the scratch configs; keep fixtures only if the tests use them.
  - **Must NOT do:** no `VITEST_MAX_WORKERS`. Project-level settings may only be clamped downward, per M11 rule (b). No `fileParallelism`, `isolate`, or `sequence` edits, except the `groupOrder` fallback named in the probe.
  - **Closes:** GAP-8 (mechanism). Delivers IS-2 and IS-10 for vitest.
  - **Parallelization:** Wave 2 | Blocked by: 3 | Blocks: 7
  - **References:**
    - vitest 4.1.11 `dist/chunks/coverage.DM_a_rWm.js:222-225, 380`, `dist/chunks/cli-api.CnMVyzaz.js:2481` (browser parallelism), `:3832-3838`, `:3884-3894`, `:11180-11213`;
    - `packages/stage-ui/vitest.config.ts:55-90`; `packages/qa-tools/vitest.config.ts:10-33`;
    - `apps/stage-web/vite.config.ts:23` (bare workspace TS import precedent).
  - **Acceptance criteria:**
    - `test/vitest-wrapper.test.ts` passes: watch makes no lease; browser detection; the first call in a process, with a fresh or inherited lease, sets root maxWorkers to G when absent. Under an inherited `test` grant of 6, a browser-enabled config gets G = 4; under an inherited `gate` grant of 10, a non-browser config gets G = 10. Later in-process calls (project configs) never add a `maxWorkers` where none exists, but clamp existing values downward. Explicit case: a config shaped like `packages/qa-tools/vitest.node.config.ts:13` (`maxWorkers: 4`, `pool: 'forks'`, `sequence.groupOrder: 1`) under an inherited grant of 2 yields `maxWorkers: 2` with `groupOrder` unchanged. A `maxWorkers: 1` plus `fileParallelism: false` config stays at 1. Disabled returns the config unchanged.
    - Probe evidence shows maxima of 1/2/2, and 1 for the CLI flag case.
  - **QA scenarios:**
    - **Happy:** the probe.
    - **Failure:** `vitest --watch` with the wrapped scratch config creates no lease file (`pnpm slots status --json` shows 0 leases).
    - Evidence: `.omo/evidence/cpu-budget/task-6-probe.txt`.
  - **Commit:** Y | `feat(cpu-slots): cap vitest workers through a config wrapper`
  - **Recommended task executor category:** `deep-low` (integration with a verified API surface plus a probe).

- [x] 7. Adopt the wrapper in every vitest config
  - **What to do:**
    - First read `server/AGENTS.md`, `server/apps/api/AGENTS.md`, `server/apps/auth/AGENTS.md`, and `services/computer-use-mcp/AGENTS.md`. As of 2026-10-21, none restricts workspace devDependencies. Stop and report if that has changed.
    - Wrap the default export of all 48 files listed by `git ls-files "*vitest*.config.ts"` with `withCpuSlots(...)`:
      - root: `vitest.config.ts`
      - `apps/`: `stage-tamagotchi-kirie/vitest.config.ts`, `stage-tamagotchi/vitest.config.ts`, `stage-tamagotchi/vitest.node.config.ts`, `stage-web/vitest.config.ts`, `ui-server-auth/vitest.config.ts`
      - `integrations/`: `minecraft/vitest.config.ts`, `telegram-bot/vitest.config.ts`
      - `packages/` (each `<name>/vitest.config.ts` unless noted): `audio`, `better-ws`, `cap-vite`, `ccc`, `core-agent`, `i18n`, `input-gamepad-vueuse`, `input-gamepad`, `input-playstation-dualsense-5`, `model-driver-lipsync`, `model-driver-magic-live2d`, `motion-driver-magic`, `pipelines-audio`, `plugin-protocol`, `plugin-sdk-tamagotchi`, `plugin-sdk`, `provider-inference`, `qa-tools` (plus `qa-tools/vitest.node.config.ts` and `qa-tools/spikes/t2/vitest.browser.config.ts`), `scenarios-stage-tamagotchi-browser`, `scenarios-stage-tamagotchi-electron`, `server-runtime`, `server-sdk`, `stage-layouts`, `stage-pages`, `stage-shared`, `stage-ui-live2d` (plus `stage-ui-live2d/vitest.node.config.ts`), `stage-ui-mmd`, `stage-ui-tachie`, `stage-ui-three`, `stage-ui`, `testing-audio`, `vite-plugin-sherpaw`, `vitest-plugin-fakemic`
      - `scripts/sponsorkit/vitest.config.ts`
      - `server/`: `apps/api/vitest.config.ts`, `apps/auth/vitest.config.ts`
      - `services/computer-use-mcp/vitest.config.ts`
    - Add `packages/cpu-slots/test/coverage.test.ts`. It lists `git ls-files "*vitest*.config.*"` and asserts that each file imports `@proj-airi/cpu-slots/vitest`, with an empty exemption list. This is a machine-consumed structural check that new configs are capped. Keep each file's content otherwise identical; when a file exports `defineConfig(...)`, wrap that call.
    - Add `"@proj-airi/cpu-slots": "workspace:^"` to the devDependencies of each package that owns one of those files. The root `vitest.config.ts` is covered by todo 4. For `scripts/sponsorkit/vitest.config.ts`, add it to `scripts/sponsorkit/package.json` if one exists, or rely on the root devDependency.
    - Run `pnpm install` once.
  - **Must NOT do:** do not change test includes, projects, setup files, or timeouts.
  - **Closes:** GAP-8. Delivers IS-10.
  - **Parallelization:** Wave 3 | Blocked by: 4 (root devDependency), 6 | Blocks: 12
  - **References:**
    - the file list from `git ls-files "*vitest*.config.ts"` (48 files, including `packages/qa-tools/spikes/t2/vitest.browser.config.ts`);
    - todo 6's `src/vitest.ts`.
  - **Acceptance criteria:**
    - `pnpm typecheck` passes.
    - `pnpm qa:test --all` reports `NEW failures: 0`.
    - `pnpm -F @proj-airi/core-agent exec vitest run` prints a `cpu-slots: granted` line.
    - `pnpm test:run` completes with no new failures against `known-failures.json`.
    - `packages/cpu-slots/test/coverage.test.ts` passes.
  - **QA scenarios:**
    - **Happy:** the core-agent run.
    - **Failure:** `AIRI_CPU_SLOTS=off pnpm -F @proj-airi/core-agent exec vitest run` prints no cpu-slots line.
    - Evidence: `.omo/evidence/cpu-budget/task-7-adoption.txt`.
  - **Commit:** Y | `chore: cap every vitest config through the CPU slot budget`
  - **Recommended task executor category:** `unspecified-low` (mechanical edit across many files).

- [x] 8. qa-tools gate, validation, T3, and qa:test under the budget
  - **What to do:** implement M10.
    - Change the `parseGateArgs` and `parseValidateArgs` signatures so the default worker count is `null`, resolved after acquire. Update `cli.test.ts`.
    - Acquire before any spawn in `runGateCli` (`gate` for T1/T2, `exclusive` for T3), `runValidateCli` (`gate`), and `runT3Cli` (`exclusive`).
    - Clamp an explicit `--workers` to the grant.
    - Merge `lease.env` into the spawn env objects, and call `lease.addWorkload(child.pid)` after every spawn: the gate vitest, each validation shard, each qa:test suite, and the T3 Electron root.
    - In `bin/test.ts`, use per-suite classes and pass the lease env, with no `--maxWorkers` flag.
    - T3 `--rescore` takes no lease. `runT3Cli --keep-open` holds the exclusive lease until exit.
    - Record the grant in `timing.json` and the existing gate timing fields.
    - Add `@proj-airi/cpu-slots` to qa-tools dependencies (`workspace:^`).
  - **Must NOT do:** do not touch `gates/**` rules, report schema fields used in `determinismHash`, or T3 scoring.
  - **Closes:** GAP-1 and GAP-2 for qa-tools. Delivers IS-2 and IS-3.
  - **Parallelization:** Wave 2 | Blocked by: 3 | Blocks: 11, 13
  - **References:**
    - `packages/qa-tools/src/motion/gate/cli.ts:22-40, 68-121, 145-172, 178-230`;
    - `packages/qa-tools/src/motion/validation/cli.ts:20-30, 43-78, 80-110, 115-145`;
    - `packages/qa-tools/src/t3/cli.ts`; `packages/qa-tools/bin/test.ts:45-93`;
    - `packages/qa-tools/src/motion/gate/cli.test.ts:16-40`.
  - **Acceptance criteria:**
    - `pnpm -F @proj-airi/qa-tools exec vitest run --project node` passes.
    - `pnpm qa:motion gate emotion --level t1 --emotions angry --bands strong` exits with today's verdict, and its `determinismHash` equals that of the same command with `--workers 2`.
    - A `pnpm qa:motion t3 ...` start while a `pnpm slots run --class test -- node -e "setTimeout(()=>{},20000)"` holds a lease prints the waiting line and starts only after release. Use `--help`-level or doctor-safe T3 invocations if no rig is present, and record which.
  - **QA scenarios:**
    - **Happy:** the hash equality.
    - **Failure:** `--workers 20` prints the clamp line.
    - Evidence: `.omo/evidence/cpu-budget/task-8-qa-tools.txt`.
  - **Commit:** Y | `feat(qa-tools): run gates, validation, T3, and qa:test under the slot budget`
  - **Recommended task executor category:** `deep-low` (contained CLI changes with existing tests).

- [x] 9. Leases in dev:top
  - **What to do:** `scripts/dev-tools/top.ts` prints a `cpu slots: held H/B, Q queued` header and one line per lease and ticket, reading the cpu-slots store `snapshot()`. Add `--json` fields `cpuSlots: { budget, held, leases[], queue[] }`. Render from an injectable snapshot for tests.
  - **Must NOT do:** no kill behavior tied to leases.
  - **Closes:** GAP-4. Delivers IS-6.
  - **Parallelization:** Wave 2 | Blocked by: 3 | Blocks: 12
  - **References:** `scripts/dev-tools/top.ts:13-42`; `scripts/dev-tools/lib/processes.ts` (rollup types).
  - **Acceptance criteria:**
    - The `dev-tools` project passes, including a render test from a fixed snapshot.
    - With `pnpm slots run --class test -- node -e "setTimeout(()=>{},15000)"` running, `pnpm dev:top` shows one `test` lease.
  - **QA scenarios:**
    - **Happy:** as above.
    - **Failure:** with no store directory, `pnpm dev:top` prints `cpu slots: held 0/12, 0 queued` and exits 0.
    - Evidence: `.omo/evidence/cpu-budget/task-9-top.txt`.
  - **Commit:** Y | `feat(dev-tools): show CPU slot leases in dev:top`
  - **Recommended task executor category:** `quick` (a small rendering change).

- [x] 10. Closure-capture spike, worker side and CLI side
  - **What to do:**
    - **Worker side:** add `src/motion/cache/closure-reporter.ts`, a Vitest reporter registered only in the qa-tools `gate` project when `QA_RUN_DIR` is set.
      - In `onInit(ctx)`, keep `ctx`.
      - In `onTestRunEnd`, iterate the `gate` project's `vite.environments` module graphs, normalize per M12, and write `closure-vite-<pid>.json` to `QA_RUN_DIR`.
    - **CLI side:** add `src/motion/cache/closure-hooks.ts`, a `module.registerHooks({ resolve, load })` hook installed at the top of `bin/motion.ts` that records every loaded `file:` URL.
      - Confirm that it records tsx-transformed `.ts` files.
      - If it does not chain with tsx, switch to the fallback CLI closure: every tracked file under `packages/qa-tools/src`, `packages/qa-tools/gates`, `packages/stage-ui-live2d/src`, and `packages/stage-shared/src`.
    - **Go/no-go**, recorded in evidence. The angry/strong T1 smoke closure must:
      - include `natural-motion/emotions.ts`, `natural-motion/gates.ts`, `natural-motion/emotion-score.ts`, `qa-tools/src/motion/gate/trials.ts`, `qa-tools/src/motion/gate/aggregate.ts`, and `qa-tools/fixtures/forbooth-catalog.json`;
      - exclude `node_modules`;
      - be identical across two runs.
  - **Must NOT do:** no change to gate verdicts or `determinismHash`.
  - **Closes:** GAP-5 (input capture).
  - **Parallelization:** Wave 1-2 | Blocked by: none | Blocks: 11
  - **References:**
    - vitest 4.1.11 `dist/chunks/cli-api.CnMVyzaz.js:415, 1001-1121`, `dist/chunks/reporters.d.DtoKVV2s.d.ts:1061, 1126`;
    - `packages/qa-tools/vitest.config.ts:22-31`; `packages/qa-tools/bin/motion.ts:1-43`;
    - `packages/qa-tools/src/motion/gate/aggregate.ts:1-20`; `packages/qa-tools/src/motion/validation/evaluate.ts:1-13`;
    - Node 26 `module.registerHooks` (present: `typeof require('node:module').registerHooks === 'function'`).
  - **Acceptance criteria:**
    - The go/no-go table is in evidence, with both sides' file counts.
    - `test/closure.test.ts` passes the normalization table (B6): a workspace symlink is kept, a real `node_modules` path is dropped, and `\0`, `/@id/`, and `?query` ids are handled.
  - **QA scenarios:**
    - **Happy:** two smoke runs give identical closures.
    - **Failure:** a scratch import of a new file into `trials.ts` on a scratch branch appears in the next closure. Revert it afterwards.
    - Evidence: `.omo/evidence/cpu-budget/task-10-closure.md`.
  - **Commit:** Y | `feat(qa-tools): record the module closure of T1 gate runs`
  - **Recommended task executor category:** `deep-high` (a mechanism with no in-repo pattern and an explicit go/no-go).

- [x] 11. QA result cache
  - **What to do:**
    - Implement M12 in `src/motion/cache/{key,store,lookup}.ts`.
    - Lookup runs in `runGateCli` (T1 only) and `runValidateCli` before acquire. A hit takes no slots.
    - Add `--fresh` to both usages.
    - Add an optional `cache?: { hit: true, sourceRunId: string, entryId: string }` to `RunManifest`, and a `createRun` option.
    - `t3-gate.ts` refuses a cached `--t1-report`, exiting 2 with `T1 reference <dir> is a cached run; rerun it with --fresh`.
    - Add guard tests over the worker-side source set, which is clean today (`git grep` on 2026-10-21 found no `readFileSync`/`readFile(`):
      - The set: non-test files in `packages/stage-ui-live2d/src/composables/live2d/natural-motion/`, `packages/qa-tools/gates/**`, `packages/qa-tools/src/motion/gate/{trials,options}.ts`, `packages/qa-tools/src/motion/t1/**`, `packages/qa-tools/src/motion/validation/{plan,units}.ts`, and `packages/qa-tools/src/motion/scenario-sink.ts`. `partials.ts` is exempt.
      - Fail if `readFileSync` or `readFile(` appears in that set.
      - Fail if `import.meta.glob` appears anywhere in `packages/qa-tools`.
      - CLI-side files (`gate/cli.ts`, `validation/cli.ts`, `t3-*.ts`, `evidence/**`) are excluded. Their file reads are of run directories and archives, not gate inputs.
      - `fixtures/forbooth-catalog.json` is an `import` (`gates/define.ts:9`), so the module graph covers it.
  - **Must NOT do:** no caching for T2, T3, browser, or qa:test. Never write cached results as evidence archive entries.
  - **Closes:** GAP-5 and GAP-6. Delivers IS-7 and IS-8.
  - **Parallelization:** Wave 3 | Blocked by: 8, 10 | Blocks: 12, 13
  - **References:**
    - `packages/qa-tools/src/evidence/run.ts:38-80`; `packages/qa-tools/src/motion/gate/cli.ts:116-128` (gateFileSha);
    - `packages/qa-tools/src/motion/gate/t3-gate.ts:205-220`;
    - `scripts/dev-tools/lib/git.ts` (`gitCommonDir`); `scripts/dev-tools/verify-cache.ts:23-53`;
    - draft cases B1-B13.
  - **Acceptance criteria:**
    - `test/cache.test.ts` passes B1-B13:
      - B1: each key input alone misses, while `QA_RUN_DIR` alone does not.
      - B2: emotion order matters.
      - B3: a blob change, a deleted file, and a CRLF-only change each miss.
      - B4: an `emotion-score.ts` edit misses.
      - B5: edits to `vitest.config.ts`, a `package.json` `exports` field, or `tsconfig` miss.
      - B6: the normalization table (todo 10).
      - B7: a closure file edited mid-run stores nothing.
      - B8: exit 2 or a timeout is not stored; exits 0 and 1 are.
      - B9: a hit is byte-identical after the source run is deleted.
      - B10: two concurrent writers leave no torn entry.
      - B11: only the newest 20 entries per key are kept.
      - B12: the same content in another worktree hits.
      - B13: `--fresh` skips lookup but still stores.
    - `t3-gate` refusal test passes.
  - **QA scenarios:**
    - **Happy:** run `pnpm qa:motion gate emotion --level t1 --emotions angry --bands strong --seeds 2` twice.
      - The second run's `run.json` has `"cache": { "hit": true, ... }`.
      - That run has no `vitest.log` artifact.
      - Its `report.json` is byte-identical to the first run's.
      - Its wall time is recorded but not asserted.
    - **Failure:** add a whitespace-only comment line to `natural-motion/emotions.ts` on a scratch branch, rerun, and confirm a miss. Revert afterwards. Then confirm `--t1-report <cached run>` exits 2.
    - Evidence: `.omo/evidence/cpu-budget/task-11-cache.txt`.
  - **Commit:** Y | `feat(qa-tools): reuse unchanged T1 gate and validation results as a local check`
  - **Recommended task executor category:** `deep-low` (fully specified key, store, and tests).

- [x] 12. Product docs and ADR
  - **What to do:** write:
    - the cpu-slots README (purpose, usage, when to use, when not to use; classes; env vars `AIRI_CPU_BUDGET`, `AIRI_CPU_SLOTS`, `AIRI_CPU_SLOTS_DIR`; the `{grant}` token; inheritance; troubleshooting);
    - `scripts/dev-tools/README.md` (verify grant flags, key stripping, dev:top leases);
    - `packages/qa-tools/README.md` (cache scope, key, `--fresh`, local-check-only, the `--t1-report` refusal, worker grant and clamp);
    - ADR `docs/ai/adr/2026-10-22-cpu-budget.md`, following the format of the existing ADRs. It covers: problem evidence; the protocol, including owner-identity liveness, no age-based lock breaking, and the write-then-verify commit that keeps the budget strict; the one exception, store files deleted by hand; classes; the rejected `VITEST_MAX_WORKERS`; the rejected global virtual store; blast radius (one turbo miss, consumers retypechecked on cpu-slots edits); and follow-ups (indexing opt-out, Defender guidance, worktree pool, idle reaper, T2 cache, adaptive budget).
  - **Must NOT do:** no AGENTS.md or skill edits; those are todo 13.
  - **Closes:** documentation for every GAP. Supports IS-6 and IS-8.
  - **Parallelization:** Wave 4 | Blocked by: 4, 5, 7, 9, 11 | Blocks: F1-F4
  - **References:** `docs/ai/adr/2026-10-19-dev-launcher.md` (ADR format); `scripts/dev-tools/README.md`; `packages/qa-tools/README.md`; AGENTS.md UNIQUE STYLES.
  - **Acceptance criteria:** `pnpm verify --base origin/main` passes. `pnpm exec moeru-lint <changed md files>` reports 0 errors.
  - **QA scenarios:**
    - **Happy:** lint is clean.
    - **Failure:** `pnpm -F @proj-airi/qa-tools exec tsx scripts/check-doc-paths.ts` (create `.temp/qa` first; the known follow-up) reports no broken paths.
    - Evidence: `.omo/evidence/cpu-budget/task-12-docs.txt`.
  - **Commit:** Y | `docs: describe the CPU slot budget and the QA result cache`
  - **Recommended task executor category:** `writing`.

- [x] 13. Agent guidance: AGENTS.md and the motion-qa skill
  - **What to do:**
    - AGENTS.md COMMANDS: add `pnpm slots status` and a line that `AIRI_CPU_SLOTS=off` disables the broker.
    - `.agents/skills/motion-qa/SKILL.md:62-70`: replace the heavy-lock paragraph with the `exclusive` class and `pnpm slots status`. Require `--fresh` for acceptance evidence, and state that `--t1-report` refuses cached runs.
  - **Must NOT do:** no other skill or AGENTS.md changes.
  - **Closes:** GAP-2 (prose lock retired). Delivers IS-8 (guidance).
  - **Parallelization:** Wave 4 | Blocked by: 8, 11 | Blocks: F1-F4
  - **References:** `AGENTS.md` COMMANDS block; `.agents/skills/motion-qa/SKILL.md:62-72`.
  - **Acceptance criteria:**
    - `pnpm verify --base origin/main` passes.
    - F1 confirms each listed guidance change against this todo. Prose is reviewed, not grep-asserted.
  - **QA scenarios:**
    - **Happy:** the behavior the guidance describes holds. `pnpm slots status` prints the store path, and `--t1-report <cached run>` exits 2 with the named message (reusing todo 11's evidence).
    - **Failure:** `pnpm qa:motion gate emotion --level t1 --emotions angry --bands strong --seeds 2 --fresh` creates a run without `cache.hit`.
    - Evidence: `.omo/evidence/cpu-budget/task-13-guidance.txt`.
  - **Commit:** Y | `chore(agents): route heavy QA runs through the CPU slot budget`
  - **Recommended task executor category:** `writing`.

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Every M item and every GAP row maps to a commit plus a test or QA record. Every Must NOT have holds: `git grep -n VITEST_MAX_WORKERS -- "*.ts" "*.mts" "*.mjs" "*.js" "*.json" "*.yaml" ":!docs/**" ":!**/*.md"` is empty (runtime and configuration only; the ADR and READMEs may explain why it is rejected), `git diff --stat origin/main -- packages/stage-ui-live2d/src/composables/live2d/natural-motion` is empty, and no new external dependency appears in the `pnpm-lock.yaml` diff.
  Recommended task executor category: `unspecified-high`.
- [x] F2. Code quality review
  An independent reviewer checks:
  - the lock and ticket protocol for races, against draft cases A2-A16;
  - Windows behavior: mkdir/rename error codes, `process.kill(pid,0)`, and shell spawning;
  - signal handling (no library handlers) and `process.env` immutability;
  - the absence of fixed sleeps in tests;
  - cache-key soundness against B1-B13.
  It runs the reviewer's own repro for any suspected race before reporting.
  Recommended task executor category: `deep-high`.
- [x] F3. Real manual QA
  Run everything on the real surface. Warn Luke first that the machine will be busy for about 15 minutes.
  1. From two worktrees, run three commands at once: `pnpm qa:motion gate emotion --level t1 --emotions angry --bands strong`; `pnpm verify --base origin/main --force`; and `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/dialogs/onboarding/step-welcome.browser.test.ts`.
  2. While they run, sample `pnpm slots status --json` every 2 s. The held total must be at or under 12 throughout, and every command must complete.
  3. Record wall time and busy core-seconds before and after (informational).
  4. Rerun the gate smoke. Its `run.json` must have `cache.hit`, no `vitest.log` artifact, and a byte-identical `report.json`. Wall time is recorded, not asserted.
  5. Make a scratch comment edit in `natural-motion/emotions.ts`: the rerun must miss. Revert the edit.
  6. `--t1-report <cached run>` must exit 2.
  7. `AIRI_CPU_SLOTS=off` must restore today's output, with no cpu-slots lines.
  8. Kill only a coordinator with `taskkill /PID <coordinator> /F`, without `/T`. Its lease must stay in `pnpm slots status` while its workload runs. Then kill the workload tree: the lease must disappear on the next status call.
  Evidence: `.omo/evidence/cpu-budget/f3/`.
  Recommended task executor category: `unspecified-high`.
- [x] F4. Ideal-state fidelity
  Check the delivered behavior against IS-1 to IS-10, one by one, using the Success criteria table. Any shortfall becomes a new `- [ ] N.` todo.
  Recommended task executor category: `unspecified-high`.

## Commit strategy
- One commit per todo, with the Conventional Commit message given in that todo. Docs go in the same commit as their code, except todo 13 (`chore(agents)`), which stays separate per AGENTS.md.
- Branch `lschneiderny/feat/cpu-budget` in worktree `C:/Users/Luke/projects/dtuber-wt/cpu-budget`, created with `pnpm wt new cpu-budget --branch lschneiderny/feat/cpu-budget`.
- Before landing, rebase onto `main`, then re-run `pnpm verify --base origin/main` and `pnpm qa:test --all`. Fast-forward `main` only with Luke's approval. Pushing is a separate request.
- Evidence under `.omo/evidence/cpu-budget/` is not committed.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 1, 2, 3 | A17 forced concurrent commit; todo 3 integration (sum at most 8 under budget 8); F3 step 2 (at most 12 with three real commands) | `.omo/evidence/cpu-budget/task-3-cli.txt`, `f3/status.jsonl` |
| IS-2 | 4, 5, 6, 7, 8 | Todo 4 turbo `--concurrency=N` log; todo 6 probe maxima 1/2/2; todo 8 gate `--workers` = grant | `task-4-root-scripts.txt`, `task-6-probe.txt`, `task-8-qa-tools.txt` |
| IS-3 | 2, 3, 8 | Grant-rule exclusive cases (todo 1); A18 exclusive conflict; todo 8 T3 waits for a held `test` lease | `task-1-grant.txt`, `task-8-qa-tools.txt` |
| IS-4 | 2, 3, 8 | A21 graceful `process.exit()` with a surviving workload, and A21b with a surviving grandchild of an exited workload, both keep the lease and block an exclusive waiter; A20 coordinator-only death keeps the lease until the workload exits; A19 interrupted lock publication recovers; A7/A7b/A7c expiry, death, and PID reuse; A15 tree-kill prune; A10 inheritance and `exclusive-under-shared`; F3 step 8 | `task-2-store.txt`, `task-3-cli.txt`, `f3/` |
| IS-5 | 3, 4, 7 | A13 creates no files; todo 4 `CI=true` drops `--concurrency`; todo 7 `AIRI_CPU_SLOTS=off`; F3 step 7 | `task-3-cli.txt`, `task-4-root-scripts.txt`, `task-7-adoption.txt` |
| IS-6 | 3, 9 | `status --json` shape test; dev:top shows a held lease | `task-3-cli.txt`, `task-9-top.txt` |
| IS-7 | 10, 11 | Todo 11 happy (`cache.hit`, no `vitest.log`, byte-identical report) and failure (scratch edit misses); B1-B13 | `task-11-cache.txt`, `task-10-closure.md` |
| IS-8 | 11, 13 | The `--t1-report` refusal exits 2; `run.json` `cache.hit`; skill rg checks | `task-11-cache.txt`, `task-13-guidance.txt` |
| IS-9 | 5 | `stripWorkerFlags` key-equality test | `task-5-verify.jsonl` |
| IS-10 | 6, 7 | `coverage.test.ts` structural check; core-agent run shows a grant; the watch-mode run creates no lease | `task-7-adoption.txt`, `task-6-probe.txt` |

## Execution amendments

- **M11(b) browser exception (2026-10-22, decision `m11b-browser`, ledger).** Vitest 4.1.11's browser pool sizes itself from `project.config.maxWorkers` only, defaulting to min(12, cpus-1). It never reads the root `maxWorkers` (`node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js:2479-2483, 2405`). Measured: stage-ui browser under a grant of 4 ran 12 renderers, mean 5.05 and peak 8.99 cores (`.omo/evidence/cpu-budget/task-7-gate-review.md`). Therefore `withCpuSlots` SETS `maxWorkers = G` on any inline project, or later-call config, whose `test.browser.enabled` is true and which has no numeric `maxWorkers`. A numeric project value is still only clamped downward. G is the process-wide grant, so groupOrder values stay consistent. Every other part of rule (b) is unchanged.
