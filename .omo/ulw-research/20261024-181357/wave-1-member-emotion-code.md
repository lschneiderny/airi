## 2026-10-24T18:16:45.793Z WORKING
11 non-neutral emotions, only 8 clip archetypes played; sad/think/question/curious have no gesture clip; angry chooses shake/drop. Bands: slight (suppresses head/gesture), clear gesture amp 0.6, strong 1. Strong body follows only yaw/roll at 0.5; pitch-only gestures (laugh/recoil/nod-off) give no body-Y.
## 2026-10-24T19:07:12.040Z LEADS
(1) Emotion-strength slider >0 scales only held channels (hold.ts:109,117,126,131); pending-actions.ts:74 tests only ===0 and passes raw intensity to impulse/gesture/mood (:77,82,84): slider does not strengthen entry clips. (2) emotion-score.ts:1228-1235 excludes posture visibility (bias only): passing the emotion gate does not prove head gesture reads over idle. (3) Repeat 0.6 emotion outside 2 s merge within 15 s habituates to 0.48 -> slight: loses gesture/head/glance/energy; same emotion inside 2 s at <= nominal yields no new episode (reaction-strength.ts:60-75).
## 2026-10-24T19:13:05.579Z QUANTIFIED + COHERENCE
At clear .6 gesture scale = .6*.6 = .36: recoil .036, drop .0288, love tilt-in pitch .0108/roll .0288, look-away yaw .036, sway yaw .0288, nod-off -.0288/+.0144; laugh peaks .0069-.0124 pitch (~.2-.37 units on +-30). Idle: OU SD .010-.012 x gain .2-1.5, drift SD .12, shifts median .18. Side decisions independent across hold (hold.ts:80-85), impulse (impulses.ts:159), gesture (gestures.ts:175) -> sided entry clip can oppose held tilt. Recoil/laugh/drop/nod-off identical shapes per band (side unused); laugh varies cycles; sway/tilt-in/look-away vary only mirror side. tilt-in pitch/roll share P(t,.5) -> straight line in axis space (no arc); sway/look-away curved.
## 2026-10-24T19:23:12.114Z REPORT 1/3 (per-emotion recipes, emotions.ts:68-187)
H=(yaw,pitch,roll) normalized; F=(browY,browAngle,oneSidedBrow,eyeSmile,mouthForm,eyeOpenMult,eyeOpenHint,cheek,mouthOpen).
| emotion | held H | held F | mood (v,a,t) | clip |
|---|---|---|---|---|
| happy | (0,.10,.06) roll | (.5,0,0,1.6,1,1,0,.4,0) | (.7,.5,-.2) | laugh |
| sad | (0,-.18,.04) | (-.2,.9,0,0,-.8,.75,0,0,0) | (-.6,-.5,.1) | none |
| angry | (0,-.10,0) | (-.7,-1,0,0,-.7,.85,0,0,0) | (-.5,.6,.8) | shake-or-drop |
| think | (.08,.08,.08) | (0,-.2,.4,0,-.2,.9,0,0,0) | (0,-.15,.15) | none |
| surprised | (0,.06,0) | (1,0,0,0,-.1,1,.25,0,.3) | (.1,.8,.35) | recoil |
| awkward | (.10,-.04,.06) | (.2,.4,0,.4,.3,1,0,0,0) | (-.25,.15,.6) | sway |
| question | (0,0,.14) | (0,0,.6,0,0,1,0,0,0) | (0,.1,.1) | none |
| curious | (0,.04,.12) | (.4,0,.3,0,.2,1,.1,0,0) | (.2,.3,0) | none |
| love | (0,.04,.10) | (.3,.3,0,1.4,.8,1,0,.8,0) | (.6,.2,-.1) | tilt-in |
| flustered | (.12,-.10,.06) | (.2,.6,0,.6,.4,.9,0,1.6,0) | (.2,.5,.4) | look-away |
| sleepy | (0,-.14,.08) | (-.2,.2,0,0,0,.45,0,0,0) | (0,-.6,-.2) | nod-off |
Held strength S = clamp(strength)*model strength (0..2). Face/mod onset tau .25 s release .6 s; posture tau .6 s (95% at 1.8 s). Side = hash(emotion)+change count parity. Impulse D vectors e.g. happy (0,.9,.3), surprised (0,.8,0), question/curious (0,0,.8), flustered (.4,-.3,.3), all times intensity. Model strength scales hold only (hold.ts:109; pending-actions.ts:73-88).
## 2026-10-24T19:40:48.143Z REPORT 2/3 (bands, clips, variety, mood)
Bands (settings.ts:37-122): slight .25 (<.5) gesture 0, mood .15; clear .6 face onset .10 head tau .38 overshoot .08 hold 1.2 release .5 gesture .6 mood .25; strong .9 onset .07 tau .24 overshoot .16 hold 1.8 release .7 gesture 1 mood .4.
Impulse head = D*.12*I^.7*[P(t,tau) - overshoot*P(t-3tau,tau)], P=(t/tau)^2 exp(2(1-t/tau)); tau/gain NOT randomized for episodes (impulses.ts:243-247 random range is desktop nudges only). Strong body lean .06 I unit(D) P(t,1.5 tau), no overshoot.
Clips (gestures.ts:25-122): laugh pitch-only 2-4 cycles 3.5-5 Hz A .04-.06 S, cooldown 4 s; recoil fixed +.1S at .12 s, -.02S overshoot, 3 s cooldown; angry shake yaw .06S 3 Hz 2/3 or 1 s, or drop -.08S, cooldown 5 s; sway yaw .08S + roll .04S .8 Hz, 2 s; tilt-in pitch .03S roll .08S P(t,.5), lifetime 7.5 s; look-away yaw .1S hold 1.05 s + 5 Hz roll .02S; nod-off -.08S over 1.2 s then catch +.04S, cooldown 8 s. 8 archetypes; only laugh and shake vary timing; no start-delay randomization; body clip only at strong, synchronous (.5 yaw, 0, .5 roll).
Gesture ownership suppresses impulse head/body even when cooldown refuses the clip (ADR 2026-10-19:125-137). Long clip tails postpone idle shifts (tilt-in ~7 s).
Habituation: repeats within 15 s x max(.35,.8^n); same/equal within 2 s no episode. Mood tau V45/A20/T30 s; amplitude x clamp(1+.2A,.8,1.2), shift rate x clamp(1+.3A,.7,1.3).
EXPAND: entry vs hold silhouette reinforcement; long tails delay shifts. DEAD END: episode tau randomization.
## 2026-10-24T19:54:36.403Z REPORT 3/3 (readability, principles, idle interaction)
Held clear H targets larger than clips (e.g. sad pitch -.108, question roll .084, flustered yaw .072) but posture tau .6 s: 18% by .12 s, 57% by .5 s. At slight, targets shrink further with no clip allowed. Face idle noise vs hints: slight awkward mouthForm -.0125 below mouthForm OU SD .04. Strong episodes add amplitude .3I, shift rate .5I for 2 s (x1.27/x1.45 at I .9) - counter to readability. Gesture body only yaw/roll half amplitude, synchronous; no pitch bounce; physics-owned body skipped.
Principles: ANTICIPATION missing (clips move immediately toward target; recoil negative and nod-off catch come after). Follow-through/overshoot uneven (8%/16% delayed pulse; recoil 20%; nod-off catch). Settle present. Arcs partial (sway/look-away curved; tilt-in and impulse D straight lines). No squash/stretch channel; body-Y is angle not translation. Timing contrast present. Speech accent pulses (.02-.05) can equal or exceed clear clips.
Gate: emotion scorer posture = significance/sign/size only, 2-4 s window excludes fast clips; no pixel or recognition test (emotion-score.ts:1228-1240,1513-1564).
EXPAND: corner-size rendered test; clip vs idle/voice excursion ratio + blind recognition; coherent side + ducking prototype; clip body-Y/follow-through gap. DEAD END: constants cannot prove unreadability.
