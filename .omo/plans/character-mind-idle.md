# character-mind-idle - Work Plan

Status: planned on 2026-11-19; not started. Roadmap row: step CM4b in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Rulings: the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md), the [core ADR](../../docs/ai/adr/2026-11-18-character-mind-core.md), the [return ADR](../../docs/ai/adr/2026-11-19-character-mind-return.md), the [voice ADR](../../docs/ai/adr/2026-11-19-character-mind-voice.md), the [widget turns ADR](../../docs/ai/adr/2026-11-19-character-mind-widget-turns.md), the [slow state ADR](../../docs/ai/adr/2026-11-19-character-mind-slow-state.md), and the [idle agency ADR](../../docs/ai/adr/2026-11-12-idle-agency.md) with its amendments. Branch: `luke/feat/character-mind-idle`, cut from CM4a's tip `755ef0a86` on `luke/feat/character-mind-slow-state` (PR #57). CM4a stacks on CM3b (#53), CM3a (#52), CM2 (#51), and CM1 (#47), none merged, and carries the ten commits of step S (#56), cherry-picked. The PR's base is `luke/feat/character-mind-slow-state`. When a PR below merges, rebase this branch onto the new base and retarget the PR.

The owner is away and runs these slices without a plan review. Every design fork below is taken on the recommended option and listed in [Decisions open to the owner's veto](#11-decisions-open-to-the-owners-veto).

**Split (D1).** CM4b is planned as one PR with no further split. The scheduler and its realiser share one hazard, one rest, and one record, so any cut between them leaves a stretch in which two deciders run side by side, which the root rules forbid as a compatibility path. The PR's first commit is a behavior-neutral extraction that proves itself with `IDENTICAL` diffs, so the reviewable risk sits in one commit (item 3).

## TL;DR (For humans)

**What changes:** The character mind decides when she starts an idle act, which act, when an idle errand starts, when she falls asleep while the user is away, and the stretch or yawn after a long sleep. It decides on its own clock and its seeded random source, which the voice channel already uses. Natural keeps everything a frame needs: the shape of each act, its interruption, settling, and the idle cues around a line. Natural tells the mind what it can see (free, blocked, away, settled, an act started or ended), and the mind answers with posture intents that only Natural receives. Both stages of a window would show the same act from the same seed. `allowSleep` leaves the idle drive, because nothing narrows it.

**Why:** Autonomous behavior Target rules 1 and 3 and body ownership Target rule 1. Today each stage's `NaturalIdleActivities` draws its own hazard on Natural's clock from its own stream (overlaps 3 and 5), and sleep is decided inside Natural while `useIdleProps` shows it (overlap 9).

**What does not change:** No rate, weight, cooldown, rest, sleep delay, follow-up chance, errand pacing, or hazard constant. Idle time still counts only while she is on screen. Universal, MAGIC, and classic receive no posture intents. Natural's fast mood stays in Natural, and the bridge's slow touch dose stays in the bridge (D9, D10). No storage key changes.

**Effort:** L. **Risk:** High. The risk is the realiser switch (item 3): it touches Natural, both scene adapters, the conductor, the mind store, and the headless MMD runner in one commit, and it changes every headless idle trace on purpose.

## 1. Upstream first

Read from the tree at `755ef0a86`. `upstream/main` is `b3a6d6071`, the commit the stack already contains, so no upstream commit touches these paths.

| Upstream has | Code | Fork difference |
| --- | --- | --- |
| Idle motion groups under every Live2D driver, played by the Cubism SDK | `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` | The fork adds Natural, which disables them under Natural only. CM4b leaves Universal and MAGIC as upstream ships them |
| The stage scene, the Live2D scene and model, and the MMD scene | `packages/stage-ui/src/components/scenes/Stage.vue`, `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`, `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`, `packages/stage-ui-mmd/src/components/scenes/MMD.vue` | Fork-edited already: the idle reports, the errand events, and the idle drive. CM4b adds one event and one method on the same seams |
| No idle draw, no character mind, no Natural, no idle errand | None | `motion-driver-natural`, `character-mind`, `qa-tools`, the conductor, `use-idle-props.ts`, both Natural adapters, and the mind store are fork-only |

Nothing upstream decides idle acts or sleep, so the ledger in `docs/ai/context/upstream-policy.md` gains no row.

## 2. Today's code

**The scheduler and the realiser are one class.** `NaturalIdleActivities` (`packages/motion-driver-natural/src/idle-activities.ts`) runs inside `NaturalMotion`'s 120 Hz grid on active seconds, which freeze while the adapter suspends Natural (paused, hidden, or another driver; `setSuspended`). It draws from `stream('idle')` (stream index 17). One `step(at, dt, input, gaze)` does, in order: release, wake, or finish the running behavior; update the errand from the realisers' answers; reset on a null drive; settle after 120 s idle with `body`; accept a cue (`about-to-speak` only when performing, not blocked, and not asleep; `let-go` inside the 30 s window); a requested play; the sleep rule (12 to 30 s of quiet away time, drawn at the start of the away run); the follow-up stretch or yawn after a sleep of at least 90 s (70 %); otherwise one hazard over the acts and the eligible errands, with a share by rate, the weighted pick with cooldowns, recency, and no-repeat, and the errand start (pick and pastime hold). The shape draws (side, durations, keys, glances, count, variant) follow in `start`. All of these draws come from the one stream, in that order.

**Its inputs.** `NaturalMotion` builds `IdleStepInput` each grid step: `mode` and `away` from the performance state it was handed, `blocked` (a pet, a glance hold, the chat, the cursor, a cue gesture, and with held emotions on, an emotion gesture or a hold level above 0.3), `interrupt`, `rouse`, `wake`, `placement`, and `screenPoint`. The `blocked` term for held emotions is why an `about-to-speak` cue right after a happy ACT is skipped (the CM4a lesson, [Checks run](#checks-run) of the CM4a plan).

**The drive.** `useStagePerformanceConductor` sends `idleDriveOf(reading, nowMs, localHour)` once a second (`FACE_BASELINE_SAMPLE_MS`) with `allowSleep: true` and `rate: 1`; `StagePerformanceConductor.idleDrive` sends null to any driver other than Natural. The MMD scene narrows it (`resolveIdleDrive`: rate 0 while a clip action plays, `body`, `unreachable`, `errands`).

**The reports.** Natural reports each behavior and errand edge (`IdleBehaviourReports`, `IdleErrandReports`). The Live2D adapter and the MMD scene emit them as `idle` and `errand` events; `Stage.vue` feeds `useIdleProps` (pastimes, sleep entries 5 s after a sleep start, moments), `stageSelf.idle`, and the QA events. The MMD director reads `bodyIntent().idle` for the sleep stance and settling.

**The mind.** `useCharacterMindStore` holds the window's one mind, sends voice cues to the newest attached stage (`attachStage(MindStage { idleCue })`), and the situation store arms one voice wake timer from `nextVoiceWakeAt` (widget turns ADR D12). The mind already answers a return with a posture `wake`, which Natural performs only while asleep.

**The headless runners.** `packages/qa-tools/src/t2-3d/runner/run.ts` builds an `MMDNaturalAdapter`, calls `setIdleDrive` only when the scenario names a drive, records `idle:<kind>:<phase>` markers, and constructs no mind. The Live2D rig (`packages/qa-tools/src/t2/scenario-sink.ts`) constructs a mind for its conductor and sets no idle drive, so idle is inert there.

## 3. The design

### 3.1 The split: the mind decides episodes, Natural plays frames

The render loops skill asks what the mind decides on its clock and what the frame loop samples. The table is the contract.

| Decided by the mind, on its clock and source | Realised and sampled by Natural, on its grid |
| --- | --- |
| The hazard over acts and errands, its threshold, and the share by rate | The shape of an act from the intent's `seed`: side, durations, keys, glances, count, variant |
| The pick: weights, cooldowns, recency, no-repeat (`idleActivityWeights`, `idleActivityRate` unchanged) | Interruption, rouse, wake, and claim by a mode, each at the grid step it happens |
| The rest after an act (6 s after a release or a wake; 6 to 14 s after a finish) | Settling (`settled`), because an interrupt must stand her up within one step |
| The sleep rule: the 12 to 30 s delay over the quiet away run | Cue acceptance (`about-to-speak`, `let-go`), the 10 s cap, and the 30 s let-go window |
| The follow-up stretch or yawn after a long sleep | The played-sleep end (24 s), and the end of a pastime she is no longer free for |
| Errand starts: kind, `pick`, the pastime hold; the errand refractories | The errand record the realisers read, its hold end, and the realisers' answers |
| A `seed` for every act it starts | The `idle` and `errand` reports that `useIdleProps`, the director, and QA read |

Natural keeps `stream('idle')` for the cue shapes only. Each decided act carries a 32-bit seed drawn from the mind's source, and Natural draws that act's shape from `createRandomStream(seed)`, so every stage that receives the intent draws the same shape (body ownership Target rule 5's "seeded by the intent").

### 3.2 The pure schedule

The rules move out of the class into `packages/motion-driver-natural/src/idle-schedule.ts`, pure and in active seconds, the idle agency ADR's unit. Item 1 extracts them with the class still calling them on its own grid and stream; item 3 hands them to the mind. Shapes, not final names:

```ts
/** What the performer can see of her, as of its latest grid step. Plain JSON. */
export interface IdleView {
  /** The drive as the scene narrowed it, or null while Natural runs no idle layer. */
  drive: NaturalIdleDrive | null
  /** False while the adapter suspends Natural (paused, hidden, another driver): idle time stops. */
  active: boolean
  mode: PerformanceMode
  away: boolean
  blocked: boolean
  settled: boolean
  /** The behavior that has not been released, or null. */
  current: { seq: number, kind: IdleBehaviourKind } | null
  /** The errand that has not ended, or null. */
  errand: { seq: number, kind: IdleErrandKind } | null
}

/** The memory of the schedule. Plain JSON; every time is in active seconds. */
export interface IdleScheduleState {
  threshold: number | null
  urge: number
  restUntil: number
  awaySince: number | null
  sleepAfter: number
  followUp: { kind: 'stretch' | 'yawn', at: number } | null
  lastStart: Partial<Record<IdleBehaviourKind, number>>
  lastDrawn: DrawnIdleActivityKind | null
  errandStarts: Partial<Record<IdleErrandKind, number>>
  errandEnds: Partial<Record<IdleErrandKind, number>>
  errandListedSince: Partial<Record<IdleErrandKind, number>>
}

/** What the schedule starts. `seed` is drawn only once the mind owns the schedule (item 3). */
export type IdleDecision
  = | { kind: 'act', act: IdleActivityKind, seed: number }
    | { kind: 'errand', errand: IdleErrandKind, pick: number, holdSeconds: number | null }

/** An edge the performer saw, in the order it happened. */
export type IdleEdge
  = | { kind: 'started', act: IdleBehaviourKind }
    | { kind: 'ended', act: IdleBehaviourKind, how: 'finished' | 'released' | 'woken' | 'woken-on-request', sleptSeconds: number | null }
    | { kind: 'errand-started', errand: IdleErrandKind }
    | { kind: 'errand-ended', errand: IdleErrandKind }

export function initialIdleSchedule(): IdleScheduleState
/** Applies one edge at `at` (rest, follow-up, away reset, cooldown stamps), drawing what the rule draws. */
export function applyIdleEdge(state: IdleScheduleState, edge: IdleEdge, at: number, random: () => number): IdleScheduleState
/** Advances from `from` to `to` under `view`, which held over the whole span, and returns at most one decision at `to`. */
export function advanceIdleSchedule(state: IdleScheduleState, view: IdleView, from: number, to: number, random: () => number): { state: IdleScheduleState, decision: IdleDecision | null }
/** The earliest time after `at` at which the schedule could decide under `view`: a rest end, a refractory end, the sleep due time, the follow-up, or the hazard's crossing at today's rate. Null when nothing is due. */
export function nextIdleDeadline(state: IdleScheduleState, view: IdleView, at: number): number | null
```

`advanceIdleSchedule` integrates the urge as `(actRate + Σ errandRate) × (to − from)` over a span in which the view and the rest and refractory edges did not change, which `nextIdleDeadline` guarantees, so the crossing is exact rather than sampled. The class in item 1 calls it once per grid step with `to − from = 1/120`, which reproduces today's draws in today's order.

**Home (D2).** The rules stay in `motion-driver-natural`, as the core ADR's decision 3 has it ("pure rules stay where they are and the mind composes them"), the way `voice.ts` composes the urge gate from `stage-shared/situation`. `character-mind` adds `@proj-airi/motion-driver-natural` as a dependency and imports only the subpaths `/idle-schedule` and `/idle-errands`, and types from `/idle-activities`. This creates no cycle: `motion-driver-natural` depends on `@moeru/std` and `stage-shared`, `stage-shared` on neither of the two, and nothing in `motion-driver-natural` or `stage-shared` imports `character-mind`. The purity lint does not cover `motion-driver-natural` today, so item 1 adds a block `airi/idle-schedule-pure` for `packages/motion-driver-natural/src/idle-schedule.ts` and `idle-errands.ts` with the core rules of `airi/character-mind-pure/core` (no `Math.random`, `Date.now`, `performance.now`, or timer globals), and item 2 extends `airi/character-mind-pure` to forbid the `@proj-airi/motion-driver-natural` root and every other subpath, allowing type imports from `/idle-activities`. If `ts/no-restricted-imports` cannot allow type-only imports per path in the installed version, `IdleBehaviourKind` and its siblings move into `idle-schedule.ts` instead and `idle-activities.ts` re-exports them.

### 3.3 The mind's idle policy

`packages/character-mind/src/idle.ts` composes the schedule as `voice.ts` composes the gate.

```ts
/** MindState.idle. Plain JSON. */
export interface MindIdleState {
  /** The reporting stage's latest view, or null while no Natural performer reports. */
  view: IdleView | null
  /** The mind's clock counted only while `view.active`: the idle schedule's time base, in seconds. */
  activeSeconds: number
  /** When `activeSeconds` was last advanced, in epoch milliseconds of the mind's clock. */
  atMs: number | null
  schedule: IdleScheduleState
  /** The intent decided and not yet reported started or refused; no new decision while one waits. */
  pending: string | null
  /** The seq, intent id, and active-seconds start of the behavior the performer last reported started. */
  started: { seq: number, intentId: string | null, at: number } | null
}

/** The new members of `MindStimulus`. */
type IdleStimulus
  /** One batch per Natural frame that had an edge. */
  = | { kind: 'idle', reports: readonly IdleReport[] }
  /** The host's idle wake timer. */
    | { kind: 'idle-wake' }
  /** The devtools lab, through the conductor under Natural. */
    | { kind: 'idle-play', act: IdleBehaviourKind }

// IdleReport and IdleOrder live in motion-driver-natural's idle-schedule.ts, because Natural produces the one and
// consumes the other and must not import character-mind (that import would be the cycle).
export type IdleReport
  = | { kind: 'view', view: IdleView }
    | { kind: 'started', intentId: string | null, seq: number, act: IdleBehaviourKind }
    | { kind: 'ended', seq: number, act: IdleBehaviourKind, how: 'finished' | 'released' | 'woken' | 'woken-on-request' }
    | { kind: 'refused', intentId: string }
    | { kind: 'errand-started', intentId: string, seq: number, errand: IdleErrandKind }
    | { kind: 'errand-ended', seq: number, errand: IdleErrandKind, outcome: IdleErrandOutcome }

/** What Natural's `idle(order)` takes; the conductor maps an intent onto it, keeping the intent's id. */
export type IdleOrder
  = | { id: string, kind: 'act', act: IdleBehaviourKind, seed: number, requested: boolean }
    | { id: string, kind: 'errand', errand: IdleErrandKind, pick: number, holdSeconds: number | null }

/** The new members of `MindIntent` in character-mind's types.ts. */
type IdleIntent
  = | (IntentBase & { channel: 'posture', kind: 'idle-act', act: IdleBehaviourKind, seed: number, requested: boolean })
    | (IntentBase & { channel: 'posture', kind: 'idle-errand', errand: IdleErrandKind, pick: number, holdSeconds: number | null })

/** The earliest wake the host must arm, in epoch milliseconds, or null. Parallel to `nextVoiceWakeAt`. */
export function nextIdleWakeAt(idle: MindIdleState): number | null
```

- **Each step.** Before any stimulus, the mind advances `activeSeconds` by `nowMs − atMs` while the last view was active, and runs `advanceIdleSchedule` over that span under the last view. An `idle` stimulus then applies its reports in order: `view` replaces the view, `started`, `ended`, and the errand edges become `applyIdleEdge` calls, and `refused` clears `pending`. A decision becomes an `idle-act` or `idle-errand` intent with the seed drawn after the decision's own draws. Every other stimulus kind only advances the clock, so the policy's draws never depend on how often voice ticks arrive.
- **Sleep.** `act: 'sleep'` with `requested: false` is the away rule's sleep. The sleep rule reads the reported view's `away` and `mode`, not `MindState.presence`, so the rule sees exactly the frame Natural saw; the presence answer's posture `wake` keeps its CM2 behavior.
- **Dormant.** A view with a null drive does what a null drive does today: it clears the follow-up, the away run, and `pending`, keeps the threshold, the urge, the rest, and every stamp, and decides nothing. No view at all (no Natural performer has reported since the mind started) is the same.
- **A refusal.** Natural starts a decided act only if she is free at its next grid step, with the same tests as today (`performing`, not blocked, not away for an act, nothing current; a cue that arrives in the same step wins). Otherwise it reports `refused`. The fire is spent, as a fire whose pick finds no eligible kind is spent today (D16).
- **A requested play.** `idle-play` yields `idle-act` with `requested: true` at once; Natural keeps today's test (`performing`, not blocked) and its 24 s end for a played sleep. Cooldowns and recency see it through the `started` report, as `start` stamps it today (D13).
- **The voice channel.** The gate does not read `state.idle` in CM4b: overlap 3 closes because both live on one clock and one state, and any use of what she is doing in the gate is tuning for a later slice.

### 3.4 Exact deadlines on the mind's clock

`nextIdleWakeAt` returns `atMs + (nextIdleDeadline(...) − activeSeconds) × 1000` while the view is active, else null. The host arms one timer at it after every step, as `publishVoice` does for the voice deadlines (widget turns ADR D12), and sends `idle-wake` when it fires. A hazard crossing is a deadline because the rate is constant between edges: every input of the rate (drive, mode, away, current, rest, refractories) changes only at a reported edge or at a deadline the mind already wakes for.

The timing evidence for D3: the `rest` report's `sleep-onset` line allows 30 s plus 1/30 s after the away cue. The edge reaches the mind at most one frame late and the decided sleep starts at most one frame later, so a 60 Hz headless run stays inside the 1/30 s slack only with exact deadlines. A 1 Hz sample would add up to a second and could fail the line for a 30 s draw.

### 3.5 Hosting in the app

```ts
/** What a mounted stage lends the mind. The conductor gates both by driver. */
export interface MindStage {
  idleCue: (cue: Extract<MindIntent, { kind: 'cue' }>['cue']) => void
  /** Performs one idle intent; a stage under another driver drops it. */
  idle: (intent: Extract<MindIntent, { kind: 'idle-act' | 'idle-errand' }>) => void
}

/** The handle `attachStage` returns. Only the newest attached stage's reports reach the mind. */
export interface MindStageHandle {
  report: (reports: readonly IdleReport[]) => void
  detach: () => void
}
```

- **The store** (`packages/stage-ui/src/stores/character-mind.ts`) subscribes once to `mind.onStep`: it sends every `idle-act` and `idle-errand` intent of any step to every attached stage, and re-arms its one idle wake timer at `nextIdleWakeAt(state.idle)` when the value changed. A detach of the reporting stage sends `{ kind: 'idle', reports: [{ kind: 'view', view: dormant }] }`, so the mind stops deciding for a stage that left. The timer is cleared at `dispose` and on `reset`.
- **The stage.** `Stage.vue` attaches with `idle: intent => performanceConductor.idle(intent)` and forwards the scenes' new `idle-reports` event to the conductor, which hands it to the handle only under Natural. The conductor's `idlePlay` sends `idle-play` to the mind instead of calling the scene. The conductor's own dispatch of touch and desktop steps ignores idle intents, because the store dispatches them.
- **Natural.** `NaturalMotion` gains `idle(order: IdleOrder)` (queued like a play, applied at the next grid step) and `onIdleReports(listener)`, which it calls once per `advance` that produced an edge and from `setSuspended` when `active` changes. It reports a view only when a field changed (the drive compared by value), so the 1 s drive send does not step the mind when nothing changed. Both adapters queue `idle` like `idleCue` and forward the listener: `Live2DNaturalMotionAdapter` through `Model.vue` and `Live2D.vue`, and `MMDNaturalAdapter` through `MMD.vue`. `setIdleDrive` stays: Natural still needs the drive for shapes (`idleEnergyOffset`) and reports it in the view.
- **Two stages (overlap 5).** Intents fan out to every stage of the window and carry the act's seed, so a second stage shows the same act and shape. Only the newest stage reports, so one stage's view drives one schedule. A second stage that is not free refuses locally and reports nothing; that stage shows no act. No stimulus or intent crosses windows (direction ADR decision 9).
- **Other drivers (overlap 9, Target rule 1).** Under Universal and MAGIC the Live2D adapter suspends Natural and forwards no drive, so its view is dormant: the mind decides no act and no sleep, and the conductor drops any idle intent. Classic MMD has no Natural adapter and never reports. Universal's own idle motion groups stay as upstream ships them; they are not a sleep decision.

### 3.6 Sleep and what shows it

The mind decides sleep, Natural performs it, and `useIdleProps` keeps following Natural's `idle` report (`sleep` start, release, wake), as it does today (D7). The props show what she does, not what was asked: a refused or interrupted sleep then shows no sleep entries over open eyes. The MMD director keeps reading `bodyIntent().idle`. `allowSleep` leaves `NaturalIdleDrive` and the QA drives in item 4: the conductor always sent `true`, nothing narrows it, and the rule that read it moved into the mind (D8).

### 3.7 Natural's fast mood and the slow touch dose (CM4a D14)

- **The fast mood stays a performer channel (D9).** The mind already decides every dose (`mood` intents for touch; Natural's own `add(episode)` for an emotion it was told to perform). What stays in Natural is a seconds-scale afterglow that `modulateByMood` samples every grid step and that freezes with active time. Moving it into `MindState` would put a frame-rate value on the mind's clock, which the render loops skill forbids. This settles the core ADR's last "Not decided" item and makes its decision 16 permanent.
- **The slow touch dose stays in the bridge (D10).** `bridgeSituationToCharacter` turns finished pets and poke bursts into character-state events once per character since CM4a, and the slow state ADR's D9 keeps the record's events and reducer with the store.

### 3.8 The headless runners

The MMD runner drives idle through a mind (D14): `new CharacterMind({ seed: <derived from the run's seed>, clock: () => simMs })`, the adapter's reports into `mind.receive`, the idle intents of each step back into the adapter, and at the start of each frame, before `advance`, an `idle-wake` when `nextIdleWakeAt` is due. The `idle` scenario and `--acts off` set no drive, so their views stay dormant and the mind decides nothing. The Live2D rig needs no wiring: its scene sets no drive. `use-motion-qa-events.ts` skips a `mind` step whose stimuli are only `idle` or `idle-wake` and that returned no intent, as it skips idle voice ticks.

## 4. Where the code lives

| Path | Change |
| --- | --- |
| `packages/motion-driver-natural/src/idle-schedule.ts` (new) | The pure schedule, `IdleView`, `IdleEdge`, `IdleDecision` [1]; `IdleReport`, `IdleOrder` [2] |
| `packages/motion-driver-natural/src/idle-activities.ts` | Calls the schedule [1]; loses it and plays intents [3]; loses `allowSleep` [4] |
| `packages/motion-driver-natural/src/natural-motion.ts` | `idle(intent)`, `onIdleReports`, the view on `setSuspended` [3] |
| `packages/character-mind/src/idle.ts` (new), `types.ts`, `step.ts`, `index.ts`, `package.json` | The idle policy, stimuli, intents, `MindState.idle`, `nextIdleWakeAt`, the dependency [2] |
| `packages/stage-ui/src/stores/character-mind.ts` | Fan-out, the reporting handle, the idle wake timer [3] |
| `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` | `idle`, `idleReport`, `idlePlay` through the mind [3]; no `allowSleep` [4] |
| `packages/stage-ui/src/components/scenes/Stage.vue` | Attach with `idle`; forward `idle-reports` [3] |
| `packages/stage-ui/src/composables/performance/use-motion-qa-events.ts` | Skip idle-only steps [3] |
| `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts`, `components/scenes/live2d/Model.vue`, `components/scenes/Live2D.vue` | Queue `idle`, emit `idle-reports` [3] |
| `packages/stage-ui-mmd/src/composables/mmd/natural/adapter.ts`, `components/scenes/MMD.vue` | Queue `idle`, emit `idle-reports` [3] |
| `packages/qa-tools/src/t2-3d/runner/run.ts` | Idle through a mind [3] |
| `packages/qa-tools/src/t2-3d/idle-drive.ts` | No `allowSleep` [4] |
| `eslint.config.ts` | `airi/idle-schedule-pure` [1]; the subpath allowance for the mind [2] |

## 5. What is deleted

- From `NaturalIdleActivities` [3]: `threshold`, `urge`, `restUntil`, `sleepAfter`, `awaySince`, `followUp`, `lastDrawn`, the errand stamps, `pick`, `chooseErrand`, `startErrand`, `errandHazards`, and the sleep and follow-up branches of `step`. `play` moves behind `idle(intent)`.
- The conductor's direct `idlePlay` call to the scene [3].
- `allowSleep` everywhere [4].

After item 4, `git grep -nE "allowSleep|chooseErrand|errandHazards|sleepAfter"` must print nothing outside `.omo/` and `docs/ai/adr/`, and `git grep -n "this.random()" packages/motion-driver-natural/src/idle-activities.ts` prints only cue-shape draws.

## 6. Docs that move with the code

Policy docs change in the commit that makes their statement false. The work item is named in brackets. Run `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after each policy doc edit.

- **`docs/ai/context/autonomous-behavior.md`** [3, 4]: [3] the Deciders rows for Natural's idle activities and sleep name the mind (`packages/character-mind/src/idle.ts`) and Natural as the realiser; Precedence rule 6 is rewritten as the mind's idle policy and Natural's cue acceptance; rule 16's clock sentence covers the idle draw; rule 18 adds the fan-out, the reporting stage, and the idle wake timer; Target rule 3 moves into the current sections and Target rule 1 states that the idle draw exists once per character; overlaps 3, 5, and 9 leave Known overlaps, and their rows leave the Target table. [4] rule 4's drive sentence loses `allowSleep`.
- **`docs/ai/context/body-ownership.md`** [3, 4]: [3] the Natural driver row and the idle rows: the mind decides, Natural performs, and only under Natural; [4] the note on the idle agency ADR's `allowSleep` contradiction states that the field is gone.
- **`docs/ai/context/glossary.md`** [3, 4]: a new term **Idle policy**, parallel to Voice policy; Character mind, Conductor, Idle activity, Idle errand, Intent (`idle-act`, `idle-errand`), Stimulus (three kinds; the count), Mood (the fast mood stays in Natural, D9) [3]; Drive and the Conflicting usage "Drive" (seven fields) [4].
- **`docs/ai/context/character-mind-roadmap.md`** [5]: the CM4b row done; the tuning row's idle retune may start.
- **READMEs:** `packages/character-mind/README.md` (the stimuli and intents table, the new dependency, When not to use) [2, 3]; `packages/motion-driver-natural/README.md` (who schedules, the schedule module) [1, 3, 4]; `packages/stage-ui/README.md` (the mind store's stage handle) [3]; `packages/qa-tools/README.md` (the runner drives idle through a mind; `idle-acts` and `rest` read Natural's reports of acts the mind decided) [3].
- **ADR** [5]: `docs/ai/adr/2026-11-19-character-mind-idle.md` (or the date it is written) records D1 to D16 as taken or vetoed. It supersedes the idle agency ADR's statements that Natural draws the schedule and that `allowSleep` exists, and settles the core ADR's last "Not decided" item. Existing ADR bodies are not edited.
- **Nested guidance.** `packages/stage-ui-live2d/AGENTS.md` says each Natural layer has its own seeded `RandomStream`; after item 3 the idle layer keeps one for cues and seeds acts from the intent. If that line misleads, fix it in a `chore(agents)` commit of its own in this PR. `packages/motion-driver-natural/AGENTS.md` (read the idle agency ADR first) stays true.

## 7. Work items

Each item is one commit that passes `pnpm verify`.

1. **`refactor(motion-driver-natural): extract the idle schedule as pure rules`.** `idle-schedule.ts` as in section 3.2 without the seed draw; `NaturalIdleActivities` calls it once per grid step on its own stream; the lint block. Docs `[1]`. Tests: `idle-schedule.test.ts` takes the hazard, pick, cooldown, recency, no-repeat, rest, sleep-delay, follow-up, and errand-pacing cases from `idle-activities.test.ts` and `idle-errands.test.ts` unchanged; the replay pins (seeds 7 and 11, the recency pins) stay green with no re-pin; one new case checks `nextIdleDeadline` against a grid search for the first decision; one new long-run case runs the class for simulated hours, inactive and working, and pins today's behaviors per hour with the four-Poisson-deviation bound that `idle-errands.test.ts` uses (the idle agency ADR's evidence reads 59 and 44 per hour; the pin is what today's code gives). Evidence: `qa:motion3d diff` prints `IDENTICAL` for `idle`, `idle-drive`, and `sleepy-no-clip` against `755ef0a86`.
2. **`feat(motion-driver-natural,character-mind): add the idle policy`.** `IdleReport` and `IdleOrder` in `idle-schedule.ts`; `idle.ts`, the stimuli and intents, `MindState.idle` in `initialMindState`, `nextIdleWakeAt`, the dependency and lint allowance. Nothing sends the stimuli yet. Docs `[2]`. Tests (Node, seeded): an active view with no edge reaches the hazard's crossing exactly at `nextIdleWakeAt`; time stops while the view is inactive; a dormant view clears the follow-up and the away run; a pending intent blocks a second decision until `started` or `refused`; the sleep rule fires at the drawn delay of quiet away time and restarts after a talking span; the follow-up after a 90 s sleep; a refusal spends the fire; `idle-play` yields `requested: true`; a JSON round trip of the state continues identically; voice ticks between edges do not change the idle draws.
3. **`feat(motion-driver-natural,character-mind,stage-ui,stage-ui-live2d,stage-ui-mmd,qa-tools): move the idle draw into the character mind`.** Sections 3.1, 3.3 to 3.6, and 3.8. Docs `[3]`. Tests: `idle-activities.test.ts` keeps the shape, interruption, cue, settle, and speed-bound cases and drives acts by intent; a refused intent reports `refused`; equal seeds give equal shapes; the long-run rate tests (item 1's act rates; the errand rates of `idle-errands.test.ts`, which pin 5.39 pastimes, 12.0 clips, and 4.18 wanders per hour) move to `character-mind/src/idle.test.ts` as a mind plus a fake performer, with their expected values and tolerances unchanged; the replay pins move there and are re-pinned once, with the reason in the commit body; the store test covers fan-out to two stages, reports only from the newest, the dormant view on detach, and the wake timer; the conductor test drops idle intents and `idle-play` outside Natural; both adapter tests queue `idle` and emit reports; `use-motion-qa-events` skips idle-only steps. The Live2D `observer.test.ts` golden hashes are re-pinned only if they move, once, with the reason.
4. **`refactor(motion-driver-natural,stage-ui,qa-tools): drop allowSleep from the idle drive`.** Section 3.6. Docs `[4]`. Tests: the affected fixtures lose the field; the case "never sleeps when the renderer plays its own sleep stance" goes, because no host narrows `allowSleep` (the idle agency ADR's amendments dropped the MMD sleep-clip path); `idle-acts.test.ts` and the `rest` report's `drive` line compare the seven-field values.
5. **`docs(ai): record the idle decisions and close CM4b`.** The ADR and the roadmap marked `[5]`. Last, after the checks in section 8 pass.

**Order.** 1, 2, 3, 4, 5. Item 2 has no caller until item 3, so item 3 is where behavior changes.

## 8. Checks

- **Each commit:** `pnpm verify`. Inner loops: `pnpm -F @proj-airi/motion-driver-natural exec vitest run src/idle-schedule.test.ts src/idle-activities.test.ts src/idle-errands.test.ts`; `pnpm -F @proj-airi/character-mind exec vitest run src/idle.test.ts`; `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/character-mind.test.ts src/composables/performance/use-stage-performance-conductor.test.ts`; `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion-adapter.test.ts`; `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node src/composables/mmd/natural/adapter.test.ts`.
- **Policy docs:** `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts`, by name, after each policy doc edit and at the tip.
- **The branch:** `pnpm verify --gate --base luke/feat/character-mind-slow-state`.
- **Smoke on both hosts.** `.env.qa` is not in this worktree; create it there (it is ignored) or export `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`.
  - `pnpm qa:display run -- pnpm qa:smoke`
  - `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"`
- **Headless rigs.** `pnpm qa:live2d-rig` passes with the same trace hash as at `755ef0a86`, because its scene sets no idle drive. `pnpm qa:test:model` passes.
- **Headless motion.** Base runs come from a worktree at `755ef0a86` (`pnpm wt new cm4b-base`, removed afterward with `pnpm wt rm cm4b-base`), tip runs from this branch, both clean.
  - Runs: `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario <name> --seed 1 --out <dir>` for `idle`, `idle-drive`, and `sleepy-no-clip`, plus the `idle-drive` companion with `--acts off`, at each end. Add `--verify-determinism` to the tip's `idle-drive` and `sleepy-no-clip` runs, because the runner now carries a mind.
  - After item 1: `pnpm qa:motion3d diff <base run> <item-1 run>` prints `IDENTICAL` for all three scenarios.
  - At the tip: `diff` prints `IDENTICAL` for `idle` (no drive, so no draw) and `DIFFERENT` for `idle-drive` and `sleepy-no-clip`. `DIFFERENT` is expected there: the draws come from the mind's source, each act's shape from its seed, and item 4 changes the drive provenance. It is not a pass by itself; the reports are.
  - Reports, each end on its own code (the `drive` lines compare against the running tree's QA constants, so the tip cannot report a base run): `pnpm qa:motion3d report idle-acts <idle-drive run> --pair <acts-off run>` and `pnpm qa:motion3d report rest <sleepy-no-clip run>`. Pass: every line reads the same status at both ends. `pair` reads REPORT at both, and `doze-head` reads NOT-EXERCISED at both, so the `rest` verdict is the base's verdict, not a pass. Record each `sleep-onset` delay. If a line's status differs, stop: never retune a gate to make a run pass (motion QA skill).
  - Required wording for the PR: "Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review."
- **Rendered check.** A driver under `.temp/cm4b/` (not committed), modeled on `.temp/cm4/driver.ts`: an HTTP verb server inside `pnpm qa:display run --name cm4b -- node --import tsx .temp/cm4b/driver.ts`, with `AppSessionCore`, the replay LLM server, the warning collector, page-side evaluation over CDP, and the verbs `launch`, `stop`, `eventsSince`, `userTurn`, `fireReachOut`, `waitIdleAct`, `setLive2dDriver`, `errors`, and two new ones: `requestIdle` (the lab's `requestIdle` through page-side evaluation of `useNaturalPerformanceOverride`) and `pinAway` (page-side evaluation that holds the desktop activity snapshot's `idleSeconds` above `AWAY_INPUT_IDLE_SECONDS` until released; the bridge's `state` must show `away: true`). Stop the display with `pnpm qa:display down --name cm4b`. The driver prints no model path.
  1. **Natural, classic window, Live2D rig from `AIRI_QA_RIG_FORBOOTH`.** Pass: within 180 s one `mind` event carries a `posture/idle-act` intent and the next `idle` start event names the same kind; its end follows.
  2. **The CM4a lesson.** One replayed user turn whose ACT is happy, then `fireReachOut` while the hold is up. Pass: the `mind` event has `posture/cue about-to-speak` before `voice/speak`, and no `idle` `about-to-speak` event follows, because Natural skips the cue while the held emotion blocks her. Then wait until the bridge's `state` shows no hold, fire again, and expect one `idle` `about-to-speak` event. Do not read the first case as a failure.
  3. **A played sleep.** `requestIdle` with `sleep`. Pass: a `mind` event with the `idle-play` stimulus and `idle-act sleep` `requested: true`, an `idle` sleep start, the sleep entries about 5 s later if the rig has them (else recorded as not exercised), and a wake about 24 s after the start.
  4. **Sleep while away.** `pinAway`, then wait. Pass: an `idle` sleep start no later than 31 s after `state` first shows `away: true`. Release the pin: a posture `wake` intent and the sleep's end follow. If the snapshot cannot be pinned from the page, record that as a departure and rely on `sleepy-no-clip` and the Node tests.
  5. **Universal.** Switch with `setLive2dDriver`. Pass: for 120 s no `idle` event and no `idle-act` or `idle-errand` intent in any `mind` event; `requestIdle` gives no `idle-play` stimulus; a firing reach-out still gives its cue, line, and turn.
  6. **MMD on the desktop stage**, with `AIRI_QA_MMD_MODEL`. Pass: within 180 s an `idle-act` intent and its `idle` start; with `pinAway`, an `idle` sleep start. A screenshot of the sleep stance or doze goes into the PR.
  Every launch: 0 renderer and 0 main-process errors.
- Record the run directories, the report lines at both ends, and the event excerpts (kinds and counts, no content) in the PR description.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Item 3 is a large commit across seven packages | Items 1 and 2 land the rules and the policy first with their own tests; item 3 only wires and deletes. Its diff is reviewed against section 3.5's list |
| The mind keeps counting while a stage is hidden, so she falls asleep or acts the moment she reappears | `activeSeconds` advances only while the view is `active`, and `setSuspended` reports the change outside a frame. A Node test and rendered step 4 cover it |
| A report storm: the 1 s drive send steps the mind every second | Natural reports a view only when a field changed, the drive compared by value; QA events skip idle-only steps |
| The 60 Hz headless frame delays an edge and a start by one frame each, which can reach the `sleep-onset` slack | The runner sends `idle-wake` before `advance`, so the start lands in the same frame as the wake. Record the measured onset delays at both ends |
| A decided act loses a race with a claim in the next grid step | Natural reports `refused`, `pending` clears, and the fire is spent as today's empty pick is (D16) |
| Two stages disagree: the second is blocked and shows nothing | Accepted (section 3.5); no build renders two live stages |
| Cue acceptance stays silent: a skipped `about-to-speak` reaches the mind as nothing | Unchanged from today and out of scope; a refusal report for cues is a follow-up toward body ownership Target rule 4 |
| Re-pinned replay pins hide a real change in odds | The long-run rate tests keep their values and tolerances, and the rendered and headless reports must match the base's statuses |

## 10. Follow-ups this plan does not do

- Report a skipped cue as a refusal (body ownership Target rule 4).
- Let the voice gate read what she is doing (`state.idle`) instead of `selfHint` text. That is tuning.
- Moments in `useIdleProps` still draw `Math.random` in the realiser (idle agency ADR). They are a frame-side pick, not a schedule decision.
- The idle retune that the roadmap's tuning row holds for CM4b may start once this lands.

## 11. Decisions open to the owner's veto

| # | Fork | Options | Taken | Why |
| --- | --- | --- | --- | --- |
| D1 | Split CM4b | One PR; extraction first, then the switch in a later PR; split by acts and errands | One PR, extraction as its first commit | Acts and errands share one hazard. Any later PR boundary leaves two deciders running, which is a compatibility path |
| D2 | Home of the rules | `motion-driver-natural/src/idle-schedule.ts`, imported by subpath; move them into `character-mind`; move them into `stage-shared` | `motion-driver-natural` | Core ADR decision 3. No cycle; a new lint block keeps the module pure. Moving them would split the ADR's pins from the constants that `idle-acts` and `rest` describe |
| D3 | When the mind decides | Exact deadlines from edge reports and one wake timer; the CM4a outline's 1 Hz eligibility sample | Exact deadlines | A 1 s sample delays every decision by up to 1 s, which breaks the `sleep-onset` bound and shifts every gap. The voice channel's wake timer is the precedent |
| D4 | The idle time base | The mind's clock counted while the view is active; plain wall time | Active time on the mind's clock | Today's timers freeze while she is hidden or paused. Wall time would change what she does on return, which is a behavior change |
| D5 | Where draws come from | The mind's source for the schedule, a per-act seed for shapes; Natural's stream for both | Mind and seed | Target rules 1 and 3. Headless traces differ (`DIFFERENT`), the odds do not; the long-run rate tests keep their values |
| D6 | What stays in Natural | Shapes, interruption, settling, cue acceptance, the pastime hold end, the errand record; move settling and cues too | Keep them in Natural | Each must act within one grid step. The mind already decides the cues; their acceptance is a frame test |
| D7 | What `useIdleProps` follows for sleep | Natural's `idle` report; the mind's `idle-act sleep` intent (the CM4a outline) | Natural's report | The props must match what shows. A refused sleep would otherwise get sleep entries over open eyes |
| D8 | `allowSleep` | Remove it; keep it and read it in the mind | Remove | Nothing narrows it, and the rule that read it moved. It changes the QA drive provenance, so item 4 is its own commit |
| D9 | Natural's fast mood | Stay a performer channel; move into `MindState` | Stay | The mind decides every dose already; the afterglow is a frame-sampled value on active time |
| D10 | The bridge's slow touch dose | Stay in the bridge; move into the mind | Stay | Once per character since CM4a; the slow state ADR's D9 keeps the record's events with the store |
| D11 | Drivers other than Natural | The policy dormant; the mind keeps deciding sleep that nothing performs | Dormant | Body ownership Target rule 1, and no dangling state. Under Universal she never sleeps, as today |
| D12 | Two stages in one window | Intents to every stage, reports from the newest; one stage only | Every stage, newest reports | Closes overlap 5 with no transport, matching how cues pick the newest stage |
| D13 | The lab's requested play | Through the mind (`idle-play`); straight to the scene | Through the mind | Cooldowns, recency, and no-repeat must see it, as `start` stamps it today |
| D14 | The headless runners | Drive idle through a mind; keep a runner-only scheduler | Through a mind | The runs must test the product path; a second scheduler is a second decider |
| D15 | Who arms the idle wake | The mind store; the situation store; the conductor | The mind store | It owns the mind and outlives stage remounts; the situation store's timer belongs to the gate |
| D16 | A decided act that Natural cannot start | Spend the fire; keep the threshold and retry | Spend | Today's empty pick is spent; a retry would raise the effective rate |

## Blocked: needs the owner

- **The CM3a amendment.** The roadmap moved overlap 3 from CM3 to CM4 and says the owner may veto that. This plan takes it as working scope: CM4b closes overlaps 3, 5, and 9. The code is the same either way, because the only fix for overlap 3 is to put the idle draw on the mind's clock. A veto changes the bookkeeping: overlap 3 goes back to a CM3 follow-up row that this branch then satisfies, and CM4b's Done-when names 5 and 9.
- **Overlap 12.** Whether notice turns go through the mind stays the owner's question. CM4b does not touch it.

Nothing else blocks CM4b.

## Must not do

- Do not tune a rate, a weight, a cooldown, the rest, the sleep delay, the follow-up chance, the errand pacing, the pastime hold, or a hazard, and do not retune a report or gate line to make a run pass.
- Do not send posture intents to Universal, MAGIC, or classic, and do not decide idle under them.
- Do not keep the old scheduler beside the new one, and do not add a compatibility guard.
- Do not move Natural's fast mood or the slow touch dose.
- Do not feed `Date.now` or the mind's clock into a value a frame samples; Natural receives only intents and seeds.
- Do not add an Eventa contract or cross-window mind traffic.
- Do not edit the body of an existing ADR, and do not remove a diagnostics field the MMD guide marks append-only.
- Do not commit a model path or any other local path; use `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`.

## Done when

The mind decides every idle act, errand start, sleep, and follow-up on its clock and seeded source; Natural performs them only under Natural and draws no schedule; both stages of a window would show the same act; `useIdleProps` and the MMD director show the sleep Natural performs; `allowSleep` is gone; overlaps 3, 5, and 9 have left Known overlaps and Target rule 3 has moved into the current sections; the roadmap shows CM4b done; and every check in section 8 passes, with `idle-acts` and `rest` reading the same statuses at both ends.

## Departures during implementation

## Checks run

| Check | Result |
| --- | --- |

## Commits
