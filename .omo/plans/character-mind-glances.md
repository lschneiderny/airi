# character-mind-glances - Work Plan

Status: the owner approved D1 to D11 as recommended on 2026-11-21. CM6b1 (items 1 to 7) is built, and its section 8 checks passed on macOS; CM6b2 is not started. Roadmap row: step CM6b in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Rulings: the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md) (decisions 2, 5, 6, 7, and 8), the [core ADR](../../docs/ai/adr/2026-11-18-character-mind-core.md) (D15: realisation details stay in the performers), the [idle ADR](../../docs/ai/adr/2026-11-20-character-mind-idle.md) (the report-and-order pattern, D2: pure rules stay in `motion-driver-natural`), and the [gaze ADR](../../docs/ai/adr/2026-11-20-character-mind-gaze.md) (CM6a: D13, D14, D20, D21). Plan branch: `luke/feat/character-mind-glances`, cut from `main` at `bec508cae`, which contains CM6a. The implementation branches are cut later, as section 7 says.

**Parallel work this plan composes with.**

- **The CM6a stop-early fix** on `luke/fix/character-mind-gaze-stop-early` lands first. It changes how `decideBody` ends a walk under the pointer: she stops when her predicted stopping point reaches the pointer, and the gait is unchanged. At plan time the branch has no commits, so this plan assumes only that the fix edits the cursor stop rule in `packages/motion-driver-humanoid/src/director/index.ts`, its tests, and possibly adds a gait input to `BodyDirectorInput`. Section 6.1 lists the shared files.
- **The upstream sync** to `bd4f30391` on `luke/chore/upstream-sync` is mid-merge. None of its 18 upstream commits touches a file this slice changes (section 1). The roadmap says a slice starts after a sync, so CM6b1 is cut from `main` after the sync and the fix have landed.
- **CM5b**, the groove's beat lock, has a worktree on `luke/feat/character-mind-beat-lock` with no commits yet. It edits the `sway` act. CM6b1 edits the glance calls in the same file (`idle-activities.ts`); section 6.1 covers it.

**Split (D1).** CM6b is split into two PRs, as CM4, CM5, and CM6 were.

- **CM6b1, glances.** One gaze arbiter in Natural with stated priorities; chat activity and ACT cue gestures become stimuli of the mind. It closes overlap 7.
- **CM6b2, the director on intents.** The director's clip endings, chat approach, and `away` come from the mind's intents; `BodyIntent.attention` is replaced by a look request that the arbiter realises; the `VISIT_SHARE` draw moves onto the mind's wander pick. It lands Body ownership Target rule 8 in full.

The halves share one stimulus, `chat`: CM6b1 adds it with its gaze answer, and CM6b2 adds its body answer. Each half leaves one decider for what it moves, so the split keeps no compatibility path: during CM6b1 the director still reads its own chat counters, as CM6a left `interactionSeq` and `chatSendSeq` until CM6b (gaze ADR D20).

## TL;DR (For humans)

**What changes (CM6b1):** Every glance names its source, and Natural's gaze layer decides between them by a fixed priority instead of "the latest wins". A touch outranks a desktop wake, which outranks reading the chat, which outranks the model's cues and emotions, which outrank a screen change, a noticed cursor, and her own idle glances. A lower glance that arrives while a higher one holds is dropped and logged. While a pet runs, no glance starts, which enforces the existing ruling "no camera snap while a pet runs". A sent message and an opened chat now reach the character mind as a `chat` stimulus, and the mind tells Natural to read the chat; ACT cue gestures reach the mind as a `cue-gesture` stimulus, and the mind tells Natural to play them.

**What changes (CM6b2):** The MMD body director stops reading raw counters. A poke, a pet start, a drag release, a sent message, and an opened chat reach it only through the mind's `attend` intent, which now says why she attends and to what (the cursor or the chat). `away` reaches it through the mind's presence answer. The model's `look_at` tool, which today changes only diagnostics, becomes a real glance through the arbiter. Whether a wander becomes a visit is drawn from the mind's wander pick, not from the director's own stream.

**Why:** Autonomous behavior overlap 7 (glances fight on one channel), Body ownership Target rules 3 and 8, and Autonomous behavior Target rules 2 and 5.

**What does not change:** No glance point, hold, or delay; no chase window, stop distance, linger, or gait constant; no new setting or storage key. The performance resolver still resolves mode and attention per stage. Live2D's Universal and MAGIC and MMD's classic driver get no intents.

**Effort:** M for each PR. **Risk:** Medium. CM6b1 item 2 changes which glance wins on purpose, so `gaze-shift`, `touch`, `emotions`, and `gesture-under-clip` traces may change. CM6b2 changes what ends a clip under MMD's classic driver (D9).

## 1. Upstream first

`git fetch upstream` on 2026-11-21: `upstream/main` is `bd4f30391`. `main` contains upstream through `b3a6d6071`, so 18 upstream commits are new. Three of them touch client packages, and none touches a path this slice reads or changes:

