# Live2D Natural cursor attention

Date: 2026-10-24
Status: accepted

## Decision and scope

Natural treats the desktop cursor as a possible social cue, not as a permanent fixation target. Attention is controller-owned, seeded, and continuous. The cursor is mapped relative to the model's eye anchor, its distance affects both attention and head pull, and eye pursuit has a speed limit with catch-up saccades.

This ADR records the contract across `Model.vue`, `Live2DNaturalMotionAdapter`, `Live2DNaturalMotion`, the scenario event schema, and `Live2D.vue`:

- eye-anchored cursor coordinates in head widths;
- staged, distance-dependent attention episodes and their random-draw rules;
- bounded eye pursuit and the head follower;
- pet and dismissal precedence;
- QA event support and its current T3 boundary.

## Cursor coordinate contract

`Model.vue` derives an eye anchor from the measured head box. The anchor is horizontally centered and sits at 55% of the box height from its top. The head width is the coordinate unit. Without a head box, the anchor falls back to the canvas point `(0.5 * width, 0.3 * height)` and the unit is `0.3 * width`. A fresh canvas pointer sample, younger than 100 ms, takes precedence over the host cursor source so touch and gaze use the same pointer. The mapped offset uses X positive right and Y positive up. `Live2DNaturalMotionAdapter` forwards that offset to `Live2DNaturalMotion.setCursor`; the controller clamps each input to -100 through 100 before radial mapping.

The scenario `cursor` event uses the same eye-anchor convention: head widths, X right, Y up. The `pointer` event instead expresses pointer coordinates in head widths from the head-box center, X right and Y down. The scenario sink maps pointer samples through the touch path, while the cursor event directly supplies an attention offset. If both event kinds occur, the latest event by time determines cursor state.

Radial mapping uses `m(r) = r / sqrt(r^2 + 1.2^2)`, where `r` is cursor distance in head widths. Eye target magnitude is `0.65 * m(r)`. Head pull uses the true radial direction, with a gain of 1 through distance 2 and a smooth falloff to 0.35 at distance 10. This avoids per-axis saturation that would distort diagonal approaches.

## Attention episodes

The cursor-attention layer distinguishes near, medium, and far bands. Near is within 2 head widths and always engages. Medium is within 6 head widths and engages with probability 0.55. Far engages with probability 0.2. Each engagement first emits a notice phase, then becomes full attention after a seeded dwell from 0.25 to 0.5 seconds. Medium interest spans have a 2.5 second median, far spans a 1.5 second median; both are truncated to 0.8 through 8 seconds. Near interest has no episode-span limit.

The staged notice has a smoothed weight goal of 0.35. Cursor movement is recognized after 0.03 head widths. A stationary cursor retains full interest for 0.6 seconds, then its interest decays with a 0.8 second time constant. Weight rises with a 0.15 second time constant, and ordinarily falls with a 0.5 second time constant. Cursor loss uses 0.4 seconds; deliberate dismissal uses 0.12 seconds. The attention episode releases when falling weight reaches 0.3. Release and ignored draws start a seeded cooldown from 4 to 10 seconds before another same-or-farther episode can begin.

An ignored medium or far episode still consumes its sampled interest span, dwell, and cooldown. If the cursor keeps moving, it can start a fresh episode as soon as cooldown ends, without first resting; the fresh episode gets a new engagement draw. A nearer episode may replace the current episode. Restoring full permission while the cursor moved within the last 0.6 seconds reopens attention without waiting for cooldown. When an episode already exists, reopening reuses its engagement decision, including an ignored decision, instead of rerolling.

The cursor-attention layer draws only when a non-null cursor episode begins. Cursor gaze choices use the existing gaze stream only when an active cursor target is eligible. With no cursor, no new cursor-attention draw occurs; the independent autonomous gaze stream continues as before. The controller uses a separate seeded stream for cursor attention, so its state does not reshuffle other motion layers. Tests preserve the no-cursor and cursor-disabled deterministic baseline.

