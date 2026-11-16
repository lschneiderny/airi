# Domain glossary

Verified against the code on 2026-11-16 (commit `1976c952b`). These definitions win over the ADRs, which record why the terms exist.

This file defines the domain terms that the client's code and documentation use for the character, her motion, and her presence on the desktop. It is for contributors and agents, not translators: `packages/i18n/glossary/terms.yaml` holds only user-visible, translatable terms (see "Glossary" in `packages/i18n/AGENTS.md`), and a term can appear in both files with different scope. Each definition describes the behavior of the code on this branch. When an ADR uses a term differently, the definition here wins, and the difference is listed under [Conflicting usages](#conflicting-usages).

Each entry names the defining path and its exported symbol. Symbols are cited by name, never by line number.

## Terms

### ACT and DELAY cues

Inline control markers that the model writes into a reply. `<|ACT {...}|>` carries an emotion, gesture, or expression for the stage to perform at the next matching speech timing event, and `<|DELAY n|>` pauses the stage and the speech track for at most 5 seconds. The chat runtime rewrites near-miss spellings such as `[ACT happy]` into real cues instead of speaking them, and a reply that holds only ACT cues and the decline marker `<|SILENT|>` is a wordless reply.

**Code:** `packages/pipelines-audio/src/llm-streaming-control/parsers/act.ts` `tokenAct`; `packages/pipelines-audio/src/llm-streaming-control/parsers/delay.ts` `tokenDelay`; `packages/stage-shared/src/stage-contract/index.ts` `STAGE_RUNTIME_CONFIG`.
**Not to be confused with:** the MOOD cue (`packages/stage-shared/src/character-state/cue.ts` `parseMoodCue`), which feeds the slow mood layer of the character state rather than the stage.
**Avoid:** "tags", "action tokens", "emotion tags".

### Beat sync

A Live2D head dance to music. An audio detector reports beats, and a controller springs the head angles (`ParamAngleX`, `ParamAngleY`, `ParamAngleZ`) toward per-beat targets in one of four styles (`punchy-v`, `balanced-v`, `swing-lr`, `sway-sine`), and it releases the head after the beats stop. The user starts and stops it from the beat sync settings page; nothing starts it on its own, and it runs under every Live2D motion driver.

**Code:** `packages/stage-shared/src/beat-sync/detector.ts` `createBeatSyncDetector`, `listenBeatSyncBeatSignal`; `packages/stage-ui-live2d/src/composables/live2d/beat-sync.ts` `createBeatSyncController`, `BeatSyncStyleName`; `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginBeatSync`; stored parameters `packages/stage-ui/src/stores/settings/beat-sync.ts` `useSettingsBeatSync`.
**Not to be confused with:** the `music` field of Natural's idle drive, which only weights the sway idle activity; and the sway emotion gesture.
**Avoid:** "dance mode", "music sync" ("dance" also names an MMD clip kind).

### Body director

The pure function that decides what an MMD character's body does next: stance (stand, sit, settle), locomotion goals such as chasing the cursor, visiting, wandering and walking home, and which clip action plays. It takes the performance state, the idle report, the stage world, and action requests, and returns a `BodyIntent` plus memory for the next frame; it is the only part that decides what she does with her whole body.

**Code:** `packages/motion-driver-humanoid/src/director/index.ts` `decideBody`, `BodyDirectorInput`, `BodyDirectorMemory`; the MMD host wraps it in `packages/stage-ui-mmd/src/composables/mmd/stance.ts` `MMDStanceDirector`.
**Not to be confused with:** the performer, which turns the director's intent into bone channels and decides nothing.
**Avoid:** "body brain", "stance machine".

### Character context

The short `system:character` text rendered from the character state's reading. It is empty at rest; otherwise it holds at most two lines: a `Feeling:` line with mood words and reasons when her mood is off rest or a reason renders, and a `You two:` line that names the relationship stage. The runtime attaches it to the last user turn as runtime context, not to the system prompt.

**Code:** `packages/stage-shared/src/character-state/render.ts` `renderCharacterContext`, `characterRenderKey`; attached through the runtime context providers of `packages/stage-ui/src/stores/chat.ts` `useChatStore`.
**Not to be confused with:** the character state itself, which is the stored record; the situation block, which rides beside it on the same turn; and the character card's system prompt.
**Avoid:** "mood prompt", "character prompt".

