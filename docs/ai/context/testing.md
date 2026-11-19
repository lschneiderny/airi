# Testing and QA

Use this guide to choose checks for a change. Package READMEs and QA skills
describe command mechanics; this page says what each check proves and when it
runs.

## Checks and what they prove

| Check | Runs when | Proves | Does not prove |
| --- | --- | --- | --- |
| Package tests (`pnpm -F <package> exec vitest run --project <node or browser> <path>`) | Inner loop, while you develop behavior in a package | The behavior under test, in the narrowest project of that package. Use the browser project only when the behavior depends on browser APIs, rendered layout, or user interaction. | Anything outside that project. |
| `pnpm verify` | Commit loop, after each change and before each commit | Lint passes on the changed files, the changed packages and their dependents typecheck, and the tests related to the changed code or test data pass, in each changed package and its dependents. Each step covers what changed since it last passed on the current branch. | Tests that are not related by imports, such as tests that read a fixture through `fs`; env-gated tests, which it names in a notice. |
| `pnpm verify --gate` | Branch gate, before landing a branch | The same three steps over every change from the merge base with `main`, regardless of earlier passes. It runs related tests only, not the full suite. | The full suite, rendered behavior. |
| `pnpm test:run` and `pnpm test:root` | A whole-repository sweep, a change to shared fixtures or test data, and `pnpm release` | Every package's whole `test:run` suite through Turbo, including tests that read files through `fs`, and the root projects that belong to no package. Turbo reuses each suite that already passed on the same inputs. | Env-gated tests. |
| `pnpm release` | Before each desktop release, on Linux and on macOS | The full typecheck, every test (`pnpm test:run` and `pnpm test:root`), lint, both bundle checks, and the clean-start smoke, before anything is uploaded. | The installed package; install and start each installer by hand before publishing the draft. |
| Headless rig checks | A change to a renderer's motion | MMD: `pnpm qa:motion3d` drives body motion in Node, deterministically per seed, and `pnpm qa:test:model` runs the tests that need a local model. Live2D: `pnpm qa:live2d-rig` runs the headless ForBOOTH rig (T2) for Natural and Live2D motion changes. Live2D has no statistical gate. | How the motion looks in the app. |
| Storage write scan (`scripts/dev-tools/storage-writes.test.ts`) | `pnpm verify`, when a renderer source changes | Every storage write site in the renderer source writes a key that a state registry registration owns, from a file among its writers. | Keys built at run time, which `state-registry.browser.test.ts` checks; writes in Web Workers and libraries. |
| Rendered smoke (`pnpm qa:smoke`) | Branch gate, when app runtime code changed | The app starts from a fresh profile with no renderer or main-process error in any window. | Chat, speech, or motion behavior. |
| Rendered sessions (`pnpm qa:app`, the `airi-qa` MCP server) | A visible change to motion, expression, or speech | A real chat turn in the running app, with events and screenshots for visual review. Use a Live2D or MMD model that matches the change. | Statistical motion quality. |

On Linux, start `qa:smoke`, `qa:app`, `qa:bench`, and every other command
that opens app windows through `pnpm qa:display run --`.

App runtime code means files under `apps/stage-tamagotchi/src/**`,
`packages/stage-ui*/src/**`, `packages/stage-shared/src/**`,
`packages/stage-pages/src/**`, or `packages/stage-layouts/src/**`. A
`--gate` run prints a smoke reminder for these paths.

Rendered sessions are needed only for visible changes. Other app runtime
changes need the clean-start smoke at the branch gate, not a `qa:app` session.
See the [motion QA levels ADR](../adr/2026-10-20-motion-qa-levels.md) for the
history of the motion levels.

## Platforms

macOS and Linux on KDE Plasma Wayland are the only platforms whose checks run.
Windows, sway, and X11 code stays in the repository and is not removed, but
it is planned, not checked: no check above runs there, and a change does not
need evidence from them.

## Checks by change type

