# arm-hand-motion - Work Plan

Status: slices T0 and H1 to H6 built, 2026-11-25; follow-ups in section 6. Builds on the walk style work ([plan](walk-style.md)). Roadmap rows: Walk and Idle life, in [`docs/ai/context/3d-character-roadmap.md`](../../docs/ai/context/3d-character-roadmap.md). Required reading for every worker: the `enforce-rules-for-render-loops`, `enforce-rules-for-typescript`, `enforce-rules-for-vitest` and `motion-qa` skills, [Body ownership](../../docs/ai/context/body-ownership.md), and the nested `AGENTS.md` of each package touched.

## TL;DR (For humans)

**Goal.** Hands that look right on every MMD rig, in every behaviour: standing, walking, gestures, emotions, idle acts and rest. Then a hand that follows the same factors the walk follows.

**What was wrong (measured 2026-11-24 on `main`).**

- The adapter curls every finger joint about the model's Z axis and assumes the palm faces straight down at bind. On 23 of 25 library rigs the knuckle axis is 10 to 15 degrees off Z.
- Finger curl is added to whatever bend a rig has at bind, which runs from 16 degrees flexed to 23 degrees bent back per joint: as large as the relaxed curl itself.
- The finger spread and thumb opposition channels are generated but never written to a bone.
- The wrist rests 8 degrees flexed. Every reference walk carries it extended.
- The walk drives shoulder, elbow, abduction and clavicle only. The forearm never rolls.
- Upper-arm twist and pronation are written to the arm and hand bones. The twist bones every rig has are not used.
- `GaitStyle` has nothing for the hand.

**What does not change.** Arm swing, elbow swing and their timing sit inside the reference ranges and stay as they are. Ownership stays as [Body ownership](../../docs/ai/context/body-ownership.md) states it: one writer per arm and finger group, clips duck it.

## 1. Evidence

No clip, rig or script is committed. Angles are degrees.

### 1.1 The walk on `main` (reference rig, neutral style, 27.6 s of walking)

| Joint | Mean | 5th to 95th percentile |
| --- | --- | --- |
| Shoulder flexion | 0 | -10 to 14 |
| Elbow flexion | 24 | 12 to 46 |
| Upper-arm twist | 0 | -1 to 1 |
| Forearm pronation | -6 | -6 to -5 |
| Wrist flexion (palmar positive) | 7.5 | -1 to 17 |
| Wrist deviation | 1 | -7 to 10 |

Finger curl is the rest pose plus passive drag: index 15, 20, 10 from knuckle to tip, little finger 22, 29, 15.

### 1.2 Acted mocap walks

Bandai Namco Research Motiondataset 1 and 2 (CC BY-NC 4.0), one straight walk clip per style. The skeleton has a hand joint and no fingers. Wrist extension is the hand's rotation about the axis the elbow does not flex about; the sign is read from the arm frame's axes, and the feminine styles reading highest supports it.

| Style | Wrist extension, mean (left, right) | Forearm roll within a stride |
| --- | --- | --- |
| normal (set 1) | 24, 26 | 11 |
| normal (set 2) | 7, 11 | 17 |
| feminine (set 1, set 2) | 33 and 31, 46 and 51 | 12, 15 |
| happy | 31, 38 | 19 |
| childish | 32, 24 | 17 |
| masculinity, masculine | 14 and 10, 2 and 0 | 16, 14 |
| proud | 11, 11 | 7 |
| sad | 5, 12 | 3 |
| youthful | 6, 9 | 36 |

No style carries the wrist flexed. The wrist moves 8 to 15 degrees within a stride in a normal walk and up to 30 in happy and feminine walks.

### 1.3 Authored MMD walks and runs

73 VMD files from five packs of the VPVP wiki motion list. Most key the wrist and each finger once: the hand is one pose per style.

- **Wrist:** extended 10 in normal, slow, fast and energetic walks; 15 to 30 in feminine, lady-like, skip and Monroe walks; 0 in runs with fists. Never flexed. Where it is animated it moves 5 to 13 degrees.
- **Fingers, summed curl of the index finger's three joints:** 14 to 17 (model and feminine walks, an open hand), 43 (normal walks), 94 (a loose curl), 266 to 294 (a fist: masculine and energetic walks, most runs). One pack curls the little finger more than the index (index 117 to 159, little 183 to 248).
- **Arm twist bone (`腕捩`):** keyed in about half the files, held at 18 to 20 or swinging 13 to 16 either way within a stride.
- **Wrist twist bone (`手捩`):** keyed only in aimed poses (32 to 76) and some runs (up to 40).
- **Upper arm and elbow:** swing -10 to 13 and bend 5 to 20 in normal walks, which the walk on `main` covers.

