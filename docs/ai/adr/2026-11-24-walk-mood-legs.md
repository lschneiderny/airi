# Walk moods in the legs and trunk: push, load and fold

Date: 2026-11-24
Status: accepted; the gains await Luke's visual review. It extends the [walk style ADR](2026-11-23-walk-style.md) with three `GaitStyle` values and changes three of its gains.

## Context

An independent visual audit found the mood walks told apart mostly by the arms and the head. Happy, angry, tired and sad walked on the same legs and trunk apart from speed, stride and bounce. An angry walk held the elbow at 64 degrees over walking legs, so it read as a jog. Acted walks differ in the legs and trunk too. A sad gait has short steps, a flexed upper body and a lowered head, and an angry gait has heavy steps (Roether, Omlor, Christensen and Giese 2009, J Vis 9(6):15). A happy gait is bouncy (Montepare, Goldstein and Clausen 1987, J Nonverbal Behav 11:33).

## Decision

1. **`push`** (neutral 1, bounds 0.6 to 1.5) scales the swing's start speed. Above 1 it also deepens the toe-off. A push below 1 never rolls less than the gait, so each rig's step limit holds for every style. `walkStyleFrom` raises it with arousal and gladness and lowers it with fatigue, sadness and a little tension.
2. **`load`** (neutral 0, bounds 0 to 1) adds the knee's give after each heel strike, up to the loading dip of a bounce of 2. Only tension sets it, most with arousal.
3. **`fold`** (neutral 0, bounds -4 to 12 degrees) pitches the chest forward, rounds the shoulders by half of it, and the head keeps half of it off its line of sight. Sadness folds the chest up to 9 degrees, less as arousal rises; full fatigue folds it 3, and gladness opens it up to 3.
4. **Sadness** narrows the step, less as arousal rises. It shortens the step 5 % and slows the walk 10 %, which keeps a sad walk's cadence: with the step 10 % shorter at the old speed, the cadence rose from 1.41 to 1.55 steps/s, where acted sad walks are the slowest (1.12).
5. **Arousal bends the elbow half as much when she is tense**, so an angry walk carries the elbow about 31 degrees over neutral, as acted angry walks carry it 30 over normal.

The bounds and gains rest on judgment and the stills; no reference measures them directly.

## Consequences

On the reference rig (walk, 40 s, seed 1; `lab:motion3d report walk-style`):

| Mood | Before | After |
| --- | --- | --- |
| Happy | knee swing 66.9 deg, foot lift 0.185 L | knee swing 73.0 deg, foot lift 0.191 L, trunk opened 1.2 deg |
| Sad | 0.77 L/s at 1.41 steps/s, step 0.55 L, width 0.139 L, trunk lean 1.1 deg | 0.70 L/s at 1.40 steps/s, step 0.50 L, width 0.108 L, trunk lean 4.1 deg |
| Angry | 1.02 L/s at 1.92 steps/s, elbow carry 64 deg, bob 0.027 L, knee swing 55.7 deg | 0.97 L/s at 1.92 steps/s, elbow carry 53 deg, bob 0.033 L, knee swing 57.9 deg |
| Tired | trunk lean 5.0 deg, knee swing 57.7 deg | trunk lean 6.2 deg, knee swing 56.4 deg, swing start at 0.70 of the gait's |

- The tired walk changes least: its slower swing start shows in no report line.
- The mood runs on four rigs and the reference rig's mood arc have no collision, hold or pop.
- `qa:motion3d run --walk-style` reads `fold` in degrees, as it reads the other angles.

## Amendment, 2026-11-25: anger in the plant, fatigue in the legs, a wide swing from the shoulder

An independent visual audit of 2026-11-25 found three moods still wrong. The angry walk pumped short, bent arms over a low, flat step. The tired walk read as the sad one. The happy walk carried the hand forward at shoulder height at the front of each swing.

1. **Anger goes into the plant and the trunk, not the arms.** Tension alone holds the elbow at 8 degrees and takes arousal's bend away, so an angry walk carries 8 degrees, not 31. This changes decision 5. Tension squares the shoulders to the path: its torso-twist gain doubles, from -0.4 to -0.8. Tension still lowers the lift, but only by its share without arousal, so an angry foot lifts clear as a neutral one does, and its load reaches the bound of 1. Tension keeps flattening the roll: an angry heel strike at the neutral roll raised the reversal's contact skate from 0.023 to 0.030 on the reference rig. Opening the chest with tension and arousal was tried and dropped: it took 1.3 degrees off the angry trunk lean, which already sits at its bound.
2. **Fatigue loads the step and rises out of it slowly.** Fatigue now loads the step as well (0.48 at full fatigue). This changes decision 2. Its push falls to near the floor (0.62). A push below 1 stretches the loaded knee's recovery from mid-stance to 0.7 of the step at the push's floor. The tired head drops 4 degrees per unit of fatigue instead of 10, so she bends from the hips, not at the neck as a sad walk does.
3. **A swing wider than the walk's comes from the shoulder.** The elbow's front bend gives back what the wider shoulder swing adds (19.5 degrees per unit of swing at the shoulder, 34 at the elbow). The forearm then rises no higher in front than the neutral walk's. The neutral and narrower swings are unchanged.

The gains rest on the audit and the stills.

Consequences on the reference rig and Chisa (walk, 40 s, seed 1; `lab:motion3d report walk-style`):

| Mood | Before | After |
| --- | --- | --- |
| Angry | elbow carry 53.6 deg, shoulder twist 8.9 and 8.8 deg, foot lift 0.129 and 0.127 L, knee swing 58.0 and 57.9 deg | elbow carry 30.4 deg, shoulder twist 7.7 deg, foot lift 0.152 and 0.150 L, knee swing 63.5 and 63.4 deg; trunk lean unchanged |
| Tired | head carriage 19.7 and 32.5 deg, bounce 0.020 and 0.019 L | head carriage 15.9 and 28.7 deg, bounce 0.025 and 0.023 L |
| Happy | elbow carry 41.8 and 41.9 deg, arm swing 66.3 and 73.5 deg | elbow carry 35.4 deg, arm swing 57.4 and 64.3 deg |

- On the stills, the angry arms hang along the body with the fists at the hips, and the happy hand swings forward on a downward slant at waist height.
- The tired walk still differs from neutral less than the other moods. Its later pickup and slower recovery show only faintly on the stills.
- Sad is unchanged. Every mood run exits 0 and passes `pops`.
