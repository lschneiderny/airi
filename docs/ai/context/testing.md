# Testing and QA

Use this guide to choose checks for a change. Package READMEs and QA skills
describe command mechanics; this page says what each check proves and when it
runs.

## Checks and what they prove

| Check | Runs when | Proves | Does not prove |
| --- | --- | --- | --- |
| Package tests (`pnpm -F <package> exec vitest run --project <node or browser> <path>`) | Inner loop, while you develop behavior in a package | The behavior under test, in the narrowest project of that package. Use the browser project only when the behavior depends on browser APIs, rendered layout, or user interaction. | Anything outside that project. |
| `pnpm verify` | Commit loop, after each change and before each commit | Lint passes on the changed files, the changed packages and their dependents typecheck, and the tests related to the changed code or test data pass, in each changed package and its dependents. Each step covers what changed since it last passed on the current branch. | Tests that are not related by imports, such as tests that read a fixture through `fs`; env-gated tests, which it names in a notice. |
| `pnpm verify --gate` | An upstream sync only. Pull requests and releases do not run it | The same three steps over every change from the merge base with `main`, regardless of earlier passes. It runs related tests only, not the full suite. When the steps pass, it runs the QA the changed paths need: the clean-start smoke for app runtime code, `pnpm qa:test:model` for motion, and `pnpm qa:motion3d affected` for MMD body motion. | The full suite, how motion looks. |
| `pnpm test:run` and `pnpm test:root` | A whole-repository sweep, a change to shared fixtures or test data, and `pnpm release` | Every package's whole `test:run` suite through Turbo, including tests that read files through `fs`, and the root projects that belong to no package. Turbo reuses each suite that already passed on the same inputs. | Env-gated tests. |
| `pnpm release` | Before each desktop release, on Linux and on macOS | The full typecheck, every test (`pnpm test:run` and `pnpm test:root`), lint, both bundle checks, and the clean-start smoke, before anything is uploaded. | The installed package; install and start each installer by hand before publishing the draft. |
| Headless rig checks | A change to a renderer's motion | MMD: `pnpm qa:motion3d` drives body motion in Node, deterministically per seed, and `pnpm qa:test:model` runs the tests that need a local model. Live2D: `pnpm qa:test:model` runs the headless ForBOOTH rig (T2) test when `AIRI_QA_RIG_FORBOOTH` is set; `pnpm qa:live2d-rig` runs one trial by hand, and `pnpm qa:live2d-rig --idle <seconds> --rig <folder>` measures how far and how jerkily an idle moves a rig's picture. Live2D has no statistical gate. | How the motion looks in the app. |
| Arm clearance sweep (`pnpm qa:motion3d clearance`) | By hand, at the base and at the tip, for a change to the body model, the arm rest pose, the arm guard, or the collisions between arms and garments. The tip passes when `--compare` against the base shows no rig newly pierced in `idle-drive` (5 % or more of frames), none with new ticks without a clear arm pose, none resting more than 8 degrees further out, and none with more than 2 points more reversing cloth. The rigs the [body model ADR](../adr/2026-11-25-body-model.md) names as limited stay pierced and are read by eye | Per rig and scenario, in headless MMD runs with physics: how often, how deeply and for how long an arm's centreline passes through her body or clothing below the neck, the upper-arm angle, and cloth jitter; with `--compare`, the change against an earlier sweep. | Sleeve-surface overlap, legs, clip-driven arms, or how the arms look. |
| Storage write scan (`scripts/dev-tools/storage-writes.test.ts`) | `pnpm verify`, when a renderer source changes | Every storage write site in the renderer source writes a key that a state registry registration owns, from a file among its writers. | Keys built at run time, which `state-registry.browser.test.ts` checks; writes in Web Workers and libraries. |
| Rendered smoke (`pnpm qa:smoke`) | `pnpm release` runs it before each release; run it by hand when app runtime code changed and you need it sooner | The app starts from a fresh profile with no renderer or main-process error in any window. | Chat, speech, or motion behavior. |
| Rendered sessions (`pnpm qa:app`, the `airi-qa` MCP server) | A visible change to motion, expression, or speech | A real chat turn in the running app, with events and screenshots that show the change works. Use a Live2D or MMD model that matches the change. | How the motion feels; that is the review backlog's job. |

