# character-mind-beat-lock - Work Plan

Status: built on 2026-11-21, and every check in section 7 passed on macOS; item 6 was not needed. On 2026-11-21 the owner approved every recommended option, D1 to D7, as [Decisions for the owner](#decisions-for-the-owner) states them, and implementation started. Roadmap row: step CM5b in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Rulings: the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md) (decisions 2, 4, and 8), the [character mind music ADR](../../docs/ai/adr/2026-11-20-character-mind-music.md) (CM5a, which split off this slice), and the [idle agency ADR](../../docs/ai/adr/2026-11-12-idle-agency.md) with its amendments. Branch: `luke/feat/character-mind-beat-lock`, cut from `main` at `bec508cae`, which contains CM5a. The roadmap says a slice starts after a sync: the sync to upstream `bd4f30391` is in progress on `luke/chore/upstream-sync`. Rebase this branch onto `main` after that sync lands, before item 1.

The labels D1 to D7 name the forks in [Decisions for the owner](#decisions-for-the-owner). Each section below is written on the recommended option.

## TL;DR (For humans)

**What changes:** When she grooves to music, her sway keeps time with the song. Today the groove (Natural's `sway` act) rocks at a period drawn between 1.7 and 2.3 s and ignores the music. After this slice, each beat that upstream's beat sync detector hears also reaches Natural, which keeps a small beat clock on its own motion clock. A sway that starts while the clock is locked takes its period from the beat, as the whole number of beats nearest its drawn period (2, 4, or 8 beats per side-to-side cycle), and its head bob lands on the beat. The MMD body plays the same phase. The character mind decides nothing new: it still decides whether and when she grooves (CM5a), and the beat is how Natural realises that groove, the way cursor tracking realises a glance.

**Why:** The roadmap's CM5b row and the idle agency ADR's follow-up "A beat estimate for sway".

**What does not change:** Without beats, every frame is the same as today, on Live2D and MMD, and every existing headless scenario stays `IDENTICAL`. No odds, rate, cooldown, length, or rest of any act changes. The sway's drawn period is still drawn from the same stream, so no seeded draw moves. Beat sync under Universal and MAGIC, its detector, its window, and its settings page stay as upstream ships them. No audio capture starts by itself. No storage key changes.

**Effort:** M. **Risk:** Medium. The new parts are a beat clock with new constants and a phase that crosses into the MMD performer. The feel goes to the motion review backlog; only deterministic checks gate landing.

## 1. Upstream first

`git fetch upstream` on 2026-11-21: `upstream/main` is `bd4f30391` (2026-11-21), the target of the sync in progress. `main` contains upstream through `b3a6d6071`. The 18 upstream commits in `b3a6d6071..bd4f30391` change none of the paths below: not `packages/stage-shared/src/beat-sync/`, not `packages/stage-ui-live2d/`, not `packages/stage-ui/src/components/scenes/`, not the beat sync settings or devtools page or store, not the beat sync window, and not the MMD scene's components or composables (`stage-ui-mmd` changes only constants, a validator, and the `three-mmd` version). Their one `stage-shared` change adds the `./chat-request` and `./terminal-approval` subpaths to `package.json`; CM5b adds no `stage-shared` subpath, so the sync and this slice do not touch the same lines.

| Upstream has | Code | What CM5b does with it |
| --- | --- | --- |
| The beat sync detector: `tempora` 0.4.0-alpha.1's analyser over captured system audio. Each beat event is `{ energy, interval }`, where `interval` is the seconds since the previous detected beat on the worklet's audio clock (`timeSinceLastBeat` in `tempora`'s `worklet.mjs`). It carries no timestamp. The fork's defaults loosen detection (`warmup`, `spectralFlux`, and `adaptiveThreshold` off), so beats include misses and extras | `packages/stage-shared/src/beat-sync/` (`detector.ts`, `settings.ts`), `listenBeatSyncBeatSignal` | Adopted unchanged. CM5b reads `interval` for the first time; CM5a dropped the payload |
| A BPM reporter in `tempora` (`createBPMReporter`, the `reportBPM` option of `startAnalyser`) | `tempora`'s `index.mjs`; unused by the detector | Not adopted. It reports a tempo, not a phase, and it runs inside the detector, so using it would change upstream's detector and add a cross-window contract |
| The beat sync controller: an average of beat intervals clamped to 220 to 2000 ms (`avgInterval`, weights 0.7 and 0.3), which springs the head toward per-beat targets as each beat arrives, on `performance.now`. It predicts nothing | `packages/stage-ui-live2d/src/composables/live2d/beat-sync.ts` `createBeatSyncController` | Unchanged. It is Vue-reactive and runs on the wall clock, so Natural cannot sample it (render-loops skill). Under Natural it stays `silent` (CM5a) |
| The Live2D model's listener, which schedules each beat on that controller under every driver | `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` (`listenBeatSyncBeatSignal(() => beatSync.scheduleBeat())`) | Unchanged. **Changed:** one line in the exposed scene object forwards `beat` to the fork's Natural adapter, beside the fork's `idle` and `idleCue` lines |
| The Live2D scene's exposed methods | `packages/stage-ui-live2d/src/components/scenes/Live2D.vue` | **Changed:** one `beat` line beside the fork's `idle` line |
| The MMD scene's exposed methods | `packages/stage-ui-mmd/src/components/scenes/MMD.vue` | **Changed:** one `beat` line beside the fork's `idle` line. Upstream ships no beat sync for MMD |
| The stage scene, which attaches to the fork's mind store | `packages/stage-ui/src/components/scenes/Stage.vue` | **Changed:** the `attachStage` call gains `beat`, beside `idle` and `idleCue` |

Nothing upstream sways a character to the beat under Natural: Natural, its `sway` act, the MMD act form, the mind store, and the conductor are fork code. The ledger in `docs/ai/context/upstream-policy.md` changes its existing Beat sync row (section 8).

## 2. Today's code

- **The groove.** The mind's idle policy draws the `sway` act only while it hears music (CM5a). `NaturalIdleActivities.start` (`packages/motion-driver-natural/src/idle-activities.ts`) draws the act's length (8 to 16 s), its period (`clip.period = between(1.7, 2.3)`), and its tone from the order's seed. `sample` plays it at `phase = 2π · age / clip.period`: the head yaws and rolls once per cycle, the head pitch bobs twice per cycle (`sin(2 · phase)`, "once per beat, twice per sway"), and the body turns and rolls once per cycle, all under a 1.5 s trapezoid envelope.
- **The MMD form.** The performer's act layer (`packages/motion-driver-humanoid/src/performance/acts.ts`, `case 'sway'`) plays the same offsets at the MMD units from the record (`BodyIdleAct.period`), at `2π · age / period` on the performer's own seconds, which start at the tick it sees the record's new `seq`.
- **What crosses to MMD.** `MMDBodyIntent` (`packages/stage-ui-mmd/src/composables/mmd/body/intent.ts`) maps `NaturalBodyIntent` once per display frame and blends continuous values across the ticks of a frame. `breath.phase` is the precedent for a phase: it is unwrapped against the previous frame and blended, so a tick never blends across the seam.
- **The beats.** `MindMusic` (`packages/stage-ui/src/composables/performance/mind-music.ts`) subscribes to `listenBeatSyncBeatSignal` only while the window leads and turns beats into music edges on `Date.now`. Its `listen` option hands `onBeat` no payload. No beat reaches Natural.
- **How a mind intent reaches Natural.** The mind store sends each idle intent to every attached `MindStage`; the conductor forwards it to the scene only under Natural (`useStagePerformanceConductor.idle`); the Live2D and MMD adapters queue it (`pendingIdleOrders`) and hand it to the controller at the next frame on the adapter's motion time; the controller calls `advance(nowSeconds)` and applies it at the next grid step (1/120 s of active time).
- **Headless.** The `music` scenario (`packages/qa-tools/src/t2-3d/scenarios.ts`) tells the runner's mind that music plays; seed 1 over 600 s draws two sways, at 315.87 s and 497.72 s (CM5a's record). No scenario sends beats.

## 3. The design

### 3.1 The split: the mind decides, Natural realises on its clock

| Decided by the mind, on its clock and source (unchanged since CM5a) | Realised by Natural, on its active clock |
| --- | --- |
| Whether she hears music (`music` stimulus, `MindState.music`) | The beat clock: a period and a phase from the detected beats, stamped at Natural's grid steps |
| Whether a hazard fire picks the groove, and the order's seed | Whether a starting sway binds to the beat (the clock is locked at the sway's start) |
| Nothing about single beats: no beat enters `step` | The sway's period (a whole number of beats near its drawn period) and its phase (the bob's low point on the beat) |
| | The MMD form's phase, read from Natural each frame |

The mind never sees a beat (D1). A beat is a perceptual input like the cursor position: the character mind ADR's decision 2 gives the mind the episode and the performer the per-frame tracking. This keeps Autonomous behavior Target rule 6 ("no decider moves the body on beats outside the mind"): a beat moves her only inside a groove the mind decided, and decides nothing itself.

### 3.2 The beats' path (D2)

```text
beat sync window ──BroadcastChannel──▶ leader window
  MindMusic (listen, while leading) ──▶ music edges ──▶ mind            (CM5a, unchanged)
                                    └─▶ onBeat({ intervalSeconds }) ──▶ every attached MindStage.beat
                                          ──▶ conductor.beat: only under Natural ──▶ scene.beat
                                          ──▶ adapter queue ──▶ controller.beat(intervalSeconds, motion time)
                                          ──▶ stamped at the next grid step's active time
```

- `MindMusic` gains an `onBeat` option and passes each beat's `interval` through, converted once to `intervalSeconds`. The store's one subscription serves both the music edges and the fan-out, and only while the window leads: stages render only in the leader (CM5a D10).
- Beats are not filtered by the foreground app. A quiet app blocks music, so no groove is drawn, and a beat outside a groove changes no frame.
- The conductor drops beats under Universal, MAGIC, and classic. There, upstream's beat sync still gets every beat through `Model.vue`, as today.
- The adapters queue a beat like an idle order and hand it to the controller on their motion time at the next frame (render-loops skill: an event from outside the loop starts its effect at the frame). The controller stamps it at the next grid step's active time. No `performance.now()` or `Date.now()` value reaches the clock.
- A suspended controller (paused, hidden page, another driver) drops beats and clears the clock, because its active time stops while the song goes on.

### 3.3 The beat clock (`packages/motion-driver-natural/src/beat-clock.ts`, new)

```ts
/** Pure; plain JSON. Times are seconds of Natural's active time. */
export interface BeatClockState {
  /** The estimated beat length in seconds; null before enough intervals. */
  readonly beatSeconds: number | null
  /** Active time of the latest predicted beat the clock is anchored on; null while unlocked. */
  readonly anchor: number | null
  /** The last accepted intervals, newest last, at most `BEAT_HISTORY`. */
  readonly intervals: readonly number[]
  /** Onsets in a row that landed near a predicted beat; locked at `BEAT_LOCK_ONSETS`. */
  readonly hits: number
  /** Onsets in a row that did not; at `BEAT_LOCK_ONSETS` the clock re-anchors. */
  readonly misses: number
  /** Active time of the latest accepted onset; null before one. */
  readonly lastOnset: number | null
}

export declare const initialBeatClock: BeatClockState
/** Applies one onset stamped at `at`, with the detector's `intervalSeconds`. */
export declare function advanceBeatClock(state: BeatClockState, onset: { at: number, intervalSeconds: number }): BeatClockState
/** The clock's beat at `at` while it is locked: the beat count since the anchor (whole at each predicted beat) and its length. */
export declare function beatAt(state: BeatClockState, at: number): { beats: number, beatSeconds: number } | null
```

Rules, with first values (feel review on the backlog; the constants are named and sourced in the code):

- **Tempo range.** A beat is 0.33 to 1.0 s (180 to 60 BPM). An `interval` outside it is doubled or halved into range when one fold does it, else ignored. The first `interval` after a pause is meaningless (it counts from the previous run) and falls out of range.
- **Period from the detector's `interval`.** The beat length is the median of the last 8 accepted intervals (`BEAT_HISTORY`). `interval` is a duration on the audio clock, so it carries none of the jitter of the trip through the BroadcastChannel, the mind store, and the frame queue; it is a duration, not a time of day, so it does not break the render-loops rule. Arrival spacing would carry that jitter.
- **Phase from arrivals on Natural's clock.** An onset within ±0.2 beat of a predicted beat is a hit: the anchor moves by 0.3 of the error, a first-order phase-locked loop in the manner of an adaptive oscillator (Large and Kolen 1994, "Resonance and the perception of musical meter", Connection Science 6(2-3)). Any other onset is a miss and moves nothing, so the loose detector's extra beats are ignored.
- **Lock.** Four hits in a row (`BEAT_LOCK_ONSETS`) lock the clock. Four misses in a row re-anchor it on the latest onset and unlock it. A clock with no accepted onset for 1.8 s of active time (the value of `MUSIC_RELEASE_MS`, upstream's `releaseDelayMs`) unlocks.
- **Latency (D6).** Beats arrive after the sound by the detector's envelope, the worklet quantum, and the trip to the stage. `BEAT_LEAD_SECONDS` moves the predicted beat earlier by that delay. It starts at 0; rendered step 2 measures the delay, and item 6 sets it.
- **Octave errors.** The loose detector may lock to half or double the tempo. The sway's period rule below absorbs it: a sway takes the number of beats nearest its drawn period, so the cycle length stays near 2 s either way.
- Non-finite values and an onset earlier than the last accepted one change nothing.

### 3.4 The sway on the beat

- **Binding at the start (D3).** When a `sway` starts and `beatAt` returns a beat, the clip binds: it takes `k`, the beats per cycle, from {2, 4, 8} as the multiple whose `k · beatSeconds` is nearest the clip's drawn period, the smaller one on a tie (D4). `k` stays for the whole clip, so a tempo drift never doubles her speed mid-sway. A sway that starts unbound stays unbound and plays exactly as today. Music needs 8 s of beats before the mind can draw a groove, and the clock locks after four, so a mind-drawn groove almost always starts bound.
- **Phase.** A bound clip's target phase is `φ* = 2π · beats / k + 3π/4`. At `beats` = 0, `k/2`, `k`, … the bob term `sin(2φ)` is at its low point, so her head dips on the beat every `k/2` beats (D5). The side-to-side turn takes `k` beats.
- **No steps.** The clip keeps its own phase `φ`, advanced each grid step at the clock's rate plus `(φ* − φ) / 0.25 s`, wrapped to the nearest turn, so a clock correction never moves the head in one step. At the bind, `φ` starts at `φ*`; the envelope is 0 with zero slope there, so the start shows no jump.
- **Losing the beat mid-sway.** When `beatAt` returns null, the clip keeps advancing `φ` at its last rate until it ends. When the clock locks again, `φ` eases to the new `φ*`.
- **Unchanged shape.** The head and body terms, their amplitudes, the envelope, the tone, the length, and the release are today's. Only the phase source changes, and only for a bound clip. An unbound clip computes `2π · age / clip.period` in closed form, as today, so frames without beats stay bit-identical.
- **The record.** `IdleBehaviourRecord` keeps its fields and its drawn `period`; it is a diagnostics contract and the start-time fact. What a host needs per frame goes in the body intent (3.5).
- **The observer.** A bind emits `{ kind: 'groove-lock', at, beatSeconds, beatsPerCycle }` to the controller's observer, so headless runs record a marker and rendered runs a motion QA event.

### 3.5 The MMD body (`motion-driver-humanoid`, `stage-ui-mmd`)

```ts
/** The new member of `NaturalBodyIntent.idle` (frame-types.ts). */
export interface NaturalIdleIntentGroove {
  /** The bound sway's phase in radians, while it contributes; null otherwise. */
  readonly groovePhase: number | null
}

/** The new member of `BodyPerformanceInput` (performance/contracts.ts): the same value, blended across the ticks of a display frame. */
export interface BodyPerformanceInputGroove {
  readonly groovePhase: number | null
}
```

- `MMDBodyIntent.capture` stores `groovePhase` unwrapped against the previous frame, as it stores `breath.phase`, and `tick` blends and wraps it. A null value is not blended.
- The act layer's sway form uses `input.groovePhase` when it is a number and its closed form `2π · age / record.period` otherwise. A bound sway publishes its phase from its first step to the end of its release, so the form never switches source mid-sway. Without beats the value is always null, and every MMD trace stays the same.
- This departs from the CM5a plan's outline, which put the beat clock `{ at, period }` in the body intent for the form to compute the phase. The performer's seconds start at a different tick from Natural's active time, so the form would have to map clocks; a phase needs no clock, as the breath shows.

### 3.6 Headless

- A new scenario `music-beat`: the `music` scenario (the `idle` timeline, the QA drive, `music: true`, 60 s by default, 600 s allowed) plus `beats: { bpm: 120, jitterSeconds: 0.02, seed }`. The runner computes beat times from the scenario's seed (uniform jitter, one beat in ten dropped, one extra off-beat in ten), and at each beat's frame calls `MMDNaturalAdapter.beat(intervalSeconds)`, the production path, with the interval of the scripted, unjittered tempo plus its own jitter.
- The clock draws nothing, so `music-beat` draws its sways at the same times as `music` for the same seed. The runner records Natural's `groove-lock` observer event as a `groove:lock` marker. The `music` scenario stays as it is and must stay `IDENTICAL`.

## 4. Where the code lives

| Path | Change |
| --- | --- |
| `packages/motion-driver-natural/src/beat-clock.ts` (new), `beat-clock.test.ts` (new) | The beat clock [1] |
| `packages/motion-driver-natural/src/idle-activities.ts`, `idle-activities.test.ts` | Binding, the clip's phase, the observer event's source [2] |
| `packages/motion-driver-natural/src/natural-motion.ts`, `frame-types.ts`, `intent.test.ts` | `beat(intervalSeconds, nowSeconds)`, the clock cleared on suspend, `idle.groovePhase`, the `groove-lock` event [2] |
| `packages/motion-driver-natural/README.md` | The beat input [2] |
| `packages/motion-driver-humanoid/src/performance/contracts.ts`, `acts.ts`, the acts test | `groovePhase`, the sway form [3] |
| `packages/stage-ui-mmd/src/composables/mmd/body/intent.ts`, its test | Maps and blends `groovePhase` [3] |
| `packages/stage-ui-mmd/src/composables/mmd/natural/adapter.ts`, its test | `beat` queue [3] |
| `packages/qa-tools/src/t2-3d/scenarios.ts`, `scenarios.test.ts`, `runner/run.ts`, `runner/run.test.ts`, `README.md` | `music-beat`, scripted beats, the `groove:lock` marker [4] |
| `packages/stage-ui/src/composables/performance/mind-music.ts`, `mind-music.test.ts` | `onBeat` with `intervalSeconds` [5] |
| `packages/stage-ui/src/stores/character-mind.ts`, `character-mind.test.ts` | `MindStage.beat`; the fan-out [5] |
| `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts`, its test | `beat` under Natural only; the scene's `beat?` [5] |
| `packages/stage-ui/src/components/scenes/Stage.vue` (upstream file) | `beat` in `attachStage` [5] |
| `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts`, its test | `beat` queue [5] |
| `packages/stage-ui-live2d/src/components/scenes/Live2D.vue`, `live2d/Model.vue` (upstream files) | Expose `beat` [5] |
| `packages/stage-ui-mmd/src/components/scenes/MMD.vue` (upstream file) | Expose `beat` [5] |
| `packages/stage-ui/src/composables/performance/use-motion-qa-events.ts`, `packages/stage-shared/src/motion-scenario/` | The `groove-lock` QA event [5] |

Nothing is deleted. The fork adds no Eventa contract and no cross-window traffic.

## 5. Work items

Each item is one commit that passes `pnpm verify`.

1. **`feat(motion-driver-natural): add the beat clock`.** Section 3.3. Nothing calls it yet.
2. **`feat(motion-driver-natural): lock the groove's sway to the beat clock`.** Sections 3.4 and the Natural half of 3.5. Docs `[2]`.
3. **`feat(motion-driver-humanoid,stage-ui-mmd): play the groove's beat phase on the MMD body`.** The rest of section 3.5 and the MMD adapter's `beat` queue.
4. **`feat(qa-tools): add a music-beat scenario to the headless motion runs`.** Section 3.6. Docs `[4]`.
5. **`feat(stage-ui,stage-ui-live2d,stage-ui-mmd,stage-shared): send detected beats to Natural's groove`.** Section 3.2. This is where the app's groove starts to follow the beat. Docs `[5]`.
6. **`feat(motion-driver-natural): lead the beat clock by the measured beat latency`**, only if D6 is taken and rendered step 2 measures a median delay over 20 ms. The commit body records the measurement. Skipped otherwise, and the plan's departures say so.
7. **`docs(ai): record the beat lock decisions and close CM5b`.** The ADR and the roadmap, marked `[7]`. Last, after the checks in section 7 pass.

**Order:** 1 to 7. Items 1 to 4 change no app behavior: no beat reaches Natural in the app until item 5.

## 6. Tests (Node, seeded, no Vue)

The render-loops skill asks for explicit time inputs, and for both clocks wherever one clock starts an effect and another samples it.

- **`beat-clock.test.ts`.** A seeded source builds onset sequences: 60, 90, 120, 150, and 180 BPM; ±20 ms jitter; one beat in ten dropped; one extra off-beat in ten.
  - The clock locks within 4 beats after its first in-range interval, and not before.
  - After the lock, the phase error at each true beat stays under 30 ms (RMS over 60 beats at 120 BPM), and the period error under 1 %.
  - Off-beat onsets move nothing; four misses in a row re-anchor.
  - A tempo step from 120 to 128 BPM keeps the lock and converges within 8 beats; a step to 90 BPM unlocks, then locks again.
  - An interval of half or double the beat folds into range.
  - No onset for 1.8 s unlocks; non-finite values and onsets earlier than the last change nothing; the state round-trips through JSON.
- **`idle-activities.test.ts`.**
  - Without beats, a sway's samples at fixed times equal the closed form exactly, and a seeded order draws the same length, period, and tone as before, so no stream moved. The `character-mind` idle tests, including the groove's long-run rate pin, pass unchanged.
  - A sway started on a locked clock binds with the `k` of the rule for drawn periods 1.7, 2.0, and 2.3 s at 60, 120, and 180 BPM.
  - The bob's low points fall within 30 ms of the true beats every `k/2` beats.
  - A sway started on an unlocked clock never binds, even when the clock locks mid-sway.
  - Beats lost mid-sway: the phase keeps its rate, with no step. The existing speed test (no head or body channel faster than 6 units per second) covers a bound sway, a tempo step, a lost beat, and an interruption.
- **`intent.test.ts`** (Natural). `beat` is applied at the next grid step on active time; a suspended controller drops it and clears the clock; `groovePhase` is null without a bound sway and through a bound sway's release it is a number; one `groove-lock` event per bind.
- **`stage-ui-live2d` `natural-motion/observer.test.ts`.** The golden hashes stay pinned, unchanged, computed under Node.
- **Two clocks.** The Live2D adapter test drives the adapter with frame times that stall (a 100 ms frame and a hidden-page pause) and checks that each beat is stamped at Natural's grid step after the frame that received it, not at the time it was sent.
- **MMD.** The acts test: the sway form with `groovePhase` null equals today's output; with a phase, it follows it. The intent test: `groovePhase` blends across ticks and never across the seam.
- **`stage-ui`.** `mind-music.test.ts`: `onBeat` gets `intervalSeconds` for each beat while started, nothing while stopped. `character-mind.test.ts`: beats reach every attached stage only while leading, and none after a demotion. The conductor test: `beat` reaches the scene only under Natural.
- **`qa-tools`.** `scenarios.test.ts` registers `music-beat` and its beats; `run.test.ts`: the scripted beat times are a pure function of the seed, and the runner sends them through the adapter.

## 7. Rendered and motion checks

- **Each commit:** `pnpm verify`. Inner loops:
  - `pnpm -F @proj-airi/motion-driver-natural exec vitest run src/beat-clock.test.ts src/idle-activities.test.ts src/intent.test.ts`
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion/observer.test.ts`
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance/mind-music.test.ts src/stores/character-mind.test.ts src/composables/performance/use-stage-performance-conductor.test.ts`
  - `pnpm -F @proj-airi/qa-tools exec vitest run src/t2-3d/scenarios.test.ts src/t2-3d/runner/run.test.ts`
- **The branch:** `pnpm verify --gate`. It runs the smoke, `pnpm qa:test:model`, and `pnpm qa:motion3d affected`. This is a frame-loop change, so run `pnpm perf status` before and after.
- **Headless rigs.** `pnpm qa:live2d-rig` prints the same trace hash as at the base: its runner sends no beats.
- **Headless motion.** Run `pnpm qa:doctor` first. Use a clean base worktree, `pnpm wt new cm5b-base --base <branch base> --branch luke/tmp/cm5b-base --qa`, and remove it afterward with `pnpm wt rm cm5b-base`.
  - At the base and the tip: `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario <name> --seed 1 --out <dir>` for `idle`, `idle-drive` and its `--acts off` companion, `sleepy-no-clip`, and `music` with `--seconds 600`. Pass: `pnpm qa:motion3d diff` prints `IDENTICAL` for every block of each. Any difference stops the work until its cause is found.
  - At the tip: `music-beat`, seed 1, `--seconds 600 --verify-determinism`. Pass: its `idle:sway:start` markers have the same times as `music`'s; each is followed by a `groove:lock` marker at the same frame with `beatsPerCycle` 4 at 120 BPM. A one-off script under `.temp/cm5b/` (not committed) reads both traces and reports two things. First, the frames outside the sway windows and their releases are equal to `music`'s. Second, the head pitch minima of each bound sway fall at the scripted beats, every 2 beats, with the median and largest error recorded.
  - Reports, each end on its own code: `pnpm lab:motion3d report idle-acts <idle-drive run> --pair <acts-off run>` and `pnpm lab:motion3d report rest <sleepy-no-clip run>`. Pass: every line reads the same status at both ends. Never retune a gate or a report to make a run pass.
  - Required wording for the PR: "Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review."
- **Rendered check.** CM5a's driver was not kept. Rebuild it under `.temp/cm5b/driver.ts` (not committed) as the CM5a plan's section 8 describes: the HTTP verb server with `AppSessionCore`, the replay LLM server, the warning collector, and page-side evaluation over CDP. `musicOn({ bpm })` runs a second detector in the beat sync window over a looping synthetic kick track into the private sink. New verbs: `idlePlay(kind)`, which asks the mind for a requested act through the conductor (the lock does not depend on the mind's music, so a requested sway is a fair test of it); and `sampleHead(seconds)`, which samples the Natural head pitch inside the frame. Start with `pnpm qa:display up --name cm5b --private-audio`, run with `pnpm qa:display run --name cm5b -- node --import tsx .temp/cm5b/driver.ts`, and stop with `pnpm qa:display down --name cm5b`. The driver prints no model path; it reads `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`.
  1. **Natural, Live2D rig.** Run `musicOn` at 90, 120, and 150 BPM, then wait for `music: true`, then call `idlePlay('sway')`. Pass at each tempo:
     - one `groove-lock` event with `beatSeconds` within 2 % of `60 / bpm`, and `beatsPerCycle` by the rule for the record's drawn period;
     - head pitch minima spaced `k/2` beats apart within 5 %.
  2. **Latency.** Over 60 beats at 120 BPM, compare each beat's arrival in the stage window (`performance.timeOrigin + performance.now()`) with its onset in the beat sync window: the AudioContext time of the scheduled kick, mapped through `getOutputTimestamp()`. Both windows run on one machine, on one epoch. Record the median and p95; they set `BEAT_LEAD_SECONDS` in item 6 (D6).
  3. **Losing the beat.** Call `musicOff()` during a bound sway. Pass: no error, and the largest head step per frame is no larger than during the bound part.
  4. **No music.** `idlePlay('sway')` gives no `groove-lock` event, and the sway's head pitch period is the record's drawn period.
  5. **A mind-drawn groove.** With music on, within 900 s, a `sway` intent from the mind and its `groove-lock`. If none comes, record the step as not exercised; step 1 and the headless `music-beat` cover the lock.
  6. **Universal.** Call `setLive2dDriver('universal')`, then `musicOn`. Pass: beat sync moves the head as in CM5a's step 2, and no `groove-lock` event comes in 120 s.
  7. **MMD on the desktop stage.** Steps 1 and 4 with `AIRI_QA_MMD_MODEL`, with one screenshot during a bound sway for the PR.

  Every launch: 0 renderer and 0 main-process errors.
- **Feel.** Do not judge the groove by eye. Record a motion review backlog item through `/vault-sync`: the commit range, the date, the changed paths, the headless scenario and seed, and the tempos of the rendered steps.
- The PR description records the run directories, the diff blocks, the report lines at both ends, the one-off measurements, and the event excerpts (kinds, counts, and times; no content).

## 8. Docs that move with the code

Policy docs change in the commit that makes their statement false. Run `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after each policy doc edit.

- **`docs/ai/context/glossary.md`** [5]: Groove: "it does not follow the beat yet" becomes the lock rule (bound at the start, `k` beats per cycle, the bob on the beat, as before without beats). A new term, **Beat clock**, with its code. Beat sync: its beats also reach Natural's beat clock under Natural.
- **`docs/ai/context/autonomous-behavior.md`** [5]: the Groove row's realiser and inputs name the beat clock; Precedence rule 19 adds the fan-out (while leading, under Natural only, deciding nothing); Target rule 6's sentence says a beat moves her only inside a groove the mind decided.
- **`docs/ai/context/body-ownership.md`** [5]: the Live2D rule "A groove is Natural's offset" adds that its phase follows Natural's beat clock; the MMD side says the act form reads `groovePhase`.
- **`docs/ai/context/upstream-policy.md`** [5]: the Beat sync row adds that under Natural the mind store also hands its beats to Natural's beat clock. No new departure from upstream code.
- **READMEs:** [2] `packages/motion-driver-natural/README.md`: the beat input and the bound sway. [4] `packages/qa-tools/README.md`: `music-beat`. [5] `packages/stage-ui/README.md`: the mind store hands beats to its stages while it leads.
- **ADR** [7]: `docs/ai/adr/<date>-character-mind-beat-lock.md` records D1 to D7 as ruled. It closes the idle agency ADR's follow-up "A beat estimate for sway". ADR bodies are history, so the idle agency ADR is not edited; the new ADR says it closes the follow-up, and the roadmap row cites it.
- **`docs/ai/context/character-mind-roadmap.md`** [7]: the CM5b row shows done with its PR and ADR. The Feature and tuning row "The groove's beat lock, length, and rate in daily use" waits for nothing after CM5b merges.
- **Nested guidance.** `packages/stage-ui-live2d/AGENTS.md` stays true ("nothing but Natural writes head angles"). No agent configuration changes are expected.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| The loose detector reports speech, a podcast, or a busy mix as irregular beats | The clock locks only on four consistent onsets; an unlocked clock leaves the sway as it is today. The quiet categories still block music |
| The detector locks to half or double the tempo | The sway takes the number of beats nearest its drawn period, so its cycle stays near 2 s either way; the bob then lands on every second beat or on every beat |
| The bob trails the sound by the pipeline delay | Rendered step 2 measures it; item 6 leads the clock by the median (D6). Audio-visual offsets where the sound leads are detectable from about 45 ms (ITU-R BT.1359-1) |
| BroadcastChannel and main-thread jitter shake the phase | Only the phase uses arrival times, through a loop gain of 0.3 and a 0.25 s lag in the clip; the period comes from the audio-clock `interval` |
| A clock correction or a lost beat steps the head | `φ` never steps (3.4); the speed test bounds every channel; rendered step 3 |
| A hidden page or a paused stage keeps a stale lock | A suspended controller clears the clock |
| The phase crossing into MMD changes MMD traces without beats | `groovePhase` is null without a bound sway, and the form keeps its closed form; the four existing scenarios must diff `IDENTICAL` |
| Two stages in the leader | Each has its own clock fed with the same beats, stamped on its own time, so both lock to the same tempo |
| The beat fan-out costs frame time | One queue push per beat (about 2 per second) and a few operations per grid step during a sway; `pnpm perf status` before and after |
| New constants (range, history, tolerance, gain, lock count, lag) are first values | Pinned by Node tests against seeded sequences. Their feel is a review on the backlog, never a gate |

## 10. Follow-ups this plan does not do

- Groove length and rate in daily use, and ending a groove on a bar line. That is tuning, after CM5b.
- A per-machine latency calibration, if rendered step 2 shows the delay differs between hosts.
- A `groove-lock` report in `lab:motion3d` (D7), if the feel review asks for a scored phase.
- The beat lock on VRM, which joins through the M5 adapter.
- Listening by default, which stays the owner's privacy question (CM5a).

## Must not do

- Do not send a beat, a beat time, or a tempo to the character mind, and do not make the mind decide anything about the lock.
- Do not change the sway's shape terms, amplitudes, envelope, length, or drawn ranges, or any act's odds, rate, cooldown, or rest, and do not retune a report or gate line to make a run pass.
- Do not stamp a beat with `performance.now()` or `Date.now()`; only the adapters' motion time and Natural's active time reach the clock.
- Do not edit upstream's detector, beat sync controller, motion-manager plugins, beat sync window, or settings and devtools pages, and do not change beat sync under Universal or MAGIC.
- Do not start an audio capture or beat sync by default.
- Do not add an Eventa contract or cross-window traffic.
- Do not edit the body of an existing ADR.
- Do not commit a model path or any other local path.

## Done when

A sway that starts while Natural's beat clock is locked takes its period and phase from the detected beat, sampled on Natural's clock, on Live2D and MMD. Without beats every existing headless scenario diffs `IDENTICAL`, the observer hashes and the Live2D rig hash are unchanged, and a sway without beats plays as before. The mind decides nothing new. The CM5b ADR closes the idle agency ADR's follow-up "A beat estimate for sway". The roadmap shows CM5b done, and every check in section 7 passes.

## Decisions for the owner

Each fork lists its options, the trade-off, and the recommendation. The plan above is written on the recommendations.

| # | Fork | Options | Trade-off | Recommendation |
| --- | --- | --- | --- | --- |
| D1 | What the mind decides | (a) Nothing new: beats are a realisation input of the groove the mind already decides, like cursor tracking for a glance. (b) The mind's `idle-act` order for a sway carries a choice, such as "follow the beat" or "drift", drawn from mood or energy | (a) keeps the mind at event rate and adds no state, no draw, and no intent field; every groove follows the beat when one is locked. (b) gives her a way to ignore the music when tired or low, but it adds a draw that moves the idle stream's seed, so every headless `music` diff changes, and it is a feel question nobody has asked for yet | (a) |
| D2 | How beats reach Natural | (a) The leader's mind store hands each beat from its one subscription (`MindMusic`) to its attached stages, and the conductor forwards it only under Natural. (b) Each scene subscribes to `listenBeatSyncBeatSignal` itself, as `Model.vue` already does for upstream's controller | (a) keeps one subscription per window and the leader-only rule, and it gates by driver in one place. It routes a non-decision through the mind's store, though the store only passes the beat on. (b) is fewer lines, but it adds a beat sync import to MMD, runs in follower windows, and duplicates the driver gate in each scene | (a) |
| D3 | When a sway binds to the beat | (a) Only at its start: a sway that starts unbound stays free. (b) At any time: a free sway locks mid-way when the clock locks | (a) never switches the MMD form's phase source mid-sway and keeps unbound sways bit-identical to today. Music needs 8 s of beats before a groove, and the clock locks after four, so a mind-drawn groove almost always starts bound. (b) also catches a sway played from the lab before the lock, but it needs a phase hand-over on both renderers | (a) |
| D4 | Beats per side-to-side cycle | (a) `k` from {2, 4, 8}, the multiple nearest the sway's drawn period: today's ~2 s look, with the bob every `k/2` beats (every 2 beats at 120 BPM). (b) Always 2: a turn per beat and a bob per beat, which is a 1 s cycle at 120 BPM. (c) A new shape: a bob on every beat, independent of a slower side cycle | (a) changes no shape, keeps the drawn period's variety, and absorbs the detector's octave errors. It reads as a relaxed half-time groove. (b) reads livelier, but it doubles her speed on most songs and inherits every octave error. (c) is a new shape rule that needs its own visual tuning | (a) |
| D5 | What lands on the beat | (a) The head bob's low point (she nods down on the beat). (b) The trunk's side extreme | (a) matches how listeners nod, and the bob is the most visible beat-rate term on both renderers. (b) puts the slower side term on the beat, which reads less clearly at `k` = 4 | (a) |
| D6 | The beat's arrival delay | (a) Measure it in rendered step 2, then lead the clock by the median when it is over 20 ms: one sourced constant. (b) No compensation | (a) keeps the bob on the sound on the measured machine. The delay may differ on other hosts, so one constant can be wrong there (follow-up). (b) leaves the bob late by the whole pipeline delay, which is likely above the ~45 ms at which a late picture is noticed | (a) |
| D7 | Headless evidence for the lock on MMD | (a) The `music-beat` scenario, Node tests of the phase, and a one-off, uncommitted measurement of the bob minima against the scripted beats. (b) A new `lab:motion3d` report rule, `groove-lock` | (a) proves the lock reaches the MMD body and that nothing else moved, at no process cost. (b) gives a re-runnable scored verdict, but a report rule needs sealed labelled cases, injected faults, and its own version commit (testing guide), for a check that does not gate | (a) |

Nothing else blocks CM5b. The CM5a vetoes still open (its D1 to D14) and listening by default stay with the owner. CM5b assumes CM5a's D2 (beat sync is the one detector) and D14 (the MMD groove is a body offset); a veto of either would change this plan.

## Departures during implementation

1. **Item 6 is skipped (D6).** Rendered step 2 measured the delay from the audio onset to the beat's arrival in the stage window at a median of about 9 ms: detection 8.5 ms after the onset (p95 16.6 ms), and arrival 0.5 ms after detection (p95 3.6 ms). That is under the 20 ms that starts item 6, so `BEAT_LEAD_SECONDS` stays 0.
2. **The checks ran on macOS, without a QA display.** On Linux, Electron exited at launch. The synthetic kick needs no private sink here, because the detector never connects to the audio destination.
3. **The driver pinned the desktop idle time,** as CM5a's did. On an unattended desktop she went away and slept, and the requested sways never played.
4. **The driver sent lab requests on its own BroadcastChannel.** A page does not receive its own channel's posts, so the override store's `requestIdle` called in the stage window never reached the stage.
5. **The detector's first beat comes about 23 s after the kick starts,** while its threshold history fills, and the music edge 8 s after that. A step must wait for the edge before it requests a sway.
6. **`music-beat` outside the sways.** Every root and channel frame equals `music`'s. Some arm and hand rotations differ by at most 0.55 degrees for up to about 10 s after each sway ends, because the arm springs settle from a different end phase. The plan's release window of 0.4 s is too short to cover that settling.
7. **Step 5 was not run.** Step 1 and the headless `music-beat` cover the lock.

## Checks run

- **Headless, base `bb576288a` against tip `ee3237170`, seed 1:** `idle`, `idle-drive`, `idle-drive --acts off`, `sleepy-no-clip`, and `music --seconds 600` are `IDENTICAL` on every block.
  - `pnpm qa:live2d-rig` gives the same trace hash at both ends.
  - The `idle-acts` and `rest` reports read the same status on every line at both ends.
- **`music-beat`, seed 1, 600 s, determinism verified:**
  - Both sways start at the same times as in `music`, 315.9 s and 497.7 s, and each has a `groove:lock:4` marker on its start frame.
  - The head's low points fall 2.05 and 1.99 beats apart, median, against the expected 2.
  - Against the true beats, their error has a median of 23 and 27 ms and a maximum of 59 and 71 ms.
- **Rendered, Live2D rig, Natural, classic window:**
  - At 90, 120, and 150 BPM, each requested sway bound on its start frame: `beatSeconds` 60/BPM exactly, `beatsPerCycle` 4, and head pitch minima 2.00 beats apart.
  - Step 2: the delay above.
  - Step 3: stopping the music mid-sway gave no error, and the largest head step per frame after it was 0.64, against 1.30 in the bound part.
  - Step 4: no lock, and the sway's head pitch minima 0.85 s apart.
  - Step 6: under Universal, no `groove-lock` in 120 s.
- **Rendered, MMD on the desktop stage:** a lock at all three tempos and none without music. A screenshot was taken during a bound sway at 120 BPM.
- Every launch had 0 renderer and 0 main-process errors.
- **The required wording:** "Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review."

## Commits

- `99563ff3b` docs(plan): add the plan for the beat lock slice of the character mind
- `42ba281bb` docs(plan): record the owner's approval of the beat lock decisions
- `31a85a20b` feat(motion-driver-natural): add the beat clock
- `bd6ac7cba` feat(motion-driver-natural): lock the groove's sway to the beat clock
- `d609c834f` feat(motion-driver-humanoid,stage-ui-mmd): play the groove's beat phase on the MMD body
- `e87bfea4c` feat(qa-tools): add a music-beat scenario to the headless motion runs
- `ee3237170` feat(stage-ui,stage-ui-live2d,stage-ui-mmd,stage-shared): send detected beats to Natural's groove
