# Character mind: declared performer capabilities

Date: 2026-11-22
Status: accepted; CM7a implemented and accepted on macOS (headless and rendered results below).

Current rules are in [Body ownership](../context/body-ownership.md), [Autonomous behavior](../context/autonomous-behavior.md), and [LLM prompt](../context/llm-prompt.md). The [performers plan](../../../.omo/plans/character-mind-performers.md) records the implementation departures and checks.

## Context

The mind decided some episodes that its stage could not perform. The conductor then selected behavior through a Natural/basic driver switch. Live2D silently dropped shrug and lean, upstream Live2D drivers still received the fork's automatic expression picks, and MMD classic still ran the fork's director and curated clips.

CM5b and CM6b2 are already present on the implementation base, `e57dd1393`, together with CM6a's sidestep and c6's mapping editor. Their beat forwarding, gaze arbiter, chat reads, attend causes, away answers, director look hand-off, resting stop point, and sidestep remain intact.

This ADR implements decisions 6 and 7 of the [character mind direction](2026-11-17-character-mind-direction.md). It supersedes D10 of the [core ADR](2026-11-18-character-mind-core.md), which kept mind-driven expressions under upstream drivers, and settles the classic-director question in D9 of the glances plan and the [director input ADR](2026-11-21-character-mind-director-intents.md). Their historical bodies remain unchanged.

## Decisions

The owner approved the plan's recommended D2 to D5 on 2026-11-21.

### D2: the newest stage declares what the mind can issue

`PerformerCapabilities` belongs to `packages/character-mind`. It declares posture, face, gaze, body, and individual cue gesture kinds. It describes what a performer can realise at all. Current clip assets, idle errands, rig geometry, and stage-world availability remain with their existing owners.

| Performer | Posture | Face | Gaze | Cue gestures | Body |
| --- | --- | --- | --- | --- | --- |
| Live2D Natural | Yes | Yes | Yes | Nod, shake, glance | No |
| MMD Natural | Yes | Yes | Yes | Nod, shake, glance, shrug, lean | Yes |
| Universal, MAGIC, classic | No | No | No | None | No |

Voice belongs to chat and always passes `permits`; it is not a performer capability. VRM, Spine, and tachie remain outside the mind's performer world.

The `performer` stimulus sets fast state, which starts at `NO_CAPABILITIES`. The mind store sends the newest attached stage's declaration, watches its changes synchronously, restores the previous declaration when the newest stage detaches, and replays it after a reset. It retains the existing newest-stage rule for idle reports and forwards beats separately from intents.

Policies that draw check permission before drawing or changing episode state. A deterministic answer containing several channels is filtered before it leaves `step`; voice keeps its original draws and ordering. Without posture, idle is dormant. Without face, refused emotions and expression requests spend no draw. Live2D shrug and lean requests produce refusals instead of silent adapter drops.

The conductor no longer knows a motion driver. Every mind intent it dispatches passes `permits` against its own scene, so a second attached stage can refuse a request that the newest stage declared. Voice cues retain their complete intent, including the cause. Driver checks that guard adapter frame work remain.

The rejected alternatives were deciding everything and dropping it afterward, which spends draws on unavailable episodes, and teaching the core renderer or driver names.

### D3: upstream drivers use upstream faces

Without face declared, `Stage.vue` does not send ACT emotions or expressions through the conductor. Universal and MAGIC use upstream motion groups and `live2d.expressions.execute`. Classic uses its emote and the emotion action map.

The fork's expression panel, manual switches, and saved rest set remain available. Automatic mind picks no longer run under these drivers. Declaring face under them was rejected because it would retain the second coordinated behavior system that direction decision 7 excludes.

### D4: classic runs no body director

MMD calls `MMDStanceDirector.update` only with body declared. Classic restores upstream's global idle through `setIdleMotion` and emotion-mapped one-shots through `playAction`. Stance slots, curated ACT actions, body tools, idle clips, and debug clips require Natural; settings mark the Natural-only controls.

A switch to classic withdraws pending director requests and releases its layer before restoring upstream idle. A switch back releases an upstream one-shot and reapplies the director's selected base. Only the applied-base cache is invalidated; the director's decisions are not reset.

