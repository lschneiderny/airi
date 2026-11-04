# Nonverbal channels: touch, gestures, wordless replies, and the conversation register

Date: 2026-10-31
Status: accepted

## Context

The character lives in the corner of the screen, but before this change most of her communication was a paragraph of speech:

- Petting or poking her on the Live2D stage moved the model for about two seconds and nothing else. The stage emitted a `touch` event that no code consumed, and the poke's surprise impulse was deliberately kept out of mood.
- Every reply was spoken text. On a user turn, `<|SILENT|>` was an ordinary special, so she could not answer with only a look or a nod.
- ACT cues could carry an emotion, an expression, a motion, and a gaze, but no gesture. Natural already had emotion-driven gesture clips, but no host could request one.
- The prompts disagreed about how she talks: the stage contract said "talking, not writing", while the unprompted prompts said "text them". No setting chose a register.
- A reply could not arrive as a burst of short messages, and the speech-safe text rule forbade text faces such as `:3`.

Luke asked for touch to change her mood every time and to earn an occasional one-line reaction, for a user message to be answerable with an expression alone, for a gesture vocabulary, and for a texting register with a Discord-like flavor.
The existing reach-out system is the [urge gate](2026-10-29-unprompted-reach-out-cadence.md). It is tuned in minutes, has a 2-minute floor, and keeps social memory (unanswered openings, damping). A poke protest that arrives minutes later, or that counts as an unanswered opening, would be wrong.

## Decision

### Touch never opens a reach-out (D1)

`touch` is not in `GATE_ELIGIBLE_EVENT_KINDS`, and a pin test keeps it out. The urge gate never picks a touch as a topic. A separate, pure reaction policy owns all speech about touch.

### Touch is a situation event (D2)

A stage reports a `TouchObservation` (`gesture` `pet` or `poke`, `region` `head` or `body`, `atMs`, and `durationMs` for a pet) for every finished pet and every poke. A pet start is never reported, so a pet is reported once, when it ends.
The reducer folds it into a single event under the topic key `TOUCH_TOPIC_KEY` (`touch`), so each touch replaces the previous one:

- A poke reads "poked your head" or "poked your body". The third poke within 10 s turns the event into a burst that reads "poked you N times in a few seconds".
- A pet reads "petted your head briefly" under 2 s and "petted your head for about N s" otherwise. Pets less than 5 s apart merge into one span whose duration is the sum of their lengths.
- The salience keys are `touch-pet` (0.3), `touch-pet-long` (0.4, for pets of at least 10 s), `touch-poke` (0.25), and `touch-poke-burst` (0.4). Each has a 3-minute half-life.
- The reducer drops unknown gestures and regions, pets that are not on the head or have no valid duration, and a touch whose time is not later than the previous touch.

The event renders as a `New:` bullet in the situation block, so her next user or unprompted reply knows about it. It is never addressed with `markAddressed`. It is marked shown once a block lists it, and a reaction turn marks it shown before it starts, because the trigger message already carries the touch.

### Touch doses mood through the performance decider (D3)

`touchAffect` in `@proj-airi/stage-shared/expression-performance` turns one classified touch into at most one `MoodDose`. It is pure: time and memory come in, and the returned memory replaces the old one. The `touch` affect signal reaches it through the decider, and `PerformanceDecision.moods` carries the result.
A dose is measured in band units, where one unit is the band's profile-resolved mood gain times its nominal intensity:

- A pet start doses slight along [+1 valence, 0, -0.5 tension], at most once every 4 s. A pet that lasts at least 3 s escalates to clear along the same vector at its end, adding only the missing amount. A shorter pet doses nothing more.
- A poke doses slight along [0, +1 arousal, 0], scaled by 0.6 on the body, at most once per second. The third poke within 10 s doses clear along [0, +0.5, +1 tension] instead, once per burst.
- Doses of the same kind habituate over a 60 s window. Poke and burst doses use `max(habituationFloor, habituationBase^n)`. Pet doses use `habituationBase^n` without the floor, so continuous petting saturates instead of adding a floor-sized dose on every pet.

