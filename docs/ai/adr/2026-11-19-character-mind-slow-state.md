# Character mind slow state: one mind in the leader keeps her pacing

Date: 2026-11-19
Status: accepted. Slice CM4a of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/feat/character-mind-slow-state`. It builds on the [character mind ADR](2026-11-17-character-mind-direction.md), the [character mind core ADR](2026-11-18-character-mind-core.md), the [character mind voice ADR](2026-11-19-character-mind-voice.md), the [character mind widget turns ADR](2026-11-19-character-mind-widget-turns.md), and the [state registry ADR](2026-11-19-state-registry.md). The owner was away while the slice ran, so each decision below took the recommended option and stays open to the owner's veto. The labels D1 to D14 name the forks in the slice's plan, `.omo/plans/character-mind-slow-state.md`. Current rules: [State persistence](../context/state-persistence.md) and [Autonomous behavior](../context/autonomous-behavior.md).

## Context

Each mounted stage built its own mind in `Stage.vue`, and the situation store ticked the newest connected one. The gate ran only while a stage was mounted in the leader, and a remount dropped ticks. The mind persisted nothing: the situation store saved the whole gate memory, her unanswered openings and damping included, in one per-user slice, so a second character inherited the first one's pacing. A card export wrote the card, its memories, and the whole character-state record, so a shared card carried private history. State persistence Target rule 5 asked for the per-card record to be the mind's slow state, written by the leader, with a share that carries the profile only.

## Decision

### Scope

1. **CM4 is split into CM4a and CM4b (D1).** CM4a moves the mind into the leader and gives it slow state. CM4b moves Natural's idle draw and sleep into the mind. The host is the foundation the idle move needs, and the idle move needs its own motion evidence. CM3's split set the precedent.

### Where the mind lives

2. **The mind lives in a leader-only store (D2).** `useCharacterMindStore` holds the mind, connects it to the gate while its window leads, and lends its cues to the attached stage. Only the leader renders a stage, so no transport is needed, and the store outlives remounts and runs the gate without a stage.
3. **Followers run no connected mind (D3).** No follower renders a stage. A follower's store constructs a mind but never connects it, so there is no cross-window cost. A transport waits for a second live stage.
4. **One mind, reloaded at a card switch (D4).** Only the active card speaks or renders. A map of minds would add lifecycle for dormant characters with nothing to do.

### What is slow state

5. **The ritual day is per user (D5).** It keeps one greeting a day across a card switch and leaves the ritual collector untouched.
6. **The urge and its threshold stay fast (D6).** They restart at promotion, as before. Rule 5's "urge memory" is reworded to name the pacing fields it means.
7. **The hourly cap's fires stay per launch (D7)**, and they carry across a card switch. Saving them would change the cap after a restart, which is tuning.
8. **An old saved gate slice resets once (D8).** The narrowed schema rejects the old seven-field `gate` field, which falls back alone. The old pacing is not copied into any record. CM3a's D6 set the precedent.
9. **The store advances the record on load, and the core normalizes her pacing (D9).** The record's reducer is already pure and needs calendar context that `step` does not carry. The core normalizes her pacing at its first tick.
10. **A card switch starts the fast state over (D10)**, easing in like a promotion. The user's floor and cap carry over through `run.user`.
11. **The mind's store writes the record's pacing (D13)** from `state.slow`. The situation store keeps only the user's slice.

### Share and back up

12. **A share leaves out the card's memories (D11).** It carries the card and its profile only, as rule 5 and direction ADR decision 10 require.
13. **The backup is today's card package (D12)** with both resources, `memories.json` and `character-state.json`. Import already reads it.

### Deferred

14. **Natural's fast mood and the bridge's slow touch dose stay for CM4b (D14).** Neither is slow state, and both sit with the idle and body work CM4b changes.

This ADR settles two items of the core ADR's "Not decided" list: one mind per character, and the load and save of slow state. It defers the third, where Natural's fast mood lives, to CM4b.

## Consequences

- Her pacing now survives a restart, per card. A second character no longer inherits the first one's unanswered openings.
- The gate runs without a mounted stage.
- On the first launch of this build, the old saved gate slice resets once (D8): a ritual can repeat that day, the floor restarts, and the unanswered count is forgotten.
- Card export has two buttons. Share carries the card and profile only, without memories. Back up also carries the memories and the whole record.
- The nine frozen locales now show the English "Share" label and its toast. Their old `export` keys are orphaned, because the fork does not edit frozen locales.

## Alternatives considered

- **CM4 as one PR.** The host and the idle move would share review and motion evidence. Rejected (D1).
- **Keep the mind in `Stage.vue` and add load and save.** The gate would still stop with the stage. Rejected (D2).
- **A mirror mind in followers, or intents over Eventa.** No follower renders a stage. Rejected (D3).
- **One mind per stored card.** Rejected (D4).
- **Save the urge, threshold, or hourly cap.** Either changes her pacing after a launch, which is tuning. Rejected (D6, D7).
- **Copy the old pacing into the active card's record, or loosen the schema.** Both are compatibility paths. Rejected (D8).
- **Move the whole record and its reducer into `MindState`.** History would reach every step listener and QA event. Rejected (D9).
- **A share that carries memories, or a new backup format.** Rejected (D11, D12).

## Not decided

- The idle draw and sleep in the mind, and where Natural's fast mood lives: CM4b.
- Overlap 12: whether a notice turn starts the floor and her pacing stays the owner's question.
