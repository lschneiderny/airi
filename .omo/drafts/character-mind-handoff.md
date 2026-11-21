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
| CM6a close-out | `luke/fix/character-mind-gaze-stop-early`, `cfd603522`; WIP on `luke/wip/cm6a-delay-cut`, `16a4f4d4c` | The stop-early rule with tests; window bounds sent only on change | The WIP holds the unfinished cursor delay cut (main-process screen and window services, the Linux desktop bridge, `use-electron-mouse`, `MMD.vue`); it is not verified. Then: measure the latency before and after, run the perf check, run the rendered press check (plan section 8 step 5), write the gaze ADR amendment, roadmap row, and plan status, then the gate and the PR. The latency figures (about 172 ms) were measured on Linux KDE; re-baseline on macOS |
| CM5b beat lock | `luke/feat/character-mind-beat-lock`, `ee3237170` | 7 commits: the plan through sending detected beats to Natural's groove | Check the plan's items against the commits. Run the rendered checks at 90, 120, and 150 BPM and the D6 arrival-delay measurement. On Linux they were blocked: Electron exited with code 0 on launch, which is environmental and not caused by the branch. Then the ADR and docs if missing, the rebase onto `main`, the gate, and the PR |
| CM6b1 glances | `luke/feat/character-mind-glances-1`, `7f239f4d1` (the WIP branch is folded in and deleted) | The plan, items 1 to 5 (named glance sources, the priority arbiter, chat activity and ACT cue gestures in the mind, the agent rule) | The headless runs base against tip, the rendered checks, items 6 and 7 (the ADR, roadmap, and plan status), the rebase onto `main`, the gate, and the PR. Item 3 moved the `speak` scenario (an unfold now reads), so `speak` joins item 2's expected differences. CM5b edits the glance calls in `idle-activities.ts`; whichever PR lands second rebases |
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
