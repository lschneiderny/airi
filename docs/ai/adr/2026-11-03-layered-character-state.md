# Layered character state: moment, mood, temperament, relationship

Date: 2026-11-03
Status: accepted

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
- The model changes mood through a stage-contract cue with small, bounded deltas whose effect shrinks near the extremes. Larger contributions come from events: touch through the situation model, unanswered reach-outs, long absences, and exchanges the model marks as significant. Bounded steps and decay stop the loop in which the model reads its mood, writes in that tone, and confirms it, and model cues never feed temperament, so the loop cannot settle into her disposition.
- The prompt receives mood as words, not numbers, plus the one or two contributions with the most remaining weight as reasons. A neutral mood renders no text.
- The feeling and relationship text travel in a per-request runtime context message with the context id `system:character`, sent beside the `system:situation` block. It is never part of the system prompt, because it changes during a session, so the [prompt composition](2026-11-01-prompt-composition.md) ADR stays unchanged.
- Expression state feedback no longer sends the numeric Natural mood. It reports active expressions only, and the worded feeling line is the model's only mood signal, so the model never sees two moods that disagree.
- The face receives a damped baseline offset on selected channels only: mouth corners from valence, eye openness and blink rate from energy, brows from tension. It is strongest right after an interaction and relaxes during long idle periods. Whole expression presets and holds stay with the moment layer, which plays on top as before.
- Mood scales the reach-out urge mildly (better mood, slightly chattier; sulky, quieter or one pointed message) and enters the reach-out prompt.

### Temperament

Temperament is an exponential average of mood with a starting half-life of 5 days, pulled back toward the character card's resting disposition with a starting half-life of 10 days. It becomes the baseline that mood decays toward, so a hard week leaves her flatter and a good week brighter. It describes her disposition, not her feelings about the user.

Only her own experience moves temperament. The hourly mood sample that temperament follows leaves out MOOD cues from the model, which still count at full strength in her mood, face, and reach-out urge. The model's narration of a moment must not change who she is over days. This is a fixed boundary, not a tunable weight: a sweep of partial weights found no weight below 1 that kept the day-30 temperament of the `typical-month` run and also held valence at or below 0.64 under sustained model-cue spam.

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

### Store ownership (2026-11-10)

The three stores depend on each other in one direction only: the situation store uses the situation bridge, the bridge uses the character-state store, and the character-state store uses the card store. No store calls a store above it.

- **Card deletion.** The card store owns the card lifecycle and knows no store that keeps data per card. `removeCard` runs in the leader and awaits the listeners of `onCardRemoval` before it drops the card. The leading character-state store registers one: it removes the card's record and cancels a pending save that would write the record back. A listener that rejects keeps the card. Before this change the card store resolved the character-state store inside `removeCard`, so the two stores called each other.
- **Reach-out coupling.** `bridgeSituationToCharacter` is the only seam between the situation store and the character state. It runs from promotion to demotion of the leader, feeds events into the state, and hands the gate the reading's urge factor. The gate runs only in the leader, so it always has the bridge; without a reading the factor is 1. Before this change the gate looked the character-state store up on every tick.
- **Creation order.** The card store's setup calls `useI18n`, which works only inside a component setup of an app with the i18n plugin. `App.vue` of both hosts creates the chat, character-state, and card stores there. Creating the situation store creates neither the character-state store nor the card store, so a caller outside a component setup can create it and follow. A window that leads starts the bridge, so it needs the character-state and card stores from `App.vue` first.

One call-time lookup remains and is outside this change. `useCharacterStateObservabilityStore` resolves the character-state store inside its actions, because the situation store creates that devtools store in every window.

## Constants

The starting values live in `packages/stage-shared/src/character-state/settings.ts`. The table below lists every leaf of `CHARACTER_STATE_SETTINGS` as it ships. Durations are in milliseconds: an hour is 3600000 and a day is 86400000. The 81 values that Appendix A of the plan states were checked against the module, and none differs. Values the module sets without an Appendix A entry, such as buffers, row limits, and sentence text, are listed too.

The stage and unlock sentences below supersede the wording in Appendix A6 of the plan: the `close` stage sentence names closeness only, and teasing, nicknames, and initiative each have their own unlock sentence, so each one appears only when its unlock is reached.

