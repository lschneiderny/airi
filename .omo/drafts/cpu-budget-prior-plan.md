# cpu-budget - Work Plan

## TL;DR (For humans)

**Who this is for and what changes for them:** Agents working in parallel on Luke's machine, and Luke at his desk. Today every test run, type check, gate, or install assumes it has the whole machine. Three agents at once means triple the load: tests time out, browser tests flake, and rendered captures get spoiled. After this plan, all of that work shares one budget of 12 of the 16 cores. Work that does not fit waits its turn instead of piling on.

**What you'll get:**
- A small shared "CPU slot" service. Heavy commands take a slice of the budget, run with that many workers, and give it back when done. A rendered capture can claim the whole machine and keep everything else out while it runs.
- A cache for the deterministic motion gate and scorer-validation runs. Rerunning one when nothing it depends on has changed answers in seconds instead of minutes.
- Cached answers are clearly marked and count only as a local check. Acceptance evidence still needs a fresh run.

**Why this approach:** The tools already take a worker count, but each one picks it alone. One coordinator that hands out worker counts fixes the problem without rewriting the tools. The gates already prove they give identical results for identical inputs, so their results are safe to reuse.

**What it will NOT do:**
- It does not throttle long-running dev servers or Electron windows.
- It does not change Defender, Windows Search, or Dev Drive settings.
- It does not cache T2, T3, or browser test results.
- It does not change any gate rule, recipe, or test.

**Effort:** Medium-large
**Risk:** Medium. A broker bug could make commands wait forever, so leases expire when their owner dies, and `AIRI_CPU_SLOTS=off` turns the broker off.
**Decisions to sanity-check:** the per-kind slot ranges in "Cost classes" (gates get 4 to 10, tests 2 to 6), and making the broker a new package instead of more root scripts.

Your next move: start execution with `/ulw-execute cpu-budget`.

---

> TL;DR (machine): Medium-large, medium risk.
> - New zero-dependency `@proj-airi/cpu-slots` lease broker: a 12-slot machine budget, strict FIFO, and leases kept alive by heartbeats and inherited through an environment variable.
> - Wired into the root heavy scripts, the main vitest configs, turbo `--concurrency`, and the qa-tools gate, validation, T3, and qa:test commands.
> - A module-graph-keyed result cache for T1 gates and T1 validate-scorer, used as a local check only.

## Scope

### Affected user and ideal state

**Affected user:**
- Agents running `pnpm verify`, `pnpm test:run`, `pnpm typecheck`, `pnpm qa:test`, `pnpm qa:motion ...`, `pnpm wt new`, and direct `vitest` invocations in several worktrees at once.
- Luke, who uses the same machine and runs T3 captures that need a quiet desktop.

Evidence (session 2026-10-21, `reference/projects/dtuber-dev-perf-tooling.md`, `dtuber-qa-tooling.md`):
- No concurrency cap exists anywhere:
  - turbo has none, and neither does the root vitest config.
  - Vitest defaults to `availableParallelism() - 1` = 15 workers (vitest 4.1.11 `cli-api.CnMVyzaz.js:3832-3838`).
  - The gate's `--workers` and validate-scorer's `--workers` both default to `cpus - 1` (`gate/cli.ts:68`, `validation/cli.ts:43`).
