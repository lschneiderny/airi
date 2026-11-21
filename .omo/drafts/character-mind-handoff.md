# Character mind handoff, 2026-11-21

The remaining character mind slices stopped mid-flight on the Linux machine so the work can resume on the MacBook. Every branch below is pushed. Delete this note when the last lane lands.

## Owner rulings already made

- D16 (CM6a): stop early, then cut the cursor delay, then rerun the press check. The gait stays unchanged. If presses still miss, the owner chooses between a harder brake near the pointer and a short step back.
- CM5b plan: D1 to D7 approved as recommended.
- CM6b plan: D1 to D11 approved as recommended (two PRs, CM6b1 and CM6b2).
- CM7 plan: D1 to D12 approved as recommended, including the removals in D3 and D4. The plan's status line records it.
- Review cadence: the owner reviews each slice plan's "Decisions for the owner" before implementation. After sign-off, implementation runs through PR without a second gate.

## Lanes

| Lane | Branch, head | Done | Left |
| --- | --- | --- | --- |
| Upstream sync to `bd4f30391` | landed on `main` at `91299da23` | `main` merged in, `225242a8c` reviewed, `pnpm test:run` (89 of 89 tasks) and `pnpm verify` passed on macOS | Nothing. `pnpm test:run` had never finished on Linux because `character-mind`'s idle tests looped forever; `42572a15c` fixed that on `main` |
| CM6a close-out | PR #70 from `luke/fix/character-mind-gaze-stop-early-2` (rebased onto `main`; the original branch is kept; the WIP branch is deleted) | Stop early, the delay cut (28.4 to 16.4 ms on macOS), and the D16 corrective step the owner chose. Presses after a 0.6 s rest poke 8 of 12 times, against 2 of 9 before; the pass rule is not fully met. The ADR amendment, plan record, and `pnpm verify --gate` are in | Review and merge #70. A sidestep without the turn is the follow-up for the remaining misses and needs its own ruling. `qa:bench` is Linux-only, so the perf tracker benches #70 |
| CM5b beat lock | PR #68 from `luke/feat/character-mind-beat-lock-2` (rebased onto `main`; the original branch is kept) | Every section 7 check passed on macOS, item 6 is not needed (an arrival delay of about 9 ms), the ADR and roadmap row are in, and `pnpm verify --gate` passed | Review and merge #68 |
| CM6b1 glances | PR #69 from `luke/feat/character-mind-glances-1-2` (rebased onto `main`; the original branch is kept) | Items 1 to 7, the headless runs (only `speak` differs, with equal gate statuses), the rendered checks on Live2D and MMD, and `pnpm verify --gate` | Review and merge #69. #68 and #69 both touch `idle-activities.ts` and the roadmap, so whichever lands second rebases |
| CM6b2 director on intents | not started | | Starts after CM6a lands. Plan: `.omo/plans/character-mind-glances.md` on `luke/feat/character-mind-glances` |
| CM7 performers | `luke/feat/character-mind-performers`, `051b76027` (plan only) | The plan, approved | CM7a waits for CM6b2 and the sync. Item c6 (the mapping-weights editor) may start any time. Then CM7b, CM7c, and CM7d run in parallel |
| L2 | `main` | The observer golden hashes pass unchanged on macOS; roadmap row L is done | Nothing |

## Resuming a WIP branch

Restore the uncommitted state onto the real branch without a force push:

```sh
git fetch origin
git switch luke/fix/character-mind-gaze-stop-early
git cherry-pick -n origin/luke/wip/cm6a-delay-cut
git reset
```

Commit the work properly, then delete the WIP branch with `git push origin --delete luke/wip/cm6a-delay-cut`. The CM6b1 WIP is folded in and deleted.

The CM6a WIP is not product code: it is `[cursor-hop]` latency instrumentation, plus a revert of `cfd603522` in `window.ts` that measures the "before" latency. Do not commit it. The delay cut itself is `cfd603522`.

## Notes for the new machine

- Rendered QA on Linux ran through `pnpm qa:display`. macOS has no QA display and no harness pointer: a rendered run uses the real desktop, and the owner allows agents to drive the cursor with notice. Cursor warps need no permission; posted clicks need Accessibility for the app that runs the agent.
- The local QA model locations are machine-specific and not in the repository. On the MacBook, the main checkout's `.env.qa` sets both. `pnpm wt new --qa` writes only `AIRI_QA_MMD_MODEL`, so copy the main checkout's `.env.qa` into a new worktree.
- The scratch harnesses from the Linux runs (latency hops, pointer driver, sweep scripts) stayed on that machine. They are not needed to resume.
