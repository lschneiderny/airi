# Domain glossary

This file describes the code on `main`. A change that makes a statement here false updates this file in the same commit. These definitions win over the ADRs in `docs/ai/adr/`; the ADRs record the history behind them.

This file defines the domain terms that the client's code and documentation use for the character, her motion, and her presence on the desktop. It is for contributors and agents, not translators: `packages/i18n/glossary/terms.yaml` holds only user-visible, translatable terms (see "Glossary" in `packages/i18n/AGENTS.md`), and a term can appear in both files with different scope. Each definition describes the behavior of the code. When an ADR uses a term differently, the definition here wins, and the difference is listed under [Conflicting usages](#conflicting-usages).

Each entry names the defining path and its exported symbol. Symbols are cited by name, never by line number.

## Terms

### ACT and DELAY cues

Inline control markers that the model writes into a reply. `<|ACT {...}|>` carries an emotion, gesture, or expression for the stage to perform at the next matching speech timing event, and `<|DELAY n|>` pauses the stage and the speech track for at most 5 seconds. The chat runtime rewrites near-miss spellings such as `[ACT happy]` into real cues instead of speaking them, and a reply that holds only ACT cues and the decline marker `<|SILENT|>` is a wordless reply.

**Code:** `packages/pipelines-audio/src/llm-streaming-control/parsers/act.ts` `tokenAct`; `packages/pipelines-audio/src/llm-streaming-control/parsers/delay.ts` `tokenDelay`; `packages/stage-shared/src/stage-contract/index.ts` `STAGE_RUNTIME_CONFIG`.
**Not to be confused with:** the MOOD cue (`packages/stage-shared/src/character-state/cue.ts` `parseMoodCue`), which feeds the slow mood layer of the character state rather than the stage.
**Avoid:** "tags", "action tokens", "emotion tags".

### Attend window

