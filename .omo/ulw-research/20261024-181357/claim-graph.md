# Claim graph

## verified-claims
(none yet)

## Nodes

### C1
- statement: Natural's visible quick back-and-forth head jitter comes largely from the continuous filtered-OU head component, tuned up to satisfy a >5 Hz head-power floor in the liveliness gate calibrated on performer recordings.
- type: causal (code) · risk: high · scope: Natural driver idle head · intents: I1, I5
- supporting: O1, O7, idle-code history (filters 0.07/0.08/0.10 -> 0.06/0.07/0.09)
- contradicting: (none yet) · groups: member-idle-code, lead-scoping
- convergence: pending second independent group (explore lane, magic-lineage) · counter-search: skeptic attack sent 2026-10-24T18:17:46.177Z
- primary: posture.ts, liveliness gate code · status: unresolved (needs Phase 4 spectral verification)


### C2
- statement: MAGIC's jitter is not from missing smoothing in the display path (EMA filter, cutoff 0.0575, smoothing 0.8, enabled by default); it comes from the generator's noise and 30 Hz stepping without interpolation.
- type: causal (code) · risk: normal · intents: I5 · supporting: magic-lineage driver.ts/filter.ts observation · status: partial (awaiting consolidated report)


### C1 (update 2026-10-24T18:48:25.916Z)
- status: partial (debate R1). Causal attribution to the OU unproven; ablation lane verify-jitter-ablation dispatched.

### C1a
- statement: The liveliness gate's jitter band has a nonzero FLOOR (1.469e-5 share of >5 Hz power), so smoother-than-recording head motion FAILS the gate; the reference is VTS model parameters from one performer, irregular 27-28 Hz, linearly interpolated to 30 Hz, so its >5 Hz content is dominated by tracking/smoothing/interpolation artifact.
- type: code fact + methodological · risk: high · intents: I1
- supporting: magic-lineage (reference-stats.ts:259-262, export-riggold-trace.py:25-34), idle-code (gate floor), skeptic (memory note dtuber-motion-recordings: VTS params, 27-28 Hz) · groups: member-magic-lineage, member-idle-code, member-skeptic (3)
- counter-search: skeptic found no ablation or perceptual justification for the floor · primary: reference-stats.ts, liveliness.ts · status: supported (code fact); artifact share is partial pending interpolation test

### C3
- statement: Posture shifts (new shift ~every 2.4 s, median ~6 deg yaw, isotropic direction, r -> 0.7 r + step, min-jerk 0.35-0.6 s) produce frequent direction reversals and are a larger candidate source of visible back-and-forth than the continuous OU.
- type: causal (code) · risk: high · intents: I1 · supporting: skeptic analysis of posture.ts · status: unresolved (ablation pending)

### C4
- statement: Eye-head counter-rotation (eye = gaze - K h, K = 0.31/0.40) mirrors head wobble onto the pupils, which on a 2D rig read as darting even when head motion is small.
- type: causal (code + perceptual) · risk: normal · intents: I1 · supporting: skeptic (gaze.ts) · status: unresolved (ablation + Luke A/B)

### C5
- statement: Official Live2D guidance: face-only or face+body-simultaneous motion reads robotic; body should follow later; motion should overshoot or brake rather than stop instantly; blink accompanies head/eye turns; and the official breath sample layers non-commensurate sines (6.53/3.53/5.53/15.53 s) with weight 0.5 so motion rarely repeats.
- type: documentary · risk: normal · intents: I2, I4 · supporting: docs.live2d.com motion-hint, CubismBreath.cpp · groups: lane-web-live2d-docs · status: supported (primary)

### C6
- statement: Game-dev practice treats per-frame random noise as jitter ("infinite frequency") and uses time-driven coherent noise with chosen frequency plus spring/damper smoothing (critical spring, halflife tuning); overshoot/follow-through comes from under-damped springs or reusable anticipation/overshoot curves.
- type: practice · risk: normal · intents: I1, I3 · supporting: theorangeduck.com, lilys.ai Rosen + Eiserloh transcripts, blog.kenperlin.com · groups: lane-web-gamedev · status: partial (secondary transcripts; needs second group)


