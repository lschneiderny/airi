# Layered character state: moment, mood, temperament, relationship

Date: 2026-11-03
Status: proposed

## Context

The product goal is a "realistic" anime character sim that captures the feeling of a relationship over a long timeline. The user must be engaged and rewarded in the short term, but each design must also work over weeks and months.

The character has one emotional state today, the mood of the Natural motion driver (`packages/motion-driver-natural/src/mood.ts`). It holds valence, arousal, and tension. ACT emotion cues and touch push it, it decays in 20 to 45 seconds, and only the face and body read it. The model never sees it: `core-agent` has no mood input, and the system prompt has no mood section.

Other parts of the fork already work on longer clocks. The [reach-out cadence](2026-10-29-unprompted-reach-out-cadence.md) targets a few unprompted messages a day, open threads fade over hours, and rituals run once a day across a 04:00 rollover. [Long-term memory](2026-10-30-long-term-memory-adoption.md) keeps entries per character card in IndexedDB. A state that should shape the conversation must live on these clocks, not on the motion driver's.

## Decision

Model the character's inner state as four layers, each on its own clock. A faster layer feeds the slower one, and only the relationship layer is moved by discrete events instead of accumulated input.

| Layer | Clock | Holds | Read by |
| --- | --- | --- | --- |
| Moment | seconds | Reactions to touch and ACT cues | Face and body (existing Natural mood) |
| Mood | hours | Decaying contributions, each with a reason | Prompt, face baseline, reach-out urge |
| Temperament | days | A slow average of mood that becomes the mood baseline | Mood layer |
| Relationship | weeks to months | Closeness, trust, familiarity, shared history | Prompt (behaviour thresholds), reach-out |

### Mood

Mood is the temperament baseline plus a list of contributions. A contribution has a delta on three axes (valence, energy, and tension), a reason, a source, a timestamp, and a half-life. Starting half-lives are 1 to 3 hours for passing reactions and 6 to 9 hours for events that hurt or delighted her.

- Decay runs on wall-clock time. The state persists, and loading it applies the elapsed decay, so a short restart keeps the mood and a long absence returns it to baseline on its own. The 04:00 rollover does not reset mood: last night's large contributions can still tint the first greeting of the day.
- The model changes mood through a stage-contract cue with small, bounded deltas whose effect shrinks near the extremes. Larger contributions come from events: touch through the situation model, unanswered reach-outs, long absences, and exchanges the model marks as significant. Bounded steps and decay stop the loop in which the model reads its mood, writes in that tone, and confirms it.
- The prompt receives mood as words, not numbers, plus the one or two contributions with the most remaining weight as reasons. A neutral mood renders no text.
- The feeling and relationship text travel in a per-request runtime context message with the context id `system:character`, sent beside the `system:situation` block. It is never part of the system prompt, because it changes during a session, so the [prompt composition](2026-11-01-prompt-composition.md) ADR stays unchanged.
- Expression state feedback no longer sends the numeric Natural mood. It reports active expressions only, and the worded feeling line is the model's only mood signal, so the model never sees two moods that disagree.
- The face receives a damped baseline offset on selected channels only: mouth corners from valence, eye openness and blink rate from energy, brows from tension. It is strongest right after an interaction and relaxes during long idle periods. Whole expression presets and holds stay with the moment layer, which plays on top as before.
- Mood scales the reach-out urge mildly (better mood, slightly chattier; sulky, quieter or one pointed message) and enters the reach-out prompt.

### Temperament

Temperament is an exponential average of mood with a starting half-life of 5 days, pulled back toward the character card's resting disposition with a starting half-life of 10 days. It becomes the baseline that mood decays toward, so a hard week leaves her flatter and a good week brighter. It describes her disposition, not her feelings about the user.

### Relationship

The relationship layer holds closeness, trust, familiarity, and references to shared-history milestones stored as long-term memory entries. It stays separate from temperament so that "she has been sad lately" and "she likes you less" are different states. The plan defines its stages and behaviour thresholds; this ADR fixes its rules:

- Long-term reward is changed behaviour, not a number. Thresholds unlock behaviour such as nicknames, teasing, initiative, vulnerability, and callbacks to shared history.
- Inputs cannot be farmed. Positive inputs have diminishing returns per day.
- Absence does not punish. Being away is a mood event (she misses you); it does not lower closeness. Long absence erodes only familiarity, gently.
- Trust is asymmetric: it builds slowly, drops faster on real mistreatment, and recovers slowly.
- Relationship events, such as a disclosure, a kept promise, a hurtful exchange, or a milestone, come from the exchange-end thread extraction call. That call already runs after each exchange, so it returns the appraisal in the same JSON and costs no extra model call. The same appraisal marks exchanges as significant for the mood layer.

### Shared rules

- All four layers are hidden from the user. Their values, contributions, and history appear only in the devtools inspectors.
- Mood, temperament, and relationship state are plain data rendered into the prompt, so changing the chat model or provider keeps the relationship.
- The state is stored per character card in IndexedDB beside long-term memory, with a versioned schema and migrations, and is included in card export. Renderer `localStorage` is not durable enough for months of state.
- The card field `extensions.airi.modules.character` holds the resting disposition and the starting relationship stage. The card editor edits it, and it is exported with the card. A card without the field uses neutral defaults.
- Existing cards start fresh at their starting stage. The state is not inferred from earlier chat history.
- A devtools time-travel harness simulates days of events, and a model-eval scenario compares behaviour at different relationship stages. Long timelines cannot be tuned by live QA alone.

## Delivery

- This ADR records the model before implementation.
- One plan, `.omo/plans/layered-character-state.md`, delivers every layer: mood, temperament, the relationship layer and its behaviour thresholds, the durable store, the card field, the face baseline, the reach-out coupling, the devtools inspector with its clock jump, and the simulator. It starts after the [nonverbal channels](2026-10-31-nonverbal-channels.md) work, which has landed.

## Consequences

The Natural mood stays the moment layer and keeps its own decay. The slower layers reach it only through the face baseline offset, so motion tuning and character-state tuning remain separate.

The relationship layer overlaps the closeness state deferred on 2026-10-31. This ADR replaces that deferral: closeness is one dimension of the relationship layer.

A mood cue changes the stage contract, so `STAGE_CONTRACT_EN_SHA256` changes when the plan lands and model-eval runs record the new version.

Every number in this ADR is a starting value. Appendix A of the plan lists the starting constants and formulas. The constants live in a settings module, not in stored records, so tuning them needs no migration.