### Character state

The character's slow inner state for one character card, stored per card and hidden from the user except in devtools. The stored record holds three layers on their own clocks: mood (hours), temperament (days, a slow average of mood that becomes the mood baseline), and relationship (closeness, trust, familiarity, moved by discrete events). A `CharacterReading` derived from the record feeds the prompt, the face baseline, the idle drive, and the reach-out urge.

**Code:** `packages/stage-shared/src/character-state/types.ts` `CharacterStateRecordV1`, `CharacterReading`; `packages/stage-shared/src/character-state/reducer.ts` `advance`, `applyEvent`; `packages/stage-shared/src/character-state/reading.ts` `readCharacter`; store `packages/stage-ui/src/stores/character-state.ts` `useCharacterStateStore`.
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

The stage-side class that feeds affect signals (ACT cues, speech timing, touch, devtools pulses) to the decider under the active character profile and dispatches its decisions: reaction episodes to Natural, slot commands to the expression performer, and motion groups to the Universal and MAGIC drivers. It also sends the face baseline and the idle drive to the scene and records affect traces.

**Code:** `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` `StagePerformanceConductor`, `useStagePerformanceConductor`.
**Not to be confused with:** the decider, which is pure and only decides; and the body director, which owns the MMD body.
**Avoid:** "performance manager", "orchestrator" (the chat orchestrator is a different module).

### Conversation register

Whether she talks or texts with the user: `talking`, the spoken default, or `texting` with a flavor (`plain` or `discord`). The register renders a character-prompt section from fixed locale keys, which is the `register` prompt segment, and the texting register allows a closed set of ASCII faces that speech never reads.

**Code:** `packages/stage-shared/src/conversation-register/index.ts` `CONVERSATION_REGISTERS`, `ConversationRegister`, `renderRegisterSection`, `ASCII_FACES`; setting `packages/stage-ui/src/features/conversation/settings.ts` `useConversationSettings`.
**Not to be confused with:** the reply shape of the stage contract, which applies in both registers.
**Avoid:** "chat mode", "tone".

### Cursor attention

Natural's response to the mouse cursor near her face. Interest rises with distance-weighted engagement; when it crosses `noticeLevel` she notices the cursor, orients her gaze to it, and later releases or dismisses it. Interest spans and cooldowns are drawn per episode from a separate seeded stream. Permission drops to dismiss while the setting is off or her attention is `aside` or `screen`.

**Code:** `packages/motion-driver-natural/src/cursor-attention.ts` `NaturalCursorAttention`, `noticeLevel`, `interestSpan`; Live2D setting `packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts` `useLive2DNaturalSettings` (`cursorAttention`).
**Not to be confused with:** the body director's cursor chase on MMD (see Locomotion), which walks her toward the cursor; Universal's eye tracking, which follows the mouse without episodes; and the screen-cursor host capability, which says whether a cursor reading can be trusted.
**Avoid:** "mouse tracking", "cursor follow".

### Decider

A pure, checkpointable state machine that turns affect signals into a `PerformanceDecision`: reaction `episodes` for Natural and expression `slots` for the expression performer. Two kinds exist: the picker draws one expression per signal from weighted tickets with recency, and the planner extends the picker with planned holds and moments across a turn. The user's expression performance setting chooses the kind.

**Code:** `packages/stage-shared/src/expression-performance/types.ts` `Decider`, `DeciderContext`; `packages/stage-shared/src/expression-performance/deciders.ts` `createDecider`; `packages/stage-shared/src/expression-performance/picker.ts` `createPickerDecider`; `packages/stage-shared/src/expression-performance/planner.ts` `createPlannerDecider`.
**Not to be confused with:** the body director, which decides body behavior, not expressions; and the turn planner (`packages/motion-driver-humanoid/src/look-at/turn-planner.ts` `createTurnPlanner`), which plans head and body turns.
**Avoid:** "expression AI", "selector".

### Desktop reaction

A brief Natural response to a desktop event, which the performance state resolves as `reactKind` with a sequence number. `wake` fires when the desktop unlocks or resumes: a camera glance and nudge that also rouses her from idle sleep. `screen-change` fires when the screen content changes sharply: a glance at the screen, at most once every 10 s.