### 1.4 Bind hands of 25 library rigs

Measured from PMX bone positions: the palm plane from the wrist and the index, middle and little knuckles.

| Measure | Range across rigs |
| --- | --- |
| Knuckle axis away from model Z | 2 to 19, 10 to 15 on 23 rigs |
| Palm rolled about the hand's axis from facing down | 5 to 21 |
| Bind bend per finger joint (flexed positive) | -23 to 16 |
| Bind bend of the wrist | -9 to 5, deviation -3 to 11 |
| Hand length over arm length | 0.28 to 0.36 |
| Rest arm below horizontal | 33 to 44 |
| `腕捩` and `手捩` present | 25 of 25 |
| PMX local axes set on finger bones | 14 of 25 |

Bone centres zigzag on some rigs (one family reads 11 flexed at the knuckle and 9 bent back at the next joint, with a straight finger mesh), so a per-joint correction from bone centres alone can over-correct. H1 must settle this against rendered meshes.

## 2. Design

### 2.1 Hand calibration (stage-ui-mmd)

The rig profile reads a hand calibration per side from the PMX: the palm normal, each finger's curl axis, the bind bend of the wrist and of each finger joint, and the bind spread. The performer's arm write uses it, so a channel angle means the same hand on every rig: curl 0 is a finger straight along the palm, spread 0 is fingers parallel, wrist 0 is the hand in line with the forearm.

Spread turns each finger's first joint about the palm normal, fanned about the middle finger. Opposition folds the thumb's first joint across the palm.

### 2.2 Twist bones (stage-ui-mmd)

When a rig has `腕捩` and `手捩`, upper-arm twist goes to `腕捩` and pronation to `手捩`, each about the bone's fixed axis. The posed segment directions and the hand's world rotation stay what they are today; only the mesh between the joints changes. A rig without them keeps today's write.

### 2.3 Hand carriage (motion-driver-humanoid)

The rest wrist moves from 8 flexed to about 10 extended, the value authored walks hold. `GaitStyle` gains two values, applied by the gait's weight as `elbowCarry` is:

- `wristCarry`: extension added to the rest wrist, radians.
- `handCurl`: finger curl as a share of the rest curl, from an open hand to a fist.

`walkStyleFrom` moves them by the same factors as the rest of the walk. Signs from section 1: valence and arousal extend the wrist (happy, childish, feminine); sadness and fatigue drop it toward neutral; tension closes the hand toward a fist; a graceful baseline opens the hand and extends the wrist, a bold one closes it.

### 2.4 Forearm roll (motion-driver-humanoid)

The gait's arm swing gains twist and pronation terms: the arm turns inward at the front of its swing and back at the rear, sized by `armSwing`, through the same follower inverse as the other swung joints.

### 2.5 Review tooling (lab-tools)

`lab:motion3d frames` and `clip` draw the whole body at 300 by 450 pixels, where a hand is a few pixels. They gain a close-up: a bone to centre on and a span in model units. The `walk-style` report gains wrist carriage, forearm roll and finger curl beside the ranges of section 1.

## 3. Slices

1. **T0, close-up frames (S).** The `frames` and `clip` close-up. Acceptance: a hand fills the frame on two rigs; the default output is byte-identical.
2. **H1, hand calibration (M).** Section 2.1, with spread and opposition written. Acceptance: on eight rigs a fist closes without fingers crossing or spiralling, a flat hand is flat, the relaxed hand curls evenly; rigs without finger bones are unchanged.
3. **H2, twist bones (S).** Section 2.2. Acceptance: traced arm and hand rotations are unchanged within 0.01 degrees on a `speak` and a `walk` run; the forearm mesh twists along its length in a palm-up gesture.
4. **H3, hand carriage (M).** Section 2.3. Acceptance: unit tests for bounds and monotonic response; neutral factors give the neutral style; the collision corrector reports no new holds on the rig matrix.
5. **H4, forearm roll (S).** Section 2.4. Acceptance: roll within a stride lands inside 7 to 20 degrees at the neutral style; walk-form, pops and skate keep their results.
6. **H5, measurement (S).** The `walk-style` additions of section 2.5.
7. **H6, behaviour pass (M).** Every hand shape and every behaviour that poses a hand (gestures, emotions, idle acts, rest clasp, touch reactions) reviewed on the rig matrix after H1 to H4, and corrected where the calibrated hand exposes a wrong recipe.

