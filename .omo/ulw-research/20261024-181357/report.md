# Corner VTuber motion: jitter cause and fixes

## Answer first
- **The quick back-and-forth comes from one layer:** Natural's continuous head-noise layer (an independent per-axis filtered Ornstein-Uhlenbeck process) [S1]. Turning it off drops side-to-side quick reversals from 1.52/s to 0.05/s (MEASURED, 3 seeds x 600 s), and it is 99.7% of head power above 5 Hz (MEASURED). It is not inherited from MAGIC; Natural reuses no MAGIC code or data.
- **It is the wrong shape of motion, not too much motion.** Against Luke's own desk recordings (7525 s, MEASURED), Natural reverses yaw 3.5x as often (1.52 vs 0.44/s), while the recordings carry about 4x the slow 0.5-1 Hz drift (2.61 deg2 MEASURED) and about a fifth of the power above 5 Hz (gate protocol at 30 Hz: 0.00026 vs 0.00126 deg2, MEASURED).
- **The liveliness gate currently enforces the wiggle.** Every smoothing setting that halves reversals fails it. The best reshaping found (slower continuous layer, human-like holds, slow activity spells with a 120 s time constant) cuts reversals to 1.46x the recordings, from 3.85x under the same gate protocol (MEASURED, simulation; the 3.5x above is a different protocol, see 5b) and passes the stillness checks at the median of 3 seeds, but fails two gate bands that were set by a rough 0.6-1.6x / 0.7-1.4x rule. The motion and those two bands have to change together.
- **Variety will not come from more randomness.** Doubling noise or amplitude leaves window-to-window variety flat, and doubling event rate lowers it (MEASURED, simulation). Luke's head changes activity level every 20-60 s (MEASURED), and Natural's minute-to-minute variety is about a fifth of his (0.10-0.17 vs 0.78 CV, MEASURED). Activity spells on posture shifts lift it to 0.45 (MEASURED, simulation).
- **Not covered here:** reactions to the cursor, touch, desktop activity and speech were not assessed in this run (see the goal status table).
- **Exaggeration is a targeted tool.** It raises perceived intensity [S61] and distinctness [S63], but cartoon characters were rated better with damped motion [S60]. Use it on the cues that distinguish emotions (posture, timing, mouth/brow) and only after the jitter is gone (inference: exaggeration filters amplify fast motion [S68]).

## 1. The jitter
| Test (Natural idle, median of 3 seeds) | Yaw quick reversals/s (>=0.25 deg) | Gate |
|---|---|---|
| Current baseline | 1.52 | pass |
| Continuous head noise off | 0.05 | fails low |
| Posture shifts off | 1.75 | fails high |
| Output filter 0.25 s | 0.68 | fails low |
| Noise time constant x3 | 0.78 | fails low |
| Luke's recordings | 0.44 | reference |


<figure style="width:100%;max-width:680px;margin:1rem 0">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 248" width="100%" role="img" aria-label="Yaw quick reversals per second by setting"><text x="320" y="18" text-anchor="middle" font-size="14" font-family="sans-serif">Yaw quick reversals per second (>=0.25 deg, MEASURED)</text><text x="182" y="48" text-anchor="end" font-size="12" font-family="sans-serif">Natural baseline</text><rect x="190" y="35" width="370.5" height="20" fill="#2a6fdb"/><text x="566.5" y="49" font-size="12" font-family="sans-serif">1.52/s</text><text x="182" y="82" text-anchor="end" font-size="12" font-family="sans-serif">Head noise off</text><rect x="190" y="69" width="12.2" height="20" fill="#2a6fdb"/><text x="208.1875" y="83" font-size="12" font-family="sans-serif">0.05/s</text><text x="182" y="116" text-anchor="end" font-size="12" font-family="sans-serif">Output filter 0.25 s</text><rect x="190" y="103" width="165.8" height="20" fill="#2a6fdb"/><text x="361.75" y="117" font-size="12" font-family="sans-serif">0.68/s</text><text x="182" y="150" text-anchor="end" font-size="12" font-family="sans-serif">Noise time constant x3</text><rect x="190" y="137" width="190.1" height="20" fill="#2a6fdb"/><text x="386.125" y="151" font-size="12" font-family="sans-serif">0.78/s</text><text x="182" y="184" text-anchor="end" font-size="12" font-family="sans-serif">Luke recordings</text><rect x="190" y="171" width="107.3" height="20" fill="#888"/><text x="303.25" y="185" font-size="12" font-family="sans-serif">0.44/s</text><text x="190" y="218" text-anchor="middle" font-size="11" font-family="sans-serif">0.0</text><text x="287.5" y="218" text-anchor="middle" font-size="11" font-family="sans-serif">0.4</text><text x="385" y="218" text-anchor="middle" font-size="11" font-family="sans-serif">0.8</text><text x="482.5" y="218" text-anchor="middle" font-size="11" font-family="sans-serif">1.2</text><text x="580" y="218" text-anchor="middle" font-size="11" font-family="sans-serif">1.6</text><text x="385" y="232" text-anchor="middle" font-size="11" font-family="sans-serif">reversals per second</text></svg>
<figcaption>Figure 1. Side-to-side quick reversals per second in Natural idle settings versus Luke's desk recordings (MEASURED; Natural: median of 3 seeds x 600 s; recordings: 7525 s pooled). Every setting below the baseline fails the liveliness gate's jitter floor.</figcaption>
</figure>