**Code:** `packages/stage-shared/src/performance-state/index.ts` `PerformanceReactKind`, `resolvePerformanceState`; performed by `packages/motion-driver-natural/src/pending-actions.ts` `startPending`.
**Not to be confused with:** a reaction episode from the decider; a touch reaction; and the `welcome-back` moment expression or ritual reach-out that the same return can start.
**Avoid:** "wake event" for both kinds, "screen reaction".

### Drive

The input that shapes Natural's idle behavior, set by the host from the slower character state and the desktop: slow mood energy, valence, and tension relative to her resting disposition, sleepiness by local hour, solitude since the last exchange, whether music is playing, whether she may sleep, a pace multiplier, and optionally whether the host performs a whole body, which whole-body kinds are unreachable, and which idle errands it can realize. Without a drive the idle activity layer is inert.

**Code:** `packages/motion-driver-natural/src/idle-activities.ts` `NaturalIdleDrive`, `idleActivityWeights`; producer `packages/stage-shared/src/character-state/idle.ts` `idleDriveOf`, which returns the five-field `IdleDrive` (`packages/stage-shared/src/character-state/types.ts`).
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

### Lipsync

The mouth writer during speech. On Live2D a final-stage plugin writes `ParamMouthOpenY` absolutely while she speaks, blends back to the motion value over a 200 ms release, holds 0 for a 500 ms handoff, and reports ownership every frame so Natural masks its mouth write. On MMD the `lip-sync` stage writes vowel and mouth morphs on the `lipSync` morph layer, above expressions.

**Code:** `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginLipSync`; `packages/stage-ui-live2d/src/composables/live2d/lipsync-handoff.ts` `lipSyncReleaseMs`, `lipSyncHandoffHoldMs`; `packages/stage-ui-mmd/src/composables/mmd/lip-sync.ts` `useMMDLipSync`.
**Not to be confused with:** Natural's silent mouth (`silentMouthOpen`), which moves the mouth only outside speech.
**Avoid:** "lip sync" and "lip-sync" in prose (the code says `lipSync`), "mouth flap".

### Locomotion

An MMD character walking across the desktop stage. The body director picks a ground goal and a pace with a reason (`approach-chat`, `tool`, `debug`, `approach-cursor`, `return-home`, `enter-stage`, `wander`, or `visit`) in its `BodyIntent`, and the scene runs a deterministic procedural gait toward the goal that moves the root, pelvis, and feet. It needs the desktop stage host; under the window host the root never moves.

**Code:** `packages/motion-driver-humanoid/src/director/index.ts` `decideBody`, `CHASE_WINDOW_MS`, `RETURN_HOME_DELAY_MS`; `packages/motion-driver-humanoid/src/types/index.ts` `BodyIntent` (`locomotion`); `packages/motion-driver-humanoid/src/locomotion/index.ts` `createLocomotion`; `packages/stage-ui-mmd/src/composables/mmd/body/locomotion.ts` `MMDLocomotion`.
**Not to be confused with:** the `wander` idle errand, which only asks the director for a wander goal; and roam mode, the MMD setting that allows wanders and visits.
**Avoid:** "movement", "pathing", or "roaming" for locomotion as a whole.

### Long-term memory

Facts the character keeps across sessions. Each entry has an index line and a body and belongs to one character card or, without an owner, to every card; the entries live in IndexedDB. The model reads, writes, and forgets entries through memory tools, and an unprompted turn carries only the read tool. The card's index lines form the `memory` prompt segment. Any window may write, and a write invalidates the other windows over a BroadcastChannel.

**Code:** `packages/stage-ui/src/types/memory.ts` `MemoryEntry`; `packages/stage-ui/src/stores/memory.ts` `useMemoryStore`; `packages/stage-ui/src/database/repos/memory.repo.ts` `memoryRepo`; `packages/stage-ui/src/tools/memory.ts` `READ_MEMORY_TOOL_NAME`, `WRITE_MEMORY_TOOL_NAME`, `FORGET_MEMORY_TOOL_NAME`, `composeMemoryHeader`.
**Not to be confused with:** the character state, which holds mood and relationship rather than facts; and the gate's inner state (`packages/stage-ui/src/features/situation/inner-state.ts` `useSituationInnerState`), which holds urge-gate memory and conversation threads.
**Avoid:** "knowledge base", "RAG", and "memory" alone where the gate's memory could be meant.

