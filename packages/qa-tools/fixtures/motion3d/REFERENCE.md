# Human-reference bands for mmd-motion-quality v3

Frozen bands SHA-256: `c7c03b8f7e8679e601a722f374635425b32781024314b2377bad45aff092b589`.
Derived on 2026-11-11T22:04:52.759Z from the rule commit `0f52ddd5367c321f19752220cd1bb8aaf1bcdd0a` (recorded as `tool.gitSha`) plus the builder wiring that the freeze commit adds. The freeze commit's validity test rebuilds the classes from the reference clips and requires them to equal this file.

Version 2 remains in `bands-v2.json` (SHA-256 `1cffebeca8e973f303128ff2031e9f4a54a38d3e822ee05cb710e050dbe5ecfe`) and version 1 in `bands-v1.json` (SHA-256 `c5a5a8eee5c5e3668cbb081d084b3da62ef9441787a975fc5607886e720230d7`) as their records. The gate no longer loads either file.

Only derived statistics are stored in bands-v3.json. No raw motion, model, texture, joint trajectory, or capture is committed. Clip identifiers and subjects below document provenance; raw sources remain outside the repository.

## Sources and licences

- 100style: https://zenodo.org/records/8127870. Licence recorded in the fixed manifest: CC BY 4.0; Mason et al., 100STYLE Selected clips: 34.
- cmu: https://mocap.cs.cmu.edu/. Licence recorded in the fixed manifest: CMU: may be copied, modified or redistributed; no resale of the data itself. BVH conversion: una-dinosauria/cmu-mocap. Selected clips: 52.
- CMU BVH conversion credit: una-dinosauria/cmu-mocap (https://github.com/una-dinosauria/cmu-mocap).

The source selection and split were fixed before measurement. Manifest SHA-256: `023f898ad02a2351befe2a38cd8a7c2013fa0d9fc412e623a9cbb49f65a00a91`. All 86 entries were attempted. The unchanged upright-admission rule refuses fitting clip cmu:138_32 (30 of 454 frames, 6.6079 percent, exceed the non-upright allowance of 1 percent). Its identifier, hash, subject and refusal remain in bands context.admission; no manifest entry was removed or moved. All held-out sources admit.

100style:InTheDark_FW (10,245 frames) and 100style:Old_FW (14,949 frames) both ingest after the large-block codec correction. Window-source counts after admission are idle 11 fitting / 3 held-out, talk 16 / 5, and walk 13 / 4. No class uses an 8 s fallback.

## Version 3: standing-speaker talk reports and emotion separation from neutral, 2026-11-11

Version 3 is version 2 with two status changes. Every fitted bound, floor, move speed, held-out verdict and admission record is the same as in version 2. `idle`, `walk`, `gaze` and `react` are identical to version 2.

- Talk: every gated talk band fitted per clip from the talk window clips is REPORT with detail `talk reference performers locomote; floors are not valid for a standing speaker`. The rule (`reportStandingSpeaker`, `context.standingSpeaker`) selects 18 ids: the seven chain correlations (`chain.spine-chest`, `chain.chest-neck`, `chain.neck-head`, and both sides' `UpperArm-LowerArm` and `LowerArm-Hand`), `coverage.core`, `coverage.arms`, `bilateral.upperArm`, `bilateral.lowerArm`, `bilateral.hand`, `inter.speedCv`, `dim.upper`, `dim.core`, and `smooth.head.spikeRate`, `smooth.armL.spikeRate`, `smooth.armR.spikeRate`. Their fitted bounds stay in the file, and their values are still measured and printed. The talk class still gates `smooth.head.ldlj`, `onset.attackFraction` and `onset.easedOrAnticipated` (episode bands from idle and talk episodes), and the declared `coverage.fingers`, `fingers.frozen`, `gesture.strokeP` and `gesture.strokeLagMs`.
- Emotion: `emotion.minSeparation` keeps its formula and its declared bound of 2 and is REPORT. The new declared, gated `emotion.minSeparationFromNeutral` is the minimum, over every emotion other than neutral, of its separation from neutral and its separation from the placebo, in the same pooled SD units, and must be at least 2 (`context.clearOfNeutral`). The neutral-against-placebo pair is not part of it. `emotion.armShare` and the onset bands are unchanged.

## Version 2: pooled body sides, 2026-11-11

Every fitted metric whose id names a left or right bone or region and whose mirror is also fitted is fitted once from both sides pooled, and both ids carry that one band. The pairs are the shoulder, upper-arm and lower-arm chain correlations and lags, the upper-arm idle ACF, and the arm LDLJ and spike rates; `context.sidePooling.pairs` lists them per class. Every left or right bone activity floor and the `armL`/`armR` move speed are fitted once from both sides' human values under their unchanged rules and applied to both sides. Percentiles, margins, the Fisher transform, minimum counts, the vacuous-band rule and the held-out rule are unchanged; a held-out clip is judged on both sides against the pooled band and counts once per failing side, and a pooled episode group counts once for the pair. Non-sided bands keep their fitting rules, but a non-sided metric that reads a pooled floor or arm move speed (coverage, bilateral, dimensionality, gesture stroke rate and onset metrics) is measured with the pooled value, so its band can move. Eleven non-sided bands moved because their metrics read a pooled floor or arm move speed: idle `bilateral.hand.peakCorr`; talk `dim.core`, `gesture.strokesPerMin`, `onset.attackFraction`, `onset.easedOrAnticipated`; walk `bilateral.upperArm.peakCorr`, `coverage.arms`, `coverage.core`, `dim.upper`; emotion `onset.attackFraction`, `onset.easedOrAnticipated`. None changed status; the qa-tools README version 2 section describes this effect.

Why: version 1 fitted each side separately from the same clips of one performer, so its sided limits and floors carried that performer's handedness. The idle `chain.leftShoulder-leftUpperArm.zeroLagCorr` limit was r 0.62 and the right side's r 0.98; the idle `leftHand` floor was 0.0054 and `rightHand` 0.0030 rad/s. This change was made after a tuned character failed left-side metrics only. No character data entered the fit, and no band was adjusted by hand. The user decided on 2026-11-11: "Arm bands: Gate v2, pooled sides (Recommended)". The manifest, split and declared bands are unchanged.

Mirrored bands whose status changed: idle and walk `chain.leftUpperArm-leftLowerArm.lagMs` / `chain.rightUpperArm-rightLowerArm.lagMs` and walk `chain.leftLowerArm-leftHand.lagMs` / `chain.rightLowerArm-rightHand.lagMs` became REPORT as vacuous (version 1 gated the left side only); talk `smooth.armL.ldlj` / `smooth.armR.ldlj` became REPORT; idle `smooth.armL.spikeRate` / `smooth.armR.spikeRate` and talk `smooth.armR.spikeRate` became GATED (talk `smooth.armL.spikeRate` was already gated). For a pooled pair the ten-value clip minimum counts side values, not clips, so pairs that neither side could fit alone are now gated, which makes the gate stricter: idle `smooth.armL.spikeRate` and `smooth.armR.spikeRate` (8 fitting clips with a value per side, 16 pooled) and talk `smooth.armR.spikeRate` (7 values in version 1, 18 pooled side values in version 2). The held-out allowance stays at one failing unit, while a pooled pair has about twice the held-out units of either side. The talk arm LDLJ pair has 14 held-out episode groups instead of 7 per side; two fail, so `smooth.armL.ldlj` and `smooth.armR.ldlj` became REPORT with `holdout-failures: 2`. This is a loss of a gated check for speech: version 2 no longer gates arm smoothness (LDLJ) in talk.

A pooled floor can fall outside both version 1 side values when a class has few fitting clips, because the floor is half the 10th percentile with linear interpolation and pooling changes the interpolation rank. This happens in talk (lower arm, upper leg, lower leg, foot, toes) and in the shared gaze/emotion/react set (upper leg); every idle and walk pooled floor lies between its two side values. Within each clip, left-side values are ordered before right-side values in the pooled episodes, which decides which episodes share a held-out group of eight and which values the seeded bootstrap draws; the rule did not specify this order.

## Held-out validation and its timing

A fitted metric stays gated, without any changed bound, when zero or one held-out unit fails it. Two or more failures make that metric REPORT with detail `holdout-failures: <n>`. Units are clips for clip fits and consecutive groups of eight episodes for pooled fits. Declared bands are unchanged. Every original held-out verdict, value and failed metric remains in the bands file.

The P5 to P95 interval plus a fixed margin can miss isolated unseen values. A clip is judged on about 25 metrics, so an occasional isolated failure is expected by chance. Repeated failures indicate that a metric is not reliable enough to gate unseen human motion. This tolerance was set after the held-out results were inspected and before any character trace was judged. It is a post-selection decision, not independent validation.

The file retains 386 PASS and 14 FAIL unit verdicts. Two metrics have repeated failures: gaze.chestLagMs (groups 16, 22, 38) is REPORT with `holdout-failures: 3`, and the pooled talk arm LDLJ pair (groups 0 and 1 of the pooled arm episodes) is REPORT with `holdout-failures: 2` on both ids. All other failing metrics have one failing unit and retain their fitted bands. No percentile, margin or source split changed for version 2; only the pooled sided bands, floors and arm move speeds, and bands measured with them, differ from version 1.

| Class | Failing clip or episode group | Failed metrics |
| --- | --- | --- |
| idle | 100style/100STYLE/Drunk/Drunk_ID.bvh | period.hips.acfPeak |
| talk | smooth.head.ldlj/group-5 | smooth.head.ldlj |
| talk | smooth.armL.ldlj/group-0 | smooth.armL.ldlj |
| talk | smooth.armL.ldlj/group-1 | smooth.armL.ldlj |
| talk | onset.easedOrAnticipated/group-28 | onset.easedOrAnticipated |
| talk | cmu/138/138_37.bvh | chain.leftUpperArm-leftLowerArm.zeroLagCorr, chain.leftLowerArm-leftHand.zeroLagCorr, coverage.arms, bilateral.upperArm.peakCorr, dim.core |
| walk | 100style/100STYLE/Drunk/Drunk_FW.bvh | smooth.head.spikeRate |
| walk | 100style/100STYLE/OnPhoneRight/OnPhoneRight_FW.bvh | chain.rightShoulder-rightUpperArm.zeroLagCorr, chain.rightUpperArm-rightLowerArm.zeroLagCorr, chain.rightLowerArm-rightHand.zeroLagCorr, coverage.core, coverage.arms, bilateral.upperArm.peakCorr, bilateral.lowerArm.peakCorr, bilateral.hand.peakCorr |
| gaze | gaze.chestLagMs/group-16 | gaze.chestLagMs |
| gaze | gaze.chestLagMs/group-22 | gaze.chestLagMs |
| gaze | gaze.chestLagMs/group-38 | gaze.chestLagMs |
| gaze | onset.easedOrAnticipated/group-16 | onset.easedOrAnticipated |
| emotion | onset.attackFraction/group-6 | onset.attackFraction |
| emotion | onset.easedOrAnticipated/group-41 | onset.easedOrAnticipated |

## Known limits

- Existing chain metrics already correlate parent-relative angular velocity. In the 100STYLE idle and walk references, some axial pairs are nearly perfectly correlated: idle neck-head has median correlation 0.999626. The resulting neck-head bands, and the idle spine-chest band, are vacuous and remain REPORT. This prevents the gate from claiming to resolve synchrony that this reference cannot distinguish. Versions 1 and 2 cannot fail neck-head synchrony through that pair in idle or walk; the CMU talk band can. Upper-arm/lower-arm and lower-arm/hand pairs remain gated in all three classes.
- UNVERIFIED: the likely explanation is that the capture solve distributes one measured rotation across neighbouring axial segments, with more axial joints in the 23-joint skeleton than independently measured segments. This has not been established from the capture process and is not a measured fact. The proposed duplicate chainRel family was withdrawn before any character trace was judged; the metric library and all chain definitions remain unchanged.
- Short references give broad bands for single-window clip values; a character median over several windows is less variable. Most whole-trace spectral, burstiness and idle-act statistics therefore remain report only.
- The talk set is dominated by storyteller 138. The held-out clip cmu:138_37 fails five arm-related talk metrics (six in version 1) because the speaker barely moves the arms in its 5 s talk window; core dimensionality also reflects that limited arm activity.
- OnPhoneRight_FW and Drunk_FW each fail one or more arm or smoothness metrics. InTheDark_FW failed the left arm spike rate in version 1 and passes the pooled band in version 2. These failures are retained, not rewritten as passes.
- The natural-style selection includes activities that constrain an arm, including holding a phone, using a walking stick and keeping hands in pockets. This widens the arm bands and makes them more lenient.
- 100STYLE has one performer. Episode draws mix actors and contain dependent trials; the fixed tail margin is the only allowance for those dependencies.
- The manifest contains only one idle range of at least 20 s, Old at about 24.1 s, rather than four. Its loop values are context only. No range was extended and no source was added.
- Root loopPeak < 0.3 transfers a head-loop rule without a fitted human-root distribution. The two seated desk head summaries are context only. Periodicity cannot establish naturalness or rule out every mixture of periodic signals.
- Most body sources have no eyes, fingers, audio or emotion trials. The eye-order, finger, gesture and emotion-separation bands are declared rules. Body references supply no eye floors, so an eye-capable rig can receive missing-eye-floors rather than an eye-lead score.
- Emotion arm share uses four styled standing poses sharing one skeleton, not randomized emotion trials. Its bound is half the smallest measured arm share. Declared thresholds express design choices and have no fitted human validation distribution.

Scores compare motion statistics with bands derived from human capture. They do not prove naturalness or appeal, which stay a visual review.

## Fixed source identifiers and subjects

| Dataset | Clip identifier | Subject | Class | Split | Role |
| --- | --- | --- | --- | --- | --- |
| 100style | 100style/100STYLE/Angry/Angry_ID.bvh | 100style-performer | idle | fit | window |
| 100style | 100style/100STYLE/CrowdAvoidance/CrowdAvoidance_ID.bvh | 100style-performer | idle | fit | window |
| 100style | 100style/100STYLE/Depressed/Depressed_ID.bvh | 100style-performer | idle | fit | window |
| 100style | 100style/100STYLE/Drunk/Drunk_ID.bvh | 100style-performer | idle | holdout | window |
| 100style | 100style/100STYLE/Elated/Elated_ID.bvh | 100style-performer | idle | fit | episode-only |
| 100style | 100style/100STYLE/Followed/Followed_ID.bvh | 100style-performer | idle | fit | window |
| 100style | 100style/100STYLE/HandsInPockets/HandsInPockets_ID.bvh | 100style-performer | idle | fit | window |
| 100style | 100style/100STYLE/InTheDark/InTheDark_ID.bvh | 100style-performer | idle | fit | window |
| 100style | 100style/100STYLE/Neutral/Neutral_ID.bvh | 100style-performer | idle | holdout | window |
| 100style | 100style/100STYLE/Old/Old_ID.bvh | 100style-performer | idle | fit | window |
| 100style | 100style/100STYLE/OnPhoneLeft/OnPhoneLeft_ID.bvh | 100style-performer | idle | fit | window |
| 100style | 100style/100STYLE/OnPhoneRight/OnPhoneRight_ID.bvh | 100style-performer | idle | fit | window |
| 100style | 100style/100STYLE/Proud/Proud_ID.bvh | 100style-performer | idle | fit | episode-only |
| 100style | 100style/100STYLE/Rushed/Rushed_ID.bvh | 100style-performer | idle | fit | episode-only |
| 100style | 100style/100STYLE/Strutting/Strutting_ID.bvh | 100style-performer | idle | holdout | window |
| 100style | 100style/100STYLE/WalkingStickLeft/WalkingStickLeft_ID.bvh | 100style-performer | idle | fit | window |
| 100style | 100style/100STYLE/WalkingStickRight/WalkingStickRight_ID.bvh | 100style-performer | idle | fit | window |
| 100style | 100style/100STYLE/Angry/Angry_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/CrowdAvoidance/CrowdAvoidance_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/Depressed/Depressed_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/Drunk/Drunk_FW.bvh | 100style-performer | walk | holdout | window |
| 100style | 100style/100STYLE/Elated/Elated_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/Followed/Followed_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/HandsInPockets/HandsInPockets_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/InTheDark/InTheDark_FW.bvh | 100style-performer | walk | holdout | window |
| 100style | 100style/100STYLE/Neutral/Neutral_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/Old/Old_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/OnPhoneLeft/OnPhoneLeft_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/OnPhoneRight/OnPhoneRight_FW.bvh | 100style-performer | walk | holdout | window |
| 100style | 100style/100STYLE/Proud/Proud_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/Rushed/Rushed_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/Strutting/Strutting_FW.bvh | 100style-performer | walk | fit | window |
| 100style | 100style/100STYLE/WalkingStickLeft/WalkingStickLeft_FW.bvh | 100style-performer | walk | holdout | window |
| 100style | 100style/100STYLE/WalkingStickRight/WalkingStickRight_FW.bvh | 100style-performer | walk | fit | window |
| cmu | cmu/013/13_26.bvh | 13 | talk | fit | episode-only |
| cmu | cmu/013/13_27.bvh | 13 | talk | fit | episode-only |
| cmu | cmu/013/13_28.bvh | 13 | talk | holdout | episode-only |
| cmu | cmu/014/14_24.bvh | 14 | talk | fit | episode-only |
| cmu | cmu/014/14_25.bvh | 14 | talk | fit | episode-only |
| cmu | cmu/014/14_26.bvh | 14 | talk | holdout | episode-only |
| cmu | cmu/018/18_08.bvh | 18 | talk | fit | window |
| cmu | cmu/018/18_09.bvh | 18 | talk | fit | episode-only |
| cmu | cmu/018/18_10.bvh | 18 | talk | fit | window |
| cmu | cmu/018/18_11.bvh | 18 | talk | holdout | window |
| cmu | cmu/019/19_08.bvh | 19 | talk | fit | window |
| cmu | cmu/019/19_09.bvh | 19 | talk | fit | episode-only |
| cmu | cmu/019/19_10.bvh | 19 | talk | fit | window |
| cmu | cmu/019/19_11.bvh | 19 | talk | holdout | window |
| cmu | cmu/022/22_21.bvh | 22 | talk | fit | episode-only |
| cmu | cmu/023/23_21.bvh | 23 | talk | fit | episode-only |
| cmu | cmu/069/69_12.bvh | 69 | walk | fit | episode-only |
| cmu | cmu/069/69_18.bvh | 69 | walk | fit | episode-only |
| cmu | cmu/069/69_19.bvh | 69 | walk | holdout | episode-only |
| cmu | cmu/069/69_48.bvh | 69 | walk | fit | episode-only |
| cmu | cmu/069/69_49.bvh | 69 | walk | holdout | episode-only |
| cmu | cmu/080/80_48.bvh | 80 | talk | fit | window |
| cmu | cmu/138/138_11.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_12.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_13.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_14.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_15.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_16.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_17.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_18.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_19.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_20.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_21.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_22.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_23.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_24.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_25.bvh | 138 | talk | fit | episode-only |
| cmu | cmu/138/138_26.bvh | 138 | talk | fit | window |
| cmu | cmu/138/138_27.bvh | 138 | talk | fit | window |
| cmu | cmu/138/138_28.bvh | 138 | talk | fit | window |
| cmu | cmu/138/138_29.bvh | 138 | talk | holdout | window |
| cmu | cmu/138/138_30.bvh | 138 | talk | fit | window |
| cmu | cmu/138/138_31.bvh | 138 | talk | fit | window |
| cmu | cmu/138/138_32.bvh | 138 | talk | fit | window |
| cmu | cmu/138/138_33.bvh | 138 | talk | holdout | window |
| cmu | cmu/138/138_34.bvh | 138 | talk | fit | window |
| cmu | cmu/138/138_35.bvh | 138 | talk | fit | window |
| cmu | cmu/138/138_36.bvh | 138 | talk | fit | window |
| cmu | cmu/138/138_37.bvh | 138 | talk | holdout | window |
| cmu | cmu/138/138_38.bvh | 138 | talk | fit | window |
| cmu | cmu/138/138_39.bvh | 138 | talk | fit | window |
| cmu | cmu/138/138_40.bvh | 138 | talk | fit | window |
