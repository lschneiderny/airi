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