### MAGIC

Markovian Animation Generator with Illusory Conditioning: a Live2D motion driver that fits a VAR or AR-HMM model to a bundled motion dataset and generates seeded parameter frames. The user picks a MAGIC profile, which selects the dataset.

**Code:** `packages/motion-driver-magic/src/fit.ts` `fit`, `MagicModel`; `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` `Live2DMotionDriver`.
**Not to be confused with:** Natural, which is procedural and rule-based rather than fitted to data.
**Avoid:** "Magic" in prose (write it in capitals), "AI motion".

### Moment expression

An expression entry that the user tagged for a moment lasting seconds (`welcome-back`, `check-in`, `held-back`, `waking`, `petted`, `poked`, `yawning`, `zoning-out`, `peering`). She shows it as an idle claim for some of those moments: with a 0.6 chance, at most once per entry every 60 s, and for the time in `MOMENT_HOLD_MS` or the length of the idle act, capped at 20 s. Only the Live2D expression store shows moments.

**Code:** `packages/stage-shared/src/expression-performance/moments.ts` `MomentSchema`, `Moment`, `MOMENT_SETTINGS`, `MOMENT_HOLD_MS`, `chooseMomentEntry`; run by `packages/stage-ui/src/composables/performance/use-idle-props.ts` `useIdleProps`.
**Not to be confused with:** a pastime, which is an idle errand gated by occasions that last minutes; and a reaction episode, which the decider picks by emotion.
**Avoid:** "reaction expression", and "moment" alone for the expression.

### Mood

Two codes use this word. The character-state mood is the slow layer: three axes (valence, energy, tension) built from contributions (model MOOD cues, touch, unanswered reach-outs, replies, returns, significant exchanges, rituals) that decay over hours toward the temperament baseline. Natural's mood is a fast afterglow of reaction episodes (valence, arousal, tension) that decays in seconds of active time and modulates Natural's motion scales.

**Code:** `packages/stage-shared/src/character-state/types.ts` `MoodState`, `MoodAxes`, `MoodSource`; `packages/stage-shared/src/character-state/mood.ts` `pruneMood`; `packages/motion-driver-natural/src/mood.ts` `NaturalMood`; `packages/motion-driver-natural/src/mood-modulation.ts` `modulateByMood`.
**Not to be confused with:** temperament, the days-long average that sets the mood baseline; and the performance state's mode.
**Avoid:** "emotion" for the slow layer (an emotion is one `PerformanceEmotion` of an episode).

### Motion driver

The setting that chooses which motion system moves a model. Live2D has Natural, Universal, and MAGIC; MMD has Natural and classic. Natural's idle activities, cursor attention, and emotion motion run only under the Natural driver.

**Code:** `packages/stage-ui-live2d/src/composables/live2d/live2d.ts` `Live2DMotionDriver`; `packages/stage-ui-mmd/src/stores/mmd.ts` `MMDMotionDriver`.
**Not to be confused with:** the idle drive (see Drive), which is Natural's input for idle behavior.
**Avoid:** "motion mode", "animation driver".

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

### Persistence tier

The six places that client state may live, chosen in order: 1, a synced settings document; 2, leader-only localStorage written by explicit command with a leadership token; 3, localStorage keyed by display model id and written by the stage window; 4, IndexedDB; 5, synced Pinia memory, replicated and not persisted; 6, per-window memory. Plain localStorage refs and a main-process ring with disk recording are closed to new state. A store that persists anything registers with `useDataMaintenance`.

**Code:** no type names the tiers. Examples: `packages/stage-shared/src/composables/use-settings-document/index.ts` `useSettingsDocument` (tier 1); `packages/stage-ui/src/features/situation/inner-state.ts` `useSituationInnerState` (tier 2); `packages/stage-ui/src/libs/pinia/setup-synced.ts` `setupSynced` (tiers 1 and 5); `packages/stage-ui/src/composables/use-data-maintenance.ts` `useDataMaintenance`.
**Not to be confused with:** leader and follower windows, which decide who writes, not where.
**Avoid:** "storage layer", "cache level".