Under Live2D Natural only, the stage conductor sends each dose to the scene's `addMood`, which adds it to `NaturalMood` with the same clamps as emotion episodes and ignores a repeated dose id. Universal and MAGIC never receive a dose, and the Natural `mood` switch still disables mood.
MMD Natural currently ignores gestures, touch mood doses, and touch reactions; MMD support is a follow-up.
Superseded by [2026-11-04-interaction-portability](2026-11-04-interaction-portability.md): MMD Natural receives mood doses through `addMood`, and its touches reach the same touch path.
Touch creates no emotion episode. The Natural flinch, glance, and pet layer behave as before.
A reaction turn about a touch must not dose mood again from its own cues. When a turn's trigger has the `touch` topic key, `Stage.vue` calls `markMoodless(turnId)` on its conductor, and every episode of that turn carries a mood gain of 0.

### A pure reaction policy decides when a touch earns a line (D4)

`reactionPolicy` and `settleReaction` in `@proj-airi/stage-shared/situation` take explicit time and memory. The policy has its own Mulberry32 checkpoint in `ReactionMemory`, separate from the urge gate's. It evaluates in this order and draws a random number only at the last step:

1. It rejects a non-finite time. It normalizes the memory: future times are pulled back to now, a pending reaction older than 30 s is dropped, and a new chat session resets everything except the random state.
2. It updates its bookkeeping: the pets seen in this session, and the end of a poke burst once the previous poke is at least 10 s old.
3. A pet is a candidate with probability 0.3 when its merged duration is at least 3 s, it is not the first pet of the session, and her last line (spoken or reaction) is at least 20 s old.
4. A poke is a candidate with probability 0.8 when it is at least the third poke within 10 s and the burst has not rolled yet.
5. Pacing holds a candidate while a reaction is pending, for 45 s after her last reaction line (the refractory), and for 20 s after the last attempt (the retry wait).
6. A subset of the hard suppressors holds it, in the order of `hardReason`: unprompted turns disabled, Do Not Disturb, hidden stage, user speaking, user typing, character speaking, generating, queued, and a quiet app. Presence, stale signals, and busy states do not hold a reaction, because the user who touches her is present by definition.
7. The roll speaks when the draw is below the candidate's probability. A poke burst rolls once, whatever the result.

The leader's situation store runs the policy after each touch is folded, but only while its urge gate runs. A follower never evaluates. A speak decision marks the touch event shown and starts the reaction turn. The settle rules are:

- **Spoken.** The reaction settles at its first literal. The policy records her last line, which starts the 45 s refractory. The urge gate's memory gets `recordExternalSpeech`, so its floor starts as after a forced turn, and the line never counts as an unanswered opening. The situation records a `conversation` observation with origin `reaction`, which counts only as her last line. A spoken line that arrives late, after its pending entry has already settled or expired, also starts the refractory.
- **Declined, cancelled, or failed.** The pending entry clears, and the retry wait runs from the attempt.
- **Refused send.** When another unprompted turn is already pending, the chat refuses the send. The store rolls the attempt back: the random state, the attempt time, and the burst flag return to their values before the decision, so the same draw is used for the next candidate and no retry wait starts.

A reaction outcome never reaches `recordUrgeFireOutcome`. The reaction memory, with its random state, is saved with the gate's inner state. A promoted leader drops the previous leader's pending entry, because that turn does not exist in its window.

### A reaction is an unprompted turn (D5)

`useChatStore().submitReaction({ kind, topicText, eventId })` is a sibling of `submitUnprompted` and keeps `origin: 'unprompted'`, so no new origin value or plugin contract exists. It shares the single pending unprompted turn, uses the turn ID `reaction:<eventId>`, offers only the read-only `builtIn_readMemory` tool, and declines on `<|SILENT|>` with one control record.
The trigger is `{ topicKey: 'touch', text, kind: 'touch-pet' | 'touch-poke' }`. The trigger message is `base.prompt.reaction-trigger` ("(Just now, on the stage: they ...)"), and the instruction is `base.prompt.reaction`, or `base.prompt.reaction-protest` for a poke protest. Both ask for one short in-character line, allow `<|SILENT|>`, and forbid a question.
No reason category is added, and a reaction is never forced. Chat history labels the reply with a "Reacted to a pet" or "Reacted to a poke" cue.