### C1a (update 2026-10-24T19:07:12.040Z)
- supporting adds: task-14-tuning-log.md Attempt 2 C (magic-lineage), v2 plan 156-175 (explore lane), git history (verify-git-history.md). Groups now: member-magic-lineage, member-idle-code, lane-explore-history, member-skeptic (4). status: supported for "Natural was intentionally de-smoothed to hit a >5 Hz power target with a nonzero floor"; "the target is mostly tracker artifact" stays partial.

### C7
- statement: Emotion readability/variety gaps in code: (a) the per-model emotion-strength slider scales only held channels, not entry gesture clips or impulses; (b) a repeated emotion within 15 s habituates 0.6 -> 0.48 (slight), dropping gesture, head, glance and energy, and a repeat inside 2 s at <= nominal yields no new episode; (c) the emotion gate ignores posture visibility, so passing it does not prove a gesture reads over idle; (d) sad, think, question, curious have no gesture clip; strong body follow is yaw/roll only.
- type: code fact · risk: normal · intents: I3 · supporting: emotion-code (hold.ts:109-131, pending-actions.ts:74-84, reaction-strength.ts:60-75, emotion-score.ts:1228-1235, gestures.ts) · status: supported (single code group; code facts) - skeptic pass pending

### C8
- statement: Reference companions build idle variety from discrete activity selection layered over continuous effects: Cubism sample = layered non-commensurate breath sines + random pick from authored Idle motions; Shimeji-ee = weighted behavior graph (Frequency weights, NextBehavior); VPet = 15 s event timer drawing move/idle/sleep/interaction outcomes with randomized loop counts. None of them generates continuous high-frequency noise.
- type: practice (code) · risk: normal · intents: I2 · supporting: repo-dive (SHA-pinned), live2d-docs lane (CubismBreath), gamedev lane (Unity Game Kit idle timer) · groups: lane-repo-dive, lane-web-live2d-docs, lane-web-gamedev (3) · status: supported

### C9
- statement: Practitioner idle guidance: small amplitude (~5 deg of a +-30 head range), body below head, avoid exact periodicity/linear/in-sync parts, offset timings, slow independent sway layer, macro variations over 3-6 loops, natural asymmetry; motion should look purposeful.
- type: practice · risk: normal · intents: I1, I2 · supporting: ikimotion.com, blog.animschool.edu, charios.com, live2dnote.com, shiroikarasu.net, docs.live2d.com motion-hint · groups: lane-web-forums, lane-web-live2d-docs (2) · status: supported (tutorial-grade, no perceptual study)

### C10
- statement: Human blinks: mean interval ~6 s during video viewing with high variability (CV ~1.1), close phase faster than open (~2x), occlusion 40-200 ms, clustered at low-information moments.
- type: empirical · risk: normal · supporting: PMC3565584, PMC10466800 · primary: yes · groups: lane-web-forums (1; single group, primary-source exception) · status: supported (primary exception)


### C11
- statement: At clear intensity, emotion gesture clips peak at .007-.036 normalized (~0.2-1.1 deg on a +-30 rig) while idle posture shifts (median .18, ~5.4 deg, every ~2.5 s) and OU continue unsuppressed; gestures are likely masked by idle, so exaggeration (larger, idle-ducked, anticipated gestures) is a missing tool.
- type: code-derived + perceptual · risk: high · intents: I3 · supporting: emotion-code evaluation, natural-motion.ts:459-485, emotion-score.ts:1228-1235 · groups: member-emotion-code, member-idle-code (idle amplitudes) · status: unresolved (skeptic R2 sent; rendered check pending)

### C12
- statement: Emotion side choices are drawn independently for hold, impulse and gesture, so a sided entry clip can contradict the held tilt; recoil/drop/nod-off are identical shapes every time per band; tilt-in moves pitch and roll on one profile (straight line, no arc).
- type: code fact · risk: normal · intents: I2, I3 · supporting: hold.ts:80-85, impulses.ts:159, gestures.ts:175, natural-motion.ts:43 · status: supported (code fact, one group) - skeptic pass pending