### Posture

Natural's continuous head, body, and eye pose: homes, drift, shifts, and continuous motion layered per axis and scaled by the performance energy and mood. On Live2D the adapter writes posture to the head, body, and eyeball parameters and overwrites them at full weight. On MMD the body performer turns it into torso, head, and eye rotations.

**Code:** `packages/motion-driver-natural/src/posture.ts` `NaturalPostureLayers`, `postureHomes`; `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` `Live2DNaturalMotionAdapter` (`composePosture`); `packages/stage-ui-mmd/src/composables/mmd/body/performer.ts` `MMDBodyPerformer`.
**Not to be confused with:** a stance, which is the MMD body's base pose; and emotion impulses and gestures, which add to posture.
**Avoid:** "pose" for posture alone.

### Presence

Whether the user is at the desktop, as the situation reads it: `here`, `idle` (no input for 60 s), `away` (300 s, or the screen is locked or the system suspended), or `unknown` (the desktop sample is missing or older than 5 s). Idle time counts from the later of the last desktop input and the user's last turn.

**Code:** `packages/stage-shared/src/situation/types.ts` `PresenceState`, `SituationPresence`.
**Not to be confused with:** "situational presence", the feature name in the ADR for the whole situation-to-reach-out pipeline; the presence bubble (`packages/stage-shared/src/presence-bubble/content.ts` `resolvePresenceBubbleContent`), which shows thinking and unread state beside the character; and the presence notice (`apps/stage-tamagotchi/src/renderer/composables/use-presence-notice.ts` `usePresenceNotice`), which tells the user which signals this host lacks.
**Avoid:** "online status", "AFK".

### Presence bubble

The small panel beside the character's head. It shows one thing at a time: animated thinking dots while a chat turn generates, or an unread count. The real state sets only `thinking`; an unread count comes only from the devtools override.

**Code:** `packages/stage-shared/src/presence-bubble/content.ts` `PresenceBubbleContent`, `resolvePresenceBubbleContent`; `packages/stage-shared/src/presence-bubble/advance.ts` `PresenceBubbleAdvancer`; override `packages/stage-ui/src/stores/presence-bubble.ts` `useSettingsPresenceBubble`.
**Not to be confused with:** presence, the user's here, idle, away, or unknown reading; and the presence notice about missing host signals.
**Avoid:** "typing indicator", "status bubble".

### Prompt segment

One named part of the system prompt of a character turn. `composePrompt` sorts the segments by `PROMPT_SEGMENT_ORDER` (`format`, `card`, `register`, `contract`, `actions`, `memory`, `toolset`, `account`, `voice`, `control`, `unprompted`, `plugin`, `stickers`, `spark`), fits each to its budget under its overflow policy (`fixed`, `warn`, `truncate`, or `drop-oldest`), and drops empty ones. The first four form the stable prefix that the provider's prompt cache depends on; the rest form the per-request tail.

**Code:** `packages/stage-shared/src/stage-contract/compose.ts` `PROMPT_SEGMENT_ORDER`, `PROMPT_SEGMENT_BUDGETS`, `PromptSegmentId`, `OverflowPolicy`, `composePrompt`; built in the app by `packages/stage-ui/src/stores/chat/prompt.ts` `useChatPrompt` (`buildChatPromptSegments`).
**Not to be confused with:** the situation block and the character context, which ride on the last user turn and are not segments; and the audio playback `OverflowPolicy` in `packages/pipelines-audio/src/managers/playback-manager.ts`.
**Avoid:** "prompt section", "prompt block".

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

### Stance

The MMD body's base pose, which the body director holds: `stand`, `sit`, or `sleep`, each played by a looping stance clip that the user assigns, or a procedural `rest` or `doze` when no clip is assigned. She settles after 120 s of idle at home, and Natural's `asleep` maps to sleep. A performing clip other than a gesture forces a stand, and a stance holds for at least 3 s.

