# `@proj-airi/stage-shared`

Shared contracts and runtime-neutral helpers for AIRI stage applications and UI packages.

## Use this package

Use this package when a type or behavior must cross stage application boundaries without depending on Electron, browser-only code, or a feature UI package.

The `plugin-host` entrypoint owns the serializable Plugin Host snapshots exchanged between the Electron main process and shared renderer code:

```ts
import type { PluginHostDebugSnapshot } from '@proj-airi/stage-shared/plugin-host'
```

The `model-assets` entrypoint owns model file manifests, download status, and
the storage adapter contract. Use a platform adapter to store and open files.
It does not own a recognizer or Worker.

### Performance state

The `performance-state` entrypoint owns the performance-state contract and its pure resolver.
A `PerformanceState` says what the character is doing as a performer: its `mode` (`talking`, `listening`, `thinking`, `watching`, or `idle`), its `attention` (`camera`, `screen`, or `cursor`), whether the user is `away`, and a reaction sequence (`reactSeq` and `reactKind`) for wakes and sharp screen changes.
The Live2D Natural motion driver reads it.

Call `resolvePerformanceState` with the current inputs and the memory that the previous call returned. Start from `initialResolverMemory`.
The resolver never reads a clock: pass epoch milliseconds in `nowMs`.
Resolve again on a timer, so dwell and release timers advance, and also at once when an input changes, so the listening release starts when user speech ends.

```ts
import type { PerformanceInputs } from '@proj-airi/stage-shared/performance-state'

import { initialResolverMemory, resolvePerformanceState } from '@proj-airi/stage-shared/performance-state'

let memory = initialResolverMemory

function resolve(inputs: PerformanceInputs) {
  const resolution = resolvePerformanceState(inputs, memory)
  memory = resolution.memory
  return resolution.state
}
```

Use this entrypoint when a stage needs to tell a renderer what the character is doing.
Do not use it to read desktop or voice signals. The caller collects them, and a `null` signal means that the host cannot measure it, so it never counts as activity.

### Desktop activity store

The `stores/desktop-activity` entrypoint owns `useDesktopActivityStore`, which holds the latest `DesktopActivitySnapshot` for the performance resolver.
A host writes it with `setSnapshot` and clears it with `reset`. The Electron host writes it from the main process power monitor and idle time. The web host never writes it, so `snapshot` stays `null`.

```ts
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { storeToRefs } from 'pinia'

const { snapshot } = storeToRefs(useDesktopActivityStore())
```

Use this store to pass desktop samples from a host producer to the stage.
Do not persist or replicate it: it is runtime state, and each renderer reads only its own host's samples. Do not sample desktop signals in this package; the host producer owns sampling.

### Expression performance

The `expression-performance` entrypoint owns the pure decision layer for character expression performance:

- the `AffectSignal`, `ReactionEpisode`, `SlotCommand`, `HoldCommand`, and `Decider` contracts;
- the catalog schemas, `mergeCatalog`, `isAutoEligible`, and `isLlmEligible`;
- the settings document schema `ExpressionPerformanceSettingsSchema`, its defaults, and `parseExpressionPerformanceSettings`;
- reaction strength with bands, habituation, and escalation (`acceptReaction`);
- the picker and planner deciders, selected by `createDecider`, and the timing-slot scheduler;
- affect traces and their replay (`withAffectTrace`, `parseAffectTrace`, `replayAffectTrace`);
- the Eventa contracts that carry lab affect-trace requests, results, and failure codes between windows (`affectTraceRequestedEvent`, `affectTraceCompletedEvent`, `affectTraceFailedEvent`, `createAffectTraceDiagnosticsContext`);
- character performance profiles (`resolveEffectiveSettings`, `applyMappingWeights`).

A decider never reads a clock, global randomness, or a store. Pass every time in the signal as monotonic seconds, and keep the returned state for the next call. The state is plain JSON, so it can be checkpointed and replayed.

A `HoldCommand` tells the Natural driver which emotion to hold and for how long. It has an `emotion`, or `null` to release the hold, a `strength`, and the same `holdSeconds`, `until`, and `turnId` lifetime fields as a slot command.
Every decision carries `holds`:

- An accepted emotion episode holds its emotion at the episode intensity. A speech turn's hold uses the band's `faceHold` with `until: 'speech'`; a hold without a turn lasts `held.turnlessSeconds` with `until: 'hold'`.
- A neutral that resets the reaction state, and a clear that names no slot, release the hold.
- An explicit expression whose catalog entry has emotion mappings accepts its heaviest mapping like an emotion signal, which can start or escalate an episode, and always holds that emotion for the expression's own slot lifetime.
- With `heldEmotions` off, explicit expressions keep their slot-only behavior.

```ts
import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import { createDecider, defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

const catalog: CatalogEntry[] = []
const decider = createDecider('picker')
let state = decider.initial(42)

const result = decider.decide(
  { kind: 'emotion', source: 'act', emotion: 'happy', nominal: 0.6, turnId: 'turn-1', at: 12.5 },
  { catalog, settings: defaultExpressionPerformanceSettings },
  state,
)
state = result.state
// result.decision.episodes and result.decision.holds go to Natural; result.decision.slots go to the expression performer.
```