### C13
- statement: The Natural driver has no autonomous idle-activity scheduler (sigh, stretch, look-around, fidget, settle); idle variety comes only from continuous stochastic processes, shifts, presets and energy.
- type: code fact (absence) · risk: high · intents: I2 · supporting: idle-code grep (fidget/sigh/stretch/yawn/scan/look.around) + facade trace natural-motion.ts:362-522 · counter: separate "look-around" setting noted, caller check pending · status: partial

### C14
- statement: mouthForm (raw OU SD .04, tau 4 s) and the lid multiplier (|OU| tau 2 s) are unfiltered, so they carry short-scale roughness that the filtered head does not; a candidate source of face flicker.
- type: code fact + perceptual hypothesis · risk: normal · intents: I1 · supporting: face.ts:95-96 · status: code fact supported; perceptual effect unresolved (ablation arms H/I)


### C15
- statement: Natural's continuous head OU puts its velocity energy at ~0.9-1.5 Hz with 100-250 ms displacements of a few tenths of a parameter unit (+-30 rig) before gain; this sits inside the 0.5-3 Hz band where viewers perceive quick back-and-forth, so it is a plausible visible-jitter source, scaled up in high-energy spells (gain to 1.5) and talking (1.15).
- type: code-derived · risk: high · intents: I1 · supporting: idle-code analytic derivation (processes.ts, posture.ts) · contradicting: skeptic C3 (shifts larger) · status: unresolved (ablation pending)

### C16
- statement: Emotion recipes are rich in held face channels (eyeSmile up to 1.6, cheek 1.6, browY 1.0) but held head offsets are small (|H| <= .18 normalized, ~5 deg) and onset is slow (posture tau .6 s, 95% at 1.8 s); the face carries the read, the head barely differs from an idle shift.
- type: code fact · risk: normal · intents: I3 · supporting: emotions.ts:68-187, hold.ts:73-132 · status: supported (code) - interpretive part pending skeptic R2


### C1' (restated after R1b, 2026-10-24T19:40:48.143Z)
- statement: The continuous filtered-OU head component (tau .20/.24/.32 s, SD .012/.010/.005, filters .06-.09 s, gain .2-1.5) is the main source of small fast head reversals (~85% of sub-1-deg reversals, 2.4/s above 0.25 deg-equivalent) and of all >5 Hz head power. The liveliness gate's >5 Hz floor did not create it (pre-gate filters differ ~6%) but locks it in: any fix that removes it fails the floor.
- supporting: skeptic simulation (verify-skeptic-sim.md), idle-code analytic derivation (fv .94-1.45 Hz), magic-lineage task-14 log · groups: member-skeptic, member-idle-code (2) + ablation lane pending · counter-search: skeptic attacked its own H1 and corrected · status: supported (simulation) - render-scale visibility unresolved

### C3 (update) status: refuted for small reversals (OU dominates); partial for >1 deg reversals (shifts ~half).
### C1a (update): reference relabeled "Luke at his desk, 2 same-day sessions, VTS model params incl physics + smoothing, 27-28 Hz irregular, linear interp to 30 Hz"; sensor unknown (E1 pending).


### C17
- statement: The liveliness gate structurally penalizes two things the practice sources recommend: long deliberate stillness ("the model should be made still while waiting", Live2D motion-hint) via still05 <= .10, and smooth low-noise idle via the >5 Hz jitter floor; it is also scored at desk home, not the production home. Precedent exists for overriding tracker-derived bands (blink bands, mouth SD report-only).
- type: code fact + design tension · risk: high · intents: I1, I2 · supporting: idle-code report 3 (reference-stats.ts:228-295, trials.ts:142-155, liveliness.ts:91-115), docs.live2d.com motion-hint (lane-web-live2d-docs) · groups: member-idle-code, lane-web-live2d-docs (2) · status: supported - skeptic pass pending

### C13 (update): supported: no semantic idle-activity scheduler; 'look around' setting is Universal-only (Live2D.vue:204). Autonomous eye glances and event-triggered gestures exist.
### C2 (update): supported - MAGIC Live2D output filter present since 8ddb35353 (2026-08-29); groups member-magic-lineage (code + git).