- `dc31699e8` (#3559) bumps `three-mmd` and removes unused exports from `packages/stage-ui-mmd/src/constants/` and `src/index.ts`.
- `e2e19ca97` (#3551) and `3aa466f98` (#3496) change `packages/stage-ui/src/stores/chat.ts`, the character previews, chat vision, and `stage-shared` chat requests. This slice does not touch `chat.ts`; the chat stimulus starts from `chatComposerSentEvent` in `Stage.vue`, which neither commit changes.

| Upstream has | Code | Fork difference |
| --- | --- | --- |
| Universal eye tracking that follows the mouse | `stage-ui-live2d` focus controller | Unchanged; it runs only under Universal and has no glances |
| MAGIC turn toward the cursor (#3285) | `stage-ui-live2d` `focus-bias.ts` | Unchanged; under MAGIC only |
| Upstream's Live2D touch module (#3292) | `stage-ui-live2d` `touch.ts` | Unchanged; under Universal and MAGIC only |
| The stage scene, the Live2D scene and model, the MMD scene | `packages/stage-ui/src/components/scenes/Stage.vue`, `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`, `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`, `packages/stage-ui-mmd/src/components/scenes/MMD.vue` | Fork-edited already. This slice changes all four (section 4 names why) |
| No Natural, no gaze layer, no body director, no character mind, no conductor, no performance resolver, no headless runner | None | `motion-driver-natural`, `motion-driver-humanoid`, `character-mind`, `stage-ui` `composables/performance`, `stage-shared/src/performance-state`, `stage-ui-mmd` `composables/mmd`, and `qa-tools` are fork-only |

Nothing upstream decides a glance or a director input, so `docs/ai/context/upstream-policy.md` gains no row. After the sync lands, rerun `git diff b3a6d6071 bd4f30391 --stat -- <the paths in section 4>` and stop if it prints anything.

## 2. Today's code

Read from `main` at `bec508cae`.

### 2.1 Glance callers

Every transient glance calls `NaturalGazeLayer.glance(point, hold, at, source?)` in `packages/motion-driver-natural/src/gaze.ts`. It saccades at once, holds for `hold`, and returns the hold's end. Nothing compares it with a glance already running, so the latest call wins (overlap 7). The outline in the gaze plan (section 12) names nine call sites in four modules. The code has the same four modules and these call sites:

| # | Caller | Code | Point, hold | Decided by today |
| --- | --- | --- | --- | --- |
| 1 | Poke | `pending-actions.ts` `startPending`, `poke` branch | camera, `pokeGlanceHold` | The mind's `touch-reaction` poke; Natural always glances |
| 2 | Emotion impulse | `startPending`, `emotion` branch, with the point from `impulses.ts` `trigger` | the emotion's `spec.glance`, mirrored by side; `faceHold`; none in the `slight` band | The mind's `face` `emotion`; Natural derives the glance from the band |
| 3 | Desktop wake | `startPending`, `react` `wake` | camera, `wakeGlanceHold` (1 s) | The mind's `desktop-reaction` `wake` |
| 4 | Screen change | `startPending`, `react` `screen-change` | `screenPoint()`, 0.4 s | The mind's `desktop-reaction` `screen-change` |
| 5 | Long pet end | `natural-motion.ts` `integrate` | camera, `petGlanceDurationSeconds` (1.2 s) after a pet over `longPetDurationSeconds` | Natural, from its own pet timing; skipped while cursor permission is `dismiss` |
| 6 | Chat sent and unfold | `natural-motion.ts` `integrate`, from the `chat` pending action that `setChat` pushes when `sentSeq` or `unfoldSeq` changes | the chat point; sent 0.6 to 3 s by word count after a 0.18 to 0.30 s delay drawn from `chatRandom`; unfold 0.8 s after 0.25 s | Natural, from raw sequence counters; skipped without a chat target, while talking, during a pet override, or during the long-pet glance |
| 7 | Idle act glances | `idle-activities.ts` `step`, from each clip's drawn `glances` | drawn from the order's seed for `look-around`, `check-in`, `peer`, `zone-out`, `nod-off`, and the voice cues `about-to-speak` and `let-go` | The mind's `idle-act` orders and posture `cue` intents |
| 8 | Wake from sleep | `idle-activities.ts` `wake` | camera, `IDLE_WAKE_SECONDS + 0.6` | The mind's `wake` intent or a rouse |
| 9 | Cue `glance` gesture | `cue-gestures.ts` `start` | side 0.35, 0.6 s | An ACT cue (`Stage.vue` `streamingControl.onSignal`) or the devtools override (`onGestureRequest`), through `StagePerformanceConductor` `gesture` straight to the scene, not through the mind |

Differences from the outline: the idle voice cues `about-to-speak` and `let-go` and the wake from sleep are glance callers the outline does not name, and the pet-end glance is decided by Natural, not by the mind.

### 2.2 Other writers of the gaze target

These are not `glance` calls, but each moves the gaze, so the arbiter must rank them:

- **Pet override** (`setOverride`, from `integrate`): a sustained target at the petting hand. It does not stop a later `glance` call: a poke or emotion during a pet saccades away from the hand until the next fixation.
- **Cursor notice** (`orient`, from `integrate` on a `notice` event): a direct saccade to the cursor. It is skipped only during the long-pet glance, so a noticed cursor cuts any other glance.
- **Aside attention** (`setAside`): sustained, from the resolver's `aside` attention (an ACT `look: away` cue or thinking). Glances still start during it and return to it.
- **Chat typing fixation, cursor pursuit, free fixation**: the autonomous draw in `drawTarget`, which runs only when a hold ends.
- **Attention shifts** (`beginAttentionShift`, from `NaturalAttentionShifts`): a free fixation drawn with a posture shift; skipped while the pet-end glance, a chat glance, a cue glance, or an idle act owns the eyes.
- **On MMD**, `MMDBody` aims the head and eyes from Natural's gaze target (`intent.gaze.on`), with walking's travel direction first (Precedence rule 9). It adds no glances.

### 2.3 The director's inputs

Every field of `BodyDirectorInput` in `packages/motion-driver-humanoid/src/director/index.ts`, by where it comes from in `MMD.vue`:

| Input | Source today | Kind | CM6b |
| --- | --- | --- | --- |
| `interactionSeq` | `noteInteraction()` on the mind's poke and pet start (`reactToTouch`) and on the host's drag release (`props.interactionSeq`, bumped by `apps/stage-tamagotchi/src/renderer/pages/stage.vue`) | Raw for the drag, intent-fed for the touch | CM6b2: from `attend` |
| `chatSendSeq` | A watch on `props.chatActivity.sentSeq` | Raw | CM6b2: from `attend` |
| `chatUnfoldSeq` | A watch on `props.chatTarget.visible` | Raw | CM6b2: from `attend` |
| `attendUntilMs` | The mind's `attend` (CM6a) | Intent | Folded into the new input |
| `performance.away` | `Stage.vue`'s resolver | Raw (the user left) | CM6b2: from the mind's presence answer |
| `performance.mode` | `Stage.vue`'s resolver | Resolved state | Stays world (D8) |
| `performance.attention` | `Stage.vue`'s resolver, read only by `attentionIntent` into `BodyIntent.attention` | Resolved state | CM6b2: leaves the director (D10) |
| `toolRequest` | `MMDBodyToolPort`: the model's `come_here`, `go_home`, `look_at` | Model request | Stays a request (D6); `look_at` gets a real realiser (D10) |
| `actionRequest` | ACT `action` labels, tools, debug, and the mind's `idle-clip` errands | Model, user, or mind request | Stays a request (D6) |
| `wander` | Natural's `idleErrand` from the mind's `idle-errand` `wander` | Intent | CM6b2: carries the mind's `pick` (D11) |
| `idle` | Natural's long idle states from the mind's idle policy | Intent | Unchanged |
| `dragging` | The host's `setStageDragging` while a drag runs | World: her body is held | Unchanged |
| `speaking` | `props.nowSpeaking` or mode `talking` | World: voice playback | Unchanged |
| `cursorX`, `cursorOnStage`, `cursorPoint`, `chatX`, `chatPoint`, `cameraPoint`, `ground`, `reach`, `rootX`, `homeX`, `locomotionMode`, `clipOwnsRoot`, `legLength`, `slots`, `roamMode`, `debugGoal`, `seed` | The stage world, settings, the gait, the lab | World | Unchanged (CM6a D14) |

`VISIT_SHARE` (0.6) is drawn from the director's own `rngState` when a wander in idle mode could visit.

CM5a added no director input: the groove's MMD form is the performer's `sway` act (`packages/motion-driver-humanoid/src/performance/acts.ts`). The owner gave no ruling on the cursor coupling (gaze D11); the braking ruling is the stop-early fix.

### 2.4 Findings

1. **The `look_at` tool does nothing visible.** `look_at` (`packages/stage-ui/src/tools/body.ts`) sets the director's `lookOverride` for `LOOK_OVERRIDE_MS` (8 s) and answers success. The override only changes `BodyIntent.attention`, and nothing realises `BodyIntent.attention`: `MMDBody` aims from Natural's gaze, and the only readers are `resolveBodyTarget` (diagnostics, overlays, and the headless trace) and its test. The model is told she looked when she did not.
2. **Under MMD's classic driver the director still runs** for stance clips and clip performances (`stance.update` in `MMD.vue`'s render loop has no driver gate). A drag release, a sent message, an opened chat, and `away` end classic clips today. Moving those inputs onto intents that the conductor sends only under Natural changes that (D9).
3. **One stimulus, two deciders, for `away`.** The resolver's `away` edge goes to the mind (`answerPresence`), which decides sleep and the return, and also straight to the director, which ends a performance and refuses clips. This is the shape Autonomous behavior Target rule 2 removes.

## 3. The design

### 3.1 The split: the mind decides episodes, the performers play frames

| Decided by the mind, on its clock | Realised by the performers |
| --- | --- |
| That a sent message or an opened chat gets a chat read (`chat-read`), and that she attends to the user because of it (`attend`) | Natural: the read's delay and hold, whether a chat target exists, talking, and the arbiter. The director: ending looping or unasked clips, the walk to the chat |
| That an ACT cue gesture plays (`gesture`) | Natural: the gesture's shape, and the glance through the arbiter |
| That she attends to the user after a touch or a drag, with its cause (`attend`) | The director: which clips that ends, the chase |
| That the user is away (`away`) | The director: ending a performance, refusing clips |
| That a wander may become a visit (the wander's `pick`) | The director: whether a visit is possible in its world, where it goes, and the linger |
| Nothing about which glance wins | Natural's gaze arbiter: every glance, by priority, at frame time |

### 3.2 The gaze arbiter

**Owner (D2).** `NaturalGazeLayer` is the one owner of the gaze channel under Natural, on both renderers. It already is the only writer (Body ownership Target rule 3); what it lacks is a rule between its inputs. The arbiter lives there, at frame rate, on Natural's active seconds. The mind decides which responses include a glance only by deciding the response itself; it does not rank glances. A glance's hold ends on Natural's clock, which freezes while the scene is suspended, so only the performer knows which glance still holds.

**Interface.**

```ts
export type GlanceSource
  = | 'pet-end' | 'poke' | 'desktop-wake' | 'sleep-wake' | 'chat-sent' | 'chat-unfold' | 'voice-cue'
    | 'look-tool' | 'cue-gesture' | 'emotion' | 'screen-change' | 'cursor-notice' | 'idle-act'

/** Higher wins. One table, beside the gaze constants. */
export const GLANCE_PRIORITY: Readonly<Record<GlanceSource, number>>

/** The new and changed members of `NaturalGazeLayer`. */
export interface NaturalGazeArbiter {
  glance: (request: { source: GlanceSource, point: GazePoint, hold: number }, at: number) => number | null
  orient: (at: number) => boolean
  readonly claim: Readonly<{ source: GlanceSource, until: number }> | null
}
```

`glance` returns the hold's end, or `null` when it refused the request. `orient` returns whether the notice saccade started. `claim` is the running glance until its hold ends, `endHold` runs, or an override or aside change starts a new fixation.

**Priorities (D3).** Highest first:

| Priority | Sources | Why |
| --- | --- | --- |
| 7 | `pet-end`, `poke` | The user's hand on her |
| 6 | `desktop-wake`, `sleep-wake` | She meets the user on a return or on waking |
| 5 | `chat-sent`, `chat-unfold`, `voice-cue` | The user wrote to her, or she is about to speak or has just declined |
| 4 | `look-tool` (CM6b2), `cue-gesture`, `emotion` | The model's cues |
| 3 | `screen-change` | Something changed on the desktop |
| 2 | `cursor-notice` | A noticed cursor; the episode still engages, and the autonomous draw picks the cursor after the hold |
| 1 | `idle-act` | Her own idle acts, which already wait while `blocked` |

**Rules.**

1. A request starts when no claim holds or the running claim's priority is not higher; it then replaces the running claim. Equal priority keeps "the latest wins", which is right within a class (two pokes, two chat reads).
2. A request below the running claim is refused: dropped, not queued. The rest of the caller's episode still plays (the poke nudge, the impulse, the act). A refused cue `glance` gesture ends at once. A queued glance would land after the moment it answers.
3. While a pet override holds, every request but `pet-end` is refused (D4). This enforces Precedence rule 14's ruling "no look-up and no camera snap while a pet runs", which today a poke or emotion during a pet breaks.
4. Aside attention refuses nothing; a glance returns to the aside fixation, as today. The typing fixation, cursor pursuit, and free fixation rank below every glance, as today.
5. Every start and every refusal is an observer event: `NaturalGlanceEvent` gains every source as `cause` and an `outcome` of `started` or `refused`. That is the refusal report ADR decision 6 asks for; no report goes to the mind, because no mind policy reads it.

The ad hoc guards that the rules replace go: the chat glance's `petOverride` and `petGlanceUntil` checks and the `petGlanceUntil` check on `orient`. The `talking` check on chat glances and the idle layer's `blocked` input stay: they decide whether an episode starts, not which glance wins.

### 3.3 Chat activity as a stimulus

`Stage.vue` already hears both events once per window: `chatComposerSentEvent` (it bumps `chatSentSeq`) and `chatTarget.visible` turning on. It sends each to the mind through the conductor:

```ts
/** Added to `MindStimulus`. */
type ChatStimulus
  = | { kind: 'chat', cue: 'sent', words: number }
    | { kind: 'chat', cue: 'unfold' }
/** Added to `MindIntent`. */
type ChatReadIntent = IntentBase & { channel: 'gaze', kind: 'chat-read', cue: 'sent' | 'unfold', words: number }
```

The `chat` stimulus replaces `{ kind: 'interaction', source: 'chat-send' }` (D5); `interaction` keeps only `drag`. In CM6b1 the mind answers `sent` with `chat-read` and today's `attend`, and `unfold` with `chat-read`. CM6b2 adds the body answer for `unfold` (section 3.5).

`StagePerformanceConductor` `chat(cue, words)` steps the mind under every driver and sends `chat-read` to `scene.chatRead` only under Natural. Natural's `chatRead(order)` queues the same `chat` pending action that `setChat` queued on a sequence change, so the delay draw on `chatRandom` and the hold are unchanged. `NaturalChatInput` loses `sentSeq` and `unfoldSeq`; it keeps `target` and `typing`, which are continuous frame inputs. The Live2D model's unfold counter (`createUnfoldCounter`) goes, and `natural-chat-input.ts` stops carrying sequences. The MMD scene keeps its own unfold counter and `sentSeq` watch for the director until CM6b2.

The mind decides little here; the value is that one stimulus reaches one decider, which answers on every channel. With two stages mounted, each stage's conductor steps the mind once, as for CM6a's chat send; each stage reads the chat once, which is harmless.

### 3.4 ACT cue gestures as a stimulus

```ts
/** Added to `MindStimulus`. */
interface CueGestureStimulus { kind: 'cue-gesture', gesture: CueGestureKind, count: number, source: 'act' | 'devtools', turnId?: string }
/** Added to `MindIntent`. */
type GestureIntent = IntentBase & { channel: 'posture', kind: 'gesture', gesture: CueGestureKind, count: number }
```

`StagePerformanceConductor` `gesture` steps the mind under every driver and sends the `gesture` intent to `scene.gesture` only under Natural, as today's gate does. `Stage.vue`'s ACT handler and the devtools `onGestureRequest` both call it. The ACT handler still calls `gesture` before `action`, so the MMD scene can record a gesture as superseded by a clip, as today.

The mind answers every cue gesture with one `gesture` intent; it decides nothing new yet. The point is the path: Autonomous behavior Target rule 7 (the mind issues only declared capabilities) needs every ACT body cue to pass through `step`, and CM7 adds the capability check there.

Out of scope (D6): ACT `action` labels and the body tools stay requests that the MMD scene hands the director, and ACT `look` stays a resolver input (`cueAttention`).

### 3.5 The director on intents (CM6b2)

**Attend with a cause (D7).** The `attend` intent says why she attends and to what:

```ts
/** Replaces today's `attend` in `MindIntent`. */
type AttendIntent
  = | (IntentBase & { channel: 'body', kind: 'attend', target: 'cursor', cause: 'touch' | 'drag' | 'chat-send', windowMs: number })
    | (IntentBase & { channel: 'body', kind: 'attend', target: 'chat', cause: 'chat-unfold' })
```

A poke and a pet start give `touch`, a drag release `drag`, a sent message `chat-send`, all with `ATTEND_WINDOW_MS`; an opened chat gives `target: 'chat'`. `BodyDirectorInput` replaces `interactionSeq`, `chatSendSeq`, `chatUnfoldSeq`, and `attendUntilMs` with one field fed only by those intents:

```ts
attend: {
  /** Director time until which she may walk toward the cursor, or null. */
  untilMs: number | null
  /** Counts `touch` and `drag` attends: a new value ends a broad clip. */
  touchSeq: number
  /** Counts `chat-send` and chat attends: a new value ends a looping or unasked clip. */
  chatSeq: number
  /** Counts chat attends: a new value asks for the walk to the chat. */
  chatOpenSeq: number
}
```

The director keeps its clip rules; only their source changes. `MMDAttendWindow` in `stance.ts` becomes `MMDAttendInbox`, which stamps the window and counts the causes. `MMD.vue` loses `interactionSeq`, `chatSendSeq`, the `props.interactionSeq` watch, the `sentSeq` watch, the unfold counter, and `noteInteraction`. The `interactionSeq` prop of `MMD.vue` goes; `Stage.vue` keeps its own `interactionSeq` prop and sends `interaction('drag')`. The drag watch also set `dragging = false`; the host's `setStageDragging(false)` at release already does that, so the line goes with the watch.

**`away` from the mind (D8).** `answerPresence` adds `{ channel: 'body', kind: 'away', away }` to its answer on every away edge. The conductor sends it to `scene.setAway` only under Natural, and seeds a newly attached scene, or one whose driver became Natural, with the mind's current `presence.away`, as it reseeds the idle view. `BodyDirectorInput.away: boolean` replaces `performance.away`, and `performance` narrows to `Pick<PerformanceState, 'mode'>`. Mode stays world: it is a continuous state both performers sample each frame (speaking, listening, thinking), and moving the resolver into the mind is its own change (follow-up).

**The look tool through the arbiter (D10).** `BodyIntent.attention` becomes `look: { seq: number, target: BodyLookTarget, holdMs: number } | null`, present while the tool's override holds. The director keeps the tool's refractory and refusals. The MMD scene hands each new `look.seq` to Natural's new `look(target, holdSeconds)`, which asks the arbiter for a `look-tool` glance: camera at the camera point, `chat` at the chat point, `cursor` at the mapped cursor, `away` at the aside point with a drawn side. A missing chat or cursor makes it a refusal event. `attentionIntent` and `lookIntent` move out of the director into `resolveBodyTarget` (`stage-ui-mmd` `body/attention.ts`), which keeps computing the same diagnostics and trace point from the resolver's attention and the look target. The headless trace stays byte-identical.

**The visit share from the mind's pick (D11).** `BodyDirectorInput.wander` becomes `{ seq: number, pick: number }`; `naturalWander` forwards the errand's `pick`, which the mind drew on its idle stream. In idle mode a possible visit is taken when `pick < VISIT_SHARE`, with no draw from `rngState`. The share, the watching rule, and the visit geometry stay in the director. The director's later draws (the wander's x, the linger) shift by one draw in that case.

### 3.6 The classic driver (D9)

The conductor sends every new intent only under Natural, as it does `attend` since CM6a D13 (Body ownership Target rule 1). Under MMD's classic driver the director then gets no attend counters and `away` stays false: a classic clip ends only on its feedback, its watchdog, a tool or debug stop, or a newer request. It no longer ends on a drag release, a sent message, an opened chat, or the user leaving, and the walk to the chat never ran under classic. CM7 decides whether the fork's director runs under classic at all.

### 3.7 The headless runner

The runner plays touches, emotions, and gestures on the adapter directly, so it keeps doing that: `gesture` stays a realiser method. Its `chat` cue with `unfold` calls the adapter's `chatRead` at the cue time instead of bumping `unfoldSeq`. It passes `attend: { untilMs: null, touchSeq: 0, chatSeq: 0, chatOpenSeq: 0 }` and `away: false`, and `resolveBodyTarget` keeps its trace point.

## 4. Where the code lives

| Path | Change | Upstream file |
| --- | --- | --- |
| `packages/motion-driver-natural/src/gaze.ts` | `GlanceSource`, `GLANCE_PRIORITY`, the arbiter [1, 2]; `look` support [10] | No |
| `packages/motion-driver-natural/src/pending-actions.ts`, `natural-motion.ts`, `idle-activities.ts`, `cue-gestures.ts`, `frame-types.ts` | Sources [1]; refusals and guards [2]; `chatRead`, no sequences [3]; `look` [10] | No |
| `packages/character-mind/src/types.ts`, `step.ts`, `attention.ts`, `touch.ts`, `presence.ts`, `index.ts`, new `chat.ts` | `chat` and `cue-gesture` stimuli, `chat-read` and `gesture` intents [3, 4]; attend causes [8]; `away` [9] | No |
| `packages/motion-driver-humanoid/src/director/index.ts`, `types/index.ts` | `attend` input [8]; `away` [9]; `look` [10]; `wander.pick` [11] | No |
| `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts`, `use-motion-qa-events.ts` | `chat`, mind-routed `gesture` [3, 4]; `away` dispatch [9] | No |
| `packages/stage-ui/src/components/scenes/Stage.vue` | Send `chat` sent and unfold [3]; the ACT and devtools gestures already call the conductor [4] | Yes: the fork's stage wiring lives here already, and both chat events are heard only here |
| `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`, `Live2D.vue`, `composables/live2d/natural-motion-adapter.ts`, `natural-chat-input.ts`, `stores/natural-motion-diagnostics.ts` | `chatRead` forwarded; no unfold counter [3] | `Model.vue` and `Live2D.vue`: yes, for one forwarded method and one removed counter |
| `packages/stage-ui-mmd/src/components/scenes/MMD.vue`, `composables/mmd/natural/adapter.ts`, `composables/mmd/stance.ts`, `composables/mmd/body/attention.ts` | `chatRead` [3]; the attend inbox, no raw counters [8]; `setAway` [9]; `look` hand-off, `resolveBodyTarget` [10]; `pick` [11] | `MMD.vue`: yes, its director wiring is fork code inside it |
| `packages/qa-tools/src/t2-3d/runner/run.ts`, `runner/cues.ts` | `chatRead` [3]; the new inputs [8, 9] | No |
| `packages/motion-driver-natural/AGENTS.md` | One rule [5] | No |

## 5. What is deleted

- The `source?: 'chat'` optional argument of `glance` [1]; the chat glance's `petOverride` and `petGlanceUntil` checks and `orient`'s `petGlanceUntil` check [2].
- `NaturalChatInput.sentSeq`, `unfoldSeq`, the seq baselining in `setChat`, and the Live2D `createUnfoldCounter` use [3]; the `interaction` `chat-send` source [3].
- `BodyDirectorInput.interactionSeq`, `chatSendSeq`, `chatUnfoldSeq`, `attendUntilMs`, `performance.away`, `performance.attention`; `BodyIntent.attention`; `BodyDirectorMemory.lastInteractionSeq`, `lastSendSeq`, `lastUnfoldSeq`; the director's `attentionIntent`, `lookIntent`, and `VISIT_SHARE` draw; `MMD.vue`'s `interactionSeq` prop, counters, watches, and `noteInteraction` [8 to 11].

After CM6b2, `git grep -nE "interactionSeq|chatSendSeq|chatUnfoldSeq|attendUntilMs|lastInteractionSeq" -- packages ':!*.md'` prints only `Stage.vue`'s and the host page's `interactionSeq` (the host's drag release counter).

## 6. Docs that move with the code

Policy docs change in the commit that makes their statement false; the item is in brackets. Run `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after each policy doc edit.

- **`docs/ai/context/autonomous-behavior.md`.** [2] Precedence rule 5's gaze order gains the arbiter's priorities, and a new Precedence rule (21 on this base) states the arbiter. The Desktop reaction row stops saying "it calls `NaturalGazeLayer` `glance` directly"; the Emotion impulse and Idle activity rows name the arbiter. Overlap 7 leaves Known overlaps, and its row leaves the Target table. Target rule 2 notes that glances landed. [3, 4] The Deciders rows and rule 20 say that a sent message reaches the mind as `chat`, and a new Precedence rule (22) states the `chat` and `cue-gesture` stimuli. [8 to 11] The Body director and Locomotion rows, Precedence rules 8 and 20, and Target rule 5 say that the director reads the user only through `attend` and `away`, and that the visit share comes from the wander's pick.
- **`docs/ai/context/body-ownership.md`.** [2] The Live2D and MMD gaze rules state the arbiter as the gaze channel's one owner, with the priority table; Target rule 3 notes that the gaze channel landed. [8 to 11] Target rule 8 moves into the MMD sections, stating which inputs are intents, which are requests (D6), and which are the world, and what classic gets (D9).
- **`docs/ai/context/glossary.md`.** New terms **Glance** and **Gaze arbiter**. Stimulus (`chat`, `cue-gesture`; `interaction` without `chat-send`; the count); Intent (`chat-read`, `gesture`, `attend` with target and cause, `away`); Attend window (its causes); Channel (gaze names its owner).
- **`docs/ai/context/character-mind-roadmap.md`.** [6] The CM6b row splits into CM6b1 (done) and CM6b2; CM7 depends on CM6b2. [12] CM6b2 done. The Feature row "Screen-aware attention on real rigs" waits for CM6b2.
- **READMEs.** `packages/motion-driver-natural/README.md` (the arbiter, `chatRead`, `look`) [2, 3, 10]; `packages/character-mind/README.md` (stimuli and intents) [3, 4, 8, 9]; `packages/motion-driver-humanoid/README.md` (the input list) [8 to 11]; `packages/stage-ui-mmd/README.md` (`resolveBodyTarget`, the inputs) [8, 10]; `packages/stage-ui-live2d/README.md` (chat reads) [3]; `packages/stage-ui/README.md` (the conductor's `chat`, `gesture`, `away`) [3, 4, 9]; `packages/qa-tools/README.md` (chat cues) [3].
- **Nested guidance** [5]: `packages/motion-driver-natural/AGENTS.md` gains "Every glance names a `GlanceSource` and goes through `NaturalGazeLayer` `glance`; rank a new caller in `GLANCE_PRIORITY` instead of adding a guard at the caller." A `chore(agents)` commit of its own.
- **ADRs** [6, 12]: CM6b1 writes `docs/ai/adr/<date>-character-mind-glances.md`, and CM6b2 writes `docs/ai/adr/<date>-character-mind-director-intents.md`. Each records its decisions as taken or vetoed. The second supersedes the clip actions ADR's and the locomotion ADR's statements that the director reads touches, drags, chat, and `away` directly. Existing ADR bodies are not edited.

### 6.1 Files the parallel work also edits

- **The stop-early fix:** `director/index.ts` and its tests, `press.test.ts`, possibly `stance.ts`, `MMD.vue`'s director world, and the runner's world; `autonomous-behavior.md` (the Locomotion row and the cursor stop bullet of Precedence rule 8); the roadmap's CM6a row. CM6b1 touches none of the director files; CM6b2 is cut after the fix lands and keeps the fix's gait input as world.
- **The upstream sync:** none of the files in section 4 (section 1).
- **CM5b:** `idle-activities.ts` (the `sway` act; CM6b1 changes only the glance calls), possibly `character-mind` `types.ts` and `step.ts` (both add `else if` branches; keep both), `autonomous-behavior.md` (CM6b's new rules take the next free numbers), and the roadmap.

## 7. Work items

Each item is one commit that passes `pnpm verify` and `pnpm verify --gate`.

### CM6b1: glances (branch `luke/feat/character-mind-glances-arbiter`, from `main` after the fix and the sync)

1. **`refactor(motion-driver-natural): name the source of every glance`.** `GlanceSource` and the required request object at every call site; no arbitration. Tests: unchanged pins. Acceptance: `qa:motion3d diff` prints `IDENTICAL` for all nine scenarios against the base.
2. **`feat(motion-driver-natural): arbitrate glances by priority`.** Section 3.2. Docs `[2]`. Tests in `gaze.test.ts`: each pair across classes, in both orders, starts the higher and refuses the lower; equal priority replaces; a refused request leaves the running hold's end unchanged; the pet override refuses all but `pet-end`; `orient` is skipped while a higher claim holds. In `natural-motion.test.ts`: a poke during a pet nudges but does not glance; a chat read holds through an emotion impulse; a noticed cursor during an emotion glance engages after the hold. Every glance emits a `started` or `refused` event. Acceptance: section 8.
3. **`feat(character-mind,motion-driver-natural,stage-ui,stage-ui-live2d,stage-ui-mmd,qa-tools): move chat activity into the character mind`.** Section 3.3. Docs `[3]`. Tests: `chat.test.ts` (Node): `sent` answers `chat-read` with its words and one `attend`, `unfold` answers `chat-read` only, and neither draws from `rng`; the conductor test sends `chat-read` only under Natural and steps the mind under every driver; Natural's `chatRead` queues the same pending action as the old sequence change (an existing chat glance test, ported). Acceptance: `IDENTICAL` against item 2 for all nine.
4. **`feat(character-mind,stage-ui): route ACT cue gestures through the character mind`.** Section 3.4. Docs `[4]`. Tests: the mind answers each cue gesture with one `gesture` intent; the conductor sends it only under Natural; the devtools override browser test still sees the gesture played. Acceptance: `IDENTICAL` against item 3.
5. **`chore(agents): say that every glance goes through the gaze arbiter`.**
6. **`docs(ai): record the glance decisions and close overlap 7`.** The CM6b1 ADR and the roadmap `[6]`, after section 8's CM6b1 checks pass.
7. **`docs(plan): mark the glances half of CM6b done`.** This plan: Status, Departures, Checks run, Commits.

### CM6b2: the director on intents (branch `luke/feat/character-mind-director-intents`, after CM6b1 merges)

- Item 11. **`refactor(motion-driver-humanoid,stage-ui-mmd): draw the visit share from the mind's wander pick`.** Section 3.5 last paragraph. Tests: a visit is taken for `pick` 0.59 and not for 0.61; the director draws one value fewer in that case; seeded director tests whose linger or wander x moved are re-pinned once, with the reason in the commit body. Acceptance: `IDENTICAL` for all nine (no headless scenario wanders; confirm in the run's events).
- Item 8. **`feat(character-mind,motion-driver-humanoid,stage-ui,stage-ui-mmd,qa-tools): end the director's clips and approach the chat on the mind's attend intents`.** Section 3.5 first part. Docs `[8]`. Tests: the mind's causes and targets for poke, pet start, pet end (none), drag, sent, unfold; the existing clip-ending and approach-chat cases in `director/index.test.ts` and `stance.test.ts` move to `attend` with the same expectations; the conductor sends `attend` only under Natural. Acceptance: `IDENTICAL` for all nine.
- Item 9. **`feat(character-mind,motion-driver-humanoid,stage-ui,stage-ui-mmd,qa-tools): take away from the mind's presence answer`.** Docs `[9]`. Tests: `answerPresence` adds one `away` on each edge; the conductor seeds a newly attached scene; the director's away cases move to `away`. Acceptance: `IDENTICAL` for all nine.
- Item 10. **`feat(motion-driver-natural,motion-driver-humanoid,stage-ui-mmd,qa-tools): realise the look tool through the gaze arbiter`.** Docs `[10]`. Tests: `look` for each target starts a `look-tool` glance of 8 s; a missing chat or cursor is refused; a poke cuts it; `resolveBodyTarget` returns the same points as before for every attention and look case. Acceptance: `IDENTICAL` for all nine.
- Item 12. **`docs(ai): record the director input decisions and close CM6`.** The CM6b2 ADR; Target rule 8 moves; the roadmap `[12]`.
- Item 13. **`docs(plan): mark the glances slice of the character mind done`.**

**Order.** CM6b1: 1, 2, 3, 4, 5, 6, 7. CM6b2: 11, 8, 9, 10, 12, 13. Item 11 goes first because it is small and independent.

## 8. Checks

- **Each commit:** `pnpm verify`, then `pnpm verify --gate`. Inner loops: `pnpm -F @proj-airi/motion-driver-natural exec vitest run src/gaze.test.ts src/natural-motion.test.ts src/idle-activities.test.ts src/cue-gestures.test.ts`; `pnpm -F @proj-airi/character-mind exec vitest run src`; `pnpm -F @proj-airi/motion-driver-humanoid exec vitest run src/director`; `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance/use-stage-performance-conductor.test.ts`; `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node src/composables/mmd`.
- **Policy docs:** the policy-docs test after each policy doc edit and at each tip.
- **Smoke on both hosts**, with `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL` from `.env.qa`: `pnpm qa:display run -- pnpm qa:smoke` and `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"`.
- **Headless rigs.** `pnpm qa:live2d-rig` keeps its trace hash at every item: its trial has one emotion and no other glance, so nothing collides. If it moves, stop and find why. `pnpm qa:test:model` passes.
- **Headless motion.** Base runs from `pnpm wt new cm6b-base --base <CM6b1's base> --branch luke/tmp/cm6b-base --qa`, removed with `pnpm wt rm cm6b-base`. Runs: `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario <name> --seed 1 --out <dir>` for `idle`, `idle-drive`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, and `touch`.
  - Items 1, 3, 4, and 8 to 11: `IDENTICAL` against the previous item for all nine.
  - Item 2: `DIFFERENT` is expected where two glances overlap: `gaze-shift` (the chat unfold against cursor notice), `touch` (a poke against an emotion), `emotions`, and `gesture-under-clip` (the `glance` gesture). Any other scenario that differs is a defect. For each scenario that differs, `pnpm qa:motion3d gate <run>` and `pnpm qa:motion3d report gaze-order <run>` must read the same status on every line at both ends; record the refusal events by source.
  - **Seed sweep.** If a status differs, run seeds 1 to 5 at both ends. A flip that follows a refusal the arbiter's table predicts is the rule working; an unexplained flip is a defect. Stop on a defect; never retune a gate or report (motion QA skill).
  - Required wording for each PR: "Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review."
- **Rendered checks, CM6b1.** A driver under `.temp/cm6b/`, not committed, modeled on `.temp/cm6/driver.ts`, inside `pnpm qa:display run --name cm6b -- ...`; stop with `pnpm qa:display down --name cm6b`. The driver prints no model path.
  1. **Live2D Natural.** Open the chat and send a message: one `mind` event with a `chat` `unfold` stimulus and a `chat-read` intent, then one with `sent`, a `chat-read`, and an `attend`; each followed by a `glance` event with `outcome: 'started'`.
  2. **Collisions.** Poke during a devtools `look-around`: the poke glance starts and the act's next glance is refused. Pet for 5 s while devtools pulses an emotion: no glance starts during the pet, the emotion's glance is refused, and the pet-end glance starts.
  3. **Cue gesture.** A devtools `glance` gesture: a `cue-gesture` stimulus, a `gesture` intent, and a started glance.
  4. **Universal.** Repeat step 1: `chat` stimuli, no `chat-read` dispatched, no glance events.
  5. **MMD Natural, desktop stage.** Step 1 again: the same events.
- **Rendered checks, CM6b2.**
  6. **Clip endings.** With a looping debug clip playing under Natural: a drag release ends it; with it again, a sent message ends it; with it again, opening the chat ends it and `placement()` shows `reason: approach-chat`. Each has a `mind` event with its `attend` cause.
  7. **Away.** If the driver can fake the desktop activity snapshot, lock it while a looping clip plays: an `away` intent and the clip ends. If it cannot, record the step as not exercised and rely on item 9's tests.
  8. **Look tool.** A replayed turn that calls `look_at` with `chat`: Natural's gaze target becomes `glance` with source `look-tool` and the eyes move to the chat for about 8 s. Before the change, record that the gaze did not move.
  9. **Classic (D9).** Under classic, the drag release no longer ends a looping clip. Record it; it is the expected change.
  Every launch: 0 renderer and 0 main-process errors.
- Record run directories, gate and report lines, refusal counts, and event excerpts (kinds and counts, no content) in each PR description.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| A refused glance makes her look unresponsive: a model cue during a chat read never shows its glance | The rest of the cue plays; the priority table is a decision (D3); refusal events show how often it happens in the rendered run |
| The pet rule (D4) hides a glance users expect, such as a poke's look during a pet | It enforces the existing ruling; owner decision |
| Item 2 changes several traces and hides a real fault | `gaze-order` and the gate must read the same statuses; refusals are logged by source; the seed sweep |
| The chat read moves one frame | The pending action is the same; item 3 must read `IDENTICAL`; if one frame moves, explain it and require equal statuses, as CM6a's item 3 did |
| A scene attached after an away edge never learns `away` | The conductor seeds it from the mind's presence state; a test covers attach and the switch to Natural |
| Classic clips stop ending on user activity (D9) | Owner decision; recorded in the ADR and the MMD README; CM7 decides the classic director's place |
| The look tool now cuts other glances for 8 s at priority 4 | A touch, a wake, or a chat read still outranks it; owner question if it feels too long |
| Rebase conflicts with the stop-early fix and CM5b | Section 6.1; CM6b2 is cut after the fix lands |

## 10. Follow-ups this plan does not do

- ACT `look` (the resolver's `cueAttention`) through the mind.
- The performance resolver in the mind, which moves `mode` and Natural's own `away` read.
- Whether the pet-end glance is a mind decision on the pet's duration.
- The director's linger and wander x draws on the mind's stream.
- A refusal report from the arbiter to the mind, if a policy needs it (CM7's capability reports).
- The tool result for `look_at` when the arbiter refuses it.
- The cursor coupling question (gaze D11).

## Decisions for the owner

| # | Fork | Options | Trade-off | Recommendation |
| --- | --- | --- | --- | --- |
| D1 | Split CM6b | (a) One PR; (b) CM6b1 glances (arbiter, chat and cue-gesture stimuli) and CM6b2 the director on intents, each with its own ADR; (c) the arbiter alone, then everything else | (a) puts three wide commits (the arbiter, the chat move, the director move) in one PR, across Natural, the mind, both scenes, the director, and the runner. (c) splits the chat stimulus across PRs without a gain. (b) gives each PR one Done-when clause | (b) |
| D2 | Who owns the gaze arbiter | (a) Natural's gaze layer, at frame rate; (b) a gaze policy in the mind with report-and-order; (c) (a) plus refusal reports to the mind | (b) needs every hold's end on Natural's clock, which freezes on suspension, plus idle act and chat delay timing the mind does not have: a report loop for every glance. (c) adds a report nobody reads yet | (a) |
| D3 | The priority rule and table | (a) Section 3.2's seven classes, the higher or equal wins, the lower is dropped; (b) the same, but the lower waits for the hold to end; (c) keep "latest wins" with targeted guards | (b) shows glances late, after the moment they answer. (c) is today's overlap 7 | (a), with the table as written |
| D4 | Glances during a pet | (a) The pet override refuses every glance but `pet-end`; (b) today's: a poke or emotion glance cuts through the pet | (a) enforces the "no look-up, no camera snap while a pet runs" ruling, which (b) breaks today, and is user-visible | (a) |
| D5 | The chat stimulus | (a) One `chat` stimulus (`sent`, `unfold`) replacing `interaction` `chat-send`; (b) keep `interaction` `chat-send` and add `chat` for the glance | (b) gives one user act two stimuli and two steps | (a) |
| D6 | What else comes through the mind | (a) Only cue gestures; ACT `action` labels and body tools stay requests the director takes, and ACT `look` stays a resolver input; Target rule 8 is stated as "intents, requests from the model or the user, and the world"; (b) also route ACT actions and body tools through the mind as intents | (b) is a pass-through for each, with the tools' synchronous answers and refusal reasons to carry, and no decision for the mind yet. (a) needs Target rule 8's wording to name requests | (a) |
| D7 | How clip endings reach the director | (a) `attend` carries a cause and a target, and the director keeps its clip rules; (b) the mind emits an explicit "end these clips" intent | (b) moves a clip policy into the mind, against ADR decision 5 (clip choices are the renderer's) | (a) |
| D8 | `away`, `mode`, and `attention` in the director | (a) `away` from the mind's presence answer, `mode` stays world, `attention` leaves the director; (b) all three from the mind, by moving the performance resolver into it; (c) all three stay resolver state | (b) is its own slice, with per-stage inputs (visibility, cursor moves) that touch the ADR's open per-window question. (c) leaves the two-decider `away` (finding 3) | (a) |
| D9 | MMD's classic driver | (a) New intents only under Natural: classic clips stop ending on drags, chat, and away; (b) send the director's intents under every MMD driver and amend Body ownership Target rule 1; (c) keep raw inputs under classic only | (a) is consistent with Target rule 1 and CM6a D13, and changes a non-default driver visibly. (b) keeps classic as it is but contradicts rule 1. (c) is the compatibility path the roadmap forbids | (a); CM7 decides whether the director runs under classic at all |
| D10 | The `look_at` tool and `BodyIntent.attention` | (a) Realise the tool as a `look-tool` glance through the arbiter, and replace `BodyIntent.attention` with `look`; (b) delete `BodyIntent.attention` and stop offering `look_at`; (c) leave both as they are | (c) keeps telling the model she looked when she did not (finding 1). (b) removes a tool the model has | (a) |
| D11 | The `VISIT_SHARE` draw | (a) Use the mind's wander `pick` against `VISIT_SHARE` in the director; (b) the mind decides a `visit` flag; (c) keep the director's draw | (b) needs the mind to know whether a visit is possible, which is the director's world. (c) keeps a second source for an idle decision | (a) |

## Departures during implementation (CM6b1)

1. **Item 4 extended the ESLint boundary.** The character mind's type-only import exception now also names `/cue-gestures`, so the mind types can name `CueGestureKind`. Runtime imports from Natural stay forbidden.
2. **Item 3 moved `speak`.** The headless runner's chat cue now hands an unfold to the adapter as a read, so the `speak` scenario's unfold reads the chat as the app does. `speak` joins item 2's expected differences.
3. **The Live2D rig's trace hash moved at item 2, though its motion did not.** Every channel of the rig trace is bit-identical between items 1 and 2. The trace now lists the emotion glance as an observer event, which item 2 added on purpose, and the hash covers the event list.
4. **The headless runs compared the slice's base with its tip,** instead of each item with the one before. Only `speak` differed.
5. **The rendered checks ran on macOS without a QA display:**
   - Chat activity went through the motion QA bridge's scenario events, `chat-target`, `chat-unfold`, and `chat-sent`. They call the same conductor `chat` that the stage's chat hooks call, so no model provider was needed.
   - Pokes and pets were CDP presses at her head, while the real cursor was warped along with each stroke. While the user is active, attention is `cursor` only while the real cursor moves, and the pet override needs that attention. Without the warp, the pet could not hold her gaze, as designed.
   - Devtools requests went through the driver's own BroadcastChannel to the lab's events.
   - The desktop idle time was pinned at 0 s, so she stayed present.

## Checks run (CM6b1)

- **Each item:** the worker ran the inner loops, the full node projects of the touched packages, the dependents' typechecks, and the policy-docs test for items 4 and 5. `pnpm verify --gate` ran on the rebased tip; see the PR.
- **Headless, base `bb576288a` against tip `7f239f4d1`, seed 1:** `idle`, `idle-drive`, `gaze-shift` (determinism verified), `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, and `touch` are `IDENTICAL`.
  - `speak` is `DIFFERENT` from 32.08 s in `rot` and in its events; `root` and `channels` are identical.
  - `lab:motion3d gate` reads PASS on all 7 lines at both ends, and `gaze-order` finds no qualifying episode at either end.
  - No seed sweep was needed.
- **The Live2D rig:** the same channels; the trace hash moved (Departure 3).
- **Rendered, Live2D rig, Natural:**
  - Step 1: an opened chat and a sent message each gave one `chat` step (`chat-read`, then `chat-read` and `attend`), and each was followed by a started glance (`chat-unfold` at 0.79 s, `chat-sent` at 3.34 s).
  - Step 2: a poke 1.3 s into a devtools look-around started its glance over the act's, and a noticed cursor 0.8 s later was refused. During a 9.4 s pet, an emotion pulsed at 2 s into it was refused, the pet-end glance started at its end, and a noticed cursor 0.2 s later was refused.
  - Step 3: a devtools `glance` gesture gave a `cue-gesture` step with one `gesture` intent and a started glance.
  - Step 4: under Universal, both `chat` steps and their `chat-read` intents, and no glance.
- **Rendered, MMD on the desktop stage, Natural:** step 1 gave the same two `chat` steps and intents.
- Every launch had 0 renderer and 0 main-process errors.
- **The required wording:** "Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review."

## Commits (CM6b1)

- `a54d2f4ea` docs(plan): add the plan for the glances slice of the character mind
- `ea4c1f74d` refactor(motion-driver-natural): name the source of every glance
- `d576385f1` feat(motion-driver-natural): arbitrate glances by priority
- `1727104cb` feat(character-mind,motion-driver-natural,stage-ui,stage-ui-live2d,stage-ui-mmd,qa-tools): move chat activity into the character mind
- `9db8f8c1a` feat(character-mind,stage-ui): route ACT cue gestures through the character mind
- `7f239f4d1` chore(agents): say that every glance goes through the gaze arbiter