- The heavy-run lock exists only as prose in `.agents/skills/motion-qa/SKILL.md:70`. It once recorded a shell PID, so lanes overlapped.
- Under 14 CPU-heavy processes, natural-motion tests timed out at 5 s. stage-ui browser tests flake under load. Desktop interference spoiled the 2026-10-20 T3 verdicts.
- Five parallel worktree installs took about 6.7 minutes each, against 1.5 to 2 minutes run alone (`dtuber-wt/eep-t1..t5-install.log`).
- The full T1 emotion gate takes 295 s on a quiet machine and 416 s under load. Protocol-2 validation took 2,652 s on 15 workers. Both were rerun after rebases with 0 verdict differences: `determinismHash` is identical for identical inputs (`gate/aggregate.ts:46-47`).

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | The total CPU slots held by brokered work never exceed the budget, which defaults to 12 and can be overridden by `AIRI_CPU_BUDGET`. | Running several agents must not oversubscribe the machine. |
| IS-2 | Every brokered command runs with a worker count equal to its grant: vitest `--maxWorkers`, turbo `--concurrency`, and gate or validate `--workers`. | A cap that the tools ignore does nothing. |
| IS-3 | Work waits in strict FIFO order. An exclusive lease (T3 capture, packaging) waits until all leases are gone, then blocks new grants until it releases. | T3 needs a quiet machine, and the lock prose is not enforced. |
| IS-4 | A lease whose owner died or stopped heartbeating stops counting within 45 s. A child of a lease holder runs under the parent's lease and never deadlocks. | Earlier lock and PID-reuse failures. Nested commands (`wt new` → install → postinstall build; verify → vitest) are common. |
| IS-5 | With `CI=true` or `AIRI_CPU_SLOTS=off`, the broker does nothing, and each command keeps its current default parallelism. | CI and emergency bypass. |
| IS-6 | `pnpm dev:top` and `pnpm slots status` show holders, grants, the queue, and wait times. | Agents and Luke need to see why a command is waiting. |
| IS-7 | A T1 gate or T1 validate-scorer rerun whose recorded inputs are unchanged returns the stored report with exit code and verdict unchanged, and marks the run as cached. Changing any recorded input file misses the cache. | A deterministic rerun is wasted CPU. |
| IS-8 | A cached result is a local check only: `run.json` records `cache.hit`, `--t1-report` refuses a cached T1 run, and the motion-qa skill requires `--fresh` for acceptance evidence. | Luke's decision of 2026-10-21. |
| IS-9 | Verify's pass cache key does not depend on the granted worker count. | The grant changes from run to run. A key that includes it would never hit. |

### Must have
- **K1:** a new package, `packages/cpu-slots` (`@proj-airi/cpu-slots`).
  - Plain TypeScript with erasable syntax only, run by Node 26 native type stripping. It has no dependencies and no build step. Relative imports use `.ts` extensions, which the runtime requires; this is the AGENTS.md "retain extensions required by runtimes" exception.
  - Exports `acquire(request)`, which returns a lease with `{ grant, release(), env }`, plus a `run` CLI and a `status` CLI.
  - Tests run in a root Vitest project.
  - The README is structured: purpose, usage, when to use, and when not to use.