### C11' (restated after R2)
- statement: Clear-band emotion HEAD clips peak at roughly idle-motion amplitude (.007-.036 normalized vs idle shifts median .18, OU .74 deg RMS in 0.5-3 Hz) and idle is not ducked during them; their onset is still salient through acceleration (recoil ~5.5x idle accel RMS). Readability of the EMOTION is carried by the face and is untested at widget size.
- groups: member-emotion-code, member-skeptic (simulation), member-idle-code · status: supported (scoped) · open: rendered 2x2 test

### C18
- statement: Emotion clips have no staged anticipation (counter-movement before the main action); follow-through/overshoot is uneven (most clips lack it); tilt-in and impulse vectors move in straight lines in axis space (no arcs); there is no squash/stretch-like channel and no body-Y bounce; strong body follow is synchronous, not delayed.
- type: code fact vs animation principles · risk: normal · intents: I3 · supporting: emotion-code report 3 (gestures.ts:74-122, impulses.ts:48-70) + principles sources (lane-a4 pending) · status: supported (code) - principles mapping pending A4

### C19
- statement: Ducking idle during an emotion clip (posture amplitude and OU gain to ~.3-.5 for the clip lifetime + ~.3 s, postpone shifts that would start inside it) is a lower-risk first lever than global exaggeration: it raises gesture SNR 2-3x and mirrors human freezing/orienting during startle; today strong episodes do the opposite (amplitude x1.27, shift rate x1.45 for 2 s).
- type: design recommendation · risk: normal · intents: I3 · supporting: skeptic R2, emotion-code (energy.ts:126-172, settings.ts:84-93) · status: partial (needs principles/perception source; rendered test)

### C20
- statement: Exaggeration should be targeted (emotion- and region-specific, onset/acceleration contrast, anticipation and overshoot, holds) rather than a global amplitude gain: facial-exaggeration studies show a naturalness-intensity trade-off and emotion-dependent uncanny effects, and one creature study found unexaggerated motion more appealing.
- type: research synthesis · risk: high · intents: I3 · supporting: Hyde 2013/2014, CHI 2025, Purdue thesis (abstracts via skeptic) · groups: member-skeptic (1) · status: unresolved (needs A7 lane primary reads + second group)

### C21
- statement: T2/T3 gates score only 420 s; the jitter metric is unstable at that length (600 s per-seed spread ~5x vs band 2.7x in the tuning log), so T2/T3 jitter pass/fail is weak evidence either way.
- supporting: options.ts:15-16, task-14-tuning-log.md:146 (magic-lineage) · status: supported (code + first-party log)


### C2 (final)
- statement: MAGIC's quick reversals plausibly come from its generator: a short-context VAR (order 20 at 30 Hz = 0.67 s) that adds a randomly drawn training residual x1.15 on every 30 Hz step and feeds it back into its lag history, with no intent or minimum-gesture model (AR-HMM additionally switches state per step with no dwell). Its Live2D output filter (EMA, cutoff .0575, smoothing .8) attenuates but does not forbid this; it applies only the newest catch-up pose without render-rate interpolation.
- supporting: magic-lineage (var.ts:124-136, use-live2d-motion-magic.ts:84-102, ar-hmm.ts:428-445, filter.ts, driver.ts) · status: supported (mechanism, code) - not reproduced by render

### C22
- statement: Natural shares no MAGIC generator, fit, or training data; the shared surface is the Pose/poseAxes contract used by manual control. MAGIC-like artifacts in Natural come from Natural's own continuous OU, not inheritance.
- supporting: magic-lineage import searches; skeptic simulation (OU = all >5 Hz power) · groups: member-magic-lineage, member-skeptic · status: supported

### C1a (final wording)
- supported: "Undifferentiated tracked-output high-frequency head content (from Luke's desk VTS sessions, linearly resampled) was copied into an enforced band whose lower bound is a heuristic x0.6 of the first session." unresolved: "that content is tracker noise" (no decomposition exists).