Use this entrypoint to decide how a character reacts to emotions and expression requests, and to compare deciders by replaying a recorded affect trace.
Do not use it to render, compose parameters, or hold timers. The stage conductor in `@proj-airi/stage-ui` owns clocks and timers, and `@proj-airi/stage-ui-live2d` executes the decisions.
The [expression performance ADR](../../docs/ai/adr/2026-10-18-expression-performance.md) records the contracts.
The [Natural emotion revamp ADR](../../docs/ai/adr/2026-10-19-natural-emotion-revamp.md) records the hold contract.

### Motion scenario

The `motion-scenario` entrypoint owns the input script that motion QA replays at every level (T1 simulated pipeline, T2 headless rig, T3 rendered app):

- `MotionScenarioSchema`, a strict Valibot schema for a versioned scenario with sorted `emotion`, `act`, `mode`, `speech`, `cursor`, `expression`, `placebo`, `noop`, and `marker` events. A scenario whose `levels` include `t3` cannot contain `speech` or `cursor` events;
- `createScenarioPlayer(scenario).eventsBetween(t0, t1)`, which returns the events with `t0 < at <= t1` in scenario order and reads no clock;
- `stripEmotions`, which swaps every `emotion` and `act` event for a `noop` with the same `at` and `trialId`, so a paired null run has the same timeline;
- `buildEmotionTrial`, `buildIdleWithPlacebos`, and `buildLongHold`, which build valid scenarios deterministically from their inputs;
- the schemas and Eventa invoke contracts (`eventa:invoke:motion-qa:*`) of the dev-only QA bridge, `createMotionQaContext`, `claimMotionQaHandlers` (one handler set per window), and `createMotionQaDispatcher`, which turns one JSON command string into one JSON reply and never rejects;
- `isMotionQaBridgeEnabled`, also exported alone from `@proj-airi/stage-shared/motion-scenario/flag`, so a caller that guards it with `import.meta.env.DEV` keeps the bridge contracts out of production bundles.

```ts
import { buildEmotionTrial, createScenarioPlayer, MotionScenarioSchema } from '@proj-airi/stage-shared/motion-scenario'
import { parse } from 'valibot'

const scenario = parse(MotionScenarioSchema, buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed: 1 }))
const pulse = createScenarioPlayer(scenario).eventsBetween(19.9, 20.1)
```

Use this entrypoint to describe, build, and replay QA inputs, and to type the bridge between a QA tool and the app.
Do not use it to run a scenario or to read clocks or randomness: the runners in `@proj-airi/qa-tools` and the app own execution. The bridge contracts do nothing unless the app enables the bridge.

### Situation

The `situation` entrypoint owns the pure core of situational presence: the observation and state types, the reducer, the situation block renderer, the opportunity gate, and the window-title helpers.

- `reduceSituation` folds one `Observation` into a `SituationState`. `advanceSituation` derives the events that need no observation, such as settled app switches, long-session tiers, and expiry.
- `renderSituation` renders the bounded `[Situation HH:MM]` block and returns the ids of the events that it showed as new. Pass them to `markShown`, so the next block does not repeat them.
- `evaluateGate` decides whether the character may speak up on her own and returns the next `GateMemory`. `recordFireOutcome` and `recordUserTurn` feed the engagement backoff.
- `normalizeWindowTitle`, `appIdFromExe`, `labelFromExe`, `categorizeApp`, and `isDenylisted` turn a foreground sample into an app id, label, category, and model-facing title.

No function reads a clock or randomness. Pass epoch milliseconds, and keep the returned state and memory for the next call.

```ts
import { initialSituationState, markShown, reduceSituation, renderSituation } from '@proj-airi/stage-shared/situation'

const nowMs = Date.now()
let state = reduceSituation(initialSituationState, { kind: 'wake', cause: 'unlock', atMs: nowMs }, nowMs)
const rendered = renderSituation(state, nowMs)
state = markShown(state, rendered.shownEventIds, nowMs)
// rendered.text is the block for the next chat request.
```

Use this entrypoint to describe the user's situation to the model, or to decide when an unprompted remark is welcome, in a way that tests can replay.
Do not use it to collect signals or to hold state for a window. `useSituationStore` in `@proj-airi/stage-ui` owns the leader's state, the sensors, and the gate loop.
Do not persist or sync a `SituationState`, because it can hold window titles.
The [situational presence ADR](../../docs/ai/adr/2026-10-19-situational-presence.md) records the rules and their starting constants.

### Foreground window store

The `stores/foreground-window` entrypoint owns `useForegroundWindowStore`, which holds the latest `ForegroundWindowSample`: the foreground app's executable, its window title, whether the window belongs to AIRI, the host-neutral `busy` state, and `sampledAtMs`.
A host writes it with `setSample` and clears it with `reset`. The Electron app writes it once per second using the Windows or macOS foreground sensor. Hosts without a foreground sampler leave `sample` as `null`.
A failed reading keeps the previous sample, so consumers judge freshness from `sampledAtMs`.

```ts
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { storeToRefs } from 'pinia'

const { sample } = storeToRefs(useForegroundWindowStore())
```

Use this store to pass foreground samples from a host producer to the situation sensor in `@proj-airi/stage-ui`.
Do not persist or replicate it, because a sample carries a raw window title. Do not sample the foreground window in this package; the host producer owns sampling.

## Do not use this package

Keep Electron IPC definitions in the Electron application. Keep UI state and actions in `@proj-airi/stage-ui`. Keep Extension runtime and manifest behavior in `@proj-airi/plugin-sdk`.

Do not add application startup, persistence, or platform-specific side effects here.