| Change | Required checks |
| --- | --- |
| Pure logic or package behavior | Package tests, then `pnpm verify`. |
| Browser-specific behavior or UI interaction | The package's browser project, then `pnpm verify`. |
| A test that reads a file outside its package | Add the file to that package's `test:run` inputs in `turbo.json`, so Turbo's cache sees it, then `pnpm test:run`. |
| A new storage key | A registration in `stateRegistry`, then `state-registry.browser.test.ts` in the stage-ui browser project and the storage write scan; see [State registry](state-persistence.md#state-registry). |
| Any change before landing | `pnpm verify --gate`. |
| App runtime code in the paths above | `pnpm verify --gate` and `pnpm qa:display run -- pnpm qa:smoke`. |
| Natural or Live2D motion | Branch gate checks, `pnpm qa:live2d-rig`, and a `qa:app` or `airi-qa` MCP session with a Live2D model, with screenshots reviewed by eye. |
| MMD body motion (`motion-driver-humanoid` performance or locomotion, `stage-ui-mmd` body) | Branch gate checks and `pnpm qa:test:model`. Run each affected scenario with `pnpm qa:motion3d run`; for every scenario the change must not move, run it at the base and the tip and require `pnpm qa:motion3d diff` to print `IDENTICAL`. Judge with `qa:motion3d gate` or the topic report, and review `qa:motion3d clip` output by eye. |
| A `qa:motion3d` report rule (`packages/qa-tools/src/t2-3d/reports`) | Labelled cases in a `qa:motion3d inject` labels file, sealed before any scoring, including injected faults that must fail the changed line; the report's version bump in its own commit; every other line of the report unchanged on the identity runs, read from `--json` verdicts or a `qa:motion3d matrix` receipt. |
| Documentation only | `pnpm verify`, which lints the files and skips typecheck and tests for Markdown. A doc in `docs/ai/context/` still runs its guard test. |
| Performance-sensitive runtime change (frame loop, stage rendering, host CPU sampling, perf recording) | `pnpm verify --gate`. Optionally, run `pnpm qa:display run -- pnpm qa:bench` on the base and on the tip, then read the result with `pnpm perf compare --bench <base> <tip>`. Start a bench only when no other CPU-sensitive check is running. |
| CPU broker scheduling or pressure policy | The package tests and QA scenarios for the changed rule, using private broker and history stores and pressure fixtures. |

The branch gate is required even when every commit-loop check passed: the
commit loop is incremental, while the gate rechecks every change against the
branch base.

## Verify scope and results

See the [dev-tools README's verify section](../../../scripts/dev-tools/README.md#pnpm-verify)
for scope selection, last-pass records, leases, and command behavior, and its
[`pnpm test:run` section](../../../scripts/dev-tools/README.md#pnpm-testrun)
for what Turbo caches. If a step fails, fix the cause and rerun it.

Every workspace package runs its own tests through its `test:run` script and
its own Vitest config, as upstream does. `pnpm verify` runs the related tests
of each affected package from that package; `pnpm test:run` runs every whole
suite through Turbo, one package at a time. A suite result is cached by
Turbo, so it must depend only on files and variables that `turbo.json`
declares for the `test:run` task. Gate a test that needs a local model, a
live service, or a private path on an environment variable; a package test
under Turbo never receives it, and `pnpm qa:test:model` or a direct Vitest
run does.

`pnpm verify --stats` reads the append-only step history without running
checks. It reports counts by step and scope mode, failure rate, median and
90th-percentile duration, and the five slowest executed steps with worktree
and branch. Skipped results count toward totals but not duration or
failure-rate calculations. Use `--since 2d` to filter by a positive duration,
or `--json` for machine-readable output. Malformed records are skipped and
counted. History is separate from last-pass data; setting
`AIRI_VERIFY_HISTORY_DIR` redirects only history.

## CPU slot scheduling

CPU slots coordinate CPU-heavy commands across worktrees. They are a shared
work budget, not an operating-system CPU quota. The default budget is 12.

| Class | Minimum to maximum | Typical use |
| --- | ---: | --- |
| `lint` | 1 | Lint chunks |
| `test` | 2 to 6 | Node tests; the lease of `pnpm test:run` and of the verify test step |
| `browser` | 2 to 4 | Browser tests |
| `typecheck` | 2 to 6 | Typecheck |
| `build` | 2 to 6 | Package builds |
| `install` | 4 | Dependency installation |
| `gate` | 4 to 10 | Motion gates |
| `live` | 4 to 6 | App smoke, app sessions, and rendered capture |
| `exclusive` | Whole budget | Frame-timing work that must not share CPU, such as `qa:bench` |

The scheduler grants a fitting queue head first. When a non-exclusive head
does not fit and has waited less than 60 seconds, a later non-exclusive ticket
may backfill if its minimum fits. Exclusive tickets are never granted out of
order. Once a non-exclusive head has waited 60 seconds, backfill stops until
running work drains enough for that head to fit. Exclusive heads do not age.

When multiple non-exclusive tickets wait, each grant shares free capacity
among the waiting non-exclusive tickets, with each ticket's minimum and
maximum respected. A sole waiter can receive its class maximum. Grant sizes
stay fixed until the lease ends.

On Linux, the broker reads CPU PSI `some avg10` before each scheduling
transaction. At or above the configured hold threshold, new grants pause
while any lease is held. Below the configured idle threshold, non-exclusive
grants may use a bounded extra quarter of the budget. The defaults are 20 and
70, confirmed by a quiet-host calibration on 2026-11-10 (see
`packages/cpu-slots/README.md`). With no pressure sample, scheduling uses the
normal budget. Existing leases do not shrink when pressure changes. Exclusive
work is never overcommitted and requires all slots to be free.

`pnpm slots status` shows current holders and queued decisions, including
reasons such as `head-aging` and `cpu-pressure`. Use `pnpm slots history` to
read append-only lease events and wait summaries. Tests and QA scenarios that
take real leases must set `AIRI_CPU_SLOTS_DIR` and
`AIRI_CPU_SLOTS_HISTORY_DIR` to private temporary directories, so their
fixture leases stay out of the real store and history. Set
`AIRI_CPU_PRESSURE_FILE` to a fixture when a scenario must have deterministic
pressure.

Heavy verification, builds, and rendered QA compete for the shared machine.
Keep no more than three heavy plan lanes active at once. If a ticket waits,
check `pnpm slots status` and `pnpm slots history` before adding more heavy
work.

## Flaky tests

A flaky test is a bug. Record the failure and fix its cause. Do not turn
intermittent success into a pass by adding arbitrary sleeps or weakening
assertions.

## Tool references

Use the [dev-tools README](../../../scripts/dev-tools/README.md) for verify,
history, `test:run`, `qa:test:model`, and `qa:display` command mechanics. Use
the [CPU slots README](../../../packages/cpu-slots/README.md) for broker
details and the [QA tools README](../../../packages/qa-tools/README.md) for
smoke, app sessions, rig runners, evidence, and CLI mechanics. For perf
recording, `pnpm perf`, and `qa:bench`, use the
[perf reports section](../../../packages/qa-tools/README.md#perf-reports) and
the [usage performance recording ADR](../adr/2026-11-14-usage-performance-recording.md).
Motion, screenshot, and browser procedures live in the
[motion QA skill](../../../.agents/skills/motion-qa/SKILL.md),
[Vishot skill](../../../.agents/skills/use-vishot/SKILL.md), and
[browser skills](../../../.agents/skills/use-agent-browser-for-airi/SKILL.md).