### C1' (VERIFIED 2026-10-24T20:48:04.036Z)
- verified by execution: verify-jitter-ablation.md (independent of skeptic sim; relative effects agree within ~3 points; absolute rates 20-25% lower due to reversal definition). Groups: member-skeptic, lane-verify-ablation, member-idle-code (3). status: supported (code-verified) for "source"; visibility at widget size remains unresolved.
### C3: REFUTED (shifts off: yaw quick 1.52 -> 1.75/s; shifts carry 0.5-1 Hz power and SD).
### C4: PARTIAL (K=0 removes all non-saccade eye reversals 0.155 -> 0/s, but mirrored amplitude ~0.1 deg; saccades dominate eye >5 Hz).
### C14: PARTIAL (mouthForm reversals 11.8 -> 0.94/s with 0.3 s low-pass; amplitude ~0.3-0.4% of range; lid |q| kink).
### C23
- statement: The current liveliness gate and the smoothing goal conflict: every arm that cuts head quick reversals by about half (filter 0.25 s, tau x3, filterTau x3) drops the jitter metric to 5-7e-6, below the 1.469e-5 floor, and fails; removing shifts fails high (1.7e-4). Hair-shimmer amplification through physics is not supported (RMS ratio 0.997).
- supporting: verify-jitter-ablation.md · groups: lane-verify-ablation, member-skeptic (sim: same direction) · status: supported (code-verified)


### C24
- statement: Increasing stochastic amplitude, noise SD, or event rate does not increase perceived idle diversity: in simulation, between-window feature CV stays flat for SD x2 and amplitude x2 and drops for shift rate x2 (top-10% path share CV .262 -> .173). Diversity must come from nonstationary regimes (calm vs restless spells on minutes scale), a small vocabulary of discrete recognizable acts with recurrence control, and context coupling.
- type: simulation + theory · risk: high · intents: I2 · supporting: skeptic simulation; repo-dive (Cubism random idle pick, Shimeji weighted graph, VPet activity picker); forums lane (AnimSchool "macro variations over three to six loops", "not just repeat the fidget"); Shuka audit memory · groups: member-skeptic, lane-repo-dive, lane-web-forums, lead-memory (4) · counter-search: skeptic attacked its own H3 · status: supported (simulation-verified for the negative half)

### C25
- statement: For a corner companion seen peripherally for hours, exaggerated recurring gestures carry an annoyance/habituation cost that no cited perception study measured; exaggeration should be rationed (per emotion, per channel, with recurrence limits) and checked with a long-exposure session.
- supporting: skeptic H2 attack, forums lane (charios "If a player notices the breathing cycle explicitly... too exaggerated"; shiroikarasu "too much sway reads as restless"), Juice counterpoint (gamedeveloper headline) · status: partial (practice + inference, no study)


### C17 (R3 2026-10-24T22:22:31.237Z): SUPPORTED with scope
- statement: The liveliness gate locks in the continuous head wobble through three metrics together (jitter floor, still05 cap <=0.10, still2 band [0.22,0.447]); removing the OU gives still05 .826 / still2 .849, halving its SD gives .154/.659, all failing. It is scored at a desk home used only by the gate. Fix all three together: jitter report-only, still bands set from a visual hold-stillness decision at widget size, score at production home; breath/blink/face stay as the anti-freeze floor. Precedent: blink and mouth tracker overrides (liveliness.ts:91-115).
- groups: member-skeptic (sim), lane-verify-ablation (jitter arms), member-idle-code, magic-lineage (band heuristic) · status: supported (simulation + code)
- open: whether recordings' still05 is a tracker floor (verification pending in st_01a16fab)
### C13/C8 (R3): PARTIAL
- survives: noise/amplitude/rate tuning does not create diversity (C24). Natural already has mode/energy regimes; missing piece is a small set of named multi-second acts (onset, return, refractory). Not established: that an act scheduler is THE main lever. References (Shimeji-ee 100:1:1 dwell, VPet die roll ~55% nothing, Ukagaka 15 s RAND(4), Cubism random Idle) are architecture precedent, one genre.
- design constraint: 2-3 acts, refractory of minutes, context-gated (long idle only), per-instance variation, long-exposure repeat check.
### C26 (A5)
- statement: Companion and VTuber practice layers reactions above idle per parameter with smooth fades (VTS P1 idle < P3 one-time < P4 expression < P5 physics, "always faded smoothly"), keeps idle amplitude small (about +-5 deg head of 30, +-2 body), lags head behind body, gives each element a different period, and makes long dwell mostly stillness with rare flourishes. Smoothing trades jitter for lag (VTS settings).
- groups: lane-vtuber-practice (VTS wiki, ikimotion, makotok1, shiroikarasu, Shimeji, VPet, Ukagaka), member-skeptic (Live2D motion-hint "do not wobble") · status: supported as practice (no controlled study; direct user opinion not obtained)
### C27 (A5 gap)
- statement: No user-review data on what makes a corner companion alive vs annoying was obtained (Steam/Reddit blocked). status: unresolved


