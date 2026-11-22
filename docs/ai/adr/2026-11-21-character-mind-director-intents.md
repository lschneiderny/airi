# Character mind: the MMD director on intents

Date: 2026-11-21
Status: accepted; CM6b2 implemented. Current rules are in [Body ownership](../context/body-ownership.md#director-inputs) and [Autonomous behavior](../context/autonomous-behavior.md).

## Context

CM6b1 gave Natural one gaze arbiter and routed chat activity through the character mind. The MMD director still counted touches, drag releases, and chat independently, and read the resolver's away overlay. Its look-at override changed a diagnostic point but never reached the gaze performer. Its visit share also drew from a second random stream.

This ADR supersedes the [clip actions ADR](2026-11-03-mmd-clip-actions.md) and the [locomotion ADR](2026-10-31-fullscreen-stage-and-locomotion.md) where they say the director reads touches, drag releases, chat, or away directly. Their historical bodies stay unchanged. The [character mind direction](2026-11-17-character-mind-direction.md), [gaze ADR](2026-11-20-character-mind-gaze.md), and [glances ADR](2026-11-21-character-mind-glances.md) provide the surrounding ownership rules.

## Decisions

The owner approved D7 to D11 as recommended on 2026-11-21.

- **D7, taken: attend names its target and cause.** Touch, drag, and chat-send attends target the cursor for 60 s; a chat-unfold attend targets the chat without opening a cursor window. The semantic cause is named `attendCause`, because `IntentBase.cause` already holds the stimulus sequence number. `MMDAttendInbox` counts touch and drag in `touchSeq`, both chat causes in `chatSeq`, and unfolds in `chatOpenSeq`. It stamps `untilMs` on the next director frame, retaining the CM6a stalled-frame rule. The director keeps its clip-ending and approach rules. The scene's raw counters and watches are gone.
- **D8, taken: away is the mind's presence answer.** Every away edge emits one body `away` intent. The conductor dispatches it only under Natural and seeds an attached scene or a driver returning to Natural from the mind's current presence. The director reads a separate boolean. Mode remains continuous world state; resolver attention leaves the director. Natural's own away overlay is unchanged.
- **D9, taken: classic gets no new intents.** Drag releases, chat sends, chat unfolds, and away no longer end classic clips. Classic receives no new attend intents and reads away as false. Feedback, the watchdog, stop and replacement requests still work. A drag in progress remains a world input and retains its existing refusal and broad-clip ending rules; this qualifies the plan's abbreviated list of classic endings. CM7 decides whether classic keeps the director.
- **D10, taken: the look tool reaches the gaze arbiter.** `BodyIntent.look` replaces diagnostic-only attention with a sequence, target, and 8 s hold. The scene hands each new sequence to Natural once. The existing MMD adapter resolves camera, cursor, and chat into normalized eye points; away uses Natural's drawn aside point. Natural stays independent of the humanoid package. A missing target is a refusal with a null point. The `look-tool` source has priority 4, beside cue gestures and emotions; touch, wake, and chat can interrupt it. Autonomous posture-led fixations respect the tool's explicit hold. Resolver attention and tool targets still produce the same diagnostic points through `resolveBodyTarget`.
- **D11, taken: the mind supplies the visit-share pick.** A possible idle-mode visit is selected when the wander errand's `pick` is below `VISIT_SHARE` (0.6). A held wander keeps that pick. Watching-mode visits, geometry, distance rules, and the director's wander-position and linger draws remain unchanged. The director no longer spends a separate visit-share draw.

ACT action labels and body tools remain requests from the model or user, as D6 decided. The renderer's geometry, gait, clip library, settings, speaking state, dragging in progress, and performance mode remain world inputs. The beat lock's `groovePhase` and CM6a's `restX` stop rule and `cursorStepPending` correction are preserved.

## Consequences

Natural now visibly performs look-at tools. The tool port still reports the director's acceptance; reporting a later arbiter refusal to the tool caller remains a follow-up. Refused looks are dropped rather than replayed after the moment they answered.

Classic intentionally loses the raw activity and away clip endings. There is no compatibility path. Existing non-Natural gaze and motion drivers receive no new intents.

The plan's neutral headless away input would remove the existing away-sensitive stance markers in `sleepy-no-clip` and contradict the model-gated runner regression. The runner therefore sends scripted presence edges through its existing mind and consumes its body away answer. It still supplies no attends; the orchestrator owns the identity check.

The wander request and its pending diagnostic record carry `pick`. No seeded numeric expectation needed re-pinning in this implementation; visit-share tests now provide explicit mind picks and verify that the director spends one fewer draw.

On macOS the nine headless scenarios (`idle`, `idle-drive`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, and `touch`, seed 1) are `IDENTICAL` against `main` with the beat lock, CM6a's close-out, and the sidestep. In the rendered app on the desktop stage under Natural, locking the desktop gave one `presence` step with a `body/away` intent, and unlocking gave the wake reaction with `body/away` back; the look tool was registered and accepted with 0 errors. The glance itself could not be observed rendered, because the motion QA capture runs only on Live2D; the Node tests cover it. The clip endings under Natural and classic (D9) were not exercised rendered: no motion clip is available on the test machine, and the app ships none.

Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review.

## Follow-ups

- Route ACT look through the mind and decide where the performance resolver belongs.
- Decide the director's place under classic and declare performer capabilities in CM7.
- Return gaze-arbiter refusals to a look-tool caller if the capability contract requires them.
- Decide whether wander positions and linger durations should move onto the mind's stream.
