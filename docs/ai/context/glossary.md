# Domain glossary

Verified against the code on 2026-11-16 (commit `ba3b4539f`). These definitions win over the ADRs, which record why the terms exist.

This file defines the domain terms that the client's code and documentation use for the character, her motion, and her presence on the desktop. It is for contributors and agents, not translators: `packages/i18n/glossary/terms.yaml` holds only user-visible, translatable terms (see "Glossary" in `packages/i18n/AGENTS.md`), and a term can appear in both files with different scope. Each definition describes the behavior of the code on this branch. When an ADR uses a term differently, the definition here wins, and the difference is listed under [Conflicting usages](#conflicting-usages).

Each entry names the defining path and its exported symbol. Symbols are cited by name, never by line number.

## Terms

### ACT and DELAY cues

Inline control markers that the model writes into a reply. `<|ACT {...}|>` carries an emotion, gesture, or expression for the stage to perform at the next matching speech timing event, and `<|DELAY n|>` pauses the stage and the speech track for at most 5 seconds. The chat runtime rewrites near-miss spellings such as `[ACT happy]` into real cues instead of speaking them, and a reply that holds only ACT cues and the decline marker `<|SILENT|>` is a wordless reply.

**Code:** `packages/pipelines-audio/src/llm-streaming-control/parsers/act.ts` `tokenAct`; `packages/pipelines-audio/src/llm-streaming-control/parsers/delay.ts` `tokenDelay`; `packages/stage-shared/src/stage-contract/index.ts` `STAGE_RUNTIME_CONFIG`.
**Not to be confused with:** the MOOD cue (`packages/stage-shared/src/character-state/cue.ts` `parseMoodCue`), which feeds the slow mood layer of the character state rather than the stage.
**Avoid:** "tags", "action tokens", "emotion tags".

### Body director

The pure function that decides what an MMD character's body does next: stance (stand, sit, settle), locomotion goals such as chasing the cursor, visiting, wandering and walking home, and which clip action plays. It takes the performance state, the idle report, the stage world, and action requests, and returns a `BodyIntent` plus memory for the next frame; it is the only part that decides what she does with her whole body.

**Code:** `packages/motion-driver-humanoid/src/director/index.ts` `decideBody`, `BodyDirectorInput`, `BodyDirectorMemory`; the MMD host wraps it in `packages/stage-ui-mmd/src/composables/mmd/stance.ts` `MMDStanceDirector`.
**Not to be confused with:** the performer, which turns the director's intent into bone channels and decides nothing.
**Avoid:** "body brain", "stance machine".

### Character state

The character's slow inner state for one character card, stored per card and hidden from the user except in devtools. The stored record holds three layers on their own clocks: mood (hours), temperament (days, a slow average of mood that becomes the mood baseline), and relationship (closeness, trust, familiarity, moved by discrete events). A `CharacterReading` derived from the record feeds the prompt, the face baseline, the idle drive, and the reach-out urge.

**Code:** `packages/stage-shared/src/character-state/types.ts` `CharacterStateRecordV1`, `CharacterReading`; `packages/stage-shared/src/character-state/reducer.ts` `advance`, `applyEvent`; `packages/stage-shared/src/character-state/reading.ts` `readCharacter`; store `packages/stage-ui/src/stores/character-state.ts` `useCharacterStateStore`.
**Not to be confused with:** the Natural mood (see Mood), the fast afterglow that the layered-state ADR calls the moment layer, and the performance state (`packages/stage-shared/src/performance-state/index.ts`), which is the stage's current mode such as idle, listening, or talking.
**Avoid:** "affect state", "emotion state", "personality state".

### Clip

An imported VMD animation for an MMD model, classified once at import by the bones it animates into a kind (`gesture`, `action`, `dance`, `stance`, or `unusable`) and a layer (`upper`, `full`, or `none`). A gesture plays over idle, sitting, and walking; an action or dance pre-empts locomotion through the body director. A "clip action" is a clip played on request from an ACT cue, the expression tool, or debug.

