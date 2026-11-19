# character-mind-return - Work Plan

Status: done on the branch `luke/feat/character-mind-return` on 2026-11-19, not yet merged. The commits are listed in [Commits](#commits), and the checks in [Checks run](#checks-run). Roadmap row: slice CM2 in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Rulings: the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md) and the [character mind core ADR](../../docs/ai/adr/2026-11-18-character-mind-core.md). Branch: `luke/feat/character-mind-return`, cut from `luke/feat/character-mind-touch` at `7d0f55812` (CM1, PR #47, not yet merged), which contains upstream `moeru-ai/airi` through `b3a6d6071`. One PR against `lschneiderny/airi` with base `luke/feat/character-mind-touch`. When CM1 merges, rebase the branch onto `main` and retarget the PR.

The owner is away and runs these slices without a plan review. Every design fork below is taken on the recommended option and listed in [Decisions open to the owner's veto](#10-decisions-open-to-the-owners-veto).

## TL;DR (For humans)

**What changes:** The character mind answers the user's [return](#31-what-a-return-is) and the two desktop events that move her body: a desktop wake (unlock or resume) and a sharp screen change. The performance resolver stops deciding reactions. It reports edges as events, and one `step` call answers each event with one response: a gentle wake or a startled desktop reaction for the body, the `welcome-back` moment for the face, and the return and the wake for the voice channel. The gate keeps deciding whether and when she says "welcome back", but it learns of the return only from the mind.

**Why:** Today four deciders answer one return, each with its own detector, state, and clock (autonomous-behavior overlap 6). Two of them detect the return separately: the stage's resolver and the leader's situation sensor.

**What does not change:** Behavior. No threshold, roll, refractory, or ritual rate is tuned. Natural keeps its sleep draw until CM4. The gate keeps the welcome-back ritual, its hazard, its window, and its once-a-day rule until CM3. Universal, MAGIC, and classic perform no posture intent.

**Effort:** M. **Risk:** Medium. The risk is the voice side: the gate's `returned` event and welcome-back window change their source from the situation's presence to the mind.

## 1. Upstream first

Read from the tree at `7d0f55812`. Upstream is `b3a6d6071`.

| Upstream has | Code | Who uses it | Fork difference |
| --- | --- | --- | --- |
| A main-process power monitor service that forwards `suspend`, `resume`, `lock-screen`, and `unlock-screen` to every window over Eventa | `apps/stage-tamagotchi/src/main/services/electron/powerMonitor.ts` (`createPowerMonitorService`), events `electronEvents.powerMonitor.{suspended,resumed,lockScreen,unlockScreen}` | No renderer consumer upstream | The fork routes Linux lock through `LinuxDesktopBridge.onLock` (`session/lock.ts`: logind `LockedHint`, or `org.freedesktop.ScreenSaver` `ActiveChanged`), and the renderer producer consumes the four events |
| The stage host component | `packages/stage-ui/src/components/scenes/Stage.vue` | Every stage page | The fork adds the performance resolver, the conductor, the mind, idle props, and the `performance.value.away` watcher. Upstream has no away, return, or desktop reaction logic |
| The Live2D and MMD scene components | `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`, `live2d/Model.vue`, `packages/stage-ui-mmd/src/components/scenes/MMD.vue` | `Stage.vue` | The fork adds the `performance` prop, which carries `reactSeq` and `reactKind`, and the Natural adapters |
| Nothing for idle time, presence, screen change, sleep, or a welcome back | | | Fork-only: the desktop activity producer and store, the resolver (`packages/stage-shared/src/performance-state`), the situation and its gate, `motion-driver-natural`, `useIdleProps` |

For this slice:

- **Adopts unchanged:** the power monitor service and its four events. The main process and the renderer producer (`apps/stage-tamagotchi/src/renderer/stores/desktop-activity.ts`) are not edited.
- **Builds beside upstream:** the presence rules in `packages/character-mind`, and every other changed path except those below, which are fork-only.
- **Changes these upstream files**, each already edited by the fork:

| Upstream file | Why |
| --- | --- |
| `packages/stage-ui/src/components/scenes/Stage.vue` | It hands the resolver's events to the conductor, loses the away watcher, and records idle reports for QA |
| `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`, `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` | The `performance` prop default loses `reactSeq` and `reactKind`. The scene exposes `wakeFromSleep` and `reactToDesktop` under Natural. The Universal and MAGIC path is not edited |
| `packages/stage-ui-mmd/src/components/scenes/MMD.vue` | The same for the MMD scene |
| `docs/ai/context/ui-components.md` | Its "Live2D scene API" section states the `performance` prop and the exposed methods |

## 2. Today's return paths in the fork

**The signal path.** In the main process, `createPowerMonitorService` emits the four power events to every window, and `createDesktopActivityService` answers `getSystemIdleTime`, which is `null` unless the host capability `systemIdleTime` is live. In the renderer, only the character host page runs `useDesktopActivityProducerStore` (`useStageHostWiring` on the `index` or `stage` page). The producer polls idle time at 1 Hz while the stage is visible and writes `useDesktopActivityStore`. Two readers in that same window turn the store into a return: `Stage.vue` through the resolver, and the leader's situation sensor. The host capabilities involved are `systemIdleTime`, `screenLock` (degraded on Linux when no logind or ScreenSaver answers), and screen change from the ambient-light capture. System audio feeds watching, not a return.

**Deciders for one return, in the order they run.** The example is an unlock after a lock of some minutes.

| # | Decider | Detects | Decides | State | Clock | Random |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Situation desktop sensor, leader (`packages/stage-ui/src/stores/situation/sensors/desktop.ts`, a `flush: 'sync'` watcher, so it runs first) | `reportWakes`: a newer `unlockedAtMs` or `resumedAtMs` than the last seen, after a baseline sample. `reportPresence`: `presenceOf` maps the sample to `here`, `idle` (over 60 s), `away` (over 300 s, locked, or suspended), or `unknown` (no sample, or one older than 5 s) | A `wake` observation, then a `presence` observation | `baselined`, the last unlock and resume times, the last presence | The sample's times; `Date.now` for presence | None |
| 2 | Situation reducer (`packages/stage-shared/src/situation/reducer.ts`) | The `wake` case measures the open away span (`tracking.awaySinceMs`) or the last one (`tracking.lastAwayMs`). `applyPresence` closes the span on `here` or `idle` | A `wake` event ("unlocked the computer" or "woke the computer from sleep") when the span was at least `RETURNED_AFTER_AWAY_MS` (5 min) or unmeasured; a `returned` event when the span was at least 5 min; `tracking.lastAwayMs` | `SituationTracking`, in memory | Observation times | None |
| 3 | Urge gate, leader, every `GATE_INTERVAL_MS` (2 s) | `ritualFacts` (`urge-gate.ts`): the away span ended at `presence.sinceMs` and lasted `tracking.lastAwayMs` | `advanceRituals` opens the welcome-back window after an absence of at least 3 h (`WELCOME_BACK_MIN_AWAY_MS`) that began within the current logical day. The ritual hazard (`RITUAL_TUNING['welcome-back']`: 6 per hour over a 20 min window) joins the one integrated urge, one `Exp(1)` threshold, and one category pick. `returned` is also a gate reason (`SCREEN_SELECTION_WEIGHT.returned` 0.25). Hard holds `presence-away` and `presence-unknown` fail closed | The urge memory and the ritual day, saved in the gate's inner state (tier 2) | `Date.now` | Mulberry32 checkpoint `rngState` in the urge memory |
| 4 | Character-state bridge (`packages/stage-ui/src/stores/character-state/situation-bridge.ts`) | The `returned` event | A slow `return` event with `gapMs` from `tracking.lastAwayMs` | The character state | The event time | None |
| 5 | Performance resolver in `Stage.vue` (`resolvePerformanceState`), on the 250 ms interval and on watches | `away = desktop !== null && (locked \|\| suspended \|\| userIdleSeconds > 300)`; a new unlock or resume time after the baseline sample; an up-crossing of screen change over 0.35 | `reactSeq += 1` with `reactKind: 'wake'`, or `'screen-change'` outside a 10 s refractory (`SCREEN_CHANGE_REFRACTORY_MS`). A wake in the same call wins over a screen change | `ResolverMemory` | `Date.now` passed as `nowMs` | None |
| 6 | The away watcher in `Stage.vue` | `performance.value.away` turns false | `idleProps.onMoment('welcome-back')` | None | | |
| 7 | Moment expression (`useIdleProps`, Live2D, Natural, Idle activities on) | `onMoment` | A 0.6 chance and a pick (`chooseMomentEntry`), one moment at a time, each entry rested 60 s | `momentHistory` | `Date.now` | `Math.random` |
| 8 | Natural desktop reaction (`NaturalMotion.setPerformance`, then `startPending`) | A changed `reactSeq` | `wake`: a nudge (`impulses.nudge([0, 1, 0], 0.4)`), a 1 s camera glance, and `energy.react`. `screen-change`: a 0.4 s glance at the screen and `energy.react`. A pending `wake` also sets the idle input `rouse` | `reactSeq`, the pending list | Natural's active-seconds clock | None |
| 9 | Natural sleep end (`NaturalIdleActivities.step`) | `rouse`, or `!input.away` | Rouse: a startled release (`startledWakeSeconds`, 0.35 s). Away false: the gentle wake (`wake()`): eyes to the camera as the lids open, and after a sleep of at least 90 s a stretch or yawn in 70 % of cases | The running clip, `awaySince` | Natural's clock | Natural's seeded random |
| 10 | Moment expression again | Natural's sleep-end report | The `waking` moment, skipped while another moment is marked | As 7 | As 7 | As 7 |

A return without a desktop wake (idle time drops below 300 s) runs the same rows without the wake parts: rows 1, 2, and 8 produce no wake, and row 9 takes the gentle branch.

**Not return deciders.** The MMD body director (`packages/motion-driver-humanoid/src/director/index.ts`) reads `away` as state: it ends a performance and refuses clips while she is away. The slow `return` of row 4 belongs to CM4. App switches, the foreground category, and system audio feed the situation's topics and the watching attention, not a return.

**Overlap 6 in code terms.** Rows 1 and 5 detect the same return separately, with different rules for stale samples. Rows 3, 7, 8, and 9 each decide a response on their own state, and none sees the others.

**A defect found while reading.** `ritualFacts` takes `presence.sinceMs` as the end of the absence, but a flip between `here` and `idle` also moves `sinceMs`. After an overnight absence of 8 h that ended at 06:00, a pause of 60 s at 12:00 makes the gate see an 8 h absence that ended at 12:00. That passes the logical-day rule (`LOGICAL_DAY_ROLLOVER_HOUR` 4, so 480 minutes since the rollover) and opens the welcome-back window at noon. The design below fixes this as a consequence (D7).

## 3. The design

### 3.1 What a return is

A **return** is the end of an away span: the resolver's `away` turns false after it was true. One detector, the resolver in `Stage.vue`, decides it. A **desktop wake** is a newer unlock or resume time than the last one seen after the baseline sample. A wake and a return in one resolver call are one stimulus and get one response. A wake while the user is still away, for example a resume while the screen stays locked, does not end the span; the later return still gets its response, as today.

**The presence ruling** (autonomous-behavior "Return and presence"): an unknown presence reading counts as idle, and no substitute signal stands in for a missing sensor. In code: a `null` snapshot or a `null` idle time never makes `away` true, so it never opens a span and never yields a return. A user turn counts as input only when the desktop idle time is known (`userIdleSeconds`, unchanged). Nothing else, such as focus, pointer hover, typing, or voice activity, counts. The gate's fail-closed `presence-unknown` hold stays, because it answers a different question: whether she may speak, not whether the user came back.

### 3.2 The resolver reports events

`resolvePerformanceState` stays the one pure detector. It stops deciding reactions and returns the edges it sees:

```ts
export type WakeCause = 'unlock' | 'resume'

export type PerformanceEvent
  /** `away` changed, or a desktop wake appeared. `wake` names the newer of a new unlock and resume time. */
  = | { kind: 'presence', away: boolean, wake: { cause: WakeCause, atMs: number } | null }
  /** Screen change crossed above `REACT_SCREEN_CHANGE` (0.35). No refractory: the mind keeps it. */
    | { kind: 'screen-change' }

export interface PerformanceState {
  mode: PerformanceMode
  attention: PerformanceAttention
  away: boolean
}

export interface PerformanceResolution {
  state: PerformanceState
  memory: ResolverMemory
  /** Edges seen in this call, a presence event first. Empty in most calls. */
  events: PerformanceEvent[]
}
```

`ResolverMemory` gains `away: boolean` (false initially) and loses `reactSeq`, `reactKind`, and `screenReactAtMs`. It keeps the baseline and the known unlock and resume times with today's rules: the first snapshot is only a baseline, and a `null` time keeps the last known one. When both times are new in one call, the newer one names the cause, as the situation reducer keeps only the newest wake today. `WakeCause` moves here from the situation types, which re-export it.

### 3.3 Stimuli, intents, and state

New members of the core's unions in `packages/character-mind/src/types.ts`. The stimuli have the shapes of the resolver's events, so the conductor passes them through; the mind declares its own types and imports nothing from `performance-state`. `Cm1Stimulus`, `Cm1Intent`, and `Cm1MindState` stand for what CM1 defined; they are names for this plan only.

```ts
export type MindStimulus
  = | Cm1Stimulus
    | { kind: 'presence', away: boolean, wake: { cause: WakeCause, atMs: number } | null }
    | { kind: 'screen-change' }

export type MindIntent
  = | Exclude<Cm1Intent, { kind: 'moment' }>
    | (IntentBase & { channel: 'face', kind: 'moment', moment: 'poked' | 'petted' | 'welcome-back' })
  /** End idle sleep gently. The performer does nothing when she is not asleep. */
    | (IntentBase & { channel: 'posture', kind: 'wake' })
  /** A brief reaction to the desktop: a `wake` also rouses her from idle sleep with a startle. */
    | (IntentBase & { channel: 'posture', kind: 'desktop-reaction', reaction: 'wake' | 'screen-change' })
  /** Tell the voice channel of a desktop wake. `awayMs` is the open span at the wake, or null when no span was open. */
    | (IntentBase & { channel: 'voice', kind: 'observe-wake', cause: WakeCause, atMs: number, awayMs: number | null })
  /** Tell the voice channel of a return. The gate decides whether she says anything. */
    | (IntentBase & { channel: 'voice', kind: 'observe-return', atMs: number, awayMs: number })

export interface MindState extends Cm1MindState {
  /** The away span the mind is in, or the last state it saw. Fast state. */
  presence: { away: boolean, awaySinceMs: number | null }
  desktop: { screenReactAtMs: number | null }
}
```

**How a presence stimulus becomes one response** (`src/presence.ts`, `answerPresence`). With `wasAway` and `awaySinceMs` read from the state before the stimulus:

| Condition | Channel | Intent |
| --- | --- | --- |
| `wake` is set | Posture | `desktop-reaction` `wake` |
| `wake` is set | Voice | `observe-wake` with `awayMs = wake.atMs - awaySinceMs` while a span is open, else `null` |
| `wasAway` and not `away` (a return) | Posture | `wake`, unless this response already holds a `desktop-reaction` `wake`, which rouses her anyway |
| A return | Face | `moment` `welcome-back` |
| A return | Voice | `observe-return` with `awayMs = nowMs - awaySinceMs`; the span closes |
| Not `wasAway` and `away` | None | The span opens at `nowMs` |

All intents of one response share one `cause`, in the order posture, face, voice. The `observe-wake` intent comes before `observe-return`, the order in which the sensor ingests them today.

**A screen-change stimulus** yields a `desktop-reaction` `screen-change` and stamps `desktop.screenReactAtMs`, unless a reaction was stamped less than 10 s ago (`SCREEN_CHANGE_REFRACTORY_MS`, moved unchanged), or a presence stimulus with a wake is in the same `step` call. A desktop wake does not stamp the refractory, as today. Screen changes while she is away still react, as today.

**Values that merge.** None conflict. The resolver's 300 s away threshold (`AWAY_INPUT_IDLE_SECONDS`) and the sensor's are the same constant. The 5 min `returned` threshold and the 3 h welcome-back threshold stay in the situation and the gate, which apply them to the mind's `awayMs`.

**Why the mind need not know she is asleep.** The `wake` intent is idempotent in the performer: Natural ends a sleep with it and ignores it otherwise, so the mind can send it on every return. Natural keeps the sleep draw, `awaySince`, and the rule that she falls asleep 12 to 30 s after the user goes away, all on the resolver's `away` input, until CM4 moves the idle draw. The `waking` moment stays a performer report, and "one moment at a time" in `useIdleProps` keeps today's order: the mind's `welcome-back` is marked in the same call stack as the return, and the sleep end is reported on a later frame.

### 3.4 The shell and the conductor

`Stage.vue` hands each resolution's events to `conductor.desktop(events)` in the call that resolved them, including the first call. The 250 ms interval and the watches stay. `updatePerformance` compares only `mode`, `attention`, and `away`.

`StagePerformanceConductor` gains:

```ts
interface StagePerformanceConductorAdditions {
  /** Sends the resolver's events to the mind as one step and dispatches the intents. Under every driver. */
  desktop: (events: readonly PerformanceEvent[]) => void
}
```

`StagePerformanceScene` gains `wakeFromSleep?: () => void` and `reactToDesktop?: (reaction: 'wake' | 'screen-change') => void`. The voice port is renamed `VoicePort`, because it no longer serves only touch, and gains one method.

| Intent | Realiser | Drivers |
| --- | --- | --- |
| `wake` | `scene.wakeFromSleep()`. Live2D `Model.vue` queues it for `Live2DNaturalMotionAdapter`, which calls `NaturalMotion.wake` on its next frame, as it does with pokes. MMD `MMD.vue` calls `MMDNaturalAdapter.wake`, which forwards with its own time | Natural only |
| `desktop-reaction` | `scene.reactToDesktop(reaction)`, the same way, to `NaturalMotion.react` | Natural only |
| `moment` | `markMoment`, which `Stage.vue` binds to `idleProps.onMoment`. `useIdleProps` stays inert outside Live2D under Natural with Idle activities on | Every driver; inert outside Natural |
| `observe-wake`, `observe-return` | `voice().observeReturn(observation)` | Every driver |

`NaturalMotion` gains `wake(nowSeconds)` and `react(reaction, nowSeconds)`. Each pushes a pending action. At the next grid step, `startPending` performs `react` exactly as it performs today's `react` action, and the idle step receives a new input, `wake: boolean`, that ends a sleep through today's `wake()` instead of `!input.away`. `rouse` keeps its two sources: a touch and a pending desktop `wake`.

**What each driver gets.** Presence and screen-change stimuli reach the mind under every renderer and driver, because the gate's `returned` reason and the welcome-back ritual must keep working under Universal, MAGIC, classic, VRM, Spine, and tachie. The conductor performs posture intents only under Natural (direction ADR decision 7); under the other drivers it drops them, as CM7 will make the mind issue none. The `mind` QA event therefore appears under every driver.

**Desktop events that stay out of the mind.** App switches and the foreground category stay situation topics and watching attention, and the voice rulings cover their speech (CM3). System audio and music go to CM5. The cursor goes to CM6. The MMD director's reading of `away` is state, not a stimulus (CM6).

### 3.5 The voice side

The gate keeps deciding whether and when she speaks: the welcome-back hazard, its 20 min window, the once-a-day rule, the 3 h and logical-day rules, the `returned` reason, and the presence holds. What changes is where the gate learns of a return: only from the mind's voice intents.

```ts
/** packages/stage-shared/src/situation/types.ts */
export interface ReturnObservation { kind: 'return', atMs: number, awayMs: number }
export interface WakeObservation { kind: 'wake', cause: WakeCause, atMs: number, awayMs: number | null }

/** packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts */
export interface VoicePort {
  observeTouch: (observation: TouchObservation) => TouchVoiceView | null
  speakReaction: (line: { kind: ReactionKind, eventId: string }) => Promise<GateOutcome | 'refused'>
  /** Records a return or a desktop wake in the situation. Does nothing in a follower window. */
  observeReturn: (observation: ReturnObservation | WakeObservation) => void
}
```

- The reducer's new `return` case sets `tracking.lastAwayMs` and a new `tracking.lastReturnAtMs`, and pushes the `returned` event with today's text when `awayMs` is at least `RETURNED_AFTER_AWAY_MS`. A return older than `lastReturnAtMs` is ignored.
- The `wake` case reads `awayMs` from the observation instead of `tracking`, with today's rule: no event when it is under 5 min; an event when it is longer or `null`.
- `applyPresence` keeps the presence state, `awaySinceMs`, and through `advanceDraft` the `went-away` event. It no longer sets `lastAwayMs` or pushes `returned`.
- `ritualFacts` takes `awayEndedAtMs` from `tracking.lastReturnAtMs` and `awayDurationMs` from `tracking.lastAwayMs`, while the presence is `here` or `idle`. A flip between `here` and `idle` no longer moves the end of the absence (section 2).
- The desktop sensor loses `reportWakes` and reports presence only. The greeting, the sign-off, the presence holds, and `went-away` stay presence-based.
- The character-state bridge is unchanged: it still turns `returned` into a slow `return` with `gapMs` from `tracking.lastAwayMs`, which the return observation sets before it pushes the event.

**Why the gate keeps the ritual (D1).** The welcome-back ritual is not a separate decision. It is one hazard term inside the gate's one integrated urge, compared against one `Exp(1)` threshold, with one category pick among every eligible reason, and its once-a-day state lives in the ritual day that the gate saves (tier 2). Moving only the ritual into the mind now would split the voice channel into two clocks and two draws (overlap 3, which CM3 closes), would need the mind to save state or read a view of the ritual day (CM4 owns persistence), and would change the timing from a hazard window of 20 min to a line at the moment of return. CM3 moves the whole gate into the mind's voice policy; until then the mind coordinates by being the gate's only source of a return.

## 4. Where the code lives

No package is added. The presence rules join the core in `packages/character-mind/src/presence.ts`, under the lint blocks `airi/character-mind-pure` and `airi/character-mind-pure/core`: no `Math.random`, `Date.now`, `performance.now`, or timers. The resolver stays in `packages/stage-shared/src/performance-state` as a pure detector. The situation reducer and the gate stay in `packages/stage-shared/src/situation` until CM3. One mind per `Stage.vue` (CM1 D12), fast state only: the presence span and the screen refractory reset on launch, and nothing new is saved.

## 5. What is deleted

Under the strangler rule, the old paths go in this PR.

| Removed | Proof that nothing else used it |
| --- | --- |
| `reactSeq` and `reactKind` in `PerformanceState`; `PerformanceReactKind`; `reactSeq`, `reactKind`, and `screenReactAtMs` in `ResolverMemory`; `SCREEN_CHANGE_REFRACTORY_MS` in the resolver | `git grep -lE "reactSeq\|reactKind"` lists 26 files: the resolver and its tests, `Stage.vue`, the three scenes' prop defaults, `NaturalMotion`, the headless runners (`packages/qa-tools/src/t2-3d/runner/cues.ts`, `packages/qa-tools/src/t2/scenario-sink.ts`, `packages/stage-ui-live2d/scripts/bench-natural.ts`), test fixtures, and docs |
| `NaturalMotion.reactSeq` and the reaction detection in `setPerformance` | Private to the class |
| The `!input.away` branch of the sleep wake in `NaturalIdleActivities.step` | Private; the `wake` input replaces it |
| The `performance.value.away` watcher in `Stage.vue` | One watcher |
| `reportWakes` in the desktop sensor and its baseline fields | Private to `startDesktopSensor` |
| The `lastAwayMs` assignment and the `returned` push in `applyPresence`; the reducer's reads of `tracking` in the `wake` case | Private to the reducer |
| The `TouchVoicePort` name | `git grep TouchVoicePort` finds the conductor, its test, the glossary, and the CM1 plan |

After the last work item, `git grep -nE "reactSeq|reactKind|PerformanceReactKind|reportWakes|TouchVoicePort"` must print nothing outside `.omo/`, `docs/ai/adr/`, and `docs/ai/audits/`.

## 6. Docs that move with the code

Policy docs change in the commit that makes their statement false. The work item is named in brackets.

- **`docs/ai/context/autonomous-behavior.md`** [3, 4]: rewrite the Desktop reaction row (the resolver's events, decided by `step`, performed by `startPending`) [3]; the Idle activity row (a sleep ends on the mind's `wake` intent or a desktop rouse) [3]; the Moment expression row (the user coming back is the mind's `moment` intent) [3]; the Reach-out row (the welcome-back window opens from the mind's return) [4]. Add Precedence rule 15: one return gets one response from `step`, under every driver, with posture performed only under Natural; move the "Return and presence" bullet of "Rulings the slices keep" into it [3]. Narrow Target rule 2 to a beat, and say that a return already gets one response (rule 15) [3]. Delete overlap 6 and its row in the Target table [4]. Reword overlap 5 (two stages would also send the leader two returns) and overlap 7 (desktop reactions are decided by the mind and still call `glance`) [3]. Keep the numbers of the remaining overlaps as bold-numbered bullets.
- **`docs/ai/context/glossary.md`** [3, 4]: add **Return** (the end of an away span, decided by the resolver's `away` edge, answered by the mind). Update Desktop reaction (no `reactSeq`; decided by the mind), Stimulus (current members gain `presence` and `screen-change`; the target list drops the user's return and desktop events), Intent (the new kinds), Character mind (answers returns and desktop events), Conductor (`desktop`, `VoicePort`, `observeReturn`, `wakeFromSleep`, `reactToDesktop`) [4 for the port], Presence (the resolver's `away` decides a return; the situation's presence decides holds, greetings, and `went-away`), and Moment expression.
- **`docs/ai/context/body-ownership.md`** [3]: `git grep -nE "reactSeq|reactKind|welcome-back|desktop reaction"` finds nothing there today; check again after item 3 and change only what it finds.
- **`docs/ai/context/state-persistence.md`**, **`docs/ai/context/llm-prompt.md`**, and **`docs/ai/context/upstream-policy.md`**: no change. Nothing new is saved, the prompt text of the `wake` and `returned` events is unchanged, and the slice adopts upstream's power monitor unchanged.
- **`docs/ai/context/ui-components.md`** [3]: the Live2D scene API (the `performance` prop shape; `wakeFromSleep` and `reactToDesktop`).
- **`docs/ai/context/character-mind-roadmap.md`** [6]: the CM2 status.
- **READMEs:** `packages/character-mind/README.md` (the presence and screen-change stimuli and their intents) [1]; `packages/stage-shared/README.md` (`PerformanceState`, `PerformanceEvent`, the situation's return observation) [3, 4]; `packages/motion-driver-natural/README.md` (`setPerformance` no longer starts reactions; `wake` and `react`) [2, 3]; `packages/stage-ui/README.md` (rituals and the voice port) [4]; `packages/stage-ui-live2d/README.md` and `packages/stage-ui-mmd/README.md` (the exposed methods) [3]; `packages/qa-tools/README.md` (the `mind` fields, the `idle` event, the fake ScreenSaver) [5].
- **Nested guides:** none. `git grep` over every nested `AGENTS.md` finds no rule about desktop reactions, returns, or the gentle wake. Before editing `packages/motion-driver-natural/src/idle-activities.ts`, read the [idle agency ADR](../../docs/ai/adr/2026-11-12-idle-agency.md), as that package's guide requires.
- **A new ADR** [6]: `docs/ai/adr/<date written>-character-mind-return.md` records what a return is, the resolver as the one detector, the gate's ritual fed by the mind, the presence ruling's consequence (D6), and the drivers. ADR bodies already written are not edited.

## 7. Work items

Each item is one commit that passes `pnpm verify`.

1. **`feat(character-mind)`: answer the user's return and desktop events.** `src/types.ts` (the stimuli, intents, and state of section 3.3), `src/presence.ts`, the dispatch in `src/step.ts`, `initialMindState`, the README. Nothing sends these stimuli yet. Tests in `src/presence.test.ts`, with a seeded source and no Vue: a span opens without intents; a return yields one `wake`, one `welcome-back` moment, and one `observe-return` whose `awayMs` is the span, all with one `cause`; a return with a wake yields a `desktop-reaction` `wake` and no `wake`, and `observe-wake` comes before `observe-return`; a wake while away reacts, reports the open span, and keeps the span open; a wake with no span reports `awayMs: null`; a screen change reacts once, not again within 10 s, and again after it; a screen change in the same call as a wake is dropped; the state survives a JSON round trip.
2. **`feat(motion-driver-natural,stage-ui-live2d,stage-ui-mmd)`: let the performer wake and react on request.** `NaturalMotion.wake` and `react`, the idle input `wake`, the Live2D adapter's queue, `MMDNaturalAdapter.wake` and `react`, and the scenes' `wakeFromSleep` and `reactToDesktop`, exposed but not yet called. The `reactSeq` path and the `!input.away` wake still run. Tests in `intent.test.ts`, which drives `NaturalMotion`, and `idle-activities.test.ts`: `react('wake')` on a sleeping controller gives the startled release; `wake` on a sleeping controller gives the gentle wake with the eyes on the camera; `wake` on an awake controller leaves every frame equal to a controller with the same seed and no call; `react('screen-change')` glances at the screen.
3. **`refactor(stage-shared,stage-ui,stage-ui-live2d,stage-ui-mmd,motion-driver-natural,qa-tools)`: route the return's body and face response through the mind.** The resolver as in section 3.2; `conductor.desktop`; `Stage.vue` hands events over and loses the away watcher; Natural loses the `reactSeq` detection and the `!input.away` wake; the prop defaults, the headless runners, and the fixtures drop the two fields. The conductor drops the two voice intents until item 4, and the situation sensor still reports the return. Docs as marked `[3]`. Tests: the resolver's reaction cases become event cases (baseline only, a newer time, a `null` time keeps the last, both times in one call name the newer cause, a wake and an up-crossing in one call give both events, up-crossing only) and gain presence cases (lock opens away, unlock closes it, an unknown idle time never makes away, away at the first call); its refractory cases move to item 1's tests. `use-stage-performance-conductor.test.ts`: under Natural the posture intents reach the scene; under Universal only the moment does. `intent.test.ts` and `review.test.ts`: `setPerformance` starts no reaction, and away turning false alone no longer wakes her.
4. **`refactor(stage-shared,stage-ui)`: let the gate learn a return from the mind.** Section 3.5: `ReturnObservation`, `awayMs` on `WakeObservation`, `tracking.lastReturnAtMs`, `applyPresence`, `ritualFacts`, the sensor without `reportWakes`, `VoicePort` with `observeReturn`, and the conductor's voice dispatch. Docs as marked `[4]`. Tests: the reducer's `returned` and `wake` cases move to the observations with the same thresholds; a welcome-back window opens from `lastReturnAtMs` after 3 h within the logical day; a `here` to `idle` flip hours after an overnight return opens no window (the defect of section 2); the sensor test loses its wake cases; `observeReturn` in a follower changes nothing; `situation-bridge.test.ts` passes unchanged.
5. **`feat(stage-shared,stage-ui,qa-tools)`: show returns and sleep to QA.** The `mind` QA event gains `away` and `wake` for a presence step. A new `idle` kind in `MotionQaEventSchema` records each idle report (`phase`, `behaviour`) through one `onIdle` handler in `Stage.vue` that both scenes use. Add `packages/qa-tools/scripts/linux/fake-screensaver.py`: it owns `org.freedesktop.ScreenSaver` on the session bus of a QA display, answers `GetActive`, and emits `ActiveChanged` on a timed script (`--lock-after`, `--unlock-after`). It refuses to run outside a QA display, as `kwin-pointer.py` does. Tests: `use-motion-qa-bridge.test.ts` reads a presence `mind` event and an `idle` event. The helper has no unit test; the rendered check in section 8 is its test.
6. **`docs(ai)`: record the decisions and close the row.** The new ADR and the roadmap. This is the last commit, after the checks in section 8 pass.

**Order and parallel work.** Items 1 and 2 touch different packages and can run in parallel. Item 3 needs both. Items 4 and 5 touch different files after item 3 and can run in parallel. Item 6 is last.

## 8. Checks

- **Each commit:** `pnpm verify`. Inner loop: `pnpm -F @proj-airi/character-mind exec vitest run src/presence.test.ts`, `pnpm -F @proj-airi/motion-driver-natural exec vitest run src/intent.test.ts src/idle-activities.test.ts`, and for the other packages the narrowest project the root guide names.
- **Policy docs:** `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after items 3 and 4.
- **The branch:** `pnpm verify --gate --base luke/feat/character-mind-touch` while CM1 is unmerged, and `pnpm verify --gate` after the rebase onto `main`.
- **Smoke on both hosts.** `.env.qa` holds `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`; create it in the worktree or export the two variables.
  - `pnpm qa:display run -- pnpm qa:smoke`
  - `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"`
- **Headless motion is unchanged.** `pnpm qa:live2d-rig` and `pnpm qa:test:model` pass. `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario <name> --seed 1 --out <dir>` at `7d0f55812` and at the tip, then `pnpm qa:motion3d diff`, prints `IDENTICAL` for `touch` and `sleepy-no-clip`. In `sleepy-no-clip` the user returns as `listening`, so the `claimed` release ends the sleep, not the deleted gentle-wake branch.
- **Rendered return.** The `airi-qa` MCP server with the `mind` and `idle` events of item 5. On Linux its session runs on the `qa:display` session `mcp`, whose private session bus has no ScreenSaver, so the fake helper drives the app's real lock path: main's `LockSource` sees the name appear, emits `lockScreen` and `unlockScreen`, and the renderer producer writes `locked`. Call `airi_stop` at the end of each session.
  1. **Live2D under Natural, classic window.** `airi_start` with `model` set to the directory in `AIRI_QA_RIG_FORBOOTH`. `airi_state` must report `driver: 'natural'` and `performance.away: false`; Idle activities must be on. Run `pnpm qa:display run --name mcp -- python3 packages/qa-tools/scripts/linux/fake-screensaver.py --lock-after 5 --unlock-after 50`. Pass: `airi_events` shows one `mind` event with `stimulus: 'presence'`, `away: true`, and no intents; an `idle` event with `phase: 'start'` and `behaviour: 'sleep'` within 30 s of it; after the unlock, one `mind` event with `away: false` and `wake: 'unlock'` whose intents share one `cause` and are, in order, `posture/desktop-reaction`, `face/moment`, `voice/observe-wake`, `voice/observe-return`, with no `posture/wake`; an `idle` event with `phase: 'end'` and `behaviour: 'sleep'` within 2 s of it. `airi_state` shows `performance.away` true during the lock and false after. `airi_errors` is empty.
  2. **The gentle wake.** In session 1, only when `airi_state` reports `systemIdleTime` live: leave the display without input for 320 s, so idle time crosses 300 s, then move the pointer with `packages/qa-tools/scripts/linux/kwin-pointer.py play`. Pass: one `mind` event with `away: false`, `wake` null, and intents `posture/wake`, `face/moment`, `voice/observe-return`; the sleep `idle` end within 2 s. Otherwise record it as not run, with the capability's reason.
  3. **MMD on the desktop stage.** `airi_start` with `model` set to `AIRI_QA_MMD_MODEL`, `kind: 'mmd'`, and `stageHost: 'desktop'`. Wait until `airi_state` reports the model loaded, because `Stage.vue` mounts only after the stage world calibrates. Repeat the lock script. Pass: the same two `mind` events and the sleep `idle` start and end. `airi_errors` is empty.
  4. **Universal.** In session 1, switch the Live2D driver to Universal and repeat the lock script. Pass: the same two `mind` events, because the mind steps under every driver, and no `idle` event, because Natural does not run. `airi_errors` is empty.
- The voice side (the `returned` event after 5 min, the welcome-back window after 3 h) and screen change are covered by unit tests only. A rendered check would need an absence of hours or a screen that changes on cue.
- Record the event excerpts in the PR description.

## 9. Risks and what later slices get

| Risk | Mitigation |
| --- | --- |
| The gate's return now depends on a mounted `Stage.vue`. On the desktop stage `Stage.vue` mounts only after the stage world calibrates, and a remount during an absence starts a new mind whose span begins at the remount | Calibration takes seconds at launch. A remount shortens `awayMs`, which can miss the 3 h welcome-back rule; the plan accepts this until CM4 moves the mind to the leader per character, and records it in the ADR |
| The resolver and the sensor disagree on stale samples: the sensor reads a sample older than 5 s as `unknown`, the resolver keeps using it | The resolver's frozen sample keeps an open span open, which matches today's sensor (an `unknown` reading leaves the span open). The one difference is D6 |
| An idle-time capability that drops out during an absence ends the span (D6) | Rare: it needs `systemIdleTime` to go from live to unknown mid-span. The ADR states it as the ruling's consequence |
| 26 files carry `reactSeq` and `reactKind` | Mechanical; typecheck in `pnpm verify` finds each one |
| The fake ScreenSaver may not reach the app if the private bus's ScreenSaver path differs from what `LockSource` expects | Not verified. Fallback: write a locked snapshot into the desktop activity store with `airi_eval`, and record that the main-process path was not exercised |
| A headless runner that returns from away without a mode change would no longer wake her | Only `sleepy-no-clip` sets away, and it returns as `listening`. The `qa:motion3d` diff proves it |

**Left for later slices, without a rewrite of the core's types:**

- **CM3, the voice decision.** The gate's urge memory and the ritual day join `MindState.voice`. The `observe-return` and `observe-wake` intents become inputs of the mind's own voice policy, and the welcome-back ritual becomes a `speak` decision on the mind's clock. The situation keeps the topics.
- **CM4:** the idle draw and sleep move into the mind, which then knows she is asleep and can choose between waking and staying asleep; the slow `return` of the character-state bridge joins the mind's state; one mind per character in the leader removes the remount risk.
- **CM6:** the glances of desktop reactions become gaze intents; the MMD director acts on intents instead of reading `away`.
- **CM7:** no posture intents for Universal, MAGIC, and classic, through capabilities.

## 10. Decisions open to the owner's veto

| # | Fork | Options | Taken | Why |
| --- | --- | --- | --- | --- |
| D1 | The welcome-back ritual | The mind decides a welcome-back line now, as it does for touch; the gate keeps deciding and learns of the return only from the mind | The gate keeps deciding | Section 3.5: the ritual is one term of the gate's one hazard, draw, and pick, and its day is saved state. Moving it alone splits the voice channel's clock (overlap 3, CM3) and needs persistence (CM4) |
| D2 | The one return detector | The resolver's `away` edge in `Stage.vue`; the situation sensor's presence in the leader | The resolver | The body and face responses must start on the stage's own frame clock, and the stage already owns the edge. The sensor stays for holds and greetings |
| D3 | The screen-change refractory and the rule that a wake wins | Keep them in the resolver; move them into the mind | Move them, values unchanged | Whether to react is a decision; the resolver keeps only detection |
| D4 | How the mind knows she sleeps | Feed Natural's sleep reports to the mind as stimuli; send an idempotent `wake` | Idempotent `wake` | Sleep stays in the performer until CM4; a report stimulus would be deleted then |
| D5 | Return stimuli under Universal, MAGIC, and classic | Send them and drop posture in the conductor; do not send them | Send them | The gate's `returned` reason and welcome-back ritual must keep working under every driver, and they now come from the mind |
| D6 | An idle time that turns unknown during an away span | End the span, because unknown counts as idle; keep the span open with a third presence value | End the span | The ruling says unknown counts as idle. Today the situation keeps the span open across `unknown`, so the gate may now see a return on a capability dropout |
| D7 | The end of an absence for the ritual | `presence.sinceMs`; the return time | `tracking.lastReturnAtMs` | It has one source, and it fixes the noon welcome-back after an overnight absence (section 2) |
| D8 | A desktop wake with no away span seen | Report it to the gate with `awayMs: null`; drop it | Report it | Today's reducer keeps a wake whose span it cannot measure |
| D9 | Port name | Keep `TouchVoicePort` and add a method; rename it `VoicePort` | Rename | It no longer serves only touch |
| D10 | Lock in rendered QA | A fake ScreenSaver on the QA display's private bus; a snapshot written with `airi_eval` | The fake ScreenSaver | It exercises the main-process path, and the `qa:display` README names it as the way lock QA works |
| D11 | Record the decisions | A new ADR; only the policy docs | A new ADR | The body-ownership doc says a new decision gets an ADR, as CM1 did |

## Blocked: needs the owner

Nothing. No ADR ruling or Target rule is contradicted by the code this slice touches. D1, D6, and D7 change behavior in edge cases and are open to veto.

## Must not do

- Do not tune the 300 s away threshold, the 0.35 screen-change crossing, the 10 s refractory, the 5 min `returned` threshold, the 3 h welcome-back rule, the ritual's rate or window, the 12 to 30 s sleep delay, the startled or gentle wake, or the moment's chance and rest.
- Do not edit `powerMonitor.ts`, the desktop activity service, or the renderer producer.
- Do not move the gate, the ritual tuning, or the saved ritual day (CM3), or Natural's sleep draw (CM4).
- Do not keep the old paths behind a setting, and do not add a setting.
- Do not save the mind's state or add a transport.
- Do not edit the body of an existing ADR.
- Do not commit a model path or any other local path; use the `AIRI_QA_*` variables.

## Done when

Overlap 6 is gone from the autonomous-behavior doc, because one `step` call answers a return and a desktop wake, the resolver is the only return detector, and the gate learns of a return only from the mind; `reactSeq` and `reactKind` no longer exist; the presence rules have Node tests with a seeded source and no Vue; the new ADR records the decisions; and every check in section 8 passes.

## Departures during implementation

- The `observe-wake` intent carries `wakeCause`, not `cause`, because every intent's `cause` is already the sequence number of its stimulus.
- A requested wake also resets Natural's `awaySince`, so she does not fall straight back asleep when the wake reaches Natural before the performance update that clears `away`.
- Both new Natural tests of item 3 are in `intent.test.ts`, because they drive `NaturalMotion` directly. `review.test.ts` only lost the two fields.
- `WakeCause` stays in `situation/types`, and `performance-state` imports it from there. The plan's move would have made a type-only import cycle.
- `situation-bridge.test.ts` changed its input from two presence observations to one `return` observation, because presence no longer pushes `returned`. The bridge code and the test's assertions are unchanged.
- The situation store test of a 1 s lock lost its wake assertions, which could no longer fail because the sensor reports no wakes.
- The fake ScreenSaver uses Gio, is run through `python3 -I` like `kwin-pointer.py` instead of being executable, and checks the QA display itself. The rendered check found that it dropped the unlock in 2 of 3 runs: the app looks up the owner of the sender's name when a signal arrives, and the helper released the name right after the unlock. It now keeps the name 5 s after the unlock.
- The MMD scene's idle reports now also pass through `useIdleProps`, which is inert for a non-Live2D model, because one `onIdle` handler in `Stage.vue` serves both scenes.

## Checks run

Run on 2026-11-19 at `b31b54681`, the last commit that changes code; the gate ran again on the finished branch. `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL` named the models.

| Check | Result |
| --- | --- |
| `pnpm verify --gate --base luke/feat/character-mind-touch` | Exit 0 on the finished branch: lint of 64 files, typecheck, related tests; 10 env-gated files skipped |
| `pnpm qa:display run -- pnpm qa:smoke` | Exit 0: classic window host, 0 renderer errors, 0 main-process errors |
| `pnpm qa:display run -- pnpm qa:smoke --model "$AIRI_QA_MMD_MODEL" --stage-host desktop` | Exit 0: desktop stage host, 0 renderer errors, 0 main-process errors |
| `pnpm qa:live2d-rig` | Exit 0 |
| `pnpm qa:test:model` | Exit 0: 4 files, 15 tests |
| `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario <touch\|sleepy-no-clip> --seed 1` at `7d0f55812` (a temporary worktree) and at the tip, then `pnpm qa:motion3d diff` | `IDENTICAL` for both scenarios (rot, root, channels, events) |
| Rendered return 1: Live2D (`AIRI_QA_RIG_FORBOOTH`) under Natural, classic window | Pass. The lock gave a `mind` presence event with `away: true` and no intents; sleep started 29.9 s later. The unlock 45 s after the lock gave one `mind` event with `away: false`, `wake: 'unlock'`, and intents of one cause in order `posture/desktop-reaction`, `face/moment`, `voice/observe-wake`, `voice/observe-return`, with no `posture/wake`; sleep ended 46 ms later. No errors |
| Rendered return 2: the gentle wake | Pass. `systemIdleTime` became live about 4 minutes into the session. Idle time crossing 300 s gave the away step, and sleep started 22.9 s later. A pointer move 390 s after it gave `posture/wake`, `face/moment`, `voice/observe-return`, and the sleep end 28 ms later, then a stretch. An unprompted greeting 24 s later carried "came back after 6 min away" in its prompt and failed with the replay server's `replay_exhausted` (409), which logged 6 renderer errors; the session had no spare scripted replies |
| Rendered return 3: MMD (`AIRI_QA_MMD_MODEL`) on the desktop stage | Pass. The same two `mind` events and four intents; sleep started 19.7 s after the lock and ended 2 ms after the return. No errors |
| Rendered return 4: Universal | Pass. The same two `mind` events and four intents, and no `idle` events. No new errors |

Rendered checks 1, 3, and 4 used the helper with the 5 s linger, which the tracked helper now has.

Not checked: screen change and the voice side's welcome-back window (3 h) have unit tests only.

## Commits

`git log --oneline luke/feat/character-mind-touch..HEAD`, oldest first, without the commit that adds this section:

- `e0093f257` docs(plan): add the plan for the return slice of the character mind
- `107f9795b` feat(character-mind): answer the user's return and desktop events
- `6622bf634` feat(motion-driver-natural,stage-ui-live2d,stage-ui-mmd): let the performer wake and react on request
- `d31eb4d0e` refactor(stage-shared,stage-ui,stage-ui-live2d,stage-ui-mmd,motion-driver-natural,qa-tools): route the return's body and face response through the mind
- `b06c55318` refactor(stage-shared,stage-ui): let the gate learn a return from the mind
- `b31b54681` feat(stage-shared,stage-ui,qa-tools): show returns and sleep to QA
- `bb274e94e` docs(ai): record the character mind return decisions and close the return slice row

This commit marks the plan done.