| Constant | Value |
| --- | --- |
| `mood.epsilon` | 0.01 |
| `mood.headroom` | 2.5 |
| `mood.maxContributions` | 64 |
| `mood.atanhClamp` | 0.999 |
| `mood.tensionGain` | 4 |
| `mood.modelCue.step` | 0.08 |
| `mood.modelCue.halfLifeMs` | 5400000 |
| `mood.modelCue.budgetWindowMs` | 3600000 |
| `mood.modelCue.budgetPerAxis` | 0.24 |
| `mood.modelCue.maxLogEntries` | 64 |
| `mood.events.touch-pleasant.delta.valence` | 0.1 |
| `mood.events.touch-pleasant.delta.energy` | 0.05 |
| `mood.events.touch-pleasant.delta.tension` | -0.03 |
| `mood.events.touch-pleasant.halfLifeMs` | 5400000 |
| `mood.events.touch-unwelcome.delta.valence` | -0.08 |
| `mood.events.touch-unwelcome.delta.energy` | 0.05 |
| `mood.events.touch-unwelcome.delta.tension` | 0.08 |
| `mood.events.touch-unwelcome.halfLifeMs` | 3600000 |
| `mood.events.reach-out-unanswered-first.delta.valence` | -0.06 |
| `mood.events.reach-out-unanswered-first.delta.energy` | -0.03 |
| `mood.events.reach-out-unanswered-first.delta.tension` | 0.06 |
| `mood.events.reach-out-unanswered-first.halfLifeMs` | 10800000 |
| `mood.events.reach-out-unanswered-second.delta.valence` | -0.12 |
| `mood.events.reach-out-unanswered-second.delta.energy` | -0.05 |
| `mood.events.reach-out-unanswered-second.delta.tension` | 0.1 |
| `mood.events.reach-out-unanswered-second.halfLifeMs` | 21600000 |
| `mood.events.late-reply.delta.valence` | 0.06 |
| `mood.events.late-reply.delta.energy` | 0 |
| `mood.events.late-reply.delta.tension` | -0.06 |
| `mood.events.late-reply.halfLifeMs` | 7200000 |
| `mood.events.significant-positive.delta.valence` | 0.25 |
| `mood.events.significant-positive.delta.energy` | 0.1 |
| `mood.events.significant-positive.delta.tension` | 0 |
| `mood.events.significant-positive.halfLifeMs` | 32400000 |
| `mood.events.significant-negative.delta.valence` | -0.25 |
| `mood.events.significant-negative.delta.energy` | -0.1 |
| `mood.events.significant-negative.delta.tension` | 0.15 |
| `mood.events.significant-negative.halfLifeMs` | 32400000 |
| `mood.events.ritual-reciprocated.delta.valence` | 0.05 |
| `mood.events.ritual-reciprocated.delta.energy` | 0.03 |
| `mood.events.ritual-reciprocated.delta.tension` | 0 |
| `mood.events.ritual-reciprocated.halfLifeMs` | 7200000 |
| `mood.pleasantTouchBudgetPerHour` | 0.3 |
| `mood.pleasantTouchBudgetWindowMs` | 3600000 |
| `mood.significantPerDay` | 2 |
| `mood.return.referenceGapMs` | 43200000 |
| `mood.return.octaves` | 3 |
| `mood.return.delta.valence` | 0.15 |
| `mood.return.delta.energy` | 0.1 |
| `mood.return.delta.tension` | 0.1 |
| `mood.return.halfLifeMs` | 14400000 |
| `temperament.followHalfLifeMs` | 432000000 |
| `temperament.anchorHalfLifeMs` | 864000000 |
| `temperament.stepMs` | 3600000 |
| `temperament.sampleOffsetMs` | 1800000 |
| `temperament.clamp.valence` | 0.3 |
| `temperament.clamp.energy` | 0.25 |
| `temperament.clamp.tension` | 0.15 |
| `temperament.maxHoursPerCall` | 9600 |
| `relationship.dailyGain.closeness` | 0.02 |
| `relationship.dailyGain.trust` | 0.012 |
| `relationship.dailyGain.familiarity` | 0.03 |
| `relationship.points.first-real-exchange.closeness` | 0.4 |
| `relationship.points.first-real-exchange.trust` | 0.2 |
| `relationship.points.first-real-exchange.familiarity` | 0.4 |
| `relationship.points.later-user-turn.closeness` | 0.05 |
| `relationship.points.later-user-turn.trust` | 0 |
| `relationship.points.later-user-turn.familiarity` | 0.05 |
| `relationship.points.reach-out-reply.closeness` | 0.2 |
| `relationship.points.reach-out-reply.trust` | 0.2 |
| `relationship.points.reach-out-reply.familiarity` | 0 |
| `relationship.points.disclosure.closeness` | 0.3 |
| `relationship.points.disclosure.trust` | 0.1 |
| `relationship.points.disclosure.familiarity` | 0.4 |
| `relationship.points.kept-promise.closeness` | 0 |
| `relationship.points.kept-promise.trust` | 0.4 |
| `relationship.points.kept-promise.familiarity` | 0 |
| `relationship.points.milestone.closeness` | 0.5 |
| `relationship.points.milestone.trust` | 0 |
| `relationship.points.milestone.familiarity` | 0.2 |
| `relationship.points.touch-pleasant.closeness` | 0.1 |
| `relationship.points.touch-pleasant.trust` | 0 |
| `relationship.points.touch-pleasant.familiarity` | 0 |
| `relationship.points.ritual-reciprocated.closeness` | 0.1 |
| `relationship.points.ritual-reciprocated.trust` | 0 |
| `relationship.points.ritual-reciprocated.familiarity` | 0.1 |
| `relationship.reachOutReplyWindowMs` | 7200000 |
| `relationship.firstRealExchangeTurn` | 3 |
| `relationship.negatives.unkind.trustFactor` | 0.95 |
| `relationship.negatives.unkind.closenessDrop` | 0.01 |
| `relationship.negatives.unkind.wound` | 0 |
| `relationship.negatives.hurtful.trustFactor` | 0.85 |
| `relationship.negatives.hurtful.closenessDrop` | 0.03 |
| `relationship.negatives.hurtful.wound` | 0.15 |
| `relationship.negatives.touch-unwelcome-persistent.trustFactor` | 0.97 |
| `relationship.negatives.touch-unwelcome-persistent.closenessDrop` | 0 |
| `relationship.negatives.touch-unwelcome-persistent.wound` | 0 |
| `relationship.persistentUnwelcomeTouchBurst` | 3 |
| `relationship.maxNegativesPerDay` | 2 |
| `relationship.maxMilestonesPerDay` | 1 |
| `relationship.maxMilestoneIds` | 64 |
| `relationship.woundHalfLifeMs` | 432000000 |
| `relationship.absence.graceMs` | 259200000 |
| `relationship.absence.retained` | 0.6 |
| `relationship.absence.halfLifeMs` | 5184000000 |
| `relationship.rolloverHour` | 4 |
| `relationship.stages.closeness.friendly.up` | 0.15 |
| `relationship.stages.closeness.friendly.down` | 0.1 |
| `relationship.stages.closeness.close.up` | 0.35 |
| `relationship.stages.closeness.close.down` | 0.28 |
| `relationship.stages.closeness.intimate.up` | 0.6 |
| `relationship.stages.closeness.intimate.down` | 0.52 |
| `relationship.stages.trust.open.up` | 0.35 |
| `relationship.stages.trust.open.down` | 0.3 |
| `relationship.stages.trust.confiding.up` | 0.45 |
| `relationship.stages.trust.confiding.down` | 0.39 |
| `relationship.stages.familiarity.knows-you.up` | 0.25 |
| `relationship.stages.familiarity.knows-you.down` | 0.2 |
| `relationship.startingStageMargin` | 0.01 |
| `relationship.unlocks.teasing.closeness` | friendly |
| `relationship.unlocks.teasing.trust` | open |
| `relationship.unlocks.nicknames.closeness` | close |
| `relationship.unlocks.nicknames.familiarity` | knows-you |
| `relationship.unlocks.initiative.closeness` | close |
| `relationship.unlocks.vulnerability.closeness` | close |
| `relationship.unlocks.vulnerability.trust` | confiding |
| `relationship.unlocks.callbacks.familiarity` | knows-you |
| `relationship.unlocks.callbacks.minMilestones` | 3 |
| `history.maxRows` | 400 |
| `rendering.valence.boundaries` | [-0.45, -0.15, 0.15, 0.45] |
| `rendering.valence.words` | [upset, low, even, good, bright] |
| `rendering.energy.boundaries` | [-0.45, -0.15, 0.15, 0.45] |
| `rendering.energy.words` | [drained, tired, steady, lively, buzzing] |
| `rendering.tension.boundaries` | [0.22, 0.45] |
| `rendering.tension.words` | [relaxed, a little on edge, tense] |
| `rendering.exitHysteresis.valence` | 0.05 |
| `rendering.exitHysteresis.energy` | 0.05 |
| `rendering.exitHysteresis.tension` | 0.04 |
| `rendering.nightFromHour` | 20 |
| `rendering.reasons.maxShown` | 2 |
| `rendering.reasons.showWeight` | 0.04 |
| `rendering.reasons.keepWeight` | 0.03 |
| `rendering.reasons.keepShareOfBestExcluded` | 0.5 |
| `rendering.reasons.modelCueWeightFactor` | 0.5 |
| `rendering.reasons.maxChars` | 60 |
| `rendering.stageSentences.stranger` | you are still getting to know him; keep it polite and a little reserved |
| `rendering.stageSentences.friendly` | you are friendly and at ease with him |
| `rendering.stageSentences.close` | you are close and comfortable with him |
| `rendering.stageSentences.intimate` | you are very close; you can be openly affectionate and say what you feel |
| `rendering.unlockSentences.teasing` | you can tease him a little |
| `rendering.unlockSentences.nicknames` | you may use a nickname for him if you have one |
| `rendering.unlockSentences.initiative` | you may start conversations and suggest things yourself |
| `rendering.unlockSentences.callbacks` | you may bring up things you shared before |
| `rendering.unlockSentences.vulnerability` | you can admit when something hurts |
| `urge.weights.valence` | 0.35 |
| `urge.weights.energy` | 0.15 |
| `urge.weights.tension` | 0.2 |
| `urge.tensionFloor` | 0.3 |
| `urge.exponent.min` | -0.4 |
| `urge.exponent.max` | 0.3 |
| `urge.pointed.maxValence` | -0.2 |
| `urge.pointed.minTension` | 0.35 |
| `face.damping.floor` | 0.25 |
| `face.damping.graceMs` | 120000 |
| `face.damping.halfLifeMs` | 1200000 |
| `face.gains.mouthForm` | 0.35 |
| `face.gains.eyeOpen` | 0.15 |
| `face.gains.blinkRateOffset` | -0.25 |
| `face.gains.browAngle` | 0.4 |
| `face.blinkRateOffsetClamp` | 0.4 |
| `face.channelRanges.mouthForm` | 2 |
| `face.channelRanges.eyeOpen` | 1 |
| `face.channelRanges.browAngle` | 2 |
| `face.channelShare` | 0.35 |
| `face.filterTauMs` | 1500 |
| `idle.night.fromHour` | 22 |
| `idle.night.deepHour` | 1 |
| `idle.night.untilHour` | 5 |
| `idle.night.clearHour` | 7 |
| `idle.solitudeHalfLifeMs` | 1800000 |
| `idle.solitudeUnknown` | 0.5 |