**Code:** `packages/motion-driver-humanoid/src/clip-meta/index.ts` `deriveClipMeta`, `ClipKind`, `ClipLayer`; `packages/motion-driver-humanoid/src/clip-mask/index.ts` `buildClipBoneMask`; `packages/stage-ui-mmd/src/composables/mmd/action-port.ts` `MMDActionPort`, `MMDActionClip`.
**Not to be confused with:** speech clips (`packages/core-agent/src/voice/output/response.ts` `SpeechClip`), which are spans of synthesized audio, and the timeline an idle activity plays inside Natural.
**Avoid:** "motion" for an imported clip ("motion" also names Live2D motion groups), "animation file".

### Combo

A user-defined expression that applies several catalog expressions together, each at its own strength, under one label and id prefixed `combo:`. It can carry emotion mappings and can be exposed to the model like any other expression.

**Code:** `packages/stage-shared/src/expression-performance/catalog.ts` `ComboDocumentSchema`, `ComboDocument`; `packages/stage-shared/src/expression-performance/combos.ts` `expandEntry`, `validateComboDocument`.
**Not to be confused with:** a reaction episode, which is one emotion at one intensity decided at run time.
**Avoid:** "preset", "expression group".

### Conductor

The stage-side class that feeds affect signals (ACT cues, speech timing, touch, devtools pulses) to the decider under the active character profile and dispatches its decisions: reaction episodes to Natural, slot commands to the expression performer, and motion groups to the Universal and MAGIC drivers. It also sends the face baseline and the idle drive to the scene and records affect traces.

**Code:** `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` `StagePerformanceConductor`, `useStagePerformanceConductor`.
**Not to be confused with:** the decider, which is pure and only decides; and the body director, which owns the MMD body.
**Avoid:** "performance manager", "orchestrator" (the chat orchestrator is a different module).

### Decider

A pure, checkpointable state machine that turns affect signals into a `PerformanceDecision`: reaction `episodes` for Natural and expression `slots` for the expression performer. Two kinds exist: the picker draws one expression per signal from weighted tickets with recency, and the planner extends the picker with planned holds and moments across a turn. The user's expression performance setting chooses the kind.

**Code:** `packages/stage-shared/src/expression-performance/types.ts` `Decider`, `DeciderContext`; `packages/stage-shared/src/expression-performance/deciders.ts` `createDecider`; `packages/stage-shared/src/expression-performance/picker.ts` `createPickerDecider`; `packages/stage-shared/src/expression-performance/planner.ts` `createPlannerDecider`.
**Not to be confused with:** the body director, which decides body behavior, not expressions; and `TurnPlanner` (`packages/motion-driver-humanoid/src/look-at/turn-planner.ts`), which plans head and body turns.
**Avoid:** "expression AI", "selector".

### Drive

The input that shapes Natural's idle behavior, set by the host from the slower character state and the desktop: slow mood energy, valence, and tension relative to her resting disposition, sleepiness by local hour, solitude since the last exchange, whether music is playing, whether she may sleep, a pace multiplier, and optionally whether the host performs a whole body, which whole-body kinds are unreachable, and which idle errands it can realize. Without a drive the idle activity layer is inert.

**Code:** `packages/motion-driver-natural/src/idle-activities.ts` `NaturalIdleDrive`, `idleActivityWeights`; producer `packages/stage-shared/src/character-state/idle.ts` `idleDriveOf`, which returns the five-field `IdleDrive` (`packages/stage-shared/src/character-state/types.ts`).
**Not to be confused with:** the motion driver (Natural, Universal, MAGIC, or classic), which is the setting that chooses the motion system.
**Avoid:** "idle state", "idle mood".

### Energy

On the character state, `energy` is one of the three mood axes (valence, energy, tension), from -1 (drained) to 1 (buzzing), bucketed for the prompt as drained, tired, steady, lively, or buzzing. Natural's idle drive carries the same axis relative to her resting disposition. Natural's `NaturalPerformanceEnergy` is a different thing: the cross-faded amplitude, shift-rate, and camera-fixation scales that posture and gaze read for the current performance mode and the user's energy setting.