**Code:** `packages/motion-driver-humanoid/src/types/index.ts` `BodyIntent` (`stance`); `packages/motion-driver-humanoid/src/performance/contracts.ts` `BodyRest`; `packages/motion-driver-humanoid/src/director/index.ts` `STANCE_MIN_DWELL_MS`, `IDLE_TO_SIT_MS`; `packages/stage-ui-mmd/src/composables/mmd/stance.ts` `MMDStanceDirector`.
**Not to be confused with:** posture, Natural's continuous pose; and the `shift-stance` idle activity, a weight shift while standing.
**Avoid:** "pose" or "state" for a stance.

### Synced settings document

The persistence tier for one feature's user-facing settings: one Valibot-validated document in a synced Pinia store, persisted privately to localStorage, whose `update` and `reset` actions are leader-routed so followers never write storage. Each stored field is validated on its own, so an invalid field falls back to its default while valid siblings survive.

**Code:** `packages/stage-shared/src/composables/use-settings-document/index.ts` `useSettingsDocument`, `SettingsDocument`; examples `packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts` `Live2DNaturalSettings` and `packages/stage-ui-mmd/src/stores/natural-settings.ts` `MMDNaturalSettings`.
**Not to be confused with:** synced Pinia memory (runtime state replicated but not persisted) and plain `useLocalStorageManualReset` refs, a tier closed to new state.
**Avoid:** "settings store" for the document (a store may hold other state too).

### Touch reaction

Everything that a poke or pet starts, each part with its own cooldown and no arbiter between them: Natural's body and face response (a poke nudge, surprise, and glance; the pet face and a pet gaze override), a mood dose to Natural's mood, a moment expression on Live2D, a spoken line (`pet-soft` or `poke-protest`) that the reaction policy allows on the leader, and on MMD a body reaction from the performer.

**Code:** `packages/motion-driver-natural/src/touch.ts` `NaturalPetLayer`; `packages/motion-driver-natural/src/touch-gestures.ts` `NaturalTouchGestures`; `packages/stage-ui-mmd/src/composables/mmd/touch/touch.ts` `MMDTouch`; `packages/stage-ui/src/stores/touch.ts` `useStageTouchStore`; `packages/stage-shared/src/expression-performance/touch-affect.ts` `touchAffect`; `packages/stage-shared/src/situation/reaction-policy.ts` `reactionPolicy`, `ReactionKind`; `packages/motion-driver-humanoid/src/performance/contracts.ts` `BodyReactionKind`.
**Not to be confused with:** a reaction episode (see Reaction), which comes from the decider; and a desktop reaction.
**Avoid:** "touch response" for one part without naming it.

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
- **Live2D clip.** The Live2D code also says "clip" for the playback of an SDK motion group: `getClipOwnedIds` in `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` and `clipResidual` in `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts`. That is not the glossary Clip, which is an imported MMD animation.
- **Presence.** The ADR title "situational presence" names the whole feature, while the code's `PresenceState` is only the user's here, idle, away, or unknown reading. The presence bubble and the presence notice are separate UI features.
- **Host.** "Host" means the platform and desktop session in `HostCapabilities` (`HostId`), the Electron window mode in `StageHostMode`, and a settings-panel injection in `packages/stage-ui/src/components/scenarios/settings/model-settings/desktop-stage.ts` (`DesktopStageHost`).
- **Classic.** "Classic" names the MMD motion driver (`MMDMotionDriver` value `'classic'`), and the Stage host entry and the [full-screen stage ADR](../adr/2026-10-31-fullscreen-stage-and-locomotion.md) also call the `window` stage host "the classic window".
- **Gesture.** An MMD clip kind (`ClipKind` and `BodyActionKind` value `'gesture'`), Natural's emotion gestures (`GestureKind` in `packages/motion-driver-natural/src/emotions.ts`), and the gesture field of an ACT cue are three different things.
- **Presence bubble.** The [presence bubble ADR](../adr/2026-09-24-presence-bubble-in-canvas.md) describes an unread state shown after a turn ends with the chat window hidden. In the code, only the devtools override in `useSettingsPresenceBubble` sets `unreadCount`; the real state shows thinking only.
- **Overflow policy.** `OverflowPolicy` in `packages/stage-shared/src/stage-contract/compose.ts` (prompt segment budgets) and `OverflowPolicy` in `packages/pipelines-audio/src/managers/playback-manager.ts` (audio playback queueing) share a name.