### A user turn can be answered without words (D6)

The runtime builds the decline pattern for every origin. On a user turn, it consumes `<|SILENT|>` that appears in visible speech before any spoken text: no hook receives it, and nothing stores it.
When such a reply ends without visible text, it is wordless if it carried at least one ACT, and silent otherwise. Both store one assistant message with `content: ''` and `wordless: { cues }`, where each cue holds the ACT's `emotion` and `gesture`.
The stage performs the ACT cues as usual, and no literal reaches speech. Later requests send the message to the provider as its cue text: one `<|ACT {...}|>` per cue, followed by `<|SILENT|>`.
Chat history renders the message as a small chip outside any bubble, such as "reacted - nodded" or "stayed quiet", so the user's message never looks ignored. `ChatTurnCueStats` gains `silent` and `wordless`. Unprompted decline semantics are unchanged.
The contract's reply-shape section teaches the rule: "If a look says it all, answer with the ACT cue and `<|SILENT|>` and no words."

### ACT carries a gesture (D7)

An ACT JSON payload may carry `gesture`: `"nod"`, `"shake"`, `"shrug"`, `"lean"`, or `"glance"`, or `{ "kind": "nod", "count": 2 }`. `count` is 1-3 for nod and shake (default 2) and 1 otherwise. The bare form, such as `<|ACT nod|>`, stays emotion-only, and a gesture-only ACT is valid. The [pipelines-audio README](../../../packages/pipelines-audio/README.md) records the normalization.
Under Natural, `NaturalCueGestures` plays each gesture as a time-shaped clip on head, body, and eye channels, with its own random stream, so the existing emotion clips draw exactly as before:

- A nod is two pitch dips of about 0.9 s.
- A shake is two yaw cycles of about 1 s.
- A shrug is a 1.1 s body bob with a brow lift.
- A lean is a 2.6 s body roll toward the inward side of the stage placement.
- A glance moves only the eyes aside for 0.6 s and back.

A gesture that is still active is not restarted. A conflicting gesture waits in a one-slot queue for up to 1.5 s, and a newer conflicting gesture replaces it. While a cue gesture owns the head, emotion recipe clips do not start. The `heldEmotions` switch does not gate cue gestures.
The cue gesture kind `CueGestureKind` is separate from the emotion clip kinds, whose `shake` is unchanged. Only Live2D Natural plays the field; Universal, MAGIC, and MMD Natural ignore it. Superseded in part by [2026-11-04-interaction-portability](2026-11-04-interaction-portability.md): every Natural renderer plays the field, MMD Natural included. The amplitudes are starting values that are tuned on screen. The [stage-ui-live2d README](../../../packages/stage-ui-live2d/README.md) lists the shapes.

### BREAK splits one reply into bubbles (D8)

`<|BREAK|>` pauses for 1 s, and `<|BREAK n|>` pauses for `n` seconds, clamped to 0.3-3.0. Any other body is rejected and never spoken.
In visible speech, the runtime ignores a break before the first text and drops a trailing break. Adjacent breaks merge and keep the larger pause. At most two breaks are accepted, so a reply has at most three bubbles.
An accepted break adds a `{ type: 'break', seconds }` slice and `\n\n` to the content. The reply stays one persisted assistant message, so reply, edit, delete, regenerate, transcripts, and copy work as before. `cueStats` gains `breaks` and `breaksIgnored`. The [core-agent README](../../../packages/core-agent/README.md) records the full rule.
Chat history renders one bubble per text run between breaks. While a reply streams, a bubble after a break appears `seconds` after that break arrived. That schedule keeps running after generation ends, so a reply that finishes early still reveals its later bubbles on time. A message that is already complete when the history mounts shows every bubble at once.
Speech treats BREAK as a hard segment boundary. The pause lives in the ordered playback track of `@proj-airi/pipelines-audio`'s speech pipeline: after the marker fires, the next clip waits `seconds` on the pipeline clock, independent of the stage. The semantics are the same in every register. Only the texting prompt teaches BREAK.

