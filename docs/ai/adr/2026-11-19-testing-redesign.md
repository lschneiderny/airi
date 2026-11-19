# Testing redesign

Date: 2026-11-19
Status: accepted. Current rules: [Testing and QA](../context/testing.md).

## Context

An analysis of two weeks of agent transcripts (2026-11-05 to 2026-11-19, about
1,670 sessions) found that testing work cost about 40% of agent spend, and
that most of it was not running checks:

| Share of spend | Work |
| ---: | --- |
| about 19% | Sessions that mostly edit `packages/qa-tools`, `packages/cpu-slots`, or `scripts/dev-tools` |
| about 10% | Plan ledger and evidence bookkeeping around checks |
| about 8% | Waiting on checks: reading check logs, polling processes, background waits |
| about 7% | Running verify, tests, typecheck, lint, and QA |

Since the fork point, 277 of 1,383 `feat`, `fix`, and `refactor` commits
changed that tooling. The CPU slot broker (`@proj-airi/cpu-slots`, from the
[CPU budget ADR](2026-10-22-cpu-budget.md)) held 2,700 lines of source, 4,100
lines of tests, a 22 KB README, a stale-build guard on every Vitest config,
and Windows lock paths for a platform that no check runs on.

Its own history showed little contention: over 14 days and about 5,800
grants, the 90th-percentile wait was under 80 ms in every class. Agents still
spent steps on it, polling `pnpm slots status` 471 times.

A load test on 2026-11-19 ran three lanes at once (stage-ui typecheck, Node,
and browser tests; stage-tamagotchi typecheck and Node tests; qa-tools
typecheck and tests) on a 16-core, 31 GB workstation:

| Mode | Wall time | Peak CPU PSI `some avg10` | Lowest available memory | Worst 20 ms sleep overshoot |
| --- | ---: | ---: | ---: | ---: |
| Broker on (budget 6 from the memory rule) | 322 s | 9.0 | 7.9 GB | 18 ms |
| Broker off | 208 s | 4.7 | 9.0 GB | 7.6 ms |
| Broker off, `CPUWeight=20` scope | 212 s | 6.0 | 7.0 GB | 11 ms |

Every run passed every test. The broker made the workload 35% slower and
protected nothing at this load; a lower CPU weight changed nothing measurable.

## Decision

1. Remove `@proj-airi/cpu-slots`. Vitest configs drop `withCpuSlots`, which
   returns 37 of them to upstream's bytes. Root scripts run their commands
   directly, `pnpm slots` is gone, and verify, `pnpm test:run`, and `pnpm wt`
   take no lease.
2. Work that needs a calm host (`qa:bench` launches, launched
   `qa:stage measure` pairs, `qa:stage capture`) samples the host instead,
   with `decideHostContended` from `@proj-airi/stage-shared/perf/usage`, the
   same rule the app's perf recorder uses to mark contended samples. `qa:bench`
   already marks a run sampled on a contended host invalid.
3. Perf reports drop lease-contention marking; host contention, which the app
   measures itself, still drops cells.
4. Keep the guideline of at most three heavy lanes, the load the test covered.

## Consequences

- Checks start at once and run at their tools' default width.
- `qa:stage capture --exclusive` is removed, and capture's `preflight` record
  holds a host sample instead of lease holders.
- Old verify history records keep `waitMs` and `grant`; the reader ignores
  them.
- More than three heavy lanes, or rendered QA beside heavy tests, is not
  measured. If a desktop stall or memory pressure appears, measure it before
  adding coordination back, and prefer operating-system controls (a systemd
  scope with `CPUWeight`, `nice`) over a broker.
