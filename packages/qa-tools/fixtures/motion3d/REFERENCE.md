# Human-reference bands for mmd-motion-quality v1

Frozen bands SHA-256: `c5a5a8eee5c5e3668cbb081d084b3da62ef9441787a975fc5607886e720230d7`.
Derived by tool commit `76816856c34831879d9267d428a09b4a16019c65` on 2026-11-11T08:37:18.947Z.

Only derived statistics are stored in bands-v1.json. No raw motion, model, texture, joint trajectory, or capture is committed. Clip identifiers and subjects below document provenance; raw sources remain outside the repository.

## Sources and licences

- 100style: https://zenodo.org/records/8127870. Licence recorded in the fixed manifest: CC BY 4.0; Mason et al., 100STYLE Selected clips: 34.
- cmu: https://mocap.cs.cmu.edu/. Licence recorded in the fixed manifest: CMU: may be copied, modified or redistributed; no resale of the data itself. BVH conversion: una-dinosauria/cmu-mocap. Selected clips: 52.
- CMU BVH conversion credit: una-dinosauria/cmu-mocap (https://github.com/una-dinosauria/cmu-mocap).

The source selection and split were fixed before measurement. Manifest SHA-256: `023f898ad02a2351befe2a38cd8a7c2013fa0d9fc412e623a9cbb49f65a00a91`. All 86 entries were attempted. The unchanged upright-admission rule refuses fitting clip cmu:138_32 (30 of 454 frames, 6.6079 percent, exceed the non-upright allowance of 1 percent). Its identifier, hash, subject and refusal remain in bands context.admission; no manifest entry was removed or moved. All held-out sources admit.

100style:InTheDark_FW (10,245 frames) and 100style:Old_FW (14,949 frames) both ingest after the large-block codec correction. Window-source counts after admission are idle 11 fitting / 3 held-out, talk 16 / 5, and walk 13 / 4. No class uses an 8 s fallback.

## Held-out validation and its timing

A fitted metric stays gated, without any changed bound, when zero or one held-out unit fails it. Two or more failures make that metric REPORT with detail `holdout-failures: <n>`. Units are clips for clip fits and consecutive groups of eight episodes for pooled fits. Declared bands are unchanged. Every original held-out verdict, value and failed metric remains in the bands file.

The P5 to P95 interval plus a fixed margin can miss isolated unseen values. A clip is judged on about 25 metrics, so an occasional isolated failure is expected by chance. Repeated failures indicate that a metric is not reliable enough to gate unseen human motion. This tolerance was set after the held-out results were inspected and before any character trace was judged. It is a post-selection decision, not independent validation.

The file retains 400 PASS and 12 FAIL unit verdicts. Only gaze.chestLagMs has repeated failures: groups 16, 22, 38 fail, so its status is REPORT with `holdout-failures: 3`. All other failing metrics have one failing unit and retain their original fitted bands. No percentile, margin, numeric bound, detector parameter or source split changed.

| Class | Failing clip or episode group | Failed metrics |
| --- | --- | --- |
| idle | 100style/100STYLE/Drunk/Drunk_ID.bvh | period.hips.acfPeak |
| talk | smooth.head.ldlj/group-5 | smooth.head.ldlj |
| talk | smooth.armR.ldlj/group-0 | smooth.armR.ldlj |
| talk | onset.easedOrAnticipated/group-28 | onset.easedOrAnticipated |
| talk | cmu/138/138_37.bvh | chain.leftUpperArm-leftLowerArm.zeroLagCorr, chain.leftLowerArm-leftHand.zeroLagCorr, coverage.arms, bilateral.upperArm.peakCorr, bilateral.hand.peakCorr, dim.core |
| walk | 100style/100STYLE/Drunk/Drunk_FW.bvh | smooth.head.spikeRate |
| walk | 100style/100STYLE/InTheDark/InTheDark_FW.bvh | smooth.armL.spikeRate |
| walk | 100style/100STYLE/OnPhoneRight/OnPhoneRight_FW.bvh | chain.rightShoulder-rightUpperArm.zeroLagCorr, chain.rightUpperArm-rightLowerArm.zeroLagCorr, chain.rightLowerArm-rightHand.zeroLagCorr, coverage.core, coverage.arms, bilateral.upperArm.peakCorr, bilateral.lowerArm.peakCorr, bilateral.hand.peakCorr |
| gaze | gaze.chestLagMs/group-16 | gaze.chestLagMs |
| gaze | gaze.chestLagMs/group-22 | gaze.chestLagMs |
| gaze | gaze.chestLagMs/group-38 | gaze.chestLagMs |
| gaze | onset.easedOrAnticipated/group-16 | onset.easedOrAnticipated |

## Known limits

- Existing chain metrics already correlate parent-relative angular velocity. In the 100STYLE idle and walk references, some axial pairs are nearly perfectly correlated: idle neck-head has median correlation 0.999626. The resulting neck-head bands, and the idle spine-chest band, are vacuous and remain REPORT. This prevents the gate from claiming to resolve synchrony that this reference cannot distinguish. Version 1 cannot fail neck-head synchrony through that pair in idle or walk; the CMU talk band can. Upper-arm/lower-arm and lower-arm/hand pairs remain gated in all three classes.
- UNVERIFIED: the likely explanation is that the capture solve distributes one measured rotation across neighbouring axial segments, with more axial joints in the 23-joint skeleton than independently measured segments. This has not been established from the capture process and is not a measured fact. The proposed duplicate chainRel family was withdrawn before any character trace was judged; the metric library and all chain definitions remain unchanged.
- Short references give broad bands for single-window clip values; a character median over several windows is less variable. Most whole-trace spectral, burstiness and idle-act statistics therefore remain report only.
- The talk set is dominated by storyteller 138. The held-out clip cmu:138_37 fails six arm-related talk metrics because the speaker barely moves the arms in its 5 s talk window; core dimensionality also reflects that limited arm activity.
- OnPhoneRight_FW, InTheDark_FW and Drunk_FW each fail one or more arm or smoothness metrics. These failures are retained, not rewritten as passes.
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