Keeping a separate classic clips capability was rejected. It would preserve a second fork body system under the upstream fallback driver.

### D5: refusals are observer events

`step` returns `refusals`, and `MindStep` carries them to listeners. Each core refusal names the stimulus sequence as `cause`, the intended kind, and `undeclared`. The conductor emits `not-declared-by-stage` through `onRefusal`; a direct clip label has no mind cause.

The reaction inspector and motion QA mind events record both kinds of refusal without request content. No policy reads them, so no refusal stimulus or second decision loop is added. The inspector is connected in Stage rather than imported into the conductor, preserving the conductor's Node QA boundary.

### Model offers follow the declaration

The conductor publishes no exposed expressions without face and no exposed actions without body. Expression tool registration receives an empty list without face. Action and body registrations receive no port without body. The existing snapshot API, prompt composer, and fixed ACT contract remain unchanged.

The c6 `stage-expression-catalog` mirror is independent of model-facing exposure. Settings can still edit the loaded model's mapping weights under every driver.

## Consequences

There is no new persisted state, settings document, dependency, or compatibility path. Natural's decision constants, seeded streams, motion formulas, and fixed prompt bytes remain unchanged. Universal, MAGIC, and classic intentionally lose the fork behaviors described above.

Declaration replay assigns the loaded pacing owner before its first step, so a reset cannot publish the new card's pacing to the preceding card.

Two acceptance details differ from the plan's shorthand. The prompt contains no rendered `actions` segment under classic, but `composePrompt` deliberately reports every supplied segment, including a zero-character `actions` row. Removing that row would change the existing report contract; this slice preserves it. Section 9 also says nine headless scenarios but enumerates ten when `music` is included. The orchestrator should account for that extra named scenario explicitly.

On macOS, all ten headless scenarios (`idle`, `idle-drive`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, `touch`, and `music`, seed 1) are `IDENTICAL` against `main` at `e57dd1393`. In the rendered app, with 0 renderer and 0 main-process errors in every launch: (1) under Live2D Natural an ACT `shrug` gave a mind step with one `undeclared` refusal and no gesture, and an ACT `nod` played; (2) under Live2D Universal both gestures were refused as `undeclared` and the mind took no emotion step; (3) under MMD classic `perform_action`, `look_at`, and `come_here` were not registered; (4) under MMD Natural on the desktop stage, with a curated clip, all three were registered and the shrug, nod, and emotion intents were issued. The checks did not observe upstream's own playback under Universal and classic, because motion QA capture records only Natural; the routing browser tests cover it.

Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review.

## Verification

The implementation used the owner-requested package checks instead of repository-wide verification:

- Character mind: 138 Node tests, including no-draw refusal and unchanged voice draws.
- Stage UI: 1,934 Node tests and 1,015 browser tests, with five existing browser skips. Tests cover the three declaration sets, newest-stage replay, refusal observers, upstream ACT routing, generated PMX/VMD classic playback, tool removal, and unchanged Natural actions-prompt bytes.
- Live2D: 787 Node tests and 43 browser tests. Existing Natural observer expectations were not re-pinned.
- MMD: 414 Node tests and 31 browser tests.
- QA tools: 880 Node tests, with nine existing environment-gated skips.
- Stage pages: 102 browser tests for the inspector contract change.
- Expression-performance inner loop: 291 tests. Policy-document checks: 11 tests.
- Touched-package and dependent typechecks passed with workspace concurrency 2.

The full commands and per-item evidence are in the plan. Two existing `slop/no-trivial-functions` warnings in `Stage.vue` remain. Browser fixture runs also emit their existing loader and synchronization-teardown console messages; these are not rendered-app acceptance results.

## Remaining slices

- CM7b seeds expression picks by intent and reports masking or missing expression assets.
- CM7c moves behavior settings into one document; c6's mapping editor is already implemented.
- CM7d completes Live2D channel ownership and the weighted expression-tilt input.
- The fixed ACT vocabulary and the remaining Natural card-expression instruction overlap stay with the plan's follow-ups.
