# Character mind glances: one gaze arbiter, and chat and cue gestures through the mind

Date: 2026-11-21
Status: accepted. Slice CM6b1 of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/feat/character-mind-glances-1`. It builds on the [character mind ADR](2026-11-17-character-mind-direction.md) (decisions 2, 5, 6, 7, and 8), the [character mind core ADR](2026-11-18-character-mind-core.md), the [character mind idle ADR](2026-11-20-character-mind-idle.md), and the [character mind gaze ADR](2026-11-20-character-mind-gaze.md). The owner approved the recommended option of every fork, D1 to D11, before implementation; D1 to D6 apply to this slice, and D7 to D11 to CM6b2. The labels name the forks in the plan, `.omo/plans/character-mind-glances.md`. Current rules: [Autonomous behavior](../context/autonomous-behavior.md), [Body ownership](../context/body-ownership.md), and the [Glossary](../context/glossary.md).

## Context

Every caller of Natural's `NaturalGazeLayer` `glance` won by calling last (autonomous behavior overlap 7). A poke or an emotion glance cut through a pet against the ruling "no look-up and no camera snap while a pet runs", and ad hoc guards at the callers patched single pairs. A sent chat message and an opened chat reached Natural as sequence counters that no decider saw, and the model's ACT cue gestures went straight to the scene.

## Decision

1. **CM6b splits in two (D1).** CM6b1 is the glances: the arbiter and the chat and cue-gesture stimuli. CM6b2 moves the director onto the mind's intents. Each has its own ADR and Done-when.
2. **Natural's gaze layer owns the arbiter (D2),** at frame rate, on Natural's active seconds. A glance's hold ends on Natural's clock, which freezes while the scene is suspended, so only the performer knows which glance still holds. The mind decides whether a response includes a glance only by deciding the response; it does not rank glances.
3. **One priority table, and the lower request is dropped (D3).** `GLANCE_PRIORITY`, highest first: the pet end and a poke; the desktop and sleep wakes; chat reads and the idle voice cues; cue gestures and emotions; the screen change; a noticed cursor; idle acts. A request starts unless the running glance ranks higher, and equal priority keeps "the latest wins". A refused request is dropped, never queued, and the rest of its episode still plays. Every glance names its `GlanceSource`, and every start and refusal is an observer event with an outcome.
4. **While a pet holds the gaze, only the pet-end glance starts (D4).** This enforces the pet ruling, which the callers' guards did not.
5. **One `chat` stimulus (D5).** A typed send (`sent`, with its word count) and an opened chat (`unfold`) reach the mind as `chat`, which replaces `interaction` `chat-send`. The mind answers `sent` with a `chat-read` intent and an `attend` window, and `unfold` with a `chat-read`, without a draw. The conductor steps the mind under every driver and sends `chat-read` to the scene only under Natural, where it queues the same pending read as before, so its delay draw and hold are unchanged.
6. **Only cue gestures join the mind's stimuli (D6).** An ACT cue gesture, or the devtools lab's, is a `cue-gesture` stimulus. The mind answers with one `gesture` intent, which the conductor plays only under Natural. ACT `action` labels and the body tools stay requests the director takes, and ACT `look` stays an input of the performance resolver.

### What this settles

This ADR closes autonomous behavior overlap 7. Existing ADR bodies are not edited.

## Consequences

- A pet holds her gaze: while the petting hand holds it, an emotion's glance is refused, and the pet-end glance starts when the pet ends. In the rendered check on macOS, an emotion pulsed during a 9 s pet was refused, the pet-end glance started at the pet's end, and a noticed cursor 0.2 s later was refused.
- A poke during an idle act starts its glance over the act's, and a lower request during the poke's hold is refused.
- A chat that opens and a message that is sent each give one `chat` step with its `chat-read`, and a sent message also opens the attend window. Under another driver the mind still answers, and nothing is played.
- The headless `idle`, `idle-drive`, `gaze-shift`, `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, and `touch` runs are `IDENTICAL` between the slice's base and tip. `speak` differs, because its scripted chat unfold now reads the chat as the app does, and its gate and `gaze-order` report read the same statuses at both ends.
- The Live2D rig's motion channels are unchanged. Its trace hash moved, because the trace now lists the emotion glance as an observer event.

## Alternatives considered

- **A gaze policy in the mind with report-and-order.** Every glance's hold would need a report loop on Natural's clock. Rejected (D2).
- **The lower request waits for the hold to end.** Its glance would land after the moment it answers. Rejected (D3).
- **Keep "the latest wins" with targeted guards.** That is overlap 7. Rejected (D3).
- **Keep `interaction` `chat-send` and add `chat` for the glance.** One user act would give two stimuli and two steps. Rejected (D5).
- **Route ACT actions and body tools through the mind too.** Each would be a pass-through with synchronous answers and refusals to carry, and no decision for the mind yet. Rejected (D6).
