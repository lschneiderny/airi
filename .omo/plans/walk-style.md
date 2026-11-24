# walk-style - Work Plan

Status: done, 2026-11-24; the gains await the owner's visual review (section 4). First implementation: the style contract, the factor mapping, and QA overrides ([walk style ADR](../../docs/ai/adr/2026-11-23-walk-style.md)). WS3 landed as a step limit for the rig's foot and an arm back swing eased into the rig's room; the hip-width rule is the style's width bound, since the base width already comes from the hip spacing. The walk-form risks of the first implementation (knee at strike, turns under way, the roll of steps while she turns) are fixed, and happy and angry walks now keep the neutral step length and step faster, as the acted walks do. WS6: the profile's `gait` with its schema and six presets in `stage-shared`, the card editor's picker, sliders and walk preview, and the active card's baseline in the MMD body; this settles the walk style ADR's open item on where the card baseline is stored. WS2 and WS7: `lab:motion3d report walk-style`, the `walk-mood-arc` scenario with its `mood` cue, and clip headers that name the held mood, energy or style. Urgency (D1, [walk urgency ADR](../../docs/ai/adr/2026-11-23-walk-urgency.md)) replaces the paces with a per-reason urgency and its lean. Follow-up (2026-11-24): `report walk-style` version 2 reads trunk lean signed (version 1's unsigned tilt read the rigs' backward bind posture as missing lean); tension, fatigue and arousal now lean the trunk 7 to 8.5 degrees more than neutral against 11 to 14 in acted walks; the stop-end hip drop is fixed (the foot stage's reach now eases with the gait's weight). Open: knee swing peaks 8 to 10 degrees under acted walks because her hip rides 0.03 L higher in mid-swing; `roll-every-step` fails the arrival turn's flat steps, which the report reads along the path as walking steps; on some rigs a braking step lifts the hips 0.025 L in four frames. The owner asked to get the motion right first and clean the architecture up in a second pass. Builds on the natural walk refit (#87, merged; [ADR](../../docs/ai/adr/2026-11-23-natural-walk-refit.md)). Roadmap row: Walk, in [`docs/ai/context/3d-character-roadmap.md`](../../docs/ai/context/3d-character-roadmap.md). Required reading for every worker: the `enforce-rules-for-render-loops` and `motion-qa` skills, [Body ownership](../../docs/ai/context/body-ownership.md), and, for the profile slice, [State persistence](../../docs/ai/context/state-persistence.md).

## TL;DR (For humans)

**Goal.** One walk generator that produces many walks. How she walks follows external factors: her mood and energy from the character mind, the urgency of where she is going, and her character's own baseline. The rig limits what it can show. The motion capture libraries tell us which features carry style and over what range. They are not targets to copy.

**What changes.**

- The walk's fixed shape constants become a `GaitStyle`: about fourteen named parameters, with today's tuned walk as the neutral value.
- A pure function maps the factors to a style. Rig limits are applied last, and the result reports which limits applied.
- The style changes at step boundaries, so a mood change shows within one or two steps without a pop.
- A card can carry a walking baseline, such as a wider stance, more hip sway, or arms carried higher.
- The checks judge structure in every style, the direction of each factor, and staying within the human range. They do not measure distance from one reference.

**What does not change.** The gait's structure stays fixed in every style: arm and leg opposition, heel-to-toe roll, knee at strike, stance from the hips, turns made while stepping, the contact rules, and the arm-body clearance.

## 1. Evidence: what carries style

Measured on steady straight walking: Bandai Namco Research Motiondataset 1 (15 styles, 2 clips each) and 2 (7 styles, 17 to 32 clips each), both CC BY-NC 4.0; and 16 forward walks from 100STYLE (CC BY 4.0). No clip is committed; scripts stay outside the repository. Lengths are in leg lengths L. "Head" is the neck-to-head tilt, positive forward; compare it within one dataset only.

| Set 1 style | Speed | Step rate (/s) | Step | Bounce | Arm swing | Elbow | Trunk | Head | Foot lift | Width |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| happy | 1.76 | 2.10 | 0.84 | 0.129 | 100° | 64° | 5° | -10° | 0.156 | 0.04 |
| active | 1.92 | 1.90 | 1.01 | 0.095 | 74° | 40° | 4° | 6° | 0.203 | 0.26 |
| angry | 1.84 | 2.15 | 0.84 | 0.046 | 84° | 44° | 10° | 11° | 0.154 | 0.08 |
| normal | 1.58 | 1.85 | 0.85 | 0.043 | 63° | 14° | 2° | -9° | 0.162 | 0.05 |
| proud | 0.89 | 1.22 | 0.73 | 0.024 | 45° | 79° | 5° | -17° | 0.144 | 0.04 |
| tired | 1.27 | 1.75 | 0.72 | 0.060 | 38° | 24° | 10° | 37° | 0.176 | 0.24 |
| not-confident | 1.14 | 1.92 | 0.56 | 0.024 | 8° | 73° | 13° | 27° | 0.140 | 0.08 |
| sad | 0.61 | 1.12 | 0.54 | 0.015 | 21° | 18° | 4° | 4° | 0.134 | 0.18 |
| old | 0.84 | 1.66 | 0.50 | 0.044 | 23° | 39° | 19° | 27° | 0.141 | 0.26 |
| feminine | 1.32 | 1.60 | 0.82 | 0.034 | 56° | 30° | 5° | -8° | 0.173 | 0.02 |
| masculinity | 1.66 | 1.78 | 0.94 | 0.054 | 59° | 26° | 2° | 2° | 0.187 | 0.20 |
| giant | 1.33 | 1.52 | 0.87 | 0.125 | 65° | 37° | 7° | 9° | 0.164 | 0.38 |