- **K2:** lease store under `join(os.tmpdir(), 'airi-cpu-slots')` (on Luke's machine, `H:\llm\ollama\tmp\airi-cpu-slots`, where the old heavy lock lived).
  - Mutual exclusion: an atomic `mkdir` lock directory, `broker.lock`, held for under 100 ms per transaction. A lock directory older than 10 s counts as stale and is removed.
  - Each lease is a JSON file `{ id, pid, class, slots, exclusive, cwd, command, createdAt }`. Its mtime is the heartbeat, refreshed every 10 s. A lease is live if its mtime is under 45 s old and `process.kill(pid, 0)` succeeds.
  - Waiters write ticket files numbered by a monotonic counter stored in the lock transaction, and poll every 500 ms.
- **K3:** grant rule.
  - A request is granted only at the queue head.
  - Non-exclusive: granted when no exclusive lease is held and `free >= min`, with `grant = min(max, free)`.
  - Exclusive: granted when nothing is held, with `grant = budget`.
- **K4:** cost classes, defined as constants in one file (`src/classes.ts`):

  | Class | Slots (min-max) | Used by |
  | --- | --- | --- |
  | `test` | 2-6 | vitest run/related on node projects, `test:run` steps |
  | `browser` | 2-4 | vitest runs of a config with browser mode enabled |
  | `typecheck` | 2-6 | `turbo run typecheck` (`--concurrency=<grant>`) |
  | `build` | 2-6 | `turbo run build*`, `electron-vite build` |
  | `lint` | 1-1 | moeru-lint |
  | `install` | 4-4 | `pnpm install` from `pnpm wt new` |
  | `gate` | 4-10 | `qa:motion gate` T1/T2, `validate-scorer` |
  | `exclusive` | all | `qa:motion gate --level t3`, `qa:motion t3`, packaging builds |

- **K5:** inheritance. A lease exports `AIRI_CPU_LEASE=<id>` and `AIRI_CPU_GRANT=<n>`. `acquire` called while `AIRI_CPU_LEASE` names a live lease returns that lease's grant without queueing. While a lease is held, repeat `acquire` calls in the same process reuse it. After `release()`, the next `acquire` queues again, so verify can hold a different class for each step.
- **K6:** wiring.
  - Root `package.json`: `typecheck`, `build`, `build:*`, and `test:run` run through `node packages/cpu-slots/src/cli.ts run --class <c> -- <cmd>`. `verify`, `qa:test`, `qa:motion`, and `wt` are not CLI-wrapped. They acquire in-process with the class of each step, because an outer wrapper lease would be inherited and fix the class for every step.
  - `scripts/dev-tools/verify.ts`: each step acquires its own class and passes `--concurrency` (typecheck) or `--maxWorkers` (tests). Worker flags are excluded from `verifyCacheKey`.
  - `qa-tools`: the gate, validate-scorer, and qa:test acquire in-process. `--workers` defaults to the grant, and an explicit `--workers` is clamped to the grant. T3 commands acquire `exclusive`. qa:test passes `--maxWorkers <grant>` to each suite.
  - Vitest configs: an exported `withCpuSlots(config)` async config wrapper acquires `test` or `browser` and sets `test.maxWorkers` to the grant. It is applied to the root `vitest.config.ts` and to stage-ui, stage-ui-live2d (both configs), stage-tamagotchi (both), stage-pages, stage-web, and qa-tools (both). It never overrides a project's own `maxWorkers` or `fileParallelism: false`.
  - `pnpm wt new`: the install runs under `install`.
- **K7:** `pnpm slots status [--json]` (root script), plus a leases section in `pnpm dev:top`.
- **K8:** QA result cache in `packages/qa-tools/src/motion/cache/`, stored under `<git common dir>/airi-qa-cache/` (shared by worktrees, like `airi-verify`).
  - Covers only T1 `gate emotion|liveliness` and T1 `validate-scorer`.
  - The key hashes the canonical gate arguments (selection, seeds, sections, level, target), the `QA_*` environment except `QA_RUN_DIR`, the gate `fileSha`, and the hashes of `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `patches/`. It also covers the Node version, the vitest version, and the platform.
  - Each entry also stores the recorded module closure, a list of `{ repoPath, blobSha }`.
  - A hit requires every closure file's current `git hash-object` to match. It copies `report.json` (or `validation.json`) and the summary into a new run whose `run.json` has `cache: { hit: true, sourceRunId }`, and prints `CACHED from <runId>`.
  - `--fresh` bypasses the cache.
  - Each key keeps its newest 20 entries.
- **K9:** module-closure capture. A reporter in the qa-tools `gate` project, active only when `QA_RUN_DIR` is set, writes the absolute IDs of every module the Vitest server transformed for the run (`closure-<shard>.json`) into the run directory. The CLI unions the shards, keeps only paths inside the repository, and drops anything under `node_modules`; the lockfile hash covers dependencies. If the spike (todo 7) shows the module graph cannot be read reliably, the fallback closure is the full git trees of qa-tools and every workspace package in its dependency closure.
- **K10:** documentation.
  - The cpu-slots README, the qa-tools README cache section, the dev-tools README (verify flags), and AGENTS.md COMMANDS (`pnpm slots status`, `AIRI_CPU_SLOTS=off`).
  - A new ADR, `docs/ai/adr/2026-10-22-cpu-budget.md`.
  - The motion-qa skill: replace the heavy-lock paragraph and add `--fresh` for evidence. This goes in a separate agent-config commit.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- **No `VITEST_MAX_WORKERS`.** vitest 4.1.11 applies it after it forces one worker for `fileParallelism: false` (`coverage.DM_a_rWm.js:225` then `:380`). That would raise stage-ui's and stage-tamagotchi's serial node projects from 1 to N. Use `--maxWorkers` or the config value only.
- **No new dependency** in any package. Use Node builtins only.
- **No change to gate rules, recipes, tests, or timeouts.**
  - Do not change `packages/stage-ui-live2d/src/composables/live2d/natural-motion/**` or `gates.ts`.
  - Do not edit or skip any existing test assertion to fit the broker.
- **No caching of T2** (it reads rig assets from `AIRI_QA_RIG_FORBOOTH`), **T3, browser, or qa:test results**, and no cache use by `--t1-report`.
- **No brokering of long-running dev servers** (`pnpm dev*`, Electron dev sessions) and no kill or throttle behavior. `dev:top` only reports.
- **No Defender, indexing, Dev Drive, or power-plan changes.**
- **No changes to the 40 small vitest configs outside K6.** They inherit the cap only when run through the root config or a wrapped script. Adoption is a follow-up.
- **No fixed sleeps in tests.** Broker contention tests wait on a child's `GRANTED <n>` stdout line with a bounded timeout. Clocks and the filesystem root are injectable.
- **No backward-compatibility shim for the prose heavy lock.** Remove the convention from the skill in the same plan.

## Verification strategy
- **Unit tests (cpu-slots), with an injectable clock and directory:**
  - The grant rule: min/max, FIFO head-of-line, and exclusive behavior.
  - Liveness: stale heartbeat, dead PID, and stale `broker.lock`.
  - Inheritance through the environment and in-process reuse.
  - The CI/off no-op.
  - Ticket ordering under concurrent `acquire` calls in one process.
- **Integration test (cpu-slots):** spawn 3 real child processes that each request `test` 2-6 against a budget of 8, using a temporary store directory.
  - Assert the grants are 6, 2, and then (after the first releases) 6.
  - Assert the sum stays at or under 8 at every `GRANTED` or `RELEASED` event.
  - Assert that a killed child's lease is pruned within 45 s, using an injected clock, not wall time.
- **qa-tools unit tests:**
  - Worker defaults and clamping in `parseGateArgs` and `parseValidateArgs`.
  - Cache key canonicalization. Hit and miss on a closure blob change, with a fake hash function.
  - `run.json` `cache` field.
  - `--t1-report` refusal of a cached run.
- **dev-tools test:** `verifyCacheKey` is identical for commands that differ only in `--maxWorkers` or `--concurrency`.
- **Real-surface QA (F3):**
  - Run three heavy commands at once from two worktrees: a T1 angry/strong gate smoke, `pnpm verify --base origin/main --force`, and a stage-ui browser file.
  - While they run, record `pnpm slots status --json` every 5 s. The held total must be at or under 12.
  - Record wall time and machine busy core-seconds, using the os.cpus() delta method from the 2026-10-21 investigation, before and after.
  - Then rerun the angry/strong smoke for a cache hit, under 10 s with an identical `determinismHash`.
  - Then edit a whitespace-only comment in `natural-motion/emotions.ts` on a scratch branch and confirm a miss.
  - Finally confirm that `--t1-report` refuses the cached run.
- `pnpm verify --base origin/main` on the final tree.

## Execution strategy

### Parallel execution waves
- **Wave 1:** todo 1 (cpu-slots core). Everything else depends on it.
- **Wave 2 (parallel):** todo 2 (root scripts and verify), todo 3 (vitest config wrapper), todo 4 (qa-tools broker use), todo 5 (status, dev:top).
- **Wave 3:** todo 6 (cpu-slots and dev-tools docs and ADR) after todos 2-5. Todo 7 (closure spike) can start in wave 2. It touches only the qa-tools gate project reporter.
- **Wave 4:** todo 8 (QA cache), after todos 4 and 7. Then todo 9 (qa-tools docs and the motion-qa skill commit).
- **Final wave:** F1-F4.

Heavy-run rule during execution: until todo 4 lands, keep T1 gate runs and browser suites serial across lanes, using the old convention.

### Dependency matrix
| Todo | Depends on | Blocks |
| --- | --- | --- |
| 1 | - | 2, 3, 4, 5 |
| 2 | 1 | 6, F3 |
| 3 | 1 | 6, F3 |
| 4 | 1 | 8, 9, F3 |
| 5 | 1 | 6 |
| 6 | 2, 3, 5 | F1 |
| 7 | - | 8 |
| 8 | 4, 7 | 9, F3 |
| 9 | 8 | F1 |

## Todos

- [ ] **1. cpu-slots core package.**
  - Create `packages/cpu-slots` with:
    - `package.json`: name `@proj-airi/cpu-slots`, private, `type: module`, `exports` for `.` → `./src/index.ts`, `bin` none.
    - `src/store.ts`: lock, leases, tickets.
    - `src/grant.ts`: the pure grant rule.
    - `src/classes.ts`: the K4 table.
    - `src/acquire.ts`: queue loop, heartbeat timer (`unref`), and release on `exit`, `SIGINT`, and `SIGTERM`.
    - `src/cli.ts`: `run --class <c> [--min N --max N] -- <cmd...>` spawns the command with the lease env, forwards the exit code, and prints `cpu-slots: waiting for <n> slot(s) (held <h>/<budget>, <q> ahead)` once, then `granted <g>`. Also `status [--json]`.
    - `src/index.ts`, `tsconfig.json` (`erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit`), and `README.md`.
  - Add `packages/cpu-slots` to the root `vitest.config.ts` projects.
  - **Accept when:**
    - The unit and integration tests in "Verification strategy" pass in one `vitest run`.
    - `node packages/cpu-slots/src/cli.ts run --class test -- node -e "console.log(process.env.AIRI_CPU_GRANT)"` prints a number from 2 to 6 and exits 0.
    - `AIRI_CPU_SLOTS=off` prints nothing from the broker.
    - `pnpm -F @proj-airi/cpu-slots typecheck` passes. Add a `typecheck` script: `tsc --noEmit`.
  - Commit: `feat(cpu-slots): add machine-wide CPU slot broker`.

- [ ] **2. Root scripts, verify, and wt.**
  - Wrap the K6 root scripts. `test:run` is one `run --class test` around the whole chain; the inner steps inherit the lease.
  - Make `verify.ts` acquire a lease per step:
    - typecheck → `typecheck` class, with `--concurrency=<grant>`.
    - lint → `lint` class.
    - tests → `test` class, with `--maxWorkers=<grant>` appended to each `vitest related` command.
  - Strip `--maxWorkers=*` and `--concurrency=*` from the command before `verifyCacheKey`.
  - `wt.ts install()` runs `pnpm install` under the `install` class through the cpu-slots CLI.
  - **Accept when:**
    - The dev-tools tests pass, including the new key test.
    - `pnpm verify --base origin/main --dry-run` shows the grant flags.
    - Two concurrent `pnpm verify --force` runs in two worktrees never hold more than 12 slots, checked with `pnpm slots status --json`.
  - Commit: `feat(dev-tools): run verify and wt under the CPU slot budget`.

- [ ] **3. Vitest config wrapper.**
  - Add `withCpuSlots(config, { class? })` to cpu-slots, exported as `@proj-airi/cpu-slots/vitest`. It returns an async config function.
  - It acquires `browser` when any project or the root config enables browser mode, and `test` otherwise.
  - It sets root `test.maxWorkers = grant` only when the root config does not set it. It never edits project-level `maxWorkers` or `fileParallelism`.
  - First, run a probe. Run the stage-ui node project, which has `fileParallelism: false`, and a qa-tools node run, which has `maxWorkers: 4`, under a grant of 2. Confirm they use 1 and 2 workers respectively by counting distinct `VITEST_WORKER_ID` values logged by a scratch test. Delete the scratch test afterwards.
  - If the async config form is not honored for project config files, wrap only the root config and the package configs that are run directly.
  - Apply the wrapper to the K6 config list. Add `@proj-airi/cpu-slots` as a `workspace:^` devDependency of the root `package.json` (for the root `vitest.config.ts`) and of each package whose config imports it. This is a workspace package, not a new external dependency; run `pnpm install` once. Expect one full Turbo build-cache miss, because the root `package.json` changes (dev-perf finding: 0/34 cached, 49 s).
  - **Accept when:**
    - The probe results are recorded in the todo's evidence.
    - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser <one file>` prints a broker grant line.
    - The stage-ui, stage-ui-live2d, stage-tamagotchi, qa-tools, and root suites show no new failures against `known-failures.json` (`pnpm qa:test --all`).
  - Commit: `feat(cpu-slots): cap vitest workers through the slot budget`.

- [ ] **4. qa-tools broker use.**
  - `parseGateArgs` and `parseValidateArgs` take the grant as the default and clamp an explicit `--workers` to it. Print `--workers N clamped to grant G` when clamped.
  - `runGateCli` and `runValidateCli` acquire `gate` (T1/T2) or `exclusive` (T3) before any spawn. `runT3Cli` acquires `exclusive`.
  - `bin/test.ts` acquires `test`, or `browser` when the target project is `browser`, per suite, and appends `--maxWorkers=<grant>`.
  - Record the grant in `timing.json` and in the gate report's existing timing fields only; the `determinismHash` body must not change.
  - **Accept when:**
    - The qa-tools node tests pass.
    - An angry/strong T1 smoke reports the same `determinismHash` with `--workers 2` as with the grant default.
    - A T3 command started while a `test` lease is held waits, and prints the waiting line, until that lease releases.
  - Commit: `feat(qa-tools): run gates, validation, T3 and qa:test under the CPU slot budget`.

- [ ] **5. Status and dev:top.**
  - Add `pnpm slots status [--json]` (root script → cpu-slots CLI). It lists leases (class, slots, worktree from `cwd`, age, command), the queue (class, request, wait time), and held/budget.
  - `pnpm dev:top` prints the same leases section under its rollup.
  - **Accept when:** the dev-tools tests pass (the leases section is rendered from an injected snapshot), and a manual run shows a held lease from a parallel `cli.ts run --class test -- node -e "setTimeout(()=>{},5000)"`.
  - Commit: `feat(dev-tools): show CPU slot leases in dev:top`.

- [ ] **6. Broker docs.**
  - The cpu-slots README.
  - The dev-tools README: verify grant flags and cache key behavior.
  - AGENTS.md COMMANDS: `pnpm slots status` and `AIRI_CPU_SLOTS=off`.
  - The ADR `docs/ai/adr/2026-10-22-cpu-budget.md`: the problem evidence, K2-K5, the classes, the rejected `VITEST_MAX_WORKERS`, the rejected global virtual store, and the follow-ups.
  - **Accept when:** `pnpm lint` reports no new problems in these files.
  - Commit: `docs: describe the CPU slot budget`. The AGENTS.md change goes in its own `chore(agents): ...` commit.

- [ ] **7. Closure-capture spike.**
  - Add a reporter to the qa-tools `gate` project, active only when `QA_RUN_DIR` is set. In `onInit(vitest)` it keeps the reference. In `onTestRunEnd` it reads the module graph of the gate project's Vite server and writes `closure-<pid>.json` with repo-relative paths.
  - **Go/no-go:** an angry/strong T1 smoke's closure must:
    - include `natural-motion/emotions.ts`, `natural-motion/gates.ts`, `qa-tools/src/motion/gate/trials.ts`, and `fixtures/forbooth-catalog.json`;
    - exclude `node_modules`;
    - be identical across two runs.
  - **No-go:** record why, and switch todo 8 to the K9 fallback closure.
  - Commit only on go: `feat(qa-tools): record the module closure of gate runs`.

- [ ] **8. QA result cache.**
  - Implement K8 in `src/motion/cache/{key,store,lookup}.ts`. `runGateCli` (T1 only) and `runValidateCli` look up the cache before acquiring a lease; a hit needs no slots. Add a `--fresh` flag to both usages.
  - On a miss, the run proceeds normally and stores an entry only when the exit code is 0 or 1, never 2 or a timeout.
  - `run.json` gains an optional `cache` field.
  - `t3-gate.ts` refuses a `--t1-report` whose `run.json` has `cache.hit`, exiting 2 with a named message.
  - **Accept when:**
    - The cache unit tests pass.
    - The F3 hit/miss sequence passes when run by the implementer.
    - The `report.json` of a hit is byte-identical to its source.
  - Commit: `feat(qa-tools): reuse unchanged T1 gate and validation results as a local check`.

- [ ] **9. QA docs and skill.**
  - The qa-tools README: the cache section, `--fresh`, local-check-only status, and grant behavior.
  - The motion-qa skill (separate `chore(agents)` commit):
    - Replace the heavy-lock paragraph with the exclusive class and `pnpm slots status`.
    - Require `--fresh` for acceptance evidence.
    - State that `--t1-report` refuses cached runs.
  - **Accept when:** `rg "qa-tooling-heavy.lock"` finds no live instructions, only historical notes, and lint is clean.

## Final verification wave
- **F1, plan compliance:** every IS row and K item maps to a commit and a test or QA record. Note any deviation.
- **F2, code review:** an independent reviewer checks for races in the lock and ticket protocol, Windows behavior (mkdir lock, `process.kill(pid, 0)` on Windows, signals), the no-sleep test discipline, and the `VITEST_MAX_WORKERS` guardrail.
- **F3, real-surface QA:** the "Verification strategy" real-surface sequence, with evidence written to `.omo/evidence/cpu-budget/`. Warn Luke before it starts that the machine will be busy for about 15 minutes.
- **F4, scope fidelity:** confirm no gate rule, recipe, or test assertion changed (`git diff --stat` for `natural-motion/**` and `gates/**` is empty) and that the golden hash is unchanged.

## Commit strategy
- One commit per todo, using the Conventional Commit messages above. Docs go in the same commit as their code, except the AGENTS.md and motion-qa skill edits, which go in separate `chore(agents)` commits.
- Work on branch `lschneiderny/feat/cpu-budget` in worktree `dtuber-wt/cpu-budget`. Rebase onto main before landing, and fast-forward main only with Luke's approval.

## Success criteria
- Three concurrent heavy commands from two worktrees never hold more than 12 slots, and every one completes.
- Machine busy core-seconds and wall time for the F3 trio are recorded before and after. This is informational, not a gate. A vitest worker, vue-tsc, or Chromium can use more than one core, and non-agent load is outside the broker's control.
- A T1 smoke rerun on unchanged inputs returns in under 10 s, marked cached, with an identical `determinismHash`. A closure edit misses the cache.
- `--t1-report` refuses cached runs.
- `pnpm verify --base origin/main` passes, and `pnpm qa:test --all` shows no new failures.
- No gate rule, recipe, or test assertion changed.

## Follow-ups (not in this plan)
- Adopt `withCpuSlots` in the remaining 40 small vitest configs.
- Optionally cache T2 gates by hashing the rig and Cubism core files.
- Worktree provisioning: `NotContentIndexed` on repo and worktree folders, Defender/Dev Drive checks in `qa:doctor`, and a pre-installed worktree pool.
- An idle dev-server reaper in `dev:top`.
- Adaptive budgets that use the non-agent load the gate already samples.
