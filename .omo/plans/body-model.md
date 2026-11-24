# body-model - Work Plan

Status: in progress, 2026-11-24. Two pull requests: the arm clearance measure (slices G1 to G3), then the body model (slices B1 to B7). The decisions land in a body model ADR with the second pull request.

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

**Input, `BodyMeshSource`.** Bind-pose vertex positions; up to four bone indices and weights per vertex; each bone's parent and bind position; the canonical bones' indices (hips, the spine chain, neck, head, both arms and hands, both legs); and the simulated bones, each with its mobility: the farthest the simulator can carry the bone's tail from its bind place relative to its nearest unsimulated ancestor.

**Output, `BodyModel`.**

| Part | Meaning |
| --- | --- |
| `volumes` | Hard obstacles as `BodyCollider`s on canonical bones: her body, her rigid clothing, and flesh on simulated bones of low mobility. Leg volumes carry the `leg` field, so they turn with the gait. |
| `garments` | Soft garments: the simulated bones of one garment, the canonical bone it hangs from, its rest silhouette as colliders, and whether it is stiff. |
| `limbs` | Each arm segment's measured radius as a share of its length. |
| `rest` | Per arm: the abduction at which the resting arm clears the hard volumes and, within a bound, the garments; and what limited it, if anything. |
| `report` | Counts and the reasons for every volume that was shrunk or dropped. |

**Rules.**

1. Nothing in the model comes from authored physics shapes. Authored joints inform only the mobility of simulated bones.
2. A vertex belongs to the arm when any arm bone weighs on it, or when it lies within the measured limb radius of the bind-pose arm from the middle of the upper arm down. Arm vertices never form an obstacle.
3. A simulated bone of low mobility is flesh, and its vertices join the hard volumes. Above the flesh threshold the bone belongs to a garment. Thresholds are shares of the shoulder span, named constants with their measured source.
4. Hard volumes are fitted per canonical segment in height slices: a capsule lying left to right, as deep as the slice and as wide as the slice, attached to the canonical bone that carries most of the slice's vertices. Limbs get capsules along the bone.
5. Above the armpit a volume stays inside the shoulder joints.
6. The resting arm always clears the hard volumes. The rest solve picks the smallest abduction, from the default hang up to a bound, at which the performer's own arm test clears them. If no abduction within the bound clears a volume, that volume shrinks until one does, and the report names it.
7. Garments add to the rest abduction up to `REST_GARMENT_CLEARANCE_MAX` beyond the hard-clear rest. Overlap that remains is left to the simulator, and the report names the garment. The bound is a style range, so the style system can later choose within it.
8. The build is deterministic and takes no time or random input.

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
| A9 | `pnpm verify --gate` passes, and `qa:motion3d run --verify-determinism` holds. |
| A10 | The desktop app starts with an MMD model without renderer errors, and a screenshot shows the resting arms outside the garment on two rigs that are pierced on `main`. |

A criterion that is not met is reported with its numbers. No threshold in this section and no gate constant is changed to make a run pass.

## 5. Coordination

`luke/feat/arm-hand-motion` is in flight and touches the performer's corrector, `MMDBody`'s construction of the arm colliders, and the face-touch keys. It adds `BodyCollision.fit`, which shrinks any proxy the resting arm sits inside. The two works agree: with the body model as the source, `fit` finds nothing to shrink, because rule 6 already guarantees the resting arm clears every hard volume. This plan does not edit `collision.ts`. Whichever branch lands second rebases; the meeting points are the collider lines of `MMDBody`'s constructor, and the rest channels handed to `fit`, which must include the model's rest abduction.

## 6. Not decided

- The owner's visual review of the resting arm carriage on coat and skirt rigs.
- Whether the garment clearance bound becomes a style parameter of the arm carriage, and its range.
- The readers of section 2.6.