On Linux, start `qa:smoke`, `qa:app`, `qa:bench`, and every other command
that opens app windows through `pnpm qa:display run --`. On macOS, the same
`pnpm qa:display run -- pnpm qa:bench` runs the bench on your desktop. Plug the
Mac in and turn Low Power Mode off, or every run is invalid.

App runtime code means files under `apps/stage-tamagotchi/src/**`,
`packages/stage-ui*/src/**`, `packages/stage-shared/src/**`,
`packages/stage-pages/src/**`, `packages/stage-layouts/src/**`, or
`packages/character-mind/src/**`. When these paths change, `pnpm verify`
lists the smoke after its summary, and `pnpm release` runs it.

Rendered sessions are needed only for visible changes. Other app runtime
changes need the clean-start smoke at the branch gate, not a `qa:app` session.

## Motion feel

Whether motion, expression, or speech looks and feels right is judged by a
person, later, from a review backlog. It never gates landing, and an agent
does not judge it by eye. Deterministic checks still gate: the smoke, the
model tests, the headless rigs, and identity diffs. `/vault-sync` proposes a
backlog note for landed commits that changed motion, with the commit range,
date, changed paths, and the scenarios and seeds to replay, so a later
complaint can be placed in time and bisected by rendering again.
Quality scores from the research tooling in
[`@proj-airi/lab-tools`](../../../packages/lab-tools/README.md) (`lab:*`)
inform that review and tuning; they do not gate either.
See the [motion QA levels ADR](../adr/2026-10-20-motion-qa-levels.md) for the
history of the motion levels.

## Platforms

macOS and Linux on KDE Plasma Wayland are the only platforms whose checks run.
Windows, sway, and X11 code stays in the repository and is not removed, but
it is planned, not checked: no check above runs there, and a change does not
need evidence from them.

## Checks by change type

`pnpm verify` lists the rows below that it can detect from changed paths, under
`also needed, not run by verify`. The rows that need judgment, such as a
visible change, test data read through `fs`, or a performance-sensitive change,
are listed only here.