- Posture shifts are not the cause; they carry the slow, large moves [S1].
- Smaller contributors: eye counter-rotation mirrors the wobble into the eyes at about 0.1 deg (DERIVED); the unfiltered mouth and lid noise flickers at 11.8 and 15.6 reversals/s with tiny amplitude (MEASURED). Hair physics does not amplify the wobble (output RMS ratio 0.997, MEASURED).
- The over-reversal is a small-amplitude effect: at >=1 deg Natural is only 1.3x the recordings (MEASURED).
- The gate's stillness limits are not a tracker frame-noise floor: smoothing the recordings changed still05 by under 1 percentage point (MEASURED). Luke's head is almost always moving a little; slow tracker drift was not ruled out.
- MAGIC jitters for its own reason: it adds a resampled training residual on every 30 Hz step to a 0.67 s context (DERIVED from code), with no minimum gesture length.

## 2. Variety
- Natural already switches energy by mode (idle, watching, listening, thinking, talking). What it lacks is spells of calm and restlessness lasting tens of seconds to about a minute, and a few named multi-second acts with a start, a return and a long cooldown.
- A real head is mostly in motion with short holds (57% of frames above 2 deg/s, MEASURED), so the corner model should not freeze; but discrete acts in companions people live with are rare: Shimeji-ee weights a repeat of its sitting pose at about 98% of transitions (DERIVED from its weights) [S33] [S47], VPet does nothing on about 55% of idle ticks at its minimum setting (DERIVED) [S34] [S48], and an Ukagaka ghost checks every 15 s and changes pose 1 time in 4 [S49].
- Viewers are poor at spotting repeated low-level motion [S44]; a recognizable act is different, so over hours a frequent stretch is likely to read as a tic (inference, not a finding). Keep 2-3 acts with cooldowns of minutes, only during long idle.
- One idle-motion paper warns that independent per-joint noise misses the coupling between joints [S55]; believable systems layer noise under weighted behavior choice [S54].
- Each emotion clip plays the same shape every time, and its side is drawn separately from the held tilt, so they can contradict. Emotions are naturally shown through several patterns [S64]: give each 2-3 variants and one side per episode.

## 3. Emotion and exaggeration
- The face carries the emotion; the head clips peak near idle amplitude and idle keeps running underneath, so the head adds little.
- The clips have no wind-up, little settle, and move in straight lines rather than arcs [S71].
- Speed and posture each signal emotion on their own: faster reads happy or angry, slower reads sad [S62]; slumped versus upright posture carries emotion beyond speed [S65].
- No study says how much to exaggerate at small display sizes; test it on the real model.

## 4. Environment and self-driven motion together
- VTube Studio layers idle under one-off animations, expressions and physics, and always fades between them per parameter [S45]. Classic staging guidance favours one clear action at a time [S71] (craft guidance, applied here by inference).
- Natural does the opposite during strong emotion: it raises idle amplitude (x1.27) and shift rate (x1.45) for 2 s (DERIVED from code constants).

- Cursor attention, touch, desktop-activity and speech reactions were outside this run's verification; the cursor and touch handoff is planned and in progress separately on the luke/feat/live2d-cursor-touch branch.

