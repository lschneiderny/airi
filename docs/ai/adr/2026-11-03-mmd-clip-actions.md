# Clip actions for MMD models

Date: 2026-11-03
Status: accepted

## Context

Before this change, a VMD clip that the user imported for an MMD model was only a name (`{ id, name }` in the `mmd` store). The user could pin one per emotion and one per stance slot, and the Motion Lab could play any name as a one-shot. Nothing knew what a clip animated, so every clip took the whole body: `playAction` faded out the current action, an arm wave replaced the idle or stood her up from a sit, and body ducking read every clip weight regardless of what the clip keyed, so an arm-only clip froze breath, sway and weight shift. A clip that owned the root or the leg IK made locomotion drop its goal every frame, and nothing issued it again. The chat model had expression tools and the body tools (`come_here`, `go_home`, `look_at`), but no way to start a clip. The Neutral and Sleepy emotions replayed the idle VMD as a one-shot.

Milestone M3 of [the 3D character roadmap](../3d-character-roadmap.md) asked for a clip library the character can use: short gestures layered over idle, sitting and walking, and full-body actions and dances that pre-empt locomotion through the body director, which stays the only part that decides what she does. The Live2D path, the Natural numbers and the static stage contract had to stay unchanged.

The plan also carried an M4 measurement spike for a Windows window-rect sensor. This run was on an M2 Mac, so the spike was built and not measured (see [The window-rect sensor spike](#the-window-rect-sensor-spike)).

## Decision

### Clip metadata is derived from the bone mask (todos 2 and 3)

`buildClipBoneMask` (`packages/motion-driver-humanoid/src/clip-mask/index.ts`) gained a `lowerBody` group (hips, FK upper leg, lower leg and foot, plus caller-listed helper bones such as the MMD D bones `左足D`, `左ひざD` and `左足首D`), and treats `全ての親` and `master` as root names (todo 2). An FK-only leg clip or an all-parent move therefore owns the legs. The detection thresholds (0.5 degrees, 0.01 units) did not change.

`deriveClipMeta(mask, durationMs, name)` (`packages/motion-driver-humanoid/src/clip-meta/index.ts`, todo 3) classifies every clip once at import. The first matching rule wins:

1. A non-positive or non-finite duration is `unusable` on layer `none` (note `bad-duration`).
2. A mask with no animated group is `unusable` on layer `none` (note `no-animated-bones`).
3. A name matching idle, stand, sit or sleep, in English or Japanese, is a looping `stance` (note `stance-name`). Its layer is `full` when it animates the root, leg IK or `lowerBody`, else `upper`.
4. A clip that animates the root, leg IK or `lowerBody` for at least `DANCE_MIN_MS` (20 s) is a `dance` on the `full` layer. Dances never loop.
5. Any other clip that animates the root, leg IK or `lowerBody` is an `action` on the `full` layer.
6. An upper-only clip of at most `GESTURE_MAX_MS` (6 s) is a `gesture` on the `upper` layer. Gestures never loop.
7. A longer upper-only clip is an `action` on the `upper` layer.

Actions loop when the name contains `loop`, `ループ` or `repeat`, or ends in `_l` (note `loop-name`). `slugLabel` gives the default label (NFKC, lowercase, runs of other characters become `-`, at most 32 characters, matching `CLIP_LABEL_PATTERN`), or `null` with the note `non-ascii-name`. `effectiveLayer(meta, kindOverride)` keeps any gesture, derived or overridden, on the `upper` layer. A full-body clip that the user marks as a gesture is therefore downgraded to its upper partition. The user can change the label, kind, loop and exposure, but never the layer.

### Curation is per model and off by default (todos 9, 14, 20 and 21)

The `mmd` store (`packages/stage-ui-mmd/src/stores/mmd.ts`, todo 9) persists `clipCuration` (`settings/mmd/clip-curation`, keyed by model key, then clip name: `label`, `kind`, `loop`, `aiMayUse`), and the scene publishes the derived `availableClipMeta` (`settings/mmd/available-clip-meta`) so the settings window can render it. `setCuration` refuses a label that fails `CLIP_LABEL_PATTERN` or that another clip of the same model already uses. `labeledClips(modelKey)` returns every clip with a label and a gesture, action or dance kind, and `exposedActions(modelKey)` returns the ones the user exposed. Exposure (`aiMayUse`) defaults to off for every clip. `removeMotion` drops the clip's curation and meta, so curation survives a re-import of the same name only while the clip stays imported.

The curation table in the MMD model settings (`packages/stage-ui/src/components/scenarios/settings/model-settings/mmd.vue`, todo 14) shows the derived kind and layer, the `downgraded` and `unusable` badges, the label input with its duplicate error, the kind select, the loop toggle and the "AI may use" switch. Its label drafts are keyed by model (todo 21). A clip that is removed and then re-imported under the same name is loaded, derived, split and registered again without a model reload (todo 20, `packages/stage-ui-mmd/src/composables/mmd/motion-registrations.ts`).

`EMOTION_ACTION_NAME` (`packages/stage-ui-mmd/src/constants/actions.ts`, todo 9) maps Neutral and Sleepy to `''`, so a neutral cue no longer replays the idle clip.

### The director performs clips (todo 4)

`decideBody` (`packages/motion-driver-humanoid/src/director/index.ts`) accepts a `BodyActionRequest` (`seq`, `clipId`, `kind`, `layer`, `loop`, `durationMs`, `source` of `act`, `tool` or `debug`) and keeps the accepted one in `memory.performing` with the phase `settling` or `playing`. `BodyIntent.action` mirrors it. The director echoes `clipId` and never starts, stops or names a clip itself, and it still never moves the root.

A request with a `seq` above `lastActionSeq` is decided in this order, first match wins:

1. An empty `clipId` from `tool` or `debug` stops the running performance.
2. The user is away or the stance is `sleep`: refused `asleep`.
3. She is being dragged: refused `dragging`.
4. A gesture inside its per-clip repeat window (`GESTURE_REPEAT_MS`, 4 s): refused `refractory` with no retry time, because ACT has no answer channel. A looping `debug` request skips this rule only (todo 15), so the Lab and the QA gates can keep a gesture playing.
5. An action or dance inside its refractory (`ACTION_REFRACTORY_MS` 15 s, `DANCE_REFRACTORY_MS` 60 s, counted from the end of the performance): refused `refractory` with `actionRetryAfterMs`.
6. A `full` performance is running, or a gesture arrives while any performance runs: refused `busy`, with the remaining time of a one-shot as the retry (0 for a loop).
7. Otherwise accepted. An action or dance replaces a running `upper` performance.

Every request with a newer `seq`, accepted or refused, advances `lastActionSeq`, so a port can settle on a refusal. A gesture plays at once, also while she sits, walks or speaks. An action or dance starts in `settling`: the goal in progress moves to the pending goal, she is forced to stand, and the clip plays once she has stood for `STAND_SETTLE_MS` (800 ms) and locomotion is idle, or after `SETTLE_TIMEOUT_MS` (2 s). While she speaks, `settling` holds without a timeout.

A performance ends on its `actionFeedback` (`finished` arms the refractory, `failed` does not), on the watchdog (`PERFORM_WATCHDOG_MS`, 2 s past `durationMs` for a one-shot), on an explicit stop, and when she goes away. A poke, pet or drag ends a `full` performance and any loop; an `upper` one-shot continues. A chat unfold or an accepted move tool ends a loop only. While a `full` performance runs, the locomotion gate stays closed, the stance stays `stand` and the idle clock is held, so the idle-to-sit timer cannot crossfade a sit under a dance. When it ends, every pending goal gets a fresh time to live, so a goal queued behind a long dance is not dropped by `PENDING_GOAL_TTL_MS`. The director also records `toolRefusalReason` for the body tools, so `MMDBodyToolPort` no longer infers it.

Every host supplies `actionRequest`, `actionFeedback`, `dragging`, `interactionSeq` and `interactionAtMs`, with or without a stage world, so a poke ends a clip in the classic window too.

### Layered playback and the base partition (todos 7, 8 and 10)

The animation manager (`packages/stage-ui-mmd/src/composables/mmd/animation-manager.ts`, todo 7) registers each usable clip with its own `#upper` and `#lower` partitions (`splitClipByLayer` in `packages/stage-ui-mmd/src/composables/mmd/rig/clip-split.ts`). `playLayer(name, { seq, layer, loop, kind })` plays a clip on a second layer without touching the base action:

- An `upper` layer plays the clip's upper partition and splits the running base by the bones that partition keys. The base tracks for those bones ease out, and every other base track keeps full weight, so bones the gesture does not animate never drift toward the bind pose. The layer eases in over 0.25 s and out over 0.3 s, and the base recombines into one action when it ends.
- A `full` layer eases the whole clip in over 0.4 s (0.6 s for a dance) and owns every bone it keys.
- `onLayerEvent` reports `playing`, `finished` and `failed`, which the scene feeds back to the director as `actionFeedback`.

No additive blending is used. `DEFAULT_CROSSFADE` and `BASE_CROSSFADE` are unchanged.

Dances play once. The frame pipeline resets physics on every mixer `loop` event, so a looping dance would reset hair and cloth at every wrap. `playLayer` ignores `loop` for a dance and reports the note `loop-ignored`.

`MMDBody` (`packages/stage-ui-mmd/src/composables/mmd/body/index.ts`, todo 8) ducks by ownership, not by raw clip weight. Foot contact eases out by the largest owned share of `root`, the leg IK and `lowerBody`. Breath, sway and weight shift duck by the larger of the stance weight and the owned share of `root` and `upperBody`. Look-at yields the head share. Arm rest and arm swing already scaled by the owned arm groups. An arm or finger gesture therefore keeps breath, sway and planted feet during a walk. The scene registers action and dance clips with `forceGroups` `root`, `leftLegIk` and `rightLegIk` (todo 10), so a full-body clip whose mask keys only the upper body still stops the gait.

The MMD scene (`packages/stage-ui-mmd/src/components/scenes/MMD.vue`, todo 10) derives the mask and meta at import, feeds the director's action inputs every frame, and obeys `intent.action`: `playLayer` when a new `seq` reaches `playing`, `stopLayer` when the intent clears. Every one-shot goes through the same perform entry (`requestPerform`): the emotion map, the Lab and settings play (todos 10 and 14 removed the old one-shot store API), ACT actions and the tool. Ownership and the refractories therefore see all of them. An exposed action is never chosen as a standing base.

### Two LLM channels and the exposure rule (todos 5, 11 and 12)

Only exposed clips reach the model, and only by their label. The label is never used as a clip name.

- ACT `action` (todos 5 and 11). `normalizeActPayload` (`packages/pipelines-audio/src/llm-streaming-control/payloads.ts`) keeps a JSON `action` string that matches the label pattern after trimming and lowercasing, and omits anything else. `Stage.vue` forwards it to the conductor's `action(label)` while the MMD renderer is active; the Live2D `gesture` branch is untouched. The scene runs `resolveActAction` (`packages/stage-ui-mmd/src/composables/mmd/actions/resolve-act-action.ts`) against `labeledClips`: an exposed gesture plays with `source: 'act'`. The other outcomes are silent drops that the diagnostics count: `unknown` (no clip carries the label), `notExposed`, `notGesture` (an exposed action or dance, which plays only through the tool) and `superseded` (the cue's own `gesture`, when the clip wins).
- `perform_action` (todo 12). `createActionTools` (`packages/stage-ui/src/tools/action.ts`) registers one tool, `action:perform_action`, whose `action` enum is the exposed action and dance labels plus `stop`. `createActionToolRegistration` re-registers it when the exposed set changes and removes it when the set is empty. `MMDActionPort` (`packages/stage-ui-mmd/src/composables/mmd/action-port.ts`) submits `source: 'tool'` requests and settles on the director's `lastActionSeq`. Refusals name the reason: `refractory` ("She can do that again in N s", with `retryAfterSeconds`), `busy`, `asleep` and `dragging`. The port is observed every frame outside the stage-world block, so the tool also works in the classic window.

### The actions prompt section (todo 13)

The instruction and the labels render as their own system-prompt section, `actions`, not as a live-state bullet. `useStageActionsPrompt` (`packages/stage-ui/src/composables/use-airi-runtime-prompt.ts`) builds one sentence for the gesture labels (`base.prompt.actions-gestures`) and one for the action and dance labels (`base.prompt.actions-actions`), and omits each sentence when its list is empty. `buildChatPromptSegments` (`packages/stage-ui/src/stores/chat/prompt.ts`) passes it on every character turn. In `PROMPT_SEGMENT_ORDER` (`packages/stage-shared/src/stage-contract/compose.ts`), `actions` is the first tail segment, right after the stage contract, with the `truncate` policy and a 1500-character cap. With no clip exposed, the section is empty and the prompt keeps its bytes. The [prompt composition ADR](2026-11-01-prompt-composition.md) has the segment row.

The first design put the line in the situation block's Stage bullet. The todo 13 attempt-2 review found that the situation block keeps only a 6-line, 500-character prefix of its bullets, and that the clip bullet ranked second-lowest. On an ordinary Windows turn (presence, `Now:`, `Before that:`, one `New:` event or one context line, conversation), the bullet was dropped, so the model lost the gesture labels and the ACT instruction for that turn. A tail section outside that budget reaches every request. The static stage contract text and `STAGE_CONTRACT_EN_SHA256` did not change, and the cacheable prefix is byte-identical.

Known limit: the cap truncates by characters. Past 1500 characters, the section is cut mid-label, and because the gesture sentence comes first, a very long gesture list can push out the whole `perform_action` sentence.

### Diagnostics, the Motion Lab and QA (todos 10, 15, 16, 17 and 22)

The `mmd-motion-diagnostics` snapshot (`packages/stage-ui-mmd/src/stores/motion-diagnostics.ts`) appends `action` (the performing clip, `lastActionSeq`, the refusal and retry, and the ACT drop counters), `clips` (the library with effective kind, layer, label, exposure and the `downgraded` flag), `animation.layer` and `ownership`. The commands `playClip { name, loop? }` and `stopClip` (todo 15) queue `debug` requests. The Motion Lab's Clips card (`packages/stage-ui/src/features/devtools/motion/mmd/components/clips-panel.vue`) lists the library with Play and Stop buttons.

`pnpm qa:stage` (`packages/qa-tools/src/stage/gates.ts`, todo 16) judges two new scenarios:

- `stage-gesture-walk`: an upper clip, looped through a `debug` request, plays while she walks. The walking span must last at least the larger of the record's `seconds` and 10 s (`gestureWalkMinMs`, todo 22); skate and foot error stay under 0.05, the gait stays enabled on every sample, and the clip is on the upper layer in at least 80 % of the samples.
- `stage-action-preempt`: a full clip plays while a goal is pending. The gait is disabled and the pending goal is held on every `playing` sample, the goal is issued within 3 s after the performance clears, and the p95 AIRI stage time stays at or under 4 ms. Samples in phase `settling` are not gated, because the director keeps the gait on while she stops walking.

Model-eval scorer version 4 (`packages/qa-tools/src/model/score/cue-contract.ts`, todo 17) scores the ACT `action` field and `perform_action` calls against an exposed set that `--exposed-actions label:kind,...` supplies. Without the flag, scoring is unchanged. The fixture `packages/qa-tools/fixtures/model/actions-prompt.json` pins the actions section text against both renderers.

### The window-rect sensor spike

`apps/stage-tamagotchi/src/main/services/electron/window-rects-spike.ts` (todo 6) walks the top-level windows through koffi in three modes (`AIRI_WINDOW_SENSOR_SPIKE_MODE=main|async|worker`). It runs only on Windows with `AIRI_WINDOW_SENSOR_SPIKE=1` and carries a `// NOTICE:` block whose removal condition is that the M4 plan replaces or deletes it. `packages/qa-tools/src/window-rects/measure.ts` drives it through the main-process inspector.

The run was on an M2 Mac, so the spike is built and unmeasured. Its evidence records `GATE: NOT MEASURED`, and no numbers exist. A Windows run must meet these gates before M4 builds on a sensor:

- The best off-main mode (async or worker) has p95 <= 2 ms and p99 <= 5 ms on a heavy desktop (60 or more top-level windows).
- The main-thread mode has p95 <= 0.5 ms; otherwise the recommendation must be off-main.
- The main-thread event-loop p99 delay grows by at most 1 ms against a run without sampling.
- The DIP error is at most 1 DIP on every display, and on a two-display straddle when one exists.
- `kept` holds no cloaked, minimized or own-process windows, and every visible top-level app window is present.
- RSS grows by at most 2 MB over the last 20 minutes of a 30-minute run at 4 Hz.
- A window that closes mid-walk yields a skipped entry, never a throw.

The run must also record the `GetWindowRect` versus DWM-bounds offset, the straddle case and one cloaked window. No placement recommendation exists until then.

### What stays out

Beat detection and tempo-matched playback, a product window sensor, perching, terrain, drag dangle, pointing, props, display hand-off, a `go_to` or `list_actions` tool, per-bone editing, user control of a clip's layer, the VRM adapter and a Live2D stage mode. No assets were committed and no dependency was added.

## Consequences

The user decides what the character may do: a clip reaches the model only after the user labels it and switches "AI may use" on. The director stays the one owner of the body, so walking, sitting, chasing and clips never fight, and the model receives an honest refusal with a retry time instead of a clip that silently fails.

A gesture layers over idle, a sit and a walk without stopping the walk or ending the sit, because the base keeps every bone the gesture does not key. A full-body clip pre-empts locomotion and the walk resumes afterwards. Clip ownership is now the only source of ducking, so a new clip-driven layer must read `body.ownership()`, not raw weights.

The prompt grows by the `actions` section only while clips are exposed, and the cached prefix does not move. The section is outside the situation budget, so it reaches every turn, at the cost of character-based truncation.

On the desktop stage, chat turns from the chat window reach the stage through the synced leader: the composer calls `chatStore.send`, which routes `sendInLeader` to the stage renderer, where the tool executors and the ACT listener live. A renderer-local entry such as `chat.ingest` in the chat window does not reach the stage.

The window-rect question for M4 is still open: the code to answer it exists, the answer does not.

## Follow-ups

- Done on 2026-11-04: the window-rect spike was measured on Windows, and `apps/stage-tamagotchi/src/main/services/electron/window-rects-spike.md` records the results. Still open: record the `GATE:` line, the per-mode summary fixtures that `measure.ts` writes, and a placement recommendation before M4 planning. The Godot sidecar's pid is not in the spike's own-process filter yet.
- Truncate the `actions` section at a label boundary, or drop whole labels, so a long exposed set never ends in half a label or loses the `perform_action` sentence.
- Chisa's 148-expression Stage line overflows the situation block's 500-character budget, so the exposed expressions never reach the model on her. This predates the plan and was found in todo 13.
- A profile saved before todo 9 keeps `Neutral: 'idle'` in its emotion map, because the store has no migration. It replays the idle clip on every neutral cue until the user resets the emotion map in the MMD settings.
- A removed clip stays registered in the animation manager and the body until the model reloads (todo 20 review). Nothing can play it, but `listMotions` still lists it. Add `unregisterClip` to both if `listMotions` gains a consumer.
- Beat-matched playback: dances play at native rate today.
- Map the ACT `gesture` kinds (nod, shake and the others) to clips or procedural motion on MMD; MMD ignores them today.
- Props, the M4 sensor wire contract (an Eventa contract once the measurement picks a placement) and display hand-off.