Set 2 agrees: across its seven styles (exhausted, elderly, feminine, normal, masculine, youthful, active), bounce varies ×4, arm swing ×4.2, shoulder twist ×4.2, elbow carry ×4.4, trunk lean ×4.4, pelvis twist ×3.6, step width ×2.2, step length ×1.9, and step rate only ×1.3. Knee bend in swing stays within 70° to 79°. 100STYLE agrees in direction: Depressed and Old carry the head and trunk forward and lift the feet less, Elated bounces and swings its arms, Stiff halves the knee swing and the foot lift, and Angry and Rushed lean forward. 100STYLE's forward walks curve and run slow, so only its directions are used.

What each factor does, read from these tables and from Roether, Omlor, Christensen and Giese 2009 (J Vision 9(6):15: sad gait has reduced speed, arm swing and a lowered head; angry gait has long, heavy steps and flexed elbows; happy gait has speed, arm swing and bounce; fearful gait has flexed elbows and a smaller swing):

- **Arousal (sad to happy, angry, active):** speed ×3, bounce ×8, arm swing ×5, step rate 1.1 to 2.2 per second, foot lift 0.13 to 0.20 L. This is the largest axis.
- **Valence (not-confident, sad to proud, happy):** head and trunk carriage. At similar arousal, proud carries the head back and not-confident carries it 27° forward with arms almost still.
- **Tension (angry, stiff, not-confident, fearful):** elbows carried bent (44° to 73°), smaller knee swing and foot lift, trunk leaning forward.
- **Fatigue (tired, exhausted, old):** trunk 10° to 19° and head 27° to 37° forward, shorter steps, less arm swing. Bounce stays (exhausted 0.056), so fatigue is not low arousal.
- **Urgency (rushed, active):** speed and step rate, then a slight forward lean (rushed 11°).
- **Character baseline (feminine, masculinity, giant, childish, chimpira, proud):** step width (0.02 to 0.38 L), pelvis list (5° to 21°), pelvis twist, elbow carry, and head carriage at similar speed.

Limits of this evidence: the styles are acted, set 1 has one actor and two clips per style, and 100STYLE has one actor. Directions are reliable. Magnitudes are rough, so the mapping takes its ranges from the data and its gains from visual review.

## 2. Design

### 2.1 `GaitStyle` (motion-driver-humanoid, locomotion)