### The register is a user setting, and the contract is register-neutral (D9)

`@proj-airi/stage-shared/conversation-register` defines the registers `talking` and `texting`, the texting flavors `plain` and `discord`, their prompt keys, the ASCII face list, and `renderRegisterSection`. `useConversationSettings` stores `register` (default `talking`) and `textingFlavor` (default `plain`) at `settings/conversation`, synced like the Presence settings.
The **Settings > Conversation** page edits both. It registers itself through its route meta (`settingsEntry`, `icon`, `order`), so neither settings layout changed. The flavor control is disabled while the register is Talking.
The stage contract was revised once to be register-neutral, which bumped `STAGE_CONTRACT_EN_SHA256` once:

- The emotion section opens with "Your reply is performed by an animated avatar."
- The emoji rule is "Do not use emojis."
- The reply-shape section no longer says "You are talking, not writing".
- The contract gained the gesture line and the wordless sentence.

The register text (`base.prompt.register-talking`, `register-texting`, and `register-texting-discord`) is rendered by the chat store. It sits in the session system prompt after the character prompt and before the stage contract. The contract text and its hash are therefore identical under both registers, and model-eval keeps one contract version. The `base.prompt.unprompted*` prompts were reworded to be register-neutral too.
No character card field was added. The card's own system prompt still supplies the persona's voice.

### ASCII faces are shown and never spoken (D10)

The Discord flavor allows one face per message from a closed set: `:3 ^^ ^_^ >_< >.< T_T ;_; :) :( :D ;) :P xD XD o_o O_O -_- ^w^ <3`. Pronounceable faces such as `uwu` are excluded, and Unicode emoji stay forbidden.
`ASCII_FACES` lives only in `@proj-airi/stage-shared/conversation-register`, so `@proj-airi/pipelines-audio` depends on stage-shared for this list. The TTS chunker strips the faces from each assembled segment, never from raw deltas, in every register. The match needs a start or whitespace before the face and an end, whitespace, or punctuation after it, so `10:30` and `C:D` survive.
Bubbles keep the faces, and captions keep them through the segment's display text. A segment that is empty after stripping is skipped, while its bubble still shows.

### Test strategy, delivery, and scope (D11-D13)

Tests were written after each implementation, inside the same commit, and sized like their neighbors. Every policy is pure, with explicit time and memory, and every statistical assertion uses a seeded random stream.
The work ships on the branch `luke/feat/nonverbal-channels` as atomic commits that each pass `pnpm verify`. It merges through a pull request against `lschneiderny/airi`.
"Discord" here is a texting flavor only. The Discord bot integration is untouched.

## Consequences

**No double-dose guard.** Each rendered stage owns its own conductor, so mood, cooldowns, and habituation are per stage. When two stages render at once, for example in two windows, touching both doses mood twice as often as touching one. The leader also receives one observation per touch from each stage. The reducer drops a touch whose time is not later than the previous one, which catches an echo with an equal timestamp but not two reports a millisecond apart. No guard was built. The stage touch store documents this behavior.

**A register flip mid-session.** A register, flavor, or locale change rewrites the active session's stored system message once. That request misses the provider's prompt cache from the register section onward, and later requests are cache-stable again. Earlier replies in the history keep their old shape, so the model can still see bursts or faces from before the flip. BREAK has the same semantics in every register, so a burst after a flip to Talking still splits and pauses.

**Reaction request cost.** Every speak decision is one full model request with the session context and the read-only memory tool, and a declined reaction costs the same as a spoken one. The cost is bounded by the silent first pet, the 0.3 and 0.8 odds, the single pending turn, the 20 s retry wait, and the 45 s refractory after a spoken line. In the worst case, when every reaction is declined, the policy makes at most one request every 20 s while the user keeps touching her.