## Gaze pursuit and head follow

Cursor gaze is selected for 80% of autonomous fixation choices, scaled by current attention weight. A notice event starts an orienting saccade. The eye pursuit target velocity is smoothed with a 0.06 second time constant; pursuit velocity is smoothed with 0.1 seconds and position feedback uses 0.2 seconds. Pursuit speed is capped at 1.5 normalized eye units per second.

When cursor error exceeds 0.1 eye units and 0.12 seconds have passed since the previous saccade began, the gaze makes a catch-up saccade. For cursor orienting and catch-up saccades, the endpoint is a snapshot of the current cursor target when the saccade starts, not a predicted future point. Pursuit resumes from that endpoint at zero velocity, keeping subsequent pursuit within the speed bound. Other saccades, such as camera or aside glances, use their own selected target.

The head follows cursor pull through a two-stage critically damped follower: horizontal and vertical time constants are 0.22 and 0.26 seconds. Cursor head pull fades with attention weight and relaxes as the gaze leaves cursor fixation. Attention also calms autonomous posture amplitude by up to 30%. When the cursor is above the eye anchor, a smooth approach term engages between 1.6 and 0.9 head widths and softens the eye pitch. At settled close approach, the cursor's head-pitch contribution is slightly downward, `-0.05 * headShare`; other head layers still contribute to total pitch. Separately, when the cursor is above the anchor, the eye target is capped at 0.35.

## Petting and dismissal precedence

**D1, Luke's decision:** "Pet response: melt into the hand - eyes drift down and soften toward half-closed as the hand arrives, head leans into strokes; no look-up, no camera snap."

The pet hand is expressed relative to the head-box center. It overrides cursor gaze only while permission is full and pet level is over 0.5. Cursor attention share also fades continuously with pet level, so approach, pet start, and release do not clear the cursor or snap between targets. After a pet lasting longer than 3 seconds, the controller holds a single 1.2 second camera glance at pet end. This glance does not interrupt an active dismissal.

Screen attention, an ACT aside cue, and the disabled cursor-attention setting all mean dismiss. A dismissal edge makes the gaze look away only when the cursor episode is oriented, in notice or full phase. Idle, ignored, already released, or already dismissed episodes do not emit another dismissal or force a camera saccade. The cursor may remain present while dismissed; restoring full permission while the cursor remains recent reopens the existing episode without waiting for cooldown and reuses its engagement decision. A fresh episode after the current episode ends still waits for cooldown.

**D2, Luke's decision:** "In terms of idle movement, it should always look like notice -> full attention. That said, the goal is to have her feel like an independent 'vtuber stuck in the corner of my screen' so sometimes she should pay attention medium/far, sometimes not." The onset is staged in that order. Near cursors always engage, while medium and far episodes use seeded engagement draws with lower probability at greater distance, and engaged episodes end after their sampled interest span.

## QA contract

T1 motion scenarios accept `cursor` and `pointer` events. Pointer phases are `move`, `down`, `up`, and `leave`; samples can exercise hover petting, press/release, and departure through the same classifier used by the scene. Cursor and pointer events share the latest-event-wins rule described above.

T1 QA hooks are implemented in the scenario schema and runner. T3 pointer support is planned for todo 10 and is not yet committed as of this ADR. T3 scenarios currently reject `cursor` and `pointer` events because the rendered QA bridge cannot inject real pointer input. Rendered pointer acceptance must wait for that work.

## Tuning

The constants in this ADR are source values from `natural-motion/cursor-attention.ts`, `natural-motion/gaze.ts`, `natural-motion.ts`, and `touch-regions.ts`. They are starting values, not claims of perceptual validation across rigs. T1 verifies deterministic behavior and the numeric contracts; rendered cursor behavior still requires the planned T3 support and Luke's visual review.
