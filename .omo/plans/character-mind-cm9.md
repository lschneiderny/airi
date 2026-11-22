# character-mind-cm9 - Work Plan

Status: planned on 2026-11-22; CM9a and CM9b built on their branches (see [Slice records](#slice-records)). Roadmap rows: steps CM9a to CM9f and CM10 in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Source of the open items: the [Target audit](../drafts/character-mind-target-audit.md), checked again against `main` at `87c2f24f5` for this plan (section 2.8 lists where the audit is wrong or incomplete). Rulings: the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md) (decisions 2, 4, 5, 6, and 14), the [core ADR](../../docs/ai/adr/2026-11-18-character-mind-core.md) (D15: realisation details stay in the performers), the [idle ADR](../../docs/ai/adr/2026-11-20-character-mind-idle.md), the [glances ADR](../../docs/ai/adr/2026-11-21-character-mind-glances.md), the [director input ADR](../../docs/ai/adr/2026-11-21-character-mind-director-intents.md), and the [performer capabilities ADR](../../docs/ai/adr/2026-11-22-character-mind-performers.md). Required reading for every worker: the `enforce-rules-for-render-loops` and `motion-qa` skills.

**Owner answers recorded for this plan (2026-11-22).**

- **Upstream drivers: "Scope to Natural".** Autonomous behavior Target rules 1, 2, and 5 cover Natural only. Universal, MAGIC, and classic stay as upstream ships them, consistent with the D2 ruling of 2026-11-21 and ADR decision 14. The doc change lands as CM9a's first item (D1), and the upstream-driver items leave the open work.
- **CM10 refractories: "Build now".** CM10 is a real slice and goes last (D19).
- **CM9b fast mood and CM9f travel gaze: no explicit answer.** Under the owner's standing instruction to use the recommendations, this plan applies the recommended options: mood survives a model or driver switch (D8), and travel is an arbiter input over which a granted touch or chat glance holds briefly, with idle glances below travel (D16). Both are marked "recommended, applied without an explicit answer"; the owner can still veto them before the slice starts.

**Split (D2).** Seven PRs, one per slice, in three lanes that may run in parallel worktrees:

- **Lane A:** CM9a emotion gestures, then CM9b fast mood (stacked: both rewrite the emotion branch of `startPending`, the conductor's `dispatchNatural`, and the headless cue player).
- **Lane B:** CM9c settling, then CM9d the wander linger (stacked: both change `idle-schedule.ts`, the director, and `MMD.vue`'s errand and idle wiring), then CM9e act moments (it changes the idle records that CM9c touches).
- **Lane C:** CM9f travel gaze.
- **CM10** starts after all three lanes have merged: it touches the touch answer, `startPending`, the director memory, and `useIdleProps`, which every lane edits.

## TL;DR (For humans)

**What changes.** Seven decisions that a renderer or a stage still makes on its own move into the character mind, so she makes each of them once per character:

- **CM9a.** The mind chooses the body gesture of an emotion (laugh, recoil, shake or drop, sway, tilt-in, look-away, nod-off) and keeps the gesture cooldowns. Natural plays the gesture it is told.
- **CM9b.** The mind keeps her emotional afterglow (valence, arousal, tension) and sends every dose. A model reload or a driver switch no longer resets her mood.
- **CM9c.** The mind's idle policy decides when she settles in after two minutes of idle; the director still turns it into sitting or resting.
- **CM9d.** How long she stays where a wander or a visit took her is drawn with the wander, by the mind; when that stay ends she walks home and the errand ends.
- **CM9e.** The expression that marks an idle act, a held-back cue, or a wake is drawn from the mind's order, so every stage picks the same one.
- **CM9f.** On MMD, walking becomes an input of the gaze arbiter: a poke, a pet end, a wake, or a chat read still gets its glance while she walks, briefly; her own idle glances wait.
- **CM10.** The director's clip and tool refractories, the poke surprise dedupe, and the moment entry rest live in the mind, so a model reload cannot reset them.

**What does not change.** No gesture shape, cooldown length, mood gain or time constant, settle time, linger range, glance priority among existing sources, or refractory length. No new setting or storage key: everything moved is fast state, which resets on launch and at a card switch. Universal, MAGIC, and classic get no new intents.

**Why.** Autonomous behavior Target rules 1, 2, and 4 and Body ownership Target rule 3 (MMD gaze).

**Effort:** S to M per slice. **Risk:** Medium for CM9a and CM9f, which change seeded draws on purpose (section 8 lists every expected trace change); low for the rest, which are expected byte-identical in the headless runs.

## 1. Upstream first

`main` contains upstream through `bd4f30391` (sync 2.1). Nothing upstream decides an emotion gesture, a fast mood, a settle, a linger, an act moment, a travel gaze, or a director refractory: `motion-driver-natural`, `motion-driver-humanoid`, `character-mind`, `stage-ui/src/composables/performance`, `stage-ui-mmd/src/composables/mmd`, `qa-tools`, and `lab-tools` are fork-only. `docs/ai/context/upstream-policy.md` gains no row.

Upstream files a slice changes, and why (ADR decision 14):

| Upstream file | Slices | Why |
| --- | --- | --- |
| `packages/stage-ui/src/components/scenes/Stage.vue` | CM9e, CM10 | Act moments carry the order's intent id to `useIdleProps`; the moment entry rest comes from the mind |
| `packages/stage-ui-mmd/src/components/scenes/MMD.vue` | CM9b, CM9c, CM9d, CM10 | The scene seeds mood, feeds the mind's settle and linger to the director, ends the wander errand at the walk home, and seeds the refractories |
| `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`, `packages/stage-ui-live2d/src/components/scenes/Live2D.vue` | CM9b | The scene surface gains the mood seed beside `addMood` |

Each slice starts by rerunning `git log --oneline main..upstream/main -- <the paths of its section 4 row>` after a fresh `git fetch upstream`; if it prints anything, the slice stops and reports it.

## 2. Today's code

Every claim was checked by reading the code at `87c2f24f5`.

### 2.1 Emotion gestures (CM9a)

- The mind answers an `emotion` stimulus with one face `emotion` intent (`answerEmotion` in `packages/character-mind/src/expression.ts`), and an `expression-request` with a face `entry` intent whose `episode` may be a new episode (`answerExpressionRequest`).
- `StagePerformanceConductor` `emotion` and `expression` (`packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts`) hand the episode, with `moodGain`, to `scene.setEmotion` through `dispatchNatural`. Both paths reach Natural, so both can play a gesture.
- `startPending` in `packages/motion-driver-natural/src/pending-actions.ts`, emotion branch: with `settings.heldEmotions` on, a zero per-model emotion strength skips the episode; the gesture is `emotions[emotion].gesture` from the recipe table (`packages/motion-driver-natural/src/emotions.ts`); `impulses.trigger` must start (it refuses an emotion without an impulse spec, a zero intensity, or a repeated id); the gesture is skipped while a cue gesture holds the head (`cueGestures.headActive`); then `NaturalGestures` `trigger` refuses a slight band, a zero strength, or a running cooldown.
- `NaturalGestures` (`packages/motion-driver-natural/src/gestures.ts`) keeps `lastTrigger` per cooldown key (`cooldowns`: laugh 4 s, recoil 3, angry 5, sway 4, tilt-in 5, look-away 4, nod-off 8; shake, drop, and shake-or-drop share `angry`), on Natural's active seconds. On its own stream (`streamIndex.gestures`, 12, in `natural-motion.ts`) it draws the side, then for `shake-or-drop` the choice, then the clip's shape.

### 2.2 Fast mood (CM9b)

- `NaturalMood` (`packages/motion-driver-natural/src/mood.ts`) is built per `NaturalMotion` controller. `add(episode)` keeps per-episode dose bookkeeping so an escalation adds only the missing dose; `addDose(dose)` applies a touch dose once per id; `step(dt)` decays on Natural's active seconds with `moodDynamics` time constants. A new controller, as after a model reload or a driver switch back to Natural, starts at zero.
- The gain is resolved by the conductor (`dosed`: `moodGain` from the effective profile's `moodDynamics`, 0 for a turn marked by `markMoodless`). `startPending` adds the episode only when the impulse started, the model's emotion strength is not 0, and `settings.mood` is on.
- The mind already decides touch doses (`touchAffect` in `answerTouch`) and sends them as posture `mood` intents, which the scenes queue through `addMood`.
- `EmotionBehaviorSettings` already carries `mood` and `moodDynamics`, and the mind receives them with every `emotion`, `expression-request`, and `touch` stimulus.

### 2.3 Settling (CM9c)

- `NaturalIdleActivities` (`packages/motion-driver-natural/src/idle-activities.ts`) starts `idleSince` while the drive has `body`, the mode is `idle`, and no `input.interrupt` holds, and sets `settled` after `settleSeconds` (120) of it. It reports `settled` in its idle view.
- The mind's idle schedule reads `view.settled` in `idleActivityWeights` (the settled pool) and to turn a follow-up stretch into a yawn (`packages/motion-driver-natural/src/idle-schedule.ts`).
- `MMD.vue` maps Natural's body frame to the director with `directorIdleStates` (`packages/stage-ui-mmd/src/composables/mmd/stance.ts`), and `decideBody` sits her or rests her only at home, at rest, in `idle` mode, without a held goal or asked wander.
- `IDLE_TO_SIT_MS` in `packages/motion-driver-humanoid/src/director/index.ts` documents the onset that `lab-tools` reports read; `decideBody` does not use it.

### 2.4 Linger and the walk home (CM9d)

- `decideBody` seeds `rngState` from `input.seed` and draws the linger (`LINGER_MIN_MS` to `LINGER_MAX_MS`, log-uniform) on the arrival of a `wander` or `visit` goal and on a visit that arrives in place (`arriveInPlace`). The same stream draws the wander position.
- The walk home is the `return-home` goal: no goal reason for `RETURN_HOME_DELAY_MS` (20 s), past `lingerUntilMs`, not at home.
- The idle schedule's errand decision draws `holdSeconds` only for a pastime (`PASTIME_HOLD_SECONDS`); a wander's is null.
- `realiseErrands` in `MMD.vue` answers the wander errand `done` as soon as the director accepts it (`wanderAnswer`), at departure. Its refractory counts from the start (`IDLE_ERRAND_PACING`), so the end time changes no pacing.

### 2.5 Act moments (CM9e)

- `useIdleProps` (`packages/stage-ui/src/composables/performance/use-idle-props.ts`) marks moments. A mind moment (`markMoment` in `Stage.vue`, from the conductor) seeds the chance and the pick from its intent id (`expressionSeed(intentId, 'moment')`). The act moments (`ACT_MOMENTS`), `held-back` (a `let-go` start), and `waking` (a sleep end) come from `onIdleBehaviour` and draw from a local Mulberry32 stream that starts at 0 in every stage.
- `IdleBehaviourReport` carries only `phase` and `behaviour`; `IdleBehaviourReports` derives it from the layer's `seq` and kind. The order's intent id reaches `NaturalIdleActivities` `start` and its `started` report, but not the behaviour record. Cues (`about-to-speak`, `let-go`) start with intent id null: `idleCue` passes only the kind.

### 2.6 MMD travel gaze (CM9f)

- `MMDBody` `resolveGaze` (`packages/stage-ui-mmd/src/composables/mmd/body/index.ts`): while the gait moves, the goal is the travel direction, whatever Natural chose. A held glance shows on MMD only through `input.frame.fixation` in the free branch, so a glance the arbiter granted during a walk does not show.
- `NaturalGazeLayer` (`packages/motion-driver-natural/src/gaze.ts`) ranks glances by `GLANCE_PRIORITY` (7 `pet-end`, `poke`; 6 `desktop-wake`, `sleep-wake`; 5 `chat-sent`, `chat-unfold`, `voice-cue`; 4 `look-tool`, `cue-gesture`, `emotion`; 3 `screen-change`; 2 `cursor-notice`; 1 `idle-act`) and knows nothing of walking.

### 2.7 Refractories (CM10)

- Director (`BodyDirectorMemory`): `actionRefractoryUntilMs` (`ACTION_REFRACTORY_MS` 15 s, `DANCE_REFRACTORY_MS` 60 s), `gestureCooldown` (`GESTURE_REPEAT_MS` 4 s per clip), `moveRefractoryUntilMs` (`MOVE_TOOL_REFRACTORY_MS` 60 s), and `lookRefractoryUntilMs` (`LOOK_TOOL_REFRACTORY_MS` 15 s). They live in `MMDStanceDirector`'s memory and reset with a new rig. The director's clock is the frame clock plus an offset (`frameClocks`), not the mind's epoch clock.
- Poke: `NaturalMotion` keeps `pokes` and `lastPokeSurprise` per controller; `startPending` plays the surprise only `pokeSurpriseDedupeSeconds` (2 s) after the last.
- Moment entry rest: `useIdleProps` keeps `momentHistory` per stage; `chooseMomentEntry` withholds an entry for `entryRestMs` (60 s).

### 2.8 Where the audit is wrong or incomplete

1. **Claims 3.2 and 3.3 are already recorded.** The audit says MMD morph and bone ownership are "LANDED, not yet recorded as a rule". `body-ownership.md` already records them as "One final owner per MMD channel under Natural" (commit `43637affa`).
2. **The headless MMD runner bypasses the mind for emotions and pokes.** `Motion3dCuePlayer` in `packages/qa-tools/src/t2-3d/runner/cues.ts` calls the adapter's `impulse`, `gesture`, and `poke` directly with fixed episodes. Moving the gesture choice, the dose, or the poke dedupe out of Natural would silently remove them from every `qa:motion3d` run unless the cue player calls the mind's policy (D6). The audit's "equal motion for equal decisions" does not hold without that change.
3. **The Live2D rig's scenario sink drops mood doses.** `packages/qa-tools/src/t2/scenario-sink.ts` exposes no `addMood`. Today the rig's emotion still doses Natural's mood inside `startPending`; after CM9b it would not, and the rig's trace hash would move for a reason unrelated to motion. The sink gains `addMood` in CM9b.
4. **The emotion gesture has two more triggers and two more refusals than the audit lists.** An `expression-request` episode reaches Natural too, so the mind must answer it with a gesture as well. And the gesture is refused while a cue gesture holds the head, and its episode (with its dose) is skipped for a model whose emotion strength is 0. Both are performer conditions the mind cannot see (D5, D9).
5. **The director has a fifth refractory.** The audit's claim 1.6 omits `LOOK_TOOL_REFRACTORY_MS`. CM10 moves it with the others.
6. **The wander errand ends at departure, not at the walk home.** The audit's "the walk home becomes the end of that errand" is new behavior, not a move: today `realiseErrands` answers `done` on acceptance.
7. **The audit's "Upstream drivers" item is closed by the owner's "Scope to Natural" answer** and leaves the open work (D1).

## 3. The design

### 3.1 The split

The mind decides episodes: which gesture, how much mood, when she settles, how long she stays, which moment seed, and whether a request is inside a refractory. The performers play frames: gesture shape and side, mood decay and modulation on the frame clock, the sit or rest clip, the wander position, the expression entry, and the gaze path. Every new intent follows the render-loop rules: an intent from outside the frame loop takes effect at the next grid step or frame of the performer, and every duration crosses the boundary as a duration (`...Seconds`, `...Ms`), never as an absolute time of the other clock (the `MMDAttendInbox` pattern).

### 3.2 CM9a: emotion gestures in the mind

- **New file `packages/character-mind/src/gesture.ts`.** `EMOTION_GESTURE_COOLDOWN_SECONDS` (the table moved from `gestures.ts`, same values and shared `angry` key) and a pure `emotionGesture(memory, episode, settings, atSeconds)` that returns the played gesture or null and the next memory. It reads the recipe table (`naturalEmotions[emotion].gesture`; the mind already imports types from `motion-driver-natural`), requires `settings.heldEmotions`, an impulse spec, intensity above 0, and a band that is not slight after `settings.bands` (`clear` when bands are off), and refuses inside the cooldown. `shake-or-drop` resolves from the episode's own seed, `expressionSeed(episode.id, 'gesture')`, so it spends no draw of `rng` and two minds given the same episode pick the same gesture (D4).
- **State.** `MindState.gesture: { lastAtSeconds: Partial<Record<cooldown key, number>> }`, fast state, on the mind's clock (`atSeconds` of `step`).
- **Intent.** A posture intent `{ channel: 'posture', kind: 'emotion-gesture', gesture: PlayedGesture, episodeId }`, emitted after the face intent in `answerEmotion` and `answerExpressionRequest` whenever they yield a new or escalated episode. `declaredAnswer` refuses it without posture, so Universal, MAGIC, and classic report it as `undeclared` and play nothing.
- **Realisation.** The conductor's `dispatchNatural` puts the gesture on the episode it hands to `setEmotion` (`NaturalEpisode.gesture`, beside `moodGain`). `startPending` plays `episode.gesture` when present instead of reading the recipe table; it keeps the cue-gesture head check and the zero-strength skip (D5). `NaturalGestures` `trigger` takes a `PlayedGesture`, loses `cooldowns`, `cooldownKey`, `lastTrigger`, and the shake-or-drop draw, and keeps its slight-band and strength refusals as input validation.
- **Deleted.** `GestureKind`'s `shake-or-drop` stays in the recipe table (it is the mind's input), but no Natural code resolves it.

### 3.3 CM9b: fast mood in the mind

- **New file `packages/character-mind/src/mood.ts`.** `MindMoodState { valence, arousal, tension, atMs, episodes, doseIds }` and pure functions moved from `NaturalMood`: the episode dose with escalation bookkeeping (`add`), the touch dose (`addDose`), and decay to a time with the stimulus's `moodDynamics` time constants. The per-episode delta is computed exactly as `NaturalMood.add` computes it, so a performer that adds the delta sees the same numbers as today.
- **Stimuli.** `emotion` and `expression-request` gain `moodless: boolean` (the conductor's `markMoodless` set stays in the conductor, which owns turn ids). The gain comes from `settings.moodDynamics` of the stimulus, as `dosed` reads it today; `settings.mood` off doses nothing.
- **Intents.** The existing posture `mood` intent (`MoodDose`) carries every dose: the touch dose as today, and the delta of each emotion episode, with id `${episode.id}` plus its escalation step so `addDose` applies it once. A new posture `mood-level` intent `{ valence, arousal, tension }` is the mind's level decayed to now; the conductor sends it only from `syncScene` when a scene attaches or becomes Natural (D7, D8).
- **Realisation.** `NaturalMood` keeps the level, `addDose`, `step`, clamping, and the modulation readouts, and gains `set(level)`; `add(episode)`, `episodes`, and the episode branch of `startPending` are deleted. `NaturalEpisode.moodGain` and the conductor's `dosed` are deleted. Scenes gain `setMood` beside `addMood` (`Model.vue`, `Live2D.vue`, `MMD.vue`, both Natural adapters).
- **Render-loop rule.** The mind decays its level on its own clock only to answer the next dose and to seed a new performer. No frame samples the mind's level; the performer decays on its active seconds from the seed (D10).
- **Owner alternative (reset on switch).** If the owner picks reset, the one-line difference is: `syncScene` does not send `mood-level`, and a `performer` stimulus clears `MindState.mood`.

### 3.4 CM9c: settling in the idle policy

- **State.** `MindIdleState.settle: { since: number | null, settled: boolean }` in the idle policy's active seconds.
- **Rule.** `since` starts when the view is active, its mode is `idle`, and its drive has `body`; it clears on any other view, on a dormant view, and on the mind's own interrupting stimuli: `touch`, `emotion`, `expression-request` with an episode, `cue-gesture`, `presence` with a wake, `screen-change`, `chat`, an engaged `cursor-episode`, and every posture `cue` (D11). `settled` turns true at `since + 120` (the constant moves from `idle-activities.ts` to `packages/character-mind/src/idle.ts` as `SETTLE_SECONDS`). `nextIdleWakeAt` includes that deadline, so the host wakes the mind on time.
- **Intent.** A posture `settle` intent `{ settled: boolean }` on each edge. The idle schedule reads `settled` from `IdleContext` instead of `view.settled`.
- **Realisation.** `NaturalIdleActivities` drops `settleSeconds`, `idleSince`, and `settled`; `IdleView.settled` is deleted. `MMD.vue` keeps the last `settle` intent and passes it to `directorIdleStates`; a scene that attaches is seeded from `MindState.idle.settle` by `syncScene`. Live2D drops the intent (no body).

### 3.5 CM9d: the linger in the wander errand

- **Decision.** `advanceIdleSchedule` draws `holdSeconds` for a wander like a pastime's, from `IDLE_ERRAND_LINGER_SECONDS` (`45` to `150`, log-uniform, the director's law moved with its constants) right after the pick. The intent's `holdSeconds` is no longer null for a wander.
- **Realisation.** `BodyDirectorInput.wander` becomes `{ seq, pick, lingerSeconds }`. `decideBody` stamps `lingerUntilMs = nowMs + lingerSeconds * 1000` on its own clock at arrival or arrival in place, and draws no linger: `rngState` keeps only the wander position. `LINGER_MIN_MS` and `LINGER_MAX_MS` leave the director.
- **The walk home ends the errand.** `realiseErrands` answers the wander `done` when the director issues `return-home` for that errand's stay (a new `BodyDirectorMemory.lingerSeq`, the errand seq the stay belongs to), and `refused` as today. `RETURN_HOME_DELAY_MS` stays the director's rule for walks the mind did not order as an errand: a chase, a chat approach, a tool, and entering the stage (D12).

### 3.6 CM9e: act moments from the order

- `IdleBehaviourRecord` gains `intentId: string | null`; `NaturalIdleActivities` `start` records it, and `IdleBehaviourReports` puts it on the start and end reports.
- The idle cue carries the mind's `cue` intent id: `StagePerformanceScene` `idleCue(kind, intentId)`, `NaturalMotion` `idleCue`, and `NaturalIdleActivities` `cue`. A `let-go` record then has the intent id.
- `useIdleProps` `onIdleBehaviour` seeds every act moment from `expressionSeed(intentId, 'moment')`, `held-back` from the `let-go` cue's id, and `waking` from the sleep order's id with the purpose `'waking'` (D14). The local stream remains only for previews (`force`) and the preview pastime pick.

### 3.7 CM9f: travel through the gaze arbiter

Recommended, applied without an explicit answer (D16):

- **Input.** `NaturalGazeLayer` gains `setTravel(walking, at)`, fed each frame from the MMD adapter with the gait state that `resolveGaze` reads today (moving, not `idle` or `stopping`). Live2D never sets it.
- **Rank.** `TRAVEL_PRIORITY` sits between 5 and 4. While she walks, `admits` refuses every source below it, so look tools, cue gestures, emotions, screen changes, cursor notices, and idle acts are refused and reported; a walk that starts under such a claim ends it. A source at 5 or above starts as today, and its hold while walking is capped at `TRAVEL_GLANCE_MAX_SECONDS` (1.5 s, D17).
- **Frame output.** `NaturalBodyIntent.gaze` gains `held: boolean`, true while a glance claim at or above travel holds. `resolveGaze` takes the travel direction only when the gait moves and `held` is false; otherwise the existing branches apply, so the glance shows through `fixation`.
- **Alternative (owner veto).** Record "travel wins while she walks" as a Body ownership rule and change no code; Target rule 3's MMD clause then closes as recorded.

### 3.8 CM10: character refractories

- **State.** `MindState.refractory: { actionUntilMs, danceUntilMs, gesture: { clipId, untilMs } | null, moveToolUntilMs, lookToolUntilMs, pokeSurpriseAtMs, momentRest: Record<entryId, atMs> }`, fast state on the mind's clock (D18 to D20).
- **Reports in.** A new `performer-report` stimulus with `clip-ended { kind, source }`, `gesture-clip { clipId }`, `tool-accepted { tool }`, and `moment-marked { entryId }`. The director's memory reports what it stamps today; `useIdleProps` reports the entry it marked. The ids are opaque to the mind, so the core reads no catalog.
- **Intents out.** A body `refractory` intent with remaining durations `{ actionMs, danceMs, gesture, moveToolMs, lookToolMs }`, sent after each report and seeded by `syncScene`. The MMD scene stamps them on the director clock at the next frame (`MMDAttendInbox` pattern) into the director's input; `decideBody` reads them instead of its memory fields, which are deleted.
- **Poke.** The poke `touch-reaction` intent gains `surprise: boolean`; `answerTouch` decides it with `POKE_SURPRISE_DEDUPE_MS` (2000) on the mind's clock. `startPending` plays the surprise only when it is set and keeps its `pokes` counter for episode ids.
- **Moment rest.** `useIdleProps` reads the rest from the mind's state through the mind store instead of `momentHistory`.

## 4. Where the code lives

| Slice | Packages | Files and symbols |
| --- | --- | --- |
| CM9a | `character-mind`, `motion-driver-natural`, `stage-ui`, `qa-tools` | New `character-mind/src/gesture.ts`; `expression.ts` (`answerEmotion`, `answerExpressionRequest`), `types.ts` (`MindState`, `MindIntent`), `step.ts` (`initialMindState`), `index.ts`; `motion-driver-natural/src/gestures.ts` (`NaturalGestures`), `mood.ts` (`NaturalEpisode`), `pending-actions.ts` (`startPending`); `stage-ui` conductor (`emotion`, `expression`, `dispatchNatural`); `qa-tools/src/t2-3d/runner/cues.ts` (`Motion3dCuePlayer`) |
| CM9b | `character-mind`, `motion-driver-natural`, `stage-ui`, `stage-ui-live2d`, `stage-ui-mmd`, `qa-tools` | New `character-mind/src/mood.ts`; `expression.ts`, `touch.ts` (`answerTouch`), `types.ts`; `motion-driver-natural/src/mood.ts` (`NaturalMood`), `pending-actions.ts`, `natural-motion.ts` (`addMood`, a `setMood`); conductor (`dosed` deleted, `syncScene`, `StagePerformanceScene`); `stage-ui-live2d` `natural-motion-adapter.ts`, `Model.vue`, `Live2D.vue`; `stage-ui-mmd` `composables/mmd/natural/adapter.ts`, `MMD.vue`; `qa-tools` `t2/scenario-sink.ts`, `t2-3d/runner/cues.ts` |
| CM9c | `character-mind`, `motion-driver-natural`, `stage-ui`, `stage-ui-mmd`, `qa-tools` | `character-mind/src/idle.ts` (`advanceIdle`, `answerIdle`, `nextIdleWakeAt`), `step.ts`; `motion-driver-natural/src/idle-activities.ts` (`settleSeconds`, `settled`), `idle-schedule.ts` (`IdleView`, `IdleContext`, `idleActivityWeights` callers); `stage-ui-mmd` `stance.ts` (`directorIdleStates`), `MMD.vue`; conductor `syncScene`; `qa-tools/src/t2-3d/runner/run.ts` (`perform`) |
| CM9d | `motion-driver-natural`, `motion-driver-humanoid`, `stage-ui-mmd`, `qa-tools`, `lab-tools` | `idle-schedule.ts` (errand decision), `idle-errands.ts`; `director/index.ts` (`decideBody`, `BodyDirectorInput.wander`, `BodyDirectorMemory`); `MMD.vue` (`realiseErrands`, the `world.wander` source); any `lab-tools` report that reads the linger constants |
| CM9e | `motion-driver-natural`, `stage-ui`, `stage-ui-live2d`, `stage-ui-mmd` | `idle-activities.ts` (`IdleBehaviourRecord`, `IdleBehaviourReports`, `cue`), `natural-motion.ts` (`idleCue`); `use-idle-props.ts` (`onIdleBehaviour`); conductor `idleCue`; both scenes' `idleCue` |
| CM9f | `motion-driver-natural`, `stage-ui-mmd`, `qa-tools` | `gaze.ts` (`GLANCE_PRIORITY`, `admits`, a `setTravel`), `frame-types.ts` (`NaturalBodyIntent`), `natural-motion.ts`; `stage-ui-mmd` `composables/mmd/natural/adapter.ts`, `body/index.ts` (`resolveGaze`) |
| CM10 | `character-mind`, `motion-driver-humanoid`, `motion-driver-natural`, `stage-ui`, `stage-ui-mmd`, `qa-tools` | `touch.ts`, `types.ts`, `step.ts`, a new `refractory.ts`; `director/index.ts` (`BodyDirectorMemory` refractory fields, `decideBody`); `pending-actions.ts`, `natural-motion.ts` (`lastPokeSurprise`); `use-idle-props.ts`, `Stage.vue`; `stance.ts`, `MMD.vue`; conductor; `t2-3d/runner/cues.ts` |

## 5. What is deleted

- CM9a: `cooldowns`, `cooldownKey`, `lastTrigger`, and the shake-or-drop draw in `NaturalGestures`; the recipe lookup in `startPending`.
- CM9b: `NaturalMood.add` and its `episodes` map; `NaturalEpisode.moodGain`; the conductor's `dosed`.
- CM9c: `settleSeconds`, `idleSince`, and `settled` in `NaturalIdleActivities`; `IdleView.settled`.
- CM9d: `LINGER_MIN_MS`, `LINGER_MAX_MS`, and the linger draws in `decideBody`.
- CM9e: the local-stream draws for act, `held-back`, and `waking` moments.
- CM9f: the unconditional travel branch of `resolveGaze`.
- CM10: the refractory fields of `BodyDirectorMemory` and their constants in the director (the values move to the mind); `lastPokeSurprise`; `momentHistory` in `useIdleProps`.

## 6. Docs that move with the code

| Slice | Doc changes |
| --- | --- |
| CM9a item 1 | `autonomous-behavior.md` Target rules 1, 2, and 5 say "under Natural" and drop "whether this rule covers them is the owner's decision"; the audit's claims 1.8, 3.5, and 5.6 leave the open work. ADR decision 14 is not edited (ADR bodies are history); the character mind roadmap gets a line under Feature and tuning work recording the owner's answer |
| CM9a | Autonomous behavior: the "Emotion impulse and emotion gesture" row names `emotionGesture` as decider; new Precedence rule 27 ("the mind decides every emotion gesture"); Precedence rule 5's "An emotion gesture does not start while a cue gesture ... holds the head" stays (performer refusal); Target rule 2's "Still open" and Target rule 4's gesture clause move out. Glossary: "Emotion impulse and emotion gesture" |
| CM9b | Autonomous behavior Target rule 1's fast-mood clause moves to new Precedence rule 28; glossary "Mood" names the mind as owner; State persistence: fast mood is fast state (no key) |
| CM9c | The Body director row's settle cites the mind; Precedence rule 6 gains the settle episode; rule 8's "settled maps to sit or a rest" names the intent; Target rule 4's settling clause leaves; `IDLE_TO_SIT_MS`'s doc comment cites `SETTLE_SECONDS` |
| CM9d | The Locomotion row and Precedence rule 8's last bullet: the linger comes from the errand and the walk home ends it; Target rule 4's director clause leaves; glossary "Idle errand" |
| CM9e | The Moment expression row: every moment the mind orders seeds its draws; Target rule 4's moments clause leaves |
| CM9f | Precedence rule 9 rewritten (travel is an arbiter input); rule 21 gains the travel rank; Body ownership Target rule 3's MMD clause leaves, and the MMD "One final owner" rule drops its gaze exception; glossary "Gaze arbiter" |
| CM10 | Target rule 1 closes for Natural (new Precedence rule 29); the Body director, Emotion impulse, and Moment expression rows cite the mind's refractories; Target rule 1 is removed from the Target list if nothing is left open under Natural |
| Every slice | Its roadmap row's Status, a short ADR in `docs/ai/adr/` recording its decisions from the table below, and this plan's Departures, Checks run, and Commits |

Precedence rule numbers 27 to 29 are the next free numbers today; a slice that lands later renumbers if another took them. Every identifier a policy doc cites outside Target must exist in code at that commit (`scripts/dev-tools/policy-docs.test.ts`).

## 7. Work items

Each item is one commit that passes `pnpm verify`; each PR passes `pnpm verify --gate`. Branches follow `luke/feat/character-mind-<slug>`, cut from `main` (or from the previous slice of its lane once that merges).

### CM9a: emotion gestures (`luke/feat/character-mind-emotion-gestures`)

1. **`docs(ai): scope the character mind targets to natural`.** D1 doc change. Policy-docs test.
2. **`feat(character-mind): decide emotion gestures and their cooldowns`.** `gesture.ts`, state, intent, capability refusal. Node tests in `packages/character-mind/src/gesture.test.ts` and `expression.test.ts` (or `step.test.ts`): each recipe emotion yields its gesture at clear and strong and none at slight or with bands off and a slight episode; a repeat inside each cooldown key is refused and allowed at the boundary; shake and drop share `angry`; `shake-or-drop` is the same for the same episode id and covers both values over ids; an escalation inside the cooldown plays nothing; an `expression-request` with a mapped episode yields a gesture; no posture yields an `undeclared` refusal and no state change; `heldEmotions` off yields none; no `rng` draw (a counting source).
3. **`feat(motion-driver-natural,stage-ui,qa-tools): play the emotion gesture the mind chose`.** Realisation, deletions, the cue player calling `emotionGesture` on a runner-held memory (D6). Tests: `gestures.test.ts` re-pinned for the removed cooldown and choice draw (the commit body names each moved pin and why); `natural-motion.test.ts`: an episode with a gesture plays it, without one plays none, a cue gesture holding the head refuses it; conductor test: the gesture travels on the episode only with posture declared.
4. **`docs(ai): record the emotion gesture decisions`.** ADR, docs, roadmap.
5. **`docs(plan): mark cm9a done`.**

### CM9b: fast mood (`luke/feat/character-mind-fast-mood`, after CM9a)

1. **`feat(character-mind): keep the fast mood in the mind`.** Tests in `mood.test.ts`: the deltas equal `NaturalMood.add`'s for new episodes, escalations, stale escalations, and a replaced episode (port the existing `motion-driver-natural/src/mood.test.ts` cases); `moodless` and `mood` off dose nothing; decay matches `NaturalMood.step` for the same span; a touch dose applies once per id.
2. **`feat(motion-driver-natural,stage-ui,stage-ui-live2d,stage-ui-mmd,qa-tools): dose and seed natural mood from the mind`.** Tests: `startPending` no longer doses an episode; `NaturalMood.set` replaces the level; the conductor sends `mood-level` on attach and on a switch to Natural, and the dose after the episode in the same dispatch; the t2 sink forwards `addMood`; a browser test of `Stage.vue`'s remount (or the conductor test with two scenes) keeps the level.
3. **`docs(ai): record the fast mood decisions`.** 4. **`docs(plan): mark cm9b done`.**

### CM9c: settling (`luke/feat/character-mind-settle`)

1. **`feat(character-mind,motion-driver-natural): decide settling in the idle policy`.** Tests in `idle.test.ts`: `settle` true exactly at 120 s of active idle with a body drive; each interrupting stimulus restarts it; a mode change or dormant view clears it with a false edge; `nextIdleWakeAt` returns the deadline; the settled pool and the yaw follow-up read the context; Natural's tests drop `settled`.
2. **`feat(stage-ui,stage-ui-mmd,qa-tools): sit her down on the mind's settle`.** Tests: `stance.test.ts` maps the intent; a newly attached MMD scene is seeded; the runner dispatches `settle` to the adapter.
3. Docs, 4. plan.

### CM9d: the linger in the errand (`luke/feat/character-mind-wander-linger`, after CM9c)

1. **`feat(motion-driver-natural,character-mind): draw the wander's stay with the errand`.** Tests: a wander decision carries `holdSeconds` in [45, 150] with the log-uniform law over seeds; a pastime's draw is unchanged; idle draws after a wander move by one (re-pin with the reason).
2. **`feat(motion-driver-humanoid,stage-ui-mmd): stay for the errand's linger and end it at the walk home`.** Tests in `director/index.test.ts`: arrival and arrival in place stamp the input's linger; `return-home` waits for it; chase, chat, and tool walks still use `RETURN_HOME_DELAY_MS`; seeded wander-position tests re-pinned once; `realiseErrands` answers `done` at `return-home` (an `MMD.vue` browser test or a unit around the extracted function).
3. Docs, 4. plan.

### CM9e: act moments (`luke/feat/character-mind-act-moments`, after CM9c)

1. **`feat(motion-driver-natural,stage-ui,stage-ui-live2d,stage-ui-mmd): seed act moments from the mind's orders`.** Tests: `IdleBehaviourReports` carries the intent id; a cue started by an intent carries its id; `use-idle-props.test.ts`: two instances given the same reports pick the same entry and chance, independent of earlier previews; `waking` and `held-back` use their seeds.
2. Docs, 3. plan.

### CM9f: travel gaze (`luke/feat/character-mind-travel-gaze`)

1. **`feat(motion-driver-natural): rank travel in the gaze arbiter`.** Tests in `gaze.test.ts`: while traveling, every source below travel is refused and reported, every source at or above starts with its hold capped at 1.5 s, a walk start ends a lower claim and keeps a higher one, `held` follows the claim.
2. **`feat(stage-ui-mmd): look where she walks unless a glance holds`.** Tests in `packages/stage-ui-mmd/src/composables/mmd/body/body.test.ts`: moving with `held` false aims along travel; with `held` true uses the free branch; stopping restores today's order.
3. Docs, 4. plan.

### CM10: character refractories (`luke/feat/character-mind-refractories`, after every CM9 slice)

1. **`feat(character-mind): hold refractories once per character`.** Tests: each report stamps its field; the `refractory` intent carries remaining durations; the poke surprise is true once per 2 s on the mind's clock; reset clears them; `moment-marked` rests an entry 60 s.
2. **`feat(motion-driver-humanoid,motion-driver-natural,stage-ui,stage-ui-mmd,qa-tools): read refractories from the mind`.** Tests: `decideBody` refuses an action, dance, gesture repeat, move tool, and look tool by the input's remaining durations exactly as by its old memory (port each existing refractory test); a refractory survives a new director (stance test with two directors and one mind); `startPending` plays surprise only when the intent says so; `useIdleProps` honours a rest the mind reports from another instance.
3. Docs, 4. plan.

## 8. Checks

**Each commit:** `pnpm verify` (with `--detach` and `--wait` under a 10-minute tool timeout); each PR: `pnpm verify --gate`. Inner loops: `pnpm -F @proj-airi/character-mind exec vitest run src`; `pnpm -F @proj-airi/motion-driver-natural exec vitest run src/gestures.test.ts src/mood.test.ts src/natural-motion.test.ts src/idle-activities.test.ts src/idle-schedule.test.ts src/gaze.test.ts`; `pnpm -F @proj-airi/motion-driver-humanoid exec vitest run src/director`; `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance`; `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node src/composables/mmd`. The policy-docs test after each policy doc edit.

**Headless identity.** Base runs come from `pnpm wt new cm9-base --base <the PR's base> --branch luke/tmp/cm9-base --qa`, removed with `pnpm wt rm cm9-base`. Each PR runs `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario <id> --seed 1 --out <dir>` at both ends for all eleven scenarios: `idle`, `idle-drive`, `music`, `music-beat`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, `touch`, and compares with `pnpm qa:motion3d diff <base run> <tip run>`. It also runs `pnpm qa:live2d-rig --seed 1` for `angry` (the default) and `happy` at both ends and compares the trace hashes.

| Slice | Expected `IDENTICAL` | Expected to differ, and why | Seeded draws that change |
| --- | --- | --- | --- |
| CM9a | Every scenario with no angry episode, and the rig for `happy` | `emotions` (it cycles all twelve emotions, angry included) from the first angry episode on, and the rig for `angry`: Natural's gesture stream no longer draws the shake-or-drop choice, so the clip's own draws shift by one, and the choice now comes from the episode id. `gesture-under-clip` and `touch` only if their runs hold an angry episode; record it from the run's events | Natural `gestures` stream (index 12): one draw fewer per angry gesture. No mind draw changes (the choice is a hash) |
| CM9b | All eleven and both rig hashes, given the cue player's and the sink's doses (section 2.8 items 2 and 3) | None. A difference is a defect: the delta arithmetic or the dose order moved | None |
| CM9c | All scenarios shorter than 120 s of idle | `idle` and `sleepy-no-clip` only if their runs reach the settle onset: the onset may move by at most one frame (the mind's deadline against Natural's frame check), and an interrupt Natural saw but the mind does not (section 3.4) may restart it. `pnpm lab:motion3d report rest <run>` must read the same verdicts at both ends | None |
| CM9d | All eleven: no scenario lists errands, so no wander is drawn (confirm from the runs' events) | None | The idle stream gains one draw per wander decision; the director's `rngState` loses the linger draws, so seeded wander positions in the director's Node tests move |
| CM9e | All eleven and both rig hashes: neither runner runs `useIdleProps` | Live2D moment picks in the app (no body motion) | `useIdleProps`' local stream is no longer drawn for act, `held-back`, and `waking` moments |
| CM9f | Every scenario that never walks | `walk`: idle-act and other below-travel glances are refused while she walks, so the gaze stream skips their saccade draws, and the eyes follow travel where a granted high glance used to be hidden. `touch` only if a poke lands during a walk. `pnpm lab:motion3d report gaze-order <run>` and `pnpm lab:motion3d gate <run>` must read the same statuses at both ends; record the refusal events by source | Natural `gaze` stream: fewer draws during walks |
| CM10 | All eleven and both rig hashes | `gesture-under-clip` only by a one-frame shift of a refractory end (stamped at the next director frame); any other difference is a defect | None |

If a gate or report status differs, run seeds 1 to 5 at both ends. A flip that the table above predicts is the change working; an unexplained flip is a defect. Stop on a defect; never retune a gate, scorer constant, or Natural recipe. Every PR quotes: "Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review."

**Rendered checks on macOS.** Launch with `pnpm qa:app` or the `airi-qa` MCP server, a temporary profile, the motion QA bridge enabled, and the models from `.env.qa`. macOS needs no `qa:display`. Each launch records 0 renderer and 0 main-process errors; each check records the bridge event kinds and counts, never content or model paths.

1. **CM9a, Live2D Natural.** Devtools pulses `angry` twice 2 s apart: the first `mind` event has an `emotion` stimulus with an `emotion` and an `emotion-gesture` intent, and Natural's observer reports one `gesture` (`shake` or `drop`); the second has no `emotion-gesture`. A `happy` pulse then plays `laugh`. Under Universal the same pulse reports `emotion-gesture` as `undeclared` and no gesture event.
2. **CM9a, MMD Natural on the desktop stage.** Step 1 again; the head clip shows in a `pnpm qa:stage capture` contact sheet.
3. **CM9b.** Pulse `happy` three times, read Natural's `moodState` in the motion diagnostics, reload the model (or switch to Universal and back): the new controller's `moodState` is non-zero and within decay of the mind's level; before the change it read zero.
4. **CM9c, MMD on the desktop stage**, activity override `idleSeconds` 60, home position, a sit slot imported: after 120 s a `mind` event carries `settle` true and the director readout shows `sit` (or `rest` without the slot); a poke yields `settle` false and she stands.
5. **CM9d.** Roam mode. A wander is not forced by any devtools control and its first draw comes 600 s after roaming begins, so wait up to 20 minutes once: the wander intent carries `holdSeconds`, the body readout's linger matches it, and the errand answers `done` when `return-home` is issued. If no wander comes, record the step as not exercised and rely on the Node tests.
6. **CM9e, Live2D** with entries tagged for `check-in`: devtools `idle-play` `check-in`; the moment's pick matches the one `expressionSeed` gives for the order's id (the motion lab readout shows the marked label).
7. **CM9f, MMD on the desktop stage.** A debug goal across the stage; poke during the walk: a `glance` event `started` for `poke`, the eyes leave the walk line for at most 1.5 s, then return; an idle act's glance during a walk is `refused`. A `pnpm qa:stage capture --scenario walk` contact sheet shows it.
8. **CM10.** Poke, reload the model, poke again within 2 s: the second poke flinches without surprise. With a labelled dance clip: play it through ACT, reload the model, request it again within 60 s: the director readout reports the refusal `refractory`.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| A gesture the mind ordered is refused by the performer (cue gesture holding the head, zero model strength) and the cooldown is spent | D5: the same as a spent idle fire; Natural keeps reporting started gestures, and the rendered check counts them |
| Mood seeded from the mind differs from what the old controller showed because the mind decays on wall time while the stage was hidden | D10: only on attach; the difference is decay the user did not see |
| The settle onset moves because the mind does not see a frame-level interrupt | D11 lists the interrupting stimuli; the rest report must read the same verdicts |
| A glance during a walk looks like a stumble | The 1.5 s cap (D17); the walk gate and `stage-walk-skate` must pass; the visual review backlog gets a capture |
| CM10's refractories arrive one frame late on the director clock | Remaining durations stamped at the next frame, as the attend window is; one-frame shifts are the only allowed headless difference |
| Lanes conflict in `MMD.vue`, `startPending`, and the conductor | Lane order in this plan; CM10 last; rebase before each verify |

## 10. Follow-ups this plan does not do

- Renderers without Natural (VRM, Spine, tachie): 3D roadmap M5.
- A refusal report from Natural back to the mind for gestures, if a policy ever needs it.
- The performance resolver in the mind (mode and attention).
- Leadership hand-off and per-window stimuli, if a second stage exists (ADR open questions).

## Decisions for the owner

| # | Fork | Options | Trade-off | Recommendation |
| --- | --- | --- | --- | --- |
| D1 | Do Target rules 1, 2, and 5 cover the upstream drivers | (a) Natural only; (b) every driver | (b) would require rewriting upstream code ADR decision 14 keeps | **(a), owner answer "Scope to Natural", 2026-11-22.** Docs-only, CM9a item 1 |
| D2 | The split | (a) Seven PRs in three lanes, CM10 last; (b) one PR per lane; (c) one PR | (b) and (c) give a PR several Done-when clauses and several expected trace changes to explain at once | (a) |
| D3 | What the mind decides of an emotion gesture | (a) The kind (including shake or drop) and the cooldown; Natural keeps side and shape; (b) also side and shape | Side and shape are realisation (core ADR D15) and need the rig's draws | (a) |
| D4 | Where the shake-or-drop choice comes from | (a) A hash of the episode id (`expressionSeed`); (b) a mind gesture stream seeded by one `rng` draw; (c) the mind's `rng` | (b) and (c) shift every later draw of the mind's source (voice thresholds, touch rolls, emotion jitter) from the first gesture on; (a) changes only Natural's gesture stream and makes two minds agree | (a) |
| D5 | A gesture the performer refuses after the mind ordered it | (a) The cooldown is spent at the order; (b) Natural reports the refusal and the mind restores the cooldown | (b) adds a report loop for a rare case (a cue gesture already holding the head, a model with that emotion at strength 0); today such a refusal stamps nothing, so (a) is a small change | (a) |
| D6 | The headless runner's emotion, poke, and dose path | (a) The cue player calls the mind's exported pure policies (`emotionGesture`, the mood delta, the poke dedupe) on runner-held state; (b) it routes cues through `mind.receive` | (b) adds the mind's intensity jitter and new episode ids to every emotion trial, moving every emotion baseline at once | (a) |
| D7 | How mood reaches the performer | (a) Dose deltas as today's `mood` intent, plus a `mood-level` seed at attach; (b) the level after every change | (b) sends a level computed at the stimulus time that the performer applies a grid step later, so its decay would not match today's and headless runs would move | (a) |
| D8 | Mood across a model or driver switch | (a) It survives: the conductor seeds the new performer; (b) it resets | (b) keeps today's behavior; difference is one line (section 3.3) | **(a), recommended, applied without an explicit answer** |
| D9 | A model whose emotion strength is 0 | (a) The mind doses mood anyway; the model only shows nothing; (b) the conductor tells the mind the strength | Strength is a per-model realisation setting; mood is the character's | (a) |
| D10 | The mind's mood clock | (a) The mind decays on its clock only to dose and seed; frames decay on their active seconds; (b) frames sample the mind's level | (b) breaks the render-loop rule (mixing the mind's wall clock into frame-sampled values) | (a) |
| D11 | What restarts the settle timer | (a) The view's mode and drive plus the mind's own interrupting stimuli (section 3.4); (b) also a Natural `interrupt` report each frame | (b) is a frame-rate report for an episode decision; (a) can miss a frame-only interrupt (a cursor that Natural noticed but the mind refused to engage) | (a) |
| D12 | The walk home | (a) The wander errand carries the linger and ends at `return-home`; `RETURN_HOME_DELAY_MS` stays for walks the mind did not order; (b) the mind also orders every walk home | (b) makes the mind decide chase, chat, and tool aftermaths, which are realisations of the user's or model's requests | (a) |
| D13 | The linger of a visit that arrives in place | (a) The same errand linger; (b) the director keeps a draw for it | (b) keeps a second source for an idle decision | (a) |
| D14 | Seeds of act moments | (a) The order's intent id, the cue's id for `held-back`, the sleep order's id with purpose `waking`; (b) a mind `moment` intent for each | (b) doubles the intents for acts the mind already ordered | (a) |
| D15 | Moments of acts nobody ordered (lab previews) | (a) Keep the local stream for previews only; (b) delete previews' draws | Previews need some source | (a) |
| D16 | MMD travel gaze | (a) Travel is an arbiter input between priority 5 and 4: touch, wake, chat, and voice cues hold briefly over the walk; the rest is refused while walking; (b) record "travel wins" as a rule, no code | (b) keeps today's motion but leaves a granted poke glance invisible during a walk | **(a), recommended, applied without an explicit answer** |
| D17 | How long a glance holds over travel | (a) Its own hold, capped at 1.5 s while walking; (b) its own hold uncapped | A chat read can hold several seconds, long for a walk | (a); a tuning value |
| D18 | CM10 now or after a second stage | (a) Build now; (b) wait | (b) leaves model reloads resetting her refractories | **(a), owner answer "Build now", 2026-11-22** |
| D19 | Where the director refractories live | (a) Mind state stamped by performer reports, sent as remaining durations; (b) the mind receives clip and tool requests as stimuli and accepts or refuses them | (b) reverses glances D6 (requests from the model stay requests the director takes) | (a) |
| D20 | Where the moment entry rest lives | (a) Mind state keyed by opaque entry ids from a `moment-marked` report; (b) the mind store shell, outside the core | (b) puts fast state outside the state that resets together | (a) |

## Orchestrator handoff

Each worker builds one slice and runs its Node, browser, and dependent typechecks; the orchestrator owns the headless and rendered acceptance and records it in the slice's ADR placeholder and in this plan, as for CM6b2 and CM7c.

1. **Before a slice starts:** confirm D8, D16, and D17 still stand (the owner may veto the two recommendations applied without an explicit answer); confirm the slice's base (`main`, or the previous slice of its lane merged).
2. **Headless:** run section 8's table for the slice at its base and tip, all eleven scenarios at seed 1, plus the rig for `angry` and `happy`. Require every row's expected `IDENTICAL`; for each expected difference, record the first differing event and that the gate and report statuses match at both ends; sweep seeds 1 to 5 on any status change.
3. **Rendered:** the slice's checks from section 8 on macOS, with event kinds and counts, 0 renderer and 0 main-process errors per launch, and the step marked not exercised when the environment cannot reach it (CM9d's wander, a clip check without an imported clip).
4. **Record:** run directories, diff lines, gate and report lines, refusal counts by source, and the limitations wording, in the PR description and the slice ADR.
5. **Land:** rebase-merge the PR to `lschneiderny/airi`, update the slice's roadmap Status, and start the next slice of the lane. CM10 starts only after CM9b, CM9e, and CM9f have merged.

**Applied (orchestrator, 2026-11-22):** the lanes land as one PR each (lane A: CM9a and CM9b; lane B: CM9c, CM9d, and CM9e; lane C: CM9f), with every slice's commits kept atomic, instead of seven PRs. Lane B branches before lane A lands and must rebase, which changes its tree, so its headless and rendered acceptance runs on the rebased tip against the lane's base. Each slice still records its own acceptance in its ADR.

Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review.

## Slice records

### CM9a (`luke/feat/character-mind-emotion-gestures`)

**Commits.** `d3e712f24` docs(ai): scope the character mind targets to natural; `4b3b66921` feat(character-mind): decide emotion gestures and their cooldowns; `1db3e740c` feat(motion-driver-natural,stage-ui,qa-tools): play the emotion gesture the mind chose; `7246ffa9f` docs(ai): record the emotion gesture decisions.

**Departures.** `startPending` still reads the recipe to leave the head pulse to an emotion's clip (section 5 deleted the lookup), so an emotion inside a mind cooldown moves as before; Natural ignores an ordered clip with held emotions off; the mind's import boundary in `eslint.config.ts` admits `/emotions`; `expressionSeed` accepts the `gesture` purpose. The [emotion gestures ADR](../../docs/ai/adr/2026-11-22-character-mind-emotion-gestures.md) records them under Deviations.

**Checks run.** `pnpm -F @proj-airi/character-mind exec vitest run src` (13 files, 199 tests); stage-shared (1897); motion-driver-natural (29 files, 513); `pnpm -F @proj-airi/stage-ui exec vitest run --project node` (2010) and `--project browser src/components/scenes/stage-emotion-routing.browser.test.ts` (46); stage-ui-live2d node (795) and its two `composables/live2d` browser files (17); qa-tools node (894, 9 skipped); stage-ui-mmd node (433); `pnpm --filter "...@proj-airi/stage-shared" --workspace-concurrency=2 typecheck` (28 packages) and `pnpm --filter "...@proj-airi/motion-driver-natural" --workspace-concurrency=2 typecheck` (11 packages); the policy-docs test (11). Headless and rendered acceptance: pending, owned by the orchestrator.

### CM9b (`luke/feat/character-mind-fast-mood`, stacked on CM9a)

**Commits.** `0aba62e10` feat(character-mind): keep the fast mood in the mind; `4d765f52e` feat(motion-driver-natural,stage-ui,stage-ui-live2d,stage-ui-mmd,qa-tools): dose and seed natural mood from the mind; `230942d57` docs(ai): record the fast mood decisions.

**Departures.** The seed is a source the scene reads for each controller it creates (`seedMood`, backed by `CharacterMind.moodLevel`), not a `mood-level` intent, so a model reload is covered; dose ids are `${episode id}@${epoch ms}` so a controller that outlives a mind reset still applies them; the mind keeps no dose-id set; `moodless` is optional on the stimuli; the rig sink's `addMood` has no unit test of its own. The [fast mood ADR](../../docs/ai/adr/2026-11-22-character-mind-fast-mood.md) records them under Deviations.

**Checks run.** `pnpm -F @proj-airi/character-mind exec vitest run src` (14 files, 214 tests); motion-driver-natural (29 files, 511); `pnpm -F @proj-airi/stage-ui exec vitest run --project node` (2012) and `--project browser src/components/scenes/stage-emotion-routing.browser.test.ts` (46); stage-ui-live2d node (795) and its two `composables/live2d` browser files (17); stage-ui-mmd node (434); qa-tools node (894, 9 skipped); `pnpm --filter "...@proj-airi/character-mind" --workspace-concurrency=2 typecheck` (10 packages, at the first commit) and `pnpm --filter "...@proj-airi/motion-driver-natural" --workspace-concurrency=2 typecheck` (11 packages); the policy-docs test (11). Headless and rendered acceptance: pending, owned by the orchestrator.
