# Character mind: emotion gestures

Date: 2026-11-22
Status: accepted; CM9a implemented. Headless and rendered acceptance is pending (see Acceptance).

Current rules are in [Autonomous behavior](../context/autonomous-behavior.md), Precedence rule 27. The
[CM9 plan](../../../.omo/plans/character-mind-cm9.md) records the approved design (sections 3.2 and 7), the decisions
D1 and D3 to D6, and every check command. This slice lands Autonomous behavior Target rule 2 for emotions and removes
the gesture clause of Target rule 4.

## Context

The mind answered an emotion with one face intent. Natural derived the body gesture from the episode on its own: it
read the recipe table, drew shake or drop for an angry episode on its gesture stream, and kept the gesture cooldowns
per controller on its active seconds. A model reload reset those cooldowns, and two stages could choose different
angry clips for one episode. The owner answered "Scope to Natural" for Target rules 1, 2, and 5 (D1), so the slice
changes Natural only.

## Decisions

### The mind chooses the clip and keeps the cooldown (D3)

`emotionGesture` in `packages/character-mind/src/gesture.ts` decides the clip of each new or escalated episode from an
`emotion` or an `expression-request`. It reads the recipe column of `naturalEmotions`, requires held emotions, an
impulse, a positive intensity, and a band that is not slight (`clear` when bands are off), and refuses inside the
clip's cooldown. The cooldown table moved unchanged as `EMOTION_GESTURE_COOLDOWN_SECONDS`, with shake and drop sharing
`angry`, and its memory is fast state in `MindState.gesture` on the mind's clock. The answer is a posture
`emotion-gesture` intent after the face intent. Without posture, `declaredAnswer` refuses it as `undeclared`, and the
cooldown is not spent. Natural keeps the side and the shape of the clip: they are realisation (core ADR D15).

### Shake or drop comes from the episode id (D4)

The angry clip is `expressionSeed(episode id, 'gesture')` below one half: shake, else drop. It spends no draw of the
mind's source, so voice thresholds, touch rolls, and emotion jitter keep their draws, and every stage given the same
episode plays the same clip. An escalation keeps the episode id and therefore the clip. `expressionSeed` accepts the
`gesture` purpose for this.

### A refused order still spends the cooldown (D5)

Natural refuses an ordered clip while a cue gesture holds the head, with held emotions off, and for a model whose
strength for the emotion is 0. The mind cannot see these performer conditions, and the cooldown stays spent, as a
spent idle fire does. Natural still reports every clip it starts.

### The headless runner calls the policy (D6)

`Motion3dCueDriver` keeps the mind's gesture memory and calls `emotionGesture` for each emotion cue on the run's clock.
Routing cues through a whole mind would add its intensity jitter and new episode ids to every trial.

### The mind may import the recipe table

The mind's import boundary (`airi/character-mind-pure` in `eslint.config.ts`) now admits
`@proj-airi/motion-driver-natural/emotions`, a table of data with type-only imports, and `airi/idle-schedule-pure`
covers that file.

## Deviations

- **Natural still reads the recipe for the head pulse.** Plan section 5 deletes "the recipe lookup in `startPending`".
  The lookup that chose the clip is gone, but `startPending` still asks the recipe whether an emotion has a gesture, to
  leave the impulse's head pulse to the clip. Without it, an emotion whose clip the mind refused for its cooldown
  would gain a head pulse it never had, and every headless run with a repeated emotion inside a cooldown would differ.
  The recipe decides how the impulse is realised, which stays the performer's.
- **Natural ignores an ordered clip with held emotions off.** The plan lists no such refusal. The facade shows no
  emotion gesture with held emotions off, as before, and the mind orders none then; the guard keeps the observer from
  reporting a clip nobody sees.

## Consequences

Under Natural one emotion gets one coordinated response across face and posture, and the gesture cooldowns exist once
per character. Universal, MAGIC, and classic report `emotion-gesture` as undeclared and play nothing new. No cooldown
length, clip shape, setting, or stored key changes.

Expected headless differences (plan section 8): `emotions` from its first angry episode on, and the Live2D rig for
`angry`, because Natural's gesture stream (index 12) no longer draws the shake-or-drop choice and the choice now comes
from the episode id. `gesture-under-clip` and `touch` differ only if their runs hold an angry episode. Every other
scenario and the rig for `happy` are expected `IDENTICAL`. The Live2D observer's emotion hashes moved for the same
reason and are re-pinned.

## Acceptance

Headless (orchestrator): PENDING. Record here the base and tip run directories, the `pnpm qa:motion3d diff` lines for
all eleven scenarios at seed 1, the rig hashes for `angry` and `happy`, the first differing event of each expected
difference, and the gate and report statuses at both ends.

Rendered (orchestrator): PENDING. Record here the plan section 8 checks 1 and 2 (Live2D Natural, MMD Natural on the
desktop stage, Universal refusal) with event kinds and counts and 0 renderer and 0 main-process errors per launch.

Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do
not prove naturalness, which stays a visual review.

## Verification

Package checks run by the implementer: character-mind (211 tests), stage-shared (1897), motion-driver-natural (513),
stage-ui node (2010) and `stage-emotion-routing.browser.test.ts` (46), stage-ui-live2d node (795) and its two
`composables/live2d` browser files (17), qa-tools node (894, 9 skipped), stage-ui-mmd node (433), and the dependent
typechecks of `stage-shared` (28 packages) and `motion-driver-natural` (11 packages).