### C28 (A6)
- statement: Independent per-axis noise is a known anti-pattern for idle (Egges 2004: noise on all joints misses inter-joint dependency; fix = PCA-coupled postures + separate balance-shift layer). Natural's head uses independent per-axis FilteredOu. Improv (Perlin 1996) keeps coherent noise as one layer under weighted, mood/environment-dependent behavior selection.
- groups: lane-procedural-research (Egges, Perlin primary), member-skeptic (H3: structure not noise), lane-vtuber-practice (practice) · status: supported as design precedent (no direct reversal-rate finding)
### C29 (A6)
- statement: Gaze timing is state-dependent, not one stationary process: mean inter-saccadic intervals ~1.6-2.5 s by listening/speaking x at/away (Vinayagamoorthy citing Lee 2002, secondary, risk high); eye-head threshold ~15-20 deg (10-15 in graphics); eyes lead head ~20-50 ms, head leads for predictable targets; VOR 7-15 ms. Natural's fixed K=(0.31,0.40) counter-rotation is a simplification.
- groups: lane-procedural-research (Ruhland STAR secondary) · status: partial (secondary sources)
### C30 (A6)
- statement: Smoothing trades jitter at low speed against lag at high speed (1 Euro filter, Casiez 2012: people are jitter-sensitive at rest, lag-sensitive in motion); a speed-adaptive cutoff addresses both. Applying it to synthetic idle is extrapolation.
- groups: lane-procedural-research (Casiez primary), lane-vtuber-practice (VTS "less shaky but ... lag") · status: supported (mechanism), transfer inferred
### C31 (A6)
- statement: Preferred noise amount is not universal (Bodenheimer 1999, bimodal) -> the hold-stillness level is a taste decision for Luke, supporting C17's "visual decision" fix.
- groups: lane-procedural-research · status: supported (single study, running gait)
### C32 (A6 gap): no sourced resting-head reversal rate or 1/f head spectrum; Hadar 1983/84 (posture shifts ~4.6/min, >25 deg in <1.2 s; snippet only) is the open lead. status: unresolved


### C20 (A7 2026-10-24T23:03:04.150Z): exaggeration is a TARGETED recognition tool, not a global gain
- statement: Exaggeration raises perceived intensity and distinctness (Pollick 2003, Furl 2022) but trades against appeal/naturalness, and Hyde 2013 found CARTOON characters rated better with damped motion (within +-20%) while more motion read as more extraverted. Exaggerate the discriminating cues (mouth/brow amplitude, head/torso posture, timing contrast), not everything.
- groups: lane-emotion-exaggeration (Pollick, Furl, Hyde), member-skeptic (H2 partial, 5 studies), lane-web-forums (practice) · status: supported (abstract-level for Hyde; transfer to small 2D rig inferred)
### C33 (A7)
- statement: Timing and posture are independent emotion channels: speed shifts judgments (fast -> happy/angry, slow -> sad; Emotion 2021) while posture (sad neck/thoracic flexion, joy trunk extension) carries emotion beyond speed (gait 2011); body arousal explains most between-emotion movement differences (Wallbott 1998, Pollick 2001). Shorter duration does not mean more intense (Pollick 2003).
- groups: lane-emotion-exaggeration (4 primary/abstract), lane-principles pending · status: supported
### C34 (A7)
- statement: Each emotion should have 2-3 variants (Dael 2012: emotions expressed via multiple movement patterns), aligning with C24 (structured diversity) and the Shuka audit's bounded variation. EMOTE Effort/Shape (-1..+1, per body part) is a candidate compact control set for per-emotion presets (mapping to Live2D untested).
- groups: lane-emotion-exaggeration, member-skeptic (H3), lead-memory (Shuka) · status: supported as design direction
### C35 (A7 gap): no source on scaling exaggeration with display size / viewing distance; uncanny risk for flat anime-style rigs not shown (Piwek 2014: motion does not deepen it for realistic characters). Size scaling = design hypothesis -> 0.8x/1.0x/1.3x ladder on the real model at real size. status: unresolved


