# body-model - Work Plan

Status: implemented, 2026-11-25, in two pull requests: the arm clearance measure (slices G1 to G3), then the body model (slices B1 to B7). The [body model ADR](../../docs/ai/adr/2026-11-25-body-model.md) records the decisions, the measured results and the known limits. Section 7 lists where the build departed from this plan. The resting arm carriage awaits the owner's visual review.

## TL;DR (For humans)

**Goal.** She knows where her own body is. One renderer-neutral body model, built from the mesh and its skin weights, tells every part of the character where her body, her rigid clothing and her soft garments are. The arm guard is its first reader. The VRM adapter, touch, props and terrain contact are later readers of the same model.

**Why.** The arm guard takes its obstacles from the rigid bodies the model's author built for cloth physics. Those bodies describe the cloth simulation, not her body. On 12 of 32 library rigs an arm rests inside a coat or skirt for the whole idle. On 3 rigs an oversized cloth blocker traps the guard. Neither failure can be fixed while the author's physics rig stays the description of her body.

**What changes.**

- A new measure counts the frames in which an arm passes through her clothing or body, in headless runs with physics on, over a folder of models.
- `motion-driver-humanoid` gains a body model: hard volumes for the body and rigid clothing, soft garments with their rest shape, measured limb thickness, and the rest clearance each arm needs.
- The MMD adapter builds the model from the mesh. The arm guard clears the model's volumes. The author's rigid bodies drive the cloth simulation only.
- The simulated garments collide with the arms, so loose cloth yields to an arm.
- The arm rest pose comes from the model's rest clearance, solved once at load, instead of a solver that lifts the arm while frames run.

**What does not change.** The performer's corrector, the gesture and gait code, the physics backend, touch, and clip-driven arms. The body model changes the corrector's obstacle list and the rest abduction, nothing else.

## 1. Evidence

Measured on 2026-11-24 at `5fbad4da0` with a scratch harness: 32 MMD characters from the owner's model library, the `idle-drive`, `speak` and `walk` scenarios, 40 s scored, seed 1, physics on, sampled at 30 Hz. A frame counts as pierced when the centreline of the lower upper arm, the forearm or the palm crosses a triangle of her body or clothing that the arm does not wear. No model or clip is committed, and scripts that read the library stay outside the repository.

**Baseline.**

- 12 rigs are pierced in 90 % or more of idle frames: Sparxie, Robin, Chisa, Denia (three variants), Lily, Aria (two variants), Ellen, Nicole and Sunna. The episode lasts the whole run, so the resting pose is inside the garment.
- 19 rigs stay under 5 % in every scenario, and 14 of them are never pierced. Carlotta sits between, at 4 to 10 %.
- The pierced surface is simulated cloth. Rigid geometry is pierced on one rig (Aria, her lower body).
- The guard is trapped on 3 rigs. On Sparxie and Robin the performer reports no clear arm pose on every tick and holds the arm. On Aha it does so on 498 ticks, and her upper arms rest 81 degrees from vertical. A capsule named for blocking, wider than the shoulder span, holds the shoulder joint.
- The guard's own cloth measure (`clothContact`) does not track the surface. Lily is pierced in 100 % of idle frames with 0 % contact. Vivian has 100 % contact and is never pierced.
- The author's collision masks keep arms and cloth apart: on 24 of 34 model files, fewer than a quarter of the cloth bodies can collide with any arm body.

**Prototypes.** Each ran on 11 of the 12 pierced rigs. "Fixed" means under 5 % in all three scenarios.

| Prototype | Fixed | Cost |
| --- | --- | --- |
| The guard takes the author's cloth bodies as obstacles at their bind shape | 7 | Arms 7 to 12 degrees further out; 5 to 10 degrees on four rigs that had no problem |
| Arms collide with cloth in the simulation (masks repaired) | 2 | On most rigs the cloth jitters: up to 35 % of cloth vertices reverse direction per sample |
| Both of the above | 8 | Similar arm cost, little added jitter |
| Obstacles fitted to the whole mesh, garments included | 9 | Traps the guard on Sunna, Remielle and Aha; Aria's arms at 76 degrees |
| Obstacles fitted to rigid geometry only, with masks repaired | 8 | Arms 4 to 8 degrees further out; frees Sparxie and Robin |

