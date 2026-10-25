# wave-1-lane-explore-history.md (journaled 2026-10-24T19:07:12.040Z)

st_01a16f20 [completed] transcript via event-log:
tool: find
tool: find
tool: grep
tool: grep
tool: grep
tool: grep
tool: grep
tool: bash
tool: grep
tool: grep
tool: grep
tool: read
tool: read
tool: find
tool: read
tool: bash
tool: grep
tool: read
tool: read
tool: grep
tool: grep
assistant: <results>
<files>
- /C:/Users/Luke/projects/dtuber/packages/stage-ui-live2d/src/composables/live2d/natural-motion/posture.ts - Current continuous posture filter values, comments documenting the tuning and rationale, and current shift/gain constants.
- /C:/Users/Luke/projects/dtuber/packages/stage-ui-live2d/src/composables/live2d/natural-motion/liveliness.ts - Defines the liveliness metrics, including how jitter is calculated.
- /C:/Users/Luke/projects/dtuber/packages/stage-ui-live2d/src/composables/live2d/natural-motion/reference-stats.ts - Recording provenance and measured reference jitter values.
- /C:/Users/Luke/projects/dtuber/packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts - Committed idle-gate metric list, including jitter.
- /C:/Users/Luke/projects/dtuber/.omo/plans/live2d-presence-v2.md - Original filter and gate design, plus the documented failed attempts to normalize jitter.
- /C:/Users/Luke/projects/dtuber/.omo/drafts/live2d-presence-v2.md - Initial controller constants and recording-derived targets.
- /C:/Users/Luke/projects/dtuber/.omo/drafts/live2d-presence-v3.md - Follow-up proposal for duration-comparable jitter scoring.
- /C:/Users/Luke/projects/dtuber/.omo/ulw-research/20261024-181357/brief.md - Current research request, including the complaint about MAGIC-like quick back-and-forth jitter.
- /C:/Users/Luke/projects/dtuber/.omo/ulw-research/20261024-181357/observation-manifest.md - Dated observation of current posture filters and their stated tuning target.
- /C:/Users/Luke/projects/dtuber/.omo/ulw-research/20261024-181357/expansion-log.md - Research lead tying continuous filters to recording-matched jitter.
- /C:/Users/Luke/projects/dtuber/docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md - Recording privacy policy and Natural-motion architecture.
- /C:/Users/Luke/projects/dtuber/docs/ai/adr/2026-10-18-live2d-touch-interaction.md - Says touch tuning started without reference recordings; not evidence for the posture jitter history.
</files>

<answer>
**Repository evidence gives a partial timeline, not the requested commit-by-commit history.** I could not execute the specified `git log`/`git show` commands in this read-only explorer: the available command broker only accepts `gh` and `curl`, and the `gh api` commit lookup returned an empty result. The current files and planning notes do preserve several dated or ordered tuning decisions, but they do not provide the corresponding commit SHAs. I therefore cannot reliably supply commit SHAs or assert that I have found every historical constant change.

What can be established from the checked-in evidence:

- **Initial v2 design — 2026-10-17:** `/C:/Users/Luke/projects/dtuber/.omo/plans/live2d-presence-v2.md:315-336` specifies continuous OU posture SDs `(0.012, 0.010, 0.005)`, tau `(0.20, 0.24, 0.32)`, and filters `(0.07, 0.08, 0.10)`. The desk liveliness gate was designed to include jitter among several reference-comparison metrics. `/C:/Users/Luke/projects/dtuber/.omo/plans/live2d-presence-v2.md:172-175` says reference-backed bands were widened only as needed for both recordings; provisional jitter was set from the 18-minute recording at 0.6–1.6 times its measured value. These are plan records, not verified commit diffs.

- **Jitter definition and normalization attempt — plan history, date not recorded in the cited lines:** `/C:/Users/Luke/projects/dtuber/.omo/plans/live2d-presence-v2.md:156-159` defines jitter as head power above 5 Hz divided by total power. Todo 20 proposed dividing by power above approximately 0.2 Hz instead, to reduce dilution by the 90-second drift and make a 600-second window comparable to a 30-minute gate (`:792-803`). The recorded outcome says the proposed band-limited metric made the controller’s >5 Hz share about **2.3×** the recordings’, while 600-second per-seed spread was **3.4–3.9×**, exceeding the **2.67×** band for all tested cutoff edges; it turned the node gate red, so the attempt was reverted. The plan points to the attempted patch at `.omo/evidence/live2d-presence-v2/task-20-attempt1.patch`, but that evidence file was not located in this search. No SHA is available in the accessible evidence.

