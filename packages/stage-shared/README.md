# `@proj-airi/stage-shared`

The client domain layer for AIRI stage applications and UI packages. It holds the shared contracts, the pure decision cores of the fork's character systems (expression performance, situation, performance state, stage contract, motion scenarios), and runtime-neutral helpers. Each pure core takes explicit time and returns its memory; Vue and Pinia appear only in the small holder stores under `stores/`.

## Use this package

Use this package when a type or behavior must cross stage application boundaries without depending on Electron, browser-only code, or a feature UI package.

| Entrypoint | Use | Do not use |
| --- | --- | --- |
| `stage-contract` | Render the stable cue contract with a supplied translator and compose every character-turn system prompt from budgeted segments with `composePrompt`, which orders the segments and reports their sizes (see the [prompt composition ADR](../../docs/ai/adr/2026-11-01-prompt-composition.md)). The English SHA-256 pins its version; update it in the commit that changes the contract. | Read locale state, collect live stage state, or parse model replies. |
| `conversation-register` | Read the conversation registers (`talking`, `texting`) and texting flavors (`plain`, `discord`), parse a stored register, render the register section of the character prompt with `renderRegisterSection`, and share the `ASCII_FACES` list that speech strips. | Change the stage contract per register: the register section stays outside the contract, so the contract hash is the same in both registers. |

The `plugin-host` entrypoint owns the serializable Plugin Host snapshots exchanged between the Electron main process and shared renderer code:

```ts
import type { PluginHostDebugSnapshot } from '@proj-airi/stage-shared/plugin-host'
```

The `model-assets` entrypoint owns model file manifests, download status, and
the storage adapter contract. Use a platform adapter to store and open files.
It does not own a recognizer or Worker.

### Performance state

The `performance-state` entrypoint owns the performance-state contract and its pure resolver.
A `PerformanceState` says what the character is doing as a performer: its `mode` (`talking`, `listening`, `thinking`, `watching`, or `idle`), its `attention` (`camera`, `screen`, or `cursor`), and whether the user is `away`. The resolver also returns the edges it saw in that call as `events`: a `presence` event when `away` changes or a desktop wake (a new unlock or resume time, `WakeCause`) appears, and a `screen-change` event when screen change crosses above 0.35. It decides no reaction; the character mind answers the events.
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

### Usage performance records

The `perf/usage` entrypoint owns the contract for local performance recordings and the pure math around it:

