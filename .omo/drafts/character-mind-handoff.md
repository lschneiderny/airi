# Character mind handoff, final state (2026-11-22)

Every character mind slice has landed on `main`. This note now records the end state and the follow-ups the QA pass left open; delete it once those follow-ups have homes of their own.

## Owner rulings

- D16 (CM6a): stop early, cut the cursor delay, rerun the press check; gait unchanged. 2026-11-21: the sidestep without a turn was approved (#73) and a shorter brake was declined.
- CM5b D1 to D7, CM6b D1 to D11, CM7 D1 to D12: approved as recommended.
- CM8 D2 (2026-11-21): touch changes only under Natural; Universal, MAGIC, and classic keep upstream's touch as shipped, so overlap 11 stays recorded as kept for them.
- The owner's standing preference: take the recommended option at a decision point and record it.

## Landed

| Slice | PR | Acceptance |
| --- | --- | --- |
| CM6a close-out, sidestep | #70, #73 | Nine headless scenarios `IDENTICAL`; after a 4 s rest every press pokes |
| CM6b1 glances | #69 | Gate green |
| CM5b beat lock | #71 | Gate green |
| c6 mapping weights editor | #72 | Settings window lists the stage's mapped expressions |
| CM6b2 director on intents | #74 | Nine scenarios `IDENTICAL`; rendered clip endings under Natural and classic |
| S2 store tiers | #75 | Relaunch 0 follower errors; "Delete all data" clears every key |
| CM7a performers declare capabilities | #76 | Ten scenarios `IDENTICAL`; four rendered modes pass |
| CM7d Live2D channel owners | #77 | Ten scenarios `IDENTICAL`; Live2D rig hash unchanged |
| CM7b seeded picks and reports | #78 | Ten scenarios `IDENTICAL`; rig hash unchanged |
| CM7c character-behavior document | #79 | Ten scenarios `IDENTICAL`; rendered checks 7 to 9 pass |
| CM8 touch and notices | #80 | Ten scenarios `IDENTICAL`; rig hash unchanged; six rendered checks pass |

## QA pass on `main` `c2799922f`

- `pnpm test:run`: 89 of 89 tasks.
- Headless, seed 1: all ten scenarios (`idle`, `idle-drive`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, `touch`, `music`) `IDENTICAL` against the pre-CM7a base.
- `pnpm qa:live2d-rig`: `sha256` unchanged.
- `pnpm qa:smoke` on the window and desktop stage hosts: 0 renderer and 0 main-process errors.
- Every slice's own `pnpm verify --gate` passed on the tree that landed.

Fixed during the pass, each on `main`: the settings-window mapping editor (#72); follower windows calling leader actions before owner registration (#75); mapping-weight rows naming their emotions (`3e87520bf`); two load-flaky `stage-ui` browser tests made deterministic (`2df3ddecf`), and the two MMD motion lab locomotion tests made to await the lab snapshot (`396265d28`); QA `configure` accepting every driver (`72825bf7e`); windows exchanging server-channel tokens after "Delete all data", which restarted the channel thousands of times (`691d4cbe4`); light-mode slider fill and settings breadcrumb contrast (`a0d4a050f`).

## Open follow-ups

- **Load-flaky browser test:** `stage-emotion-routing` "keeps presence idle ... shows no placeholder" failed once under a loaded gate and never again, even with 40 CPU burners. It needs a captured failure: dump `history.container.innerHTML`, the session messages, and `chat.activeTurns` at that assertion when it next fails.
- **MMD has no motion QA capture**, so glances and upstream playback under Universal and classic are covered by Node and browser tests, not rendered evidence.
- **`masked-by-clip`** is supported and tested but no renderer produces it; `masked-by-manual` was not demonstrated rendered.
- **Harness gaps:** the QA harness cannot stage an MMD drag, the director's walk to a chat window, or an old-profile import (sessions do not keep localStorage across launches).
- **CM6a presses** within about 2 s of the pointer landing can miss while she brakes (owner ruling: keep).
- **`pnpm verify --gate` did not rebuild `core-agent`** before lab-tools ran, so a stale git-ignored build failed CM8's first gate; rebuild `core-agent` after runtime changes until verify does it.
- **Touch after touch-off:** a new press-and-rub is still classified as a pet by the scene (the mind ignores it; predates CM8). The devtools forced "Evaluate now" can start a reach-out while a notice waits.
- **`qa:bench` is Linux-only**, so gait performance is unmeasured on macOS.

## Notes for the next machine

- `.env.qa` in the main checkout sets `AIRI_QA_MMD_MODEL`, `AIRI_QA_RIG_FORBOOTH`, `AIRI_QA_CUBISM_CORE`, and `AIRI_QA_MMD_CLIP`; copy it into new worktrees.
- macOS rendered QA uses the real desktop; cursor warps need no permission.
