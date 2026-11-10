# Testing tiers and shared-resource policy

Date: 2026-11-10
Status: accepted

## Context

The five-day verify baseline recorded 263 test steps with a median duration of
125.0 seconds and a total of 41,486 seconds. In 224 of 263 test records, the
reported scope contained more than 150 paths. Typecheck recorded 303 steps
with a median of 26.9 seconds, while smoke recorded 27 runs with a median of
43.5 seconds. The measurements show that repeatedly checking branch-wide
scope in the commit loop is expensive, and that a clean-start check is a
meaningful but bounded branch-level cost. The baseline is recorded in
`.omo/evidence/test-qa-revamp/task-1-baseline.json`.

The old guidance did not distinguish incremental developer checks, a required
full branch gate, and rendered acceptance. It also asked for live app QA on
changes that did not affect rendered behavior. At the same time, exclusive
CPU leases made live app testing block unrelated verification from every
worktree.

## Decisions

### Levels

The testing guide defines four tiers. The inner loop runs the narrow package
Node tests while developing behavior. The commit loop runs `pnpm verify` on
changes since each step's last passing tree. The branch gate runs
`pnpm verify --gate` against the merge base with `main`, plus
`pnpm qa:display run -- pnpm qa:smoke` when app runtime paths changed. Live
acceptance runs only for visible motion changes and uses the relevant motion
T3 gate or `qa:app`, with screenshots and inspected evidence.

### Incremental verification and branch gate

Plain verify selects scope independently for typecheck, lint, and test. It
uses a per-branch step record only when its merge base is unchanged and its
recorded tree remains available. Missing or malformed records and entries,
changed merge base, and pruned trees fall back to branch scope. Detached
HEAD also checks branch scope and does not write a record. A successful or
cached step advances only its own entry; failed and skipped steps do not.
The gate always checks the full branch, so incremental commit checks cannot
replace the required pre-landing check.

Each verify step requests one CPU lease for all commands in that step.
Typecheck uses workspace package directories for filters, allowing the same
filter shape for commit and tree baselines. The test step has a Node root and
an affected-package browser root. Pass-cache identity remains tied to the
working tree, step, command, Node version, and platform; history and scope
records do not weaken it.

### CPU classes and live QA

Live app sessions use the non-exclusive `live` class, with a minimum of four
and maximum of six slots. The scheduler can therefore run live acceptance
alongside test, lint, and typecheck work. The T3 frame-timing gate and
`qa:stage measure` retain `exclusive` because their measurements require a
quiet machine. Live QA is required only for visible motion changes; app
runtime changes still receive one clean-start smoke in the branch gate.

### Lane limit

No more than three heavy plan lanes should run at once. This is an
operational limit to keep the shared CPU budget useful for work from other
lanes while reducing queueing and pressure.

## Consequences

- The commit loop covers only unverified changes after the last passing tree.
  The branch gate must run before landing and checks the full branch.
- A step failure leaves its last-pass entry unchanged. Cached passes advance
  the entry because the exact command and tree already passed.
- Live QA may share capacity with other work. Its slots remain fixed for the
  lifetime of the lease.
- A queued non-exclusive ticket that fits may backfill behind a blocked head
  until that non-exclusive head has waited 60 seconds. Age is measured from
  ticket creation. After the head ages, backfill stops and queued work drains
  in order as running leases end. Exclusive tickets never backfill and do not
  age.
- When several non-exclusive tickets wait, grants divide available slots
  fairly while respecting each request's minimum and maximum. A sole waiter
  can receive its class maximum. Exclusive work receives the whole default
  budget only when no slots are held.
- Linux CPU PSI admission holds new grants at high pressure while work is
  already held. At low pressure, shared work may use a bounded quarter-budget
  overcommit. The configured defaults, idle 20 and hold 70, remain defaults
  pending a quiet-machine calibration.
- Older worktrees retain strict FIFO and the original fixed budget ceiling.
  They count new `live` leases through the `browser` wire class and
  `policy: 'live'`. If the new broker overcommits, old clients wait until the
  held total fits their ceiling; they cannot grant above that ceiling. Remove
  this encoding only when every worktree in `git worktree list` has `live` in
  `packages/cpu-slots/src/classes.ts`.
- Verify history and slot history make waits and failures visible without
  changing pass-cache decisions. Their command formats and storage details
  are documented in their respective READMEs.
- Detailed testing tiers and check selection live in
  [`docs/ai/testing.md`](../testing.md). Verify and QA command mechanics live
  in the dev-tools, cpu-slots, and qa-tools READMEs; motion, browser, and
  screenshot procedures remain in their skills.

- Calibrate CPU pressure defaults during a quiet-machine window, then update
  the defaults only if those measurements support a change.
