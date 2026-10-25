# SYNTHESIS - Natural motion quality and diversity for a corner VTuber

Session: C:/Users/Luke/projects/dtuber/.omo/ulw-research/20261024-181357. Claim IDs refer to claim-graph.md; verification files are in the session dir.

## 1. The jitter (I1): diagnosed, code-verified
- **Source:** Natural's continuous head OU layer (independent per-axis FilteredOu, tau .2-.32 s, SD .012, gain up to 1.5) [S1]. With it off, yaw quick reversals (>=0.25 deg, half-swing .125-1 s) fall 1.52/s -> 0.05/s; it is 99.7% of yaw power above 5 Hz (verify-jitter-ablation.md, skeptic sim; 2 independent groups; C1').
- **Not the source:** posture shifts (off: 1.52 -> 1.75/s; C3 refuted); MAGIC (no code/data reuse, C22); hair physics (RMS ratio .997, C23). Eye counter-rotation (non-saccade eye reversals .155/s -> 0 with K=0, ~0.1 deg) and unfiltered face OU (mouthForm 11.8 reversals/s, ~0.3% range) are real but small (C4, C14).
- **Against the human reference** (Luke's own desk recordings, 7525 s): Natural yaw reverses 3.5x as often (1.52 vs 0.44/s), pitch 1.4x, roll below; at >=1 deg yaw only 1.3x. The human head has ~4x the slow 0.5-1 Hz wander (2.61 deg2) and ~1/5 the >5 Hz power under the same 30 Hz protocol (.000261 vs .00126 deg2). The fault is the SHAPE of motion: fast small wiggle where the human has slow wander (C36, verify-recording-reversals.md).
- **Why it persists:** the liveliness gate locks it in through three metrics at once: jitter floor (>5 Hz power ratio, lower bound = heuristic 0.6x of one session), still05 cap <=0.10, still2 band [.22,.447] (C17, C1a). Every smoothing arm that halves reversals fails the jitter floor; OU off fails still05 (.83) and still2. The recordings' low still05 is NOT a tracker frame-noise floor (median-3 filter: <1 pp; C17 pt3 refuted); the head is almost always moving slightly, though slow tracker drift was not ruled out.
- **MAGIC's own jitter** (for completeness): per-step resampled training residual x1.15 fed back into a 0.67 s VAR context, no minimum gesture duration; its output filter attenuates but cannot forbid reversals (C2).

## 2. Diversity (I2)
- More noise does not make more variety: between-window CV is flat for OU SD x2 and amplitude x2 and drops for shift rate x2 (skeptic sim; C24). Perlin's Improv separates noise from weighted behavior selection [S54]; Egges warns that independent per-joint noise misses inter-joint coupling [S55] (C28).
- Natural already has mode/energy regimes; it lacks minutes-scale calm/restless spells and named multi-second acts with onset, return and refractory (C13 R3).
- Reference companions are mostly still with rare flourishes: Shimeji-ee 100:1:1 transition weights (~98% repeat, DERIVED) [S33], VPet does nothing on ~55% of idle ticks at its minimum setting (DERIVED) [S34], Ukagaka 15 s check with 1-in-4 pose change [S49]. Architecture precedent only (one genre; C13/C8).
- Recognizable acts likely become tics over hours (inference: low-level motion clones are hard to spot [S44], recognizable acts are not studied); Shuka was abandoned partly over feature creep. Keep the vocabulary at 2-3 acts with minute-scale refractories and context gating (C25, C13).
- Emotion clips are identical shapes per band, and sides are drawn independently for hold, impulse and gesture, so an entry clip can contradict the held tilt (C12). Emotions are naturally expressed through several patterns [S64] -> 2-3 variants each (C34).

## 3. Emotion legibility and exaggeration (I3)
- The face carries the read (eyeSmile/cheek to 1.6); clear-band head clips peak near idle amplitude and idle is not ducked, though the recoil onset is salient (~5.5x idle accel) (C11', C16).
- Clips lack anticipation, mostly lack follow-through, and move straight in axis space (no arcs) (C18 + A4 mapping [S71] [S68]).
- Exaggeration is a targeted recognition tool, not a quality booster: it raises intensity and distinctness [S61] [S63], but trades against appeal, and cartoon characters were rated better with damped motion [S60] [S42] (C20). Speed and posture are independent channels: fast reads happy/angry, slow reads sad [S62]; posture carries emotion beyond speed [S65] (C33).
- Exaggeration filters amplify high-frequency input, so jitter must be removed first (C37). No source scales exaggeration with display size (C35).

## 4. Environment vs self-driven motion (I4)
- Practice layers reactions above idle per parameter with smooth fades (VTS: idle < tracking < one-time < expression < physics, "always faded smoothly") [S45]; staging says one priority channel at a time [S71] (C26, C18).
- Natural keeps full idle amplitude during emotion clips, and strong episodes raise amplitude x1.27 and shift rate x1.45 - the opposite of ducking (C11', C19).

## Intent status
- I1 violated; cause verified; R4 reaches 1.46x in sim; visibility unverified.
- I2 violated (CV60 ~1/5 of human); regimes verified in sim.
- I3 partly violated (head channel weak, no ducking); widget-size readability untested.
- I4 partly violated (idle fights clips); cursor/touch/desktop/speech reactions outside this run (cursor/touch planned and in progress on luke/feat/live2d-cursor-touch).
- I5 true.

## 5. Ranked recommendations
1. **Reshape the head idle and re-baseline two gate bands with it.** Verified direction (C40, arm R4): slower, smoother continuous layer (OU tau x5, filterTau x2), human-fitted lognormal holds between shifts, shifts-only regime (log-gain OU, tau 120 s). Reversals 3.85x -> 1.46x human, stillness passes at the median (seed 2 fails), CV60 .10-.17 -> .45. Regime verified at tau 120 s; 20-60 s (C41) is a tuning target (tau 60 s failed still2). OU SD ~1.5x baseline (W7 sd x2 times S7 x0.74): it trades reversals against stillness. Fails only jitter and speedPeakLogAsymmetry, both heuristic bands -> make jitter report-only or two-session, re-derive SPLA. Stationary slow wander (C38) and quiet-OU steps are dead ends.
2. **Duck idle during emotion clips and strong attention** (posture amplitude and OU gain to ~.3-.5 for clip life + ~.3 s, postpone shifts) (C19).
3. **Emotion clip craft:** anticipation ~10-25% of the move (skip for startles), arcs (coupled yaw/roll), follow-through springs on body/secondary, consistent side per episode, 2-3 variants, per-emotion speed and posture (C18, C33, C34).
4. **At most 2-3 named acts** with minute refractories, long-idle gating and per-instance variation; unverified (C13, C25). Regimes belong to recommendation 1.
5. **Minor:** low-pass face OU (0.3 s cuts mouth reversals 11.8 -> 0.94/s) and fix the lid |q| kink; restrict eye counter-rotation to real head moves (C14, C4).
6. **Exaggeration as a rationed tool:** per emotion and channel, after jitter removal, tested on a 0.8x/1.0x/1.3x ladder at widget size, with a one-hour annoyance check (C20, C25, C35).

## 6. Decisions only Luke can make
- Approve re-baselining the liveliness gate (it currently enforces the wobble).
- Visual hold-stillness level within the measured bands: preference for noise amount is bimodal across people [S59] (C31).
- Rendered widget-size A/B: current motion vs the R4 retune - the deciding visibility test nobody could run headless.

## 7. Verification waves
- Wave 1: 8 members + 5 lanes; ablation (11 arms), recordings comparison, skeptic simulations.
- Wave 2: slow stationary wander refuted (C38); regime gap measured (C39).
- Wave 3: human step/regime structure (C41); best reshaping arm R4 (C40). Leads converged to implementation tuning.

## 8. Unresolved
- Pixel visibility of 0.25-0.5 deg reversals at widget size; whether recorded HF content is tracker noise or biological (C1a); resting head reversal rate in literature (C32); size scaling of exaggeration (C35); direct user-review data on corner companions (C27).