T0 and H5 touch only lab-tools and run beside H1 and H2. H3 and H4 follow H1. H6 follows all.

## 4. How it is judged

1. **Structure:** `walk-form`, `pops`, skate, and the gate on `gaze-shift` and `speak` keep their verdicts.
2. **Range:** wrist carriage, forearm roll and finger curl stay inside the ranges of section 1 across the factor grid.
3. **Direction:** moving a factor moves each hand measure it maps to in the direction section 2.3 states.
4. **Visual review:** close-up stills and clips on the rig matrix, by reviewers who did not write the change. Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review.

Rig matrix: the reference rig, the two collision and arm test rigs, and five more chosen for their bind hands (a metacarpal bone, a knuckle axis near Z, the largest palm roll, the largest bind bend, bare arms).

## 5. Decisions (defaults applied; the owner can veto)

- **D1. The neutral wrist rests 10 degrees extended**, the authored-walk value, not the mocap mean of about 20. Style adds the rest.
- **D2. Calibration comes from bone geometry on every rig.** PMX local axes are set on only 14 of 25 rigs, so they are not a second path.
- **D3. Hand style rides the gait's weight**, as `elbowCarry` does. Standing hand shape stays with the emotion layer.
- **D4. No new card editor control.** The existing baseline values `armCarry` and `armSwing` also move the hand. A hand control of its own waits for a visual review that asks for it.
- **D5. Out of scope:** finger animation within a stride, props, VRM, and Live2D.

## 6. Outcome and follow-ups

Decisions taken while building, beyond section 5:

- **Bind bends come off half per joint and half per finger.** Bone centres zigzag inside straight finger meshes on some rigs, so a per-joint correction alone kinks them, and a whole-finger correction alone leaves authored bent-back tips. Compared on rendered flat hands of ten rigs.
- **The palm the adapter poses is the palm the arm kinematics assume.** A rig's bind roll about the hand's axis comes off with the wrist's bind bend, on the wrist twist bone where the rig has one.
- **Twist bones carry the whole twist.** A share by rig or by sleeve was not built: full twist on the twist bones is how these rigs are authored, and bare forearms and fitted cuffs improved with it. A puffy sleeve wrings at 60 degrees of pronation.
- **Body proxies are fitted to each rig's rest hang.** A proxy the rest arms enter shrinks about its centre until they clear it. Before this one rig's arms never moved and three more stood with distorted rests.
- **`wristCarry` is bounded at -10 to 12 degrees.** At 30 the hand looked braced, and with the old wrist drag a happy walk waved at each step. The wrist now trails the forearm's swing instead of the elbow's rate.
- **The walk's closed hand blends toward the fist shape**, and shapes blend in the hand's closing order: knuckles lead a closing hand and fingertips lead an opening one.

Open:

- The thinking hand's contact point is one hand length along the palm, not the posed index fingertip, which sits about 0.05 model units inside the face proxy. Placing the real fingertip made the search back the hand off to the chest; the search's back-off and upright-hand preference need rework around a fingertip contact.
- During a clip fade over a twist bone that sits off its segment line, the upper arm's length changes by up to 0.4 percent.
- The corrector's 6 degree step cap counts shoulder flexion and abduction, not the elbow.
- The hair tuck's palm-facing solve costs 68 guard scans in a 120 s idle run on one rig, and five rigs whose wrist limits allow no palm-facing pair still touch the hair with the palm forward.
- Hands still pass into physics-driven cloth (skirts, tails, hip pouches), which the corrector leaves to the simulation by design.
- `wristMove` in the walk-style report reads 0.8 to 2.5 degrees against an acted range of 5 to 30: the trail turns the hand mostly as deviation, because the walking palm faces the thigh.
- No rendered-app review yet: every visual check ran on the grey posed mesh.