### C36 (VERIFIED 2026-10-24T23:04:52.398Z)
- statement: Natural's idle head over-reverses at small amplitude compared with Luke's own recordings: yaw quick reversals >=0.25 deg 1.52/s vs 0.44/s (3.5x; per-session 0.43-0.46, interpolation <2%); pitch 1.20 vs 0.88 (1.4x); roll 0.26 vs 0.35 (below); at >=1 deg yaw only 1.3x. The excess is small fast wiggle. The recording has far more slow wander (yaw 0.5-1 Hz 2.61 deg2 vs Natural ~0.67) and less >5 Hz power (2.6e-4 vs 1.12e-3 deg2).
- groups: lane-verify-recordings (execution), lane-verify-ablation, member-skeptic (sim) · status: supported (code-verified). Caveat: recordings are VTS output incl. tracker/smoothing.
### C17 point 3: REFUTED (2026-10-24T23:04:52.398Z)
- "recordings' low still05 is a tracker frame-noise floor" refuted: median-3 filter raises still05 <1 pp; slowest 2 s windows still move 0.7-1.0 units/s. The human head is almost always moving slightly (could be slow drift; not separated). C17 core (three-metric lock-in) stands, but the stillness bands are not tracker artifacts; the fix shifts from "drop still bands" to "replace fast wiggle with slow wander that keeps the head moving" (verification: verify-wave2-slow-wander).
### C1' (refined)
- The quick back-and-forth is the wrong SHAPE of motion, not too much motion: Natural spends its motion budget in fast small reversals where the human spends it in slow wander. Removing motion (arms B/G/J/K) undershoots stillness; reshaping is the candidate fix.


### C18 (A4 mapping 2026-10-24T23:04:52.398Z): SUPPORTED (code + principles)
- A4 principles map: anticipation = short opposite offset ~10-25% of move, skipped for startles; follow-through = damped springs (f .5-6 Hz, zeta .1-1.2, root-to-tip, fixed step, explicit reset on snaps); slow-in/out with hard-out for surprise; arcs = coupled yaw/roll; staging = one priority channel at a time; moving hold = small SLOW motion in holds. Natural's emotion clips lack anticipation, mostly lack follow-through, move straight in axis space (C18 code) -> concrete gaps. groups: member-emotion-code, lane-principles (frankanollie, Wang 2006 abstract, haotian, orangeduck) · status: supported
### C37 (A4)
- statement: Exaggeration filters (Wang 2006 Cartoon Animation Filter: adds smoothed inverted acceleration) amplify high-frequency input, so jitter must be removed BEFORE any exaggeration is applied; classical timing favours deliberate pose changes with holds over constant drift ("Fewer drawings make the action faster and crisper"; traced realism "stiff and mechanical").
- groups: lane-principles (craft + abstract), member-skeptic (DEAD END: global exaggeration gain), lane-emotion-exaggeration (Hyde damped cartoon) · status: supported (ordering is inference from filter math; untested)
### C19 (A4 staging): partial -> SUPPORTED as recommendation (staging principle + skeptic R2 SNR sim); rendered test still open.


