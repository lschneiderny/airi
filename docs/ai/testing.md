# Testing and QA

Use this guide to choose checks for a change. Package READMEs and QA skills
describe command mechanics; this page defines which checks the change needs.

## Tiers

| Tier | Run when | Check |
| --- | --- | --- |
| Inner loop | Developing behavior in a package | Run the narrowest relevant package Node test project. Use a browser project only when the behavior depends on browser APIs, rendered layout, or user interaction. |
| Commit loop | After each change | `pnpm verify` checks changed files since each step's last passing tree on the current branch. |
| Branch gate | Before landing | `pnpm verify --gate` checks the full branch against its merge base with `main`. If the branch changes app runtime code, also run `pnpm qa:display run -- pnpm qa:smoke`. |
| Live acceptance | A visible motion change | Run the relevant `qa:motion` T3 gate or `qa:app` scenario, capture screenshots and run evidence, then inspect the rendered result. |

For the branch gate, app runtime code means files under
`apps/stage-tamagotchi/src/**`, `packages/stage-ui*/src/**`,
`packages/stage-shared/src/**`, `packages/stage-pages/src/**`, or
`packages/stage-layouts/src/**`. A `--gate` run prints a smoke reminder for
these paths; run smoke inside `qa:display` on Linux.

Live acceptance is limited to visible motion changes. Other app runtime
changes need the clean-start smoke in the branch gate, not a `qa:app` session.
When motion behavior is rendered, use the motion tools and inspect their
artifacts. See the [motion QA levels ADR](adr/2026-10-20-motion-qa-levels.md)
for what each motion level proves.

## Checks by change type

| Change | Required checks |
| --- | --- |
| Pure logic or package behavior | Relevant package Node tests, then `pnpm verify` after the change. |
| Browser-specific behavior or UI interaction | Relevant browser tests, then `pnpm verify` after the change. |
| Any code change before landing | `pnpm verify --gate`. |
| App runtime code in the paths above | `pnpm verify --gate` and `pnpm qa:display run -- pnpm qa:smoke`. |
| Visible motion behavior | Branch gate checks, plus the relevant `qa:motion` T3 gate or `qa:app` run, screenshots, and visual inspection. |
| Documentation-only change | `pnpm verify`; run documentation-specific checks named by the touched package when applicable. |
| CPU broker scheduling or pressure policy | The package tests and QA scenarios for the changed rule, using private broker and history stores and pressure fixtures. |

The final branch check is mandatory even when every commit-loop check passed.
The commit loop is incremental by design, while the gate rechecks all changes
against the branch base.

## Verify scope and results

Use `pnpm verify` as the incremental commit loop, then run
`pnpm verify --gate` before landing to check the full branch. If a step fails,
fix the cause and rerun the required checks. See the
[dev-tools README's verify section](../../scripts/dev-tools/README.md#pnpm-verify)
for scope selection, pass caching, leases, and command behavior.

`pnpm verify --stats` reads the append-only step history without running
checks. It reports counts by step and scope mode, failure rate, median and
90th-percentile duration, and the five slowest executed steps with worktree
and branch. Cached and skipped results count toward totals but not duration
or failure-rate calculations. Use `--since 2d` to filter by a positive
duration, or `--json` for machine-readable output. Malformed records are
skipped and counted. History is separate from pass-cache and last-pass data;
setting `AIRI_VERIFY_HISTORY_DIR` redirects only history.

## CPU slot scheduling

CPU slots coordinate CPU-heavy commands across worktrees. They are a shared
work budget, not an operating-system CPU quota. The default budget is 12.

| Class | Minimum to maximum | Typical use |
| --- | ---: | --- |
| `lint` | 1 | Lint chunks |
| `test` | 2 to 6 | Node tests |
| `browser` | 2 to 4 | Browser tests |
| `typecheck` | 2 to 6 | Typecheck |
| `build` | 2 to 6 | Package builds |
| `install` | 4 | Dependency installation |
| `gate` | 4 to 10 | Motion gates |
| `live` | 4 to 6 | App smoke, app sessions, and rendered motion capture |
| `exclusive` | Whole budget | Frame-timing work that must not share CPU, including the `qa:motion` T3 timing gate and `qa:stage measure` |

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
grants may use a bounded extra quarter of the budget. The current defaults
are 20 and 70; they are defaults awaiting quiet-machine calibration. With no
pressure sample, scheduling uses the normal budget. Existing leases do not
shrink when pressure changes. Exclusive work is never overcommitted and
requires all slots to be free.

`pnpm slots status` shows current holders and queued decisions, including
reasons such as `head-aging` and `cpu-pressure`. Use `pnpm slots history` to
read append-only lease events and wait summaries. Set
`AIRI_CPU_SLOTS_DIR` and `AIRI_CPU_SLOTS_HISTORY_DIR` to private temporary
directories for isolated scheduling tests. Set `AIRI_CPU_PRESSURE_FILE` to a
fixture when a scenario must have deterministic pressure.

Older worktrees running the previous broker use strict FIFO and the original
budget ceiling. They see the new `live` lease as wire class `browser` with
`policy: 'live'`, so it counts as shared work; they wait when the new broker
overcommits beyond their fixed budget, and cannot grant above that budget.

Heavy verification, builds, and rendered QA compete for the shared machine.
Keep no more than three heavy plan lanes active at once. If a ticket waits,
check `pnpm slots status` and `pnpm slots history` before adding more heavy
work.

## Flakes and tool references

A flaky test is a bug. Record the failure, then fix it or quarantine it with
an owner and a clear removal condition. Do not convert intermittent success
into a pass by adding arbitrary sleeps or weakening assertions.

Use the [dev-tools README](../../scripts/dev-tools/README.md) for verify,
history, and `qa:display` command mechanics. Use the [CPU slots README](../../packages/cpu-slots/README.md)
for broker details and the [QA tools README](../../packages/qa-tools/README.md)
for smoke, app sessions, motion gates, evidence, and CLI mechanics. Tool
specific motion and browser procedures live in the
[motion QA skill](../../.agents/skills/motion-qa/SKILL.md),
[Vishot skill](../../.agents/skills/use-vishot/SKILL.md), and
[browser skills](../../.agents/skills/use-agent-browser-for-airi/SKILL.md).
