# Emotion silhouettes and touch sides

Date: 2026-11-24
Status: accepted. Replaces the emotion posture rows of architecture 4c as the [whole-body performer ADR](2026-11-11-whole-body-performer.md) adopted them, and corrects the side convention of its 4d touch reactions.

## Context

An animation audit of the MMD body reviewed every emotion's peak with the face hidden. Sad, flustered and love shared one silhouette, the hand to the chest. Happy, surprised, awkward, sleepy, question and curious stood within a few degrees of neutral, because 4c's rows are small trunk and shoulder offsets, which the layer scaled up uniformly (`scale`, 1.5 to 6 times). A larger copy of a small offset is still the same pose. Touch had two faults. Every poke also fires Natural's surprise impulse, and the surprise lifted both hands, so a poke read as a bilateral, low hands-out pose. The reaction layer also read the stage's touch `x` as her right. The stage reports `x` from the viewer's side, so `+x` is her left, and Natural turns the head away from `+x`. The trunk and the guarding arm flinched toward the poke, and a pet leaned away from the hand.

## Decision

1. **Each emotion is a whole pose, written at its final size.** `scale` is removed. A posture names the trunk's pitch, roll and yaw per segment (`hipsPitch`, `lowerPitch`, `midPitch`, `upperPitch`, `lowerRoll`, `midRoll`, `hipsYaw`, `lowerYaw`, `midYaw`), the pelvis height and depth, and three arm blocks: `arms` for both arms, `sideArm` for the arm on the emotion's side and `farArm` for the other one. Each block holds clavicle elevation and protraction, flexion, abduction, twist, elbow, pronation and wrist flexion. Support is a multiple of the side (`support: number | null`) instead of `'centre' | 'side'`. The shift is full from a clear pulse up and, below that, lies between the emotion's side and the stance she had when the emotion first asked for it, because the posture keeps the last planned support until its own next shift: a support held to the end of the episode left her on the emotion's leg through the next trial's baseline. A weaker band is the same pose scaled by its weight. Neutral writes nothing.
2. **Every emotion has its own line of action, weight, openness, height, asymmetry and tempo.**

   | Emotion | Silhouette |
   | --- | --- |
   | Happy | Lifts and opens: the chest arches up, the shoulders go back, the arms open forward and out with the palms forward; a quick underdamped arrival that bounces once. |
   | Sad | Folds inward and down: an 18-degree slump over hips that tuck under, the pelvis sinks, the shoulders drop and roll forward, the arms hang in with curled hands; a slow, overdamped arrival and a sigh. |
   | Angry | Squares up: the trunk hinges forward over a lowered pelvis, the shoulders rise and come forward, the arms stay in by the sides with the elbows bent and held back, fists. |
   | Think | The thinking hand at the chin, the other arm folded across the belly under it, weight on the side foot with the waist leaning over it. |
   | Surprised | Snaps back and up: the trunk arches back over retreating hips, the shoulders jump, both open hands come up in front with the wrists back; an underdamped startle that settles to 35 %. |
   | Awkward | The hand into the hair, the other arm drawn in, the shoulders hunched, and the hips and chest turned away as the weight retreats onto the far foot. |
   | Question | A palms-up shrug with a side bend: both forearms turn up, the near shoulder lifts and the trunk leans to the side over the far foot. |
   | Curious | Leans in from the waist with the arms drawn back, weight half onto the side foot. |
   | Love | Opens the chest toward the viewer and lifts it, the hand to the chest, the other forearm drawn in under it; a slow, soft arrival with a larger sway and a deeper breath. |
   | Flustered | Interrupts the reach and turns away: both half fists pulled in at the chest, the hips and trunk turned and the weight on the far foot; a fast, jittery tempo. |
   | Sleepy | Sags back and lists: the pelvis drops and slides forward under a trunk that leans back and rolls to the side, the arms hang heavy, the weight on the side foot; a slow sway and deep breath. |

   Tempo also differs in the modulation of the idle generators: happy quickens and widens its sway a little more (tempo 1.2, amplitude 1.3), love slows and widens it (0.8 and 1.4, breath 1.15), flustered widens it slightly (1.1), and sleepy now sways slow and wide (amplitude 1.5, against 4c's 0.6, because a drowsy body sways more, not less). Happy, sad, angry and surprised centre the weight; think and sleepy stand on the side foot and curious half on it; awkward, question, love and flustered retreat onto the far foot.
3. **The hand to the chest belongs to love alone.** Sad and flustered no longer request a form. Awkward requests `hair-touch`, only on a rig whose solver reached the hair key (`capabilities.hairTouch`), because an unreached form retries every tick.
4. **The far arm beside a held form comes in with the form.** A pose whose `farArm` completes a contact form (think, love, awkward) brings that arm in with a smooth step over weights 0.3 to 0.6, so a slight band does not hold an arm out across the body without the hand it supports.
5. **Touch `x` is read from the viewer's side.** A body poke turns, rolls and shifts the trunk away from the touch. The poked side's arm guards first (3 Hz, 0.6 damping, released after 0.6 s), bringing the forearm across in front of the side with the elbow a little out rather than clamping the arm in, which ran into a slim rig's torso proxy; and the far arm follows 0.12 s later through a softer response, at 0.35 of the guard when the poke is fully to one side. A head poke raises the poked side's guard and, on a rig that reaches it, requests the `hair-touch` form on that side for 1.4 s. A pet leans the trunk into the hand, rolls the near shoulder in and drops both shoulders. The give rises with a 0.25 s time constant and relaxes with 0.7 s, and the lean follows the same give, so both let go slowly after the hand leaves. The pet pulls the support to the hand's side with the give and returns it to the stance she had as the give lets go.
6. **A startle from a poke leaves the arms to the reaction.** A surprised pulse that starts within 0.25 s of a poke moves its arms and hands at a quarter of their size and keeps the trunk recoil, so the contacted side protects itself first instead of both hands presenting.

## Consequences

- Tests that pinned 4c's values were re-pinned: the surprised startle's held elbow, the slump size, the anticipation size and the touch side signs. New tests require every pair of emotions to differ in the trunk and weight by 3 degrees and in the arms by 5 degrees or a held form, and require the strong band to equal the clear band scaled by 1.5.
- The rest pose holds the clavicles about a degree above their lower limit, so the pet's shoulder drop saturates there. The roll-in and the lean carry the near side's give.
- Natural still owns the head. A strong sad pulse pitches Natural's head back about 13 degrees while the trunk slumps, which reads as a sad body under a lifted head. That is Natural's posture and is reported, not changed here.
- The hair-touch approach path is the gesture solver's; it is not changed here.

## Amendment (2026-11-25): accents in the stride, touch that answers the spot, sharper silhouettes

A second animation audit reviewed emotions during speech and walks, the touch sides, and the weaker bands.

1. **During a walk an emotion is an accent the stride absorbs.** Its arm joints hold for 0.3 s, then let go at her next change of stance foot (or 0.6 s later) to a fifth of their size through a 1.2 Hz critically damped follower, and come back when she stands. Hand shapes, the trunk and the pelvis stay. A held form is let go once absorbed, so love does not walk with a hand on the chest. A surprised pulse dips the pelvis 0.03 leg lengths while she walks (`startle`). The stride itself does not hitch: a startle that shortens or catches the next step needs a locomotion input, for example a step-scale or startle hook that the performer feeds the gait from the merged plan. That belongs to the walk and is not built here.
2. **The silhouettes are sharpened where the audit could not name them.**
   - Surprised throws both open hands up beside the head with the palms out and the chest back, so the recoil carries into both hands before it settles to its held share.
   - Question is the shrug: the elbows stay in, both forearms turn palms up, and the near shoulder lifts while the far one drops, an uneven lift.
   - Happy lifts through the chest, with a deeper upper-back arch and the pelvis forward, and opens the arms low and forward with the palms forward.
   - Sad takes the lower neck down 14 degrees with the slump (`neckPitch`), so the head goes down with the chest. Natural's head posture is still its own; the neck term is the emotion's. This replaces the consequence above that left a lifted head over a sad body.
   - The far forearm of love and think folds across the belly in front of the body instead of pointing forward, with enough shoulder flexion to clear a chested rig's torso proxy.
   - Flustered's fists sit a little wider and lower in front of the chest. Fists pulled into the chest met the bust proxy, and the projection stepped the upper arm.
   - The hand to chest anchor goes 0.15 arm lengths up from the chest seed, onto the upper chest above the bust, where at 0.05 it stopped on the front of the bust.
3. **During speech love ties its lift to the line.** While she speaks the chest lifts 4 degrees and the trunk turns 5 degrees toward the far, speaking hand, eased in and out over about half a second.
4. **A poke startle leaves the arms to the guard by region.** After a body poke a surprised pulse moves no arm or hand; after a head poke it keeps a quarter, as before.
5. **A body poke answers where it landed.** The trunk curls round the spot: the hips shift and the chest turns away while the waist leans away and the chest bends back toward the spot, so the poked flank closes in a C instead of the whole trunk leaning away. From 0.15 s she looks down at the spot through the neck for 0.8 s, further for a low poke. The far arm follows 0.3 s after the guard, not 0.12 s, in its own low shape, so the poked side stays the focus.
6. **A held pet inclines the head into the hand.** The neck rolls 8 degrees toward the hand with a small bow, and the near shoulder lifts to meet it while the far one drops, replacing the drop of both shoulders.

The touch reaction and sad now write neck channels. They add to Natural's head through the performer like every other layer term, and owned groups still receive none. Tests that pinned the earlier touch signs, the poke startle's arm share and the surprised held elbow were re-pinned.
