# character-mind-music - Work Plan

Status: done on 2026-11-20; PR not merged. Roadmap row: step CM5 in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Rulings: the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md) (decisions 2, 4, 7, and 8), the [core ADR](../../docs/ai/adr/2026-11-18-character-mind-core.md), the [slow state ADR](../../docs/ai/adr/2026-11-19-character-mind-slow-state.md), the [idle ADR](../../docs/ai/adr/2026-11-20-character-mind-idle.md), and the [idle agency ADR](../../docs/ai/adr/2026-11-12-idle-agency.md) with its amendments. Branch: `luke/feat/character-mind-music`, cut from CM4b's tip `754e30da1` on `luke/feat/character-mind-idle` (PR #58). CM4b stacks on CM4a (#57, which also carries step S's commits from #56), CM3b (#53), CM3a (#52), CM2 (#51), and CM1 (#47), none merged. The PR's base is `luke/feat/character-mind-idle`. When a PR below merges, rebase this branch onto the new base and retarget the PR.

The owner is away and runs these slices without a plan review. Every design fork below is taken on the recommended option and listed in [Decisions open to the owner's veto](#11-decisions-open-to-the-owners-veto).

**Split (D1).** CM5 splits into CM5a, planned here in full, and CM5b, outlined in [section 10](#10-cm5b-in-outline). CM5a meets the whole roadmap Done-when: one detector, music as a stimulus of the mind, the groove decided by the mind, and beat sync silent under Natural. It changes no shape and no constant. CM5b makes the groove follow the beat. That needs a new shape rule and a visual review, which the owner's motion review backlog handles asynchronously, so it should not hold back the structural slice.

## TL;DR (For humans)

**What changes:** Under Natural, one music detector exists: upstream's beat sync detector. Its beats reach a small pure detector in the leader's mind store. The store tells the character mind when music starts and stops (a `music` stimulus), and the mind's idle policy draws her groove, Natural's existing `sway` act, only while it hears music. The level-based `resolveMusic` over system audio and the `music` field of Natural's idle drive are deleted. Beat sync's two head plugins keep running their springs under Natural but write nothing, so Natural is the only writer of her head angles. Under Universal and MAGIC, beat sync works exactly as upstream ships it.

**Why:** Autonomous behavior Target rule 6 ("Music is a stimulus") and Body ownership Target rule 2 for grooves. Today beat sync's `pre` plugin springs the Live2D head angles under every driver, and Natural overwrites them afterward (overlap 1). Two detectors answer the same audio with no shared state: the system-audio level sets the idle drive's `music`, and beat sync's beats move the head (overlap 2).

**What does not change:** No odds, weight, cooldown, rest, hazard, act shape, or beat sync constant. The groove still sways at its drawn period, as it does today; following the beat is CM5b. No audio capture starts by itself: the user starts beat sync from its settings page, as today. No storage key changes. Universal, MAGIC, and classic receive no new intents.

**Effort:** M. **Risk:** Medium. The behavior change is the detector: music now counts from detected beats instead of the system-audio level (D3). Everything else is a move that headless runs prove neutral with `IDENTICAL` motion blocks.

## 1. Upstream first

Read from the tree at `754e30da1`. `upstream/main` is `b3a6d6071`, which the stack already contains, so no newer upstream commit touches these paths.

| Upstream has | Code | What CM5a does with it |
| --- | --- | --- |
| The beat sync detector: a `tempora` beat analyser over captured system audio, with `toggleBeatSync`, `listenBeatSyncBeatSignal`, and `listenBeatSyncStateChange` | `packages/stage-shared/src/beat-sync/` | Adopted unchanged. It becomes the one music detector; CM5a reads its beats through `listenBeatSyncBeatSignal` |
| A hidden background window that runs the detector in the desktop app, toggled over a BroadcastChannel | `apps/stage-tamagotchi/src/main/windows/beat-sync/`, `apps/stage-tamagotchi/src/renderer/beat-sync.main.ts` | Unchanged |
| The beat sync settings page (start and stop, parameters, spectrum) and the devtools page | `packages/stage-pages/src/pages/settings/modules/beat-sync.vue`, `packages/stage-pages/src/pages/devtools/beat-sync.vue`, `packages/stage-ui/src/stores/settings/beat-sync.ts` | Unchanged. Its Start is now also how the mind hears music under Natural (D9) |
| The beat sync controller and its two motion-manager plugins (`pre` springs the head; `layer` adds the beat on a manual pose) | `packages/stage-ui-live2d/src/composables/live2d/beat-sync.ts`, `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts` `useMotionUpdatePluginsBeatSync` | The controller is unchanged. **Changed:** `motion-manager.ts`, where the fork's `isBeatSyncLayered` becomes `beatSyncMode` and the `pre` plugin writes nothing under Natural (overlap 1). `motion-manager.test.ts` gains the cases |
| The Live2D model that registers the plugins and listens for beats | `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue` | **Changed:** one line passes `beatSyncMode` instead of `isBeatSyncLayered` |
| System-audio lipsync, started from the Live2D motion devtools page | `packages/stage-ui/src/stores/system-audio-lipsync.ts`, `apps/stage-tamagotchi/src/renderer/features/live2d/system-audio-lipsync.ts` | Unchanged. It stops being a music source, because `resolveMusic` is deleted; the watching mode still reads its level (D11) |
| The stage scene | `packages/stage-ui/src/components/scenes/Stage.vue` | **Changed:** the fork's lines that run `resolveMusic` go, and the pastime occasion reads the mind's music |
| `media.getNowPlaying` and media controls of the computer-use tool | `apps/stage-tamagotchi/src/renderer/components/chat-tool-renderers/computer-use/media.ts` | Not a sensor: it renders a model tool's result. Untouched |

Nothing upstream decides idle acts, grooves, or music under Natural. The ledger in `docs/ai/context/upstream-policy.md` changes its existing beat sync row and settles the beat sync entry of "Decisions to revisit".

## 2. Today's code

**Two music detectors, both off in daily use.**

- **The level detector.** `resolveMusic` (`packages/stage-ui/src/components/scenes/idle-music.ts`) counts music when the system-audio level stays above 0.1 for 8 s (`MUSIC_SETTLE_MS`), outside game, call, and chat apps, and not while she speaks. `Stage.vue` polls it once a second through the conductor (`music` option of `useStagePerformanceConductor`), which puts it in the idle drive (`NaturalIdleDrive.music`); `activeOccasions` reads the same value for the `music` pastime occasion. The level comes from `useDesktopActivityProducerStore` (`systemAudioLevel`), which reads `useSystemAudioLipSyncStore` of its own window. That store gets a driver only on the Live2D motion devtools page (`apps/stage-tamagotchi/src/renderer/pages/devtools/live2d-motion.vue`), so the level is `null`, and music false, unless that page runs in the stage's window and its capture was started.
- **The beat detector.** Beat sync's detector runs in the hidden beat sync window after the user presses Start on the beat sync settings page, and broadcasts each beat (`{ energy, interval }`) to every window. Nothing persists the switch; every launch starts with it off.

**The consumers.**

- **Natural's sway.** Since CM4b the mind's idle policy draws every act. `idleActivityWeights` (`packages/motion-driver-natural/src/idle-schedule.ts`) weighs `sway` only while `drive.music` is true, and the mind reads the drive from Natural's reported view (`IdleView.drive`). So the music bit travels detector, conductor, scene, Natural, view report, mind. Natural itself never reads `music`: the sway's shape (`NaturalIdleActivities` `sample`, 8 to 16 s, period drawn 1.7 to 2.3 s) ignores the music, and the MMD performer's sway form (`packages/motion-driver-humanoid/src/performance/acts.ts`) follows the record's period.
- **Beat sync on Live2D.** `Model.vue` schedules each beat on the controller (`listenBeatSyncBeatSignal(() => beatSync.scheduleBeat())`) under every driver. The `pre` plugin springs `ParamAngleX`, `ParamAngleY`, and `ParamAngleZ` toward the controller's targets every frame under every driver, also with no beats (the targets then rest on the base angles). The `layer` plugin adds the beat offset after a manual pose, only when `isBeatSyncLayered` (manual pose active and driver not Natural). Under Natural, `Live2DNaturalMotionAdapter` `composePosture` overwrites the head at full posture weight in the wrapped `updateFocus`, so the `pre` write survives only while the posture weight is below 1 (manual control or a spring easing posture out).
- **Occasions.** `resolveOccasions` names `music` from the same bit; `useIdleProps` reads occasions only at a pastime start and for diagnostics.
- **The MMD director and classic MMD.** Neither reads music or beats. Upstream ships no beat sync for MMD, so classic MMD has none.
- **The performance resolver.** `resolvePerformanceState` counts a system-audio level above `WATCHING_SYSTEM_AUDIO_LEVEL` (0.1) as desktop activity for the `watching` mode. That is attention, not a music decision (D11).
- **The headless runners.** No `qa:motion3d` scenario sets music: every QA drive has `music: false`, so no headless run has ever drawn a sway. The Live2D rig installs no beat sync plugin and sets no idle drive.

## 3. The design

### 3.1 The split: the mind decides, the frame samples

| Decided by the mind, on its clock and source | Realised by Natural on its grid, or by upstream's plugins |
| --- | --- |
| Whether she hears music: a `music` stimulus from the one detector, kept in `MindState.music` | The groove's shape: the `sway` act, from the order's seed, at its drawn period (CM5b adds the beat) |
| Whether a hazard fire picks the groove: `sway` weighs above 0 only while the mind hears music | The groove's head and body offsets, weighted by its envelope and release gain inside Natural's idle layer |
| Nothing about single beats | Under Universal and MAGIC: beat sync's controller and plugins, as upstream ships them |

The mind never sees a beat. CM5a sends no beat to Natural either. Beat phase enters Natural only in CM5b, where the frame samples it on its own clock.

### 3.2 The one detector

The detector is upstream's beat analyser (D2). A pure fork module turns its beats into music edges, as `resolvePerformanceState` turns desktop samples into return edges (the CM2 precedent).

```ts
/** packages/stage-shared/src/music/index.ts (new, subpath `@proj-airi/stage-shared/music`). Pure; plain JSON. */
export interface MusicMemory {
  /** The first beat of the current run of beats, in epoch milliseconds of the caller's clock; null while none runs. */
  readonly sinceMs: number | null
  /** The latest beat of the run; null while none runs. */
  readonly lastBeatAtMs: number | null
  /** Whether the run counts as music. */
  readonly playing: boolean
}

/** One thing the host saw: a beat, the deadline timer, or a change of the foreground app. */
export interface MusicObservation {
  atMs: number
  beat: boolean
  /** The foreground app's category, or null on a host that cannot tell. */
  category: AppCategory | null
}

export declare const initialMusicMemory: MusicMemory
/** Applies one observation. `edge` is the change of `playing` it caused, or null. */
export declare function advanceMusic(memory: MusicMemory, observation: MusicObservation): { memory: MusicMemory, edge: 'started' | 'stopped' | null }
/** The next time at which `playing` can change without a new beat: the settle end or the release. Null while no run. */
export declare function nextMusicDeadline(memory: MusicMemory): number | null
```

Rules (D3):

- A run of beats is music once it has lasted `MUSIC_SETTLE_MS` (8 s, moved unchanged from `idle-music.ts`) with no gap longer than `MUSIC_RELEASE_MS`.
- A gap longer than `MUSIC_RELEASE_MS` (1.8 s, the value of upstream's `releaseDelayMs` default, after which beat sync lets go of the head) ends the run, and a later beat starts a new one.
- A game, call, or chat app in front (`QUIET_CATEGORIES`, moved unchanged) ends the run and ignores beats while it stays in front.
- Her own speech no longer pauses the answer. No act or errand starts while she talks, and occasions are read only at a pastime start, so the old `speaking` term changed no decision.
- Times run on the caller's clock. A beat's time is its arrival; `AnalyserBeatEvent` carries no timestamp.

### 3.3 Music in the mind

```ts
/** The new member of `MindStimulus` (character-mind's types.ts): the detector's edge. */
export interface MusicStimulus {
  kind: 'music'
  playing: boolean
}

/** `MindState.music`: fast state, so it resets at launch and at a card switch. Plain JSON. */
export interface MindMusicState {
  playing: boolean
}

/** What the idle schedule's pick reads beside the performer's view (idle-schedule.ts). */
export interface IdleContext {
  /** Whether the mind hears music: the groove weighs above 0 only then. */
  music: boolean
}

export declare function advanceIdleSchedule(state: IdleScheduleState, view: IdleView, context: IdleContext, at: number, seconds: number, random: RandomStream): { state: IdleScheduleState, decision: IdleDecision | null }
```

- **`answerMusic`** (new `packages/character-mind/src/music.ts`) sets `state.music.playing`, draws nothing, and yields no intent. Like every stimulus, the step first brings the idle clock up to `nowMs` under the old music state, so a decision that fell due before the edge is taken as it would have been.
- **The schedule.** `idleActivityWeights` reads `context.music` in place of `drive.music`, with the same expression. `nextIdleDeadline` keeps its signature: no rate reads music, so music never moves a deadline, and the mind store's idle wake stays exact.
- **The groove (D6, D7).** The groove episode is the `sway` act, decided by the mind's draw while it hears music, with today's odds. Its kind keeps the name `sway`; "groove" becomes the glossary term for the episode.
- **Stimulus order.** A `music` stimulus that reaches a mind before its first `idle` report draws nothing, so the idle stream's seed, which the first `idle` stimulus draws, does not move. A test pins this, because the headless identity proof in item 4 depends on it.

### 3.4 Hosting the detector

```ts
/** packages/stage-ui/src/composables/performance/mind-music.ts (new). */
export interface MindMusicOptions {
  /** Subscribes to the one detector's beats and returns the unsubscribe; the app passes `listenBeatSyncBeatSignal`. */
  listen: (onBeat: () => void) => () => void
  /** The leader's foreground category (`useSituationStore` `foregroundCategory`). */
  category: () => AppCategory | null
}

export declare class MindMusic {
  constructor(mind: CharacterMind, options: MindMusicOptions)
  /** Subscribes to beats and starts deciding edges; the store calls it at promotion. */
  start(): void
  /** Unsubscribes, clears the deadline timer, and, if music was playing, tells the mind it stopped. */
  stop(): void
  /** Feeds a change of the foreground app. */
  observeCategory(): void
  /** After a mind reset, tells the new state that music plays, if it does. */
  replay(): void
}
```

- **The store** (`useCharacterMindStore`) creates one `MindMusic` and runs it only while the window leads (D10), from `startLeading` to `stopLeading`, guarded by `isBeatSyncSupported()`. It watches `foregroundCategory` and calls `observeCategory`. `loadAndConnect` calls `replay` after `mind.reset`, as it re-sends the reported idle view.
- **The deadline timer.** `MindMusic` arms one timer at `nextMusicDeadline` and feeds a `beat: false` observation when it fires, as the store arms the idle wake at `nextIdleWakeAt`. An edge becomes `mind.receive({ kind: 'music', playing })`.
- **`Stage.vue`** loses `musicPlaying`, `musicMemory`, and `musicNow`. `activeOccasions` reads `characterMindStore.mind.state.music.playing`. The conductor's `music` option goes; until item 5 its drive sends `music: false`.
- **QA events.** `use-motion-qa-events.ts` records a `mind` step whose stimuli include `music`, and the `mind` event gains `music: boolean | null` (the edge's `playing`), appended to the event shape, so a rendered check can tell a start from a stop.
- **Other drivers.** Under Universal and MAGIC the reporting view is dormant, so the mind hears music and decides nothing. Beat sync still runs there as upstream ships it. Classic MMD has no Natural and no beat sync.

### 3.5 Beat sync under Natural (overlap 1)

```ts
/** motion-manager.ts: replaces the fork's `isBeatSyncLayered`. */
export type BeatSyncMode = 'absolute' | 'layered' | 'silent'

/** `silent` under Natural; `layered` while a manual pose holds the head; `absolute` otherwise. */
export declare function beatSyncMode(manualPoseActive: boolean, driver: Live2DMotionDriver): BeatSyncMode

export declare function useMotionUpdatePluginsBeatSync(beatSync: BeatSyncController, mode: () => BeatSyncMode): { pre: MotionManagerPlugin, layer: MotionManagerPlugin }
```

Under `silent`, the `pre` plugin still advances the controller (`updateTargets`) and the offset springs and copies their velocities into the absolute springs, as the `layered` branch already does, then returns without writing. The `layer` plugin adds nothing. The controller's state stays bounded, and a switch to Universal in the middle of a song does not kick the head (D8). `absolute` and `layered` behave as upstream's plugin does today. `Model.vue` keeps listening for beats under every driver, as upstream ships it.

### 3.6 Body ownership rule 2 for grooves

After item 2, nothing but Natural writes the Live2D head angles under Natural, and the groove is Natural's `sway` act: its head and body offsets enter posture through the idle layer's output, weighted by the act's trapezoid envelope and its release gain (`NaturalIdleActivities` `sample`). On MMD the performer's act form plays the same offsets at the MMD units. This lands Body ownership Target rule 2 for grooves. The expression head tilt part of rule 2 stays in Target: `composePosture` still overwrites it at full weight (D13).

The MMD shape of the groove, which the character mind ADR leaves open, is settled as a body offset, the performer's existing `sway` form. Dance clips stay requests that the director realises; music starts none (D14).

### 3.7 The headless runner

The MMD runner already drives idle through a mind. A scenario gains an optional `music: true`, and the runner then sends `{ kind: 'music', playing: true }` to its mind before the first frame. Item 1 adds the `music` scenario first with today's mechanism (a drive with `music: true`), so item 4 can prove the move with `IDENTICAL` motion blocks against item 1's run (D12).

## 4. Where the code lives

| Path | Change |
| --- | --- |
| `packages/qa-tools/src/t2-3d/scenarios.ts`, `idle-drive.ts`, `scenarios.test.ts` | The `music` scenario and its drive [1]; the `music` field [4]; no `music` in the drives [5] |
| `packages/qa-tools/src/t2-3d/runner/run.ts` | Sends `music` to its mind [4] |
| `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts`, `motion-manager.test.ts`, `components/scenes/live2d/Model.vue` | `beatSyncMode`, the silent branch [2] |
| `packages/stage-shared/src/music/index.ts` (new), `index.test.ts` (new), `package.json` | The detector and its subpath [3] |
| `packages/character-mind/src/music.ts` (new), `types.ts`, `step.ts`, `idle.ts`, `index.ts` | The stimulus, `MindState.music`, the schedule context [4] |
| `packages/motion-driver-natural/src/idle-schedule.ts` | `IdleContext`, weights read it [4]; `sameIdleDrive` without `music` [5] |
| `packages/motion-driver-natural/src/idle-activities.ts` | `NaturalIdleDrive` without `music` [5] |
| `packages/stage-ui/src/composables/performance/mind-music.ts` (new) | `MindMusic` [4] |
| `packages/stage-ui/src/stores/character-mind.ts` | Runs `MindMusic` while leading; `replay` after reset [4] |
| `packages/stage-ui/src/components/scenes/Stage.vue`, `idle-music.ts`, `idle-music.test.ts` | Drops the level detector; the occasion reads the mind [4] |
| `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` | No `music` option [4]; no `music` in the drive [5] |
| `packages/stage-ui/src/composables/performance/use-motion-qa-events.ts`, `packages/stage-shared/src/motion-scenario/` | The `mind` event's `music` field [4] |
| `packages/stage-shared/src/character-state/types.ts` | The comment that lists `music` among the drive's host fields [5] |

## 5. What is deleted

- `packages/stage-ui/src/components/scenes/idle-music.ts` and its test, `musicPlaying` and its memory in `Stage.vue`, and the conductor's `music` option [4].
- `isBeatSyncLayered` [2].
- `NaturalIdleDrive.music` and every fixture value of it [5].

After item 5, `git grep -nE "resolveMusic|idle-music|musicPlaying|isBeatSyncLayered|drive\.music" -- packages apps` prints nothing, and `git grep -n "music" packages/motion-driver-natural/src/idle-activities.ts` prints only the sway's shape comments, if any.

## 6. Docs that move with the code

Policy docs change in the commit that makes their statement false; the work item is in brackets. Run `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after each policy doc edit.

- **`docs/ai/context/autonomous-behavior.md`**:
  - [2] The Beat sync row: both plugins write nothing under Natural (`beatSyncMode`). Overlap 1 leaves Known overlaps and its row leaves the Target table.
  - [4] The Idle activity row: the groove is drawn only while the mind hears music. A new Deciders row, **Groove**: detector, stimulus, mind, and realiser, with hosts. A new Precedence rule 19, appended so rules 1 to 18 keep their numbers: one music detector, its rule, the leader-only host, and beat sync silent under Natural. Target rule 6 reads "Landed as Precedence rule 19", as rule 3 does. Target rule 2's sentence about a beat says music gets one response. Overlap 2 leaves Known overlaps and its row leaves the Target table.
  - [5] Rule 4's drive sentence, if it names `music`.
- **`docs/ai/context/body-ownership.md`**:
  - [2] The Live2D head angles row, the Natural driver row, the per-frame order (`pre` writes nothing under Natural), and the rule "The beat-sync layer stays off under Natural", which becomes "Beat sync writes nothing under Natural". A new Live2D rule: a groove is Natural's offset. Target rule 2 notes that it holds for grooves and stays for expression tilts.
  - [6] The known gap "No ADR records the beat-sync layer departure" leaves with the ADR.
- **`docs/ai/context/glossary.md`**:
  - [2] Beat sync: both plugins under Universal and MAGIC only.
  - [4] A new term, **Groove**. Beat sync: its detector is the one music detector. Stimulus: fourteen kinds, with `music`; the target sentence keeps a cursor notice and chat events. Idle activity, Character mind.
  - [5] Drive, and the Conflicting usage "Drive": six required fields.
- **`docs/ai/context/upstream-policy.md`**:
  - [2] The "Beat sync layer" row becomes "Beat sync": both plugins write nothing under Natural; Revisit: not planned.
  - [4] The row adds that under Natural its beats feed the character mind's music detector.
  - [6] "Decisions to revisit" loses the beat sync row and says CM5 settled it; "These three remain" becomes two.
- **`docs/ai/context/character-mind-roadmap.md`** [6]: the CM5 row splits into CM5a, done, and CM5b, not started, with the amendment sentence the CM3 and CM4 splits used; CM7 depends on CM5a; the L row says CM5 settled beat sync; the Feature and tuning table gains "The groove's beat lock, length, and rate in daily use", waiting for CM5b.
- **READMEs:**
  - [1] `packages/qa-tools/README.md`: the `music` scenario.
  - [2] `packages/stage-ui-live2d/README.md`: the posture precedence paragraph names beat sync's silence under Natural.
  - [3] `packages/stage-shared/README.md`, if it lists subpaths: `music`.
  - [4] `packages/character-mind/README.md`: the stimuli table. `packages/stage-ui/README.md`: the mind store hears music while it leads.
  - [5] `packages/motion-driver-natural/README.md`: the drive example. `packages/stage-ui-live2d/README.md`: the idle drive paragraph.
- **ADR** [6]: `docs/ai/adr/2026-11-20-character-mind-music.md` (or the date it is written) records D1 to D14 as taken or vetoed. It settles the character mind ADR's open question on the groove's MMD shape, records the beat sync departure that only a code comment recorded, and clarifies decision 4: the beat sync detector does not go away under Natural; it becomes the one detector, and only its writer goes. Existing ADR bodies are not edited.
- **Nested guidance.** `packages/stage-ui-live2d/AGENTS.md` says upstream's beat sync layer runs under Universal and MAGIC only, but its `pre` plugin writes under Natural today. If the line still misleads after item 2, fix it in a `chore(agents)` commit of its own in this PR.

## 7. Work items

Each item is one commit that passes `pnpm verify`.

1. **`feat(qa-tools): add a music scenario to the headless motion runs`.** The `music` scenario: the `idle` timeline, 60 s by default (600 s allowed), and the drive `qa-neutral-day-music`, which is `QA_IDLE_DRIVE` with `music: true`. Docs `[1]`. Tests: `scenarios.test.ts` registers it, and its drive's provenance names it.
2. **`feat(stage-ui-live2d): keep beat sync off the head under Natural`.** Section 3.5. Docs `[2]`. Tests (`motion-manager.test.ts`, node project):
   - Under Natural the `pre` and `layer` plugins write no head angle over a scheduled beat pattern.
   - The controller's state stays bounded while silent.
   - After a switch from Natural to Universal in a pattern, the first written angle continues the spring rather than jumping from the base angle.
   - The existing Universal and MAGIC cases pass unchanged.
3. **`feat(stage-shared): add the music detector over beat sync beats`.** Section 3.2. Nothing calls it yet. Docs `[3]`. Tests (Node, explicit times):
   - Music starts at the beat that completes 8 s and at the settle deadline when beats continue.
   - A gap over 1.8 s ends the run at its deadline, and a later beat starts over.
   - A quiet category ends and blocks the run; `null` counts as not quiet.
   - `nextMusicDeadline` is null with no run.
   - A clock that steps back never starts music.
4. **`feat(motion-driver-natural,character-mind,stage-ui,stage-shared,qa-tools): make music a stimulus of the character mind`.** Sections 3.3, 3.4, and 3.7. Docs `[4]`. Tests:
   - `character-mind/src/music.test.ts`: a `music` stimulus draws nothing and yields nothing; before the first `idle` report it leaves the idle seed unchanged; the groove is drawn only while the mind hears music; `MindState` round-trips through JSON; a reset clears music.
   - `idle-schedule.test.ts`: "sways only while music plays" reads the context.
   - `idle.test.ts`: a long-run case pins the groove's share of acts per hour with music on, with the four-Poisson-deviation bound the other rate pins use, measured at this commit.
   - `mind-music.test.ts`: beats become one `music` start at the settle point and one stop at the release; the timer fires at `nextMusicDeadline`; `stop` stops music; `replay` re-sends after a reset.
   - The store test: only the leader subscribes; a demotion stops music.
   - The conductor test loses its `music` cases.
   - The runner sends the stimulus before the first frame.
   - The stage-shared `motion-scenario` event test covers the appended field.
5. **`refactor(motion-driver-natural,stage-ui,qa-tools): drop music from the idle drive`.** Section 5. Docs `[5]`. Tests: the fixtures lose the field; `sameIdleDrive` compares six fields and the options; `idle-acts.test.ts` and the `rest` report's `drive` line compare the six-field values.
6. **`docs(ai): record the music decisions and close CM5a`.** The ADR, the roadmap, the known gap, and the ledger's Decisions to revisit, marked `[6]`. Last, after the checks in section 8 pass.

The optional `chore(agents)` commit of section 6 goes between items 2 and 6. **Order:** 1, 2, 3, 4, 5, 6. Item 2 is independent of the rest. Item 4 is where the app's music source changes.

## 8. Checks

- **Each commit:** `pnpm verify`. Inner loops:
  - `pnpm -F @proj-airi/stage-shared exec vitest run src/music/index.test.ts`
  - `pnpm -F @proj-airi/character-mind exec vitest run src/music.test.ts src/idle.test.ts`
  - `pnpm -F @proj-airi/motion-driver-natural exec vitest run src/idle-schedule.test.ts src/idle-activities.test.ts`
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance/mind-music.test.ts src/stores/character-mind.test.ts src/composables/performance/use-stage-performance-conductor.test.ts`
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/motion-manager.test.ts`
  - `pnpm -F @proj-airi/qa-tools exec vitest run src/t2-3d/scenarios.test.ts`
- **Policy docs:** `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts`, by name, after each policy doc edit and at the tip.
- **The branch:** `pnpm verify --gate --base luke/feat/character-mind-idle`.
- **Smoke on both hosts.** `.env.qa` is not in this worktree; create it there (it is ignored) or export `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`.
  - `pnpm qa:display run -- pnpm qa:smoke`
  - `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"`
- **Headless rigs.** `pnpm qa:live2d-rig` passes with the same trace hash as at `754e30da1`: its runner installs no beat sync plugin and sets no idle drive. `pnpm qa:test:model` passes.
- **Headless motion.** Two base worktrees, both clean, removed afterward with `pnpm wt rm <name>`:
  - `pnpm wt new cm5-base --base 754e30da1 --branch luke/tmp/cm5-base --qa`, for `idle`, `idle-drive`, its `--acts off` companion, and `sleepy-no-clip`.
  - `pnpm wt new cm5-music-base --base <item 1 commit> --branch luke/tmp/cm5-music-base --qa`, for `music`, because no music scenario exists at `754e30da1`.
  - Runs: `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario <name> --seed 1 --out <dir>` at each end; `music` with `--seconds 600`. Add `--verify-determinism` to the tip's `music` and `idle-drive` runs. If the `music` run at item 1 has no `idle:sway:start` marker, sweep seeds 2 to 6 at both ends and use the first seed whose item-1 run has one.
  - After item 4: `pnpm qa:motion3d diff` prints `IDENTICAL` for every block of `idle`, `idle-drive`, and `sleepy-no-clip` against `754e30da1`, and for `rot`, `root`, `channels`, and `events` of `music` against item 1; `detail` of `music` differs only by its provenance (the drive's values and the music field).
  - At the tip: `IDENTICAL` for every block of `idle`; for `idle-drive`, `sleepy-no-clip`, and `music`, every block but `detail` is `IDENTICAL`, and `detail` differs by the six-field drive. Any other difference stops the work: find its cause before going on.
  - Reports, each end on its own code (the `drive` lines compare against the running tree's QA constants): `pnpm qa:motion3d report idle-acts <idle-drive run> --pair <acts-off run>` and `pnpm qa:motion3d report rest <sleepy-no-clip run>`. Pass: every line reads the same status at both ends. Record each `sleep-onset` delay. If a status flips, run a seed sweep (seeds 2 to 6 at both ends) and record it; never retune a gate or a report to make a run pass (motion QA skill).
  - Required wording for the PR: "Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review."
- **Rendered check.** A driver under `.temp/cm5/` (not committed), modeled on `.temp/cm4b/driver.ts`: an HTTP verb server with `AppSessionCore`, the replay LLM server, the warning collector, and page-side evaluation over CDP. Start a session with audio, then run the driver in it: `pnpm qa:display up --name cm5 --private-audio`, then `pnpm qa:display run --name cm5 -- node --import tsx .temp/cm5/driver.ts`. Stop with `pnpm qa:display down --name cm5`. The driver prints no model path. Verbs: `launch`, `stop`, `eventsSince`, `setLive2dDriver`, `errors`, `screenshot`, and two new ones:
  - `musicOn({ bpm })` attaches to the beat sync window's CDP target (`beat-sync.html`). There it imports `@proj-airi/stage-shared/beat-sync` through the dev server's module URL, creates a second detector with `createBeatSyncDetector`, and starts it with a synthetic source instead of a screen capture: a looping `AudioBufferSourceNode` of 60 Hz kick pulses (80 ms, decaying) at `bpm`. Its `beat` events go out through `defineInvoke(createContext(), beatSyncBeatSignaledInvokeEventa)`. The tempora analysis, the broadcast channel, the store, the detector, and the mind are the product's; only the capture is replaced. It must run in the beat sync window, not the stage window: the stage window's eventa context shares one BroadcastChannel object, which never receives its own posts.
  - `musicOff()` stops the synthetic detector.

  This is the analogue of CM2's fake ScreenSaver. A real capture cannot run here: on Wayland, `desktopCapturer.getSources` opens the portal picker. No media-session sensor exists, so no fake MPRIS player is needed. `--private-audio` gives the AudioContext a sink (the null sink `airi_qa`), and nothing reaches the user's speakers. If the synthetic detector cannot start (an AudioContext that stays suspended in the hidden window), send scripted `{ energy, interval }` beats on the same invoke from that window at `bpm`, and record the departure: the analysis is then not exercised.
  1. **Natural, classic window, Live2D rig from `AIRI_QA_RIG_FORBOOTH`.**
     - Launch without music. Pass: no `mind` event with a `music` stimulus in 120 s.
     - `musicOn({ bpm: 120 })`. Pass: one `mind` event with `music: true`, between 8 s and 10 s after the first beat the store saw.
     - Within 900 s, a `posture/idle-act` intent with `act: 'sway'` and the next `idle` start naming `sway`. If none comes, record the step as not exercised and rely on the headless `music` scenario. Do not use the lab's requested play, which bypasses music.
     - `musicOff()`. Pass: one `mind` event with `music: false`, between 1.8 s and 3 s after the last beat.
  2. **Universal.** `setLive2dDriver('universal')`, then `musicOn`.
     - Pass: `mind` events still carry `music`, and for 120 s no `idle-act` or `idle-errand` intent appears.
     - Pass: beat sync moves the head. Page-side samples of the model's `ParamAngleY` over 10 s, read from the Live2D scene as the motion devtools page reads it, swing by more than 2 degrees with peaks about one beat apart. If the driver cannot reach the model from the page, take two screenshots half a beat apart and record the check as visual.
  3. **Natural again.** Switch back during music. Pass: no error, and the head shows no jump in a screenshot series at 10 Hz over 2 s. Overlap 1 itself is proven by item 2's tests: Natural's full-weight overwrite hides the `pre` write in a rendered frame.
  4. **MMD on the desktop stage**, with `AIRI_QA_MMD_MODEL`. Pass: `musicOn` gives `music: true`, and within 900 s a `sway` intent and its `idle` start, with a screenshot during the sway for the PR; `musicOff` gives `music: false`. If no sway comes, record the step as not exercised.

  Every launch: 0 renderer and 0 main-process errors.
- Record the run directories, the report lines at both ends, the diff blocks, and the event excerpts (kinds, counts, and times; no content) in the PR description.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| She hears music only after the user starts beat sync, and on Wayland every start opens the portal picker | The same holds today for both detectors: the level path needs the devtools capture. CM5a starts no capture by itself (D9). Whether she should listen by default is a privacy question for the owner (see Blocked) |
| The beat detector, with upstream's loosened parameters, reads speech or a podcast as beats, so she grooves to talk | Today's level detector counted any audio outside quiet apps. The quiet categories stay. Recorded as part of D3; real-audio evidence needs the owner's ears, so it goes on the motion review backlog |
| The detection change (D3) is a timing change that no headless run sees | Node tests pin the rule; rendered step 1 measures the start and stop latency on a known click track |
| `listenBeatSyncBeatSignal` throws on an unsupported environment | `MindMusic` starts only when `isBeatSyncSupported()` |
| Importing the beat sync module pulls `tempora`'s worklet URL into Node tests of the store | `MindMusic` takes `listen` as an option; the store test passes a fake, and the store module imports the real listener only for the app |
| Two invoke handlers for beats in the stage window (`Model.vue` and the store) | `@moeru/eventa` 0.3.0 keeps a handler per function for each event, and each runs (`defineInvokeHandler` in `node_modules/@moeru/eventa/dist`); the beat window takes the first answer |
| A mind reset at a card switch forgets that music plays | `loadAndConnect` calls `replay`, as it re-sends the idle view |
| The headless identity proof breaks because the `music` stimulus shifts a draw | Item 4's test pins that `music` draws nothing and leaves the idle seed; a diff that moves stops the work |
| A switch from Natural to Universal mid-song kicks the head | The silent branch keeps the springs moving (item 2's test; rendered step 3) |

## 10. CM5b in outline

**What lands:** the groove follows the beat. Natural takes beat onsets as a frame-sampled input and keeps a beat clock on its own active time; the sway's period and phase follow it while one exists; the MMD act form samples the same clock.

- **The beats' path.** From the same detector: the mind store fans each beat out to its attached stages, as a perceptual input, not an intent; the mind decides nothing about single beats. The conductor forwards a beat to the scene only under Natural. Natural queues it and stamps it at its next grid step on its active clock (render-loops skill: an event from outside the loop starts its effect at the frame), never with the mind's clock or `performance.now()`.
- **The clock.** `{ at, period }` in active seconds, from successive onsets and the detector's `interval`. The smoothing and the period's multiple are design choices: "bobs once per beat, twice per sway", as the shape's comment says, gives 1 s sways at 120 BPM; the multiple nearest today's 1.7 to 2.3 s draw keeps today's look. Owner decision with clips on the motion review backlog.
- **The record.** `NaturalBodyIntent` gains the beat clock, so the MMD form (`performance/acts.ts`) computes the same phase. `IdleBehaviourRecord` keeps its fields; the body intent is not a diagnostics contract.
- **Checks.** `observer.test.ts` pins unchanged without beats; a headless `music` variant with scripted beats; `diff` `DIFFERENT` for `music` only; rendered steps from this plan's driver; visual review on the backlog. Only deterministic checks gate landing.
- **Done when:** the groove's period and phase follow the detected beat on Live2D and MMD, sampled on Natural's clock; without beats it sways as before; the idle agency ADR's follow-up "A beat estimate for sway" is closed.

The groove's length and rate in daily use are tuning, which waits for CM5b.

## 11. Decisions open to the owner's veto

| # | Fork | Options | Taken | Why |
| --- | --- | --- | --- | --- |
| D1 | Split CM5 | One PR with the beat lock; CM5a now, CM5b (beat lock) later | Split | CM5a meets the whole Done-when with no shape or constant change. The beat lock needs a new shape rule and a visual review. The roadmap rows split as CM3 and CM4 did |
| D2 | The one detector | Upstream's beat sync detector; the system-audio level (`resolveMusic`); a new media-session sensor (MPRIS on Linux, MediaRemote on macOS) | Beat sync's detector | It is the only source that can give the groove a beat (CM5b). It already has the user's switch. The level path runs only from a devtools page. A media session says nothing about the beat, is a new sensor per platform, and reports a paused player as music only through its own state |
| D3 | The detection rule | 8 s of beats with no gap over 1.8 s, outside game, call, and chat apps, ended by a 1.8 s gap; keep the speaking gate; a new tempo-regularity rule | The first | It reuses the fork's 8 s settle and upstream's 1.8 s release. The speaking gate changed no decision. A regularity rule would add constants. This is the slice's one unavoidable timing change; the evidence is the Node tests and rendered step 1 |
| D4 | Where detection runs | The leader's mind store (`MindMusic`); `Stage.vue`; the conductor | The mind store | It owns the mind and outlives stage remounts. One detector per window, not one per stage |
| D5 | Music in the drive or as a stimulus | `music` stimulus and `MindState.music`; keep `NaturalIdleDrive.music` | Stimulus | Target rule 6. Natural never read the field; it only carried the bit to the mind through the view |
| D6 | The groove episode | The `sway` act, drawn by the mind only while it hears music, at today's odds; a new episode that lasts while music plays | The `sway` act | A new episode needs new length and rate constants, which is tuning. The idle retune and CM5b own feel |
| D7 | The groove's name in code | Keep the act kind `sway` and add "groove" to the glossary; rename the kind `groove` | Keep `sway` | A rename churns QA markers, reports, the MMD act kinds, and the situation's self text with no behavior gain |
| D8 | Beat sync under Natural | `silent`: the springs advance and nothing is written; unregister the plugins under Natural; drop beats in `Model.vue` under Natural | `silent` | The `pre` plugin writes even with no beats, so dropping beats is not enough. Keeping the springs moving avoids a kick on a driver switch. One branch in upstream's plugin, beside the fork's existing `layered` departure |
| D9 | Beat sync's settings page under Natural | Unchanged; its Start also lets the mind hear music; a fork-only switch; start listening by default | Unchanged | No upstream page change. Starting a capture by default is a privacy decision and opens the portal picker at every launch on Wayland |
| D10 | Which window hears music | The leader only, while it leads; every window | The leader | Stages render only in the leader, the gate already connects only there, and one subscription answers the invoke once per window |
| D11 | The watching mode's system-audio rule | Keep it as attention; move it to the music detector | Keep | It decides where she looks, not whether music plays. It stays dormant without the devtools capture, as today |
| D12 | Headless evidence for the move | Add the `music` scenario first and diff against it; no music scenario | Add it first | No headless run has ever drawn a sway. An `IDENTICAL` diff against item 1 proves the move neutral |
| D13 | How rule 2 lands | For grooves now, with the expression tilt part left in Target; wait until expression tilts compose too | For grooves now | The roadmap's Done-when says "for grooves"; the expression part belongs to CM7's performer work |
| D14 | The groove's MMD shape (the character mind ADR's open question) | A body offset (the performer's `sway` form); a clip; both | A body offset | It exists and needs no clip the app may not ship (Body ownership Target rule 7). Dance clips stay requests that the director realises |

## Blocked: needs the owner

- **The CM3a amendment.** The roadmap moved overlap 3 from CM3 to CM4 and says the owner may veto that. CM5a does not touch overlap 3, and a veto changes only CM3's and CM4b's bookkeeping.
- **Overlap 12.** Whether notice turns go through the mind, or start the floor, stays the owner's question. CM5a does not touch it.
- **Listening by default** (does not block). Under Natural she hears music only while the user runs beat sync. Whether she should listen without being asked is a privacy and platform question (continuous capture; the Wayland picker), which D9 leaves to the owner.

Nothing else blocks CM5a.

## Must not do

- Do not tune `MUSIC_SETTLE_MS`, the quiet categories, any idle weight, rate, cooldown, rest, or hazard, the sway's shape, or any beat sync constant, and do not retune a report or gate line to make a run pass.
- Do not change beat sync under Universal or MAGIC, and do not edit upstream's detector, background window, settings page, or devtools page.
- Do not start an audio capture or beat sync by default.
- Do not send a beat, a beat time, or the mind's clock to Natural; CM5a gives Natural no beat input.
- Do not add a media-session sensor, an Eventa contract, or cross-window mind traffic; read beats only through `listenBeatSyncBeatSignal`.
- Do not send posture intents to Universal, MAGIC, or classic.
- Do not keep the level detector beside the new one, and do not add a compatibility guard.
- Do not edit the body of an existing ADR.
- Do not commit a model path or any other local path; use `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`.

## Done when

One detector reports music to the mind under Natural; the mind draws the groove only while it hears music, with today's odds; `NaturalIdleDrive` has no `music` and `idle-music.ts` is gone; beat sync writes nothing under Natural and runs as upstream ships it under Universal and MAGIC; overlaps 1 and 2 have left Known overlaps, Target rule 6 reads "Landed", and Body ownership Target rule 2 holds for grooves; the ledger's Decisions to revisit no longer lists beat sync; the roadmap shows CM5a done and CM5b not started; and every check in section 8 passes, with `idle-acts` and `rest` reading the same statuses at both ends.

## Departures during implementation

**Item 3**
- `advanceMusic` also ends a run when the clock steps back before the run's last beat, and a non-finite time changes nothing. The plan asked only that a clock that steps back never starts music.

**Item 4**
- The groove's long-run rate with music on is pinned at 14.2 per hour (56.9 acts per hour), measured over 1000 simulated hours, seeds 1 to 4.
- The `music` run's `detail` differs from item 1's only by the provenance field `music`.

**Item 5**
- The `music` scenario runs the plain QA drive (`qa-neutral-day`) and still sets `music`, so its `detail` names the plain drive at the tip.
- The commit also touched `character-mind`, `stage-shared`, `stage-ui-live2d`, and `stage-ui-mmd` fixtures and comments that named the drive's `music`, so its scope lists them.

**Section 6**
- The optional `chore(agents)` commit landed after item 2: `packages/stage-ui-live2d/AGENTS.md` now says beat sync writes the head only under Universal and MAGIC.

**Rendered check**
- The desktop-activity idle time was pinned, because the QA display reports no host idle time. The first wait for a sway in step 1 was invalid: she went away at 297 s and slept, so the step was rerun.
- Step 3 ran in its own launch.
- `ParamAngleY` was read inside the frame, because readings between frames are stale under Natural.
- Step 3 used JPEG frames to reach 10 Hz.
- Step 2's pass line said "peaks about one beat apart". Upstream's `balanced-v` style alternates sides, so the high and low points alternate every beat and same-side peaks are two beats apart. The records state the measured pattern.

## Checks run

| Check | Result |
| --- | --- |
| Gate per item | Each item and the docs commit passed `pnpm verify --gate --base luke/feat/character-mind-idle` |
| Policy docs | 11 of 11 |
| Headless motion, item 1, seed 1 | The `music` scenario over 600 s drew 2 sways, at 315.87 s and 497.72 s |
| Headless motion, item 4, seed 1 | Every motion block `IDENTICAL` for `idle`, `idle-drive`, and `sleepy-no-clip` against the base `754e30da1`, and for `music` against item 1 |
| Headless motion, tip, seed 1 | Every motion block `IDENTICAL`; only the `detail` provenance differs |
| `idle-acts` and `rest` reports | Every line reads the same status at both ends |
| `sleep-onset` | 14.283 s at both ends |
| Beat sync rig hash | Unchanged |
| Wording | Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review. |
| Smoke | Both `qa:smoke` runs passed, 0 renderer and 0 main-process errors |
| Rigs | `qa:live2d-rig` hash unchanged (`4853812851e6…`). `qa:test:model`: 4 files, 16 tests |
| Music source | `musicOn` ran a second detector in the beat sync window over a synthetic 120 BPM kick track played into the private sink. No scripted fallback was needed |
| Rendered step 1, Natural on Live2D | 120 s without music gave no `music` steps. `musicOn` at 120 BPM gave `music: true` 8001 ms after the first beat. A mind-decided `sway` came 382 s in; it started 19 ms after its intent and lasted 11.0 s. `musicOff` gave `music: false` 1804 ms after the last beat |
| Rendered step 2, Universal | `music: true` at 8000 ms. Over 122 s, no idle-act or idle-errand steps and no `idle` events. Beat sync moved `ParamAngleY` 17.3° (34.7° sampled inside the frame); the high and low points alternate every 497 ms, one beat |
| Rendered step 3, back to Natural during music | No errors. The largest head step per frame was 1.395°, against 0.813° before the switch and 1.68° for Universal's own beat motion. The head eased over about 180 ms with no visible jump |
| Rendered step 4, MMD on the desktop stage | `music: true` at 8003 ms. A sway came 358 s in and lasted 9.6 s. `music: false` 1822 ms after the last beat |
| Errors | Every launch had 0 renderer and 0 main-process errors |

## Commits

- `f3a3c2219` docs(plan): add the plan for the music slice of the character mind
- `b197bcf4b` feat(qa-tools): add a music scenario to the headless motion runs
- `4847c4a8b` feat(stage-ui-live2d): keep beat sync off the head under Natural
- `9a1bb6c07` chore(agents): say beat sync writes the head only under Universal and MAGIC
- `23d1a0b78` feat(stage-shared): add the music detector over beat sync beats
- `a47cee3ed` feat(motion-driver-natural,character-mind,stage-ui,stage-shared,qa-tools): make music a stimulus of the character mind
- `b4d4b2292` refactor(motion-driver-natural,character-mind,stage-shared,stage-ui,stage-ui-live2d,stage-ui-mmd,qa-tools): drop music from the idle drive
- `db7dd2c46` docs(ai): record the music decisions and close CM5a
