# character-mind-performers - Work Plan

Status: CM7a and CM7d implemented on 2026-11-22. CM7d's headless, rig and rendered acceptance is assigned to the orchestrator. The owner approved every recommended option, D1 to D12, on 2026-11-21. c6 landed separately; CM7b and the remainder of CM7c are not implemented in this worktree. The [roadmap](../../docs/ai/context/character-mind-roadmap.md#steps) tracks the four parts.

Status: CM7a and CM7b implemented on 2026-11-22, with headless and rendered acceptance assigned to the orchestrator. The owner approved every recommended option, D1 to D12, on 2026-11-21. c6 landed separately; the remainder of CM7c and CM7d are not implemented here. The [roadmap](../../docs/ai/context/character-mind-roadmap.md#steps) tracks the four parts.

Status: CM7a implemented on 2026-11-22, with headless and rendered acceptance assigned to the orchestrator. The owner approved every recommended option, D1 to D12, on 2026-11-21. CM7c is implemented, with headless, rendered, and Vishot acceptance assigned to the orchestrator; c6 landed separately. CM7b and CM7d are not implemented on this branch. The [roadmap](../../docs/ai/context/character-mind-roadmap.md#steps) tracks the four parts.

The labels D1 to D12 name the forks in [Decisions for the owner](#decisions-for-the-owner). Each section is written on the recommended option.

**Parallel work this plan composes with.**

- **CM6b** (glances, approved). CM6b1 adds the `chat` and `cue-gesture` stimuli and the `chat-read` and `gesture` intents; CM6b2 adds `attend` with a cause, the `away` intent, the `look` hand-off, and the wander `pick`. After CM6b2, every body, gaze, and gesture request that the stage hears passes through `step`. CM7a needs that: a capability check in the mind can only filter what reaches the mind. **CM7a is cut after CM6b2 merges.**
- **CM5b** (beat lock, being implemented). It forwards each beat to the scene (`beat` on `MindStage` and the scenes). A beat is a performer input, not an intent, so it needs no capability; CM7a only keeps CM5b's lines when it rewrites `MindStage`.
- **The CM6a stop-early fix.** It edits the director's cursor stop rule. CM7a's classic change (D4) edits `MMD.vue`'s director wiring, not the director; the conflict is in `MMD.vue` only.
- **The upstream sync to `bd4f30391`.** Section 1 lists what it changes on this slice's paths. A slice starts after a sync, so every CM7 part is cut from `main` after the sync lands.

**Split (D1).** CM7 is split into four PRs, as CM4, CM5, and CM6 were. Section 12 gives each part its Done-when and the order.

- **CM7a, performers declare capabilities.** The mind issues only declared intents, the conductor's driver branches go, Universal, MAGIC, and classic declare nothing, and the prompt's `actions` segment and the stage tools follow the declaration.
- **CM7b, seeded picks and expression reports.** Each expression pick is seeded by its intent's id, and the performer reports masked and refused expressions.
- **CM7c, one character-behavior settings document.** The behavior settings move into one document, the screen-awareness and Presence settings split, the behavior controls get one page, mapping weights become editable per character, and the conversation register's home is recorded.
- **CM7d, one writer per channel on Live2D.** Body ownership Target rule 3 lands for the Live2D frame, with the expression tilt as a weighted posture input (Target rule 2).

## TL;DR (For humans)

**What changes (CM7a):** Each stage tells the character mind what its performer can do: Live2D under Natural can do touch, face, idle, gaze, and every cue gesture except shrug and lean; MMD under Natural can do all of that and the body (walks, clips, stances); Universal, MAGIC, and classic declare nothing. The mind then decides only what the stage can play. A request it cannot serve, such as an ACT shrug on Live2D, is refused and logged instead of dropped silently. The model is offered clip actions and the stage tools only when the performer can play them. Under Universal and MAGIC, ACT emotions and expressions take upstream's path again (motion groups and upstream's Live2D context), and under MMD's classic driver the fork's body director no longer runs: classic plays upstream's idle motion and emotion motions directly. Her voice is not a performer channel, so reach-outs, widget lines, and the return greeting stay under every driver.

**What changes (CM7b):** Two stages that show one model pick the same expression for the same decision, because the pick is drawn from the decision's id. A clip, a manual switch, or a missing asset that masks an expression is logged.

**What changes (CM7c):** One Settings > Behavior page holds what she decides: idle activities, touch reactions, cursor and chat attention, mood and held emotions, and speaking up (unprompted turns, chattiness, do not disturb, quiet apps, games). The Live2D and MMD pages keep only how she moves (energy, emotion strength, petting area, screen lean, clips, stances). The Presence page keeps what she may see (foreground window, titles, browser activity, blocked apps). Existing settings carry over once. The card editor gains per-model expression weights for each character.

**What changes (CM7d):** No second writer on a Live2D channel under Natural: upstream's expression preview reaches the fork's expression store as an input, and an expression's head tilt enters Natural's posture as an input with a declared weight of 0, so nothing looks different yet.

**Why:** Body ownership Target rules 1, 3, 4, and 5; Autonomous behavior Target rules 7 and 8; State persistence Target rule 4; LLM prompt Target rule 5; the rest of the roadmap's CM7 Done-when.

**What does not change:** No odds, cooldown, hold, or constant of any decision. No Natural motion under Natural changes in CM7a to CM7c; every headless scenario stays `IDENTICAL` except where section 9 says. No new storage tier.

**Effort:** CM7a L, CM7b S, CM7c L, CM7d M. **Risk:** Medium to high. CM7a removes behaviors under the upstream drivers (D3, D4). CM7c moves settings for every user and needs a one-time import.

## 1. Upstream first

`git fetch upstream` on 2026-11-21: `upstream/main` is `bd4f30391`. `main` contains upstream through `b3a6d6071`. On the paths this slice changes, the 18 new commits change `packages/stage-ui/src/stores/chat/session-store.ts`, `packages/stage-ui/src/types/chat-session.ts`, `apps/stage-tamagotchi/src/renderer/App.vue`, and constants of `stage-ui-mmd`; CM7 edits none of the changed lines. After the sync lands, rerun `git diff b3a6d6071 bd4f30391 --stat -- <the paths in section 4>` and read every hunk in a file this slice changes.

| Upstream has | Code | What CM7 does with it |
| --- | --- | --- |
| Live2D drivers Universal and MAGIC: an ACT emotion plays the model's motion group, and an ACT expression runs through the Live2D context's card-owned controls (`live2d.expressions.execute`) | upstream `Stage.vue` (`emotionsQueue`, the ACT `expression` branch); `packages/stage-ui/src/stores/live2d` | **Adopted again** under Universal and MAGIC (D3). The fork routes both through its conductor today |
| MMD with no driver choice: `setEmotion` plays the emote and the emotion's mapped action with `animation.playAction`; an idle motion; no director, stance, or clip curation | upstream `packages/stage-ui-mmd/src/components/scenes/MMD.vue` | **Adopted again** as the classic driver (D4). The fork routes the mapped action through its director (`requestPerform`) |
| Upstream's Live2D touch module (#3292), MAGIC's turn toward the cursor (#3285), beat sync on MAGIC poses (#3420) | `stage-ui-live2d` `touch.ts`, `focus-bias.ts`, `beat-sync.ts` | Unchanged, under Universal and MAGIC only |
| The Live2D context's expression plugin, registered after the fork's expressions | `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` (`useMotionUpdatePluginExpression`) | **Changed** under Natural only (CM7d): its preview becomes a lease in the fork's store |
| The card's ACT section for the active card's Live2D controls | `packages/stage-ui/src/stores/modules/airi-card.ts` `getSystemPrompt`, `formatLive2DActPrompt` | Unchanged (section 11) |
| Conversations organized by place (all, a folder, the archive) and character, with device-local `pinnedAt`, `archivedAt`, and `folderId` on each session (#3551, `e2e19ca97`) | `packages/stage-ui/src/types/chat-session.ts` `ChatSessionMeta`, `ChatSessionsPlace`; `packages/stage-ui/src/stores/chat/session-store.ts` | Read for the register decision (D11). No change |
| Module settings as global defaults with per-character values (ADR `2026-11-11-module-defaults-and-character-values.md`) | `useAiriCardStore` `getModules` | The pattern for D6 option (b). No change |
| Upstream's card editor | `packages/stage-pages/src/pages/settings/airi-card/components/CardEditor.vue` | **Changed** (CM7c): the fork's Performance section gains the mapping weight editor |

No upstream code declares a capability, owns a behavior setting, or has a character mind.

**Upstream files this slice changes**, each because the fork's wiring already lives in it:

- `packages/stage-ui/src/components/scenes/Stage.vue` (CM7a): the performer renderer hands its capabilities instead of a driver; the emotion handler takes upstream's path when the performer declares no face; the avatar touch gate reads the declaration.
- `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`, `live2d/Model.vue` (CM7a, CM7c, CM7d): touch and expression gates read the declaration; the behavior fields move to the new store; the context preview becomes a lease under Natural.
- `packages/stage-ui-mmd/src/components/scenes/MMD.vue` (CM7a, CM7c): the director runs only under Natural, and classic's `setClassicEmotion` returns to upstream's `playAction`, which shrinks the fork's diff in that file.
- `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`, `mmd.vue` (CM7c): the behavior controls leave.
- `packages/stage-pages/src/pages/settings/airi-card/components/CardEditor.vue` (CM7c): mapping weights.
- `packages/stage-layouts/src/layouts/settings.vue`, `apps/stage-tamagotchi/src/renderer/layouts/settings.vue` (CM7c), only if the new page cannot register through its route meta (`settingsEntry`, `icon`, `order`) as the Presence and Conversation pages do.

## 2. Today's code

Read from `main` at `bec508cae`.

### 2.1 Where the driver gates the mind's output

The mind knows nothing of drivers: `packages/character-mind/src` has no driver or capability field. Every gate sits at dispatch, in `StagePerformanceConductor` (`packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts`), on `driver(): 'natural' | 'basic'`, which `Stage.vue` sets from `live2dMotionDriver` and `mmdMotionDriver` through `selectStagePerformanceRenderer`:

| Conductor method | Under Natural | Under basic (Universal, MAGIC, classic) |
| --- | --- | --- |
| `emotion` | mind episode to `setEmotion`, hold to `applyHolds`, decider slots to `applySlots` | mind episode still decided; decider slots still applied; `playMotion` plays the emotion's motion group |
| `expression`, `clearExpression` | mind entry or release, then slots | the same; slots apply under every driver |
| `touch` | one `step`; body, mood, moment, line | returns before the mind |
| `desktop` | `wake`, `desktop-reaction` to the scene; `moment`; voice intents | posture intents dropped; `moment` and voice intents dispatched |
| `gesture` | to `scene.gesture` | dropped |
| `idleDrive`, `idle`, `idleCue`, `idlePlay` | to the scene | `null` drive; intents dropped |
| `cursor` | one `step` per report; episode to the reporting scene | reports dropped |
| `interaction` | `step`; `attend` to `scene.attend` | `step`; `attend` dropped |

Other driver reads that decide what she does: `Live2D.vue` `touchGesturesActive` and `Model.vue` `touchActive` (upstream touch or Natural touch), `Stage.vue` `onAvatarTouch` and the avatar touch aggregator, `Stage.vue`'s `useIdleProps` `enabled`, `MMD.vue` `touchActive` and every `motionDriver.value === 'natural'` branch, and the adapters' own `attention().driver` checks (`Live2DNaturalMotionAdapter` `gesture`, `addMood`, and the rest).

`Live2DNaturalMotionAdapter` `gesture` drops `shrug` and `lean` with no report: "a Live2D head and bust barely show them (visual review, 2026-11-15)". This is the Body ownership known gap "Live2D skips shrug and lean cue gestures".

### 2.2 What the upstream drivers still receive

- **Faces.** Under Universal and MAGIC with the Expression system on, an ACT emotion reaches the mind, and the fork's expression slots show the decider's picks for the decided episode (core ADR D10). An ACT expression and the expression tool resolve against the fork's catalog. Under classic, `Stage.vue` sends ACT emotions to `MMD.vue` `setClassicEmotion` and skips the conductor, but an ACT expression still goes to the conductor; the morph layer `expression` is written by the classic emote there, not by the fork's store (Body ownership, Morph ownership).
- **The classic director.** `MMD.vue`'s render loop calls `stance.update` under every driver (glances plan finding 2): under classic the director still picks stance clips for the `sit` and `sleep` slots, serves ACT `action` labels, `perform_action`, debug clips, and the emotion action map through `requestPerform`. Body tools exist only with a stage world; under classic the body never walks (gaze ADR D13).
- **Voice.** Reach-outs, widget lines, and the return greeting run under every driver (Autonomous behavior Precedence rules 15 to 17). `cue` intents reach the scene only under Natural.

### 2.3 What the model is offered

- `actions` segment: `useStageActionsPrompt` (`packages/stage-ui/src/composables/use-airi-runtime-prompt.ts`) renders `usePerformanceRuntimeState().exposedActions`, which the conductor publishes from `listActions` (MMD's labeled clips) under every driver.
- Tools: `createExpressionToolRegistration` from the exposed catalog entries, `createBodyToolRegistration` from `bodyPort`, `createActionToolRegistration` from `actionPort` and the exposed actions, all in `useStagePerformanceConductor`, under every driver.
- The fixed `contract` segment teaches every ACT field, including the gesture vocabulary, under every driver.

### 2.4 Expression picks and moments

- The picker and the planner draw from streams in the decider state, seeded once per conductor with `crypto.getRandomValues` (`useStagePerformanceConductor`, `createPickerDecider` `initial(seed)`). Two stages would pick differently for one decision.
- `useIdleProps` draws a moment's chance and pick with `Math.random` (`chooseMomentEntry`).
- Nothing reports a masked or refused expression.

### 2.5 Settings that gate what she decides

| Document (key) | Behavior fields today | Realisation and sensor fields today | Page |
| --- | --- | --- | --- |
| `useLive2DNaturalSettings` (`settings/live2d/natural`) | `idleActivities`, `touch`, `cursorAttention`, `screenAwareness` (part) | `energy`, `touchPetRequiresHold`, `touchHeadScale`, `emotionStrength`, `screenAwareness` (part) | Live2D page |
| `useMMDNaturalSettings` (`settings/mmd/natural`) | `idleActivities`, `touch` | `energy`, `touchPetRequiresHold`, `emotionStrength` | MMD page |
| `useExpressionPerformanceSettings` (`settings/expression-performance`) | `bands`, `mood`, `heldEmotions`, `intensity`, `held`, `moodDynamics` (the mind reads these four groups through each stimulus's `settings`) | `autoExpressions`, `decider`, `stateFeedback`, `picker`, `slots`, `timing`, `planner`, `naturalBands` | Live2D page (one document for both renderers) |
| `useSituationSettings` (`settings/situation`) | `unpromptedEnabled`, `chattiness`, `dontDisturb`, `quietApps`, `speakDuringGames` (the voice policy reads them through the `VoiceView`) | Sensors: `shareForegroundWindow`, `shareWindowTitles`, `shareBrowserActivity`, `blockedApps`. Chat display: `showUnpromptedCue` | Presence page |

`screenAwareness` (Live2D only) does three things in `Model.vue`: it enables the screen placement that turns her head toward the screen interior (`naturalPlacement`), it enables the chat target that Natural glances at and fixates while the user types (`naturalChatInput`), and it sets the cursor dismiss permission while attention is `screen`. MMD has neither `cursorAttention` nor `screenAwareness`: she always attends to the cursor and the chat there.

`useSettingsDocument` validates each stored field on its own and drops unknown top-level fields, so a narrowed document reads an old stored document without an `upgrade`.

The card already has per-character multipliers: `PerformanceProfile` (`packages/stage-shared/src/expression-performance/profile.ts`) holds `expressiveness`, `moodGainScale`, `moodDecayScale`, and `mappingWeights[modelId][entryId]` (0 to 5), and the conductor applies them (`applyMappingWeights`). The card editor edits the first three and says "Mapping weights cannot be edited here yet. They can be imported with the character card."

### 2.6 The conversation register

`useConversationSettings` (`packages/stage-ui/src/features/conversation/settings.ts`, `settings/conversation`) holds `register` and `textingFlavor` for the user. `buildChatPromptSegments` renders it into the `register` prefix segment for every turn, including scene sessions that answer a Discord channel. The nonverbal channels ADR (D9) made it a user setting. No mind policy reads it.

### 2.7 Findings

1. **The mind spends draws on episodes no stage plays.** Under basic drivers it still decides emotions with `acceptReaction`'s draws; refused intents are dropped after the decision.
2. **Silent drops.** Shrug and lean on Live2D, every posture intent under basic drivers, and expressions that a clip masks leave no trace. ADR decision 6 asks for a reported refusal.
3. **The model is offered what the stage cannot play.** Under classic, `actions` lists clips; under Universal, the expression tool lists the fork's catalog while upstream's ACT section in the card lists upstream's controls (LLM prompt known gap "The card segment carries a second expression instruction").
4. **One behavior, two settings.** `idleActivities` and `touch` exist once per renderer, and `cursorAttention` and screen awareness exist only on Live2D.

## 3. The design

### 3.1 Capabilities

**The declaration (D2).** One type in `packages/character-mind/src/capabilities.ts`, by [channel](../../docs/ai/context/glossary.md#channel), with gestures by kind because Live2D and MMD differ there:

```ts
export interface PerformerCapabilities {
  /** `touch-reaction`, `mood`, `wake`, `desktop-reaction`, `cue`, `idle-act`, `idle-errand`. */
  readonly posture: boolean
  /** `emotion`, `entry`, `release`, `moment`. */
  readonly face: boolean
  /** `cursor-episode`, `chat-read`. */
  readonly gaze: boolean
  /** The ACT cue gestures the performer plays (`gesture`). */
  readonly gestures: readonly CueGestureKind[]
  /** `attend`, `away`, the look hand-off, clip actions, and the body tools. */
  readonly body: boolean
}
export const NO_CAPABILITIES: PerformerCapabilities
/** Whether an intent's channel and kind are declared. Voice intents are always permitted: voice is not a performer channel. */
export function permits(capabilities: PerformerCapabilities, intent: MindIntent): boolean
```

- `LIVE2D_NATURAL_CAPABILITIES` beside `Live2DNaturalMotionAdapter`: posture, face, gaze, gestures `nod`, `shake`, `glance`; no body.
- `MMD_NATURAL_CAPABILITIES` beside `MMDNaturalAdapter`: everything.
- Universal, MAGIC, and classic: `NO_CAPABILITIES`.
- Each scene exposes `capabilities` as a computed of its driver. VRM, Spine, and tachie declare nothing and stay outside the mind's world, as today; the ADR's open question on them stays with the VRM adapter.

What a performer can do at a given moment (a pastime needs a marked entry, a wander needs roam mode and the desktop host, a clip needs curation) stays where it is declared today: the idle drive's `errands`, the catalog, and `listActions`. The declaration says what the performer can realise at all; it does not repeat those lists.

**Voice is not declared.** Her voice is realised by chat, not by a performer, so the voice intents (`speak`, `cancel`, `drop`, `observe-wake`, `observe-return`) pass `permits` under every performer, which keeps reach-outs, widget lines, and the return greeting under every driver.

### 3.2 The mind issues only declared intents

- A new stimulus `{ kind: 'performer', capabilities }` sets `MindState.performer` (fast state, starts as `NO_CAPABILITIES`). `useCharacterMindStore` sends it when a stage attaches, when its declaration changes, when the newest stage detaches (the previous stage's declaration, or none), and after every mind reset, as it replays music. The newest attached stage's declaration is the mind's, the same rule as its idle reports (Precedence rule 18).
- Every policy checks the declaration before it decides, so it spends no draw on an undeclared episode: the touch policy (no touch reaches the mind without posture), the presence answer (`wake` and `desktop-reaction` only with posture; voice intents always), the voice policy (`cue` only with posture), the idle policy (dormant without posture, as under basic today), the attention policy (`cursor-episode` with gaze; `attend` with body), the chat answer (`chat-read` with gaze), the cue-gesture answer (`gesture` only for a declared kind), the expression policy (face intents only with face), and the presence `away` (body).
- **A refusal is reported (D5).** `step` returns `{ state, intents, refusals }`, where a `Refusal` names the stimulus's sequence number, the intent kind it would have yielded, and the reason `undeclared`. The core draws nothing for a refused answer. `CharacterMind`'s step record carries the refusals to `onStep`, so the motion QA `mind` event and the devtools reaction inspector show them. No policy reads them.

### 3.3 The conductor dispatches what the mind decides

- `StagePerformanceDriver`, the `driver` option, and every `driver() === 'natural'` branch leave the conductor. The option becomes `capabilities: () => PerformerCapabilities`, which the conductor sends to the mind store with its stage.
- The conductor dispatches each intent the mind yields. Before it calls a scene method it checks `permits` against its own scene's declaration; on a miss it reports a performer refusal (`reason: 'not-declared-by-stage'`) instead of calling. This covers a second attached stage whose declaration is not the mind's, and it is what Body ownership Target rule 4 asks of a performer: realise every declared request, report the rest.
- The scene-side gates read the declaration instead of the driver: `Live2D.vue` `touchGesturesActive` and `Model.vue` `touchActive` (upstream touch when posture is not declared), `Stage.vue` `onAvatarTouch`, `MMD.vue` `touchActive`. The adapters' own driver checks stay: they guard frame work, not decisions.

### 3.4 The upstream drivers

**Faces under Universal, MAGIC, and classic (D3).** With no face declared, `Stage.vue`'s ACT handler takes upstream's path and calls no conductor method: under Universal and MAGIC, an ACT emotion sets the motion group and an ACT expression runs `live2d.expressions.execute`; under classic, `setClassicEmotion` runs upstream's emote and `animation.playAction`. The conductor's basic branch (`playMotion`, `suppressMotionGroup`, the "`heldEmotions` off there" rule) goes. The fork's expression store keeps its panel, manual switches, and rest set under every driver; it only stops receiving the mind's picks there. The expression tool and the exposed list are empty without face (section 3.5).

**The classic director (D4).** The director runs only while MMD declares body, which is only under Natural. Under classic, `MMD.vue` plays upstream's idle motion and the emotion action map directly, as upstream ships them; the stance slots, clip curation, ACT `action` labels, `perform_action`, idle clips, and debug clips do nothing there, and the MMD page marks those sections as Natural only. This settles the glances plan's D9.

### 3.5 The model is offered only what is declared (LLM prompt Target rule 5)

`PerformanceRuntimeSnapshot` (`packages/stage-ui/src/features/performance/runtime-state.ts`, fork code) publishes what the conductor derives from its scene's declaration:

- `exposedActions` is empty without body, so the `actions` segment renders nothing under classic, Live2D, and the other renderers, and `useStageActionsPrompt` (an upstream file) needs no change.
- `exposed` (the expression list of the live state and the expression tool) is empty without face.
- The action and body tool registrations get no port without body.

The fixed contract still teaches the whole ACT vocabulary (section 11).

### 3.6 Seeded picks and expression reports (CM7b, Body ownership Target rule 5)

- Every decider signal that answers a mind intent carries the intent's `id`. The picker's and the planner's draws for that signal come from a Mulberry32 stream seeded by a hash of the id and the slot, not from the conductor's stream, so two conductors fed the same intents pick the same entries. Signals that answer no intent (timing, deadlines) keep the conductor's stream; they pick nothing new.
- `useIdleProps` seeds a moment's chance and pick from the `moment` intent's id instead of `Math.random`.
- The expression stores report a masked or refused expression through the conductor's performer refusal path (section 3.3): a clip-owned slot, a manual switch that wins, an entry missing from the catalog, or an entry with no slots. The reasons are `masked-by-clip`, `masked-by-manual`, `missing-asset`.
- Affect traces move to version 3: each decider signal records its intent id, so a replay reproduces the seeded pick. A version 2 trace no longer parses, as CM1 did for version 1.

### 3.7 One character-behavior document (CM7c)

**Scope (D6).** One tier 1 document for the user, `useCharacterBehaviorSettings` in `packages/stage-ui/src/features/character-behavior/settings.ts`, key `settings/character-behavior`, built on `useSettingsDocument` and synced with leader-routed `update` and `reset`. Per-character values stay where they are: the card's performance profile (expressiveness, mood scales, mapping weights) and its character profile.

**What belongs in it (D7).** A field belongs when it gates what the mind decides, as ADR decision 11 lists (idle activities, touch reactions, mood, held emotions, chattiness, quiet rules). Everything that shapes how a performer plays a decision stays in the renderer documents.

| Field | From | Read by |
| --- | --- | --- |
| `idleActivities` | both Natural documents (D9) | the idle policy: off decides no act, errand, or sleep; `useIdleProps` |
| `touchReactions` | `touch` of both Natural documents (D9) | the touch policy: off answers a touch with nothing; the scenes still classify |
| `cursorAttention` | the Live2D document; MMD gains it | Natural's cursor permission (gaze ADR D9 keeps permission in Natural) |
| `chatAttention` | the chat part of Live2D's `screenAwareness`; MMD gains it | the chat answer: off yields no `chat-read` and no chat `attend`; Natural's typing fixation |
| `emotion`: `bands`, `mood`, `heldEmotions`, `intensity`, `held`, `moodDynamics` | the expression performance document | the expression policy, through each stimulus's `settings` after the card profile (`resolveEffectiveSettings`); Natural's fast mood for `moodDynamics` |
| `speaking`: `unpromptedEnabled`, `chattiness`, `dontDisturb`, `quietApps`, `speakDuringGames` | the situation document | the voice policy, through the `VoiceView` the situation store builds |

How the mind reads it: the three switches `idleActivities`, `touchReactions`, and `chatAttention` reach it as a `{ kind: 'behavior', ... }` stimulus kept in `MindState.behavior` and sent like `performer`. The emotion fields keep riding in each stimulus, because the card profile of the turn's character scales them. The speaking fields keep riding in the `VoiceView`. Each field has one source, the document.

`ExpressionPerformanceSettings` splits into `EmotionBehaviorSettings` (the behavior fields, what the mind's stimuli carry) and `ExpressionRealisationSettings` (what the deciders and the Live2D page read). `DeciderContext` carries both.

**The splits (Done-when clauses).**

- **Screen awareness.** Behavior: `chatAttention`. Realisation: `screenLean`, the head turn toward the screen interior, stays in the Live2D Natural document (renamed from `screenAwareness`). The `screen` attention dismiss rule follows `cursorAttention`, because it is a cursor permission. Item 1 of CM7c confirms the three effects of section 2.5 in code before the split.
- **Presence.** Behavior: the five speaking fields. Sensors: `shareForegroundWindow`, `shareWindowTitles`, `shareBrowserActivity`, and `blockedApps` stay in `useSituationSettings`, which becomes the user's sensor and privacy document; `showUnpromptedCue` stays there as chat display. The roadmap calls this part "realisation"; for Presence it is the sensors, which are the user's permission, not hers.

**The page (D8).** A new Settings > Behavior page (`packages/stage-pages/src/pages/settings/behavior/index.vue`, `layout: settings`) with sections Idle, Touch, Attention, Feelings, and Speaking up. The Live2D page keeps energy, emotion strength, petting area and hold, screen lean, the expression system, and the realisation expression controls (`autoExpressions`, `decider`, `stateFeedback`); the MMD page keeps energy, emotion strength, pet hold, clips, stances, roam mode, and height; the Presence page keeps the sensors and the chat cue. Each page that lost a control links to the Behavior page in one line.

### 3.8 Mapping weights per character (CM7c, D10)

The card editor's Performance section lists each avatar model of the card that has a stored expression catalog, and under it each entry with an emotion mapping, with a multiplier slider from 0 to 5 (default 1, 0 disables the mapping). It writes `modules.performance.mappingWeights[modelId][entryId]`; a value of 1 removes the key. It reads catalogs with a read-only `readStoredExpressionCatalog(modelId)` exported by `stage-ui-live2d` and `stage-ui-mmd` (the stores already parse `expression-catalog:<id>` on load); a model whose catalog was never stored shows one line: load it once to edit its weights. The help text that says the weights cannot be edited goes. Item 1 confirms that the catalog key, the conductor's `modelId`, and the card's avatar model ids name the same id.

### 3.9 The conversation register (D11)

The register stays a user setting in `useConversationSettings`, outside the behavior document: it shapes the prompt, not a decision of the mind, and the nonverbal channels ADR made it the user's. The CM7c ADR records the decision and the alternative that matters: a register per conversation beside upstream's new `ChatSessionMeta` fields, which would let a scene session text while the desktop conversation talks.

### 3.10 One writer per channel on Live2D (CM7d, D12)

Body ownership Target rule 3 lands with this reading: under Natural, each channel has one owner, which writes last and composes everything below it as its input. The SDK's motion update and upstream's plugin stages below the owner are inputs; nothing writes a channel after its owner, and no two fork writers share a channel. Two places break that today:

- **Expression parameters.** Upstream's context plugin writes after the fork's `applyExpressions`, so a preview wins by plugin order. Under Natural, the context's active preview becomes a lease in the fork's expression store (top priority while it lasts, released when it ends), and the context plugin writes only under Universal and MAGIC. The preview still wins while it lasts.
- **Head and body angles.** An expression that moves `ParamAngleX`, `ParamAngleY`, or `ParamAngleZ` writes before Natural, and `composePosture` overwrites it. Natural now composes that value as a posture input with a declared weight, `EXPRESSION_TILT_WEIGHT = 0`. This lands Target rule 2 for expression tilts with no visible change; a weight above 0 is tuning for the motion review backlog.

Item 1 of CM7d inventories every Live2D channel under Natural against the reading and lists any third case; a third case stops the part for an owner ruling.

## 4. Where the code lives

| Path | Change | Upstream file |
| --- | --- | --- |
| `packages/character-mind/src/capabilities.ts` (new), `types.ts`, `step.ts`, `mind.ts`, `touch.ts`, `presence.ts`, `voice.ts`, `idle.ts`, `attention.ts`, `chat.ts`, `expression.ts`, `index.ts` | `performer` and `behavior` stimuli; `permits` checks; `refusals` [a1, a2, c4] | No |
| `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts`, `packages/stage-ui-mmd/src/composables/mmd/natural/adapter.ts` | The two declarations [a1] | No |
| `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts`, `use-motion-qa-events.ts`, `use-motion-qa-bridge.ts`, `use-idle-props.ts` | Dispatch without driver branches, performer refusals, published capabilities [a3, a5]; seeded moments [b2]; behavior store [c3] | No |
| `packages/stage-ui/src/stores/character-mind.ts` | `MindStage` carries capabilities; send `performer` and `behavior` [a2, c4] | No |
| `packages/stage-ui/src/features/performance/runtime-state.ts`, `packages/stage-ui/src/tools/expression.ts`, `action.ts`, `body.ts` | Exposed lists and tools follow the declaration [a5] | No |
| `packages/stage-ui/src/components/scenes/Stage.vue` | Capabilities instead of driver; upstream's ACT path without face [a3, a4] | Yes (section 1) |
| `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`, `live2d/Model.vue` | Declaration gates [a3]; behavior fields [c3]; preview lease [d2] | Yes |
| `packages/stage-ui-mmd/src/components/scenes/MMD.vue`, `composables/mmd/stance.ts` | Director only with body; classic `playAction` [a4]; behavior fields [c3] | `MMD.vue`: yes |
| `packages/stage-shared/src/expression-performance/settings.ts`, `picker.ts`, `planner.ts`, `deciders.ts`, `trace.ts`, `profile.ts`, `moments.ts` | Seeded picks, trace v3 [b1]; the settings split [c2] | No |
| `packages/stage-ui-live2d/src/stores/expression-store.ts`, `packages/stage-ui-mmd/src/stores/expression-store.ts` | Masked reports [b3]; catalog reader [c6]; preview lease [d2] | No |
| `packages/stage-ui/src/features/character-behavior/settings.ts` (new), `features/situation/settings.ts`, `features/performance/settings.ts`, `packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts`, `packages/stage-ui-mmd/src/stores/natural-settings.ts` | The behavior document and its import; narrowed documents [c1, c2] | No |
| `packages/stage-ui/src/stores/situation/index.ts` | The `VoiceView` reads the speaking fields from the behavior document [c3] | No |
| `packages/stage-pages/src/pages/settings/behavior/index.vue` (new), `presence/index.vue`; `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`, `mmd.vue` | The page and the moved controls [c5] | `live2d.vue`, `mmd.vue`: yes |
| `packages/stage-pages/src/pages/settings/airi-card/components/CardEditor.vue`, `packages/stage-ui/src/services/airi-card-editor.ts` | Mapping weights [c6] | `CardEditor.vue`: yes |
| `packages/stage-ui/src/persistence/state-registry.ts` | The new registration [c1] | No |
| `packages/motion-driver-natural/src/natural-motion.ts`, `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` (`composePosture`) | The weighted expression tilt input [d3] | No |
| `packages/stage-shared/src/motion-scenario/bridge.ts`, `packages/qa-tools/src/t2-3d/runner/run.ts` | QA inputs move to the behavior fields; the runner declares `MMD_NATURAL_CAPABILITIES` [a2, c3] | No |
| `packages/i18n/src/locales/en/settings.yaml` | The Behavior page; moved labels; mapping weights [c5, c6] | English source only |

## 5. What is deleted

- CM7a: `StagePerformanceDriver`, the conductor's `driver` and `playMotion` options, `suppressMotionGroup`, every `driver() === 'natural'` branch in the conductor, the "`heldEmotions` off under basic" rule, the director's run under classic, and `setClassicEmotion`'s `requestPerform` path.
- CM7b: the conductor's per-instance decider seed for intent-answering signals; `Math.random` in `useIdleProps`; affect trace version 2.
- CM7c: `idleActivities`, `touch`, `cursorAttention`, and `screenAwareness` in the Natural documents; the six emotion fields in the expression performance document; the five speaking fields in the situation document; the per-stimulus reading of `settings.heldEmotions` for the basic driver; the card editor's "cannot be edited" help text; the null idle drive for `idleActivities` off (the mind decides nothing instead; item c4 proves it equivalent).
- CM7d: the context plugin's write under Natural.

After CM7a, `git grep -nE "driver\(\) (===|!==) 'natural'|StagePerformanceDriver" -- packages ':!*.md'` prints nothing.

## 6. Persisted state and how existing settings carry over

CM7a and CM7b add no stored state: `MindState.performer` and `MindState.behavior` are fast state and are re-sent after every reset. Affect traces are files the user records on demand; version 2 files stop parsing (section 3.6).

CM7c adds one tier 1 document, `settings/character-behavior`, registered in `stateRegistry` (`character-behavior-settings`, writer `features/character-behavior/settings.ts`, owner reset through the synced store). "Delete all data" resets it. It never leaves the device in a card share or backup.

**The one-time import.** While nothing is stored under `settings/character-behavior`, the store's `initial` reads the raw stored JSON of `settings/live2d/natural`, `settings/mmd/natural`, `settings/expression-performance`, and `settings/situation`, and for `touch`, `cursorAttention`, and `screenAwareness` also the pre-document keys that the Natural documents still import (`settings/live2d/natural-touch`, `-cursor-attention`, `-screen-awareness`, `settings/mmd/natural-touch`). Each field passes the document's own validation.

- `idleActivities` and `touchReactions`: off when either renderer's value is off (D9).
- `cursorAttention`, `chatAttention`: Live2D's `cursorAttention` and `screenAwareness`.
- The emotion and speaking fields: copied as stored.

The leader writes the imported document at once, at store creation, when the import found any value. That write must come before any narrowed document writes, because a narrowed document drops the moved fields from storage at its next write. So each narrowed store creates the behavior store first in its setup, and `App.vue` initializes the behavior store before the character mind store. A test writes a narrowed document right after startup and checks that the moved values survive.

The Live2D Natural document renames `screenAwareness` to `screenLean` through its `upgrade` option. The narrowed documents need no other upgrade: `useSettingsDocument` drops unknown top-level fields.

Every import reads under one block:

```ts
// NOTICE:
// Profiles saved before the character-behavior document keep its fields in four older documents and, for three
// fields, in the pre-document Natural keys.
// Root cause: behavior settings lived with the renderer and Presence settings before CM7c (character mind ADR
// decision 11).
// Source: packages/stage-ui-live2d/src/composables/live2d/natural-settings.ts, packages/stage-ui-mmd/src/stores/natural-settings.ts,
// packages/stage-ui/src/features/performance/settings.ts, packages/stage-ui/src/features/situation/settings.ts before CM7c.
// Removal condition: one release after CM7c lands, together with the Natural documents' pre-document import; the
// first leader start writes the document, so a profile started once since then no longer needs it.
```

The `screenLean` rename carries its own `NOTICE` with the same removal condition. No other fallback stays.

What a user sees after the upgrade: every value carries over, except that a value set differently on the two renderers becomes one value (D9), and MMD gains the cursor and chat attention switches with Live2D's values.

## 7. Docs that move with the code

Policy docs change in the commit that makes their statement false; the item is in brackets. Run `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after each policy doc edit.

- **`docs/ai/context/body-ownership.md`.** [a2, a3] Target rules 1 and 4 move into the Live2D and MMD sections: the declarations, the dispatch rule, and the refusal report; the Live2D touch and expression rules name the declaration instead of the driver; the MMD section says the director runs only under Natural (D4). The known gap "Live2D skips shrug and lean" leaves both lists. [b1, b3] Target rule 5 moves. [d2, d3] Target rule 3 moves with its reading, the Live2D rule "A preview through upstream's context wins while it lasts" restates it as a lease, and Target rule 2 moves with the expression tilt weight; the known gap "No ADR records the Live2D posture overwrite" leaves.
- **`docs/ai/context/autonomous-behavior.md`.** [a2] Target rule 7 moves into Precedence as a new rule (the next free number on the base): the mind issues only what the newest stage declares and reports refusals. Precedence rules 4, 10, 15, 16, 19, and 20 name the declaration instead of the driver. The Deciders rows for upstream's touch, the avatar touch notify, MAGIC's cursor turn, beat sync, and the classic director say what runs without capabilities. Overlap 11 is restated as a consequence of the rule, and stays listed only for the two cooldowns. [c3, c5] Target rule 8 moves; every "Settings that gate it" cell names the behavior document or the renderer document.
- **`docs/ai/context/state-persistence.md`.** [c1] Target rule 4 moves into Settings documents: seven tier 1 stores, the behavior document's fields, and the import.
- **`docs/ai/context/llm-prompt.md`.** [a5] Target rule 5 moves into Segments (the `actions` row) and Paths. The known gap "The card segment carries a second expression instruction" is narrowed: under Natural the fork's contract and actions; under Universal and MAGIC upstream's ACT section, which now matches what plays.
- **`docs/ai/context/glossary.md`.** New terms **Capability**, **Refusal**, and **Character-behavior settings**. **Performer (target)** moves into Terms with its code; Stimulus (`performer`, `behavior`) and Intent (permitted channels) gain lines; Conversation register names its home.
- **`docs/ai/context/upstream-policy.md`.** [a4] The Live2D expressions row says that under Universal and MAGIC ACT expressions run through upstream's context again; a new row records that the MMD classic driver is upstream's MMD scene and the fork's director runs only under Natural. [d2] The Live2D expressions row says a preview is a lease under Natural.
- **`docs/ai/context/ui-components.md`** and stories only if CM7c adds or changes a shared component; the plan expects none.
- **`docs/ai/context/character-mind-roadmap.md`.** [a6] The CM7 row splits into CM7a to CM7d; each part's row is closed by its ADR commit. The feature row "MMD feel against Live2D; the VRM adapter; emotion clip craft" waits for CM7a only.
- **READMEs.** `packages/character-mind/README.md` (capabilities, refusals, `performer` and `behavior`) [a2, c4]; `packages/stage-ui/README.md` (the conductor, the behavior document) [a3, c1]; `packages/stage-ui-live2d/README.md` (declaration, preview lease, catalog reader) [a1, c6, d2]; `packages/stage-ui-mmd/README.md` (classic is upstream's scene) [a4]; `packages/motion-driver-natural/README.md` (the tilt input) [d3]; `packages/qa-tools/README.md` (refusal events, behavior inputs) [a2, c3].
- **Nested guidance** (a `chore(agents)` commit of its own, in CM7a): `packages/stage-ui/AGENTS.md` gains "Dispatch a mind intent only through `permits`; do not branch on the motion driver to decide what she does." `packages/stage-ui-live2d/AGENTS.md`'s driver rules name the declaration.
- **ADRs.** Each part writes its own: `docs/ai/adr/<date>-character-mind-performers.md` (CM7a: D2 to D5), `<date>-character-mind-expression-picks.md` (CM7b), `<date>-character-behavior-settings.md` (CM7c: D6 to D11), `<date>-live2d-channel-owners.md` (CM7d: D12). The CM7a ADR supersedes the core ADR's D10 and the glances plan's D9 question; the CM7c ADR supersedes the nonverbal channels ADR's placement of the controls but keeps its D9. Existing ADR bodies are not edited.

## 8. Work items

Each item is one commit that passes `pnpm verify`; each PR passes `pnpm verify --gate`. Item ids name the PR (a to d).

### CM7a: performers declare capabilities (`luke/feat/character-mind-capabilities`, from `main` after CM6b2)

- **a1. `refactor(character-mind,stage-ui-live2d,stage-ui-mmd): declare what each performer can realise`.** `capabilities.ts`, `permits`, the two declarations, scenes expose `capabilities`; nothing reads them yet. Tests: `capabilities.test.ts` (Node): `permits` for every intent kind against the three declarations; voice intents permitted under `NO_CAPABILITIES`.
- **a2. `feat(character-mind,stage-ui,qa-tools): issue only the intents the newest stage declares`.** Section 3.2. Docs `[a2]`. Tests (Node, seeded): with `NO_CAPABILITIES` a presence edge yields only voice intents, a reach-out yields no `cue`, an emotion yields no face intent and draws nothing (the source's next value is unchanged), an ACT `shrug` with the Live2D set yields a refusal and no intent; with the MMD set every existing test's intents are unchanged; a mind reset re-sends the declaration (store test). The runner declares the MMD set. Acceptance: `qa:motion3d diff` reads `IDENTICAL` for all nine scenarios against the base.
- **a3. `refactor(stage-ui,stage-ui-live2d,stage-ui-mmd): dispatch the mind's intents without driver branches`.** Section 3.3. Docs `[a3]`. Tests: the conductor test drives a scene with each declaration and checks that every permitted intent is called and every other one reports a refusal; `touchGesturesActive` and `touchActive` follow the declaration (browser test already covering them, ported). Acceptance: `IDENTICAL` for all nine.
- **a4. `feat(stage-ui,stage-ui-mmd): give Universal, MAGIC, and classic upstream's faces and clips again`.** Section 3.4 (D3, D4). Docs `[a4]`. Tests: `stage-emotion-routing.browser.test.ts` under Universal plays the motion group, runs no mind step, and leases no fork slot; an ACT expression under Universal reaches `live2d.expressions.execute`; an MMD scene test under classic plays the mapped action through `playAction` and never updates the director. Acceptance: `IDENTICAL` for all nine (Natural only).
- **a5. `feat(stage-ui): offer the model only declared actions and tools`.** Section 3.5. Docs `[a5]`. Tests: the runtime-state test publishes empty `exposedActions` and `exposed` without body and face; a prompt test renders no `actions` segment under classic and the same bytes as today under MMD Natural; the tool registrations get no port without body.
- **a6. `chore(agents): route stage dispatch through declared capabilities`.**
- **a7. `docs(ai): record the performer decisions`.** The CM7a ADR, the roadmap `[a6]`, after section 9's CM7a checks pass.

### CM7b: seeded picks and expression reports (`luke/feat/character-mind-expression-picks`, after CM7a)

- **b1. `feat(stage-shared,stage-ui): seed each expression pick from its intent`.** Section 3.6. Tests (Node): two deciders with different seeds fed the same signals with the same intent ids pick the same entries; trace v3 replays a recorded session pick for pick; a v2 trace is rejected.
- **b2. `feat(stage-ui): seed moment expressions from the moment intent`.** Tests: one moment id gives one pick; the chance stays 0.6 over 10,000 ids within 0.02.
- **b3. `feat(stage-ui-live2d,stage-ui-mmd,stage-ui): report masked and refused expressions`.** Tests: each reason emits one refusal event with the entry id and no label; a shown expression emits none.
- **b4. `docs(ai): record the expression pick decisions`.** The CM7b ADR; Target rule 5 moves `[b1, b3]`.

### CM7c: one character-behavior document (`luke/feat/character-behavior-settings`, after CM7a)

- **c1. `feat(stage-ui): add the character-behavior settings document`.** Section 3.7 and section 6: the store, the import, the registration, the creation order. Docs `[c1]`. Before the commit, confirm in code the three effects of `screenAwareness` and the model id mapping of section 3.8, and record any difference in the PR. Tests: `settings.test.ts` for each merge rule and for an empty profile; `state-registry.browser.test.ts` and `use-data-maintenance.browser.test.ts` pass with the new key; the storage-writes scan passes; a browser test writes a narrowed document right after startup and the moved values survive a reload.
- **c2. `refactor(stage-shared,stage-ui,stage-ui-live2d,stage-ui-mmd): narrow the renderer, expression, and presence documents`.** The settings type split, the narrowed schemas, `screenLean` with its `upgrade`. Tests: each narrowed document reads an old stored document and keeps its own fields.
- **c3. `refactor(stage-ui,stage-ui-live2d,stage-ui-mmd,stage-shared,qa-tools): read behavior from one document`.** Every reader of a moved field reads the behavior store: the scenes, `Stage.vue`, the conductor's effective settings, the situation store's `VoiceView`, the QA bridge, and the motion scenario schema. Acceptance: `IDENTICAL` for all nine.
- **c4. `feat(character-mind,stage-ui): let the mind read the behavior switches`.** The `behavior` stimulus; the idle, touch, and chat answers follow it; the null idle drive for `idleActivities` off goes. Tests (Node): idle off decides no act and no sleep; touch off answers a touch with no intent; chat attention off yields no `chat-read` and no chat `attend`. Acceptance: a headless `idle-drive` run with idle off produces no idle act, as the null drive did; `IDENTICAL` for all nine with defaults.
- **c5. `feat(stage-pages,stage-ui,i18n): put behavior on one settings page`.** Section 3.7, the page (D8). Follow `enforce-rules-for-ui-components` and `enforce-rules-for-ui-tests`: no large DOM test; one focused browser test that a toggle on the page updates the document; a Vishot capture of the page in light and dark.
- **c6. `feat(stage-pages,stage-ui-live2d,stage-ui-mmd,stage-ui,i18n): edit expression mapping weights per character`.** Section 3.8. Tests: the editor service writes and removes weights (Node); a stored card round-trips through the editor unchanged when no weight is touched; `applyMappingWeights` sees the edited weight. This item has no dependency on the rest of CM7 and may land first, alone, on `main`.
- **c7. `docs(ai): record the character-behavior settings and the register's home`.** The CM7c ADR (D6 to D11), Target rules 4 (State persistence) and 8 (Autonomous behavior) move, the roadmap.

### CM7d: one writer per channel on Live2D (`luke/feat/live2d-channel-owners`, after CM7a)

- **d1. `docs(plan): inventory the Live2D channel writers under Natural`.** A table in this plan's Departures section, from the code, against section 3.10's reading. Stop on a third case.
- **d2. `feat(stage-ui-live2d): make the context preview a lease under Natural`.** Tests: a preview through the context shows its parameters and wins over a fork lease while it lasts, then releases; under Universal the context plugin writes as before.
- **d3. `feat(motion-driver-natural,stage-ui-live2d): compose expression tilts as a weighted posture input`.** `EXPRESSION_TILT_WEIGHT = 0`. Tests: at weight 0 `composePosture`'s output is unchanged for an expression that tilts; at weight 1 the tilt passes through. Acceptance: `natural-motion/observer.test.ts` hashes unchanged; `pnpm qa:live2d-rig` hash unchanged.
- **d4. `docs(ai): record the Live2D channel owners`.** The CM7d ADR; Target rules 2 and 3 move `[d2, d3]`; the roadmap.

Each PR ends with a `docs(plan)` commit that marks its part in this plan: Status, Departures, Checks run, Commits.

## 9. Checks

- **Each commit:** `pnpm verify`, then `pnpm verify --gate` at each PR tip. Inner loops: `pnpm -F @proj-airi/character-mind exec vitest run src`; `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance src/features`; `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/stage-emotion-routing.browser.test.ts src/persistence`; `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance`; `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d`.
- **Policy docs:** the policy-docs test after each policy doc edit and at each tip.
- **Smoke on both hosts**, with `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL` from `.env.qa`: `pnpm qa:display run -- pnpm qa:smoke` and `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"`, at each PR tip.
- **Headless motion.** Base runs from `pnpm wt new cm7-base --base <the PR's base> --branch luke/tmp/cm7-base --qa`, removed with `pnpm wt rm cm7-base`. Runs: `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario <name> --seed 1 --out <dir>` for `idle`, `idle-drive`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, `touch`, and `music`.
  - CM7a, CM7c, CM7d: `IDENTICAL` against the previous item for every scenario. Any `DIFFERENT` is a defect.
  - CM7b: `emotions` and `touch` may differ only in face morph channels, where a pick changed; body and gaze blocks stay `IDENTICAL`. `pnpm qa:live2d-rig` may change its hash at b1 only; re-pin once with the reason in the commit body, and record the old and new pick for the trial's one emotion.
  - Required wording for each PR: "Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review."
- **Rendered checks.** A driver under `.temp/cm7/`, not committed, inside `pnpm qa:display run --name cm7 -- ...`; stop with `pnpm qa:display down --name cm7`. The driver prints no model path. Every launch: 0 renderer and 0 main-process errors.
  - **CM7a.** (1) Live2D Natural: an ACT `shrug` gives a `mind` event with a refusal and no gesture; an ACT `nod` plays. (2) Live2D Universal: an ACT emotion plays its motion group with no `mind` emotion step and no fork slot lease; an ACT expression runs through the context; "Evaluate now" with a replayed reply speaks and plays no cue. (3) MMD classic: an ACT emotion plays its mapped action; the prompt size report has no `actions` entry; `perform_action` is not registered. (4) MMD Natural on the desktop stage: the `actions` segment and `perform_action` are back, a clip performs, and a poke and a chat send behave as before.
  - **CM7b.** (5) With the expression panel, a poke and an ACT emotion each emit no refusal on a free slot, and a manual switch held on the face slot makes the next ACT emotion emit `masked-by-manual`.
  - **CM7c.** (6) Start from a seeded old profile (the driver writes the four old documents with `idleActivities` off on MMD only, then launches): the Behavior page shows idle off, the Live2D and MMD pages show no behavior control, and the stored `settings/character-behavior` exists after the first start. (7) Cursor attention off on MMD: no `cursor` episode in `mind` events. (8) A mapping weight of 0 in the card editor stops that entry from being picked (the `picked` affect events over ten ACT emotions name it never). (9) "Delete all data" removes `settings/character-behavior`.
  - **CM7d.** (10) A preview through the card's Live2D controls shows and ends as before, on Natural and Universal.
- Record run directories, gate and report lines, refusal counts by reason, and event excerpts (kinds and counts, no content) in each PR description.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Users of Universal or MAGIC lose the fork's automatic expressions (D3) | Owner decision; the ADR, the ledger, and the Live2D README say so; the expression panel still works by hand |
| Users of classic lose stances, ACT actions, and `perform_action` (D4) | Owner decision; the MMD page marks those sections Natural only; P's D12 anticipated it |
| A declaration that is too narrow silently changes Natural (for example, a kind left out) | a2 and a3 must read `IDENTICAL`; the conductor test checks every intent kind against each declaration |
| The mind's declaration lags a driver switch by one step | The scene's own `permits` check refuses and reports; the mind store sends the new declaration on the driver watch |
| The import loses values if a narrowed document writes first | Creation order and the c1 test; the leader writes the imported document at once |
| Users whose renderers disagreed see one value change (D9) | Off wins, so nothing turns itself on; the ADR states it |
| The settings type split ripples through deciders and traces | c2 is a refactor with `IDENTICAL` acceptance; trace v3 lands in CM7b first |
| A version 2 affect trace no longer parses | Traces are debugging files; the precedent is CM1's v1 to v2 |
| The Live2D inventory finds a third writer (CM7d) | d1 stops for an owner ruling instead of widening the part |
| Rebase conflicts with CM5b and CM6b2 in `MindStage`, `Stage.vue`, `MMD.vue`, and `types.ts` | CM7a is cut after both; keep both sides' `else if` branches |

## 11. Follow-ups this plan does not do

- The ACT gesture vocabulary in the fixed contract follows the declaration: moving gestures into a per-performer part of `actions` would bump `STAGE_CONTRACT_EN_SHA256` and the eval contract version.
- Upstream's card ACT section (`formatLive2DActPrompt`) under Natural, where the fork's contract and tools already cover expressions.
- Per-character values for behavior fields (D6 option b), if a second character needs its own chattiness.
- A register per conversation for scene sessions (D11).
- A weight above 0 for expression tilts, in the motion review backlog (CM7d).
- Shrug and lean on Live2D, if a later visual review finds a way to show them.
- Overlap 11's two touch cooldowns and overlap 13's unranked touch notify under the upstream drivers.

## 12. The split and the order

| Part | Done when | Depends on |
| --- | --- | --- |
| **CM7a** Capabilities | Body ownership Target rules 1 and 4 land; Autonomous behavior Target rule 7 lands; LLM prompt Target rule 5 lands; no conductor branch reads the motion driver; under Universal, MAGIC, and classic the mind issues no performer intent and the stage tools and `actions` are empty; the "Live2D skips shrug and lean" gap is closed by a reported refusal; the director does not run under classic | CM6b2, the upstream sync |
| **CM7b** Seeded picks and reports | Body ownership Target rule 5 lands: two conductors fed the same intents pick the same entries, and masked or refused expressions are reported | CM7a |
| **CM7c** Behavior document | State persistence Target rule 4 and Autonomous behavior Target rule 8 land; the screen-awareness and Presence settings are split into behavior and realisation (sensor) parts; expression mapping weights are editable per character; the conversation register's home is decided and recorded; existing settings carry over by the one-time import | CM7a (c6 has no dependency) |
| **CM7d** One writer per channel | Body ownership Target rule 3 lands for Live2D under its stated reading, and Target rule 2 lands for expression tilts at weight 0 | CM7a |

**Order.** CM7a first. CM7b, CM7c, and CM7d may then run in parallel worktrees; at most three heavy checks run at once. Item c6 may land on `main` at any time. The CM7 row is done when all four parts have merged.

## Decisions for the owner

Marks: **[visible]** changes what the user sees; **[removes]** removes a behavior.

| # | Fork | Options | Trade-off | Recommendation |
| --- | --- | --- | --- | --- |
| D1 | Split CM7 | (a) One PR; (b) four PRs: capabilities, seeded picks and reports, the behavior document, Live2D channel owners; (c) two PRs: everything about performers, then the behavior document | (a) carries a driver cut, a settings migration, and a frame-pipeline change in one review. (c) still bundles CM7d's frame change with the capability cut. (b) gives each part one Done-when, and three of them can run in parallel | (b) |
| D2 | Where the capability check sits | (a) The mind holds the newest stage's declaration and issues only declared intents; the conductor checks its own scene again and reports a miss; (b) the mind decides everything and the conductor drops and reports; (c) the mind keeps a table by driver name | (b) breaks Target rule 7 and spends draws on episodes nobody plays. (c) puts renderer knowledge in the mind. (a) costs one stimulus kind and a fast-state field | (a), with the channel-level declaration of section 3.1 |
| D3 | Faces under Universal, MAGIC, and classic | (a) They declare no face: ACT emotions and expressions take upstream's path (motion groups, the Live2D context, the classic emote), and the fork's expression slots get no automatic picks there; (b) they declare face only, so the mind keeps choosing the fork's expressions under them, and ADR decision 7 and Body ownership Target rule 1 are amended | (a) is what ADR decision 7 says and makes the model's offer match what plays; it removes automatic fork expressions for users on those drivers. (b) keeps today's behavior and amends an accepted decision | (a) **[visible] [removes]** |
| D4 | The fork's body director under classic | (a) It runs only under Natural; classic plays upstream's idle motion and emotion motions directly, with no stances, ACT actions, `perform_action`, idle clips, or debug clips; (b) it keeps serving clip requests under classic, which declares a `clips` capability, and Target rule 1 is amended; (c) it keeps running under classic, but the model is offered nothing | (a) follows rule 1, settles the glances plan's D9, and shrinks the fork's diff in `MMD.vue`. (b) keeps classic as it is at the cost of the rule. (c) keeps stance changes but leaves a half-driver | (a) **[visible] [removes]** |
| D5 | Where refusals go | (a) Observer events only: the mind's step and the conductor report them to the QA `mind` event and the devtools inspector, and tool callers get a refused result; (b) also a `refusal` stimulus into the mind | No mind policy reads a refusal yet. The idle policy already gets its own `refused` report. (b) adds a stimulus nobody reads, the same reasoning as the glances plan's D2 | (a) |
| D6 | Scope of the behavior document | (a) One document for the user; per-character values stay in the card's performance and character profiles; (b) the document holds defaults and a card may set its own value for any field, as upstream's module defaults do; (c) the fields live on the card | (b) is the upstream pattern and lets characters differ, at the cost of an inherit control per field and of share rules for each field. (c) makes a shared card carry the user's quiet apps. (a) is what State persistence Target rule 4 states | (a); (b) stays a follow-up |
| D7 | Which fields are behavior | (a) The fields that gate what the mind decides, as section 3.7 lists, including `dontDisturb` and `quietApps`, which ADR decision 11 names as quiet rules; (b) the same, but `dontDisturb` and `quietApps` stay with the sensors as the user's own state | (b) keeps the user's do-not-disturb beside the privacy switches, where some users look for it, but splits the speaking-up rules across two documents | (a) **[visible]** |
| D8 | Where the behavior controls appear | (a) One new Settings > Behavior page; renderer pages keep realisation, Presence keeps sensors; (b) storage moves, the controls stay on today's pages | (b) changes nothing a user sees but keeps behavior controls on renderer pages, against ADR decision 11. (a) moves controls users know | (a) **[visible]** |
| D9 | Merging values that were per renderer (`idleActivities`, `touch`) | (a) Off wins; (b) Live2D's value wins; (c) the value of the renderer of the active display model wins | (a) never turns on something the user turned off; a user who turned idle off for MMD only loses it on Live2D too. (b) and (c) can turn a behavior back on | (a) **[visible]** |
| D10 | Where mapping weights are edited | (a) The card editor's Performance section, per avatar model, from the stored catalogs; (b) the Live2D and MMD expression panels, for the active card | (a) puts the character's values on the character's page, where the help text already points, but a never-loaded model cannot be edited. (b) has the catalog at hand but edits a card from a model page | (a) **[visible]** |
| D11 | Home of the conversation register | (a) It stays a user setting in its own document; (b) the behavior document; (c) per character on the card; (d) per conversation on `ChatSessionMeta`, beside upstream's new `pinnedAt`, `archivedAt`, and `folderId` | No mind policy reads it, so (b) only relocates it. (c) ties how she writes to who she is, not where. (d) fits scene sessions best but extends an upstream type that changed in this very sync and adds a control per conversation | (a); (d) is the follow-up when scenes need it |
| D12 | How Body ownership Target rule 3 lands on Live2D | (a) The owner writes last and composes everything below it as input; fix the two second writers (the context preview becomes a lease; expression tilts become a posture input at weight 0, landing Target rule 2); (b) restructure the Live2D final plugin stages into one composer per channel; (c) leave rules 2 and 3 in Target for Live2D and amend the CM7 Done-when | (b) rewrites upstream's plugin chain in `motion-manager.ts` and `Model.vue` for no visible gain. (c) leaves the Done-when unmet. (a) changes nothing visible and makes the tilt weight a tunable for the backlog | (a) |

## Departures during implementation (c6)

The owner replaced section 3.8's stored-catalog reader with the loaded model's
live expression store. Stored catalog documents contain curation only, not the
derived entries. Desktop QA found that the stage and settings use separate
windows, so the card editor now reads a tier 5 runtime mirror,
`useStageExpressionCatalogStore` (`stage-expression-catalog`). The stage
conductor publishes the loaded display model id and mapped entries (id, label,
mappings) when its Live2D or MMD catalog changes and clears the mirror on unload
or disposal. Settings windows read the replicated snapshot. If no stage has the
character's model loaded, the editor asks the user to show the character on the
stage. No derived catalog persistence or catalog schema change is added. Weights
remain per card and per display model, surviving switches and reloads. Node
regressions cover publishing, clearing, editor selection, and replication to a
late settings window without reader proposals. Both the not-loaded and the
no-entries messages use the shared `Alert` with the `info` tone, so c6 adds no
shared component.

The key used by both expression stores and the conductor is the display model
id (`avatarModels[].displayModelId`), not the card's avatar reference id
(`avatarModels[].id`). The editor uses that same display model id for weights.

## Departures during implementation (CM7a)

- **a1:** Rechecked section 2 against the implementation. CM6b now routes chat,
  cue gestures, attend causes, away edges, and the director's look hand-off;
  CM5b forwards beats separately from intents. The director also retains CM6a's
  rest position and pending sidestep. These are preserved. Section 2.5's
  mapping-weights limitation is obsolete after c6: its live catalog mirror is
  independent of LLM exposure and remains published under every driver.
  Other driver gates, expression draws, settings homes, and register ownership
  still match section 2. The declaration matrix test lives in stage-ui, which
  already depends on both renderers, so character-mind gains no renderer
  dependency. It tests the actual adapter declarations.
- **a2:** Section 2 gates remain as checked for a1. Capability checks before
  random policies prevent refused draws; one deterministic answer filter in
  the core reports denied channels of mixed answers, preserving voice draws
  and their ordering. The reaction inspector needs one existing-table row in
  stage-pages. Declaration replay now sets the loaded pacing owner before its
  first step, so it cannot publish the new card's pacing to the previous card.
  The store observes capability getters synchronously, preserving beats and
  the latest idle view. Scene attachment begins carrying the declaration in
  this item so the new default cannot disable Natural before a3 lands.
- **a3:** Rechecked section 2: a2 now prevents undeclared mind decisions; the
  conductor still had every listed driver branch and is now declaration-only.
  The Live2D emotion motion-group handoff moves to Stage in a3, because
  removing the conductor option otherwise breaks the existing upstream route
  until a4. a4 still restores context expressions and classic clips. Voice
  cues carry the complete intent through MindStage so refusal causes survive.
  The conductor matrix uses a full mind declaration and each scene declaration
  to exercise the second-stage refusal contract. Its combo fixture now names
  its real members: slots alone never made it a usable combo. CM5b beats,
  CM6b attends and chat reads, and c6 catalog publication remain intact.
  The T1/T2 Live2D scenario sink is also a conductor consumer, so it now
  declares the Live2D set. Inspector composition stays in Stage: importing
  that browser store from the conductor would pull chat assets into Node QA.
- **a4:** Rechecked section 2 against upstream bd4f30391: classic still ran
  the director and sent its emotion map through requestPerform. It now uses
  upstream setIdleMotion and playAction. The imported-motion and idle-selection
  hooks are restored as well as the emotion path. A driver switch releases
  director requests and its layer, then invalidates only the applied base so
  returning to Natural reapplies the existing decision without resetting it.
  The existing real MMD browser scene fixture supplies the scene regression;
  it uses generated assets and a controlled frame, without Electron. The
  settings notes reuse existing Natural-only copy, so no locale keys change.
- **a5:** Section 2.3 still held after a4: runtime exposure and registrations
  read the raw catalog and clip library. They now follow face and body in
  the scene declaration. Runtime-state and prompt tests exercise the real
  conductor producer, so the existing snapshot API and fixed contract bytes
  stay unchanged. The c6 mapping catalog is deliberately not gated.
- **a6:** Rechecked the implemented gates; no additional runtime departure.
  This item changes only the two package guidance files.
- **a7:** The existing prompt composer reports every supplied segment, including
  an empty actions row. Under classic the actions text is absent and its
  report row has zero characters; section 9's literal "no actions entry"
  wording does not match that report contract. The implementation preserves
  the report contract and Natural prompt bytes rather than changing the
  upstream prompt builder or the shared composer. Section 9 also names ten
  scenarios when music is included, despite saying nine. Both qualifications
  are recorded for the orchestrator. The glossary's earlier narrow performer
  definition is merged with the newly implemented per-stage definition.
  The final plan record is included in a7, keeping the requested seven commits.

## Departures during implementation (CM7d)

### d1: Natural channel inventory

Section 2 was rechecked after CM7a. Sections 2.1 to 2.3 and findings 1 to 3
now use declarations and reported refusals: the mind checks before deciding,
the conductor checks `permits`, tools and actions follow face/body, and classic
does not run the director. Universal and MAGIC use upstream ACT expressions
and motion groups. Voice remains independent. CM5b beats, CM6b chat, gesture,
attend, away and look inputs, and CM6a rest and sidestep state remain present.
Section 2.4's random picker and moment streams and sections 2.5 to 2.6's
settings and register homes still match. The mapping-weights limitation in
section 2.5 is obsolete: c6 uses the live catalog mirror and display model id.

The inventory follows `Model.vue`'s registrations, `motion-manager.ts`,
`Live2DNaturalMotionAdapter`, `ExpressionComposer`, `readLive2DRigProfile`,
and the installed SDK's `Cubism4InternalModel.update`. Here an owner means
the final composition boundary, not each intermediate parameter assignment.
This is section 3.10's reading: upstream stages and values explicitly consumed
by the final owner are inputs. A writer that replaces the owner's result is
an ownership conflict.

| Channel | Inputs and final owner under Natural | Finding |
| --- | --- | --- |
| Expression-only parameters, art switches and brow form | SDK motion, then the fork expression composer; context expressions currently write afterward | Planned d2 conflict: context preview must become the composer's highest-priority lease |
| Head angles | Motion and expression values precede Natural's `composePosture`; full ownership replaces them, clip channels retain the 0.1 residual | Planned d3 conflict: expression tilt must be a declared weighted input, initially 0 |
| Body angles | Natural posture, except physics outputs and axes derived from head physics; manual control releases posture weight | Same posture boundary as head; physics exclusions are explicit |
| Gaze | Natural posture consumes the gaze arbiter; SDK focus is skipped at full posture weight | One final owner; manual/spring handoff keeps the existing fade |
| Eyelids and blink | Idle-disable bases, expressions, light squint and manual squint feed Natural's lid composition; clip-owned lids skip that composition | Natural composes the base, micro multiplier, emotion hint and blink factor; light squint is an input, not a later override |
| Brows, eye smile, mouth form and cheek | Expressions and manual values feed Natural's additive face composition, excluding clip and physics channels | One final composition boundary |
| Mouth open | Lipsync owns speech, its 200 ms release and 500 ms hold; Natural explicitly skips that window and otherwise adds silent mouth motion | Exclusive ownership window, reported every frame |
| Breath | Manual breath owns its active window; otherwise Natural writes, except clip/physics channels | SDK breath is deleted; Natural explicitly yields to manual breath |
| Physics outputs | Natural excludes every non-zero physics output; SDK physics evaluates after Natural | Physics owns those outputs and consumes Natural's inputs |
| Part opacity and pose | SDK pose runs after physics; no Natural part-opacity writer exists | SDK-owned |
| Saved manual parameters | Load-time and setting-change writes become subsequent frame bases | Configuration inputs, not a frame writer after the owner |
| Upstream beat and touch | Beat mode is `silent`; touch is not triggered with posture declared and resets on entry to Natural | No Natural-frame write from these plugins |

No third independent owner was found under that reading. The SDK saves before
Natural's focus wrapper and loads after model update, so Natural remains a
stateless overlay; physics and pose are the only subsequent live writers.
Headless and rendered acceptance remain assigned to the orchestrator, and
the requested package checks replace repository-wide verify in this worktree.

### d2: Context preview lease

The section 2 gates still match the d1 inventory. The context represents both
active controls and temporary previews as parameter operations, not catalog
entries. Its Natural lease therefore lives beside the slot claims in the fork
store and overrides their composed parameters without changing their lifetime.
It has no fade or timer of its own, preserving immediate preview activation
and withdrawal. Add retains upstream's model-default basis; Multiply reads the
clamped fork result. A switch from an upstream driver releases its prior direct
writes before capturing clean bases. Universal and MAGIC keep their plugin.
The d2 regression is Node-only and exercises the real context, store, controller
and plugin; no browser test was required by this item.

### d3: Weighted expression tilt

Section 2 was rechecked: capability gates and the d1 departures remain
unchanged; d2 now gates the direct context plugin and supplies its lease.
The tilt input uses the composer's final parameter delta, not the whole
post-motion value, so motion clips, manual control and SDK focus cannot
masquerade as an expression. The adapter normalizes the three head axes using
their directional rig ranges. `NaturalMotion.advance` composes the explicit
weight only in the sampled head and its eye compensation; it changes neither
the seeded processes nor body intents. The stage declares
`EXPRESSION_TILT_WEIGHT = 0`. Physics exclusions and clip residuals remain
unchanged. Tests exercise weights 0 and 1 and immediate withdrawal, with
unchanged observer hashes. Target rule 3 is moved for Live2D only; its
remaining-renderer scope stays explicit, matching section 12's Done-when.

The d3 full stage-ui browser run passed 1,012 tests and hit six timing failures
in five unrelated files (mobile composer height, Silero VAD, history time
separator, send button and sessions dialog), with five existing skips.
Each failed file then passed alone with `--no-file-parallelism`: 1, 7, 12, 2
and 22 tests respectively. No threshold, timeout, or test changed. The d2
full browser run had already passed all 1,018 tests with five skips.
ESLint reports one existing long-comment warning in the adapter test's
untouched manual-control case; the new and changed code has no lint error.

### d4: Ownership record

The section 2 gates were checked again and still match the d1 inventory and
d2/d3 changes. The new Live2D channel owners ADR records D12, the policy now
links that record, and the old posture-overwrite documentation gap is removed.
The CM7d roadmap row records implementation completion, with the orchestrator's
headless, rig and rendered results explicitly pending in the ADR Consequences.
No existing ADR body or another CM7 part's implementation is changed.

## Checks run (CM7d)

The owner requested package checks instead of repository-wide verify. No
`qa:*` command, Electron launch, install, package manifest or lockfile change,
push, threshold change, or timeout increase ran in this worker. Suites ran
one at a time. Markdown-only items did not rerun package typechecks.

Required inner loops and policy checks, with passing test counts:

| Command | d1 | d2 | d3 | d4 |
| --- | --- | --- | --- | --- |
| `pnpm -F @proj-airi/character-mind exec vitest run src` | 138 | 138 | 138 | 138 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance src/features` | 268 | 268 | 268 | 268 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/stage-emotion-routing.browser.test.ts src/persistence` | 53 | 53 | 53 | 53 |
| `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` | 291 | 291 | 291 | 291 |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d` | 513 | 516 | 518 | 518 |
| `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | Not needed | 11 | 11 | 11 |

The final record-only commit repeated all five inner loops and the policy
check; they passed with the same counts as d4. It changes no runtime file.

Focused regressions and full touched-package suites:

| Command | Result |
| --- | --- |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/expression-controller.test.ts src/contexts/expressions.test.ts src/composables/live2d/expression/compose.test.ts` | d2: 54 passed |
| `pnpm -F @proj-airi/motion-driver-natural exec vitest run src/expression-tilt.test.ts` | d3: 3 passed |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion-adapter.test.ts src/composables/live2d/expression-controller.test.ts src/composables/live2d/natural-motion/observer.test.ts` | d3: 92 passed; existing observer hashes unchanged |
| `pnpm -F @proj-airi/motion-driver-natural exec vitest run` | d3: 522 passed |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node` | d2: 790 passed; d3: 792 passed |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project browser` | d2 and d3: 43 passed |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser` | d2: 1,018 passed, 5 existing skips. d3: 1,012 passed, 6 timing failures, 5 existing skips; isolated retries below passed |

Every failed d3 browser file was rerun once on its own, without changing
timeouts or assertions:

| Command | Result |
| --- | --- |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/misc/mobile-composer-height.browser.test.ts --no-file-parallelism` | 1 passed |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/workers/vad/silero-vad.browser.test.ts --no-file-parallelism` | 7 passed |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/chat/components/history-time-separator.browser.test.ts --no-file-parallelism` | 12 passed |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/chat/components/send-button.browser.test.ts --no-file-parallelism` | 2 passed |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/chat/components/sessions-dialog.browser.test.ts --no-file-parallelism` | 22 passed |

Both dependent typecheck commands passed with exit code 0:

| Item | Command | Selected projects, including the touched packages |
| --- | --- | --- |
| d2 | `pnpm --filter "...@proj-airi/stage-ui-live2d" --workspace-concurrency=2 typecheck` | 8 |
| d3 | `pnpm --filter "...@proj-airi/motion-driver-natural" --filter "...@proj-airi/stage-ui-live2d" --workspace-concurrency=2 typecheck` | 11 |

ESLint passed on changed TypeScript and Vue files. The adapter test retains
one pre-existing long-comment warning in an untouched test. The commit hooks
linted each named staged file. Browser fixtures retain their existing loader,
missing injection and synchronization-teardown console messages; those are
not rendered-app acceptance.

The orchestrator still owns section 9's headless identity comparisons and
the unchanged Live2D rig hash. Section 9 enumerates ten scenarios when `music`
is included, despite its nine-scenario shorthand. It also owns rendered
check 10: a preview through the card's Live2D controls must show and end on
Natural and Universal. Natural must show the highest-priority lease and
reveal the underlying expression after withdrawal without changing posture;
Universal must keep its direct context preview and release. Every launch
must have zero renderer and zero main-process errors. The ADR Consequences
contains the requested placeholder for these results.

## Commits (CM7d)

1. `2617e1a5a` - `docs(plan): inventory the Live2D channel writers under Natural`
2. `5bd36f180` - `feat(stage-ui-live2d): make the context preview a lease under Natural`
3. `c67ec64cb` - `feat(motion-driver-natural,stage-ui-live2d): compose expression tilts as a weighted posture input`
4. `90127ba0d` - `docs(ai): record the Live2D channel owners`
5. This record - `docs(plan): record CM7d implementation and checks`

## Departures during implementation (CM7b)

- **b1:** Rechecked section 2. CM7a now gates mind decisions and dispatch by
  capabilities, restores upstream faces and classic clips, and gates exposed
  actions and tools. CM5b beats, CM6b chat/gesture/attend/away/look, CM6a
  rest-position and sidestep state, and c6 catalog publication remain intact.
  Settings and register homes still match section 2, except c6 already edits
  mapping weights through its live mirror. Picks still used conductor streams
  and traces were v2. Intent-answering signals now require their intent id;
  FNV-1a of id and slot seeds the existing Mulberry32 draw. Escalations retain
  episode tickets, preserving their no-reroll rule. A decider switched mid-episode
  seeds its first tickets from the escalation intent it actually receives.
  The mapping-weight replay test now favors the entry opposite the original
  seeded pick, so it tests the override without depending on the old RNG.
  The orchestrator owns the Live2D rig run and any b1 hash re-pin; no rig hash
  was changed here and old/new trial picks remain unmeasured.

- **b2:** Rechecked section 2 after b1: declarations, upstream routes, exposure,
  settings, and register ownership are unchanged. The conductor previously
  discarded the moment intent id at `markMoment`; it now forwards it to
  `useIdleProps`. The plan did not distinguish mind moments from performer
  idle-behaviour reports and lab previews. Those reports contain no intent id,
  so they use a local Mulberry32 stream starting at 0; explicit mind moments
  always use their id and never consume that stream. `Math.random` is gone.
  Chance, cooldown, hold, and report timing are unchanged. Stage's callback
  needs the two-line wiring change so the id reaches the owning composable.

- **b3:** Rechecked section 2: gates, routing, exposure, settings, and register
  ownership remain unchanged; b1 and b2 replaced only the stated draw sources.
  The plan assumed clip-owned expression slots, but neither renderer has one:
  Live2D composes expressions after motion curves, and MMD's expression morph
  layer outranks clip morphs. MMD also lets slot claims outrank manual claims.
  Adding either mask would change Natural, so b3 preserves that precedence
  and never emits a false clip or manual refusal. The observer contract carries
  `masked-by-clip`, tested at the conductor and QA boundary, but there is no
  current clip-mask producer. Live2D's existing protected manual-group branch
  emits `masked-by-manual`. Its separate cross-slot protection requires the
  additional accurate reason `masked-by-expression`; calling it a clip or
  manual mask would misreport its owner. Both stores report missing assets and
  unusable slots once per entry per batch. The planner also reports a scheduled
  entry deleted before emission, since otherwise no command reaches a store.
  Shared report types belong in stage-shared, rather than renderer copies.
  Reports describe admission, not later fades or normal lease replacement.
- **b4:** Rechecked the final gates and routes; no new runtime departure.
  The ADR records the actual mask precedence rather than promising new
  clip/manual masks under Natural. It leaves the required orchestrator
  acceptance placeholder. As in CM7a, the final plan status, checks, and
  commit record are included in the prescribed ADR commit, keeping four
  CM7b commits rather than adding an unnumbered fifth plan commit.

## Checks run (CM7b)

The owner reserved all headless and rendered checks for the orchestrator and
replaced repository-wide verify with package suites and dependent typechecks.
No QA, Electron, install, package manifest, lockfile, timeout, or threshold
change is part of this implementation.

| Item | Command | Result |
| --- | --- | --- |
| b1 | `pnpm -F @proj-airi/stage-shared exec vitest run` | 1,883 passed |
| b1 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node` | 1,947 passed |
| b1 | `pnpm -F @proj-airi/stage-ui exec vitest run --project browser` | 1,018 passed, 5 existing skips; includes the named scene and persistence inner loop |
| b1 | `pnpm -F @proj-airi/character-mind exec vitest run src` | 138 passed |
| b1 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance src/features` | 270 passed |
| b1 | `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` | 294 passed |
| b1 | `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d` | 513 passed |
| b1 | `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | 11 passed |
| b1 | `pnpm --filter "...@proj-airi/stage-shared" --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 28 packages, exit 0 |
| b2 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance/use-idle-props.test.ts src/composables/performance/use-stage-performance-conductor.test.ts` | 106 passed |
| b2 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node` | 1,949 passed |
| b2 | `pnpm -F @proj-airi/stage-ui exec vitest run --project browser` | 1,014 passed, 5 existing skips, 4 timeout failures in the MMD devtools file |
| b2 | `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/features/devtools/motion/mmd/devtools.browser.test.ts --no-file-parallelism` | All 8 passed on the single allowed isolated rerun |
| b2 | `pnpm -F @proj-airi/character-mind exec vitest run src` | 138 passed |
| b2 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance src/features` | 272 passed |
| b2 | `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` | 294 passed |
| b2 | `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d` | 513 passed |
| b2 | `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | 11 passed |
| b2 | `pnpm --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 7 packages, exit 0 |
| b3 | `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/stores/expression-store.test.ts` | 77 passed |
| b3 | `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node src/stores/expression-store.test.ts` | 8 passed |
| b3 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance/use-stage-performance-conductor.test.ts src/composables/performance/use-motion-qa-bridge.test.ts` | 142 passed |
| b3 | `pnpm -F @proj-airi/stage-shared exec vitest run` | 1,884 passed |
| b3 | `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node` | 790 passed |
| b3 | `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node` | 433 passed |
| b3 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node` | 1,959 passed |
| b3 | `pnpm -F @proj-airi/stage-ui exec vitest run --project browser` | 1,018 passed, 5 existing skips |
| b3 | `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project browser` | 43 passed |
| b3 | `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser` | 34 passed |
| b3 | `pnpm -F @proj-airi/character-mind exec vitest run src` | 138 passed |
| b3 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance src/features` | 282 passed |
| b3 | `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` | 295 passed |
| b3 | `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d` | 513 passed |
| b3 | `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | 11 passed |
| b3 | `pnpm --filter "...@proj-airi/stage-shared" --filter "...@proj-airi/stage-ui-live2d" --filter "...@proj-airi/stage-ui-mmd" --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 28 packages, exit 0 |
| b4 | `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | 11 passed |
| b4 | `pnpm -F @proj-airi/character-mind exec vitest run src` | 138 passed |
| b4 | `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance src/features` | 282 passed |
| b4 | `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` | 295 passed |
| b4 | `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d` | 513 passed |
| b4 | `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/stage-emotion-routing.browser.test.ts src/persistence` | 53 passed |

b1 changed TypeScript files passed ESLint. Its first focused run found a fixture
that depended on the previous random pick; its first stage-ui Node run found
an exact trace assertion missing the newly required intent id. Both assertions
were repaired without weakening their behavioral checks, and the suites above
passed. Browser fixtures retain their existing localization and teardown logs.
b2 changed files passed ESLint with one existing trivial-function warning in
Stage outside the changed callback. Its browser timeout failures passed alone
without a timeout or threshold change.
b3's focused and full suites passed on their first runs. The conductor's
indentation diagnostics were fixed and ESLint passed. Its clip-refusal tests
exercise the observer contract; no current renderer has clip ownership of an
expression slot. The real stores' tests assert their actual missing-asset,
manual protection, cross-slot protection, and shown-entry outcomes.
b4 changes documentation only. No package source changed after the successful
b3 full suites and dependent typecheck. It ran every named inner loop and the
policy guard.

## Commits (CM7b)

| Item | Commit | Title |
| --- | --- | --- |
| b1 | `93684d379` | `feat(stage-shared,stage-ui): seed each expression pick from its intent` |
| b2 | `4b336df86` | `feat(stage-ui): seed moment expressions from the moment intent` |
| b3 | `ff0750775` | `feat(stage-ui-live2d,stage-ui-mmd,stage-ui): report masked and refused expressions` |
| b4 | This final documentation commit | `docs(ai): record the expression pick decisions` |

The [CM7b ADR](../../docs/ai/adr/2026-11-22-character-mind-expression-picks.md)
leaves an explicit placeholder for the orchestrator's headless and rendered
results. No acceptance run, hash re-pin, or visual result is claimed here.

## Departures during implementation (CM7c)

- **c1:** Section 2 was checked against the CM7a and S2 base. The conductor
  now uses capabilities and upstream face routing, and classic no longer runs
  the director, as CM7a records. Beats, groove phase, chat and cue-gesture
  stimuli, gaze arbitration, look hand-off, restX, and sidesteps remain.
  `screenAwareness` now gates placement and chat only: cursor dismissal already
  follows `cursorAttention` and the aside intent. c6 already uses display model
  ids and the live catalog mirror, not a stored-catalog reader. S2 has eight
  tier 1 stores, making this the ninth rather than the plan's seventh.
  Import persistence uses an idempotent leader-routed `initialize`, scheduled
  during App setup and awaited before mind startup, following S2's acknowledged
  startup writes. It does not write from an unwrapped store-setup action before
  leadership. Renderer packages cannot import the stage-ui owner without a
  dependency cycle; startup owns their ordering instead.
  The new feature has no package subpath in the base. With manifest edits
  forbidden, the existing settings barrel exports its public API.
- **c2:** The section 2 gates remain as checked for c1; no driver code changed.
  Contract narrowing lands first. Removing persisted fields and moving their
  readers must be one atomic change to keep every commit buildable without
  compatibility accessors, so c3 carries the four document removals, the
  screenLean rename, and their old-document regressions. The combined runtime
  `ExpressionPerformanceSettings` remains the intersection of the two owned
  contracts for performers and traces. `emotionHold` also reads the face slot
  hold rules for a turn, which section 2.5 omitted. Emotion stimuli therefore
  carry that realisation constraint alongside behavior; touch and explicit
  expression stimuli need only behavior. This preserves existing hold lengths.

- **c3:** Rechecked section 2: capabilities, beat lock, gaze arbitration, director
  look, restX, and sidesteps remain unchanged. The four persisted documents now
  narrow with every reader in the same commit. Stage passes behavior permissions
  as boolean scene props rather than introducing a renderer-to-stage-ui cycle.
  Presence/expression commands and renderer controls/QA await the import before
  writing old documents. A settled import flag prevents reset followed by the
  deletion sweep from resurrecting the new key. Quiet-app defaults read the
  preload platform at their boundary, avoiding the Vite-only shared barrel in
  Node conductor imports while keeping supported-host defaults. QA now names
  screenLean separately and exposes chatAttention and touchReactions. Scene API
  documentation is updated; neither renderer has an existing scene story.
  The controls keep their old locations until c5, but already write one owner.

- **c4:** The section 2 capability and settings gates were rechecked. The mind
  now owns the three decision switches and replays them after reset. Code
  inspection found that a null idle drive also removes energy offsets, releases
  active acts, prevents body settling, and drops cues (`NaturalIdleActivities`
  `energyOffset`, `step`, and `updateErrand`). Removing that gate would change
  existing Natural behavior, so it remains as a performer realisation cutoff;
  the mind independently suppresses idle decisions, proved against a null-drive
  reference. Live2D reapplies that cutoff on permission changes. Touch remains
  classified while off; permission edges withdraw the hand without creating a
  synthetic end for an ungranted pet. The settings watcher replaces no synced
  state and ignores unrelated emotion/speaking changes. Its snapshot regression
  uses the sync plugin's top-level function-patch semantics. Startup behavior is
  an extra stimulus, so correlation tests account for its sequence number.

- **c5:** Section 2 now reflects the c1-c4 ownership split; driver gates and
  Natural policy values are unchanged by the UI move. Both settings homes
  discover route metadata and both layouts read generic headers, so the new
  route supplies its entry/icon without duplicate layout tables. It also owns
  a settings-search registration. Existing labels are reused; four unused MMD
  duplicates were removed from English only after checking their callers.
  The two new route title/description keys are used through metadata despite
  the i18n scanner's unused-key warnings; the baseline is unchanged. Existing
  moved-control regressions now assert document ownership without mounting the
  old controls. Remaining renderer and sensor interactions keep their checks,
  with real memory routers for the links and unchanged geometry thresholds.
  One new focused browser test clicks the Behavior idle toggle and awaits the
  actual update action. Light/dark Vishot and rendered app checks remain in the
  orchestrator's assigned rendered acceptance; this worker runs no qa command
  or Electron launch.

- **c7:** The final section 2 check retains the capability gates and all prior
  departures above. D6 to D11 are recorded in the behavior ADR. The register
  remains a user setting in its own document; no prompt or upstream session
  type changes. The roadmap marks implementation complete while the ADR
  explicitly reserves headless, rendered, and Vishot acceptance for the
  orchestrator. This item includes the final plan ledger instead of adding a
  seventh worker commit.

## Checks run (CM7a)

The implementation base is `e57dd1393`. The owner requested package checks,
not repository-wide `pnpm verify`, and reserved headless and rendered acceptance
for the orchestrator. No `qa:*` command, Electron launch, install, dependency edit,
threshold change, or timeout increase was used. Suites ran one at a time.

These are the final successful results of the verification commands. Earlier
item commits record their own counts where the suite grew during the slice.

| Command | Result |
| --- | --- |
| `pnpm -F @proj-airi/character-mind exec vitest run src` | 138 passed; a1 had 130 before the capability-policy tests |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node` | 1,934 passed; a1 1,926, a2 1,928, a3 and a4 1,932 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance src/features` | 268 passed at a7 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser` | 1,015 passed, 5 existing skips |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/stage-emotion-routing.browser.test.ts src/persistence` | 51 passed at a7 |
| `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` | 291 passed |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node` | 787 passed |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d` | 513 passed |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project browser` | 43 passed |
| `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node` | 414 passed |
| `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser` | 31 passed |
| `pnpm -F @proj-airi/qa-tools exec vitest run --project node` | 880 passed, 9 existing environment-gated skips |
| `pnpm -F @proj-airi/stage-pages exec vitest run` | 102 browser tests passed |
| `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | 11 passed after the policy edits and at a7 |

Focused regressions also ran:

| Command | Result |
| --- | --- |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/character-mind.test.ts src/composables/performance src/tools/expression.test.ts` | 209 passed after the a2 fixture and pacing-owner repairs |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance src/stores/character-mind.test.ts src/tools/expression.test.ts` | 209 passed during a3 before the declaration matrix was added |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance/use-stage-performance-conductor.test.ts` | The first matrix run had 87 passing and 2 failing assertions; the incorrect touch assertions were repaired and the full Node project passed |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/features/performance/runtime-state.test.ts src/composables/use-airi-runtime-prompt.test.ts src/composables/performance/use-stage-performance-conductor.test.ts` | 106 passed |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/stage-emotion-routing.browser.test.ts src/persistence src/features/devtools/motion/natural/devtools.browser.test.ts` | 65 passed during a2 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/stage-emotion-routing.browser.test.ts src/persistence src/components/scenes/live2d-blink-ownership.browser.test.ts` | 48 passed during a3 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/stage-emotion-routing.browser.test.ts` | 42 passed after the new nod test explicitly requested count 1 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/stage-emotion-routing.browser.test.ts src/components/scenes/mmd-expression-output.browser.test.ts` | 53 passed during a4 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/mmd-expression-output.browser.test.ts` | 7 passed with the generated PMX/VMD fixture and driver-switch regression |

Each typecheck below completed successfully with exit code 0:

| Item | Command | Packages |
| --- | --- | --- |
| a1 | `pnpm --filter "...@proj-airi/character-mind" --filter "...@proj-airi/stage-ui-live2d" --filter "...@proj-airi/stage-ui-mmd" --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 10 |
| a2 | `pnpm --filter "...@proj-airi/character-mind" --filter "...@proj-airi/stage-ui" --filter "...@proj-airi/qa-tools" --filter "...@proj-airi/stage-pages" --workspace-concurrency=2 typecheck` | 10 |
| a3 | `pnpm --filter "...@proj-airi/stage-ui-live2d" --filter "...@proj-airi/stage-ui-mmd" --filter "...@proj-airi/stage-ui" --filter "...@proj-airi/qa-tools" --workspace-concurrency=2 typecheck` | 9 |
| a4 | `pnpm --filter "...@proj-airi/stage-ui-live2d" --filter "...@proj-airi/stage-ui-mmd" --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 9 |
| a5 | `pnpm --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 7 |
| a6 | `pnpm --filter "...@proj-airi/stage-ui-live2d" --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 8 |

Diagnostic typechecks also used
`pnpm --filter @proj-airi/character-mind --filter @proj-airi/stage-ui --filter @proj-airi/stage-pages --workspace-concurrency=2 typecheck`,
`pnpm --filter @proj-airi/stage-ui-live2d --filter @proj-airi/stage-ui-mmd --filter @proj-airi/stage-ui --workspace-concurrency=2 typecheck`,
and `pnpm -F @proj-airi/qa-tools typecheck`. Missing fixture imports, the
obsolete driver option, and the accidental browser-observer import into Node
were repaired at their owning boundaries; the dependent runs above then passed.
The generated MMD clip test uses the owning loader rather than an undeclared
Three import. No package or tsconfig workaround was added.

The plan's obsolete-driver grep prints no matches. Changed code passed ESLint
and every commit's hook. Two existing trivial-function warnings remain in
Stage.vue. Browser fixtures log their existing model-loader and synchronization
teardown messages; these runs do not establish rendered-app error counts.
a7 changes documentation only and ran the five named inner loops and the policy
check; no package type changed after the successful a6 dependent checks.

## Commits (CM7a)

| Item | Commit | Title |
| --- | --- | --- |
| a1 | `845a4901c` | `refactor(character-mind,stage-ui-live2d,stage-ui-mmd): declare what each performer can realise` |
| a2 | `6dbd6b2d9` | `feat(character-mind,stage-ui,qa-tools): issue only the intents the newest stage declares` |
| a3 | `25acf5ce6` | `refactor(stage-ui,stage-ui-live2d,stage-ui-mmd): dispatch the mind's intents without driver branches` |
| a4 | `e42c5c479` | `feat(stage-ui,stage-ui-mmd): give Universal, MAGIC, and classic upstream's faces and clips again` |
| a5 | `78326ad89` | `feat(stage-ui): offer the model only declared actions and tools` |
| a6 | `d2d5b06ff` | `chore(agents): route stage dispatch through declared capabilities` |
| a7 | This final documentation commit | `docs(ai): record the performer decisions` |

The [CM7a ADR](../../docs/ai/adr/2026-11-22-character-mind-performers.md) leaves an
explicit placeholder for the orchestrator's headless and rendered results.

## Checks run (CM7c)

The implementation base is `bc63fa4ef`. The worker completed c1 to c5 and c7;
c6 was already present. The owner requested package checks instead of
`pnpm verify` and reserved headless and rendered acceptance for the orchestrator.
No install, dependency manifest edit, lockfile edit, `qa:*` command, Electron
launch, threshold change, timeout increase, push, or branch switch was used.

The following table records the test commands and their final successful
results. Counts at earlier item boundaries are included where the suite grew.
Commands with paths use paths relative to the filtered package.

| Command | Result |
| --- | --- |
| `pnpm -F @proj-airi/character-mind exec vitest run src` | 146 passed at c4, c5, and c7; 138 at c1 to c3 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node` | 1,957 passed at c4 and c5; 1,953 at c1, 1,955 at c2 and c3 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser` | 1,024 passed and 5 existing skips at c3 to c5; 1,021 passed at c1 and c2 |
| `pnpm -F @proj-airi/stage-shared exec vitest run` | 1,881 passed at c2 and c3 |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node` | 787 passed at c3 and c4 |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project browser` | 45 passed at c3 and c4 |
| `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node` | 431 passed at c3 and c4 |
| `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser` | 35 passed at c3 and c4 |
| `pnpm -F @proj-airi/qa-tools exec vitest run --project node` | 880 passed and 9 existing environment-gated skips at c3 |
| `pnpm -F @proj-airi/stage-pages exec vitest run` | 103 browser tests passed at c5; 102 at c3 |
| `pnpm -F @proj-airi/i18n exec vitest run` | 20 passed at c5 |
| `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project node` | 2,169 passed and 8 existing skips at c1 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance src/features` | 278 passed at c2 to c5 and c7; 276 at c1 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/stage-emotion-routing.browser.test.ts src/persistence` | 53 passed at c2 and c3 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/stage-emotion-routing.browser.test.ts src/persistence src/composables/use-data-maintenance.browser.test.ts` | 79 passed at c1, c4, c5, and c7 |
| `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` | 292 passed at c2 to c5 and c7; 291 at c1 |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d` | 513 passed at every worker item |
| `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` | 11 passed after policy edits and at c7 |
| `pnpm exec vitest run --project dev-tools scripts/dev-tools/storage-writes.test.ts` | 1 passed at c1 and c3; the initial c3 failure was repaired without an exception |

Focused and diagnostic test commands also ran:

| Command | Result |
| --- | --- |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/features/character-behavior/settings.test.ts` | 8 passed at c1; the later full suite includes 10 after malformed-group regressions |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/features/character-behavior/settings.browser.test.ts` | 3 passed at c1; the later full suite includes 6 after import and deletion regressions |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance src/features src/stores/situation` | 470 passed at c3 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/features/character-behavior/settings.browser.test.ts src/features/performance/settings.browser.test.ts src/features/situation/settings.browser.test.ts src/persistence src/composables/use-data-maintenance.browser.test.ts` | 110 passed at c3 |
| `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project browser src/composables/live2d/natural-settings.browser.test.ts` | 15 passed at c3 |
| `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser src/stores/natural-settings.browser.test.ts` | 14 passed at c3 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/character-mind.test.ts` | 26 passed at c4 after repairing the initial 23-pass, 3-failure fixture run |
| `pnpm -F @proj-airi/stage-pages exec vitest run src/pages/settings/behavior/index.browser.test.ts` | 1 passed at c5 |
| `pnpm -F @proj-airi/stage-pages exec vitest run src/pages/settings/behavior/index.browser.test.ts src/pages/settings/presence/index.browser.test.ts` | 7 passed at c5 |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings/live2d.browser.test.ts src/components/scenarios/settings/model-settings/mmd.browser.test.ts` | MMD's 20 passed; Live2D's suite import failed after an accidental value-store rename. Restoring the existing export fixed it |
| `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings/live2d.browser.test.ts --no-file-parallelism` | 42 passed; the first rerun had 38 passes and 4 stale cursor-control locators. Geometry checks now target the remaining Screen lean control with the same thresholds |
| `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project browser` | Initial c1 attempts exposed the unsupported new subpath and optimizer reloads, then concurrent ResizeObserver failures; no complete passing run is claimed |
| `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project browser src/renderer/app.browser.test.ts --no-file-parallelism` | The initial focused run had 1 pass and 2 failures; the leader fixture was missing the new owner and was corrected |
| `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project browser --no-file-parallelism` | 308 passed and 1 failed in c1; the reset path lacked the owner. `useDataMaintenance` now creates it |
| `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project browser src/renderer/composables/use-presence-notice-sync.browser.test.ts --no-file-parallelism` | The repaired reset test passed alone (1 test). No later full desktop browser pass is claimed |

All final dependent typechecks exited 0:

| Item | Command | Workspace projects selected |
| --- | --- | --- |
| c1 | `pnpm --filter "...@proj-airi/stage-ui" --filter "...@proj-airi/stage-tamagotchi" --workspace-concurrency=2 typecheck` | 7 |
| c2 | `pnpm --filter "...@proj-airi/stage-shared" --filter "...@proj-airi/character-mind" --filter "...@proj-airi/stage-ui" --workspace-concurrency=2 typecheck` | 28 |
| c3 | `pnpm --filter "...@proj-airi/stage-shared" --filter "...@proj-airi/stage-ui" --filter "...@proj-airi/stage-ui-live2d" --filter "...@proj-airi/stage-ui-mmd" --filter "...@proj-airi/stage-pages" --filter "...@proj-airi/qa-tools" --workspace-concurrency=2 typecheck` | 28 |
| c4 | `pnpm --filter "...@proj-airi/character-mind" --filter "...@proj-airi/stage-ui" --filter "...@proj-airi/stage-ui-live2d" --filter "...@proj-airi/stage-ui-mmd" --workspace-concurrency=2 typecheck` | 10 |
| c5 | `pnpm --filter "...@proj-airi/stage-ui" --filter "...@proj-airi/stage-pages" --filter "...@proj-airi/i18n" --workspace-concurrency=2 typecheck` | 29 |

Diagnostic typechecks used `pnpm -F @proj-airi/stage-ui typecheck` and the
following exact package selections with `--workspace-concurrency=2 typecheck`:

- `pnpm --filter @proj-airi/stage-shared --filter @proj-airi/stage-ui-live2d --filter @proj-airi/stage-ui-mmd --filter @proj-airi/stage-ui --filter @proj-airi/stage-pages --filter @proj-airi/qa-tools --workspace-concurrency=2 typecheck`
- `pnpm --filter @proj-airi/stage-ui-mmd --filter @proj-airi/stage-ui --filter @proj-airi/stage-pages --filter @proj-airi/qa-tools --workspace-concurrency=2 typecheck`
- `pnpm --filter @proj-airi/stage-ui --filter @proj-airi/stage-pages --filter @proj-airi/qa-tools --workspace-concurrency=2 typecheck`
- `pnpm --filter @proj-airi/character-mind --filter @proj-airi/stage-ui --filter @proj-airi/stage-ui-live2d --filter @proj-airi/stage-ui-mmd --workspace-concurrency=2 typecheck`

The c3 diagnostics found stale settings assertions, a stale QA variable, an
unused import, and a browser-only shared barrel reaching Node QA through quiet
application defaults. The owning readers and fixtures were migrated; the
schema now reads the existing preload platform directly. No tsconfig or type
suppression was added. The c4 diagnostic selection passed before its dependent
run. Mind-store snapshot tests now use the sync plugin's actual top-level
function patch, and sequence assertions account for the initial behavior
stimulus. The storage scanner required literal retired-key removals instead of
an unresolved spread; no whitelist or test exemption was added.

`pnpm -F @proj-airi/i18n build` passed after the English changes. Both
`pnpm i18n:check` runs exited 0: first 825 warnings, then 821 after removing four
unused MMD leaf keys. The final report excludes 641 known baseline diagnostics
and reports 25 fixed diagnostics; the baseline file was untouched. Two remaining
unused-key reports name the new route's metadata title and description, which
are consumed by the generic settings layouts. Final c5 ESLint had no warnings.
c3's lint had eight existing warnings in unchanged helpers/comments; none was
suppressed. Every commit's hook passed. Package browser fixtures retain their
model-loader and synchronization teardown logs; these do not establish app
error counts.

c7 changes documentation only. Its policy guard passed 11 tests and the five
named inner loops passed 146, 278, 79, 292, and 513 tests. No package type changed
after the successful c5 dependent check.

## Orchestrator acceptance handoff (CM7c)

The [behavior settings ADR](../../docs/ai/adr/2026-11-22-character-behavior-settings.md#consequences)
contains an explicit placeholder. The worker has not run these checks:

1. Compare seed-1 defaults against the base for all ten headless scenarios:
   `idle`, `idle-drive`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`,
   `walk`, `sleepy-no-clip`, `touch`, and `music`. Require `IDENTICAL` in each.
   Check disabled idle separately: no idle act, matching the null-drive behavior.
2. Run both-host smoke and rendered checks 6 to 9 from section 9. Seed all four
   old documents with MMD-only idle off; confirm the Behavior page and stored
   new key, and the absence of old renderer behavior controls. Disable MMD
   cursor attention and require no cursor episode. Set a c6 mapping weight to
   zero and require no pick over ten ACT emotions. Delete all data and confirm
   the behavior key stays absent.
3. Capture Behavior in light and dark, at desktop and mobile widths. Check all
   five sections, the save-error treatment, and renderer/Presence navigation.
4. Record run directories, gate/report lines, event kinds and counts without
   content, and zero renderer and main-process errors for every app launch.
   Publish those results in the ADR placeholder and the eventual PR report.

Scores prove direction, size relative to the recipe, release, and detectability
above the rig's idle noise. They do not prove naturalness, which stays a visual
review.

## Commits (CM7c)

| Item | Commit | Title |
| --- | --- | --- |
| c1 | `664f2f846` | `feat(stage-ui): add the character-behavior settings document` |
| c2 | `852fcbdfb` | `refactor(stage-shared,stage-ui,stage-ui-live2d,stage-ui-mmd): narrow the renderer, expression, and presence documents` |
| c3 | `e59df1ecf` | `refactor(stage-ui,stage-ui-live2d,stage-ui-mmd,stage-shared,qa-tools): read behavior from one document` |
| c4 | `82e34ca0e` | `feat(character-mind,stage-ui): let the mind read the behavior switches` |
| c5 | `325fdefc7` | `feat(stage-pages,stage-ui,i18n): put behavior on one settings page` |
| c7 | This final documentation commit | `docs(ai): record the character-behavior settings and the register's home` |

c6 was already on the implementation base and was not recreated by this worker.

## Rendered acceptance (CM7c)

On 2026-11-22, motion QA's `configure` gained the loaded renderer's driver choices in `6f4c865b9`. Live2D accepts Natural, Universal, and MAGIC; MMD accepts Natural and classic through its realisation document command. Unsupported choices are rejected. The stage-shared suite passed 1,889 tests, the stage-ui Node project 1,986, and the related stage-ui browser tests 48. The requested dependent typecheck passed across 28 workspace projects. Changed-file ESLint and the commit hook passed. Stage-shared has one unnamed Node project, so its command omits `--project node`. No repository-wide verify ran.

Run directories are relative to `.temp/qa-drivers/runs/`. Event counts cover the observed acceptance intervals.

- **6, old-profile import:** covered by Node tests (`features/character-behavior/settings.test.ts`: MMD-only idle off, off wins, existing document wins, invalid fields). AppSession removes its profile at teardown, so no rendered run is claimed.
- **7, MMD cursor permission: FAILED (positive control).** With cursor attention off, 24 native pointer moves gave 0 cursor mind steps, as required. With it on, 24 moves also gave 0 cursor steps and 0 cursor intents. The last run (`cm7c-mmd-1795335569681`) pinned the desktop-idle sensor to present and showed MMD props `cursorAttention: true`, performance `watching` with attention `cursor`, `away: false`, `paused: false`, a changing `cursorPosition`, and all MMD capabilities declared. The first two runs (`cm7c-mmd-1795335312946`, `cm7c-mmd-1795335487925`) saw the user as away, because macOS hardware idle does not reset under synthetic pointer events. Cause not found; it is outside the bridge. Each of the three launches had 0 renderer and 0 main errors.
- **8, zero mapping weight: passed.** In `cm7c-live2d-1795336060514` three ACT `happy strong` baseline cues produced three slot picks, including the entry that was then weighted 0. Ten ACT cues after the weight was saved gave 0 picks of that entry (10 `act`, 21 `mind` events). The earlier run `cm7c-live2d-1795335671162` showed the same exclusion without a positive control, so it is not counted.
- **9, Delete all data: passed within one launch.** AppSession cannot keep a profile across launches. In `cm7c-live2d-1795336060514` a seeded behavior document (all four switches off, other fields changed) was stored; `deleteAllData` returned ok; after a renderer reload and onboarding, `settings/character-behavior` was absent and the document read defaults. Only `settings/situation-inner` remained in the old-key scan, which this check does not cover.
- **Behavior captures:** 12 PNGs in `cm7c-live2d-1795336060514/` (desktop 1280x760 and mobile 390x760, light and dark, three scroll positions each: top, Feelings, Speaking up). Page scroll width equals viewport width in all 12, so there is no horizontal overflow. Light and dark both render all five sections, and long descriptions wrap on mobile. Layout notes: the "Settings" breadcrumb above the title has very low contrast in light mode; the Chattiness slider track is nearly invisible in light mode, with only a thin thumb and no visible fill; a dev overlay badge covers the bottom center of every frame. The Quiet apps field and the save-error alert were not reached by these captures.
- **Error counts:** the three MMD launches and the first Live2D launch had 0 renderer and 0 main errors. `cm7c-live2d-1795336060514` had 6 renderer errors (0 main), all failed WebSocket connections (`ERR_CONNECTION_RESET` or `ERR_SOCKET_NOT_CONNECTED`) to the local server channel from the settings and onboarding windows, between the captures and the end of the run, when Delete all data and the reload ran. The run then ended with a CDP timeout on its final event read. The requirement of 0 errors for every launch is not met for that launch, and I have not established whether the cause is the deletion step or the test harness.

Every launch tore down cleanly.