## Status of each goal from the brief
| Goal | Status today | Evidence |
|---|---|---|
| I1 No visible quick back-and-forth | Violated; cause verified in the continuous head layer [S1]; best retune reaches 1.46x the recordings in simulation; visibility at widget size unverified | sections 1, 5b |
| I2 Idle varies over minutes | Violated (about a fifth of Luke's minute-to-minute variety); activity spells verified in simulation | sections 2, 5b |
| I3 Emotion reads at a glance | Partly violated (head adds little, idle not turned down); widget-size readability untested | section 3 |
| I4 Environment and self-driven motion coexist | Partly violated (idle fights emotion clips); cursor, touch, desktop and speech reactions not assessed | section 4 |
| I5 Natural does not reuse MAGIC | True (no shared generator, fit or data) | section 1 |

## 5. Recommendations, in order
1. **Reshape the head idle and re-baseline two gate bands.** Use a slower, smoother continuous layer (time constant x5, output filter x2), hold durations between posture shifts drawn from Luke's measured distribution (median 0.37 s, MEASURED), and a slow activity process that varies shift rate and size (verified at a 120 s time constant; Luke's measured 20-60 s switching is a tuning target, because a 60 s version failed a stillness check in simulation). Set the continuous layer's size to about 1.5x its current value (the sweep's best: x2 in the base arm times 0.74, DERIVED), because the slower layer otherwise moves too little; size is the knob that trades reversals against stillness. This passed both stillness checks at the median of 3 seeds; one seed failed them. Make the jitter metric report-only or derive it from both sessions, and re-derive the speed-peak asymmetry band. Do not add slow steady drift: it matched the slow power but reversed 2.9x too often and never held still (MEASURED).
2. **Turn idle down while an emotion clip or strong attention plays** (posture amplitude and noise gain to about 0.3-0.5 for the clip plus about 0.3 s; ASSUMED starting values).
3. **Rework emotion clips:** short wind-up (about 10-25% of the move, ASSUMED; none for startles), arcs, settling on body and secondary parts [S69], one side per episode, 2-3 variants, per-emotion speed and posture.
4. **Add at most 2-3 named acts** (for example a settle or a look-around) with cooldowns of minutes, only during long idle and never during speech or cursor attention. The activity spells belong to recommendation 1.
5. **Smooth the mouth and lid noise** (a 0.3 s low-pass cut mouth reversals from 11.8 to 0.94/s, MEASURED) and limit eye counter-rotation to real head moves.
6. **Ration exaggeration:** per emotion and channel, after the jitter fix, tested at 0.8x, 1.0x and 1.3x (ASSUMED ladder) at widget size, with a one-hour annoyance check.

## 5b. Retune results (simulation, head angle only)
These runs use the gate's own protocol (desk home, 30 Hz, 1800 s scored), where the baseline reverses 3.85x as often as the recordings; the 3.5x quoted above is the 60 Hz product-home protocol of the first ablation (both MEASURED).

| Setting (all values MEASURED, median of 3 seeds) | Yaw quick reversals vs recordings | Stillness checks | Variety (CV, 60 s) | Gate bands failed |
|---|---|---|---|---|
| Current baseline | 3.85x | pass | 0.10-0.17 | none |
| Slow steady drift added | 2.9x | fail | 0.10-0.17 | 6-8 |
| Smoother layer + human holds (S7) | 1.44x | pass | 0.12 | jitter, 2 speed-peak |
| S7 + activity spells on shifts (R4) | 1.46x | pass at median (1 of 3 seeds fails) | 0.45 | jitter, speed-peak asymmetry |
| Luke's recordings | 1.00x | in band | 0.78 | reference |

The continuous layer, not the posture shifts, produces the small reversals; quieting it too much makes the head too still (0.40-0.56x, MEASURED). Parameters were calibrated and scored on the same 3 seeds; these are directions to implement and then confirm on the rendered rig, not final constants [S1].

## 6. Decisions for Luke
- Approve changing the liveliness gate, which currently enforces the wobble.
- Confirm the hold stillness by eye within the measured bands: people differ sharply in how much motion noise they like [S59].
- Watch a widget-size side-by-side of the current motion and the retuned one; nobody could judge visibility headlessly.