The span in which she attends to her user after an interaction, and the only time the MMD body director may chase the cursor. The [character mind](#character-mind) answers a poke, a pet start, a drag release, and a sent chat message (a `chat` `sent` stimulus) with a cursor-targeted `body` `attend` intent of `ATTEND_WINDOW_MS` (60 s), naming `attendCause` as `touch`, `drag`, or `chat-send`; a pet end opens none. A chat that unfolds yields a chat-targeted attend, without opening a cursor window. The intent carries a span, not a time: the MMD scene's `MMDAttendInbox` stamps `attend.untilMs` at the director time of the next frame, and the director reads the cursor's position from its world only to aim the walk. The conductor dispatches the intent only under the Natural driver; under the classic driver it is not dispatched, so the director gets no attend window.

**Code:** `packages/character-mind/src/attention.ts` `ATTEND_WINDOW_MS`, `answerInteraction`; `packages/character-mind/src/chat.ts` `answerChat`; `packages/character-mind/src/touch.ts` `answerTouch`; `packages/stage-ui-mmd/src/components/scenes/MMD.vue` (`attend`); `packages/stage-ui-mmd/src/composables/mmd/stance.ts` `MMDAttendInbox`; `packages/motion-driver-humanoid/src/director/index.ts` `BodyDirectorInput` (`attend.untilMs`).
**Not to be confused with:** [cursor attention](#cursor-attention), which decides whether she notices the cursor with her gaze; and `BodyIntent.look`, a model-requested glance realised by Natural's gaze arbiter.
**Avoid:** "chase window" for the span (the chase is the director's walk inside it).

### Avatar model

A character card's reference to one display model, with the card's own configuration for it, such as which Live2D expressions and motions the card enables. A card holds a list of avatar models and names a default. The selected avatar model is runtime state; the card is its only durable owner.

**Code:** `packages/stage-ui/src/types/avatar-model.ts` `CharacterAvatarModelReference`; `packages/stage-ui/src/services/avatar-model.ts` `createAvatarModelReference`; `packages/stage-ui/src/stores/modules/airi-card.ts` `useAiriCardStore` (`selectAvatarModel`).
**Not to be confused with:** a display model (`packages/stage-ui/src/stores/display-models.ts` `DisplayModel`), which is the imported or built-in model file that several cards can reference; and the per-model display settings, which belong to the display model and not to a card.
**Avoid:** "character model", "skin".

### Background task

One run of a background recipe. It runs in a new chat session of its own, with an empty history and the task text as its message. It never speaks, and it cannot start, propose, or judge recipes. The session keeps the task's status (`running`, `done`, `failed`, or `interrupted`), and every window reads the task list from the session metas. When it settles with a result, the parent conversation receives a notice.

**Code:** `packages/stage-ui/src/stores/chat.ts` `useChatStore` (`startRecipe`, `backgroundTasks`, `stopBackgroundTask`); `packages/stage-ui/src/types/chat-session.ts` `ChatSessionTask`, `ChatSessionTaskStatus`; `packages/core-agent/src/runtime/recipe.ts` `isBackgroundRecipe`.
**Not to be confused with:** an idle errand, which is her own unasked body behavior; and a notebook task (`packages/stage-ui/src/stores/character/notebook.ts` `useCharacterNotebookStore`), which is a reminder with a due time.
**Avoid:** "job", "agent run", "automation" (no trigger starts a task on its own).

### Beat clock

Natural's estimate of the beat of the music she hears, from the beats of the [beat sync](#beat-sync) detector. Its beat length is the median of the last 8 detected intervals, each folded by halving or doubling into 60 to 180 BPM. Its phase follows the beats' arrival on Natural's active time and moves by 0.3 of each hit's error. It locks after 4 beats that land within 0.2 beat of its prediction, anchors afresh after 4 misses in a row, and unlocks after 1.8 s without a beat or while Natural is suspended. It decides nothing: only a [groove](#groove) that the character mind already drew reads it.

**Code:** `packages/motion-driver-natural/src/beat-clock.ts` `advanceBeatClock`, `beatAt`, `BeatClockState`; `packages/motion-driver-natural/src/natural-motion.ts` `NaturalMotion` `beat`.
**Not to be confused with:** beat sync's controller, which springs the Live2D head on each beat under Universal and MAGIC; and the music detector (`advanceMusic`), which decides only whether music plays.

### Beat sync

A Live2D head dance to music. An audio detector reports beats, and a controller springs the head angles (`ParamAngleX`, `ParamAngleY`, `ParamAngleZ`) toward per-beat targets in one of four styles (`punchy-v`, `balanced-v`, `swing-lr`, `sway-sine`), and it releases the head after the beats stop. The user starts and stops it from the beat sync settings page; nothing starts it on its own. Both of its plugins write only under the Universal and MAGIC drivers: `pre` springs the head, and `layer` adds the beat offset on top of a manual pose, for example under MAGIC. Under Natural they write nothing; `pre` only advances the springs. Its detector is the one music detector: under Natural its beats tell the character mind when music starts and stops (see [Groove](#groove)), and the mind store also hands each beat to Natural's [beat clock](#beat-clock).

**Code:** `packages/stage-shared/src/beat-sync/detector.ts` `createBeatSyncDetector`, `listenBeatSyncBeatSignal`; `packages/stage-ui-live2d/src/composables/live2d/beat-sync.ts` `createBeatSyncController`, `BeatSyncStyleName`; `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginsBeatSync`, `beatSyncMode`; stored parameters `packages/stage-ui/src/stores/settings/beat-sync.ts` `useSettingsBeatSync`.
**Not to be confused with:** the [groove](#groove), Natural's `sway` idle activity, which the character mind draws while it hears music; and the sway emotion gesture.
**Avoid:** "dance mode", "music sync" ("dance" also names an MMD clip kind).

### Body director

The pure function that decides what an MMD character's body does next: stance (stand, sit, settle), locomotion goals such as chasing the cursor, visiting, wandering and walking home, and which clip action plays. It takes the mind's attend and away answers, Natural's idle and wander realisations, model or user requests, and the stage world including performance mode. It returns a `BodyIntent` plus memory for the next frame; it is the only part that decides what she does with her whole body.

**Code:** `packages/motion-driver-humanoid/src/director/index.ts` `decideBody`, `BodyDirectorInput`, `BodyDirectorMemory`; the MMD host wraps it in `packages/stage-ui-mmd/src/composables/mmd/stance.ts` `MMDStanceDirector`.
**Not to be confused with:** the performer, which turns the director's intent into bone channels and decides nothing.
**Avoid:** "body brain", "stance machine".

### Character context

The short `system:character` text rendered from the character state's reading. It is empty at rest; otherwise it holds at most two lines: a `Feeling:` line with mood words and reasons when her mood is off rest or a reason renders, and a `You two:` line that names the relationship stage. The runtime attaches it to the last user turn as runtime context, not to the system prompt.

**Code:** `packages/stage-shared/src/character-state/render.ts` `renderCharacterContext`, `characterRenderKey`; attached through the runtime context providers of `packages/stage-ui/src/stores/chat.ts` `useChatStore`.
**Not to be confused with:** the character state itself, which is the stored record; the situation block, which rides beside it on the same turn; and the character card's system prompt.
**Avoid:** "mood prompt", "character prompt".

### Character mind

The module that turns [stimuli](#stimulus) into [intents](#intent). Its core is the pure function `step` over the plain, serializable `MindState`. The thin class `CharacterMind` owns the clock, the random source, and the state, calls the core in-process, and persists nothing itself. Its slow state (`MindState.slow`) is her pacing memory, which the host loads from the active card's [character state](#character-state) and saves back; everything else in `MindState` is fast state. `reset(slow)` starts the mind over from a loaded slow state, keeping its clock and random stream. The app constructs one mind per window, in `useCharacterMindStore`, which resets it at each promotion and card switch; it outlives stage remounts, and only the leader's mind connects to the situation store's voice port, so only the leader's mind decides lines. A mounted stage hands that mind to its conductor and lends the store its body for the cues around a line. Today it owns the emotion half of the expression decision: for an emotion, a named expression, or a clear, it decides the reaction episode, its strength, and its hold. Under Natural it also answers a touch once: the body reaction, the mood dose, the moment, and a possible spoken line come from one `step` call (see [Touch reaction](#touch-reaction)). Under every driver it answers a [return](#return) and the desktop events of the performance state (see [Desktop reaction](#desktop-reaction)); it keeps the open away span and the screen-change refractory as fast state. Under every driver its [voice policy](#voice-policy) decides every reach-out and spoken touch line on voice ticks from the situation store. Its [idle policy](#idle-policy) decides her idle acts, sleep, and errands from the idle view the newest attached stage reports, and draws her [groove](#groove) only while the leader's mind hears music. The target design gives it every stimulus and one instance per character ([Autonomous behavior](autonomous-behavior.md#target)).

**Code:** `packages/character-mind/src/mind.ts` `CharacterMind`; `packages/character-mind/src/step.ts` `step`, `initialMindState`; `packages/character-mind/src/types.ts` `MindState`, `MindSlowState`; `packages/character-mind/src/touch.ts` `answerTouch`, `answerVoiceOutcome`; `packages/character-mind/src/presence.ts` `answerPresence`, `answerScreenChange`; `packages/character-mind/src/voice.ts` `answerVoiceTick`, `answerVoiceOutcome`; `packages/character-mind/src/idle.ts` `answerIdle`, `advanceIdle`; `packages/character-mind/src/music.ts` `answerMusic`; `packages/stage-ui/src/stores/character-mind.ts` `useCharacterMindStore`.
**Not to be confused with:** the decider, which stays as the asset picker and chooses the entries that show what the mind decided; the conductor, which sends stimuli to the mind and dispatches for one stage; and the chat orchestrator.
**Avoid:** "brain", "AI", "scheduler" for the whole module.

### Character state

The character's slow inner state for one character card, stored per card and hidden from the user except in devtools. The stored record holds three layers on their own clocks: mood (hours), temperament (days, a slow average of mood that becomes the mood baseline), and relationship (closeness, trust, familiarity, moved by discrete events). The record also holds her pacing memory (`pacing`): the [character mind](#character-mind)'s slow state, which its host writes back. A `CharacterReading` derived from the record feeds the prompt, the face baseline, the idle drive, and the reach-out urge.

**Code:** `packages/stage-shared/src/character-state/types.ts` `CharacterStateRecordV1`, `CharacterReading`, `CharacterPacingMemorySchema`; `packages/stage-shared/src/character-state/reducer.ts` `advance`, `applyEvent`; `packages/stage-shared/src/character-state/reading.ts` `readCharacter`; store `packages/stage-ui/src/stores/character-state.ts` `useCharacterStateStore`.
**Not to be confused with:** the Natural mood (see Mood), the fast afterglow that the layered-state ADR calls the moment layer, and the performance state (`packages/stage-shared/src/performance-state/index.ts`), which is the stage's current mode such as idle, listening, or talking.
**Avoid:** "affect state", "emotion state", "personality state".

### Classic

The MMD motion driver without Natural. Clips, the classic gaze controller, the classic emote, and the classic blink move her, and the body performer's stages do nothing. The body director still decides stances and clips.

**Code:** `packages/stage-ui-mmd/src/stores/mmd.ts` `MMDMotionDriver` (value `'classic'`); `packages/stage-ui-mmd/src/composables/mmd/gaze.ts` `createGazeController`; `packages/stage-ui-mmd/src/composables/mmd/expression.ts` `useMMDEmote`; `packages/stage-ui-mmd/src/composables/mmd/blink.ts` `useMMDBlink`.
**Not to be confused with:** the classic window, which is the `window` stage host; and Universal, the Live2D driver that plays the model's own motions.
**Avoid:** "legacy driver", "vanilla".

### Clip

An imported VMD animation for an MMD model, classified once at import by the bones it animates into a kind (`gesture`, `action`, `dance`, `stance`, or `unusable`) and a layer (`upper`, `full`, or `none`). A gesture plays over idle, sitting, and walking; an action or dance pre-empts locomotion through the body director. A "clip action" is a clip played on request from an ACT cue, the expression tool, or debug.

**Code:** `packages/motion-driver-humanoid/src/clip-meta/index.ts` `deriveClipMeta`, `ClipKind`, `ClipLayer`; `packages/motion-driver-humanoid/src/clip-mask/index.ts` `buildClipBoneMask`; `packages/stage-ui-mmd/src/composables/mmd/action-port.ts` `MMDActionPort`, `MMDActionClip`.
**Not to be confused with:** speech clips (`packages/core-agent/src/voice/output/response.ts` `SpeechClip`), which are spans of synthesized audio, and the timeline an idle activity plays inside Natural.
**Avoid:** "motion" for an imported clip ("motion" also names Live2D motion groups), "animation file".

### Clip layer

How an MMD clip plays over the base clip. The base clip is the looping stance or idle clip that the body director chooses; `setBaseMotion` sets it and cross-fades over `BASE_CROSSFADE` (0.6 s). A clip action plays as a layer through `playLayer`: an `upper` layer takes only the bones its upper partition keys, so breath, sway, planted feet, and the walk continue, while a `full` layer and a dance take every bone the clip keys. Layers fade on a smoothstep with the times in `LAYER_FADE_SECONDS`, and a caller's `crossfade` replaces the fade-in.

**Code:** `packages/stage-ui-mmd/src/composables/mmd/animation-manager.ts` `createMMDAnimationManager` (`setBaseMotion`, `playLayer`), `PlayLayerOptions`, `BASE_CROSSFADE`; `packages/stage-ui-mmd/src/composables/mmd/layer-fade.ts` `LAYER_FADE_SECONDS`, `stepLayerFade`; `packages/motion-driver-humanoid/src/clip-meta/index.ts` `ClipLayer`; `packages/motion-driver-humanoid/src/director/index.ts` `BodyActionLayer`.
**Not to be confused with:** the morph layers of the MMD morph runtime (`packages/stage-ui-mmd/src/composables/mmd/morph-runtime/combine.ts` `MorphLayer`), and Natural's posture layers.
**Avoid:** "track" or "channel" for a layer.

### Combo

A user-defined expression that applies several catalog expressions together, each at its own strength, under one label and id prefixed `combo:`. It can carry emotion mappings and can be exposed to the model like any other expression.

**Code:** `packages/stage-shared/src/expression-performance/catalog.ts` `ComboDocumentSchema`, `ComboDocument`; `packages/stage-shared/src/expression-performance/combos.ts` `expandEntry`, `validateComboDocument`.
**Not to be confused with:** a reaction episode, which is one emotion at one intensity decided at run time.
**Avoid:** "preset", "expression group".

### Conductor

The stage-side class that turns stage events (ACT cues, expression tool calls, speech timing, touch, devtools pulses) into stimuli for the character mind and affect signals for the decider, under the active character profile. An emotion, a named expression, and a clear go to the mind first, and the decider then receives what the mind decided. The conductor dispatches both results: the mind's reaction episodes and holds to Natural, the decider's slot commands to the expression performer, and motion groups to the Universal and MAGIC drivers. It takes the mind as its `mind` option. Its `voice` option is the voice port (`VoicePort`, with `observeTouch`, `observeReturn`, `speak`, `cancel`, `drop`, `publishVoice`, and `connect`). The conductor does not connect to the port: `useCharacterMindStore` does, and sends the cues of the voice lines it runs to the conductor's `idleCue` through `attachStage`. Every `speak` intent goes to the voice port's `speak`, whose outcome it returns to the mind with the intent's `turnId`; a `cancel` or `drop` of a widget line goes to the port's `cancel` or `drop`; and every step that changes the voice state or its next widget deadline goes to `publishVoice`. Under Natural it also answers a touch (`touch`): it asks the voice port's `observeTouch` what the mind may see of the touch, sends the mind one `touch` stimulus, and dispatches the intents to the scene (`reactToTouch`, `addMood`), to its `markMoment` option, and to the voice port. Under every driver it sends the performance resolver's events of one call to the mind as one step (`desktop`); it performs the posture intents only under Natural, through the scene's `wakeFromSleep` and `reactToDesktop`, hands the `welcome-back` moment to `markMoment`, and hands the `observe-wake` and `observe-return` voice intents to the voice port's `observeReturn`. Under Natural it hands each idle intent to the scene as an order (`idle`) and the scene's idle reports to the mind (`idleReport`); under another driver the mind hears the dormant idle view. A requested play (`idlePlay`) goes to the mind as an `idle-play` stimulus. It also sends the face baseline and the idle drive to the scene and records affect traces.

**Code:** `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` `StagePerformanceConductor`, `useStagePerformanceConductor`; `packages/stage-ui/src/composables/performance/mind-voice.ts` `VoicePort`, `MindVoice`; `packages/stage-ui/src/stores/character-mind.ts` `useCharacterMindStore`.
**Not to be confused with:** the character mind, which decides the emotion and the response to a touch; the decider, which is pure and only picks entries; and the body director, which owns the MMD body.
**Avoid:** "performance manager", "orchestrator" (the chat orchestrator is a different module).

### Conversation register

Whether she talks or texts with the user: `talking`, the spoken default, or `texting` with a flavor (`plain` or `discord`). The register renders a character-prompt section from fixed locale keys, which is the `register` prompt segment, and the texting register allows a closed set of ASCII faces that speech never reads.

**Code:** `packages/stage-shared/src/conversation-register/index.ts` `CONVERSATION_REGISTERS`, `ConversationRegister`, `renderRegisterSection`, `ASCII_FACES`; setting `packages/stage-ui/src/features/conversation/settings.ts` `useConversationSettings`.
**Not to be confused with:** the reply shape of the stage contract, which applies in both registers.
**Avoid:** "chat mode", "tone".

### Cursor attention

Her response to the mouse cursor near her face. The [character mind](#character-mind) decides each episode: whether she engages, the interest span, the notice dwell, and the cooldown, drawn on its own seeded stream when Natural reports that a notice is possible. Natural tracks the cursor and plays the episode: interest rises until it crosses `noticeLevel`, she notices the cursor, orients her gaze to it, and later releases or dismisses it. Permission drops to dismiss while the setting is off or her attention is `aside` or `screen`.

**Code:** the decision `packages/character-mind/src/attention.ts` `answerCursor`; the episode draw `packages/motion-driver-natural/src/cursor-notice.ts` `drawCursorEpisode`, `interestSpan`, and the contract `CursorReport`, `CursorOrder`; the performer `packages/motion-driver-natural/src/cursor-attention.ts` `NaturalCursorAttention`, `noticeLevel`; Live2D setting `packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts` `useLive2DNaturalSettings` (`cursorAttention`).
**Not to be confused with:** the body director's cursor chase on MMD (see Locomotion), which walks her toward the cursor only inside the [attend window](#attend-window) that the mind's `attend` intent opens, whether or not she noticed the cursor; Universal's eye tracking, which follows the mouse without episodes; and the screen-cursor host capability, which says whether a cursor reading can be trusted.
**Avoid:** "mouse tracking", "cursor follow".

### Decider

A pure, checkpointable state machine that picks the expression entries that show what the character mind decided. It turns affect signals into a `PerformanceDecision`: expression `slots` for the expression performer. A decision carries no episode, no hold, and no mood dose, and a touch is not a signal. Its input is the decided reaction episode (a `reaction` signal), never a raw emotion. Two kinds exist: the picker draws one expression per signal from weighted tickets with recency, and the planner extends the picker with planned holds and moments across a turn. The user's expression performance setting chooses the kind.

**Code:** `packages/stage-shared/src/expression-performance/types.ts` `Decider`, `DeciderContext`; `packages/stage-shared/src/expression-performance/deciders.ts` `createDecider`; `packages/stage-shared/src/expression-performance/picker.ts` `createPickerDecider`; `packages/stage-shared/src/expression-performance/planner.ts` `createPlannerDecider`.
**Not to be confused with:** the character mind, which decides the emotion, its strength, and its hold; the body director, which decides body behavior, not expressions; and the turn planner (`packages/motion-driver-humanoid/src/look-at/turn-planner.ts` `createTurnPlanner`), which plans head and body turns.
**Avoid:** "expression AI", "selector".

### Desktop reaction

A brief Natural response to a desktop event. The performance resolver reports the event (`presence` with a `wake`, or `screen-change`), and the character mind decides the reaction as a posture `desktop-reaction` intent, which Natural performs. `wake` fires when the desktop unlocks or resumes: a camera glance and nudge that also rouses her from idle sleep. `screen-change` fires when the screen content changes sharply: a glance at the screen, at most once every 10 s, and not in a call that also holds a wake.

**Code:** `packages/stage-shared/src/performance-state/index.ts` `PerformanceEvent`, `resolvePerformanceState`; decided by `packages/character-mind/src/presence.ts` `answerPresence`, `answerScreenChange`; performed by `packages/motion-driver-natural/src/natural-motion.ts` `NaturalMotion` (`react`) and `packages/motion-driver-natural/src/pending-actions.ts` `startPending`.
**Not to be confused with:** a reaction episode from the character mind; a touch reaction; and the `welcome-back` moment expression or ritual reach-out that the same return can start.
**Avoid:** "wake event" for both kinds, "screen reaction".

### Drive

The input that shapes Natural's idle behavior, set by the host from the slower character state and the desktop: slow mood energy, valence, and tension relative to her resting disposition, sleepiness by local hour, solitude since the last exchange, a pace multiplier, and optionally whether the host performs a whole body, which whole-body kinds are unreachable, and which idle errands it can realize. The first six fields are required; music is not one of them, because the character mind hears it as a [stimulus](#stimulus). Without a drive the idle activity layer is inert.

**Code:** `packages/motion-driver-natural/src/idle-activities.ts` `NaturalIdleDrive`, `packages/motion-driver-natural/src/idle-schedule.ts` `idleActivityWeights`; producer `packages/stage-shared/src/character-state/idle.ts` `idleDriveOf`, which returns the five-field `IdleDrive` (`packages/stage-shared/src/character-state/types.ts`).
**Not to be confused with:** the motion driver (Natural, Universal, MAGIC, or classic), which is the setting that chooses the motion system.
**Avoid:** "idle state", "idle mood".

### Emotion impulse and emotion gesture

Natural's motion answer to a reaction episode or a poke. An impulse is additive and decays: a head pulse, a body lean, face hints, and an optional glance, none of which reset posture. An emotion gesture is a short head and body clip for some emotions (laugh, recoil, shake, drop, sway, tilt-in, look-away, nod-off) that ducks continuous posture motion while it plays and has a cooldown per kind.

**Code:** `packages/motion-driver-natural/src/impulses.ts` `NaturalImpulses`, `HeadPulse`, `FaceHints`; `packages/motion-driver-natural/src/gestures.ts` `NaturalGestures`; `packages/motion-driver-natural/src/emotions.ts` `GestureKind`; routed by `packages/motion-driver-natural/src/pending-actions.ts` `startPending`.
**Not to be confused with:** cue gestures that an ACT cue's gesture field requests, which outrank an emotion gesture on the head; and an MMD clip of kind `gesture`.
**Avoid:** "emotion animation", "reaction gesture".

### Energy

On the character state, `energy` is one of the three mood axes (valence, energy, tension), from -1 (drained) to 1 (buzzing), bucketed for the prompt as drained, tired, steady, lively, or buzzing. Natural's idle drive carries the same axis relative to her resting disposition. Natural's `NaturalPerformanceEnergy` is a different thing: the cross-faded amplitude, shift-rate, and camera-fixation scales that posture and gaze read for the current performance mode and the user's energy setting.

**Code:** `packages/stage-shared/src/character-state/types.ts` `MoodAxes`, `EnergyBucket`; `packages/motion-driver-natural/src/energy.ts` `NaturalPerformanceEnergy`.
**Not to be confused with:** gesture gain and tempo in `packages/motion-driver-humanoid/src/performance/gesture-forms.ts` (`gestureGain`, `gestureTempo`), which take an energy argument from the performer's input.
**Avoid:** "arousal" for the character-state axis (Natural's mood uses `arousal`; see Mood).

### Expression performance

The system that decides and plays expressions in response to affect: the expression catalog (per-model expressions, custom expressions, and combos with emotion mappings), the reaction rules that the character mind runs to decide the emotion, its strength, and its hold, the deciders that pick the entries, the scheduler of slot commands and holds, character profiles that scale intensity, and affect traces for replay. An affect trace is version 2: it records the deciders' signals, which carry the decided episodes, so a replay needs no mind. Its pure rules live in `stage-shared`; the conductor runs the mind and the deciders, and each renderer's expression store executes its slot commands.

**Code:** `packages/stage-shared/src/expression-performance/index.ts` (module barrel); `packages/stage-shared/src/expression-performance/settings.ts` `ExpressionPerformanceSettingsSchema`; `packages/stage-shared/src/expression-performance/catalog.ts` `ExpressionKindSchema`.
**Not to be confused with:** the performance state (the stage's current mode) and the whole-body performer for MMD.
**Avoid:** "emotion system", "expression engine".

### Gate

A pure check that decides whether the character may speak unprompted now. The hard gate (`hardReason`) holds for suppressors such as do-not-disturb, a hidden stage, an away or unknown presence, stale signals, the user speaking or typing, generation in progress, or a quiet app. The urge gate integrates a hazard over elapsed time, fires when the urge crosses a drawn threshold, picks a reason, and tracks social memory: unanswered messages, damping, double texts, the ritual day, and the last own-day turn. Its memory splits by owner: the user's slice (`UserGateMemory`: the floor's last fire, the hourly cap's fires, and the ritual day) is per user, and her pacing (`CharacterPacingMemory`: last-spoke time, unanswered openings, the reply wait, the damping, the own-day mark) is per character. The reaction policy is a separate gate for spoken touch reactions. The character mind runs both the urge gate and the reaction policy as its [voice policy](#voice-policy), and the situation store ticks it. "Reach-out gate" in comments means the urge gate together with the hard gate.

**Code:** `packages/stage-shared/src/situation/gate.ts` `hardReason`, `GateHardReason`, `GateOutcome`; `packages/stage-shared/src/situation/urge-gate.ts` `evaluateUrgeGate`, `UrgeGateMemory`, `UrgeGateDecision`, `UserGateMemory`, `CharacterPacingMemory`, `restoreGateMemory`; hazard math in `packages/stage-shared/src/situation/urge.ts` `accrue`, `drawThreshold`; run by `packages/character-mind/src/voice.ts` `answerVoiceTick`; ticked by `packages/stage-ui/src/stores/situation/index.ts` `useSituationStore` every `GATE_INTERVAL_MS`.
**Not to be confused with:** `pnpm verify --gate` in dev tooling, which is unrelated; and the reaction policy (see Reaction).
**Avoid:** "opportunity gate" (the superseded design; see Conflicting usages), "cooldown".

### Gaze arbiter

The rule in Natural's gaze layer that decides between [glances](#glance) under the Natural driver, on both renderers. Each request names its source, and the arbiter ranks it by a fixed priority: the long-pet camera glance and a poke, then the desktop wake and the wake from sleep, then a chat read and the idle voice cues, then look tools, cue gestures, and emotions, then the screen change, then a noticed cursor, then idle acts. A request starts unless the running glance ranks higher; a lower one is refused and dropped, never queued. While the pet override holds, only the long-pet camera glance starts. It runs at frame rate on Natural's active seconds, and the [character mind](#character-mind) does not rank glances.

**Code:** `packages/motion-driver-natural/src/gaze.ts` `NaturalGazeLayer` (`glance`, `orient`, `claim`), `GLANCE_PRIORITY`, `GlanceSource`.
**Not to be confused with:** cursor attention, which decides whether she notices the cursor at all; and MMD's head and eye aim, which follows the gaze target the arbiter leaves.
**Avoid:** "gaze policy" (the mind has none), "glance queue".

### Glance

A held look that another layer asks Natural's gaze layer for: a saccade to a point, held for a set time, before her own fixations resume. A poke, an emotion impulse, a desktop reaction, a chat read, a cue gesture, an idle act, the wake from sleep, and the end of a long pet each ask for one, and the [gaze arbiter](#gaze-arbiter) decides which runs. The observer reports every glance started or refused as a `glance` event with its source as `cause`.

**Code:** `packages/motion-driver-natural/src/gaze.ts` `NaturalGazeLayer` `glance`, `GlanceRequest`; `packages/motion-driver-natural/src/frame-types.ts` `NaturalGlanceEvent`.
**Not to be confused with:** the cue `glance` gesture, one source of a glance; and the autonomous fixations (free, typing, cursor pursuit), which are not glances and rank below every one.
**Avoid:** "look" for a glance (the `look_at` tool and ACT `look` are other inputs).

### Groove

The character's response to music: an episode of Natural's `sway` idle act, which the character mind's [idle policy](#idle-policy) draws only while it hears music, at the act's usual odds, cooldown, and length. The mind hears music from one detector: upstream's [beat sync](#beat-sync) detector, whose beats count as music after 8 s with no gap over 1.8 s, outside game, call, and chat apps. The leader's mind store hosts the detector while the window leads and sends each start and stop as a `music` stimulus. On MMD the performer plays the same act as a body offset. A sway that starts while Natural's [beat clock](#beat-clock) is locked binds to it for its whole length: it takes 2, 4, or 8 beats per cycle, whichever is nearest its drawn period, and its bob reaches its low point on each beat. When the beats stop it keeps its last rate. A sway that starts without a lock sways at its drawn period, as it does without music detection.

**Code:** `packages/stage-shared/src/music/index.ts` `advanceMusic`, `nextMusicDeadline`, `MUSIC_SETTLE_MS`, `MUSIC_RELEASE_MS`; `packages/stage-ui/src/composables/performance/mind-music.ts` `MindMusic`; `packages/character-mind/src/music.ts` `answerMusic`, `MindState.music`; `packages/motion-driver-natural/src/idle-schedule.ts` `IdleContext`, `idleActivityWeights`; `packages/motion-driver-natural/src/idle-activities.ts` `NaturalIdleActivities` `grooveLock`, `groovePhase`.
**Not to be confused with:** beat sync, which moves the Live2D head on each beat under Universal and MAGIC; and the sway emotion gesture.
**Avoid:** "dance" (an MMD clip kind), "music mode". The act kind keeps the name `sway`.

### Host capability

What the running desktop host can actually report for each presence signal (for example foreground window, idle time, screen cursor, system audio), each resolved as `live`, `degraded`, or `unavailable` with a reason, from facts about the platform, the Wayland session, and runtime failures. Consumers read the resolved capabilities instead of assuming a platform; only a `live` cursor reading is trusted.

**Code:** `packages/stage-shared/src/host-capabilities/index.ts` `HostCapabilities`, `resolveHostCapabilities`, `acceptCursorReading`; producer `apps/stage-tamagotchi/src/main/services/electron/host-capabilities.ts` `getCurrentHostCapabilities`; store `packages/stage-shared/src/stores/host-capabilities.ts` `useHostCapabilitiesStore`.
**Not to be confused with:** the stage host (window or desktop), which is where the character is drawn; and plugin host capabilities (`packages/stage-ui/src/stores/plugin-host-capabilities.ts`), which describe what plugins may call.
**Avoid:** "platform support", "feature flags".

### Idle activity

Something the character does on her own while nobody asks anything of her, decided by the character mind's [idle policy](#idle-policy) from the drive and performed by Natural's idle layer, which draws each act's shape from the order's seed: stretch, yawn, look around, check in, peer, zone out, nod off, sway (her [groove](#groove), drawn only while the mind hears music), and, on a whole-body host, sigh, shoulder roll, stance shift, clasped hands, hair touch, heel rock, and arm swing. Sleep is an activity the mind enters by rule while the user is away, never drawn. The layer also plays two idle cues around a reach-out or widget line, which the character mind's posture `cue` intent requests: `about-to-speak` and `let-go`.

**Code:** `packages/motion-driver-natural/src/idle-activities.ts` `NaturalIdleActivities`, `IdleActivityKind`, `IdleCueKind`, `IdleBehaviourKind`; `packages/motion-driver-natural/src/idle-schedule.ts` `IdleOrder`, `IdleReport`.
**Not to be confused with:** an idle errand, which the host realizes in full; and Live2D idle motions under the Universal driver, which are model motion groups.
**Avoid:** "idle animation" (the Universal driver's setting), "idle behavior" for activities alone (`IdleBehaviourKind` also includes the cues).

### Idle errand

A long idle behavior that the character mind's idle policy decides, that Natural starts and records, and that the host realizes in its own form: a `pastime` with one of her props (Live2D), an `idle-clip` she plays unasked (MMD, only clips the user allowed for idle), or a `wander` along the ground (MMD roam mode). The host answers whether it took the errand, and each errand is paced by its own mean gap and refractory time.

**Code:** `packages/motion-driver-natural/src/idle-errands.ts` `IDLE_ERRAND_KINDS`, `IdleErrandKind`, `IDLE_ERRAND_PACING`, `IdleErrandReports`.
**Not to be confused with:** an idle activity, which Natural plays itself.
**Avoid:** "idle task", "idle job".


### Idle policy

The part of the character mind that decides her idle episodes. It runs the idle schedule (`packages/motion-driver-natural/src/idle-schedule.ts`) on the mind's clock and its seeded random source, over the idle view Natural reports: the mode, the drive, whether she is blocked or away, and which errands the host lists. Each decision is one `idle-act` or `idle-errand` intent, and the mind decides nothing more until Natural reports that the order started or was refused. `nextIdleWakeAt` names its next exact deadline, at which the store sends an `idle-wake`. Natural keeps the cues and each act's shape.

**Code:** `packages/character-mind/src/idle.ts` `answerIdle`, `advanceIdle`, `answerIdlePlay`, `idleOrderOf`, `nextIdleWakeAt`; `packages/character-mind/src/types.ts` `MindIdleState`, `MindIdleIntent`.
**Not to be confused with:** Natural's idle layer, which performs the orders and draws only their shapes; and the voice policy, which decides lines.
**Avoid:** "idle scheduler" for the whole policy (the schedule is its pure rules).

### Intent

What the character mind emits in answer to a stimulus, for one [channel](#channel). Each intent carries an `id` and a `cause`, the sequence number of the stimulus it answers. On the face channel: `emotion` (a reaction episode with its hold), `entry` (a named expression entry, with the episode and the hold that its emotion mapping gave, or none), `release` (a neutral reset or a clear), and `moment` (`poked`, `petted`, or `welcome-back`, which the performer may mark with one of the model's expressions). On the posture channel: `gesture` (an ACT or devtools cue gesture of its kind and count, sent to the scene only under Natural), `touch-reaction` (a poke at its point, or a pet `start` or `end`), `mood` (a dose for Natural's mood), `wake` (a gentle end of idle sleep, which does nothing while she is awake), `desktop-reaction` (`wake` or `screen-change`), `cue` (`about-to-speak` before a reach-out or widget line, `let-go` when she declines one; never for a touch line, and performed only under Natural), `idle-act` (an idle activity or sleep, with the seed of its shape and whether it was requested), and `idle-errand` (an idle errand with its pick and hold). The conductor hands the idle intents to the scene only under Natural, and Natural answers each with a report. On the gaze channel: `cursor-episode` (a [cursor attention](#cursor-attention) episode for one report's `requestId`), which the conductor returns only to the scene that reported, and `chat-read` (she reads the chat after a typed send of `words` words or when it unfolds, a [glance](#glance) Natural times and holds), which the conductor sends to the scene only under Natural. On the body channel: `attend` (a target and `attendCause`: `touch`, `drag`, or `chat-send` opens the cursor [attend window](#attend-window) for `windowMs`; `chat-unfold` asks for an approach to the chat without a cursor window), and `away` (the mind's presence answer on each away edge), which the conductor sends to the scene only under Natural; classic receives neither. On the voice channel: `speak` (one line, with a `turnId` and a `VoiceLine`: a `reaction` about a touch, a `reach-out` with its topic and reason, or a `widget` line with its topic and supplement), `cancel` (stop a widget line past its caller's deadline), `drop` (give up a widget request that did not start in time), `observe-wake`, and `observe-return` (a desktop wake and a return for the situation). The conductor dispatches each: an expression intent becomes a signal for the decider and, under Natural, an episode and a hold for the scene; a touch intent goes to the scene, to the moment marker, or to the voice port.

**Code:** `packages/character-mind/src/types.ts` `MindIntent`; produced by `packages/character-mind/src/expression.ts` `answerEmotion`, `answerExpressionRequest`, `answerExpressionClear`, and `packages/character-mind/src/touch.ts` `answerTouch`, and `packages/character-mind/src/presence.ts` `answerPresence`, `answerScreenChange`, and `packages/character-mind/src/voice.ts` `answerVoiceTick`, `answerVoiceRequest`, `answerVoiceOutcome`, and `packages/character-mind/src/idle.ts` `answerIdle`, `advanceIdle`, `answerIdlePlay`, and `packages/character-mind/src/attention.ts` `answerCursor`, `answerInteraction`; `idleOrderOf` turns an idle intent into Natural's order; `VoiceLine` names the three lines; `TouchReactionIntent` names the two `touch-reaction` forms; `AttendIntent` names `attend`.
**Not to be confused with:** `BodyIntent`, the MMD director's per-frame output.

### Leader and follower windows

Each Electron renderer runs synced Pinia stores. The leader window owns synced actions: it writes persistent storage and holds the situation and the gate. Follower windows replicate state from it and route actions to it. Chat actions are routed by role instead: they run in the window that holds the speech-player role, which the window that renders the stage takes, and in the leader when no window holds it. In the fork the leader renders the stage, so the leader runs chat turns. The [character mind](#character-mind) connects to the voice port only in the leader; a follower's mind is never connected and decides no line, and no follower renders a stage today. Main sets the role through the `synced-leader` query: the main window and the desktop stage window get `true`, and every other window (settings, chat, caption, devtools, widgets) gets `false`.

**Code:** `apps/stage-tamagotchi/src/main/windows/main/query.ts` `mainWindowQuery`; `apps/stage-tamagotchi/src/renderer/window-context.ts` `resolveRendererWindowContext`; `packages/stage-ui/src/libs/pinia/setup-synced.ts` `setupSynced`, `LeadershipMode`; `packages/stage-ui/src/libs/pinia/synced-context.ts` `syncedRoles`.
**Not to be confused with:** the arm "followers" of the body performer (`packages/motion-driver-humanoid/src/performance/gestures.ts` `followerInverse`), which are lagging joints.
**Avoid:** "main window" as a synonym for the leader (the desktop stage window can lead), "master and slave".

### Lipsync

The mouth writer during speech. On Live2D a final-stage plugin writes `ParamMouthOpenY` absolutely while she speaks, blends back to the motion value over a 200 ms release, holds 0 for a 500 ms handoff, and reports ownership every frame so Natural masks its mouth write. On MMD the `lip-sync` stage writes vowel and mouth morphs on the `lipSync` morph layer, above expressions. The VRM and MMD lip-sync nodes read the played speech through the stage's `connectSpeech` callback.

**Code:** `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginLipSync`; `packages/stage-ui-live2d/src/composables/live2d/lipsync-handoff.ts` `lipSyncReleaseMs`, `lipSyncHandoffHoldMs`; `packages/stage-ui-mmd/src/composables/mmd/lip-sync.ts` `useMMDLipSync`.
**Not to be confused with:** Natural's silent mouth (`silentMouthOpen`), which moves the mouth only outside speech.
**Avoid:** "lip sync" and "lip-sync" in prose (the code says `lipSync`), "mouth flap".

### Locomotion

An MMD character walking across the desktop stage. The body director picks a ground goal and a pace with a reason (`approach-chat`, `tool`, `debug`, `approach-cursor`, `return-home`, `enter-stage`, `wander`, or `visit`) in its `BodyIntent`, and the scene runs a deterministic procedural gait toward the goal that moves the root, pelvis, and feet. It needs the desktop stage host; under the window host the root never moves.

**Code:** `packages/motion-driver-humanoid/src/director/index.ts` `decideBody`, `BodyDirectorInput` (`attend.untilMs`), `RETURN_HOME_DELAY_MS`; `packages/character-mind/src/attention.ts` `ATTEND_WINDOW_MS`; `packages/motion-driver-humanoid/src/types/index.ts` `BodyIntent` (`locomotion`); `packages/motion-driver-humanoid/src/locomotion/index.ts` `createLocomotion`; `packages/stage-ui-mmd/src/composables/mmd/body/locomotion.ts` `MMDLocomotion`.
**Not to be confused with:** the `wander` idle errand, which only asks the director for a wander goal; and roam mode, the MMD setting that allows wanders and visits.
**Avoid:** "movement", "pathing", or "roaming" for locomotion as a whole.

### Long-term memory

Facts the character keeps across sessions. Each entry has an index line and a body and belongs to one character card or, without an owner, to every card; the entries live in IndexedDB, one record for each entry id. The model reads, writes, and forgets entries through memory tools, and an unprompted turn carries only the read tool. The card's index lines form the `memory` prompt segment. Any window may write, and a write invalidates the other windows over a BroadcastChannel.

**Code:** `packages/stage-ui/src/types/memory.ts` `MemoryEntry`; `packages/stage-ui/src/stores/memory.ts` `useMemoryStore`; `packages/stage-ui/src/database/repos/memory.repo.ts` `memoryRepo`; `packages/stage-ui/src/tools/memory.ts` `READ_MEMORY_TOOL_NAME`, `WRITE_MEMORY_TOOL_NAME`, `FORGET_MEMORY_TOOL_NAME`, `composeMemoryHeader`.
**Not to be confused with:** the character state, which holds mood and relationship rather than facts; and the gate's inner state (`packages/stage-ui/src/features/situation/inner-state.ts` `useSituationInnerState`), which holds urge-gate memory and conversation threads.
**Avoid:** "knowledge base", "RAG", and "memory" alone where the gate's memory could be meant.

### MAGIC

Markovian Animation Generator with Illusory Conditioning: a Live2D motion driver that fits a VAR or AR-HMM model to a bundled motion dataset and generates seeded parameter frames. The user picks a MAGIC profile, which selects the dataset. With eye tracking on, MAGIC also turns the generated pose toward the cursor.

**Code:** `packages/motion-driver-magic/src/fit.ts` `fit`, `MagicModel`; `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` `Live2DMotionDriver`; `packages/stage-ui-live2d/src/composables/live2d/focus-bias.ts` `createLive2DFocusBias`.
**Not to be confused with:** Natural, which is procedural and rule-based rather than fitted to data.
**Avoid:** "Magic" in prose (write it in capitals), "AI motion".

### Moment expression

An expression entry that the user tagged for a moment lasting seconds (`welcome-back`, `check-in`, `held-back`, `waking`, `petted`, `poked`, `yawning`, `zoning-out`, `peering`). She shows it as an idle claim for some of those moments: with a 0.6 chance, at most once per entry every 60 s, and for the time in `MOMENT_HOLD_MS` or the length of the idle act, capped at 20 s. Only the Live2D expression store shows moments. `welcome-back`, `poked`, and `petted` come from the character mind's `moment` intent; the others come from Natural's idle reports.

**Code:** `packages/stage-shared/src/expression-performance/moments.ts` `MomentSchema`, `Moment`, `MOMENT_SETTINGS`, `MOMENT_HOLD_MS`, `chooseMomentEntry`; run by `packages/stage-ui/src/composables/performance/use-idle-props.ts` `useIdleProps`.
**Not to be confused with:** a pastime, which is an idle errand gated by occasions that last minutes; and a reaction episode, which the character mind decides and the decider shows with entries picked by emotion.
**Avoid:** "reaction expression", and "moment" alone for the expression.

### Mood

Two codes use this word. The character-state mood is the slow layer: three axes (valence, energy, tension) built from contributions (model MOOD cues, touch, unanswered reach-outs, replies, returns, significant exchanges, rituals) that decay over hours toward the temperament baseline. Natural's mood is a fast afterglow of reaction episodes (valence, arousal, tension) that decays in seconds of active time and modulates Natural's motion scales. The fast mood stays in Natural; the mind sends it doses but does not hold it.

**Code:** `packages/stage-shared/src/character-state/types.ts` `MoodState`, `MoodAxes`, `MoodSource`; `packages/stage-shared/src/character-state/mood.ts` `pruneMood`; `packages/motion-driver-natural/src/mood.ts` `NaturalMood`; `packages/motion-driver-natural/src/mood-modulation.ts` `modulateByMood`.
**Not to be confused with:** temperament, the days-long average that sets the mood baseline; and the performance state's mode.
**Avoid:** "emotion" for the slow layer (an emotion is one `PerformanceEmotion` of an episode).

### Motion driver

The setting that chooses which motion system moves a model. Live2D has Natural, Universal, and MAGIC; MMD has Natural and classic. The choice is stored for each display model, and the fork's default is Natural. Natural's idle activities, cursor attention, emotion motion, and touch reactions run only under the Natural driver.

**Code:** `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` `Live2DMotionDriver`; `packages/stage-ui-mmd/src/stores/mmd.ts` `MMDMotionDriver`.
**Not to be confused with:** the idle drive (see Drive), which is Natural's input for idle behavior.
**Avoid:** "motion mode", "animation driver".

### Natural

The procedural motion driver for Live2D and MMD characters. `NaturalMotion` owns autonomous posture, gaze, body, face, blink, breath, idle activities, and touch responses without model or renderer state, and each host adapts its output to parameters or bones. On MMD, Natural's output is intent that the body performer turns into a whole-body pose.

**Code:** `packages/motion-driver-natural/src/natural-motion.ts` `NaturalMotion`; driver choices `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` `Live2DMotionDriver` and `packages/stage-ui-mmd/src/stores/mmd.ts` `MMDMotionDriver`.
**Not to be confused with:** Universal and MAGIC (Live2D only) and classic (MMD only), the other motion drivers.
**Avoid:** "natural motion v2", "procedural mode".

### Notice

A message that tells a conversation about something the owner did not say, today only the result of a settled background task. It is stored as a user-role message marked with its source. Each request renders it with a prefix that says it is not from the owner, and the request that delivers it lets the model stay quiet. Sensors and the character state do not count it as owner speech. Only the owner's own conversation receives notices.

**Code:** `packages/stage-ui/src/stores/chat.ts` `useChatStore` (`notifyConversation`); `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` `createChatOrchestratorRuntime` (send option `notice`).
**Not to be confused with:** a Spark Notify, which enters the situation and waits for the gate; the presence notice and the host notice settings, which tell the user about missing host signals; and the trigger message of an unprompted turn.
**Avoid:** "notification" (upstream's account inbox uses that word, and the fork does not ship it), "system message".

### Own-day reach-out

An unprompted turn whose reason is something from her own day, improvised when the turn is considered rather than stored. Its selection weight recovers after each use, and the urge gate stamps `lastOwnDayAtMs` when one is spoken. When the idle layer reports what she was doing, the reason text names it.

**Code:** `packages/stage-shared/src/situation/reasons/collect.ts` (reason kind `'own-day'`); `packages/stage-shared/src/situation/reasons/types.ts` `REASON_TEXT`; `packages/stage-shared/src/situation/urge-gate.ts` `recordUrgeFireOutcome`, `CharacterPacingMemory`.
**Not to be confused with:** a ritual reach-out (greetings tied to the logical day) and a thread continuation.
**Avoid:** "diary", "daily story".

### Performer

The part that executes decisions without making them. On MMD, the whole-body performer is a pure kinematic synthesizer that turns Natural's intent, gaze goals, the director's stance, the gait, and clip ownership into bone channels each 120 Hz tick, and `MMDBodyPerformer` writes those channels to the model's bones. On Live2D, the expression performer is the Live2D expression store with its hold performer, which applies slot commands and emotion holds.

**Code:** `packages/motion-driver-humanoid/src/performance/index.ts` `createBodyPerformer`; `packages/stage-ui-mmd/src/composables/mmd/body/performer.ts` `MMDBodyPerformer`; `packages/stage-ui-live2d/src/composables/live2d/expression/hold.ts` `EmotionHoldPerformer`; tool-facing view `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` `ExpressionToolPerformer`.
**Not to be confused with:** the conductor, which dispatches; the character mind, which decides the emotion; the decider, which picks expression entries; and the body director, which decides body behavior.
**Avoid:** "renderer" for a performer (the renderer draws the model).

### Persistence tier

The six places that client state may live, chosen in order: 1, a synced settings document; 2, leader-only localStorage written by explicit command with a leadership token; 3, localStorage keyed by display model id and written by the stage window; 4, IndexedDB; 5, synced Pinia memory, replicated and not persisted; 6, per-window memory. Plain localStorage refs and a main-process ring with disk recording are closed to new state. Upstream's per-model display settings are plain refs stored once for each display model, under `settings/models/<model id>/`; they are not tier 3. A copy that the app can download or rebuild is a cache, not a tier. A store that persists anything registers in the state registry.

**Code:** `packages/stage-ui/src/persistence/state-registry.ts` `PersistenceTier`, which adds the closed plain-ref tier and caches. Examples: `packages/stage-shared/src/composables/use-settings-document/index.ts` `useSettingsDocument` (tier 1); `packages/stage-ui/src/features/situation/inner-state.ts` `useSituationInnerState` (tier 2); `packages/stage-ui/src/libs/pinia/setup-synced.ts` `setupSynced` (tiers 1 and 5).
**Not to be confused with:** leader and follower windows, which decide who writes, not where.
**Avoid:** "storage layer", "cache level".

### Posture

Natural's continuous head, body, and eye pose: homes, drift, shifts, and continuous motion layered per axis and scaled by the performance energy and mood. On Live2D the adapter writes posture to the head, body, and eyeball parameters and overwrites them at full weight. On MMD the body performer turns it into torso, head, and eye rotations.

**Code:** `packages/motion-driver-natural/src/posture.ts` `NaturalPostureLayers`, `postureHomes`; `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` (`composePosture`); `packages/stage-ui-mmd/src/composables/mmd/body/performer.ts` `MMDBodyPerformer`.
**Not to be confused with:** a stance, which is the MMD body's base pose; and emotion impulses and gestures, which add to posture.
**Avoid:** "pose" for posture alone.

### Presence

Whether the user is at the desktop, as the situation reads it: `here`, `idle` (no input for 60 s), `away` (300 s, or the screen is locked or the system suspended), or `unknown` (the desktop sample is missing or older than 5 s). Idle time counts from the later of the last desktop input and the user's last turn. The situation's presence decides the gate's holds, the greeting and sign-off, and the `went-away` event, not returns. A [return](#return) is decided separately, by the performance resolver's `away`, which turns true after 300 s without input or while the screen is locked or the system suspended, and never on an unknown reading.

**Code:** `packages/stage-shared/src/situation/types.ts` `PresenceState`, `SituationPresence`.
**Not to be confused with:** "situational presence", the feature name in the ADR for the whole situation-to-reach-out pipeline; the presence bubble (`packages/stage-shared/src/presence-bubble/content.ts` `resolvePresenceBubbleContent`), which shows thinking and unread state beside the character; and the presence notice (`apps/stage-tamagotchi/src/renderer/composables/use-presence-notice.ts` `usePresenceNotice`), which tells the user which signals this host lacks.
**Avoid:** "online status", "AFK".

### Presence bubble

The small panel beside the character's head. It shows one thing at a time: animated thinking dots while a chat turn generates, or an unread count. The real state sets only `thinking`; an unread count comes only from the devtools override.

**Code:** `packages/stage-shared/src/presence-bubble/content.ts` `PresenceBubbleContent`, `resolvePresenceBubbleContent`; `packages/stage-shared/src/presence-bubble/advance.ts` `PresenceBubbleAdvancer`; override `packages/stage-ui/src/stores/presence-bubble.ts` `useSettingsPresenceBubble`.
**Not to be confused with:** presence, the user's here, idle, away, or unknown reading; and the presence notice about missing host signals.
**Avoid:** "typing indicator", "status bubble".

### Prompt segment

One named part of the system prompt of a character turn. `composePrompt` sorts the segments by `PROMPT_SEGMENT_ORDER` (`format`, `card`, `register`, `contract`, `actions`, `memory`, `toolset`, `voice`, `control`, `unprompted`, `plugin`, `stickers`, `spark`), fits each to its budget under its overflow policy (`fixed`, `warn`, `truncate`, or `drop-oldest`), and drops empty ones. The first four form the stable prefix that the provider's prompt cache depends on; the rest form the per-request tail.

**Code:** `packages/stage-shared/src/stage-contract/compose.ts` `PROMPT_SEGMENT_ORDER`, `PROMPT_SEGMENT_BUDGETS`, `PromptSegmentId`, `OverflowPolicy`, `composePrompt`; built in the app by `packages/stage-ui/src/stores/chat/prompt.ts` `useChatPrompt` (`buildChatPromptSegments`).
**Not to be confused with:** the situation block and the character context, which ride on the last user turn and are not segments; and the audio playback `OverflowPolicy` in `packages/pipelines-audio/src/managers/playback-manager.ts`.
**Avoid:** "prompt section", "prompt block".

### Reach-out

An unprompted turn: a chat turn that the character starts on her own when the gate fires in the mind's [voice policy](#voice-policy), with a reason (a situation topic, a thread continuation, a ritual, an own-day thought, a double text, or an urgent event) and an instruction that always offers the decline marker. The model can decline with `<|SILENT|>` or answer with only a look. Only one unprompted turn is pending at a time, and user messages bypass the gate.

**Code:** `packages/stage-ui/src/stores/chat.ts` `useChatStore` (action `submitUnprompted`), `ChatUnpromptedPayload`, `ChatUnpromptedResult`; decided by `packages/character-mind/src/voice.ts` `answerVoiceTick` through `packages/stage-shared/src/situation/urge-gate.ts` `evaluateUrgeGate`; run by `packages/stage-ui/src/stores/situation/index.ts` `useSituationStore` (`speak`).
**Not to be confused with:** a spoken reaction to touch (see Reaction), which goes through `submitReaction` and its own policy; a forced turn from devtools, which skips the urge; and a notice turn, which answers a finished background task and is not an unprompted turn.
**Avoid:** "proactive message", "ping", "nudge".

### Reaction

Three codes use this word. An expression reaction episode is one decided emotion at a nominal intensity and band, the unit the character mind decides and sends to Natural; the decider receives it to pick entries. A spoken touch reaction is a short line after a long pet (`pet-soft`) or a poke burst (`poke-protest`), decided by the character mind's [voice policy](#voice-policy) with its reaction policy and run through `VoicePort` `speak` and `submitReaction`. A body reaction is the MMD performer's physical response to a poke, pet, or drag.

**Code:** `packages/stage-shared/src/expression-performance/types.ts` `ReactionEpisode`; `packages/stage-shared/src/expression-performance/reaction-strength.ts` `acceptReaction`, called only by `packages/character-mind/src/expression.ts` `answerEmotion` and `answerExpressionRequest`; `packages/stage-shared/src/situation/reaction-policy.ts` `ReactionKind`, `reactionPolicy` (called by `packages/character-mind/src/touch.ts` `answerTouch`), `settleReaction` (called by `answerVoiceOutcome`); `packages/motion-driver-humanoid/src/performance/contracts.ts` `BodyReactionKind`.
**Not to be confused with:** Spark Notify reactions (`packages/core-agent/src/agents/spark-notify/plugins/reaction.ts` `createSparkNotifyReactionPlugin`), which are the notify agent's output, and chat message reactions (`packages/stage-ui/src/stores/chat.ts` `ChatReactionPayload`).
**Avoid:** "response" for any of the three.

### Recipe

A named set of steps, or one question with an action for each answer, that the owner wrote or approved. A recipe is usable only while it is enabled and approved; a model proposal waits unapproved and disabled. A recipe is used in three ways: a keyword in the owner's message invokes it, the model starts it with the use-recipe tool, or a decision recipe asks its question through the judge tool and code picks what follows. A background recipe runs as a background task; any other recipe gives its steps to the conversation. No timer or sensor starts a recipe.

**Code:** `packages/core-agent/src/runtime/recipe.ts` `Recipe`, `RecipeDecision`, `usableRecipes`, `matchKeywordRecipes`, `judgeDecision`; store `packages/stage-ui/src/stores/recipes.ts` `useRecipesStore`; tools `packages/stage-ui/src/tools/use-recipe.ts` `createUseRecipeTool`, `packages/stage-ui/src/tools/judge-recipe.ts` `createJudgeRecipeTool`, `packages/stage-ui/src/tools/propose-recipe.ts` `createProposeRecipeTool`.
**Not to be confused with:** long-term memory, which holds facts and not steps; and the toolset prompt, which says how to use a tool.
**Avoid:** "skill" in prose (the code's `ChatInvokedSkill` is the text a keyword-invoked recipe adds to a message), "macro", "workflow".

### Reply shape

The stage-contract rules for what a reply looks like: spoken and short unless the content or the user asks for more, from a person rather than an assistant (no offers of help, recaps, or check-ins), with at most one question that she wants answered, and allowed to be only an ACT cue plus `<|SILENT|>`. A token cap per request backs the rules.

**Code:** `packages/stage-shared/src/stage-contract/index.ts` `STAGE_CONTRACT_KEYS` (key `response`, the locale string `base.prompt.response`), `REPLY_MAX_TOKENS`.
**Not to be confused with:** the register section of the character prompt, which decides whether she talks or texts.
**Avoid:** "response format", "output style".

### Return

The end of an away span: the performance resolver's `away` turns false after it was true. The resolver reports it as a `presence` event, and the character mind answers it once, under every driver: a gentle wake from idle sleep, the `welcome-back` moment, and an `observe-return` voice intent. A desktop wake in the same call is part of the same response.

**Code:** `packages/stage-shared/src/performance-state/index.ts` `resolvePerformanceState`, `PerformanceEvent`; answered by `packages/character-mind/src/presence.ts` `answerPresence`.
**Not to be confused with:** a desktop wake, an unlock or resume, which can come while the user is still away; the situation's `returned` event and `welcome-back` ritual, which are the gate's answer to the mind's `observe-return`.
**Avoid:** "welcome back" for the return itself, "unlock".

### Scene session

A chat session bound to an external scene, for example a Discord channel, where the character answers other people. Its replies return as text and never speak on the host. It gets no recipe tools, no reply cards, and no notices. A session without a binding is the owner's own conversation.

**Code:** `packages/stage-ui/src/types/chat-session.ts` `ChatSessionMeta` (field `bindings`); `packages/stage-ui/src/stores/chat.ts` `useChatStore` (`isOwnerSession`); `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` `createChatOrchestratorRuntime` (send option `scene`).
**Not to be confused with:** a Live2D or MMD scene component, which draws the model; and a background task's session, which is the owner's and has no binding.
**Avoid:** "channel session", "group chat" (a session holds one character today).

### Situation

The leader window's bounded, unpersisted model of what is happening around the character: presence, the current and recent apps, busy state, a ring of salience-scored events (app switches, long sessions, returns, touches, notifications), conversation threads, context sources, her own recent activity, and stage facts. A pure reducer folds sensor observations into it, and the gate picks topics from it.

**Code:** `packages/stage-shared/src/situation/types.ts` `SituationState`, `SituationEvent`; `packages/stage-shared/src/situation/reducer.ts` `reduceSituation`, `advanceSituation`, `markShown`, `markAddressed`; store `packages/stage-ui/src/stores/situation/index.ts` `useSituationStore`.
**Not to be confused with:** the character state, which is her inner state and persists per card; and the situation block, which is the rendered prompt text.
**Avoid:** "context" alone (context sources are one part of it), "world state".

### Situation block

The short flat-bullet text that renders the situation into the prompt under a `[Situation <time>]` header: presence, activity, her own activity, up to two unshown `New:` events, the conversation line, context lines, and the stage line. Lowest-priority bullets are dropped whole until the line and character budgets hold, and rendering marks the events it showed.

**Code:** `packages/stage-shared/src/situation/render.ts` `renderSituation`, `SITUATION_MAX_LINES`, `SITUATION_MAX_CHARS`; her own line from `packages/stage-shared/src/situation/self.ts` `selfLine`.
**Not to be confused with:** the character context (`packages/stage-shared/src/character-state/render.ts` `renderCharacterContext`), which renders her mood and relationship.
**Avoid:** "situation prompt", "context block".

### Spark Notify

A `spark:notify` protocol event that tells the character something happened, and the agent that handles it. Plugins and the server channel send notifies, and the client makes two of its own: an avatar touch notify under the Universal and MAGIC drivers, and a reminder for a due notebook task. The client folds each notify into the leader's situation as an observation, so the gate decides whether she speaks about it. A notify that asks for a [widget reaction](#widget-reaction) is also a `voice-request` stimulus, which only the leader serves. Only for a notify addressed beyond the character, or one that forces a command, the character orchestrator also runs the commands-only Spark Notify agent, which emits `spark:command` events.

**Code:** `packages/stage-ui/src/stores/situation/sensors/notify.ts` `ingestSparkNotify`; `packages/core-agent/src/agents/spark-notify/agent.ts` `createSparkNotifyAgent`; used in `packages/stage-ui/src/stores/character/orchestrator/store.ts` `useCharacterOrchestratorStore`; `packages/stage-ui/src/libs/avatar-touch/notify.ts` `toAvatarTouchSparkNotify`.
**Not to be confused with:** Spark Command (`packages/core-agent/src/agents/spark-command/tools.ts` `createSparkCommandTool`), the outgoing command tool.
**Avoid:** "push notification", "spark event" without naming notify or command.

### Stage contract

The register-neutral part of the system prompt that tells the model how to drive the stage: the ACT cue syntax and emotion list, the MOOD cue, the emoji restriction, and the reply shape. It renders without reading locale or application state and composes after the formatting rules and the character card.

**Code:** `packages/stage-shared/src/stage-contract/index.ts` `renderStageContract`, `stageContractEmotions`, `composeSystemPrompt`; segment order `packages/stage-shared/src/stage-contract/compose.ts` `PROMPT_SEGMENT_ORDER`; wired by `packages/stage-ui/src/composables/use-airi-runtime-prompt.ts` `useStageContractPrompt`.
**Not to be confused with:** the host capability contract, which is about desktop signals; and the cue contract fixtures in `packages/core-agent` (`CUE_CONTRACT_FIXTURES`), which test the parser.
**Avoid:** "system prompt" for the contract alone.

### Stage host

The Electron window that hosts the character. `window` is the classic 450x600 window. `desktop` is the full-screen, click-through desktop stage on the home display, where an MMD character can walk; it is off by default behind the Experimental 3D stage setting, which is the only switch between the two and applies at the next launch. `AIRI_STAGE_HOST=window|desktop` overrides the setting in development builds only.

**Code:** `apps/stage-tamagotchi/src/shared/eventa/index.ts` `StageHostMode`, `StageHostState`; `apps/stage-tamagotchi/src/main/windows/stage/config.ts` `buildStageHostState`; `apps/stage-tamagotchi/src/renderer/composables/use-stage-host-wiring.ts` `useStageHostWiring`.
**Not to be confused with:** the host in host capabilities (the platform and desktop session), and the Godot VRM stage sidecar (`engines/stage-tamagotchi-godot`, launched from `apps/stage-tamagotchi/src/main/services/airi/godot-stage`), which renders VRM models in a separate process.
**Avoid:** "overlay mode", "fullscreen mode", "Kirie" (a removed Godot/CEF host app).

### Stance

The MMD body's base pose, which the body director holds: `stand`, `sit`, or `sleep`, each played by a looping stance clip that the user assigns, or a procedural `rest` or `doze` when no clip is assigned. She settles after 120 s of idle at home, and Natural's `asleep` maps to sleep. A performing clip other than a gesture forces a stand, and a stance holds for at least 3 s.

**Code:** `packages/motion-driver-humanoid/src/types/index.ts` `BodyIntent` (`stance`); `packages/motion-driver-humanoid/src/performance/contracts.ts` `BodyRest`; `packages/motion-driver-humanoid/src/director/index.ts` `STANCE_MIN_DWELL_MS`, `IDLE_TO_SIT_MS`; `packages/stage-ui-mmd/src/composables/mmd/stance.ts` `MMDStanceDirector`.
**Not to be confused with:** posture, Natural's continuous pose; and the `shift-stance` idle activity, a weight shift while standing.
**Avoid:** "pose" or "state" for a stance.

### State registry

The one list of every piece of persisted renderer state. Each registration names its owner, the files that write it, its persistence tier, its locations in browser storage, and an optional owner reset. No two registrations claim the same storage, and a browser test fails when creating or resetting the owners writes storage that no registration owns.

**Code:** `packages/stage-ui/src/persistence/state-registry.ts` `stateRegistry`, `StateRegistration`, `resetRegisteredState`.
**Not to be confused with:** the main-process files, which `setupStoredData` declares and deletes.
**Avoid:** "storage keys list", "persistence manifest".

### Stimulus

An observation the character mind answers. Today eighteen kinds exist: `emotion` (an ACT emotion, a tool call, or a devtools pulse, with a nominal strength already scaled by the card's expressiveness), `expression-request` (the model named an entry; the conductor reads the entry's lease and primary emotion mapping, so the mind needs no catalog), `expression-clear`, `touch` (a `TouchReport` from a scene: a poke with its point, a pet start, or a pet end, with what the leader's voice channel shows of it, or `null`), `voice-outcome` (what became of a `speak` intent, named by its `turnId`), `voice-tick` (the situation store's 2 s tick, with a `VoiceView` and `forceTiming`), `user-turn` (the user sent a turn), `voice-request` (a widget or plugin asks her to speak, with its topic, supplement, and timeout), `presence` (the resolver's `away` changed or a desktop wake appeared), `screen-change` (the screen content changed sharply), `idle` (Natural's idle reports: its view, and the starts, ends, and refusals of the orders it was given), `idle-wake` (the store's timer at `nextIdleWakeAt`), `idle-play` (a requested idle act), `music` (the music detector's edge: whether she hears music from now on), `cursor` (a `CursorReport` from the reporting Natural performer: a notice it could start, with the cursor's band and what made it possible), `interaction` (the user dragged her and let go; `source` is `drag`), `chat` (the user typed and sent a message, `cue: 'sent'` with its word count and never its text, or the host's chat unfolded, `cue: 'unfold'`), and `cue-gesture` (an ACT or devtools cue gesture, with its kind, count, source, and the ACT reply's `turnId`).

**Code:** `packages/character-mind/src/types.ts` `MindStimulus`, `TouchReport`; sent by `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` `StagePerformanceConductor` (`emotion`, `expression`, `clearExpression`, `touch`, `desktop`, `idleReport`, `idlePlay`, `cursor`, `interaction`, `chat`, `gesture`); `idle-wake` and `music` come from `useCharacterMindStore`, `music` through `packages/stage-ui/src/composables/performance/mind-music.ts` `MindMusic`; the voice stimuli come from `packages/stage-ui/src/stores/situation/index.ts` `useSituationStore` through `VoicePort` `connect`, to which `packages/stage-ui/src/stores/character-mind.ts` `useCharacterMindStore` connects.
**Not to be confused with:** an affect signal, which is the decider's input and carries what the mind already decided.
**Avoid:** "event" alone, "trigger".

### Synced settings document

The persistence tier for one feature's user-facing settings: one Valibot-validated document in a synced Pinia store, persisted privately to localStorage, whose `update` and `reset` actions are leader-routed so followers never write storage. Each stored field is validated on its own, so an invalid field falls back to its default while valid siblings survive.

**Code:** `packages/stage-shared/src/composables/use-settings-document/index.ts` `useSettingsDocument`, `SettingsDocument`; examples `packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts` `Live2DNaturalSettings`, `packages/stage-ui-mmd/src/stores/natural-settings.ts` `MMDNaturalSettings`, and `packages/stage-ui/src/features/performance/settings.ts` `useExpressionPerformanceSettings`.
**Not to be confused with:** synced Pinia memory (runtime state replicated but not persisted) and plain `useLocalStorageManualReset` refs, a tier closed to new state.
**Avoid:** "settings store" for the document (a store may hold other state too).

### Touch reaction

Under the Natural driver, the one response that the character mind decides for a poke or pet. The scene classifies the touch, reports it as a `TouchReport`, and shows nothing until the conductor hands it the mind's intents. The response has up to four parts, each with its own pacing in the mind's state: Natural's body and face response every time (a poke nudge, surprise, and glance; the pet face and a pet gaze override; on MMD a body reaction from the performer), a mood dose to Natural's mood, a moment expression on Live2D for a poke and a finished pet, and a spoken line (`pet-soft` or `poke-protest`) when the reaction policy decides one and the leader's voice channel can take it. Under Universal and MAGIC, upstream's touch system answers instead: an additive head and body reaction, the model's own touch motion group on a tap, and an avatar touch notify that lets her speak through the gate.

**Code:** `packages/stage-ui-live2d/src/composables/live2d/touch.ts` `createLive2DTouchReaction` (Universal and MAGIC); `packages/motion-driver-natural/src/touch.ts` `NaturalPetLayer`; `packages/motion-driver-natural/src/touch-gestures.ts` `NaturalTouchGestures`; `packages/stage-ui-mmd/src/composables/mmd/touch/touch.ts` `MMDTouch`; `packages/character-mind/src/touch.ts` `answerTouch`; `packages/character-mind/src/types.ts` `TouchReport`, `TouchReactionIntent`; `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` `StagePerformanceConductor` (`touch`); `packages/stage-ui/src/stores/situation/index.ts` `useSituationStore` (`observeTouch`, `speak`); `packages/stage-shared/src/expression-performance/touch-affect.ts` `touchAffect`; `packages/stage-shared/src/situation/reaction-policy.ts` `reactionPolicy`, `ReactionKind`; `packages/motion-driver-humanoid/src/performance/contracts.ts` `BodyReactionKind`.
**Not to be confused with:** a reaction episode (see Reaction), which comes from the character mind; and a desktop reaction.
**Avoid:** "touch response" for one part without naming it.

### Universal

The Live2D motion driver inherited from upstream: it plays the model's own motion groups, idle eye movement, and mouse tracking, and it answers a tap or a pat with upstream's touch reaction. The conductor sends it motion groups for emotions, as it does MAGIC.

**Code:** `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` `Live2DMotionDriver` (value `'universal'`).
**Not to be confused with:** classic, the MMD driver that plays clips without Natural.
**Avoid:** "default driver", "legacy driver".

### Voice policy

The part of the character mind that decides when she speaks unasked. It runs inside `step`, on the mind's clock and its seeded random source, under every driver. On each `voice-tick` from the situation store, and on a `voice-request`, it restores the gate memory of a new run, laying the run's user slice and her pacing from the slow state over a promotion, and evaluates the urge gate; a fire yields one `speak` intent with a `reach-out` line. It also rolls the spoken touch line, and it defers widget reactions: a `voice-request` waits until nobody is busy, then yields a `speak` with a `widget` line, and a deadline yields `drop` or `cancel`. A waiting request goes before a reach-out. A reach-out, a widget line, and a touch line share one open line, which stays open until its `voice-outcome`. A spoken touch line, a spoken widget line, and a user turn update the gate memory. After each step that changes it, the mind publishes the gate memory; the store keeps it as a read model and saves the user's slice, and the mind keeps her pacing in `MindState.slow`.

**Code:** `packages/character-mind/src/voice.ts` `answerVoiceTick`, `answerVoiceRequest`, `answerVoiceOutcome`, `answerUserTurn`, `nextVoiceWakeAt`, `WIDGET_START_WAIT_MS`, `WIDGET_DEADLINE_MARGIN_MS`; `packages/character-mind/src/types.ts` `MindVoiceState`, `VoiceView`, `VoiceLine`; port `packages/stage-ui/src/composables/performance/mind-voice.ts` `VoicePort`, `MindVoice`.
**Not to be confused with:** the urge gate's and the reaction policy's pure rules in `packages/stage-shared/src/situation`, which the voice policy calls; and the situation store, which ticks the policy and runs its lines.
**Avoid:** "voice", "TTS policy", "speech policy".

### Widget reaction

A spoken reaction that a plugin or widget asks for with a [Spark Notify](#spark-notify). It reaches the character mind as a `voice-request` stimulus, served only by the leader. The [voice policy](#voice-policy) holds it until she and the user are quiet, then yields a `speak` with a `widget` line, which runs as an unprompted turn on the `base.prompt.unprompted-widget` instruction; the model may decline with `<|SILENT|>`. A request that does not start within `WIDGET_START_WAIT_MS` is dropped, and a line not spoken by the caller's deadline is cancelled. The caller always gets a `ChatUnpromptedResult`, and the widget gets the spoken text or its fallback.

**Code:** `packages/stage-ui/src/stores/mods/api/context-bridge.ts` `useContextBridgeStore` (`performSparkNotifyReaction`); `packages/stage-ui/src/stores/situation/index.ts` `useSituationStore` (`requestVoice`, `cancel`, `drop`); `packages/character-mind/src/voice.ts` `answerVoiceRequest`; `packages/character-mind/src/types.ts` `VoiceRequest`.
**Not to be confused with:** a reach-out, which the gate fires; a touch reaction; and a notice turn, which speaks outside the mind.
**Avoid:** "forced turn", "forced reaction".

## Target terms

These terms name parts of the target design in the [character mind ADR](../adr/2026-11-17-character-mind-direction.md). No code implements them yet. When code lands, each entry moves into [Terms](#terms) with its defining path.

### Channel

One part of her output with a single owner: gaze, head and posture, face and expression slots, body (stance, clips, locomotion), and voice. The gaze channel's owner under Natural is Natural's gaze layer, whose [gaze arbiter](#gaze-arbiter) decides every glance.

**Not to be confused with:** a Live2D parameter or an MMD bone, several of which make up one channel.

### Performer (target)

The per-stage, renderer-side module (Live2D or MMD, under the Natural driver) that realises the mind's intents with continuous per-frame control and declares the capabilities it can realise. It may contain renderer deciders that act on intents and on the renderer's own world.

**Not to be confused with:** the current usages listed under [Conflicting usages](#conflicting-usages).

## Conflicting usages

- **Gate.** The [situational presence ADR](../adr/2026-10-19-situational-presence.md) describes an "opportunity gate" with `evaluateGate`, `promotionGateMemory`, and `visibilityRegainGateMemory`. That section is superseded: the code exports `evaluateUrgeGate`, `promotionUrgeMemory`, and `visibilityRegainUrgeMemory` from `packages/stage-shared/src/situation/urge-gate.ts`. Comments in `packages/stage-ui/src/stores/situation/index.ts`, `packages/stage-ui/src/stores/situation/sensors/notify.ts`, and `packages/stage-ui/src/features/situation/settings.ts` still say "opportunity gate", and `packages/stage-ui/src/stores/devtools/situation-observability.ts` keeps a devtools function named `evaluateGate` that asks the leader for the urge-gate evaluation.
- **Character state layers.** The [layered character state ADR](../adr/2026-11-03-layered-character-state.md) names four layers: moment, mood, temperament, relationship. The stored record `CharacterStateRecordV1` holds three; the moment layer is Natural's `NaturalMood`, which lives in `packages/motion-driver-natural` and is not part of the character state.
- **Mood.** `MoodState` in `packages/stage-shared/src/character-state/types.ts` (valence, energy, tension; hours) and `NaturalMood` in `packages/motion-driver-natural/src/mood.ts` (valence, arousal, tension; seconds) are different models under the same word.
- **Energy.** The mood axis `energy` (`MoodAxes`, `NaturalIdleDrive`) and `NaturalPerformanceEnergy` in `packages/motion-driver-natural/src/energy.ts` (mode-driven motion scales plus the user's energy setting) share the word but not the meaning.
- **Drive.** The [idle agency ADR](../adr/2026-11-12-idle-agency.md) gives `NaturalIdleDrive` eight fields, including a sleep permission the code no longer has. The code has six required fields and adds the optional `body`, `unreachable`, and `errands`. The producer type `IdleDrive` in `packages/stage-shared/src/character-state/types.ts` has only the first five.
- **Reaction.** `ReactionEpisode` (expression performance), `ReactionKind` (spoken touch reactions), and `BodyReactionKind` (MMD body response) are three unrelated meanings. Name the one you mean.
- **Performer.** The [expression performance ADR](../adr/2026-10-18-expression-performance.md) calls the Live2D expression store "the Live2D performer". The [whole-body performer ADR](../adr/2026-11-11-whole-body-performer.md) and the code use "performer" for the MMD body synthesizer (`createBodyPerformer`, `MMDBodyPerformer`), and the Live2D code names only `EmotionHoldPerformer`.
- **Clip.** MMD animation clips (`ClipKind`), speech clips (`SpeechClip`), audio playback clips (`PlaybackClip` in `packages/pipelines-audio/src/playback.ts`), and the internal timeline of an idle activity in `NaturalIdleActivities` all use "clip".
- **Live2D clip.** The Live2D code also says "clip" for the playback of an SDK motion group: `getClipOwnedIds` in `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` and `clipResidual` in `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts`. That is not the glossary Clip, which is an imported MMD animation.
- **Presence.** The ADR title "situational presence" names the whole feature, while the code's `PresenceState` is only the user's here, idle, away, or unknown reading. The presence bubble and the presence notice are separate UI features.
- **Host.** "Host" means the platform and desktop session in `HostCapabilities` (`HostId`), the Electron window mode in `StageHostMode`, and a settings-panel injection in `packages/stage-ui/src/components/scenarios/settings/model-settings/desktop-stage.ts` (`DesktopStageHost`).
- **Classic.** "Classic" names the MMD motion driver (`MMDMotionDriver` value `'classic'`), and the Stage host entry and the [full-screen stage ADR](../adr/2026-10-31-fullscreen-stage-and-locomotion.md) also call the `window` stage host "the classic window".
- **Gesture.** An MMD clip kind (`ClipKind` and `BodyActionKind` value `'gesture'`), Natural's emotion gestures (`GestureKind` in `packages/motion-driver-natural/src/emotions.ts`), and the gesture field of an ACT cue are three different things.
- **Presence bubble.** The [presence bubble ADR](../adr/2026-09-24-presence-bubble-in-canvas.md) describes an unread state shown after a turn ends with the chat window hidden. In the code, only the devtools override in `useSettingsPresenceBubble` sets `unreadCount`; the real state shows thinking only.
- **Overflow policy.** `OverflowPolicy` in `packages/stage-shared/src/stage-contract/compose.ts` (prompt segment budgets) and `OverflowPolicy` in `packages/pipelines-audio/src/managers/playback-manager.ts` (audio playback queueing) share a name.
- **Touch.** Two touch systems share the word. The fork's touch reaction (`NaturalTouchGestures`, pokes and pets) runs under Natural, and upstream's (`createLive2DTouchGestureTracker`, taps and pats) runs under Universal and MAGIC. A poke and a tap, and a pet and a pat, are the same pointer gestures under different names.
- **Expression.** The fork's Live2D expression store (`useExpressionStore`) and upstream's Live2D context expressions (`createLive2D` in `packages/stage-ui-live2d/src/contexts/live2d.ts`), which a card's avatar model enables, both apply expressions to one model. The glossary's expression performer is the fork's store.
- **Task.** A background task (`ChatSessionTask`) is a recipe run. A notebook task in `useCharacterNotebookStore` is a reminder with a due time. They are unrelated.
- **Notice and notify.** A notice is a stored chat message about finished background work. A Spark Notify is a protocol event that enters the situation. The host notice settings (`useHostNoticeSettings`) are about a third thing, the banner on missing host signals.