**Chat sync degrades bursts and drops wordless replies.** The sync wire carries content only. A burst syncs as its content, so another device shows one bubble with blank lines where the breaks were. A wordless reply has empty content and stays local, like unprompted triggers. Both are supported policy, not workarounds. Cloud sync requires an account and is inactive in this account-free fork.

**Plugins no longer see user-turn `<|SILENT|>`.** Before this change, a plugin hook received `<|SILENT|>` as a token special on a user turn. The runtime now consumes it, and `cueStats.silent` and `cueStats.wordless` report the outcome instead. Unprompted turns, reactions included, keep their decline semantics.

**DELAY still does not pause playback.** `SpeechOutput.onSpecial` returns nothing, and the stage fires its special handler without awaiting it, so a DELAY pauses only the stage's dispatch chain, as before this change. BREAK pauses the speech track itself. Making DELAY pause playback is a follow-up.

**Streaming speech providers get neither stripping nor the pause.** `streamSpeech`, which the hosted bidirectional WebSocket provider uses, bypasses the TTS chunker. It does not strip faces and does not pause at BREAK. That provider is excluded in this fork. Applying both to it is a follow-up.

**A face alone in a segment leaves the caption.** A segment that is empty after face stripping is skipped, so a face that forms its own segment drops from the caption while the bubble keeps it.

**The contract hash changed once.** Model-eval runs before and after the revision record different contract versions. The [reply-shape ADR](2026-10-31-reply-shape-contract.md) remains the record of the reply-shape rules, and this ADR records their register-neutral revision.

**Follow-ups.**

- `streamSpeech` (hosted bidirectional WebSocket only) has no face stripping or BREAK pause.
- DELAY does not pause the speech track.
- The qa-tools aggregate report does not total the scorer version 3 fields.
- The qa-tools 3-poke scenario evaluates the reaction policy itself, because the leader's evaluation is internal to the situation store.
- MMD Natural ignores cue gestures, touch mood doses, and touch reactions, because the stage gates gestures on the Live2D renderer, `MMDScene` has no `gesture` or `addMood`, and `Stage.vue` routes touch only from `Live2DScene`. MMD touch events are not routed yet (follow-up). Resolved by [2026-11-04-interaction-portability](2026-11-04-interaction-portability.md).
- Reaction odds, the refractory, and gesture amplitudes are starting values that are tuned from real use and the inspector.

## Validation

- Pure rules have unit tests with explicit time and seeded randomness: the touch reducer, touch affect (including a 20-poke saturation run), the reaction policy (including 10,000-candidate rate bands of 0.30 and 0.80 within 0.02), register parsing, BREAK and gesture parsing, and face stripping.
- Pin tests keep `touch` out of `GATE_ELIGIBLE_EVENT_KINDS`, keep the unprompted decline of `<|ACT happy|><|SILENT|>`, keep the existing emotion gesture draws, and keep the `hardReason` order.
- `STAGE_CONTRACT_EN_SHA256` is pinned in stage-shared, stage-ui, and qa-tools, and a test renders the contract under both registers and compares the hashes.
- Runtime tests cover wordless and silent user turns and the break rules. Store and component tests cover the reaction submission, settle, and rollback paths; the moodless turn; Live2D Natural-only gesture dispatch; the bubble reveal schedule; the wordless chip; and the sync policy.
- Natural tests check each cue gesture's trajectory, the queue rules, and that every gesture stays within the parameter range when combined with a strong emotion clip and the pet layer.
- qa-tools scorer version 3 counts gestures, breaks, silent and wordless replies, and ASCII faces. Its T1 scenarios assert the five gesture trajectories, and a touch scenario asserts that a 3-poke burst makes exactly one reaction decision. The [qa-tools README](../../../packages/qa-tools/README.md) documents the fields.
- A rendered pass in the Electron app checks each channel before the branch merges.

Related decisions: [situational presence](2026-10-19-situational-presence.md), [unprompted reach-out cadence](2026-10-29-unprompted-reach-out-cadence.md), [Live2D touch interaction](2026-10-18-live2d-touch-interaction.md), [expression performance](2026-10-18-expression-performance.md), and [Natural emotion revamp](2026-10-19-natural-emotion-revamp.md).