The `idle` rows were added on 2026-11-12. They shape self-directed idle behaviour through `idleDriveOf`; the [idle agency ADR](2026-11-12-idle-agency.md) records the rules.

## Known gaps

These are constants decisions for the card owner. None of them is a defect, but each changes how the character reads over time. The figures come from the committed `typical-month` run, `pnpm qa:character simulate --scenario typical-month --days 90 --seed 41`, unless a bullet says otherwise.

- **Trust calibration.** The daily trust ceiling of 0.012 is slow. Trust measures 0.0567 at day 30, 0.1239 at day 60, and 0.1869 at day 90. These sit well below the earlier draft's trust targets of 0.33 and 0.42. Raise `relationship.dailyGain.trust` only after a simulator run shows that the trust stages still open at a pace you accept.
- **Mood tail.** A significant positive keeps its contribution until the weight falls below the epsilon, about 42 hours after the event, which follows from its 9 hour half-life. One significant positive keeps a "good" valence reading for about 205 hours. The 205 hour figure was measured with a script against the shipped core, outside the simulator.
- **One-word MOOD reason.** A model cue's reason weight is 0.08 times the 0.5 model factor, which is 0.04 at insertion. That equals the show threshold, so the reason falls below it at once. A one-word reason therefore never renders.
- **Model cues leave her disposition alone.** A MOOD cue lifts or lowers her mood but never her temperament, so a stretch of warm conversation that only the model narrates, with no touch, reply, or event, leaves her resting disposition where it was. Temperament valence measures 0.1788 on day 30. Under one `brighter` cue a minute for 30 days (`pnpm qa:character simulate --scenario model-spam --days 30 --seed 41`), temperament stays at resting and valence peaks at 0.5916 on every day, under the 0.64 ceiling.
- **Day-30 closeness reads as friendly.** Closeness measures 0.3491 on day 30. It sits just under the close threshold of 0.35, so the prompt says friendly and not close.