No prototype fixes every rig. The last one has the lowest cost. It misses Nicole, whose hips are skinned to simulated bones, and both Aria rigs, whose dress has stiff panels.

**Reference motion.** 30 generic VMD clips (walks and standing gestures) pierce 23 to 86 % of frames on the pierced rigs and 44 % on Yuzuha, which our own motion never pierces. Clipping under authored clips is the norm for these models; the guard does not steer clips.

**Limb thickness.** The sleeve's 90th percentile radius is about 0.25 of its segment length on the median rig (0.13 to 0.67). The guard's capsule assumes 0.12 to 0.15. Shallow overlap of sleeve and clothing is therefore likely and is not counted by the centreline measure.

## 2. Design

### 2.1 The arm clearance measure (qa-tools)

The measure is read-only and runs after each pipeline step of a headless run, so a run with it is byte-identical to a run without it.

- **Static analysis, once per model.** Each triangle gets a class from the dominant bones of its corners: upper or lower body, rigid or simulated, head, hair. A triangle leaves the test when a corner carries arm-bone weight, when a corner lies within 1.25 sleeve radii of the bind-pose arm from the middle of the upper arm down, or when the arm's centreline crosses it with the arms in the bind pose and the cloth settled. Those are garments the arm wears.
- **Per sampled frame.** The body-region vertices are skinned on the CPU from the posed bones, physics-driven bones included. For each arm, three segments (middle of the upper arm to the elbow, elbow to wrist, wrist to the base of the middle finger) are tested against the triangles.
- **Reported per run.** The share of frames pierced, by class and by material; how deep (the share of the arm beyond the first crossing); the episodes; the mean upper-arm angle from vertical; the cloth's travel and the share of cloth vertices that reverse direction per sample; the performer's ticks without a clear arm pose.
- **Over a folder of models.** One command runs the scenarios on every model of a folder and writes one results file. It compares two results files rig by rig.

### 2.2 The body model (motion-driver-humanoid)

A pure module with no three.js and no PMX types. Lengths are model units in the axes of `BodyRigTraits`: +X her left, +Y up, +Z forward.

