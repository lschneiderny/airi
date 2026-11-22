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
| CM6a close-out | landed: #70, then the sidestep in #73 | Stop early, the cursor delay cut (28.4 to 16.4 ms on macOS), the corrective step, and the owner's sidestep without a turn. All nine headless scenarios `IDENTICAL`. After a 4 s rest every press pokes; presses 0.6 to 2 s after landing still miss about half the time, because she is still braking | The owner ruled against a shorter brake (2026-11-21); nothing left |
| CM5b beat lock | landed: #71 (#68 rebased after #69; #68 closed) | Everything | Nothing |
| CM6b1 glances | landed: #69 | Everything | Nothing |
| CM6b2 director on intents | landed: #74 | Items 8 to 13, all nine scenarios `IDENTICAL`, rendered away step | The rendered clip-ending checks (steps 6 and 9) need a motion clip; no `.vmd` is on the test machine (question pending) |
| CM7 performers | c6 landed in #72 (the mapping-weights editor, with a window-synced `stage-expression-catalog` mirror so the settings window sees the stage's model); CM7a in progress on `luke/feat/character-mind-capabilities` | The plan is on `main` | CM7a, then CM7b, CM7c, and CM7d in parallel |
| S2 store tiers | in progress on `luke/refactor/character-mind-store-tiers` | Plan `.omo/plans/character-mind-store-tiers.md`; upstream exceptions declared by owner, the scanner rejects new plain fork state, consent in one leader document | The remaining commits, gate, PR |
| CM8 touch and notices | plan only: `.omo/plans/character-mind-notify-touch.md` (on the S2 branch) | Overlaps 11 to 13 planned | Waits for CM7a and CM7c, and for the owner's D2 ruling on touch under the upstream drivers (question pending) |
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