- **Later continuous-filter tuning — current source, exact date/commit not established:** `/C:/Users/Luke/projects/dtuber/packages/stage-ui-live2d/src/composables/live2d/natural-motion/posture.ts:47-50` says the filter values were tuned from `(0.07, 0.08, 0.10)` to `(0.06, 0.07, 0.09)` on rendered rigs. The stated result is desk-gate detrended head jitter averaging about **2.1e-5**, versus recording values **2.4–2.5e-5**, rather than sitting near the **1.5e-5** band floor. Current tau remains `(0.20, 0.24, 0.32)` and SD remains `(0.012, 0.010, 0.005)`. `/C:/Users/Luke/projects/dtuber/.omo/ulw-research/20261024-181357/observation-manifest.md:5` records this source observation against main at `f5bc5cec7`; that is a repository-state anchor, **not** proof that this commit introduced the tuning.

- **Current gate/reference facts:** `/C:/Users/Luke/projects/dtuber/packages/stage-ui-live2d/src/composables/live2d/natural-motion/reference-stats.ts:1-9` identifies the `shuka-vts-recorder riggold.v2` source sessions and extraction date **2026-10-17**. The measured jitter values are **0.00002448967433782599** and **0.00002536005415467538** (`reference-stats.ts:~150-200`; exact second-session lines were not read). The plan documents the provisional jitter-band rule. I did not retrieve the exact committed jitter band or current jitter calculation lines, so I cannot state its bounds as an independently verified current value.

- **Shift-tail changes, distinct from the continuous-filter tuning:** current `posture.ts:~100-130` comments state that shift amplitude changed from lognormal median `0.22`, log-SD `0.7`, max `0.75` to median `0.18`, log-SD `1`, bounds `0.025–1`. The stated aim was to raise speed-peak log asymmetry toward recordings’ `1.5–2.0` while keeping total power from pushing detrended jitter below its band. Shift duration changed from `0.22 + 0.4*sqrt(distance/0.35)` to `0.35 + 0.25*sqrt(distance/0.35)`: the comment says this flattened peak-speed growth, addressing Bear’s measured `0.79` against a `1.05` floor, and lengthened the minimum to trim shift-driven jitter outliers. Current source lines give the before/after and reasoning, but not dates or SHAs. The v2 plan’s todo 21 separately records a heavier shift-speed tail as a later tuning task (`live2d-presence-v2.md:806-813`).

- **Gate-band changes:** the v2 plan says bands were widened only as necessary to include both reference sessions (`live2d-presence-v2.md:172-175`), while `reference-stats.ts` contains per-metric comments documenting specific widenings. The requested git diffs that would identify which commit changed liveliness gate bands and their exact before/after constants could not be inspected. I found no accessible SHA-linked diff for them.

Cross-validation used keyword searches with variants including `jitter`, `detrend`/`detrended`, `FilteredOu`, `HF`/`high-frequency`, `MAGIC`, `twitch`, `back and forth`, and `reference recording`. The specific “weird back and forth quick jittering” complaint appears in the research brief; the actionable recorded tuning evidence is concentrated in the v2 plan and `posture.ts`. Searches did not identify a memory-style note that adds a dated, SHA-backed constant history. `MAGIC` references in the drafts mostly describe preserving the separate MAGIC driver, not a change to Natural’s filters.

**Bottom line:** the notes support a clear tuning rationale—raise generated high-frequency energy toward recording measurements, then pursue more comparable scoring, while controlling shift-driven power and speed tails—but the exact dated commit sequence, SHAs, and gate-band diffs remain unverified because Git history access was unavailable.
</answer>

<next_steps>
Run the requested Git history and diff commands in the parent session’s shell to recover exact commit dates, SHAs, and gate-band before/after values. The best lead is the v2 tuning ledger and its referenced `task-20-attempt1.patch`; the normalization attempt is a dead end for adoption because its documented seed spread exceeded the proposed band and made the node gate fail.
</next_steps>
</results>

## EXPAND
- LEAD: Inspect `git log`/`git show` for `posture.ts` and the task-20 evidence patch - WHY: source comments and the v2 plan reveal filter and shift tuning rationales but do not tie them to commits - ANGLE: reconstruct the complete before/after constants and distinguish reverted jitter normalization from landed rendered-filter changes.
- DEAD END: Adopt the proposed >5 Hz / >~0.2 Hz jitter denominator as-is - WHY: the recorded trial found about 2.3× reference high-frequency share and 3.4–3.9× per-seed spread versus a 2.67× band, causing the node gate to fail - ANGLE: any revival needs a redesigned duration/multi-capture statistic and identical re-extraction of both reference sessions.
</results>