| Change | Required checks |
| --- | --- |
| Pure logic or package behavior | Package tests, then `pnpm verify`. |
| Browser-specific behavior or UI interaction | The package's browser project, then `pnpm verify`. |
| A test that reads a file outside its package | Add the file to that package's `test:run` inputs in `turbo.json`, so Turbo's cache sees it, then `pnpm test:run`. |
| A new storage key | A registration in `stateRegistry`, then `state-registry.browser.test.ts` in the stage-ui browser project and the storage write scan; see [State registry](state-persistence.md#state-registry). |
| Any change before landing | `pnpm verify`. Do not run `pnpm verify --gate` for a pull request. |
| App runtime code in the paths above | `pnpm verify`. `pnpm release` runs the smoke. A pull request also runs `qa:bench` at the base and the tip and reports the `pnpm perf compare --bench` result, as the root `AGENTS.md` says. |
| Natural or Live2D motion | `pnpm qa:test:model`; set `AIRI_QA_RIG_FORBOOTH` in `.env.qa` so it runs the rig test. Feel goes to the [review backlog](#motion-feel). |
| MMD body motion (`motion-driver-humanoid` performance or locomotion, `stage-ui-mmd` body) | `pnpm qa:test:model` and `pnpm qa:motion3d affected`; keep `AIRI_QA_MMD_MODEL` set in `.env.qa` so it runs the MMD model tests. Unless it prints NOT AFFECTED, run each affected scenario with `pnpm qa:motion3d run`; for every scenario the change must not move, run it at the base and the tip and require `pnpm qa:motion3d diff` to print `IDENTICAL`. To measure quality, score the runs with `lab:motion3d gate` or a topic report; scores inform tuning and do not gate. `pnpm verify` also runs the headless work budget (`src/composables/mmd/work-budget.test.ts` in stage-ui-mmd), which counts frame-pipeline work, not time. To raise a limit, re-measure, then give the entry and the commit body a reason, as the [stage-ui-mmd README](../../../packages/stage-ui-mmd/README.md#headless-work-budget) says. Feel goes to the [review backlog](#motion-feel). |
| A `lab:motion3d` report rule (`packages/lab-tools/src/t2-3d/reports`) | Labelled cases in a `lab:motion3d inject` labels file, sealed before any scoring, including injected faults that must fail the changed line; the report's version bump in its own commit; every other line of the report unchanged on the identity runs, read from `--json` verdicts or a `lab:motion3d matrix` receipt. |
| Documentation only | `pnpm verify`, which lints the files and skips typecheck and tests for Markdown. A doc in `docs/ai/context/` still runs its guard test. |
| Performance-sensitive runtime change (frame loop, stage rendering, host CPU sampling, perf recording) | `pnpm verify`. After you push, the nightly perf tracker benches every open PR head whose diff touches a render-loop path against its merge base, and `pnpm perf status` shows its findings. Before and after such work, run `pnpm perf status`. Fix an open finding, or accept an intended cost in `packages/qa-tools/perf/accepted-costs.json`, in the same commit as the change. To measure before landing, run `pnpm qa:display run -- pnpm qa:bench` on the base and on the tip, then read the result with `pnpm perf compare --bench <base> <tip>`. Start a bench only when no other CPU-sensitive check is running. The [perf reports section](../../../packages/qa-tools/README.md#perf-reports) describes the tracker and its qualifiers. |

Pull requests do not run the branch gate. The commit loop is incremental, and
`pnpm release` checks the whole repository before each release.

## Verify scope and results

See the [dev-tools README's verify section](../../../scripts/dev-tools/README.md#pnpm-verify)
for scope selection, last-pass records, and command behavior, and its
[`pnpm test:run` section](../../../scripts/dev-tools/README.md#pnpm-testrun)
for what Turbo caches. If a step fails, fix the cause and rerun it.

When its output is not a terminal, verify prints its own lines and the tail
of a failed command, and writes everything else to a run log. A full run
takes minutes, so an agent that wants to keep working starts it with
`pnpm verify --detach` and later blocks once with `pnpm verify --wait`,
instead of polling a process or a log.

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

## Machine load

Checks run at the width their tools choose; nothing schedules them across
worktrees. A load test on 2026-11-19 (three lanes of typecheck and tests on a
16-core, 31 GB workstation) finished in 208 s without coordination and in
322 s under the CPU slot broker that the
[testing redesign ADR](../adr/2026-11-19-testing-redesign.md) removed, with
CPU pressure under 10%, at least 7 GB free, and no desktop stall. Keep no more
than three heavy lanes active at once.

Frame-timing work needs a calm host instead: `qa:bench` launches, launched
`qa:stage measure` pairs, and `qa:stage capture` wait for one, judged by
`decideHostContended` in `@proj-airi/stage-shared/perf/usage`, and a bench
run sampled on a contended host is invalid. Start such work only when no
other heavy check is running.

## Flaky tests

A flaky test is a bug. Record the failure and fix its cause. Do not turn
intermittent success into a pass by adding arbitrary sleeps or weakening
assertions.

## Tool references

Use the [dev-tools README](../../../scripts/dev-tools/README.md) for verify,
history, `test:run`, `qa:test:model`, and `qa:display` command mechanics, and
the [QA tools README](../../../packages/qa-tools/README.md) for
smoke, app sessions, rig runners, evidence, and CLI mechanics. For perf
recording, `pnpm perf`, and `qa:bench`, use the
[perf reports section](../../../packages/qa-tools/README.md#perf-reports) and
the [usage performance recording ADR](../adr/2026-11-14-usage-performance-recording.md).
Motion, screenshot, and browser procedures live in the
[motion QA skill](../../../.agents/skills/motion-qa/SKILL.md),
[Vishot skill](../../../.agents/skills/use-vishot/SKILL.md), and
[browser skills](../../../.agents/skills/use-agent-browser-for-airi/SKILL.md).