- `PerfRecordSchema` and `parsePerfLine`, the Valibot schemas and parser for every JSONL record kind (`session-start`, `identity`, `sample`, `window-rollup`, `event`, `incident`, `segment-rollup`, `rollup-failed`, `bench-run`). Every line carries `v`, `kind`, `t` (epoch milliseconds), and `sessionId`. `v` is `SEGMENT_ROLLUP_VERSION` (2) for `segment-rollup` and `PERF_RECORD_VERSION` (1) for every other kind. `parsePerfLine` never throws: it returns `{ ok: false, reason }` with `json` for unparseable text, `version` for any other `v` (readers skip and count those lines, never migrate them), and `schema` for anything else invalid. A version 1 `segment-rollup` row, written before cells had buckets, is read as version 2 with each cell's totals in one bucket spanning the segment; `sessions.jsonl` never rewrites old rows, so this read is supported policy;
- `FRAME_BINS_V1` and `STAGE_BINS_V1`, the versioned bin edges that records name by id;
- `FixedHistogram`, a histogram over one preallocated `Uint32Array` whose `add` allocates nothing, with exact `shareAtLeast` for bin edges and `approxQuantile` over serialized counts;
- `CpuDeltaTracker`, which turns `cumulativeCPUUsage` readings keyed by `pid` and `creationTime` into CPU percentages of one core (`null` on first sighting, missing data, or a backwards delta), and `machineExternalCpuPct`, which subtracts the app's share from host CPU time. On Linux the host time comes from the aggregate `cpu` line of `/proc/stat` with `iowait` counted as idle (`parseProcStatCpu`). Other platforms use two `os.cpus()` readings, which omit `iowait`, `softirq`, and `steal`. AIRI child processes outside `app.getAppMetrics()`, such as MCP servers, count as external;
- `decideHostContended` with its named thresholds, `parsePsiCpu` for `/proc/pressure/cpu`, and `processRole`, which names an Electron `ProcessMetric` (`browser`, `gpu`, `window:<label>`, `utility:<service>`, and so on);
- `sanitizeModelName`, which reduces a model path to a short label, and `containsForbiddenText`, which flags path-, URL-, or key-like text in a serialized line;
- `SegmentRollupReducer`, which streams one raw segment's records and returns its `segment-rollup` row (or a `rollup-failed` row without a usable `session-start`). It joins each stage window rollup to the sample within 7.5 s and to its epoch's `identity`, groups windows into cells, and excludes and counts hidden, paused, frameless, and settling windows (the first 60 s of a segment, 20 s after a model load, resume, renderer reload, or new identity epoch) and windows spanning a suspend..resume gap. Contended windows get their own cells. Each cell splits its windows into wall-clock 5-minute buckets (`SEGMENT_BUCKET_MS`) by window end, each with its own windows, frames, frame histogram, per-window quartiles, stage timings, incidents, and the `(startMs, endMs]` span its windows cover; a window that spans a boundary goes to the bucket of its end and stretches that bucket's start back. Records it cannot use count as malformed lines; it never throws on data, only on use after `finish`;
- `bucketTotals`, a cell's totals over some of its buckets, such as the ones a reader keeps after dropping lease-contended buckets. Counts, the frame histogram, and stage timings merge exactly; each quartile is the window-weighted lower median of the buckets' values, which over one bucket is that bucket's own;
- `decideFrameStall`, `decideMemoryGrowth`, and `decidePegged`, pure incident deciders that take explicit time and return the memory for the next call, `trackCpuBaseline`, the settled per-process CPU baseline that `decidePegged` measures against, and `IncidentBudget`, which caps written incidents at 6 per rolling hour and 20 per rolling day;
- `compareFeature`, an observational comparison of one metric between a feature's values in segment cells, each given as its `bucketTotals` over the buckets the reader kept. It drops host-contended cells and cells marked lease-contended because no bucket was kept, never pools strata (host, renderer, model, activity, window, stage host, devtools, refresh rate, other features), and treats each cell with at least 24 windows as one block valued at its median. A side needs 5 blocks, 3 sessions, and 120 windows, or the result is `insufficient` with the counts. It reports medians, IQR, the difference, Cliff's delta, a seeded 90% bootstrap interval, and an A/A noise floor, and says `difference` only when the interval excludes 0 and the difference exceeds the floor. Once 3 sessions hold both states, it also reports paired within-session differences against a sign-flip floor (the 90th percentile of `|median|` over sign flips of the per-session differences: all 2^n patterns up to 14 sessions, so the floor is exact and seed-independent, and 50 seeded random patterns above that). The paired estimate decides the verdict only from 8 sessions. Below 8 the exact floor never falls below the paired difference. From 8 it may, and 8 to 14 same-sign differences with distinct magnitudes always reject; below that it is reported with `decisive: false` and the unpaired verdict decides. Both estimates are reported;
- `compareBench`, which compares `bench-run` records of two commit states. It refuses invalid or incomparable runs (host, build mode, Electron, scenario, model) and reports `regression` or `improvement` only when the median difference exceeds 2 sigma (scaled MAD of within-commit residuals, pooled with the 10 newest clean history commits whose runs all precede B, else pair-local with `lowConfidence`), exceeds the metric's practical floor, and at least 4 of 5 (all of 3) B runs agree. A dirty A or B is allowed, but dirty runs never enter the noise history;
- the statistics both comparisons use: `mulberry32`, `quantile`, `median`, the bootstrap `Interval` helpers, `aaNoiseFloor`, `signFlipNoiseFloor`, `cliffsDelta`, and `madSigma`, with their constants (`BOOTSTRAP_RESAMPLES`, `AA_SPLITS`, `MAD_TO_SIGMA`).

```ts
import { FixedHistogram, FRAME_BINS_V1, parsePerfLine } from '@proj-airi/stage-shared/perf/usage'

const frames = new FixedHistogram(FRAME_BINS_V1)
frames.add(16.7)
const slowShare = frames.shareAtLeast(36)

const parsed = parsePerfLine(line)
if (parsed.ok && parsed.record.kind === 'window-rollup')
  console.info(parsed.record.frames)
```

Use this entrypoint to write, read, or summarize perf records in the app, the `pnpm perf` CLI, and the bench.
Do not sample processes, frames, or the clock here, and do not read or write files: the Electron recorder and the CLI own sampling and IO, and they pass lines and times into the reducer and the deciders. Records never carry a personal file path; pass model names through `sanitizeModelName`.

