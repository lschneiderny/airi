# Walk style: one gait, shaped by her mood, energy and baseline

Date: 2026-11-23
Status: accepted. First implementation of the walk style plan (`.omo/plans/walk-style.md`, slices WS1, WS4 and WS5 in part). It builds on the [natural walk refit ADR](2026-11-23-natural-walk-refit.md). The owner asked for the first implementation to get the motion right, with the architecture cleaned up in a second pass.

## Context

The walk refit fitted the gait's shape constants to the average of three motion capture styles. The owner's direction is a system that produces kinds and styles of walk from external factors, not a copy of the capture: her mood and energy from the character mind, the urgency of the situation, and a per-character baseline, with the rig as a constraint.

Measured on steady straight walking in 22 acted styles (Bandai Namco Research Motiondataset 1 and 2, CC BY-NC 4.0) and 16 forward walks from 100STYLE (CC BY 4.0), no clip committed, in leg lengths L:

- Structure holds in every style: arms opposite the legs, heel-to-toe roll, knee bend in swing (70 to 79 degrees).
- Style varies widely: bounce 0.015 to 0.129 L, arm swing 8 to 103 degrees, elbow carry 14 to 79 degrees, pelvis list 5 to 21 degrees, step width 0.02 to 0.38 L, trunk lean 2 to 19 degrees, head carriage over 40 degrees.
- Arousal (sad to happy, active) carries speed, bounce, arm swing and foot lift. Valence moves head and trunk carriage. Tension bends the elbows and shrinks the swing, roll and foot lift. Fatigue (tired, old) carries the trunk and head forward with shorter steps but keeps the bounce. Roether, Omlor, Christensen and Giese 2009 (J Vision 9(6):15) report the same directions for sad, angry, happy and fearful gait.

## Decision

1. **The gait takes a `GaitStyle`** (`packages/motion-driver-humanoid/src/locomotion/style.ts`): 14 values for speed, stride at a given speed, bounce, foot lift, roll, pelvis twist and list, step width, torso counter-twist, arm swing, elbow carry, arm hang, trunk lean and head carriage. The neutral style is the refitted walk, byte-identical in headless traces on two rigs. `GAIT_STYLE_BOUNDS` keeps each value inside the measured range.
2. **The style sizes the walk but never changes its structure.** A bouncy style bends the knee after each heel strike (the loading response), not at it. A list wider than the gait's lowers the pelvis by how far it raises the stance hip. The style's roll acts on full strides only, and every roll is scaled against the style's own full stride, so the start and stop steps keep the gait's roll. A forward lean keeps half its angle off the head's line of sight.
3. **A walk eases into a new style** with a 0.5 s time constant, so a mood change shows within a step or two without a jump. Between walks the style follows its input at once.
4. **`walkStyleFrom` maps the factors to a style.** Its inputs are the performer's mood (valence, arousal, tension), the host energy, and an optional `GaitBaseline` (stride, sway, width, bounce, arm swing, arm carry, posture, each in [-1, 1]). Ratios move in log space by signed gains, and every value is then bounded. A calm mood at resting tension (0.15), energy 0.5 and no baseline gives the neutral style. Low energy reads as fatigue.
5. **The MMD body computes the style every frame** from `input.intent.mood`, `input.energy` and `input.walkBaseline`. `input.walkStyle` replaces it for QA and lab runs.
6. **Headless runs can hold a style, a mood or an energy** (`qa:motion3d run --walk-style`, `--mood`, `--energy`). Each is recorded in the trace source when set, and each leaves a trace byte-identical when absent.

## Consequences

- Her walk now follows her mood in the app. With no mood dose (every headless scenario), the walk is byte-identical to before.
- Measured on Chisa against the neutral walk: happy walks at 1.2× speed with bounce 0.084 L (from 0.046) and 96 degrees of arm swing (from 43); sad at 0.83× with bounce 0.021 L, 18 degrees of arm swing and the head 13 degrees further forward; angry and anxious step faster with the elbows carried at 49 to 59 degrees; low energy shortens the step to 0.51 L, widens it, and quiets the arms.
- No style added an upper-body pop on Chisa or Ellen. The happy walk on the stiletto rig added 2.
- `walk-form` version 5 already fails on `main` for the neutral walk on the three rigs tried (knee at strike 20.2 to 21.6 degrees, turns under way 6 of 10, and roll on Ellen and the stiletto rig). Under strong tension or sadness, 1 or 2 more of about 60 steps per run, all at a start or a stop, fall just under the roll bar.

## Not decided

- Urgency from the director's goal reasons, which still sets the two paces.
- Where a card's walking baseline is stored, and its presets and editor (plan slice WS6).
- Rig limits as their own step (plan slice WS3): the stiletto and robot-foot rigs' bounce, and arm swing against the rig's clearance at large swings.
- The gains are a first pass, for visual review to settle.
- Head carriage and the gaze owner: the gaze still aims the head on top of the carriage.