## 7. What is still unknown
- Whether 0.25-0.5 deg (MEASURED range of the excess) reversals are visible at widget size; no perceptual threshold for head jitter was found [S56].
- Whether the recorded fast head content is tracker noise or real micro-motion.
- How to scale exaggeration with display size; the studies used central-vision faces [S60] [S61].
- Direct user opinion on what makes a corner companion pleasant or annoying (review sites blocked collection); only engine behavior was read [S33] [S34].

## How this report was made
- An 8-member research team covered idle code, emotion code, MAGIC lineage, animation principles, VTuber/mascot practice, procedural-idle research, emotion exaggeration, and a skeptic, plus five web/code lanes in wave 1 and two verification waves: wave 2 refuted slow steady drift, and wave 3 measured the human step and activity-spell structure and found the best reshaping.
- Contested claims were debated with the skeptic and settled by execution: an 11-arm ablation of the real motion code, an independent simulation, a headless physics run on a real rig, and an analysis of Luke's recordings (aggregates only; raw data stayed private).
- Verification overturned five claims: posture shifts as the jitter source, the recordings' stillness as a tracker frame-noise floor (drift not ruled out), more randomness as a route to variety, slow steady drift as the fix, and quiet noise plus larger steps as the fix.
- Web collection was text-only; several papers were read at abstract level because publisher pages were blocked. Craft and practice sources are labeled as such.

