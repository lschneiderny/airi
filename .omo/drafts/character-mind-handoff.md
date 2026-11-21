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
| Upstream sync to `bd4f30391` | `luke/chore/upstream-sync`, `a547c0f7d` | The merge (sync step 2.1), the ledger and roadmap docs, and `pnpm test:root` (24 files, 422 tests) | The branch was cut from `bec508cae`: merge `main` into it. Review `225242a8c` (an agent-config change). Run `pnpm test:run` (interrupted) and `pnpm verify`. Then land: `git switch main && git merge --ff-only luke/chore/upstream-sync && git push` |
| CM6a close-out | `luke/fix/character-mind-gaze-stop-early`, `cfd603522`; WIP on `luke/wip/cm6a-delay-cut`, `16a4f4d4c` | The stop-early rule with tests; window bounds sent only on change | The WIP holds the unfinished cursor delay cut (main-process screen and window services, the Linux desktop bridge, `use-electron-mouse`, `MMD.vue`); it is not verified. Then: measure the latency before and after, run the perf check, run the rendered press check (plan section 8 step 5), write the gaze ADR amendment, roadmap row, and plan status, then the gate and the PR. The latency figures (about 172 ms) were measured on Linux KDE; re-baseline on macOS |
| CM5b beat lock | `luke/feat/character-mind-beat-lock`, `ee3237170` | 7 commits: the plan through sending detected beats to Natural's groove | Check the plan's items against the commits. Run the rendered checks at 90, 120, and 150 BPM and the D6 arrival-delay measurement. On Linux they were blocked: Electron exited with code 0 on launch, which is environmental and not caused by the branch. Then the ADR and docs if missing, the rebase onto `main`, the gate, and the PR |
| CM6b1 glances | `luke/feat/character-mind-glances-1`, `1727104cb`; WIP on `luke/wip/cm6b1-cue-gestures`, `4ec56c6fe` | The plan, items 1 to 3 (named glance sources, the priority arbiter, chat activity in the mind). Item 3's verify result is unknown | The WIP holds part of item 4: ACT cue gestures through the mind (the mind types and `step`, part of the conductor and `Stage.vue`, tests). Rerun verify on item 3, then finish item 4 and the rest of the plan's CM6b1 items, the ADR, the rendered checks, the gate, and the PR. CM5b edits the glance calls in `idle-activities.ts`; whichever PR lands second rebases |
| CM6b2 director on intents | not started | | Starts after CM6a lands. Plan: `.omo/plans/character-mind-glances.md` on `luke/feat/character-mind-glances` |
| CM7 performers | `luke/feat/character-mind-performers`, `051b76027` (plan only) | The plan, approved | CM7a waits for CM6b2 and the sync. Item c6 (the mapping-weights editor) may start any time. Then CM7b, CM7c, and CM7d run in parallel |
| L2 | | | Confirm the observer golden hashes on macOS. The Mac can now do it |

## Resuming a WIP branch

Restore the uncommitted state onto the real branch without a force push:

```sh
git fetch origin
git switch luke/fix/character-mind-gaze-stop-early
git cherry-pick -n origin/luke/wip/cm6a-delay-cut
git reset
```

Commit the work properly, then delete the WIP branch with `git push origin --delete luke/wip/cm6a-delay-cut`. Do the same for `luke/wip/cm6b1-cue-gestures` on `luke/feat/character-mind-glances-1`.

## Notes for the new machine

- Rendered QA on Linux ran through `pnpm qa:display`. On macOS, follow the qa-tools README for the platform.
- The local QA model locations are machine-specific and not in the repository. Ask the owner for them.
- The scratch harnesses from the Linux runs (latency hops, pointer driver, sweep scripts) stayed on that machine. They are not needed to resume.