### Desktop activity store

The `stores/desktop-activity` entrypoint owns `useDesktopActivityStore`, which holds the latest `DesktopActivitySnapshot` for the performance resolver.
A host writes it with `setSnapshot` and clears it with `reset`. The Electron host writes it from the main process power monitor and idle time.

```ts
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { storeToRefs } from 'pinia'

const { snapshot } = storeToRefs(useDesktopActivityStore())
```

Use this store to pass desktop samples from a host producer to the stage.
Do not persist or replicate it: it is runtime state, and each renderer reads only its own host's samples. Do not sample desktop signals in this package; the host producer owns sampling.

### Host capabilities

The `host-capabilities` entrypoint owns the pure host capability contract: `HostCapabilities`, `HostSignal`, `SignalStatus`, `HostReasons`, the resolver `resolveHostCapabilities`, the deterministic QA profiles `capabilitiesForHost`, `idleAdvances`, and `presenceNoticeKey`.
It states per host which signals are live, degraded, or unavailable, and why.
The host-by-host signal and feature table is in the [host capability ADR](../../docs/ai/adr/2026-11-08-host-capability-contract.md#host-parity-matrix).

```ts
import { capabilitiesForHost } from '@proj-airi/stage-shared/host-capabilities'

const caps = capabilitiesForHost('linux-wayland')
```

Use this entrypoint when a producer or consumer needs to know whether a host can supply a signal.
Do not sample signals or read clocks here: the resolver takes facts and a timestamp from the caller, and the host producer owns sampling.

### Host capabilities store

The `stores/host-capabilities` entrypoint owns `useHostCapabilitiesStore`, which holds this window's latest `HostCapabilities` snapshot.
A host writes it with `set` and clears it with `reset`. `status(signal)` returns the `SignalStatus` for a signal, or `null` before any host has written a snapshot.

```ts
import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'

const status = useHostCapabilitiesStore().status('cursorScreenPoint')
```

Use this store to read the host's signal guarantees in a renderer.
Do not persist or replicate it, and do not add `synced`: it is per-window runtime state, and each window receives its own snapshot from its host.

### Expression performance

The `expression-performance` entrypoint owns the pure rules for character expression performance. They fall on two sides. The character mind (`@proj-airi/character-mind`) decides the emotion, its strength, and its hold with `acceptReaction`, `emotionHold`, and `releaseHold`. The asset deciders here pick the catalog entries that show what the mind decided. The entrypoint holds:

- the `AffectSignal`, `ReactionEpisode`, `SlotCommand`, `HoldCommand`, and `Decider` contracts;
- the catalog schemas, `mergeCatalog`, `isAutoEligible`, and `isLlmEligible`;
- the settings document schema `ExpressionPerformanceSettingsSchema`, its defaults, and `parseExpressionPerformanceSettings`;
- reaction strength with bands, habituation, and escalation (`acceptReaction`, which takes the jitter of a new episode from the caller's `draw`), and the emotion hold (`emotionHold`, `releaseHold`), for the mind;
- the picker and planner asset deciders, selected by `createDecider`, and the timing-slot scheduler;
- `choosePastime`, which picks the entry the user marked `idleUse: 'activity'` that she holds when Natural's idle draw starts a pastime (Natural decides when and for how long), with `idleActivityEntries` and `idleSleepEntryIds` to read the catalog;
- `resolveOccasions`, which names the occasions that hold now (`morning`, `gaming`, `music`, `lonely` and the rest of `OCCASIONS`) from the hour, the foreground app, the music and the idle drive. A pastime entry tagged with `occasions` is offered only during one of them and picked first then; `occasionCoverage` lists which pastimes cover each occasion;
- `chooseMomentEntry`, which picks the entry tagged with `moments` that she shows for a few seconds at a short moment (`check-in`, `poked`, `waking` and the rest of `MOMENTS`), with `momentEntries` and `momentCoverage` to read the catalog;
- `buildTagSuggestionPrompt` and `parseTagSuggestions`, the two ends of a request that asks a language model to suggest `idleUse`, `occasions` and `moments` for a catalog. The parser drops everything the model may not decide; a suggestion is applied only by the user;
- affect traces and their replay (`withAffectTrace`, `parseAffectTrace`, `replayAffectTrace`). A trace is `version: 2`: it records the deciders' signals, which carry the episodes the mind decided, so a replay needs no mind. A version 1 trace no longer parses;
- character performance profiles (`resolveEffectiveSettings`, `applyMappingWeights`);
- touch affect (`touchAffect`, `initialTouchAffectMemory`, `MoodDose`), which turns one classified pet or poke into at most one mood dose with cooldowns and habituation. The mind calls it for every `touch` stimulus and sends the dose as a `mood` intent. Touch never creates an emotion episode.

A decider never reads a clock, global randomness, or a store. Pass every time in the signal as monotonic seconds, and keep the returned state for the next call. The state is plain JSON, so it can be checkpointed and replayed.

A decider receives no raw emotion. Its signals are:

- `reaction`, with the episode the mind decided. A new episode draws its pick tickets; an escalation reuses them and fills only empty slots.
- `neutral`, when a neutral emotion reset the mind's reaction state. It releases the face and effect slots.
- `expression`, for an entry the model named, with the episode the mind derived from the entry's emotion mapping, or `null`.
- `clear`, `speech`, `muted`, `timing`, and `deadline`.

A touch is not a decider signal: the mind answers it, and no entry shows it.

A decision carries the slot commands in `slots`. It carries no episode, no hold, and no mood dose: the mind sends those with its intents.

A `HoldCommand` tells the Natural driver which emotion to hold and for how long. It has an `emotion`, or `null` to release the hold, a `strength`, and the same `holdSeconds`, `until`, and `turnId` lifetime fields as a slot command.
The mind decides the hold:

- An accepted emotion episode holds its emotion at the episode intensity (`emotionHold`). A speech turn's hold lasts `slotHoldSeconds('face', emotion)` with `until: 'speech'`, the same as a face expression of that emotion; a hold without a turn lasts `held.turnlessSeconds` with `until: 'hold'`.
- `slotHoldSeconds` is `slots.holdSeconds` (4 s), times `slots.effectHoldScale` (1.5) for the effect slot and `slots.lingerScale` (2) for the `lingeringEmotions` (sad, sleepy, love, flustered, think). Automatic picks and explicit expressions without a hold of their own use it. A speech lease stays `slots.afterSpeechShare` (0.5) of its hold after its speech ends.
- A neutral that resets the reaction state, and a clear that names no slot, release the hold (`releaseHold`).
- For an explicit expression, the caller reads the entry's lease with `explicitExpressionCommand` and its heaviest emotion mapping with `primaryMapping`, and sends both to the mind. The mind accepts the mapping like an emotion, which can start or escalate an episode, and always holds that emotion for the expression's own slot lifetime.
- With `heldEmotions` off, explicit expressions keep their slot-only behavior.

```ts
import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import { createDecider, defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

const catalog: CatalogEntry[] = []
const decider = createDecider('picker')
let state = decider.initial(42)

// The episode comes from the mind's `emotion` intent.
const result = decider.decide(
  { kind: 'reaction', episode: { id: 'happy-1', emotion: 'happy', nominal: 0.6, intensity: 0.6, band: 'clear', escalation: false }, turnId: 'turn-1', at: 12.5 },
  { catalog, settings: defaultExpressionPerformanceSettings },
  state,
)
state = result.state
// result.decision.slots go to the expression performer. The episode and its hold go to Natural from the mind's intent.
```

Use this entrypoint to pick the entries that show a decided emotion or a named expression, and to compare deciders by replaying a recorded affect trace. To decide the emotion itself, use `@proj-airi/character-mind`.
Do not use it to render, compose parameters, or hold timers. The stage conductor in `@proj-airi/stage-ui` owns clocks and timers, and `@proj-airi/stage-ui-live2d` executes the decisions.
The [expression performance ADR](../../docs/ai/adr/2026-10-18-expression-performance.md) records the contracts.
The [Natural emotion revamp ADR](../../docs/ai/adr/2026-10-19-natural-emotion-revamp.md) records the hold contract.

The `expression-performance/affect-trace-diagnostics` entrypoint holds the Eventa contracts that carry lab affect-trace requests, results, and failure codes between windows (`affectTraceRequestedEvent`, `affectTraceCompletedEvent`, `affectTraceFailedEvent`, `createAffectTraceDiagnosticsContext`). It is separate so the decision entrypoint stays free of a transport and a DOM `BroadcastChannel`.

### Motion scenario

The `motion-scenario` entrypoint owns the input script that motion QA replays at every level (T1 simulated pipeline, T2 headless rig, T3 rendered app):

- `MotionScenarioSchema`, a strict Valibot schema for a versioned scenario with sorted `emotion`, `act`, `mode`, `speech`, `cursor`, `expression`, `placebo`, `noop`, and `marker` events. A scenario whose `levels` include `t3` cannot contain `speech` or `cursor` events;
- `createScenarioPlayer(scenario).eventsBetween(t0, t1)`, which returns the events with `t0 < at <= t1` in scenario order and reads no clock;
- `stripEmotions`, which swaps every `emotion` and `act` event for a `noop` with the same `at` and `trialId`, so a paired null run has the same timeline;
- `settings.host` and `hostProfileViolations`, which declare a host profile and reject each cursor/pointer event when its cursor signal is unavailable, each placement event when its window origin is not live, and every forced mode event. Runners also enforce these restrictions while executing. Stripping emotions preserves the host profile;
- `buildEmotionTrial`, `buildIdleWithPlacebos`, and `buildLongHold`, which build valid scenarios deterministically from their inputs;
- the schemas and Eventa invoke contracts (`eventa:invoke:motion-qa:*`) of the dev-only QA bridge, `createMotionQaContext`, `claimMotionQaHandlers` (one handler set per window), and `createMotionQaDispatcher`, which turns one JSON command string into one JSON reply and never rejects;
- `isMotionQaBridgeEnabled`, also exported alone from `@proj-airi/stage-shared/motion-scenario/flag`, so a caller that guards it with `import.meta.env.DEV` keeps the bridge contracts out of production bundles.

The bridge state includes `performance`, a read-only diagnostic of the last stage resolution: its epoch time, desktop inputs, cursor movement time, and the `away` flag passed to Natural. It does not substitute current store readings for the inputs that produced the reported state.

```ts
import { buildEmotionTrial, createScenarioPlayer, MotionScenarioSchema } from '@proj-airi/stage-shared/motion-scenario'
import { parse } from 'valibot'

const scenario = parse(MotionScenarioSchema, buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed: 1 }))
const pulse = createScenarioPlayer(scenario).eventsBetween(19.9, 20.1)
```

Use this entrypoint to describe, build, and replay QA inputs, and to type the bridge between a QA tool and the app.
Do not use it to run a scenario or to read clocks or randomness: the runners in `@proj-airi/qa-tools` and the app own execution. The bridge contracts do nothing unless the app enables the bridge.

The development bridge also supports experience QA:

- `chatSend`, with `{ text }`, calls the stage window's `useChatStore().send` through the elected leader. This is the real user send path: renderer-local ingestion or direct tool execution would bypass the leader's tools and ACT listener. It returns `{ sent: true }` after the send completes, or a normal bridge error.
- `events`, with `{ sinceSeq? }`, returns `{ events, lastSeq, dropped }` from a window-local ring of at most 512 entries. Sequence numbers start at 1; `sinceSeq` is exclusive and defaults to zero. Entries carry epoch millisecond `time`, `kind`, and scalar `payload` fields whose strings are at most 500 characters. `dropped` counts evictions. A renderer reload starts a new sequence.
- The event kinds are `act`, `expression`, `clip`, `tts`, and `turn`. The stage-ui recorder currently wires parsed ACT signals, applied expression slots, speech playback transitions, and chat turn start/completion. Clip lifecycle recording has no clean shared hook and is omitted. Parsed ACT does not assert that the renderer performed the cue; a speech end can be a gap between sentences.
- `importModelFromInput` additionally accepts `kind: 'live2d' | 'mmd' | 'vrm'` (omitted means Live2D). Live2D/MMD inputs are ZIPs; VRM is a file. The generic display-model importer selects the real model and waits for its renderer to report mounted.

Reply text is development diagnostics only. These commands and their recording subscriptions remain behind the existing development build, remote debug, and motion bridge flags, reached through lazy imports in the Electron startup and shared stage. Production builds must not include them.

### Situation

The `situation` entrypoint owns the pure core of situational presence: observation and state types, the reducer, situation block renderer, urge gate, touch reaction policy, reason sources, and window-title helpers.

- `reduceSituation` folds one `Observation` into a `SituationState`. `advanceSituation` derives the events that need no observation, such as settled app switches, long-session tiers, and expiry.
- `renderSituation` renders the bounded `[Situation HH:MM]` block and returns the ids of the events that it showed as new. Pass them to `markShown`, so the next block does not repeat them.
- `evaluateUrgeGate` integrates a seeded urge against the current hazard, selects an eligible screen event or inner reason, and returns the next gate memory. `recordUrgeFireOutcome`, `recordUrgeUserTurn`, and `recordExternalSpeech` update social state. Only the urge gate exists; `hardReason` in `gate.ts` holds the hard contract that it checks first.
- A `ReturnObservation` (`atMs`, `awayMs`) is the user's return as the character mind decides it. It sets `tracking.lastReturnAtMs` and `tracking.lastAwayMs`, and adds a `returned` event after an absence of at least `RETURNED_AFTER_AWAY_MS` (5 min); an older return is ignored. A `WakeObservation` carries the mind's `awayMs`, and adds a `wake` event unless the span is shorter than 5 min; a `null` span keeps it. A `presence` observation keeps the presence state, the open away span, and `went-away`, but no longer ends a return. The urge gate takes the end of an absence from `lastReturnAtMs` and its length from `lastAwayMs`.
- A `TouchObservation` (a finished pet or a poke) becomes one situation event under `TOUCH_TOPIC_KEY`, which each new touch replaces. Its `New:` line tells the model about the touch, and the urge gate never picks it as a topic.
- A `SelfObservation` reports the start or the end of something the character does on her own (a yawn, a doze, a walk, a sit or a clip-free rest, an unasked clip). The reducer keeps it in `SituationState.self`, never as an event, so the urge gate cannot pick it. `selfLine` renders it as one line of the block, and `selfHint` anchors the own-day reason to it.
- `reactionPolicy` decides whether a touch (a long enough pet, or a burst of pokes) gets a short line, and `settleReaction` records the outcome; a `refused` outcome (another unprompted turn was pending) takes back the attempt's retry wait but not its draw. The policy reads a `TouchVoiceView`, not the situation: `touchVoiceView` builds it right after the touch was reduced, with the touch's event id, its merged pet span or the recent poke times, her last line, and `held`. It never goes through the urge gate: it has its own pacing, takes its roll from the caller's `draw` and never from the gate's checkpoint, and has `reactionHardReason`, a subset of the hard suppressors that skips presence, stale signals, and busy states, which fills `held`.
- `heldTitles` lists the window title and the context titles a `SituationState` holds, and `repeatsHeldTitle` answers whether a text contains one of them whole. Callers use the pair to keep titles out of stored text. A title shorter than `HELD_TITLE_MIN_CHARS` (8) never matches, and matching ignores case and whitespace differences. A `ContextObservation` carries its page or video title as `title`, so no caller parses the context text.
- `unpromptedTopicText` returns the topic text that an unprompted turn stores in its trigger message. For a topic of the web extension (`WEB_EXTENSION_SOURCE`) it returns only the kind of topic; every other text is returned unchanged.
- `normalizeWindowTitle`, `appIdFromExe`, `labelFromExe`, `categorizeApp`, and `isDenylisted` turn a foreground sample into an app id, label, category, and model-facing title. `isBlockedApp` and `isPrivateWindowTitle` decide whether a host must hide a reading before it leaves the main process.

The pure rules read no clock, store, or global randomness. Pass explicit time and retain returned state and memory for the next call; the urge gate takes a `random` source (`() => number`) from the caller and calls it exactly five times per ordinary fire (threshold, category, reason, double-text roll, double-text offset) and never on a hold before the pick, so a `no-topic` hold spends the five draws; `promotionUrgeMemory` draws the first threshold from the same source. `randomSource(seed)` wraps the Mulberry32 helpers `seedRng` and `nextRandom` as such a source. The reaction policy and `acceptReaction` take a `draw` function from the caller, which the character mind's shell owns.

```ts
import { initialSituationState, markShown, reduceSituation, renderSituation } from '@proj-airi/stage-shared/situation'

const nowMs = Date.now()
let state = reduceSituation(initialSituationState, { kind: 'wake', cause: 'unlock', atMs: nowMs }, nowMs)
const rendered = renderSituation(state, nowMs)
state = markShown(state, rendered.shownEventIds, nowMs)
// rendered.text is the block for the next chat request.
```

Use this entrypoint to describe the user's situation to the model, or to decide when an unprompted remark is welcome and which reason to use, in a way that tests can replay.
Do not use it to collect signals or to hold state for a window. `useSituationStore` in `@proj-airi/stage-ui` owns the leader's state, the sensors, and the gate loop.
Do not persist or sync a `SituationState`, because it can hold window titles.
The [situational presence ADR](../../docs/ai/adr/2026-10-19-situational-presence.md) records the situation rules, the [unprompted reach-out cadence ADR](../../docs/ai/adr/2026-10-29-unprompted-reach-out-cadence.md) records the gate and reason design, and the [nonverbal channels ADR](../../docs/ai/adr/2026-10-31-nonverbal-channels.md) records touch, touch affect, the reaction policy, and the conversation register.

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

### Stage world

The `stage-world` entrypoint owns the pure camera calibration (`calibrateCamera`, `worldToDip`, `dipToPlane`) and ground-line helpers (`groundLineOf`, `defaultHomeDipX`, `homeDipToWorldX`, `worldToHomeDipX`) that map work-area DIP to a character's world x. Do not use it for rendering: it imports no `three`, `vue`, or `pinia`, and the `eslint.config.ts` purity block enforces that.

```ts
import { calibrateCamera, groundLineOf, homeDipToWorldX } from '@proj-airi/stage-shared/stage-world'

const calibration = calibrateCamera({ workArea, modelHeight, characterHeightDip: 560, floorRowDip: workArea.height - 8 })
const ground = groundLineOf(workArea, calibration, halfWidthUnits)
const homeX = homeDipToWorldX(calibration, homeDipX, calibration.floorRowDip)
```

World units are model units, right-handed with +Y up: x = `originX` is the work area's left edge (0 unless the caller passes an origin), y = 0 is the floor, and the character stands on z = 0. The camera has zero pitch and an off-axis frustum, so the z = 0 plane maps to the window by a pure scale. `unitsPerDip` is the model height over the character height in DIP, raised when the model would exceed 90 % of the space above the floor. The camera stands `5 * modelHeight` in front of the plane at eye height `0.5 * modelHeight` (`distanceInModelHeights`, `eyeHeightInModelHeights`). Homes are stored as DIP x on the floor row, so they survive a change of character height; convert them with `homeDipToWorldX` and `worldToHomeDipX`. The decision is recorded in [the full-screen stage ADR](../../docs/ai/adr/2026-10-31-fullscreen-stage-and-locomotion.md).

`layoutStageRow` puts every display on one world x axis, left to right by the centre of its work area, with a wing between neighbours that no display shows. Each slot carries its own calibration, ground line, and `visible` range (the root x range in which that display draws some of her). A row of one is the single-display calibration. `stageDisplayFor(row, currentId, rootX, heading)` names the display the stage window should cover; pass the sign of her last movement as `heading`, because inside a wing the root alone cannot tell which neighbour she is walking to. `screenToRowX` maps a screen point to the world x of the display whose work area holds it and returns `null` for dead space; `nearestRowSlot` gives such a point the closest display. `placementRectAt` moves a character rectangle to another root x, on the same camera or on another display's, for the chat anchor at her home.

## Character state

The `character-state` module holds the character's inner state on three clocks: mood (hours), temperament (days), and relationship (weeks to months). The moment layer stays in the Natural motion driver. The pure reducer takes explicit time and returns its memory, so the same events at the same times give the same state. `applyEvent` applies one event, `advance` moves the state to a time, `readCharacter` returns the reading the app uses, and `renderCharacterContext` returns the `system:character` text. The stage-ui character-state store is the app's entry point. Rendered text has no digits, and a resting state renders nothing.

`idleDriveOf` derives what shapes her self-directed idle behaviour from a reading, the time, and the local hour: mood relative to the resting disposition, `sleepinessAt` the hour, and solitude since the last interaction. The stage sends it to the Natural driver; the [idle agency ADR](../../docs/ai/adr/2026-11-12-idle-agency.md) records the rules.

The tuning constants live in `src/character-state/settings.ts`. The [layered character state ADR](../../docs/ai/adr/2026-11-03-layered-character-state.md) lists them with the rules that use them and the known gaps in the starting values.

The `speaker-model` entrypoint pins the CAM++ speaker embedding pack. The renderer and the Electron main process both read it:

```ts
import { speakerModel } from '@proj-airi/stage-shared/speaker-model'
```

## Do not use this package

Keep Electron IPC definitions in the Electron application. Keep UI state and actions in `@proj-airi/stage-ui`. Keep Extension runtime and manifest behavior in `@proj-airi/plugin-sdk`.

Do not add application startup, persistence, or platform-specific side effects here.
