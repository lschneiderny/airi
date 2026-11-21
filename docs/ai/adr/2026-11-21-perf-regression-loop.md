# Perf regression loop

Date: 2026-11-21
Status: accepted. Current mechanics: [perf reports](../../../packages/qa-tools/README.md#perf-reports) and [Testing and QA](../context/testing.md).

## Context

`pnpm qa:bench` and `pnpm perf compare --bench` could compare two commits under
the controlled bench (the [usage performance recording ADR](2026-11-14-usage-performance-recording.md)),
but nothing ran them. The bench history on the workstation was empty, so
every comparison was `lowConfidence`, because the noise estimate pools only
when 10 clean history commits exist. The process had other gaps:

- A verdict named a metric and no cause. A bench record kept only the sum of
  all frame stages, so a regression could not be traced to a stage.
- About 5 commits a day land on `main`, but most work lives in long-lived,
  stacked PRs. A PR can land 75 commits at once, and measuring only `main`
  would leave such a jump with no cause.
- The fork has no CI by policy. `pnpm verify` and the pre-commit hook are its
  only checks, and neither launches the app.
- Nothing recorded a regression that was found. An intended cost would be
  flagged again on every comparison, which pushes agents to weaken a feature
  to clear the flag.

## Decision

1. **A local nightly timer, not CI.** A systemd user timer runs
   `pnpm perf:track tick --trigger timer` at 01:00. A tick starts benches only
   between 01:00 and 06:30 local time, holds a sleep inhibitor, runs one bench
   at a time in its own `qa:display` session, and stops that session
   afterwards. The owner of the machine installs the timer by hand with
   `pnpm perf:track install-timer` after the tracker lands. Same-machine
   history is the only history the bench statistics can use.
2. **Per-PR baselines.** The `origin/main` tip is compared with the previous
   benched main tip and with an anchor 3 to 6 days old. A PR head whose diff
   touches a render-loop path is compared with
   `git merge-base <head> origin/<base branch>`, so a stacked or unrebased PR
   is measured against its own starting point. One list, `renderLoopPaths`,
   names the render-loop paths and the scenarios each one maps to. The tracker
   and the verify follow-up both read it.
3. **A confirm step instead of bisect.** A regression verdict is only a
   candidate. The tick benches the pair again in reverse order (baseline,
   subject, subject, baseline) and opens a finding only when the fresh runs
   still show the regression. A finding carries the range commits that touch
   render-loop paths, a reproduce command, and a close check. It does not
   carry a culprit commit.
4. **Stage attribution as information.** Each `bench-run` record carries
   per-stage cost in an optional, additive `stages` field, with no record
   version bump. Under a metric's verdict, `compare --bench` and a finding list
   the stages that moved in that direction, or say that no timed stage moved.
   Stages never get a verdict of their own.
5. **Accepted costs keyed by id and resolved from history.** Intended costs
   live in the committed `packages/qa-tools/perf/accepted-costs.json`. Each
   entry has an id, a scenario, a metric, a reason, and a date, and no sha or
   host value. The tracker finds the commit that introduced each entry by
   parsing the file's versions in git history, and `git cherry` matches
   rewritten ranges. An entry therefore still works when it lands in the same
   commit as its change, when it is committed after the finding, and after a
   rebase merge gives its commit a new sha. An accepted finding closes, and
   the introducing commit becomes the new baseline for that metric.
6. **A findings store with outcomes.** The append-only `track.jsonl` beside
   `bench.jsonl` holds every tick, subject, baseline reset, and finding event.
   Every finding ends as `fixed`, `accepted`, or `noise`, closed by the tracker
   or by `pnpm perf:track close`. `pnpm perf status` prints the open findings,
   the outcome mix with the noise share, and the qualifiers (`stale`,
   `lowConfidence`, an unbenched main tip, `gh` failures). The noise share
   shows whether the floors and the sigma factor can be trusted.
7. **Budgets as counts in verify.** A node test in stage-ui-mmd runs the
   composed headless MMD stages for a fixed frame count and seed, and it fails
   when a deterministic work counter exceeds the committed budget in
   `work-budget.json`. It counts work, not time, so `pnpm verify` runs it
   through `vitest related` in the same session as the change. Every limit
   needs a reason. When render-loop code or the budget file changes, verify
   lists a perf follow-up.

During execution, one more decision was recorded. `scripts/dev-tools/verify-plan.ts`
imports `renderLoopPaths` by the relative path
`../../packages/qa-tools/src/track/paths`, the way `verify.ts` already imports
`packages/qa-tools/src/env/load`. A root workspace dependency on
`@proj-airi/qa-tools` would make verify's affected-package expansion
typecheck 77 packages instead of 8 for a stage-ui-mmd change.

## Rejected options

- **GitHub Actions or another CI runner.** The fork has no CI by policy, and
  a hosted runner has neither this machine's GPU and compositor nor its
  history, so its numbers could not be compared with local runs.
- **Tracking `main` only.** A rebase merge of a long PR moves `main` by tens
  of commits at once, and the regression would have no range smaller than the
  whole PR.
- **Automatic bisect of a finding's range.** Each bench side takes minutes,
  and a night's capacity is a few subjects. The confirm step costs a fixed
  four passes, and a bisect is left for later.
- **Stage verdicts.** Stage timings are noisier than the totals and do not
  cover GPU or compositor work. A stage pass or fail would gate on a partial
  signal.
- **Accepted costs that name a sha or a measured value.** A rebase merge
  rewrites the sha, and a measured value holds host data and goes stale.
- **Snapshot (`-u`) updates of the work budget.** An agent could then raise a
  limit without stating why. A raise is a hand edit with a reason.
- **A time budget in verify.** Verify runs beside other checks on a busy
  host, where time is not reproducible. Counts are.
- **Wrapping the whole tick in `qa:display run`, or a `pnpm wt new` per
  tick.** One display session per bench is always stopped in `finally`. Two
  persistent worktrees, locked against `pnpm wt gc`, avoid a fresh install of
  every subject.

## Consequences

- Agents learn in the same session when per-frame work grows, from verify,
  and the next morning when a pushed PR got slower, from `pnpm perf status`.
- A finding names a range and the stages that moved, not a culprit, so
  narrowing it is still manual.
- The tracker benches only what fits before 06:30. A subject that does not fit
  is `deferred` and waits for a later night, so a busy week can delay a PR's
  first measurement.
- The host check sees CPU load only. GPU contention from another process can
  still skew a run.
- History builds slowly. Until 10 clean commits are benched, every verdict is
  `lowConfidence`, and status says so.

## Follow-ups

- CPU profile diffs between a finding's baseline and subject.
- A bisect of a finding's range.
- A per-frame budget policy that states what a frame may cost per renderer.
- A manual "felt bad" incident that a person can file from the running app.
- A manual `qa:bench` run still puts its scratch directory in `os.tmpdir()`.
  Only the tracker moves it to its state directory.
- `@proj-airi/minecraft-bot` already fails its typecheck on the base, and the
  base gate excludes it. Fix it before any change widens verify's typecheck
  scope.
- Browser test flakes under load: the stage-tamagotchi `app.browser.test.ts`
  startup test sometimes misses its list-providers report, and the lab-tools
  t2-3d report tests sometimes hit their 5000 ms timeouts.
- `pnpm perf status` computes its 48-hour and 14-day windows from millisecond
  constants. Move them to `date-fns`, as AGENTS.md requires for date code.
