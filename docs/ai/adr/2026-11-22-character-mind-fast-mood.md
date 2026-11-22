# Character mind: fast mood

Date: 2026-11-22
Status: accepted; CM9b implemented. Headless and rendered acceptance is pending (see Acceptance).

Current rules are in [Autonomous behavior](../context/autonomous-behavior.md), Precedence rule 28. The
[CM9 plan](../../../.omo/plans/character-mind-cm9.md) records the approved design (sections 3.3 and 7), the decisions D7
to D10, and every check command. This slice removes the fast-mood clause of Autonomous behavior Target rule 1. It is
stacked on CM9a ([emotion gestures ADR](2026-11-22-character-mind-emotion-gestures.md)).

## Context

Each Natural controller kept her valence, arousal, and tension. It dosed every emotion episode itself with a gain the
conductor resolved (`NaturalEpisode.moodGain`), kept per-episode bookkeeping so an escalation added only the missing
dose, and applied the touch doses the mind already decided. A model reload or a driver switch built a new controller
at rest, so her mood reset with the renderer.

## Decisions

### Doses travel as today's `mood` intent; a seed starts a new performer (D7)

`moodEpisodeDose` in `packages/character-mind/src/mood.ts` computes the delta of each new or escalated episode with
the arithmetic `NaturalMood.add` used, and the mind follows the episode's face intent (and its gesture) with a posture
`mood` intent carrying it. The touch dose stays the intent it was and also moves the mind's level. The conductor hands
the dose to `addMood` right after the episode, so Natural applies both on the same grid step. A new controller starts
from the mind's level instead of rest.

### Mood survives a model or driver switch (D8, recommended, applied without an explicit answer)

`syncScene` lends a scene that attaches or becomes Natural again a seed source. The owner's alternative (reset on
switch) is a one-line change: `syncScene` stops calling `seedMood`.

### Strength 0 still doses (D9)

Per-model emotion strength is realisation; the mood is the character's. A model whose strength for the emotion is 0
shows nothing, and her mood still moves.

### The mind's clock decays only to dose and to seed (D10)

`moodLevelAt` decays the level with the time constants of the last dose's settings. A scene reads the level once per
controller it creates; Natural then decays its copy on its active seconds. No frame samples the mind's level.

## Deviations

- **The seed is a source, not a `mood-level` intent.** Plan section 3.3 names a posture `mood-level` intent that
  `syncScene` sends. An intent needs a stimulus to answer, and `syncScene` has none. `syncScene` instead passes
  `seedMood(() => mind.moodLevel())` to the scene, and the scene reads it once for its current controller and once for
  each controller it creates later. This also covers a model reload, which builds a new controller without a scene or
  declaration change, so `syncScene` alone would miss it (plan section 8, rendered check 3).
- **Dose ids carry the time.** The plan names the episode id plus its escalation step. Episode ids restart after a
  mind reset (a card switch), while a Natural controller keeps its applied dose ids for its lifetime, so a repeated id
  would be dropped. The id is `${episode id}@${epoch ms}`.
- **No dose-id set in the mind.** The plan lists `doseIds` in `MindMoodState`. The mind decides each touch dose once,
  so the set would only grow; Natural keeps applying each dose id once.
- **`moodless` is optional** on the `emotion` and `expression-request` stimuli (absent means false), so other callers
  need no change.
- **The rig sink forwards `addMood` without its own unit test.** Its only tests need the local rig assets; the rig
  hash comparison in Acceptance covers it. Touch scenarios of the rig now dose mood, as the stage does.

## Consequences

Under Natural her fast mood exists once per character and survives a model reload or a driver switch. No gain, time
constant, setting, or stored key changes; the mood is fast state and resets at launch and at a card switch.

The Live2D observer's emotion hashes stay pinned when the test feeds the mind's doses beside the episodes, which shows
the delta arithmetic moved unchanged. Expected headless result (plan section 8): all eleven scenarios and both rig
hashes `IDENTICAL` to the CM9a tip, because the cue player and the sink dose Natural on the frame of the episode. A
difference is a defect.

## Acceptance

Headless (orchestrator, macOS, 2026-11-22): base the CM9a tip `85b577568`, tip `bb8ffbbd4`, seed 1. All eleven
scenarios are `IDENTICAL` (`idle`, `idle-drive`, `music`, `music-beat`, `gaze-shift`, `speak`, `gesture-under-clip`,
`emotions`, `walk`, `sleepy-no-clip`, `touch`), and both rig hashes are unchanged (`angry` `446b746a`, `happy`
`a273e525`): the dose arithmetic moved without changing a frame.

Rendered (orchestrator, macOS, 2026-11-22, ForBOOTH Live2D in the window, Natural): with state feedback on, the
performance runtime state publishes Natural's sampled mood. `happy` three times raises it to valence 0.3, arousal 0.2.
A switch to Universal and back keeps the same Natural controller, so it keeps the mood at both ends and proves nothing.
A model reload does create a new controller: the stage switches to the preset model and back to the imported one. On
the CM9a tip the new controllers read 0 on the preset and 0 after the reload. On the CM9b tip they come up seeded,
at valence 0.3 and arousal 0.1 on the preset and again after the reload, the mind's level after a few seconds of decay.
Every launch recorded 0 renderer and 0 main-process errors.

Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do
not prove naturalness, which stays a visual review.

## Verification

Package checks run by the implementer: character-mind (214 tests), motion-driver-natural (511), stage-ui node (2012)
and `stage-emotion-routing.browser.test.ts` (46), stage-ui-live2d node (795) and its two `composables/live2d` browser
files (17), stage-ui-mmd node (434), qa-tools node (894, 9 skipped), and the dependent typecheck of
`motion-driver-natural` (11 packages) and `character-mind` (10 packages).
