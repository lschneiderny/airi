# Character mind Target audit

Audit of the remaining Target rules after CM8, against the code on `main` (2026-11-22). Every claim below was checked
by reading the code, not the policy docs. "Precedence rule N" refers to
[Autonomous behavior](../../docs/ai/context/autonomous-behavior.md#precedence). Slice names are recommendations; the
owner assigns the real ones in the [character mind roadmap](../../docs/ai/context/character-mind-roadmap.md).

## Autonomous behavior Target rule 1: one mind per character

| Claim | Status | Evidence |
| --- | --- | --- |
| 1.1 The mind runs once, in the leader window. | LANDED | `useCharacterMindStore` in `packages/stage-ui/src/stores/character-mind.ts` builds one `CharacterMind`; only the leader connects it to `VoicePort` `connect`. Recorded as Precedence rule 18. |
| 1.2 Idle acts, errands, sleep, and follow-ups are decided once. | LANDED | `packages/character-mind/src/idle.ts` runs `advanceIdleSchedule` on the mind's clock and source; `NaturalIdleActivities` only performs the order. Precedence rule 6. |
| 1.3 Reach-out pacing exists once. | LANDED | `answerVoiceTick` and `answerVoiceOutcome` in `packages/character-mind/src/voice.ts` run the urge gate inside `step`; the floor and cap are per user. Precedence rules 16 and 18. |
| 1.4 Slow mood exists once per character. | LANDED | The per-card character-state record is the mind's slow state, and the voice policy reads `moodFactor` (`packages/character-mind/src/types.ts`). Recorded by CM4a and State persistence. |
| 1.5 Fast mood (the emotional afterglow) exists once per character. | OPEN | `NaturalMood` in `packages/motion-driver-natural/src/mood.ts` keeps valence, arousal, and tension per Natural controller. The mind only sends doses (`posture` `mood` intents, `addMood` on the scene), and `startPending` adds each emotion episode to that local mood (`mood.add`). A new controller, as on a driver switch or a model reload, starts from zero. |
| 1.6 Refractories exist once per character. | PARTLY LANDED | Landed in the mind: `REACTION_REFRACTORY_MS`, `SCREEN_CHANGE_REFRACTORY_MS`, the cursor episode cooldown (`answerCursor`), and the idle cooldowns. OPEN per performer: `cooldowns` in `packages/motion-driver-natural/src/gestures.ts` (`NaturalGestures` `trigger`), `pokeSurpriseDedupeSeconds` in `startPending`, the director's `ACTION_REFRACTORY_MS`, `DANCE_REFRACTORY_MS`, `GESTURE_REPEAT_MS`, and `MOVE_TOOL_REFRACTORY_MS` in `BodyDirectorMemory`, and the moment entry rest (`entryRestMs`) kept in `useIdleProps` per stage. |
| 1.7 Every Natural decider is part of the mind or a realiser of its intents. | PARTLY LANDED | Landed: idle, errands, groove, touch, return, desktop reaction, cursor, chat, cue gestures, reach-outs, widget lines, notices, and reminders (Precedence rules 6, 14 to 17, 19, 20, 22; CM8). OPEN: the emotion gesture (claim 2.6), settling (claim 4.4), the director's linger and return-home timing (claim 4.5), and act moments (claim 4.6). |
| 1.8 Deciders under Universal, MAGIC, and classic belong to the mind. | CLOSED by ruling: out of scope ("Scope to Natural", 2026-11-22) | Upstream's touch reaction and touch motion (`createLive2DTouchReaction`, `playTouchMotion`), the avatar touch notify (`createAvatarTouchCooldown`), MAGIC's `createLive2DFocusBias`, Beat Sync (`createBeatSyncController`), and the MMD classic emotion clips decide outside the mind. The D2 owner ruling of 2026-11-21 (overlap 11) and ADR decision 14 keep them as upstream ships them. |

## Autonomous behavior Target rule 2: one stimulus, one response

| Claim | Status | Evidence |
| --- | --- | --- |
| 2.1 A touch gets one response. | LANDED under Natural | `answerTouch` in `packages/character-mind/src/touch.ts`; `StagePerformanceConductor` `touch` dispatches one ordered response. Precedence rule 14. Outside Natural, overlap 11 is kept (claim 1.8). |
| 2.2 A return gets one response. | LANDED | `answerPresence` in `packages/character-mind/src/presence.ts`, under every driver. Precedence rule 15. |
| 2.3 Every glance has one arbiter. | LANDED under Natural | `NaturalGazeLayer` `glance` and `orient` with `GLANCE_PRIORITY` in `packages/motion-driver-natural/src/gaze.ts`. Precedence rule 21. The MMD walk is the exception in Body ownership claim 3.4. |
| 2.4 Music gets one response, the groove. | LANDED under Natural | `MindMusic` sends `music` edges; `answerMusic` keeps `MindState.music`; the idle policy alone weighs `sway`; `beatSyncMode` returns `silent` under Natural; the MMD director has no music input (`BodyDirectorInput`). Precedence rule 19. The groove is drawn from the same idle view as every other act (busy, blocked, settled, mode). |
| 2.5 Chat, cursor, cue gestures, voice requests, notices, and reminders each get one answer. | LANDED | `answerChat`, `answerCursor`, the `cue-gesture` branch of `step`, `answerVoiceRequest`, `answerNoticeRequest`. Precedence rules 17, 20, 22; CM8. |
| 2.6 An emotion's response is decided across every channel at once. | OPEN | The mind answers an `emotion` stimulus with one `face` `emotion` intent (`answerEmotion`). `StagePerformanceConductor` `emotion` then hands the same episode to Natural (`dispatchNatural`), and `startPending` derives the body response itself: the gesture from the recipe table, refused by `NaturalGestures` cooldowns, `shake-or-drop` drawn on Natural's stream. No posture intent carries the gesture, so the mind does not see or pace it. |

## Autonomous behavior Target rule 4: episodes in the mind, frames in the performer

| Claim | Status | Evidence |
| --- | --- | --- |
| 4.1 Cursor notice is a mind decision; tracking is the performer's. | LANDED | `answerCursor` draws with `drawCursorEpisode`; `NaturalCursorAttention` plays it. Precedence rule 20. |
| 4.2 Idle acts, errands, sleep, and the groove are mind episodes. | LANDED | `packages/character-mind/src/idle.ts`; Natural draws only each act's shape from the order's seed. Precedence rule 6. |
| 4.3 Glance arbitration runs at frame rate in the performer. | LANDED as owner design | Precedence rule 21 records the arbiter in Natural; the mind issues gaze intents and the arbiter reports refusals. Not an open item. |
| 4.4 Settling (sitting down or resting after long idle) is a mind episode. | OPEN | `NaturalIdleActivities` sets `settled` after `settleSeconds` (120 s) of idle on its own timer and reports it in its idle view; the director maps it to sit or rest (`directorIdleStates`). The mind only reads it. Note: the Body director row cites `IDLE_TO_SIT_MS`, which `decideBody` does not use; only lab-tools reads it. |
| 4.5 The director decides no episode timing of its own. | OPEN | `decideBody` draws the linger after a wander or visit (`LINGER_MIN_MS` to `LINGER_MAX_MS`) from its own `rngState`, and walks home after `RETURN_HOME_DELAY_MS` without a goal reason. The wander position is geometry and stays with the director. Precedence rule 8 records the current split. |
| 4.6 Moments are mind episodes. | PARTLY LANDED | Mind moments (`poked`, `petted`, `welcome-back`) carry `intentId`, which seeds both draws (`useIdleProps` `onMoment`). Act moments, `held-back`, and `waking` come from Natural's idle reports and draw the 0.6 chance and the pick from `useIdleProps`' local stream, per stage. |
| 4.7 Emotion gestures are mind episodes. | OPEN | Same evidence as claim 2.6. |

## Autonomous behavior Target rule 5: renderer deciders act on intents

| Claim | Status | Evidence |
| --- | --- | --- |
| 5.1 The director never reads raw touches or drag releases. | LANDED | `BodyDirectorInput` `attend.touchSeq` comes only from `MMDAttendInbox` counting the mind's `attend` causes; `dragging` in progress is world. Precedence rule 8; Body ownership Director inputs. |
| 5.2 The director chases the cursor only inside the mind's window. | LANDED | `attend.untilMs` gates `chasing` and `cursorStepPending` in `decideBody`; `cursorX` is geometry. Precedence rules 8 and 20. |
| 5.3 The director reads no raw return. | LANDED | `BodyDirectorInput` `away` is the mind's presence answer (`setAway` on the MMD scene, Natural only). Precedence rule 8. |
| 5.4 The director reads no raw chat. | LANDED | Clip endings and the walk to the chat use `attend.chatSeq` and `attend.chatOpenSeq`; `chatX` is geometry and `speaking` and `performance.mode` are world. Precedence rule 8. |
| 5.5 The director reads no music. | LANDED | `BodyDirectorInput` has no music field; the MMD scene's `beat` feeds only Natural's beat clock. Precedence rule 19. |
| 5.6 Other renderer deciders act on intents. | LANDED under Natural | `useIdleProps` acts on mind moments and Natural's idle reports; `reactToTouch` performs `touch-reaction` intents on both renderers. Under Universal and MAGIC, upstream's touch reaction and MAGIC's focus bias still read raw touches and the cursor (claim 1.8). |

## Body ownership Target rule 3: one writer per channel per frame

| Claim | Status | Evidence |
| --- | --- | --- |
| 3.1 Live2D channels under Natural have one owner. | LANDED | `Live2DNaturalMotionAdapter` `composePosture` and `composeFace`; the expression composer owns expression-only parameters. Recorded as the Live2D rule "One owner composes each Live2D channel under Natural" (CM7d). |
| 3.2 MMD morphs have one owner. | LANDED, not yet recorded as a rule | `combineMorphChannels` folds every layer, `createMMDMorphRuntime` `applySurfaceStage` writes the result, and `MMDFramePipeline` `restore` resets it; no other code writes morph influences (the scene's plain `createMorphController` only lists and overrides slots). |
| 3.3 MMD bones under Natural have one final owner per group. | LANDED, not yet recorded as a rule | Each group's pose stage composes its final transform on the clean pose in `MMD_POSE_STAGE_IDS` order (`MMDBodyPerformer`, `MMDFootContact`, `MMDEyes`); clips enter through `updateOwnership` weights. `applyFacing` evaluates IK with the final facing and restores the center; the head stage owns the visible center yaw. |
| 3.4 The gaze arbiter owns gaze on MMD. | OPEN | `MMDBody` `resolveGaze` takes Natural's choice (`intent.gaze.on`) only when she is not walking: while the gait moves, the travel direction replaces it, including a held glance that the arbiter granted. Precedence rule 9 records this order. |
| 3.5 Live2D under Universal and MAGIC, and MMD classic, have one writer per channel. | CLOSED by ruling: out of scope ("Scope to Natural", 2026-11-22) | Head angles take motion curves, beat sync, manual control, the beat-sync layer, the touch reaction, and SDK focus in sequence (`useLive2DMotionManagerUpdate` plugins); classic gaze adds to the clip head. ADR decision 14 keeps upstream drivers as upstream ships them. |
| 3.6 VRM, Spine, and tachie have one writer per channel. | OPEN | None runs Natural or declares channels; the character mind ADR's open question "Renderers without Natural" defers them to the VRM adapter (3D roadmap M5). |

## Open items

| Item | What would change | Packages | Changes motion | Waits on | Recommended slice |
| --- | --- | --- | --- | --- | --- |
| Emotion body response (claims 2.6, 4.7, part of 1.6) | The mind answers an emotion with a `posture` gesture intent beside the face intent: it chooses the gesture, draws `shake-or-drop`, and keeps the per-kind cooldowns on its own stream. `NaturalGestures` only plays the gesture it is given, and `startPending` stops deriving it. | `character-mind`, `motion-driver-natural`, `stage-ui` (conductor), `stage-ui-live2d`, `stage-ui-mmd` | Yes: Natural's stream draws move, so headless identity checks (`qa:live2d-rig`, `qa:motion3d`) must show equal motion for equal decisions | Nothing | CM9a emotion gestures in the mind |
| Fast mood (claim 1.5) | The mind keeps valence, arousal, and tension as fast state and sends the level the performer modulates by, instead of doses that each `NaturalMood` integrates. A remount or driver switch keeps her mood. | `character-mind`, `motion-driver-natural`, `stage-ui`, `stage-ui-live2d`, `stage-ui-mmd` | Yes: mood modulation of posture and face; headless identity checks | Nothing; an owner check that the mood should survive a model switch | CM9b fast mood in the mind |
| Settling (claim 4.4) | The idle policy decides when she settles and orders it as an episode; `NaturalIdleActivities` drops `settleSeconds`, and the director keeps mapping it to sit or rest. | `character-mind`, `motion-driver-natural`, `stage-ui-mmd` | Yes: MMD sit and rest onset; `qa:motion3d` rest report | Nothing | CM9c settling in the idle policy |
| Director linger and return home (claim 4.5) | The mind's wander errand carries the linger (the `idle-errand` intent already has `holdSeconds`), and the walk home becomes the end of that errand; the director keeps the position draw. | `character-mind`, `motion-driver-humanoid`, `stage-ui-mmd` | Yes: MMD locomotion timing; `qa:motion3d` | Nothing | CM9d wander linger in the errand |
| Act moments (claim 4.6) | Natural's idle reports carry the order's intent id, so act, `held-back`, and `waking` moments seed their draws like mind moments. | `stage-ui`, `motion-driver-natural`, `character-mind` | No body motion; Live2D expression picks change | Nothing | CM9e act moments from the order |
| MMD travel gaze (claim 3.4) | Walking enters `NaturalGazeLayer` as an input (an `orient` source or a ranked glance source), so the arbiter decides between travel and held glances; `resolveGaze` stops overriding it. | `motion-driver-natural`, `motion-driver-humanoid`, `stage-ui-mmd` | Yes: MMD head and eyes while walking; `qa:motion3d` | Owner decision on where travel ranks against a poke or pet-end glance | CM9f travel gaze through the arbiter |
| Per-stage refractories (rest of claim 1.6) | The director's clip and tool refractories, the poke dedupe, and the moment entry rest move into mind state, so a remount or a second stage cannot reset or double them. | `character-mind`, `motion-driver-humanoid`, `motion-driver-natural`, `stage-ui`, `stage-ui-mmd` | Yes: clip and poke timing | A second stage (only then can two stages double them), or an owner decision that a remount reset matters now | CM10 character refractories |
| Renderers without Natural (claim 3.6) | VRM, Spine, and tachie become performers that declare channels, or stay outside the mind's world. | `stage-ui-three`, `stage-ui`, `character-mind` | Yes for VRM | The VRM adapter (3D roadmap M5) and the ADR's open question | Part of 3D roadmap M5 |