The parameters, each with its neutral value (today's walk) and the human range from section 1 as its bounds. Lengths are in L and angles in degrees, so one style fits every rig.

| Group | Parameters | Replaces today's constant |
| --- | --- | --- |
| Stride | step length share at a given speed, step rate bias | `referenceLengthShare`, the cadence law |
| Vertical | bounce gain, foot lift, knee swing, heel strike and toe-off pitch | the bob terms, `swingHeightShare`, `heelStrikePitch`, `toeOffPitch` |
| Pelvis | pelvis twist, pelvis list (hip sway), step width | `torsoTwist[0]`, `pelvisList`, `stepWidthShare` |
| Torso | shoulder counter-twist, trunk lean | `torsoTwist[1..2]`, the posture `erect` term |
| Arms | arm swing, elbow carry, arm hang out | the arm frame gains, `armOutBack`, `armOutForward` |
| Head | head carriage (pitch offset under the gaze) | none |

Speed stays an input (`pace`), not a style parameter. A style may bias the speed a pace asks for, within bounds (section 2.3).

### 2.2 Rig limits, applied last

`gaitLimits(traits)` computes what the rig allows once, at construction, and `applyLimits(style, limits)` clamps a style and returns which limits applied:

- reach (`GAIT_REACH_SHARE`) caps step length and bounce;
- foot geometry (heel height, short feet, robot feet) caps step length and roll pitch; this replaces the open "shorter stride for stiletto rigs" item;
- the back swing room (`BodyCollision.backSwing`) and the arm clearance cap arm swing and set the minimum hang;
- the hip width sets the minimum step width.

The applied limits are reported in the trace, so a report can tell "the style asked for less" from "the rig allowed less".

### 2.3 Factors to style: `walkStyleFrom(factors)`

A pure function in motion-driver-humanoid. Inputs:

- `mood: { valence, arousal, tension }` and `energy.level`, already in `BodyPerformanceInput` from the mind's fast mood and Natural;
- `urgency` in [0, 1], set by the director from the goal's reason (section 2.5);
- `baseline: GaitBaseline`, the card's (section 2.6).

Each parameter is the baseline value moved by signed gains on the factors: multiplicative for magnitudes, additive for angles, then clamped to its human range. The signs come from section 1. Gains are sized so that a factor at its extreme reaches roughly the extreme style (arousal +1 is about happy or active, -1 about sad), and visual review sets the final values. Every gain cites its source in a comment.

Mood also biases the speed a pace asks for, between ×0.7 and ×1.25, so a sad walk to the chat is slower than a happy one. The director's distance rules already read the gait's predicted rest point, so a slower walk needs no director change.

### 2.4 Time

- The factors are read every tick, but the style moves only at heel strikes, and each parameter eases to its new value over one step. A walk never changes shape mid-swing.
- Trunk lean and head carriage share one mapping with the standing posture's `erect` term, so starting or stopping does not pop the trunk.
- Seeds: the style adds no random stream. Stride variability stays as it is.

### 2.5 Urgency from the situation

`LocomotionPace` today is `'stroll' | 'walk'`. The director sets it per goal reason: approach the cursor (stroll, or walk to chase), return home (stroll), tool (walk), enter stage (walk). Recommended: replace it with `urgency` in [0, 1] chosen per reason, so a chase, a chat open, a wander, and a return home each ask for their own pace. The two current values map to 0.3 and 0.6.

### 2.6 Character baseline

`CharacterProfile` gains an optional `gait: GaitBaseline` (Valibot schema next to `CharacterProfileSchema`). A share carries it, because it is part of the profile. It holds a few user-facing values, not all fourteen parameters: stride, sway (pelvis list and twist), stance width, bounce, arm swing, arm carry, and posture. A small set of presets fills it (for example neutral, graceful, bold, light, reserved, heavy), each drawn from a style family in section 1. Without it, the neutral style applies.

## 3. Slices

Each slice is one PR to `main` and passes `pnpm verify` on its own.

1. **WS1, style contract, no change in behaviour (S).** Add `GaitStyle` and its neutral value; the gait and the performer read every replaced constant from it. Acceptance: headless walk traces are byte-identical on two rigs, and the locomotion hash test is unchanged.
2. **WS2, measurement (S).** Add `pnpm lab:motion3d report walk-style <run>`, which prints the section 1 measures and the human range of each. Several already exist in `walk-form`; this report adds head carriage, foot lift, elbow carry, and shoulder twist. Needed before any gain is set.
3. **WS3, rig limits (S to M).** `gaitLimits` and `applyLimits`, with the reach, foot, arm room, and hip width rules, reported in the trace. It absorbs the stiletto stride item. Acceptance: the 13-rig matrix keeps its current pops, skate, and walk-form results, and the stiletto and robot-foot rigs' bounce drops below 0.07.
4. **WS4, style parameters (M to L).** Make each parameter group act, one commit per group: stride and vertical, pelvis, arms, torso and head. Head carriage needs the gaze owner's agreement (Body ownership): it is an offset under the gaze, not a new head driver. Acceptance per group: unit tests for monotonic response and bounds; at both ends of each parameter, every structure check in section 4 still passes on three rigs.
5. **WS5, factors (M).** `walkStyleFrom`, step-boundary easing, the posture handover, the mood speed bias, and urgency in the director. Acceptance: section 4 checks 2 and 3 on a factor grid; the director press tests are re-pinned with the change explained.
6. **WS6, character baseline (M).** The profile field, its schema, the presets, and the card editor controls with a walking preview. This slice has UI work and reads the UI skills.
7. **WS7, review set (S).** A `qa:motion3d` scenario that walks the same route through a scripted mood arc, and a `lab:motion3d` style matrix that renders side-by-side clips of the grid's corners for visual review.

WS1 and WS2 can run in parallel. WS3 and WS4 follow WS1. WS5 follows WS4. WS6 needs only WS5's contract. WS7 can start after WS5.

## 4. How a style is judged

1. **Structure, in every style:** walk-form v5 (opposition, knee at strike, roll, turns under way), pops, skate, and reach, on a style grid (each factor at -1, 0, and +1, plus the presets) on three rigs: Chisa, Ellen, and a stiletto rig.
2. **Direction:** moving one factor by 0.5 moves each measure it maps to in the expected direction, by more than the rig's walk-to-walk noise across seeds.
3. **Range:** every measure stays inside the human range across all 22 Bandai styles, with a margin. A style is not judged by its distance from any one reference.
4. **Visual review:** the WS7 clips. In the motion QA wording: "Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review."

## 5. Decisions (recommended defaults applied; the owner can veto)

- **D1. Urgency replaces `LocomotionPace`** as a number in [0, 1] (recommended) rather than adding urgency next to the two paces.
- **D2. Mood biases speed** within ×0.7 to ×1.25 (recommended), rather than leaving speed to urgency alone.
- **D3. The baseline is a few user-facing values with presets** (recommended), not the full parameter set.
- **D4. Head carriage is an offset under the gaze** (recommended), not a separate head layer.
- **D5. Out of scope:** the model or the mind asking for a named walk ("sneak", "strut"), time of day, running, and Live2D. Each can feed the same factors later.
