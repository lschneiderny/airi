# Walk upper body: the trunk, head and forearm follow the pelvis, and the arms hang closer

Date: 2026-11-24
Status: accepted; the look awaits Luke's visual review. It changes values of the [natural walk refit ADR](2026-11-23-natural-walk-refit.md): decision 1 (the arm's 14 and 19 degree floor and its 6 degree walking clearance) and decision 5 (a trunk nod of 1.2 degrees).

## Context

An independent visual audit of the steady walk found the upper body riding the pelvis as one block. On the reference rig the shoulder line rolled 4 degrees a step against the hips' 9, the chest nodded with the spine, the head held one pitch, and the forearm trailed the upper arm by 67 ms where the human walk reference's median is 201 ms. The arms hung 18 to 25 degrees out on ten rigs, against 12 to 15 in walking adults. The body proxies had since been fitted to each rig's rest hang, so the walking clearance no longer had to cover the old proxies.

## Decision

1. **The chest rolls against the pelvis list** by 0.35 of it, 0.06 step behind (Crosbie, Vachalathiti and Smith 1997, Gait Posture 5:6: the thorax bends against the pelvis's obliquity).
2. **The trunk nods 2 degrees a step**, and the chest's share lands 0.06 step after the spine's (Thorstensson, Nilsson, Carlson and Zomlefer 1984, Acta Physiol Scand 121:9).
3. **The head nods 1.5 degrees**, scaled by the root of the style's bounce, 0.12 step after the trunk.
4. **The elbow trails the shoulder by 0.1 s** before the performer's followers add their own lag.
5. **A walking arm opens at least 1.5 degrees beyond its rest hang**, or to a floor of 12 degrees out behind and 16 in front.

The shares and lags are judged on the stills; the sources give directions, not these values.

## Consequences

- On ten rigs (walk, 40 s, seed 1) the arms hang 14 to 19 degrees out on the left and 17.5 to 22 on the right, 1.4 to 4.6 degrees closer than before. No rig has a collision, a cap hit, a guard scan or a hold, and `pops` passes on all ten. A clearance of 3 degrees was also clean; 1.5 brought the arms about a degree closer again. The rest of the width is each rig's own rest hang.
- The shoulder line now rolls 5.6 to 6.2 degrees a step against the hips' 8.2 to 9.1. `walk-form` `wrist-lags` reads 100 to 117 ms, up from 67 to 83, and keeps every verdict on the three rigs it was compared on.
- The reference rig's left arm comes within 4 degrees of its chest at the back of the swing. That is the rig's own rest hang, not a collision.