**Code:** `packages/stage-shared/src/character-state/types.ts` `MoodAxes`, `EnergyBucket`; `packages/motion-driver-natural/src/energy.ts` `NaturalPerformanceEnergy`.
**Not to be confused with:** gesture gain and tempo in `packages/motion-driver-humanoid/src/performance/gesture-forms.ts` (`gestureGain`, `gestureTempo`), which take an energy argument from the performer's input.
**Avoid:** "arousal" for the character-state axis (Natural's mood uses `arousal`; see Mood).

### Expression performance

The system that decides and plays expressions in response to affect: the expression catalog (per-model expressions, custom expressions, and combos with emotion mappings), the deciders, the scheduler of slot commands and holds, character profiles that scale intensity, and affect traces for replay. Its pure core lives in `stage-shared`; the conductor runs it, and each renderer's expression store executes its slot commands.

**Code:** `packages/stage-shared/src/expression-performance/index.ts` (module barrel); `packages/stage-shared/src/expression-performance/settings.ts` `ExpressionPerformanceSettingsSchema`; `packages/stage-shared/src/expression-performance/catalog.ts` `ExpressionKindSchema`.
**Not to be confused with:** the performance state (the stage's current mode) and the whole-body performer for MMD.
**Avoid:** "emotion system", "expression engine".

### Gate

A pure check that decides whether the character may speak unprompted now. The hard gate (`hardReason`) holds for suppressors such as do-not-disturb, a hidden stage, an away or unknown presence, stale signals, the user speaking or typing, generation in progress, or a quiet app. The urge gate integrates a hazard over elapsed time, fires when the urge crosses a drawn threshold, picks a reason, and tracks social memory: unanswered messages, damping, double texts, the ritual day, and the last own-day turn. The reaction policy is a separate gate for spoken touch reactions. "Reach-out gate" in comments means the urge gate together with the hard gate.

**Code:** `packages/stage-shared/src/situation/gate.ts` `hardReason`, `GateHardReason`, `GateOutcome`; `packages/stage-shared/src/situation/urge-gate.ts` `evaluateUrgeGate`, `UrgeGateMemory`, `UrgeGateDecision`; hazard math in `packages/stage-shared/src/situation/urge.ts` `accrue`, `drawThreshold`; run by `packages/stage-ui/src/stores/situation/index.ts` `useSituationStore` every `GATE_INTERVAL_MS`.
**Not to be confused with:** the CPU slot gate and the verify gate in QA tooling, which are unrelated; and the reaction policy (see Reaction).
**Avoid:** "opportunity gate" (the superseded design; see Conflicting usages), "cooldown".

### Host capability

What the running desktop host can actually report for each presence signal (for example foreground window, idle time, screen cursor, system audio), each resolved as `live`, `degraded`, or `unavailable` with a reason, from facts about the platform, the Wayland session, and runtime failures. Consumers read the resolved capabilities instead of assuming a platform; only a `live` cursor reading is trusted.

**Code:** `packages/stage-shared/src/host-capabilities/index.ts` `HostCapabilities`, `resolveHostCapabilities`, `acceptCursorReading`; producer `apps/stage-tamagotchi/src/main/services/electron/host-capabilities.ts` `getCurrentHostCapabilities`; store `packages/stage-shared/src/stores/host-capabilities.ts` `useHostCapabilitiesStore`.
**Not to be confused with:** the stage host (window or desktop), which is where the character is drawn; and plugin host capabilities (`packages/stage-ui/src/stores/plugin-host-capabilities.ts`), which describe what plugins may call.
**Avoid:** "platform support", "feature flags".

### Idle activity

Something the character does on her own while nobody asks anything of her, drawn by Natural's idle layer from the drive: stretch, yawn, look around, check in, peer, zone out, nod off, sway, and, on a whole-body host, sigh, shoulder roll, stance shift, clasped hands, hair touch, heel rock, and arm swing. Sleep is an activity entered by rule while the user is away, never drawn. The layer also plays two idle cues around a reach-out: `about-to-speak` and `let-go`.

**Code:** `packages/motion-driver-natural/src/idle-activities.ts` `NaturalIdleActivities`, `IdleActivityKind`, `IdleCueKind`, `IdleBehaviourKind`.
**Not to be confused with:** an idle errand, which the host realizes in full; and Live2D idle motions under the Universal driver, which are model motion groups.
**Avoid:** "idle animation" (the Universal driver's setting), "idle behavior" for activities alone (`IdleBehaviourKind` also includes the cues).

### Idle errand

A long idle behavior that Natural's idle draw only decides and records, and that the host realizes in its own form: a `pastime` with one of her props (Live2D), an `idle-clip` she plays unasked (MMD, only clips the user allowed for idle), or a `wander` along the ground (MMD roam mode). The host answers whether it took the errand, and each errand is paced by its own mean gap and refractory time.

**Code:** `packages/motion-driver-natural/src/idle-errands.ts` `IDLE_ERRAND_KINDS`, `IdleErrandKind`, `IDLE_ERRAND_PACING`, `IdleErrandReports`.
**Not to be confused with:** an idle activity, which Natural plays itself.
**Avoid:** "idle task", "idle job".

### Leader and follower windows

Each Electron renderer runs synced Pinia stores. The leader window owns synced actions: it writes persistent storage, runs chat turns, and holds the situation and the gate. Follower windows replicate state from it and route actions to it. Main sets the role through the `synced-leader` query: the main window and the desktop stage window get `true`, and every other window (settings, chat, caption, devtools, widgets) gets `false`.

**Code:** `apps/stage-tamagotchi/src/main/windows/main/query.ts` `mainWindowQuery`; `apps/stage-tamagotchi/src/renderer/window-context.ts` `resolveRendererWindowContext`; `packages/stage-ui/src/libs/pinia/setup-synced.ts` `setupSynced`, `LeadershipMode`.
**Not to be confused with:** the arm "followers" of the body performer (`packages/motion-driver-humanoid/src/performance/gestures.ts` `followerInverse`), which are lagging joints.
**Avoid:** "main window" as a synonym for the leader (the desktop stage window can lead), "master and slave".

### MAGIC

Markovian Animation Generator with Illusory Conditioning: a Live2D motion driver that fits a VAR or AR-HMM model to a bundled motion dataset and generates seeded parameter frames. The user picks a MAGIC profile, which selects the dataset.

**Code:** `packages/motion-driver-magic/src/fit.ts` `fit`, `MagicModel`; `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` `Live2DMotionDriver`.
**Not to be confused with:** Natural, which is procedural and rule-based rather than fitted to data.
**Avoid:** "Magic" in prose (write it in capitals), "AI motion".

### Mood

Two codes use this word. The character-state mood is the slow layer: three axes (valence, energy, tension) built from contributions (model MOOD cues, touch, unanswered reach-outs, replies, returns, significant exchanges, rituals) that decay over hours toward the temperament baseline. Natural's mood is a fast afterglow of reaction episodes (valence, arousal, tension) that decays in seconds of active time and modulates Natural's motion scales.

**Code:** `packages/stage-shared/src/character-state/types.ts` `MoodState`, `MoodAxes`, `MoodSource`; `packages/stage-shared/src/character-state/mood.ts` `pruneMood`; `packages/motion-driver-natural/src/mood.ts` `NaturalMood`; `packages/motion-driver-natural/src/mood-modulation.ts` `modulateByMood`.
**Not to be confused with:** temperament, the days-long average that sets the mood baseline; and the performance state's mode.
**Avoid:** "emotion" for the slow layer (an emotion is one `PerformanceEmotion` of an episode).

### Natural

The procedural motion driver for Live2D and MMD characters. `NaturalMotion` owns autonomous posture, gaze, body, face, blink, breath, idle activities, and touch responses without model or renderer state, and each host adapts its output to parameters or bones. On MMD, Natural's output is intent that the body performer turns into a whole-body pose.

**Code:** `packages/motion-driver-natural/src/natural-motion.ts` `NaturalMotion`; driver choices `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` `Live2DMotionDriver` and `packages/stage-ui-mmd/src/stores/mmd.ts` `MMDMotionDriver`.
**Not to be confused with:** Universal and MAGIC (Live2D only) and classic (MMD only), the other motion drivers.
**Avoid:** "natural motion v2", "procedural mode".

### Own-day reach-out

An unprompted turn whose reason is something from her own day, improvised when the turn is considered rather than stored. Its selection weight recovers after each use, and the urge gate stamps `lastOwnDayAtMs` when one is spoken. When the idle layer reports what she was doing, the reason text names it.

**Code:** `packages/stage-shared/src/situation/reasons/collect.ts` (reason kind `'own-day'`); `packages/stage-shared/src/situation/reasons/types.ts` `REASON_TEXT`; `packages/stage-shared/src/situation/urge-gate.ts` `recordUrgeFireOutcome`, `SavedGateMemory`.
**Not to be confused with:** a ritual reach-out (greetings tied to the logical day) and a thread continuation.
**Avoid:** "diary", "daily story".

### Performer

The part that executes decisions without making them. On MMD, the whole-body performer is a pure kinematic synthesizer that turns Natural's intent, gaze goals, the director's stance, the gait, and clip ownership into bone channels each 120 Hz tick, and `MMDBodyPerformer` writes those channels to the model's bones. On Live2D, the expression performer is the Live2D expression store with its hold performer, which applies slot commands and emotion holds.

**Code:** `packages/motion-driver-humanoid/src/performance/index.ts` `createBodyPerformer`; `packages/stage-ui-mmd/src/composables/mmd/body/performer.ts` `MMDBodyPerformer`; `packages/stage-ui-live2d/src/composables/live2d/expression/hold.ts` `EmotionHoldPerformer`; tool-facing view `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` `ExpressionToolPerformer`.
**Not to be confused with:** the conductor, which dispatches; the decider, which decides expressions; and the body director, which decides body behavior.
**Avoid:** "renderer" for a performer (the renderer draws the model).

### Presence

Whether the user is at the desktop, as the situation reads it: `here`, `idle` (no input for 60 s), `away` (300 s, or the screen is locked or the system suspended), or `unknown` (the desktop sample is missing or older than 5 s). Idle time counts from the later of the last desktop input and the user's last turn.

**Code:** `packages/stage-shared/src/situation/types.ts` `PresenceState`, `SituationPresence`.
**Not to be confused with:** "situational presence", the feature name in the ADR for the whole situation-to-reach-out pipeline; the presence bubble (`packages/stage-shared/src/presence-bubble/content.ts` `resolvePresenceBubbleContent`), which shows thinking and unread state beside the character; and the presence notice (`apps/stage-tamagotchi/src/renderer/composables/use-presence-notice.ts` `usePresenceNotice`), which tells the user which signals this host lacks.
**Avoid:** "online status", "AFK".

### Reach-out

An unprompted turn: a chat turn that the character starts on her own when the gate fires, with a reason (a situation topic, a thread continuation, a ritual, an own-day thought, a double text, or an urgent event) and an instruction that always offers the decline marker. The model can decline with `<|SILENT|>` or answer with only a look. Only one unprompted turn is pending at a time, and user messages bypass the gate.

**Code:** `packages/stage-ui/src/stores/chat.ts` `useChatStore` (action `submitUnprompted`), `ChatUnpromptedPayload`, `ChatUnpromptedResult`; decided by `packages/stage-shared/src/situation/urge-gate.ts` `evaluateUrgeGate`.
**Not to be confused with:** a spoken reaction to touch (see Reaction), which goes through `submitReaction` and its own policy; and a forced turn from devtools, which skips the urge.
**Avoid:** "proactive message", "ping", "nudge".

### Reaction

Three codes use this word. An expression reaction episode is one decided emotion at a nominal intensity and band, the unit the decider sends to Natural and the expression performer. A spoken touch reaction is a short line after a long pet (`pet-soft`) or a poke burst (`poke-protest`), allowed by its own reaction policy and submitted through `submitReaction`. A body reaction is the MMD performer's physical response to a poke, pet, or drag.

**Code:** `packages/stage-shared/src/expression-performance/types.ts` `ReactionEpisode`; `packages/stage-shared/src/expression-performance/reaction-strength.ts` `acceptReaction`; `packages/stage-shared/src/situation/reaction-policy.ts` `ReactionKind`, `settleReaction`; `packages/motion-driver-humanoid/src/performance/contracts.ts` `BodyReactionKind`.
**Not to be confused with:** Spark Notify reactions (`packages/core-agent/src/agents/spark-notify/plugins/reaction.ts` `createSparkNotifyReactionPlugin`), which are the notify agent's output, and chat message reactions (`packages/stage-ui/src/stores/chat.ts` `ChatReactionPayload`).
**Avoid:** "response" for any of the three.

### Reply shape

The stage-contract rules for what a reply looks like: spoken and short unless the content or the user asks for more, from a person rather than an assistant (no offers of help, recaps, or check-ins), with at most one question that she wants answered, and allowed to be only an ACT cue plus `<|SILENT|>`. A token cap per request backs the rules.

**Code:** `packages/stage-shared/src/stage-contract/index.ts` `STAGE_CONTRACT_KEYS` (key `response`, the locale string `base.prompt.response`), `REPLY_MAX_TOKENS`.
**Not to be confused with:** the register section of the character prompt, which decides whether she talks or texts.
**Avoid:** "response format", "output style".

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

A `spark:notify` protocol event from a plugin or the server channel that tells the character something happened, and the agent that handles it. The client folds each notify into the leader's situation as an observation, so the gate decides whether she speaks about it, and the character orchestrator runs a Spark Notify agent turn that can emit `spark:command` events and reactions.

**Code:** `packages/stage-ui/src/stores/situation/sensors/notify.ts` `ingestSparkNotify`; `packages/core-agent/src/agents/spark-notify/agent.ts` `createSparkNotifyAgent`; used in `packages/stage-ui/src/stores/character/orchestrator/store.ts`.
**Not to be confused with:** Spark Command (`packages/core-agent/src/agents/spark-command/tools.ts` `createSparkCommandTool`), the outgoing command tool.
**Avoid:** "push notification", "spark event" without naming notify or command.

### Stage contract

The register-neutral part of the system prompt that tells the model how to drive the stage: the ACT cue syntax and emotion list, the MOOD cue, the emoji restriction, and the reply shape. It renders without reading locale or application state and composes after the formatting rules and the character card.

**Code:** `packages/stage-shared/src/stage-contract/index.ts` `renderStageContract`, `stageContractEmotions`, `composeSystemPrompt`; segment order `packages/stage-shared/src/stage-contract/compose.ts` `PROMPT_SEGMENT_ORDER`; wired by `packages/stage-ui/src/composables/use-airi-runtime-prompt.ts` `useStageContractPrompt`.
**Not to be confused with:** the host capability contract, which is about desktop signals; and the cue contract fixtures in `packages/core-agent` (`CUE_CONTRACT_FIXTURES`), which test the parser.
**Avoid:** "system prompt" for the contract alone.

### Stage host

The Electron window that hosts the character. `window` is the classic 450x600 window. `desktop` is the full-screen, click-through desktop stage on the home display, where an MMD character can walk; it is off by default behind the Experimental 3D stage setting, and a saved mode applies at the next launch. `AIRI_STAGE_HOST=window|desktop` overrides the saved mode in development builds only.

**Code:** `apps/stage-tamagotchi/src/shared/eventa/index.ts` `StageHostMode`, `StageHostState`; `apps/stage-tamagotchi/src/main/windows/stage/config.ts` `buildStageHostState`; `apps/stage-tamagotchi/src/renderer/composables/use-stage-host-wiring.ts` `useStageHostWiring`.
**Not to be confused with:** the host in host capabilities (the platform and desktop session), and the Godot VRM stage sidecar (`engines/stage-tamagotchi-godot`, launched from `apps/stage-tamagotchi/src/main/services/airi/godot-stage`), which renders VRM models in a separate process.
**Avoid:** "overlay mode", "fullscreen mode", "Kirie" (a removed Godot/CEF host app).

### Synced settings document

The persistence tier for one feature's user-facing settings: one Valibot-validated document in a synced Pinia store, persisted privately to localStorage, whose `update` and `reset` actions are leader-routed so followers never write storage. Each stored field is validated on its own, so an invalid field falls back to its default while valid siblings survive.

**Code:** `packages/stage-shared/src/composables/use-settings-document/index.ts` `useSettingsDocument`, `SettingsDocument`; examples `packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts` `Live2DNaturalSettings` and `packages/stage-ui-mmd/src/stores/natural-settings.ts` `MMDNaturalSettings`.
**Not to be confused with:** synced Pinia memory (runtime state replicated but not persisted) and plain `useLocalStorageManualReset` refs, a tier closed to new state.
**Avoid:** "settings store" for the document (a store may hold other state too).

### Universal

The Live2D motion driver inherited from upstream: it plays the model's own motion groups, idle eye movement, and mouse tracking. The conductor sends it motion groups for emotions, as it does MAGIC.

**Code:** `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` `Live2DMotionDriver` (value `'universal'`).
**Not to be confused with:** classic, the MMD driver that plays clips without Natural.
**Avoid:** "default driver", "legacy driver".

## Conflicting usages

- **Gate.** The [situational presence ADR](../adr/2026-10-19-situational-presence.md) describes an "opportunity gate" with `evaluateGate`, `promotionGateMemory`, and `visibilityRegainGateMemory`. That section is superseded: the code exports `evaluateUrgeGate`, `promotionUrgeMemory`, and `visibilityRegainUrgeMemory` from `packages/stage-shared/src/situation/urge-gate.ts`. Comments in `packages/stage-ui/src/stores/situation/index.ts`, `packages/stage-ui/src/stores/situation/sensors/notify.ts`, and `packages/stage-ui/src/features/situation/settings.ts` still say "opportunity gate", and `packages/stage-ui/src/stores/devtools/situation-observability.ts` keeps a devtools function named `evaluateGate` that asks the leader for the urge-gate evaluation.
- **Character state layers.** The [layered character state ADR](../adr/2026-11-03-layered-character-state.md) names four layers: moment, mood, temperament, relationship. The stored record `CharacterStateRecordV1` holds three; the moment layer is Natural's `NaturalMood`, which lives in `packages/motion-driver-natural` and is not part of the character state.
- **Mood.** `MoodState` in `packages/stage-shared/src/character-state/types.ts` (valence, energy, tension; hours) and `NaturalMood` in `packages/motion-driver-natural/src/mood.ts` (valence, arousal, tension; seconds) are different models under the same word.
- **Energy.** The mood axis `energy` (`MoodAxes`, `NaturalIdleDrive`) and `NaturalPerformanceEnergy` in `packages/motion-driver-natural/src/energy.ts` (mode-driven motion scales plus the user's energy setting) share the word but not the meaning.
- **Drive.** The [idle agency ADR](../adr/2026-11-12-idle-agency.md) gives `NaturalIdleDrive` eight fields. The code adds the optional `body`, `unreachable`, and `errands`. The producer type `IdleDrive` in `packages/stage-shared/src/character-state/types.ts` has only the first five.
- **Reaction.** `ReactionEpisode` (expression performance), `ReactionKind` (spoken touch reactions), and `BodyReactionKind` (MMD body response) are three unrelated meanings. Name the one you mean.
- **Performer.** The [expression performance ADR](../adr/2026-10-18-expression-performance.md) calls the Live2D expression store "the Live2D performer". The [whole-body performer ADR](../adr/2026-11-11-whole-body-performer.md) and the code use "performer" for the MMD body synthesizer (`createBodyPerformer`, `MMDBodyPerformer`), and the Live2D code names only `EmotionHoldPerformer`.
- **Clip.** MMD animation clips (`ClipKind`), speech clips (`SpeechClip`), audio playback clips (`PlaybackClip` in `packages/pipelines-audio/src/playback.ts`), and the internal timeline of an idle activity in `NaturalIdleActivities` all use "clip".
- **Presence.** The ADR title "situational presence" names the whole feature, while the code's `PresenceState` is only the user's here, idle, away, or unknown reading. The presence bubble and the presence notice are separate UI features.
- **Host.** "Host" means the platform and desktop session in `HostCapabilities` (`HostId`), the Electron window mode in `StageHostMode`, and a settings-panel injection in `packages/stage-ui/src/components/scenarios/settings/model-settings/desktop-stage.ts` (`DesktopStageHost`).