### C38 (VERIFIED 2026-10-24T23:12:28.078Z): stationary slow wander is a DEAD END
- statement: Adding slow stationary wander cannot reproduce the human head: arms matching the human 0.5-1 Hz power (2.6 deg2) still reverse 2.9x too often and never hold still (still05 .002, mean speed 11.5 vs 6.7 deg/s), failing 8 gate metrics; longer-tau/larger-SD OU (W1/W2) leaves 0.5-1 Hz at ~.56. The human combines large slow power with few reversals, which fits sparse step-like moves separated by holds. Closest arm: W7 (more frequent shifts, slower/smoother OU) q25 1.78x, passes still05/still2, fails jitter and speedPeakLogAsymmetry.
- groups: lane-verify-wave2 (execution), lane-verify-recordings · status: supported (code-verified, same seeds for calibration and evaluation)
### C39 (VERIFIED 2026-10-24T23:12:28.078Z)
- statement: Luke's head is far more nonstationary than any Natural arm: between-window CV of mean speed at 60 s is .775 vs .10-.17 (10 s: 1.09 vs .25-.32). No OU or shift retune moves it. This is the measured gap behind I2 (variety) and supports minutes-scale regimes (C24, C13). Caveat: recordings may include desk activity (typing, talking) that a corner idle should not copy literally.
- groups: lane-verify-wave2, member-skeptic (H3 sim: noise does not raise CV) · status: supported (code-verified)
### C36 update: baseline passes all 24 gate metrics under the gate protocol (jitter 2.90e-5); earlier jitter failures were specific to arms B/G/J/K.


### C40 (VERIFIED 2026-10-24T23:28:04.677Z): best measured idle reshaping
- statement: In head-angle simulation under the gate protocol, a slower, smoother continuous layer (OU tau x5, filterTau x2) with human-fitted lognormal holds between posture shifts, plus a shifts-only regime (log-gain OU, tau 120 s) on rate and amplitude (arm R4), cut yaw quick reversals from 3.85x to 1.46x the recordings, passed still05 (.084) and still2 (.439), and raised 60 s speed CV from ~.10-.17 to .45 (human .775). It fails only jitter (3.9e-6 vs floor 1.47e-5; band = 0.6-1.6x one session, heuristic) and speedPeakLogAsymmetry (.68 vs floor 1.05; band 0.7-1.4x). Reversals are supplied by the continuous OU, not by monotone min-jerk shifts; OU SD trades reversals against stillness (crossover near q25 1.34-1.44x). Quiet-OU step arms are a DEAD END (too still, q25 .40-.56x).
- groups: lane-verify-wave3 (execution), lane-verify-wave2, lane-verify-recordings · status: supported (code-verified; head angle only, not rendered; ~30 windows/seed for CV)
### C41 (VERIFIED 2026-10-24T23:28:04.677Z)
- statement: Luke's head is mostly in motion with short holds (57% of frames >2 deg/s, 8% <0.5 deg/s, hold median .37 s, q99 7.3 s; move amplitude median .88 deg, tail to 31 deg), and its activity regimes switch on a 20-60 s scale (dwell above/below median speed q50 20 s, q90 70-80 s), not minutes. The minute-to-minute variety is not burst-driven (CV60 .775 -> .66 without top 5% windows).
- groups: lane-verify-wave3 · status: supported (execution). Caveat: desk activity included.
### C24 refinement: regime timescale 20-60 s (C41), and regimes on shifts verified to lift CV60 to .39-.72 (C40). C13: idle acts remain unverified; regimes are the verified variety lever.
### C17 refinement: the closest-to-human stillness-passing arm fails exactly the two heuristic bands (jitter 0.6-1.6x, SPLA 0.7-1.4x); still05/still2/angleXp95 are hand-set bands widened to both sessions, and they pass. Re-baseline jitter (report-only or two-session) and SPLA, keep the stillness bands.


### C40 correction (2026-10-24T23:34:30.810Z, gate review): R4's failing values are jitter 2.96e-6 and SPLA .626 (3.9e-6/.68 were R2's); R4 passes stillness at the median only (seed 2 fails still05, still2, angleXp5). Conclusion unchanged.