## Sources
1. packages/stage-ui-live2d/src/composables/live2d/natural-motion/posture.ts (code; used for A1; accessed 2026-10-24)
2. docs.live2d.com/en/cubism-editor-tutorials/motion-hint/ (primary doc; used for A5 natural vs robotic; accessed 2026-10-24)
3. docs.live2d.com/en/cubism-sdk-manual/breath/ + CubismBreath.cpp (primary doc+code; used for A5 breath cycles; accessed 2026-10-24)
4. github.com/Live2D/CubismNativeFramework src/Effect/CubismEyeBlink.cpp (primary code; used for A5 blink; accessed 2026-10-24)
5. github.com/Live2D/CubismNativeFramework src/Math/CubismTargetPoint.cpp (primary code; used for A5 look-at speed cap; accessed 2026-10-24)
6. docs.live2d.com/en/cubism-editor-manual/about-fade/ (primary doc; used for A5 fades; accessed 2026-10-24)
7. docs.live2d.com/en/cubism-editor-manual/physical-operation-setting/ (primary doc; used for A5 physics; accessed 2026-10-24)
8. theorangeduck.com/page/spring-roll-call (practitioner primary; used for A6 springs; accessed 2026-10-24)
9. theorangeduck.com/page/fitting-code-driven-displacement (practitioner primary; used for A6 halflife; accessed 2026-10-24)
10. lilys.ai/ar/notes/1049760 (Rosen GDC 2014 transcript) (transcript (secondary); used for A4/A6 springs, anticipation; accessed 2026-10-24)
11. lilys.ai/it/notes/791665 (Eiserloh GDC 2016 transcript) (transcript (secondary); used for A6 noise vs jitter; accessed 2026-10-24)
12. blog.kenperlin.com/?p=7640 (author primary; used for A6 noise; accessed 2026-10-24)
13. docs.rs/bevy 2d_screen_shake.rs (code; used for A6 trauma shake constants; accessed 2026-10-24)
14. kybernetik.com.au/animancer/docs/samples/.../3d-game-kit/idle/ (shipped sample docs; used for A5 idle variety; accessed 2026-10-24)
15. mocaponline.com/blogs/mocap-news/idle-animation-game-dev-guide (vendor blog; used for A5 idle timings; accessed 2026-10-24)
16. charios.com/blog/idle-blend-tree-2d-character (vendor blog; used for A5 idle timings; accessed 2026-10-24)
17. gamedeveloper.com Rain World ecosystem article (press; used for A4 procedural bodies; accessed 2026-10-24)
18. unity.com/blog/exploring-procedural-design-rain-world (press/interview; used for A4 procedural; accessed 2026-10-24)
19. devblog.heisarzola.com/gdcr-juice-it-or-lose-it/ (secondary summary; used for A4 juice; accessed 2026-10-24)
20. momsbasementuniversity.com easing-smoothstep-and-damping (tutorial; used for A6 spring cross-check; accessed 2026-10-24)
21. ikimotion.com/docs/tutorials/idle-animation/ (tutorial; used for A5 idle amplitude; accessed 2026-10-24)
22. blog.animschool.edu/2024/06/14/breathing-life-into-idle-animations/ (instructor blog; used for A5 idle variation; accessed 2026-10-24)
23. charios.com/blog/breathing-cycle-2d-character/ (vendor blog; used for A5 breathing; accessed 2026-10-24)
24. shiroikarasu.net/live2d-idle-motion-guide-2026/ (practitioner blog (JP); used for A5 idle sway; accessed 2026-10-24)
25. live2dnote.com Clean Communication of Motion Intent (practitioner; used for A4/A5 purposeful motion; accessed 2026-10-24)
26. github.com/DenchiSoft/VTubeStudio/wiki/VTS-Model-Settings (official manual; used for A5 smoothing tradeoff; accessed 2026-10-24)
27. note.com/frusumi/n/n6c7553219af8 (creator guide; used for A5 smoothing; accessed 2026-10-24)
28. saraemi.com/en/2025/11/17/vts_tracking/ (rigger blog; used for A5 blink smoothing; accessed 2026-10-24)
29. gery.casiez.net/1euro/ (author primary; used for A6 adaptive filter; accessed 2026-10-24)
30. pmc.ncbi.nlm.nih.gov/articles/PMC3565584/ (peer-reviewed; used for A6 blink interval; accessed 2026-10-24)
31. pmc.ncbi.nlm.nih.gov/articles/PMC10466800/ (peer-reviewed review; used for A6 blink kinematics; accessed 2026-10-24)
32. github.com/Live2D/CubismWebSamples @b1de66b lappmodel.ts (primary code; used for A5 layered effects + random idle; accessed 2026-10-24)
33. github.com/TigerHix/shimeji-ee @22158a9 conf/CalmBehavior.xml, Manager.java (primary code; used for A5 weighted behavior graph; accessed 2026-10-24)
34. github.com/LorisYounger/VPet @0c2e795 MainLogic.cs, MainDisplay.cs (primary code; used for A5 activity picker; accessed 2026-10-24)
35. github.com/pixiv/three-vrm @3caf7a2 VRMLookAt.ts (primary code; used for A6 gaze constraint; accessed 2026-10-24)
36. .omo/evidence/live2d-presence-v2/task-14-tuning-log.md (first-party evidence; used for A3 tuning rationale; accessed 2026-10-24)
37. .omo/plans/live2d-presence-v2.md:156-175,315-336,792-813 (first-party plan; used for A3 gate design; accessed 2026-10-24)
38. cs.cmu.edu/~kiesler/publications/2013/2013_perceptual-effects-facial.pdf (peer-reviewed (abstract); used for A7 exaggeration; accessed 2026-10-24)
39. cs.cmu.edu/~kiesler/publications/2014/2014_assessing-naturalness.pdf (peer-reviewed (abstract); used for A7 exaggeration; accessed 2026-10-24)
40. dl.acm.org/doi/full/10.1145/3706598.3713688 (CHI 2025) (peer-reviewed (abstract); used for A7 exaggeration; accessed 2026-10-24)
41. doi.org/10.25394/pgs.9108635.v1 (Purdue thesis) (thesis; used for A7 counter-evidence; accessed 2026-10-24)
42. link.springer.com/article/10.1007/s10055-025-01238-6 (peer-reviewed (abstract); used for A7 stylization x intensity; accessed 2026-10-24)
43. files.commons.gc.cuny.edu SAP 2023 technical communications (peer-reviewed (abstract); used for A7 recognition vs realism; accessed 2026-10-24)
44. McDonnell et al. Clone Attack! SIGGRAPH 2008 (peer-reviewed (cited); used for A6 motion variety perception; accessed 2026-10-24)
45. github.com/DenchiSoft/VTubeStudio/wiki/Interaction-between-Animations,-Tracking,-Physics,-etc. (vendor docs; used for A5 provider priority + smooth fades; accessed 2026-10-24)
46. github.com/DenchiSoft/VTubeStudio/wiki/VTS-Model-Settings (vendor docs; used for A5 smoothing vs lag; accessed 2026-10-24)
47. raw.githubusercontent.com/gil/shimeji-ee/master/conf/CalmBehavior.xml (source code; used for A5 weighted graph 100:1:1; accessed 2026-10-24)
48. raw.githubusercontent.com/LorisYounger/VPet/main/VPet-Simulator.Core/Display/MainLogic.cs (source code; used for A5 die-roll idle, most ticks nothing; accessed 2026-10-24)
49. ukagaka.zichqec.com/function/Idle_between_dialogues.txt (practitioner script; used for A5 15 s cadence RAND(4); accessed 2026-10-24)
50. ikimotion.com/docs/tutorials/idle-animation/ (tutorial; used for A5 +-5 deg head of 30; accessed 2026-10-24)
51. note.com/makotok1/n/nad6a9605bac8 (practitioner blog; used for A5 loop seam, head lags body 2 frames; accessed 2026-10-24)
52. gamedev.stackexchange.com/questions/134333 (forum; used for A5 LCM of periods; accessed 2026-10-24)
53. docs.live2d.com/en/cubism-editor-tutorials/motion-hint/ (vendor tutorial; used for skeptic R3: liveliness via hold contrast; adult chars do not wobble; accessed 2026-10-24)
54. mrl.cs.nyu.edu/~perlin/improv-paper/ (peer-reviewed (primary); used for A6 Improv: noise layer + weighted behavior selection; viewers perceive statistics; accessed 2026-10-24)
55. dspace.library.uu.nl Egges 2004 idle motion (peer-reviewed (primary); used for A6 per-joint noise misses inter-joint dependency; PCA + balance shifts; accessed 2026-10-24)
56. graphics.cs.wisc.edu/Papers/2014/RABPBGMM14/STAR_Eyes_Final.pdf (survey (secondary); used for A6 eye-head thresholds, VOR; accessed 2026-10-24)
57. gery.casiez.net/publications/CHI2012-casiez.pdf (peer-reviewed (primary); used for A6 1 Euro filter jitter vs lag; accessed 2026-10-24)
58. www0.cs.ucl.ac.uk Vinayagamoorthy 2004 (peer-reviewed (secondary for Lee); used for A6 inter-saccadic intervals 1.6-2.5 s; accessed 2026-10-24)
59. publications.ri.cmu.edu Bodenheimer 1999 (peer-reviewed (primary); used for A6 noise preference bimodal; accessed 2026-10-24)
60. graphics.cs.cmu.edu/projects/poafe/ (Hyde 2013) (peer-reviewed (abstract); used for A7 cartoon benefits from damped motion; accessed 2026-10-24)
61. europepmc PMID 12974567 (Pollick 2003) (peer-reviewed (abstract); used for A7 exaggeration raises intensity; accessed 2026-10-24)
62. pmc.ncbi.nlm.nih.gov/articles/PMC8582590/ (Emotion 2021) (peer-reviewed (primary); used for A7 speed is an emotion cue; accessed 2026-10-24)
63. pmc.ncbi.nlm.nih.gov/articles/PMC9017061/ (Furl 2022) (peer-reviewed (primary); used for A7 caricature distinctness; accessed 2026-10-24)
64. europepmc PMID 22059517 (Dael 2012) (peer-reviewed (abstract); used for A7 multiple body patterns per emotion; accessed 2026-10-24)
65. europepmc PMID 21835480 (gait 2011) (peer-reviewed (abstract); used for A7 posture beyond speed; accessed 2026-10-24)
66. graphics.cs.cmu.edu chi00emote.pdf (EMOTE 2000) (peer-reviewed (primary); used for A7 Effort/Shape -1..+1; accessed 2026-10-24)
67. europepmc PMID 24374019 (Piwek 2014) (peer-reviewed (abstract); used for A7 motion does not deepen uncanny; accessed 2026-10-24)
68. microsoft.com/en-us/research/publication/the-cartoon-animation-filter/ (peer-reviewed (abstract); used for A4 Wang 2006 filter: inverted smoothed acceleration; accessed 2026-10-24)
69. haotianblog.com/en/spring-secondary-motion-2d-en/ (practitioner blog; used for A4 damped springs f/zeta, teleport reset; accessed 2026-10-24)
70. theorangeduck.com/page/spring-roll-call (practitioner (expert); used for A4 framerate-independent springs; accessed 2026-10-24)
71. frankanollie.com/PhysicalAnimation.html (craft (primary authors); used for A4 follow-through, twos, traced realism stiff; accessed 2026-10-24)
72. en.wikipedia.org/wiki/Limited_animation (encyclopedia; used for A4 holds and reuse; accessed 2026-10-24)
