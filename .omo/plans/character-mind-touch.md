# character-mind-touch - Work Plan

Status: done on the branch `luke/feat/character-mind-touch` on 2026-11-18, not yet merged. The commits are listed in [Commits](#commits), and the checks in [Checks run](#checks-run). Roadmap row: slice CM1 in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Rulings: the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md). Branch: `luke/feat/character-mind-touch`, cut from `main` at `872b74cb5`, which contains upstream `moeru-ai/airi` through `b3a6d6071`. One PR against `lschneiderny/airi`.

The owner is away and runs these slices without a plan review. Every design fork below is taken on the recommended option and listed in [Decisions open to the owner's veto](#10-decisions-open-to-the-owners-veto).

## TL;DR (For humans)

**What changes:** A new pure package, `packages/character-mind`, answers a pet or a poke once. One function decides the body reaction, the mood dose, the moment expression, and the spoken line together, on one clock and one random source. The scenes stop reacting to a touch on their own: they report it and perform what the mind returns. The expression decider splits: the mind decides the emotion, its strength, and its hold, and the decider that stays with each stage picks the expression entries.

**Why:** Today one touch reaches five deciders with five states and three clocks (autonomous-behavior overlap 4). Later slices (return, voice, idle, gaze) need the same core and shell.

**What does not change:** Behavior. No threshold, roll, cooldown, or gesture is tuned. Universal, MAGIC, and classic keep upstream's touch and motion.

**Effort:** L. **Risk:** Medium. The risk is the expression split, which changes the signal contract of the picker and the planner and every test that feeds them.

## 1. Upstream first

Read from the tree at `872b74cb5`. `git diff b3a6d6071 HEAD` is empty for every path in this table unless the last column says otherwise.

| Upstream has | Code | Who uses it | Fork difference |
| --- | --- | --- | --- |
| A Live2D touch module (`259b6188a`, #3292): region resolution, a tap and pat tracker, an additive head, body, and eye reaction, and the model's touch motion group | `packages/stage-ui-live2d/src/composables/live2d/touch.ts` (`resolveLive2DTouchRegion`, `createLive2DTouchGestureTracker`, `createLive2DTouchReaction`, `findLive2DTouchMotionGroup`); `useMotionUpdatePluginTouchReaction` in `motion-manager.ts`; `react` and `playTouchMotion` in `Model.vue` | `Live2D.vue` pointer handlers | The module is at upstream's bytes. `Live2D.vue` and `Model.vue` run it only under Universal and MAGIC (`touchGesturesActive`) |
| Avatar touch notify (`43a282bd9`, #3299): a burst of taps and pats becomes one Spark Notify per region | `packages/stage-ui/src/libs/avatar-touch/notify.ts` (`createAvatarTouchAggregator`, `createAvatarTouchCooldown`, `toAvatarTouchSparkNotify`); `packages/stage-ui/src/stores/character/avatar-touch.ts` (`useAvatarTouchStore().notifyTouch`, a leader-routed action) | `Stage.vue` `onAvatarTouch` | At upstream's bytes. `Stage.vue` drops the burst under Natural |
| `packages/core-character`: one contract file, `avatar-model.ts` | Built to `dist` with tsdown; depends on `@moeru/std`, `@proj-airi/stream-kit`, `clustr` | `stage-ui` and `stage-ui-live2d` (their `types/avatar-model.ts`) | None. Its README invites renderer-neutral character runtime modules, and it holds none |
| `packages/core-agent`: the chat orchestrator runtime, the Spark Notify and Spark command agents, voice input and output, message projection | `src/runtime/chat-orchestrator-runtime.ts`, `src/agents/**`, `src/voice/**` | `stage-ui`, `stage-pages`, `qa-tools`, `agents` | 36 files differ. Its guide forbids new stage semantics. It holds no body or touch logic |
| The character orchestrator store: Spark Notify handling and task reminders on the leader's ticker | `packages/stage-ui/src/stores/character/orchestrator/store.ts` | `useAvatarTouchStore`, plugins | Fork edits route a notify addressed to the character into the situation |
| Motion drivers `motion-driver-magic`, `model-driver-magic-live2d`, `model-driver-lipsync` | Their packages | `stage-ui`, `stage-ui-live2d` | Two, two, and seven files differ. `motion-driver-natural` and `motion-driver-humanoid` are fork-only |
| Card-owned Live2D controls and a Live2D context (`c4048b6fa`, then `84af9b4a5`); upstream deleted its expression store and controller | `packages/stage-ui-live2d/src/contexts/live2d.ts` (`createLive2D`), `contexts/expressions.ts`, `controls/policy.ts`; blended by `useMotionUpdatePluginExpression` | `Stage.vue` creates the context with the card's `config.controls`; `useSharedLive2DExpressionPreview` in `packages/stage-ui/src/stores/live2d.ts` is its only activator in the fork. No fork code calls `expressions.execute` | The fork keeps its own store, controller, slots, holds, and catalog beside the context (fork-only files under `src/stores/` and `src/composables/live2d/expression*`) |

For this slice:

- **Adopts unchanged:** upstream's touch module, avatar touch notify, `core-character`, and the Live2D context. Universal and MAGIC keep upstream's touch behavior exactly (ADR decision 7).
- **Builds beside upstream:** `packages/character-mind`, a fork-only package. The mind does not go into `core-character` (see [section 4](#4-the-package-decision)).
- **Changes these upstream files**, each already edited by the fork:

| Upstream file | Why |
| --- | --- |
| `packages/stage-ui/src/components/scenes/Stage.vue` | It is the window that hosts the stage. It creates the mind, hands touches to the conductor, and passes the voice and moment realisers |
| `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`, `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` | Under Natural the scene reports a touch and performs the mind's touch reaction. The Universal and MAGIC path in both files is not edited |
| `packages/stage-ui-mmd/src/components/scenes/MMD.vue` | The same for the MMD scene under Natural |
| `packages/stage-ui/package.json`, `packages/stage-ui-live2d/package.json`, `packages/stage-ui-mmd/package.json` | One dependency line each for `@proj-airi/character-mind` |
| `eslint.config.ts` | One boundary block for the new package (the file is a union at every sync) |
| `docs/ai/context/ui-components.md` | Its "Live2D scene API" section states the `naturalTouch` event, which changes |

## 2. Today's touch paths in the fork

**Detection.** Four places classify a touch:

| Renderer and driver | Detector | Gate |
| --- | --- | --- |
| Live2D, Natural | `Model.vue` `onTouchPointer` feeds `NaturalTouchGestures` (`packages/motion-driver-natural/src/touch-gestures.ts`), with regions from `headTracker.interactionBounds` and `live2DVisibleBounds` | `touchActive`: the `touch` setting, driver Natural, not paused |
| Live2D, Universal and MAGIC | `Live2D.vue` pointer handlers feed `createLive2DTouchGestureTracker`; hit test `Model.vue` `touchAt` | `touchGesturesActive`: driver not Natural |
| MMD, Natural | `MMD.vue` pointer listener and `renderLoop` feed `MMDTouch` (`packages/stage-ui-mmd/src/composables/mmd/touch/touch.ts`), which wraps `NaturalTouchGestures` | `touchActive`, as on Live2D |
| MMD classic, VRM, Spine, tachie | None. A search of `packages/stage-ui-three/src`, `packages/stage-ui-spine/src`, and `packages/stage-ui-tachie/src` finds no pet or poke classifier | |

**Deciders under Natural, in the order they run for one poke or pet:**

1. **Natural's body and face response, started by the scene.** Live2D: `Model.vue` `handleTouchEvents` pushes the poke to `pendingNaturalPokes` and sets `naturalPetHand`; `Live2DNaturalMotionAdapter` hands them to `NaturalMotion` `poke` and `setPet`. MMD: `MMD.vue` `handleTouchEvents` calls `MMDNaturalAdapter` `poke` and `setPet`, and `noteInteraction()`. That call sets the interaction time of the body director (`decideBody`), so on the desktop stage a touch can also start the walk toward the cursor inside `CHASE_WINDOW_MS`; the window host has no root motion. At the next grid step `startPending` (`packages/motion-driver-natural/src/pending-actions.ts`) starts the nudge, the surprise impulse (deduplicated for `pokeSurpriseDedupeSeconds`, 2 s, on Natural's active-seconds clock), and the camera glance. `NaturalPetLayer` runs the pet, and `NaturalMotion` adds the camera glance after a pet longer than 3 s.
2. **MMD body reaction.** `createReactionLayer` (`packages/motion-driver-humanoid/src/performance/reactions.ts`) reads the poke and pet records of Natural's body intent and flinches or follows. It keeps its own 2 s repeat scale on the performer's tick clock.
3. **Mood dose.** The scene emits the gesture (`naturalTouch` on Live2D, `touch` on MMD). `Stage.vue` `onTouch` calls `useStageTouchStore().touch` (`packages/stage-ui/src/stores/touch.ts`), which calls `StagePerformanceConductor` `touch`. The decider's `touch` signal runs `touchAffect` (`packages/stage-shared/src/expression-performance/touch-affect.ts`) with `TouchAffectMemory` inside the decider state, on the conductor's `performance.now` clock. The dose reaches `scene.addMood`.
4. **Spoken line.** The same store emits `situationTouchObservedEvent` (`packages/stage-ui/src/stores/situation/touch-bus.ts`) on the speech bus for a pet end and a poke. The leader's `useSituationStore` listener calls `ingest`, which reduces the touch into the situation and calls `evaluateReaction`. `reactionPolicy` (`packages/stage-shared/src/situation/reaction-policy.ts`) decides with `ReactionMemory`, its own Mulberry32 checkpoint, and `Date.now`. A speak decision runs `react`, which calls `useChatStore().submitReaction`. The memory is saved in the gate's inner state (`packages/stage-ui/src/features/situation/inner-state.ts`).
5. **Moment expression, Live2D only.** `Stage.vue` `onTouch` calls `useIdleProps().onMoment('poked' | 'petted')` (`packages/stage-ui/src/composables/performance/use-idle-props.ts`), which draws a 0.6 chance and a pick from `Math.random` and rests each entry 60 s.

The situation's touch event also reaches the slow character state through `bridgeSituationToCharacter` (`packages/stage-ui/src/stores/character-state/situation-bridge.ts`). Overlap 4 does not count it, and this slice does not move it.

**Under Universal and MAGIC:** `Live2D.vue` recognizes a tap or pat, `Model.vue` `react` adds the touch reaction, `playTouchMotion` plays the model's touch motion on a tap, and `Stage.vue` `onAvatarTouch` records the touch in the aggregator, which calls `useAvatarTouchStore().notifyTouch`. The gate decides whether she speaks. None of the five Natural deciders runs.

**Overlap 4 in code terms.** One classified gesture fans out in two places, the scene and `Stage.vue` `onTouch`, to five deciders. Each holds its own state: Natural's pending actions, `TouchAffectMemory` in the decider state, `momentHistory` in `useIdleProps`, `ReactionMemory` in the situation store, and `lastPoke` in the reaction layer. They read three clocks and three random sources, and one of them is reached over an Eventa bus. No function sees more than one of these states.

## 3. The design

### 3.1 The core

The ADR's "Interface of the mind" rule, implemented as written:

> The core is a pure function, `step(state, stimuli, nowMs, rng) -> { state, intents }`, over plain serializable state. A thin class owns the clock, the random source, and persistence. It runs in the window that hosts the stage, which is the leader today, and calls the core in-process. A transport to other windows is added only when a second live stage exists; until then the core stays pure and its intents serializable, so one can be added. Tests drive the core with scripted stimuli and a seeded random source, with no Vue and no timers.

Public types of `@proj-airi/character-mind` (`src/types.ts`). Types named without a definition come from `@proj-airi/stage-shared/expression-performance` or `@proj-airi/stage-shared/situation`.

```ts
/** Uniform draws in [0, 1). The shell owns the source; the core stores none. */
export type MindRandom = () => number

/** A classified touch, as a scene reports it. A poke's point is relative to the touched region: x from -1 (left) to 1, y from -1 (top) to 1. */
export type TouchGesture
  = | { gesture: 'poke', region: 'head' | 'body', point: { x: number, y: number } }
    | { gesture: 'pet-start', region: 'head' }
    | { gesture: 'pet-end', region: 'head', durationMs: number }

export type MindStimulus
  /** `voice` is null for a pet start and when no leader gate runs; the mind then decides no line. */
  = | (TouchGesture & { kind: 'touch', settings: ExpressionPerformanceSettings, voice: TouchVoiceView | null })
  /** An ACT emotion, a tool call, or a devtools pulse. `nominal` is already scaled by the card's expressiveness. */
    | { kind: 'emotion', source: 'act' | 'tool' | 'devtools', emotion: PerformanceEmotion, nominal: number, turnId?: string, settings: ExpressionPerformanceSettings }
  /** The model named an entry. The performer read the entry's lease and its primary emotion mapping from its catalog. */
    | { kind: 'expression-request', source: 'act' | 'tool', entryId: string, lease: { holdSeconds: number, until: 'speech' | 'hold' }, mapping: { emotion: PerformanceEmotion, minBand: Band } | null, turnId?: string, settings: ExpressionPerformanceSettings }
    | { kind: 'expression-clear', source: 'act' | 'tool' | 'devtools', slot?: SlotCommand['slot'], turnId?: string }
  /** What became of a `speak` intent. `refused` means another unprompted turn was pending. */
    | { kind: 'voice-outcome', eventId: string, outcome: GateOutcome | 'refused' }

interface IntentBase {
  id: string
  /** Sequence number of the stimulus this intent answers; every intent of one response shares it. */
  cause: number
}

export type MindIntent
  = | (IntentBase & { channel: 'posture', kind: 'touch-reaction', gesture: 'poke', region: 'head' | 'body', point: { x: number, y: number } })
    | (IntentBase & { channel: 'posture', kind: 'touch-reaction', gesture: 'pet', phase: 'start' | 'end' })
    | (IntentBase & { channel: 'posture', kind: 'mood', dose: MoodDose })
    | (IntentBase & { channel: 'face', kind: 'emotion', episode: ReactionEpisode, hold: HoldCommand, reason: 'act' | 'tool' | 'devtools', turnId?: string })
    | (IntentBase & { channel: 'face', kind: 'entry', entryId: string, episode: ReactionEpisode | null, hold: HoldCommand | null, reason: 'act' | 'tool', turnId?: string })
    | (IntentBase & { channel: 'face', kind: 'release', scope: 'neutral' | 'all' | SlotCommand['slot'], hold: HoldCommand | null, reason: 'act' | 'tool' | 'devtools', turnId?: string })
    | (IntentBase & { channel: 'face', kind: 'moment', moment: 'poked' | 'petted' })
    | (IntentBase & { channel: 'voice', kind: 'speak', line: ReactionKind, eventId: string })

/** Plain JSON. Everything here is fast state: it resets on launch (ADR decision 10). */
export interface MindState {
  /** Stimuli answered so far. */
  seq: number
  /** Emotion strength and habituation: the emotion half of the expression decider. */
  reaction: ReactionState
  touch: { affect: TouchAffectMemory }
  voice: { reaction: ReactionMemory, lastDecision: ReactionDecision | null }
}

export function initialMindState(): MindState
export function step(state: MindState, stimuli: readonly MindStimulus[], nowMs: number, rng: MindRandom): { state: MindState, intents: MindIntent[] }
```

`nowMs` is epoch milliseconds. The rules that count seconds (`touchAffect`, `acceptReaction`) receive `nowMs / 1000`. `settings` rides on the stimulus because the conductor resolves it per signal under the card profile of the signal's turn (`effectiveContext`), as it does today.

**How a touch becomes one response.** For a `touch` stimulus, `step` runs these in order, on the same state:

| Channel | Rule | Intent |
| --- | --- | --- |
| Posture | Every touch gets a reaction | `touch-reaction`: a poke with its region and point, or a pet `start` or `end` |
| Posture (mood) | `touchAffect(state.touch.affect, ...)`, unchanged | `mood` when it returns a dose |
| Face | A poke and a pet end are moments | `moment` `poked` or `petted` |
| Voice | For a poke or a pet end with a `voice` view: `reactionPolicy`, with the pacing of `state.voice.reaction` and a draw from `rng` | `speak` when the policy decides to speak; the decision is kept in `state.voice.lastDecision` either way |

A `voice-outcome` stimulus settles `state.voice.reaction` through `settleReaction`. A `spoken` outcome always sets `lastLineAtMs`, also when no attempt is pending.

**Emotion.** `emotion` runs `acceptReaction` and returns an `emotion` intent with the episode and `emotionHold(...)`, or a `release` with scope `neutral` when a neutral reset the reaction state. `expression-request` runs the logic of today's `explicitExpressionReaction` on the performer-supplied mapping and lease, and returns an `entry` intent. `expression-clear` returns a `release` whose hold is `releaseHold(turnId)` when no slot is named.

**The touch rulings after the slice** (autonomous-behavior Target, "Rulings the slices keep"):

| Ruling | Where it holds |
| --- | --- |
| A pet or poke gets a mood change or an expression every time | `step` emits a `touch-reaction` for every touch; the dose and the moment follow their unchanged rules |
| A spoken line only occasionally | `reactionPolicy`, unchanged odds and waits, called by `step` |
| Pets melt into the hand: no look-up and no camera snap while a pet runs | `NaturalGazeLayer` and `NaturalPetLayer`, unchanged; the performer runs frames |
| A pet longer than 3 s ends with one camera glance of about 1.2 s | `NaturalMotion` (`longPetDurationSeconds`, `petGlanceDurationSeconds`), unchanged |

### 3.2 The shell

`CharacterMind` (`packages/character-mind/src/mind.ts`) is the ADR's thin class:

```ts
export interface MindStep { atMs: number, stimuli: readonly MindStimulus[], intents: readonly MindIntent[], state: MindState }

export class CharacterMind {
  constructor(options: { seed: number, clock?: () => number })
  readonly state: MindState
  /** Answers the stimuli now and returns the intents. */
  receive(...stimuli: MindStimulus[]): MindIntent[]
  /** Calls the listener after every step; returns the function that stops it. */
  onStep(listener: (step: MindStep) => void): () => void
}
```

- `clock` returns epoch milliseconds and defaults to `Date.now`. The class never lets time run backwards: it passes `Math.max(previous, clock())`, because `touchAffect` and `acceptReaction` drop a stimulus older than the last one.
- The random source is `seededRandom(seed)` (`src/random.ts`), built on `seedRng` and `nextRandom` of `packages/stage-shared/src/situation/rng.ts`.
- It persists nothing in this slice. CM4 adds load and save for the slow state.

**Which window.** `Stage.vue` hosts the stage and is rendered by the leader window. A new composable, `packages/stage-ui/src/composables/performance/use-character-mind.ts`, creates one `CharacterMind` per `Stage.vue` with a seed from `crypto.getRandomValues`, forwards each step's voice decision to the devtools reaction inspector (`recordReactionDecision` and `publishReactionMemory` of `packages/stage-ui/src/stores/devtools/situation-observability.ts`), and stops its listeners with the scope.

**How the stage calls it and how performers receive intents.** `StagePerformanceConductor` stays the stage's one dispatcher. It is a plain class that `packages/qa-tools/src/t2/scenario-sink.ts` also constructs, so the headless Live2D pipeline performs the same path. Its options gain `mind: CharacterMind`, `markMoment?: (moment: Moment) => void`, and `voice?: () => TouchVoicePort | undefined`. `StagePerformanceScene` gains `reactToTouch?: (intent) => void`.

| Intent | Realiser |
| --- | --- |
| `touch-reaction` | `scene.reactToTouch`. Live2D `Model.vue`: a poke is pushed to `pendingNaturalPokes`; a pet `start` grants the pet hand to Natural and `end` withdraws it. MMD `MMD.vue`: a poke calls `natural.poke` and `noteInteraction()`; a pet `start` grants the pet hand and calls `noteInteraction()` |
| `mood` | `scene.addMood(dose)`, Natural only |
| `moment` | `markMoment`, which `Stage.vue` binds to `idleProps.onMoment`. The performer keeps the chance, the pick, and the entry rest |
| `emotion`, `entry`, `release` | The conductor turns the intent into a signal for the asset decider and applies its slot commands. Under Natural it also calls `scene.setEmotion(episode)` and `scene.applyHolds([hold])`. Under the other drivers it plays the motion group, as today |
| `speak` | `voice().speakReaction({ kind, eventId })`. The conductor feeds the result back as a `voice-outcome` stimulus |

`conductor.touch(gesture: TouchGesture)` replaces today's `touch`. Under Natural it builds the `TouchObservation` (none for a pet start), asks `voice().observeTouch(observation)` for the view, sends the stimulus with the active card's effective settings, and dispatches the intents. `Stage.vue` `onTouch` becomes one call to it.

**The voice port** is two new methods of `useSituationStore`, which the leader's stage calls in-process. The Eventa hop is deleted (ADR decision 9 defers a transport).

```ts
/** What the mind sees of the voice channel and of the touch the situation just recorded. Defined in reaction-policy.ts. */
export interface TouchVoiceView {
  sessionId: string
  /** The situation event of this touch, or null when the situation did not record it. */
  eventId: string | null
  /** The merged pet span this touch ended, or null for a poke. */
  pet: { startedAtMs: number, durationMs: number } | null
  /** Recent poke times, this one last. */
  pokeTimesMs: readonly number[]
  lastCharacterLineAtMs: number | null
  /** Why the voice channel cannot take a line now, or null. */
  held: ReactionHardReason | null
}
```

- `observeTouch(observation): TouchVoiceView | null` reduces the touch into the situation, as `ingest` does today, and returns the view. It returns `null` in a follower window and while the gate does not run.
- `speakReaction({ kind, eventId }): Promise<GateOutcome | 'refused'>` is today's `react` without the memory: it refuses while an unprompted turn is pending, marks the event shown, calls `submitReaction`, and resolves at the first spoken literal, at a decline, or with the submit result. A spoken line still starts the gate's floor (`recordExternalSpeech`) and records the outcome for the inspector.

**Character state.** The slow mood dose of a touch stays on `bridgeSituationToCharacter`, which reads the one situation event that `observeTouch` records. CM4 moves it.

### 3.3 The expression split

"Emotion in the mind, asset choice in each performer" means this cut through `packages/stage-shared/src/expression-performance`:

| Side | Owns | Code after the slice |
| --- | --- | --- |
| Mind | The emotion, its strength and band, escalation, habituation, the emotion hold, and the reason | `step` calls `acceptReaction` (`reaction-strength.ts`) and `emotionHold` and `releaseHold` (`selection.ts`). `ReactionState` lives in `MindState` |
| Performer | Which entries show it: tickets, recency, slot occupants, combos, the planner's timing and budget, moments, pastimes, and the user's mapping weights | `createDecider`, `createPickerDecider`, `createPlannerDecider`, run by the conductor with the catalog of the rendered model |

The asset decider's input (`AffectSignal` in `types.ts`) changes as follows. Its `speech`, `muted`, `timing`, `deadline`, and `clear` variants are unchanged, and `touch` is removed.

```ts
export type ChangedAffectSignal
  /** Replaces `emotion`: the mind already decided the episode. */
  = | { kind: 'reaction', episode: ReactionEpisode, turnId?: string, at: number }
  /** A neutral that reset the reaction state. */
    | { kind: 'neutral', turnId?: string, at: number }
    | { kind: 'expression', source: 'act' | 'tool', expressionId: string, holdSeconds?: number, episode: ReactionEpisode | null, turnId?: string, at: number }
```

`ChangedAffectSignal` is a name for this plan only; the three variants go into `AffectSignal`.

`PerformanceDecision` becomes `{ slots: SlotCommand[] }`. `PickerState` loses `reaction` and `touch`. `explicitExpressionReaction` is deleted; its logic is the mind's `expression-request` handling. The conductor reads a named entry's lease with `explicitExpressionCommand` and its mapping with `primaryMapping` before it sends the stimulus, so the mind needs no catalog.

- **The fork's expression store and controller** (`useExpressionStore`, `useExpressionController`, `EmotionHoldPerformer`, and `useMMDExpressionStore` on MMD) are the asset system of each Natural performer. They receive slot commands and holds exactly as today.
- **Upstream's Live2D context** stays as upstream ships it. It carries the card-owned control policy and the shared previews from settings. The mind never addresses it. While a preview is active, `useMotionUpdatePluginExpression` writes after the fork's `applyExpressions`, so the preview wins for as long as it lasts. The new ADR records this arrangement, which today rests only on an owner ruling.
- **Affect traces** record the asset decider's signals, which now carry the decided episodes. `AffectTraceSchema` moves to `version: 2`. A version 1 trace no longer parses.
- **Not in this slice** (Body ownership Target rule 5 lands in CM7): seeding a pick from the intent's id, and reports of masked or refused expressions.

## 4. The package decision

| | New `packages/character-mind` | Module in `packages/stage-shared` | Inside upstream's `packages/core-character` |
| --- | --- | --- | --- |
| Imports allowed | `@proj-airi/stage-shared/expression-performance` and `/situation` only; no Vue, store, or renderer | Any sibling in the package, which has `vue`, `pinia`, and `@vueuse/core` as runtime dependencies | Would need `stage-shared`, which inverts upstream's layering: no `core-*` package imports `stage-*` |
| Who depends on it | `stage-ui`, `stage-ui-live2d`, `stage-ui-mmd`, `qa-tools` | The 16 packages that already depend on `stage-shared` | `stage-ui`, `stage-ui-live2d` today |
| Upstream merge cost | None for the package; one line in three upstream `package.json` files | One more subpath in upstream's `package.json`, and the package the audit calls misdescribed grows again | Conflicts in an upstream package at every sync; ADR decision 14 says the mind sits beside upstream code |
| Test setup under per-package `test:run` | Its own `vitest.config.ts` (Node, wrapped in `withCpuSlots`) and `test:run` script, copied from `packages/motion-driver-natural` | The existing `stage-shared` suite | The package has no tests and builds to `dist`; consumers would need a build before every test |
| Lint boundary rule | One block for `packages/character-mind/src/**`, beside the motion driver neutrality block | A block scoped to one directory of a package that may import Vue elsewhere | None exists |

**Taken: a new `packages/character-mind`.** It gives the pure core a boundary that the package manifest and one lint block enforce, and later slices (voice, idle, gaze) grow it.

**`stage-shared` is neither renamed nor split in this slice.** A rename touches an upstream package that 16 packages import. A split of `situation` or `expression-performance` would move code that CM3 and CM7 rewrite. The pure rules (`touchAffect`, `acceptReaction`, `reactionPolicy`) stay where they are and the mind composes them; no file moves. The `stage-shared` README states that the package holds upstream's stage contracts and the fork's pure client rules. CM3 decides again when the gate moves, with this slice's ADR as the starting point. The two code findings of audit R5 are already fixed: the decider barrel no longer exports `affect-trace-diagnostics`, and `@moeru/eventa` is a declared dependency.

**Where it is recorded.** The body ownership doc says a new decision gets an ADR. Work item 8 adds `docs/ai/adr/<date written>-character-mind-core.md` with: the package decision and the R5 answer; the interface as built; the expression split and the two-expression-systems arrangement; the touch split by driver; and fast state without persistence. It also annotates the R5 row of the audit, as the R2 and R4 rows are annotated.

## 5. What is deleted

| Removed | Proof that nothing else used it |
| --- | --- |
| `packages/stage-ui/src/stores/touch.ts` (`useStageTouchStore`) and its test | `git grep useStageTouchStore` finds `Stage.vue`, the store, its test, `stage-emotion-routing.browser.test.ts`, the stage-ui README, two policy docs, and one frozen ADR |
| `packages/stage-ui/src/stores/situation/touch-bus.ts` (`situationTouchObservedEvent`) | `git grep situationTouchObservedEvent` finds the touch store and the situation store with their tests, `stage-emotion-routing.browser.test.ts`, and the stage-ui README |
| In `useSituationStore`: `evaluateReaction`, `react`'s memory handling, `settleReactionTurn`, `reactionMemory`, `setReactionMemory`, the touch listener, and the touch branch of `ingest` | They are private to the store |
| `reaction` in `innerStateEntries`, `SavedInnerState`, and `SavedInnerStatePatch`, with `ReactionMemorySchema` | `readStoredInnerState` reads field by field and drops unknown fields, so an older document still loads without a compatibility guard |
| `rngState` in `ReactionMemory`; `random` in `ReactionState`; the `seed` parameters of `initialReactionMemory` and `createReactionState` | `git grep -E "rngState\|createReactionState\|initialReactionMemory"` after work item 5 |
| The `touch` and `emotion` variants of `AffectSignal`, `moods`, `episodes`, and `holds` of `PerformanceDecision`, the touch branches of the picker and the planner, `explicitExpressionReaction` | Typecheck of every dependent of `stage-shared` in `pnpm verify` |
| The direct `natural.poke` and `setPet` calls in the scenes' `handleTouchEvents` | Each scene has one caller |

After the last work item, `git grep -nE "useStageTouchStore|situationTouchObservedEvent|evaluateReaction|explicitExpressionReaction"` must print nothing outside `.omo/` and `docs/ai/adr/`.

## 6. Docs that move with the code

Policy docs change in the commit that makes their statement false. The work item is named in brackets.

- **`docs/ai/context/autonomous-behavior.md`** [4]: merge the three Natural touch rows of Deciders into one row that cites `step` and the realisers; rewrite the "Expression reaction and combo" row for the split [2]. Add a Precedence rule: under Natural one touch gets one response, decided by `step`. Move the Touch bullet of "Rulings the slices keep" into that rule. Narrow Target rule 2 to the stimuli that remain (a return, a beat). Delete overlap 4 and its row in the Target table. Rewrite overlap 5 (the mind is created per `Stage.vue`, so two stages would still run two minds) and overlap 11 (names only). Keep the numbers of the remaining overlaps, because the roadmap cites them: write each as a bullet that starts with its bold number, so a renderer cannot renumber the list.
- **`docs/ai/context/body-ownership.md`** [4]: the Live2D introduction and the rule "One touch response per driver" (the Natural response starts from the mind's intent). Delete the known gaps "No ADR records the touch split by driver" and "Two Live2D expression systems run side by side" [8, with the ADR], and state the preview precedence as a Live2D rule. Reword Target rule 5 to what remains: seeded picks and refusal reports [2].
- **`docs/ai/context/state-persistence.md`** [4]: the member line of the gate's inner state and the known-gap row no longer list the reaction memory.
- **`docs/ai/context/llm-prompt.md`** [4]: the "Unprompted turns" paragraph says who starts `submitReaction`.
- **`docs/ai/context/glossary.md`** [2, 4]: Decider, Conductor, Touch reaction, and Reaction. Move Character mind, Stimulus, and Intent from "Target terms" to Terms with their code; Channel and Performer (target) stay.
- **`docs/ai/context/upstream-policy.md`** [8]: the "Touch on Live2D" and "Live2D expressions" rows get the settled reason and "Not planned"; the touch row leaves "Decisions to revisit", whose count becomes three.
- **`docs/ai/context/character-mind-roadmap.md`** [8]: CM1 status; remove "Where the mind lives" from Open questions; the "Touch thresholds..." row of the tuning table no longer waits; step L's sentence about the sync decisions.
- **`docs/ai/context/ui-components.md`** [4]: the "Live2D scene API" section (`naturalTouch` carries a `TouchGesture`; the scene exposes `reactToTouch`).
- **READMEs:** a new `packages/character-mind/README.md` with purpose, usage, when to use, and when not to use [1]; `packages/stage-shared/README.md` (purpose, the decider section and its example, touch affect, `reactionPolicy`) [2, 3]; `packages/stage-ui/README.md` (the touch section) [4]; `packages/stage-ui-live2d/README.md` and `packages/stage-ui-mmd/README.md` (touch) [4]; `packages/qa-tools/README.md` (the event ring and `airi_start`) [6].
- **Nested guides**, in a commit of their own [7]: the touch line of `packages/stage-ui-live2d/AGENTS.md`. The new package gets no guide: its lint block states its only rule.

## 7. Work items

Each item is one commit that passes `pnpm verify`, except where it says two.

1. **`feat(character-mind)`: the package, the types, the shell, and the emotion half of the core.** Add `packages/character-mind` (`package.json`, `tsconfig.json`, and `vitest.config.ts` copied from `packages/motion-driver-natural`; `README.md`; `src/index.ts`, `types.ts`, `step.ts`, `expression.ts`, `mind.ts`, `random.ts`). `step` handles `emotion`, `expression-request`, and `expression-clear` by calling `acceptReaction`, `emotionHold`, and `releaseHold` as they are. Until item 5, `initialMindState` takes the seed, because `acceptReaction` and `reactionPolicy` still hold their own checkpoints. Add the lint block `airi/character-mind-pure` in `eslint.config.ts`: in `packages/character-mind/src/**` forbid imports of `vue`, `pinia`, `@vueuse/*`, `@proj-airi/stage-ui*`, the `@proj-airi/stage-shared` root, `@proj-airi/stage-shared/stores/*`, and `@proj-airi/stage-shared/composables`; outside `mind.ts` and tests also forbid `Math.random`, `Date.now`, `performance.now`, and timers. Run `pnpm install` for the lockfile. Tests: `step.test.ts` and `mind.test.ts`, with a seeded source and no Vue: an episode with its hold, escalation, habituation, a neutral release, an entry with and without a mapping, a clear; a JSON round trip of the state continues identically; the same seed and script give the same intents; the clock never runs backwards.
2. **`refactor(stage-shared,stage-ui,qa-tools)`: split the expression decider.** `types.ts`, `picker.ts`, `planner.ts`, `selection.ts`, `trace.ts`, and `deciders.ts` as in section 3.3, except that the `touch` signal and `moods` stay until item 4. `StagePerformanceConductor` takes `mind`, and `emotion`, `expression`, and `clearExpression` call it first. `useStagePerformanceConductor` and `Stage.vue` create the mind through `use-character-mind.ts`. `packages/qa-tools/src/t2/scenario-sink.ts` and `packages/qa-tools/src/motion/conductor-smoke.test.ts` construct a mind. Tests: the hold cases of `holds.test.ts` and the reaction cases of `picker.test.ts` and `planner.test.ts` move to the mind's tests, re-pointed at `step`; the pick, recency, occupant, timing, and budget cases stay and feed `reaction` signals; `trace.test.ts` moves to version 2; `use-stage-performance-conductor.test.ts` and `stage-emotion-routing.browser.test.ts` construct a mind and keep every assertion on scene calls. No case is deleted.
3. **`refactor(stage-shared,stage-ui)`: give the reaction policy a voice view.** `reactionPolicy` takes `{ nowMs, gesture, view: TouchVoiceView }`. `reactionHardReason` is exported and takes the signals, the settings, and the situation. `ReactionPending` gains `previousAttemptAtMs`, and `settleReaction` accepts `refused`: it clears the pending attempt, restores that time, and frees a protest's burst. `useSituationStore` gains `observeTouch`; its touch listener calls it and then the policy, and the store still owns the memory. A refused line no longer returns its draw (D13). Tests: `reaction-policy.test.ts` keeps every case on the new input; the store's refused-send case asserts through `settleReaction`.
4. **`feat(character-mind,stage-ui,stage-ui-live2d,stage-ui-mmd)`: route touch through the mind and delete the old path.** `step` handles `touch` and `voice-outcome` (`src/touch.ts`). `conductor.touch` takes a `TouchGesture` and dispatches the intents; the decider's `touch` signal, `moods`, and the picker and planner touch branches go. The scenes emit a `TouchGesture` with the poke's region-relative point and expose `reactToTouch`; the pet hand reaches Natural only while the mind's pet runs, and `resetTouch` withdraws it. `Model.vue` normalizes the point as it does today when it queues a poke; `MMDTouch` hands each poke event the point that `takePokes` returns today. `useSituationStore` gains `speakReaction` and loses the items in section 5; `touch.ts`, `touch-bus.ts`, and the saved `reaction` field are deleted. `use-character-mind.ts` feeds the reaction inspector. `scenario-sink.ts` routes touches through the conductor; its scene keeps no `addMood`, so headless traces do not change. Docs as marked `[4]`. Tests: the mind's touch cases (every touch yields a touch reaction; dose pacing through the mind; a burst of three pokes speaks under a seeded draw; each hold reason; a `null` view decides no line and leaves the voice memory untouched; a refused outcome frees the burst; a late spoken outcome starts the refractory). `touch.test.ts` is deleted: its three cases assert the gesture mapping, which the conductor test now covers at `conductor.touch`. The two decider-level cases of `touch-affect.test.ts` move to the mind's tests. The reaction cases of `situation/index.test.ts` split: pacing cases move to the mind's tests; the gate floor, decline at stream end, single listing of a touch, and follower cases stay, on `observeTouch` and `speakReaction`. `situation-reactions.browser.test.ts` and the inner-state tests follow the removed fields.
5. **`refactor(stage-shared,character-mind)`: take every draw from the mind's random source.** `acceptReaction` and `reactionPolicy` take a `draw: () => number`; `ReactionState.random`, `ReactionMemory.rngState`, and the seed parameters go. `step` passes `rng`. Tests: `reaction-strength.test.ts` and `reaction-policy.test.ts` replace checkpoint assertions with a counting draw ("draws nothing" becomes "the draw was not called").
6. **`feat(stage-shared,stage-ui,qa-tools)`: show the mind's steps to QA.** Add `mind` to the kind picklist of `MotionQaEventSchema` (`packages/stage-shared/src/motion-scenario/bridge.ts`); `use-motion-qa-events.ts` records each step: the stimulus kind and gesture, each intent's channel, kind, id, and cause, and the voice decision. `airi_start` of the `airi-qa` MCP server gains `stageHost: 'window' | 'desktop'`, which seeds the profile as `packages/qa-tools/src/smoke/run.ts` does for `--stage-host desktop`; today `packages/qa-tools/src/mcp/session.ts` always sets `AIRI_STAGE_HOST=window`. Tests: `use-motion-qa-bridge.test.ts` reads a `mind` event; `packages/qa-tools/src/mcp/server.test.ts` covers `stageHost`.
7. **`docs(agents)`: the touch line of the Live2D guide.** Agent configuration only.
8. **`docs(ai)`: record the decisions and close the row.** The new ADR, the audit's R5 annotation, the ledger rows, the roadmap, and the body-ownership gaps marked `[8]`. This is the last commit, after the checks in section 8 pass.

**Order and parallel work.** Item 1 is first. Items 2 and 3 touch different files (the expression decider and the conductor; the reaction policy and the situation store) and can run in parallel. Item 4 needs both. Items 5 and 6 touch different files and can run in parallel after item 4. Items 7 and 8 are last.

## 8. Checks

- **Each commit:** `pnpm verify`. Inner loop: `pnpm -F @proj-airi/character-mind exec vitest run src/step.test.ts`, and for the other packages the narrowest project named in the root guide.
- **The branch:** `pnpm verify --gate --base origin/main`. The combination of the two flags was not run while this plan was written; each flag is documented in `scripts/dev-tools/README.md`.
- **Smoke on both hosts.** `.env.qa` is not in this worktree; create it there (it is ignored) or export the two variables it holds, `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`. The Live2D rig the repository's QA uses is ForBOOTH; the MMD model is the Chisa PMX.
  - `pnpm qa:display run -- pnpm qa:smoke`
  - `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"`
- **Headless motion is unchanged.** `pnpm qa:live2d-rig` passes. `pnpm qa:test:model` passes. `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario touch --seed 1 --out <dir>` at the base and at the tip, then `pnpm qa:motion3d diff` prints `IDENTICAL`: the runner pokes through the Natural adapter, whose contract this slice does not change.
- **Rendered touch.** No scripted touch exists for the rendered app: the bridge counts scenario `pointer` events and leaves the input to a harness (`qa:motion t3`) that is gone. The check uses the `airi-qa` MCP server, `airi_eval`, and the `mind` events of work item 6. Call `airi_stop` at the end of each session.
  1. **Live2D under Natural, classic window.** `airi_start` with `model` set to the ForBOOTH directory. `airi_state` must report `driver: 'natural'` and a `head` rect. With `airi_eval`, dispatch on the Live2D canvas a `pointerdown` and, 60 ms later, a `pointerup` at the head's center (`new PointerEvent(type, { isPrimary: true, button: 0, clientX, clientY, bubbles: true })`). Pass: `airi_events` shows exactly one `mind` event for the poke, and its intents share one `cause` and are one `posture/touch-reaction`, one `face/moment`, at most one `posture/mood`, and at most one `voice/speak`. Then send three pokes inside 10 s: the third event must carry a voice decision, a speak or a hold with its reason. When it speaks, the log must also show one `turn` and one `tts` event and no second line for 45 s. Then stroke across the head with `pointermove` events for 3.5 s, reversing direction: pass is one `pet-start` step and one `pet-end` step, and an `airi_screenshot` taken during the stroke shows the pet face. `airi_errors` must be empty.
  2. **MMD on the desktop stage.** `airi_start` with `model` set to the Chisa PMX, `kind: 'mmd'`, and `stageHost: 'desktop'`. Read `touch.headScreenPoint` from the MMD motion diagnostics snapshot, with the page-side helper that `packages/qa-tools/src/stage/handoff.ts` uses, and dispatch the same poke on the MMD canvas there. Pass: one `mind` event with one `cause`; the diagnostics snapshot's `touch.events` rises by one; a second poke 500 ms later yields a second `mind` event. A screenshot after the poke goes into the PR for review by eye. `airi_errors` must be empty.
  3. **Universal is untouched.** In session 1, switch the Live2D driver to Universal and tap the head: no `mind` event appears, and the upstream reaction plays.
- Record the run directories and the event excerpts in the PR description.

## 9. Risks and what later slices get

| Risk | Mitigation |
| --- | --- |
| The expression split changes the signals of the picker and the planner | Work item 2 changes only the contract; every existing assertion on picks and scene calls stays. Compare-mode replay still compares the two policies on equal episodes |
| A pet that the mind does not grant would never show | The grant is set in the same call stack as the scene's emit; the mind's tests assert that every pet start returns a pet reaction |
| The voice outcome arrives after the stage or the leadership changed | `speakReaction` resolves `failed` in that case, as `react` does today |
| Synthetic pointer events may not satisfy the scene's handlers in Electron | Not verified. If they do not, drive the pointer through the QA display's KWin EIS (`packages/qa-tools/scripts/linux/kwin-pointer.py play`), which supports a press and a release |

**Left for later slices, without a rewrite of the core's types:**

- **CM2, a return event.** A new member of `MindStimulus`, `{ kind: 'return', awayMs, wake: boolean }`, sent by `Stage.vue` where it calls `idleProps.onMoment('welcome-back')` today. `step` answers with `{ channel: 'face', kind: 'moment', moment: 'welcome-back' }` and a posture reaction for the wake. Only the two unions widen.
- **CM3, a voice decision.** The urge gate's memory joins `MindState.voice`. An `elapsed` stimulus carries the gate's signals the way `TouchVoiceView` carries them for a touch. A reach-out leaves as a second kind of `speak` intent, and its result returns as the same `voice-outcome` stimulus.
- **CM4:** one mind per character; the fast Natural mood and the bridge's slow touch dose move into the mind's state; `CharacterMind` gains load and save.
- **CM6:** the poke's camera glance leaves the touch reaction and becomes a gaze intent.
- **CM7:** capabilities, refusal reports, picks seeded from the intent's id, the card control policy as a filter on the performer's catalog, and no intents for Universal, MAGIC, and classic.

## 10. Decisions open to the owner's veto

| # | Fork | Options | Taken | Why |
| --- | --- | --- | --- | --- |
| D1 | Where the mind lives | A new package; a module in `stage-shared`; inside `core-character` | A new `packages/character-mind` | Section 4 |
| D2 | `stage-shared` | Rename; split now; neither | Neither now; CM3 decides again | A rename edits an upstream package; a split moves code that CM3 and CM7 rewrite |
| D3 | The pure rules the mind uses | Move them into the new package; compose them where they are | Compose them | No file moves, and the asset decider keeps its types beside them |
| D4 | The spoken touch reaction | Leave `reactionPolicy` in the situation store until CM3; the mind decides it now | The mind decides it now, and the situation store runs the turn | Overlap 4 stays open while a second decider answers the touch |
| D5 | The spoken reaction's memory | Keep saving it in the gate's inner state; stop saving it | Stop saving it | ADR decision 10: fast state resets on launch. Consequence: the first long pet after a launch stays silent, where today only the first pet of a chat session does |
| D6 | The poke's 2 s startle dedupe, the long-pet glance, and the MMD flinch repeat scale | Move them into the mind; keep them in the performers | Keep them | They shape how one performer replays a reaction. Moving them changes Natural's poke contract and every headless runner that pokes, for no change in behavior |
| D7 | The moment's chance and entry rest | The mind rolls; the performer rolls | The performer, unseeded until CM7 | ADR decision 6 lists moments with the performer's assets |
| D8 | The fast mood | Move Natural's mood into the mind now; send the dose as an intent | Send the dose | One mind per character and its state land in CM4 |
| D9 | Emotion stimuli under Universal, MAGIC, and classic | Stop them now; keep them until CM7 | Keep them | The fork's expression slots under those drivers use the decided episode today; the roadmap gives the cut to CM7 |
| D10 | The two Live2D expression systems | Move the fork onto upstream's context; filter the fork's catalog by the card policy now; keep both and record the arrangement | Keep both and record it | The split needs neither change. The policy filter is a behavior change that belongs with capabilities in CM7 |
| D11 | Touch per Live2D driver (ledger "Decisions to revisit") | Run upstream's module under Natural too; keep the split | Keep the split, now recorded in an ADR | ADR decision 7 |
| D12 | How many minds | One per character now; one per `Stage.vue` | One per `Stage.vue` | No build renders two stages, and CM4 owns per-character state |
| D13 | Random draws | Keep the checkpoints inside the rules' memories; draw from the shell's source | The shell's source | The ADR's `step` signature. Draw sequences change, odds do not; a refused line no longer returns its draw; affect traces move to version 2 |
| D14 | The rendered touch check | Rebuild the OS-pointer harness; synthetic pointer events and a `mind` event kind | Synthetic events | The harness is gone, and the check needs the decision record more than real input |

## Blocked: needs the owner

Nothing. No ADR ruling or Target rule is contradicted by the code this slice touches.

## Must not do

- Do not tune a touch threshold, the pet roll, a cue gesture, or a reaction's odds.
- Do not edit `touch.ts` of `stage-ui-live2d`, the avatar touch library and store, `core-character`, or the Live2D context.
- Do not keep the old path behind a setting, and do not add a setting.
- Do not add a transport, a persistence layer, or a capability declaration to the mind.
- Do not edit the body of an existing ADR.
- Do not commit a model path or any other local path; use the `AIRI_QA_*` variables.

## Done when

Overlap 4 is gone from the autonomous-behavior doc because one `step` call answers a touch under Natural; the picker and the planner take decided episodes and no longer call `acceptReaction`; the mind's tests run under Node with a seeded source and no Vue; the ADR records the package decision; and every check in section 8 passes.

## Departures during implementation

- The scene-reported touch type is `TouchReport`, not `TouchGesture`: `stage-shared` already exports `TouchGesture` for `'pet' | 'poke'`.
- The lint rule is two blocks, `airi/character-mind-pure` and `airi/character-mind-pure/core`.
- `touchVoiceView` is a pure builder added in `reaction-policy.ts`; `observeTouch` calls it.
- `enterEpisode` in `selection.ts` draws tickets for an escalation that reaches a decider without them.
- The stage-host seeding moved into `AppSessionCore.start`, and `qa:app run` gained `--stage-host`.
- The `mind` QA event keeps scalar fields, with `intents` as a JSON string.
- Work items 2 and 3 ran one after the other, not in parallel.
- The rendered check used synthetic pointer events, which reached the handlers, so the KWin pointer helper was not needed.
- `stage-shared` has 17 dependents after this slice, not 16: the new package is one of them.

## Checks run

Run on 2026-11-18 at `d8bf4945e`, the last commit that changes code or guides. `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL` named the models.

| Check | Result |
| --- | --- |
| `pnpm verify --gate --base origin/main` | Exit 0: lint of 85 files, typecheck of every package, related tests; 10 env-gated files skipped |
| `pnpm qa:display run -- pnpm qa:smoke` | Exit 0: classic host, 0 renderer errors, 0 main-process errors |
| `pnpm qa:display run -- pnpm qa:smoke --model "$AIRI_QA_MMD_MODEL" --stage-host desktop` | Exit 0: desktop stage host, 0 renderer errors, 0 main-process errors |
| `pnpm qa:live2d-rig` | Exit 0: 301 samples, 26 channels, 18 moving |
| `pnpm qa:test:model` | Exit 0: 4 files, 15 tests; 2 files skipped (`AIRI_QA_MOCAP_DIR` unset) |
| `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario touch --seed 1` at `872b74cb5` and at the tip, then `pnpm qa:motion3d diff` | Exit 0: `IDENTICAL`, 4200 frames each |
| Rendered touch 1: Live2D (`AIRI_QA_RIG_FORBOOTH`) under Natural, classic window | Pass. One poke gave one `mind` event with one `cause`: `posture/touch-reaction`, `posture/mood`, `face/moment`. The third of three pokes inside 10 s spoke, with one `turn` and one `tts`. Three later pokes held, the last with `refractory`. A 3.5 s stroke gave one `pet-start` and one `pet-end`. No errors |
| Rendered touch 2: MMD (`AIRI_QA_MMD_MODEL`) on the desktop stage | Pass. One poke gave one `mind` event with one `cause`, and `touch.events` rose by one. A second poke 525 ms later gave a second event. No errors |
| Rendered touch 3: Universal is untouched | Pass. A tap gave no `mind` event, upstream's reaction moved `ParamAngleY` and closed the eyes, and upstream's touch notify produced an ordinary chat turn |

Not checked: the full 45 s wait before a second spoken line was not run on its own; the `refractory` hold inside the window and a log read 66 s after the spoken line cover it. Whether the reactions look natural is the owner's visual review.

## Commits

`git log --oneline main..HEAD`, oldest first, without the commit that adds this section:

- `8e9db89a4` docs(plan): add the plan for the touch slice of the character mind
- `f31b9fd5a` feat(character-mind): add the package, the shell, and the emotion half of the core
- `f7b153c80` refactor(stage-shared,stage-ui,qa-tools): split the expression decider
- `9eb3772b3` refactor(stage-shared,stage-ui): give the reaction policy a voice view
- `162158f31` feat(character-mind,stage-ui,stage-ui-live2d,stage-ui-mmd): route touch through the mind and delete the old path
- `307a10e1d` refactor(stage-shared,character-mind): take every draw from the mind's random source
- `f70a3762a` feat(stage-shared,stage-ui,qa-tools): show the mind's steps to QA
- `46f481db6` docs(motion-driver-natural): say who receives a touch gesture
- `d8bf4945e` docs(agents): correct the touch rule of the live2d guide
- `d34fb21a0` docs(ai): record the character mind core decisions and close the touch slice rows