**Input, `BodyMeshSource`.** Bind-pose vertex positions; up to four bone indices and weights per vertex; each bone's parent and bind position; the canonical bones' indices (hips, the spine chain, neck, head, both arms and hands, both legs); and the simulated bones, each with its mobility (the farthest the simulator can carry the bone's tail from its bind place relative to its nearest unsimulated ancestor) and whether the simulator collides it with an arm.

**Output, `BodyModel`.**

| Part | Meaning |
| --- | --- |
| `volumes` | Hard obstacles as `BodyCollider`s on canonical bones: her body, her rigid clothing, and flesh on simulated bones of low mobility. Leg volumes carry the `leg` field, so they turn with the gait. |
| `garments` | Soft garments: the simulated bones of one garment, the canonical bone it hangs from, its rest silhouette as colliders, and whether it is stiff. |
| `limbs` | Each arm segment's measured radius as a share of its length. |
| `rest` | Per arm: the abduction at which the resting arm clears the hard volumes and, within a bound, the garments; and what limited it, if anything. |
| `report` | Counts and the reasons for every volume that was shrunk or dropped. |

**Rules.**

1. Nothing in the model comes from authored physics shapes. Authored joints inform only the mobility of simulated bones, and authored collision groups only which simulated bones collide with an arm.
2. A vertex belongs to the arm when any arm bone weighs on it, or when it lies within the measured limb radius of the bind-pose arm from the middle of the upper arm down. Arm vertices never form an obstacle.
3. A simulated bone of low mobility is flesh, and its vertices join the hard volumes. Above the flesh threshold the bone belongs to a garment. Thresholds are shares of the shoulder span, named constants with their measured source.
4. Hard volumes are fitted per canonical segment in height slices: a capsule lying left to right, as deep as the slice and as wide as the slice, attached to the canonical bone that carries most of the slice's vertices. Limbs get capsules along the bone.
5. Above the armpit a volume stays inside the shoulder joints.
6. The resting arm always clears the hard volumes. The rest solve picks the smallest abduction, from the default hang up to a bound, at which the performer's own arm test clears them. If no abduction within the bound clears a volume, that volume shrinks until one does, and the report names it.
7. Garments add to the rest abduction up to `REST_GARMENT_CLEARANCE_MAX` beyond the hard-clear rest. Overlap that remains is left to the simulator, and the report names the garment. The bound is a style range, so the style system can later choose within it.
8. A garment the simulator collides with the arm is cleared as a hard volume is, up to the widest rest the runtime hang solver allowed (30 degrees), when the arm's capsule overlaps its rest shape and the arm's centreline is out of it. The simulator pushes such a garment off the arm on every step, so an arm that leans on its edge keeps it moving.
9. The build is deterministic and takes no time or random input.

### 2.3 The MMD adapter (stage-ui-mmd)

- `MMDBody` builds a `BodyMeshSource` from the mesh geometry, the rig profile and the PMX joints, and builds the model once at load.
- `BodyRigTraits.colliders` takes the model's volumes, from the hips to the head. `MMDArms` measures the same volumes. The author's bone-following bodies no longer reach the guard.
- The collider overlay draws the model's volumes, so the fit can be reviewed by eye.
- The diagnostics snapshot gains appended fields: volume and garment counts, the rest abduction per side, and the model's limits.
- `clothContact` keeps reading the author's simulated bodies. It stays information only.

### 2.4 Secondary motion boundary

The author's rig drives the cloth. The body model tells the simulator which bodies are arms and which bones are soft garments. For MMD and Ammo, one function runs before `mmd.setPhysics` in the scene's animation manager and in the headless loader: the arm's bone-following bodies move to an unused collision group, every body that collided with their old group keeps doing so, and the soft garments' bodies gain that group. Stiff garments are left out, because a stiff panel pinched by a driven arm jitters. A rig without arm bodies is reported and left alone.

This boundary is what a later physics backend, or the VRM spring bones, implements instead.

### 2.5 Rest clearance

The performer's rest abduction takes `rest[side].abduct` from the model. The solver in `MMDArms` that lifts the arm while frames run is removed with its warm-up and persistence constants. The debug hang override keeps working. The lift becomes per side.

### 2.6 Later readers of the model

Each waits for its own milestone or for evidence. None is built by this plan.

| Reader | Uses | Waits for |
| --- | --- | --- |
| Mesh-fitted head | The head's and the neck's hard vertices as a skull, a jaw and a face, in place of the author's head and neck bodies | Its own piece of work, with the face-touch gestures tuned against it. One sphere on the head cost the hair tuck on 8 rigs, moved the thinking hand's keys and gave the chin no surface (section 7). |
| VRM adapter | The same `BodyMeshSource`; spring-bone colliders from `volumes` and `limbs` | Milestone M5 |
| Props and terrain contact | `volumes` as the surface a hand or a seat rests on | Milestone M4 and Props |
| Touch | `volumes` and `garments` as hit targets | A measured touch miss on a library rig |
| Arm capsule from `limbs` | The corrector's arm radius | A sleeve-surface overlap measure |
| Clip-driven arms | Garment contact from the simulator only | The owner's decision to steer clips |
| Physics backend | The secondary motion boundary | The roadmap's open frame-rate question. Headless, the physics step's 95th percentile is 18.8 ms on Chisa and 17.4 ms on Lily. |

## 3. Slices

Each slice is one or more atomic commits that pass `pnpm verify`. A doc that states a changed rule changes in the same commit.

### Pull request 1: the measure

| Slice | Change |
| --- | --- |
| G1 | `qa:motion3d run --clearance` adds a `clearance` block to the run summary. The module lives under `packages/qa-tools/src/t2-3d/clearance/`, with unit tests on a synthetic skinned mesh. A test proves the trace is identical with and without the flag. |
| G2 | `qa:motion3d clearance` runs the scenarios over a folder of models, three runs at a time, writes `clearance.json`, prints the table, and compares two files with `--compare`. `--fail-above <share>` sets the exit code. |
| G3 | The qa-tools README, [Testing and QA](../../docs/ai/context/testing.md), and, in a commit of its own, the motion-qa skill. |

Done when, on `main`, the measure reproduces the baseline of section 1 on Chisa, Sparxie, Yuzuha and Bronya within 5 points, and reports Sparxie's ticks without a clear arm pose.

### Pull request 2: the body model

| Slice | Change |
| --- | --- |
| B1 | The `body-model` subpath of `motion-driver-humanoid`: `BodyMeshSource`, `BodyModel`, the fit, the rest solve, and tests on synthetic meshes (a bare torso, a rigid jacket, a flared simulated skirt, simulated flesh, a blocker-sized shoulder shell). |
| B2 | The MMD adapter that reads the mesh, the rig profile and the PMX joints into a `BodyMeshSource`, with tests on a rig fixture. |
| B3 | `MMDBody` hands the model's volumes to the traits and to `MMDArms`. The overlay draws them. The diagnostics fields are appended. Authored bone-following bodies leave the guard. |
| B4 | The arm and soft-garment collision groups, applied before `setPhysics` in the scene and in the headless loader. |
| B5 | The rest abduction from `model.rest`. The runtime hang solver is removed. |
| B6 | The clearance command's documented limits become the gate: the motion-qa skill and Testing and QA say when to run it. |
| B7 | The body model ADR with the measured before and after, [Body ownership](../../docs/ai/context/body-ownership.md), the [Glossary](../../docs/ai/context/glossary.md) (body model, hard volume, garment, rest clearance), the [3D character roadmap](../../docs/ai/context/3d-character-roadmap.md), and the package READMEs. |

## 4. Acceptance

Measured with `qa:motion3d clearance` on the 32 library rigs, three scenarios, 40 s, seed 1, against `main`.

| Id | Criterion |
| --- | --- |
| A1 | No rig has a performer tick without a clear arm pose in `idle-drive`. |
| A2 | Every rig is pierced in under 5 % of `idle-drive` frames, except rigs the model reports as limited. At most 3 rigs are limited, and the ADR names each with its reason. |
| A3 | In `speak` and `walk`, no rig is pierced more than 5 points above `main`. |
| A4 | The 19 rigs that are clean on `main` stay under 5 % in every scenario. |
| A5 | No rig's mean upper-arm angle moves out by more than 8 degrees against `main`. Aha's falls. Any exception is listed with its cause. |
| A6 | No rig's share of reversing cloth vertices rises by more than 2 points. |
| A7 | On the heaviest rig, the pose stages' and the physics step's 95th percentile stay within 10 % of `main`. |
| A8 | `pnpm lab:motion3d gate` on the QA rig: no criterion that passes on `main` fails. A changed capability (`clasp`, `hairTouch`, `gestures`, `headClearance`) is listed. |
| A9 | `pnpm verify` passes with the checks [Testing and QA](../../docs/ai/context/testing.md) lists for MMD body motion and app runtime code, and `qa:motion3d run --verify-determinism` holds. The first wording asked for `pnpm verify --gate`; since 2026-11-24 the root `AGENTS.md` keeps the gate for upstream syncs. |
| A10 | The desktop app starts with an MMD model without renderer errors, and a screenshot shows the resting arms outside the garment on two rigs that are pierced on `main`. |

A criterion that is not met is reported with its numbers. No threshold in this section and no gate constant is changed to make a run pass.

## 5. Coordination

The arm and hand work (pull request 97) reached `main` first, on 2026-11-25, with `BodyCollision.fit`: the corrector shrinks each proxy the rest hang lies in, and `MMDBody` scales the arm gate's copies of the bodies by the same factors. The body model was rebased onto it.

The two works meet in one rule: **the rest hang is a trait of the rig.** The model's rest abduction reaches the performer as `BodyArmTraits.restAbduct`, so the seeded rest pose, the reference the corrector fits its proxies to, and the pose every arm form starts from are the rest the model solved. Fitted at the default hang, the corrector shrank 1 to 6 of the model's volumes on 30 of the 32 rigs, which undid rule 6 where the model had opened the rest. Fitted at the model's rest it shrinks none on 22 rigs, and on the other 10 it shrinks 1 to 3 thigh, hip or waist volumes on some seeds, by 14 % at most: the seed draws the hang up to 2 degrees inside the solved one, and the fit keeps a headroom of 0.05 of the segment where the solve keeps 0.03.

The first wording of this section expected that the fit would find nothing and that this plan would not edit `collision.ts`. Both changed. The rest solve must measure the volumes whole, so `BodyCollision` takes a flag that leaves its proxies unfitted, and the performer's rest pose reads the trait in `arms.ts`. `armLift` stays a per-tick input for the debug hang override only, as an offset from the rig's rest. The ADR's decision 12 records the numbers.

## 6. Not decided

- The owner's visual review of the resting arm carriage on coat and skirt rigs.
- Whether the garment clearance bound becomes a style parameter of the arm carriage, and its range.
- The readers of section 2.6.

## 7. Departures from this plan

The build kept the plan's contract and changed these rules, each for a measured reason that the ADR records:

- **What the author's physics rig gives (rule 1).** No rigid body's shape, size or rotation. The model reads which bones are simulated, the joints' limits and positions, the collision groups and masks, and the centre of each simulated body, which is the lever the joint limits act on, because many PMX files leave bone tails unset.
- **Flesh (rule 3).** Joint limits do not separate flesh from cloth, so flesh is a simulated chain at most two bones deep that moves at most half the shoulder span. Nicole's pierced surface turned out to be a plush doll and a bow at her hip, not flesh.
- **A garment is one piece (section 2.2).** `BodyMeshSource` also carries the triangles. Chains under the hips or a spine bone are one garment only when a triangle ties them, so a bow does not share the skirt's arm collisions, rest shape or pinch. Chains under any other bone are one garment.
- **Pinched replaces stiff (sections 2.2 and 2.4).** Aria's dress is mobile by its joint limits. It jitters because the resting arm sits inside it, so a garment that holds the resting arm's centreline is pinched and stays out of the arm collisions. The arm opens up to 28 degrees to leave the free-swinging garments, which are tested together: it takes the smallest abduction that leaves it inside the fewest. Pinched is read from the final rest, after rule 8's pass. When the 6 degree range clears no garment, the arm settles up to 4 degrees out, where its capsule overlaps them least. An arm's `rest.limit` names a shrunken volume before a garment.
- **Arm collisions are narrower (section 2.4).** Only garments whose author already lets some arm body push them gain the whole arm. Giving the arm to a garment the author kept apart from every arm body took Vivian from never pierced to pierced on every frame. A pinched garment keeps its authored pairs, a simulated body with an empty mask is not a garment's surface, a rig without enough free collision groups stays as authored, and bodies left over when the groups run out are reported as skipped.
- **Rule 8 is new.** A garment the simulator collides with the arm is cleared as a body is, up to 30 degrees. Such garments are cleared together, at the first abduction that clears them all.
- **Head, neck and legs (rule 4, sections 2.2 and 2.3).** The model ends at the shoulders. The head and the neck keep the author's kinematic bodies, built and fitted as on `main`: the performer's colliders are the model's volumes followed by those bodies, and the arm gate's head list is the same bodies. Slices up to the crown removed head clearance on 8 rigs. One sphere on the head, with a capsule on the neck, was built next and measured against `main` on the 32 rigs: the hair tuck lost on 8 and gained on 3, `headClearance` lost on 5 and gained on 4, the thinking hand's upper arm held 54 to 83 degrees abducted on the QA rig (37 to 43 on `main`), `emotion.minSeparationFromNeutral` down from 2.011 to 1.886 under a limit of 2, and no surface at the chin. `main` had tuned its face-touch gestures against the author's bodies, so the sphere and the capsule were removed; the capsule changed no rest and no capability on any rig. A head fitted to the mesh is a later reader (section 2.6). Only the thighs are fitted on the legs.
- **The fit (rules 4 and 5), 2026-11-25.** A trunk slice's capsule lies along the longer of its width and depth. Hard volumes stay inside the shoulder joints down to an upper arm's length below the shoulders, not only above the armpit. The first fit refused the hand-to-chest and thinking-hand forms on the QA rig.
- **The measure (section 2.1).** A triangle leaves the test when a corner carries more than 2 % arm-bone weight, not any, and head and hair crossings are reported apart from the pierced share.
- **Slice G3's four-rig check.** The sweep at the measure's landed head covered Chisa and Bronya, which match the scratch values. Sparxie and Yuzuha were swept only on the later `main`, after the arm and hand work, where Sparxie is no longer pierced, so that sweep does not show the original condition for them.
- **Slices B3 and B5 share a commit** for the MMD side, because they change the same lines. The performer's side of B5 is a commit of its own.
- **The rest clearance is a rig trait (section 2.5), 2026-11-25.** It reaches the performer as `BodyArmTraits.restAbduct`, not as the per-tick `armLift`. Section 5 gives the reason.
- **The performer changed after all (TL;DR, "What does not change").** `performance/` gained the rest trait in the arm rest pose and the flag that leaves a corrector's proxies unfitted. No gesture, gait constant, gate, band or threshold changed.
- **Acceptance, against the `main` of 2026-11-25** (`c7b1ac5cb`; 32 rigs, `qa:motion3d clearance`). That `main` has no trapped rig any more and 18 rigs under 5 % in every scenario, so A4 reads 18, and A5's "Aha's falls" no longer applies.
  - A1 holds: no rig has a tick without a clear arm pose, as on `main`.
  - A2 fails as written: the model reports a rest limit on 11 rigs, not 3. Three of them stay pierced at idle, and the ADR names each with its reason: Aria and her robot form stay at 100 %, and Nicole goes from 96 % to 73 %. The other eight are never pierced at idle (Robin, Denia in her white dress, Lily, Sunna, Vivian, Alice and both Yuzuha rigs).
  - A3 holds: no rig is more than 1.8 points above `main` in `speak` or `walk`.
  - A4 holds: the 18 clean rigs stay under 2 %.
  - A5 fails on two rigs: at idle Aha rests 11.3 degrees further out and Evanescia 9.8, both by rule 8, and both go from pierced to never pierced. Aha is also 8.7 degrees further out in `speak` and 10.4 in `walk`, and Evanescia 8.7 in `walk`. Every other rig rises by 6.9 degrees at most at idle.
  - A6 fails on one row: Sunna's reversing cloth rises by 2.4 points in `walk`. At idle the largest rise is 1.1 points (Lily).
  - A7 is not shown on the heaviest rig, nor on a rig that gets the new arm collisions. On the QA rig it holds, best of three runs a side: the pose stages' 95th percentile is 1.00 ms on both sides in `idle-drive` and goes from 1.38 to 1.39 ms in `walk`, and the physics step's goes from 19.1 to 19.5 ms and from 22.0 to 22.5 ms.
  - A8 holds: no gated criterion's verdict differs from `main`, and `emotion.minSeparationFromNeutral` is 2.100 over a limit of 2, from 2.011. One capability changes: the clasp is lost on Chisa in her swimsuit. `gestures`, `headClearance` and `hairTouch` are the same on every rig, because the head and the neck are the author's bodies on both sides.
  - A9 fails on one part: the desktop performance bench gave no valid run on a loaded machine, so nothing compares the app's cost with `main`. `pnpm verify`, the model-gated tests and the determinism run pass, and the pull request records them.
  - A10 holds: the app starts on Chisa and Ellen without errors, and the screenshots show the resting hands outside the coat and the skirt. The pull request records it.
