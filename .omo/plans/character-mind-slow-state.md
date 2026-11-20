# character-mind-slow-state - Work Plan

Status: done on 2026-11-19 for CM4a; CM4b is planned in outline; the PR is not merged. Roadmap row: step CM4 in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Rulings: the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md), the [core ADR](../../docs/ai/adr/2026-11-18-character-mind-core.md), the [return ADR](../../docs/ai/adr/2026-11-19-character-mind-return.md), the [voice ADR](../../docs/ai/adr/2026-11-19-character-mind-voice.md), the [widget turns ADR](../../docs/ai/adr/2026-11-19-character-mind-widget-turns.md), and the [state registry ADR](../../docs/ai/adr/2026-11-19-state-registry.md). Branch: `luke/feat/character-mind-slow-state`, cut from `luke/feat/character-mind-widget-turns` (CM3b) at `2171c202d`, with the ten commits of step S (PR #56 against `main`) cherry-picked on top, through `531dc5aa2`. CM3b sits on CM3a (PR #52), CM2 (PR #51), and CM1 (PR #47), none merged; the stack contains upstream `moeru-ai/airi` through `b3a6d6071`, which is also `upstream/main` today. The PR's base is `luke/feat/character-mind-widget-turns`, and its description says that the S commits are reviewed in #56. When a PR below merges, rebase this branch onto the new base and retarget the PR.

The owner is away and runs these slices without a plan review. Every design fork below is taken on the recommended option and listed in [Decisions open to the owner's veto](#11-decisions-open-to-the-owners-veto).

**Split (D1).** CM4 is too large for one PR. This plan splits it:

- **CM4a, one mind in the leader, with slow state**, on this branch. It is planned in full below.
- **CM4b, the idle draw and sleep in the mind**, on a later branch cut from CM4a's tip. It is planned in outline in [section 10](#10-cm4b-in-outline) and gets its own plan before it starts.

## TL;DR (For humans)

**What changes (CM4a):** The character mind leaves `Stage.vue`. One mind lives in a leader-only store, `useCharacterMindStore`, for the active card. It outlives stage remounts, connects to the situation's gate on its own, and is the only mind the voice port knows. Her own pacing memory (when she last spoke, how many openings went unanswered, the reply wait, the damping, the own-day mark) becomes the mind's slow state: it is saved in the card's character-state record, so it survives a restart and belongs to the character. The floor after any spoken line, the hourly cap, and the ritual day stay per user in the gate's inner state. Exporting a card splits in two: Share carries the card and its profile only, and Back up carries the card, its memories, and the whole record.

**Why:** Target rule 5 of State persistence and rule 1 of Autonomous behavior. Today every `Stage.vue` creates its own mind, which persists nothing, while her pacing is saved per user, so a second character inherits the first one's unanswered openings, and a stage remount starts a new mind (the CM2 and CM3a consequences).

**What does not change:** No rate, threshold, floor, cap, or hazard is tuned. Natural's idle draw and sleep stay in Natural until CM4b. Universal, MAGIC, and classic still receive no posture intents. No storage key changes.

**Effort:** M. **Risk:** Medium. The risk is the gate memory split: the voice policy's restore path changes, and an old saved gate slice resets once (D8).

## 1. Upstream first

Read from the tree at `531dc5aa2`. `upstream/main` is `b3a6d6071`, so no upstream commit since the fork's base touches these paths.

| Upstream has | Code | Fork difference |
| --- | --- | --- |
| A card package: `exportAiriCardPackage({ card, displayModelsStore })` writes a manifest, `card.json`, and the selected display model. Its comment says the format "is intentionally not a lossless backup" | `packages/stage-ui/src/services/airi-card-import-export.ts` | The fork adds `memories.json` and `character-state.json` as optional resources (64 lines added). The comment still says it is not a lossless backup |
| One Export button on the card detail | `packages/stage-pages/src/pages/settings/airi-card/components/card-detail.vue` `handleExportCard` | The fork passes the card's own memories and `characterState.exportRecord(cardId)` |
| Card import | `packages/stage-pages/src/pages/settings/airi-card/index.vue` | The fork writes the imported memories and calls `characterState.importRecord(newCardId, record)` |
| The stage scene and the renderer root | `packages/stage-ui/src/components/scenes/Stage.vue`, `apps/stage-tamagotchi/src/renderer/App.vue` | Fork-edited: the mind, the conductor, the voice connection, and the leader stores' `initialize` calls |
| No character mind, no character state, no Natural driver, no gate | None | All fork-only |

Nothing upstream covers a per-character pacing memory or a backup. The fork owns every file this slice changes except the four upstream files above, which it has already edited. The card package's split restores upstream's share content under the Share action (section 3.6), so that file moves closer to upstream.

The ledger has no row for the card package departure today; work item 3 adds one.

## 2. Today's code

**Where the mind lives.** `useCharacterMind()` in `packages/stage-ui/src/composables/performance/use-character-mind.ts` creates one `CharacterMind` per `Stage.vue`, seeded from `crypto.getRandomValues`, and feeds the devtools reaction inspector. `Stage.vue` hands it to `useStagePerformanceConductor`, and on mount calls `situationStore.connect(stimulus => performanceConductor.voiceStimulus(stimulus))`, disconnecting on unmount. `StagePerformanceConductor` wraps the mind in a `MindVoice` (`mind-voice.ts`) whose cue callback is `this.idleCue`, which performs a cue only under Natural. `Stage.vue` renders only in the `index` and `stage` pages of the desktop app (`apps/stage-tamagotchi/src/renderer/pages/`), and only those windows can lead (`useStageHostWiring`).

**The gate run.** `useSituationStore` (`packages/stage-ui/src/stores/situation/index.ts`) runs a 2 s gate timer in the leader and sends `voice-tick` stimuli to the newest connection. Its `run: VoiceRun` holds `id`, `memory` (the mirror of the last memory a mind published) and `saved` (the slice read at promotion). `restoreGate` in `packages/character-mind/src/voice.ts` restores a run the mind has not seen: from the mirror, else `promotionUrgeMemory` plus `restoreSocialMemory(saved)`, else promotion alone. `savedGateMemory` picks `lastFireAtMs`, `lastSpokenAtMs`, `unanswered`, `awaitingSinceMs`, `damp`, `day`, and `lastOwnDayAtMs`, and the leader saves them in the `gate` field of `settings/situation-inner` (`features/situation/inner-state.ts`, tier 2, leadership token), each stored field validated on its own. `fires` (the hourly cap) and the urge are not saved. The character-state bridge reads `run.memory` for its reach-out-unanswered poll (`bridgeSituationToCharacter`).

**The record.** `useCharacterStateStore` (`packages/stage-ui/src/stores/character-state.ts`, synced, leader-routed actions) loads the active card's `CharacterStateRecordV1` in `activate`, advances it with `advance`, saves it 2 s after a change (`CHARACTER_STATE_SAVE_DEBOUNCE_MS`) and on page hide, and replicates only a reading. `migrateCharacterState` (`packages/stage-shared/src/character-state/migrate.ts`) validates a stored record field by field against `CharacterStateRecordSchema.entries`, and a missing or invalid top-level field falls back to its value in a fresh record. The repository is `characterStateRepo` (IndexedDB `airi-character-state`, store `cards`, Web Lock `airi:character-state`).

**The registry.** `stateRegistry` (`packages/stage-ui/src/persistence/state-registry.ts`) registers `character-state` (tier 4, reset `resetState`) and `situation-inner-state` (tier 2, the named exception "The gate's inner state", reset `forget({ scope: 'everything' })`).

**The idle draw (unchanged in CM4a).** `NaturalIdleActivities` (`packages/motion-driver-natural/src/idle-activities.ts`) draws acts, errands, and sleep on Natural's seconds and its own `stream('idle')`. The conductor sends an idle drive every second with `allowSleep: true`.

## 3. The design

### 3.1 One mind in the leader

A new unsynced Pinia store, `useCharacterMindStore` in `packages/stage-ui/src/stores/character-mind.ts`, hosts the window's one mind. It is the only place that constructs a `CharacterMind` in the app; tests and headless runners keep constructing their own.

```ts
/** What a mounted stage lends the mind: the body around a line. The conductor gates it by driver. */
export interface MindStage {
  idleCue: (cue: Extract<MindIntent, { kind: 'cue' }>['cue']) => void
}

export const useCharacterMindStore = defineStore('character-mind', () => {
  // markRaw: the mind's state is replaced on every step and must not become reactive.
  const mind = markRaw(new CharacterMind({ seed: crypto.getRandomValues(new Uint32Array(1))[0] }))
  /** Answers the voice port's stimuli; its cues go to the attached stage, or nowhere. */
  const voice = new MindVoice(mind, () => situation, cue => stage?.idleCue(cue))
  // ...
  /** Lends the mind a stage's body; the result detaches it. The newest stage wins. */
  function attachStage(next: MindStage): () => void
  /** Binds the mind to leadership: it connects to the gate while the window leads. Repeated calls keep the first. */
  function initialize(syncedPinia: SyncedPiniaRuntime): void
  function dispose(): void
  return { mind, attachStage, initialize, dispose }
})
```

- **Leadership.** `App.vue` calls `characterMind.initialize(syncedPinia)` after `characterStateStore.initialize` and `situationStore.initialize`. On promotion the store awaits `characterState.ready()`, loads the slow state (section 3.3), and calls `situation.connect(stimulus => voice.answer(stimulus))`. On demotion it disconnects. A follower window runs no mind for the voice port and renders no stage, so no stimulus or intent crosses windows and no Eventa contract is added (direction ADR decision 9; D3).
- **The stage.** `Stage.vue` takes `useCharacterMindStore().mind` for its conductor and calls `attachStage({ idleCue: cue => performanceConductor.idleCue(cue) })` on mount, detaching on unmount. `situationStore.connect` and `conductor.voiceStimulus` leave `Stage.vue` and the conductor. The conductor keeps its own `MindVoice` over the same mind for touch and desktop steps: `MindVoice` holds no state, so both wrappers publish to the same port.
- **The inspector.** The store feeds the reaction inspector as `useCharacterMind` does today; `voiceDecisionOf` moves with it. `use-character-mind.ts` is deleted.
- **What this fixes.** The gate runs whether or not a stage is mounted (the CM3a consequence "the gate runs only while the stage is mounted"), and a presence span survives a stage remount (the CM2 consequence "a remount during an absence shortens `awayMs`"). Two rendered stages would share one mind, one touch dose path, and one voice connection; only their Natural idle draws stay separate until CM4b (overlap 5 narrows).
- **One live mind, not a map (D4).** The store runs the active card's mind. A card switch reloads it (section 3.3). A chat session that selects another character still reaches this mind, as every unprompted turn does today.

### 3.2 The gate memory split

`UrgeGateMemory` is split by owner in `packages/stage-shared/src/situation/urge-gate.ts`:

```ts
/** Per user, across characters: the floor counts from the last fire, the hourly cap counts the fires, the ritual day holds the day's rituals. */
export type UserGateMemory = Pick<UrgeGateMemory, 'lastFireAtMs' | 'fires' | 'day'>

/** The user's slice the leader saves in `settings/situation-inner`. `fires` restart at each launch, as today. */
export type SavedGateMemory = Pick<UserGateMemory, 'lastFireAtMs' | 'day'>

/** Per character: her own pacing memory, saved in the card's character-state record. */
export type CharacterPacingMemory = Pick<UrgeGateMemory, 'lastSpokenAtMs' | 'unanswered' | 'awaitingSinceMs' | 'damp' | 'lastOwnDayAtMs'>

export function userGateMemoryOf(memory: UrgeGateMemory): UserGateMemory
export function pacingMemoryOf(memory: UrgeGateMemory): CharacterPacingMemory

/** Lays the user's slice and her pacing over `memory` and normalizes the result at `nowMs`. Replaces `restoreSocialMemory`. */
export function restoreGateMemory(memory: UrgeGateMemory, user: UserGateMemory | null, pacing: CharacterPacingMemory | null, nowMs: number): UrgeGateMemory
```

The field split follows Target rule 5: the floor and the hourly cap are per user; last-spoke times, unanswered openings, the reply wait, the damping, and the own-day mark are hers. The ritual day is per user (D5). The urge, the threshold, the hard-hold mark, the pending fire, and a due double text stay fast state: a new mind eases in at promotion, as today (D6). `fires` stays unsaved, as today (D7).

### 3.3 The mind's slow state

In `packages/character-mind/src/types.ts`:

```ts
/** The part of the mind's state that the leader saves in the active card's character-state record. */
export interface MindSlowState {
  /** Her pacing memory; null for a card she never spoke as, or after "Delete all data". */
  pacing: CharacterPacingMemory | null
}

export interface MindState {
  // ... seq, reaction, touch, voice, presence, desktop, as today: fast state, reset at launch
  slow: MindSlowState
}

export interface VoiceRun {
  /** The store bumps it at each promotion and at "Delete all data". A new id makes the mind restore its gate memory. */
  id: number
  /** The user's slice: from the last memory a mind published in this run, else the slice saved at promotion. */
  user: UserGateMemory | null
}
```

- **Core.** `initialMindState(slow: MindSlowState = { pacing: null })`. `restoreGate` becomes `restoreGateMemory(promotionUrgeMemory(nowMs, rng), view.run.user, state.slow.pacing, nowMs)`: the mirror path goes, because no second mind joins a run any more. After each stimulus whose answer changes `voice.gate`, the core sets `slow.pacing` to `pacingMemoryOf(gate)` when a field differs, and keeps the object otherwise, so a listener can compare by identity. The normalization in `restoreGateMemory` is the decay of her pacing for the time away, applied by the core on load (D9).
- **Shell.** `CharacterMind` takes `slow?: MindSlowState` and gains `reset(slow: MindSlowState): void`: it replaces the state with `initialMindState(slow)`, keeps the random source, and keeps the clock monotonic (`previousAtMs` stays). The comment "persists nothing" becomes "persists nothing itself: the host saves `state.slow`".
- **The record.** `CharacterStateRecordV1` gains `readonly pacing: CharacterPacingMemory | null`, and `CharacterStateRecordSchema` gains its entry (`CharacterPacingMemorySchema`, beside the record schema in `packages/stage-shared/src/character-state/types.ts`, with the damp schema that leaves `inner-state.ts`). `initialCharacterState` sets `null`; the reducer carries the field through. A stored version 1 record without it gets `null` from `migrateCharacterState`'s existing per-field fallback, so the version stays 1 and no guard is added. The replicated reading does not carry it.
- **The record's writer.** `useCharacterStateStore` gains `leaderEpoch` (a computed number the leader bumps whenever it replaces the active record: in `activate`, in `forgetNow` when it hits the active card, and in `importRecord` of the active card) and `recordPacing(cardId, epoch, pacing)`. `recordPacing` runs on the leader queue, drops a write whose card or epoch is stale, sets `pacing` and `updatedAtMs`, and schedules the debounced save. It is not a synced action: only the leader's mind store calls it, like `applyNow`.
- **The host.** `useCharacterMindStore` calls `mind.reset({ pacing: record?.pacing ?? null })` at promotion after `characterState.ready()`, and again whenever `leaderEpoch` changes (a card switch, an import over the active card, a forget, "Delete all data"). It reconnects to the gate after each reset, so widget callers the old state held get `failed` (`connect` already answers them). A step listener calls `recordPacing` when `state.slow.pacing` is a new object.
- **The situation store.** `run` becomes `{ id, user }`. Each `publishVoice` sets `run.user` to `userGateMemoryOf(memory)`, so a card switch carries the floor, the hourly cap, and the ritual day to the reloaded mind. At promotion `run.user` is the saved slice with `fires: []`. The store keeps the last published memory as a read model, `gateMemory`, for `publishUrgeState`, the inspector, and the character-state bridge (`gate: () => gateMemory ?? initialUrgeMemory`). `savedGateMemory` picks `lastFireAtMs` and `day`.

### 3.4 Storage

No key changes. `SavedGateMemorySchema` in `inner-state.ts` narrows to `lastFireAtMs` and `day`. Its strict schema rejects a stored `gate` field with the old seven fields, and `readStoredInnerState` resets that one field and keeps its siblings (threads, rituals, extraction positions). So, once, at the first launch of this build: the floor and the ritual day of the gate restart, a ritual the gate already did that day can come again, and her unanswered count and damping are forgotten (D8). The old pacing is not copied into a record: it belonged to whichever card was active, and copying it would be a compatibility path.

The registry gets no new location. In the same work item that changes each slice: the `character-state` comment names her pacing memory beside mood, temperament, and relationship; the `situation-inner-state` comment names the user's floor and ritual day. The mind's store persists nothing itself and is not registered.

### 3.5 What stays where

| State | Owner | Saved | Scope |
| --- | --- | --- | --- |
| Mood, temperament, relationship, history | `useCharacterStateStore` record, reducer in `stage-shared/character-state` | Tier 4 record | Per card |
| Her pacing (`CharacterPacingMemory`) | `MindState.slow`, written to the record by the mind's store | Tier 4 record | Per card |
| Floor, ritual day (`SavedGateMemory`) | Mind's gate memory, mirrored in `run.user` | `settings/situation-inner` `gate` | Per user |
| Hourly cap (`fires`), urge, threshold, pending fire, double text | Mind's gate memory | Not saved | Per launch |
| Touch reaction pacing, emotion habituation, presence, desktop stamps | `MindState` | Not saved | Per launch |
| Natural's fast mood and idle draw | Each stage's Natural | Not saved | Per stage, until CM4b |

### 3.6 Share and back up

`exportAiriCardPackage` takes `{ card, displayModelsStore, backup?: { memories: MemoryWrite[], characterState: CharacterStateRecordV1 | null } }`. Without `backup` it writes what upstream writes: the manifest, `card.json` with the card's profile in `extensions.airi.modules.character`, and the display model. With `backup` it adds `memories.json` and `character-state.json`, as today's export does. The type makes a share unable to carry the record. `card-detail.vue` shows two actions: Share (today's button, relabeled) and Back up. The backup's file name gets a `backup` suffix. Import is unchanged: a share imports with a fresh record from the profile, and a backup restores the record, pacing included. English strings only (`settings.pages.card.share`, `back_up`, `backed_up`, `back_up_failed`; `export` and `exported` are renamed to the share wording). The share leaves out the card's memories (D11).

## 4. Where the code lives

| Code | Package |
| --- | --- |
| `UserGateMemory`, `CharacterPacingMemory`, `restoreGateMemory` | `stage-shared/situation` (`urge-gate.ts`) |
| `CharacterPacingMemorySchema`, the record's `pacing` | `stage-shared/character-state` (`types.ts`, `reducer.ts`); a new production import of `stage-shared/situation` types, acyclic because `situation` does not import `character-state` |
| `MindSlowState`, `VoiceRun`, `reset` | `character-mind` (`types.ts`, `step.ts`, `voice.ts`, `mind.ts`); the purity lint blocks are unchanged |
| `useCharacterMindStore` | `stage-ui` (`stores/character-mind.ts`), imported by explicit subpath |
| `recordPacing`, `leaderEpoch` | `stage-ui` (`stores/character-state.ts`) |
| Share and back up | `stage-ui` (`services/airi-card-import-export.ts`), `stage-pages` (`card-detail.vue`), `i18n` (English `settings.yaml`) |

## 5. What is deleted

- `packages/stage-ui/src/composables/performance/use-character-mind.ts` and its test cases, which move to the mind store's test.
- `StagePerformanceConductor.voiceStimulus` and the `VoiceStimulus` dispatch in the conductor; `Stage.vue`'s `disconnectVoice` and its `connect` call.
- `VoiceRun.memory` and `VoiceRun.saved`, the mirror path of `restoreGate`, and `restoreSocialMemory`.
- The five pacing fields of `SavedGateMemory` and of `SavedGateMemorySchema`.

After the last code commit, `git grep -nE "useCharacterMind\b|voiceStimulus|restoreSocialMemory|run\.memory|run\.saved"` must print nothing outside `.omo/` and `docs/ai/adr/`.

## 6. Docs that move with the code

Policy docs change in the commit that makes their statement false. The work item is named in brackets. Run `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after each policy doc edit.

- **`docs/ai/context/state-persistence.md`** [1, 3, 4]: [1] the record's members name her pacing memory. [3] the share and backup rule enters the current sections: a share carries the card and its profile, a backup the card, its memories, and the whole record. [4] Target rule 5 moves into the current sections with its wording settled: "her own pacing memory (last-spoke time, unanswered openings, the reply wait, the damping, the own-day mark)" instead of "urge memory", and "the leader advances the record on load and the mind normalizes her pacing at its first tick" instead of "the mind applies decay" (D9). The named exception "The gate's inner state" holds the user's floor and ritual day and no pacing of hers. The Target table's gap row goes. Target keeps rules 3 and 4.
- **`docs/ai/context/autonomous-behavior.md`** [2, 4]: [2] a Precedence rule "One mind in the leader" (`useCharacterMindStore`, connected while the window leads, lends its cues to the attached stage); rule 16's sentences on the stage's connection and "the newest connection wins"; the Character mind rows of Deciders; overlap 5 rewritten: one mind serves every stage, and only each stage's Natural idle draw stays separate. The Target table row of overlap 5 reads "Rule 1 for the idle draw (CM4b)". [4] rule 16's sentences on the run and the restore.
- **`docs/ai/context/glossary.md`** [2, 4]: Character mind (where it lives, `reset`, slow state), Conductor, Leader and follower windows (the mind runs in the leader) [2]; Character state (the record holds her pacing), Gate and Voice policy (the user's slice and hers) [4].
- **`docs/ai/context/upstream-policy.md`** [3]: a new row in "Character, motion, and prompt": Card package; upstream exports the card and model and is "not a lossless backup"; the fork's Share writes the same, and Back up adds memories and the whole character-state record; reason: Target rule 5 and direction ADR decision 10; revisit: not planned.
- **`docs/ai/context/character-mind-roadmap.md`** [5]: the CM4 row splits into CM4a (done) and CM4b (not started); CM4b's Done-when keeps overlaps 3, 5, and 9; CM5 and CM6 depend on CM4b; the amendment paragraph gains the split; the tuning table's CM4 row waits for CM4b for the idle retune and for CM4a for the rest.
- **READMEs:** `packages/character-mind/README.md` (`MindSlowState`, `reset`, the `voice-tick` restore line) [4]; `packages/stage-ui/README.md` (the voice port section: who connects; the pacing paragraph; the mind store) [2, 4]; `packages/stage-shared/README.md` if it names `SavedGateMemory` [4].
- **ADR** [5]: `docs/ai/adr/2026-11-19-character-mind-slow-state.md` records D1 to D14 as taken or vetoed. It notes that it settles two items of the core ADR's "Not decided" list (one mind per character, load and save of slow state) and defers the third (where Natural's fast mood lives) to CM4b.
- No nested `AGENTS.md` changes: `packages/stage-ui/AGENTS.md` says the mind decides unprompted voice and turns start only from `VoicePort` `speak`, which stays true.

## 7. Work items

Each item is one commit that passes `pnpm verify`.

1. **`feat(stage-shared,stage-ui)`: give the character-state record her pacing memory.** `CharacterPacingMemory` in `urge-gate.ts`; `CharacterPacingMemorySchema` and the `pacing` field in `character-state/types.ts`; `initialCharacterState` and the reducer; `leaderEpoch` and `recordPacing` in `useCharacterStateStore`; the `character-state` registry comment. Nothing calls `recordPacing` yet. Docs `[1]`. Tests: `migrate.test.ts`, a stored record without `pacing` reads `null` and keeps its siblings, an invalid `pacing` falls back alone; the record schema round-trips a pacing value; in `character-state.test.ts`, `recordPacing` with a stale epoch or another card is dropped, a current one is saved after the debounce, and `forget` of the active card bumps `leaderEpoch`.
2. **`refactor(character-mind,stage-ui,stage-tamagotchi)`: run one mind in the leader.** `useCharacterMindStore` as in section 3.1; `App.vue` initializes it; `Stage.vue` takes its mind and attaches the stage; `voiceStimulus`, `Stage.vue`'s connection, and `use-character-mind.ts` go. `VoiceRun` is unchanged in this item. Docs `[2]`. Tests: `stores/character-mind.test.ts` (Node, like `character-state.test.ts`) with a fake synced runtime: the store connects on promotion and disconnects on demotion; a tick reaches the mind with no stage attached; a cue reaches the attached stage and is dropped with none; detaching an older stage leaves the newer one attached; the inspector receives a touch decision. The conductor tests lose their `voiceStimulus` cases, which move to the store test with the same assertions. `use-motion-qa-events.ts` keeps reading `mind.onStep` from the conductor's options.
3. **`feat(stage-ui,stage-pages,i18n)`: split the card export into share and back up.** Section 3.6. Docs `[3]`. Tests: in `airi-card-import-export.test.ts`, a share package holds no `memories.json` or `character-state.json` and imports with `characterState: null`; a backup holds both and its record survives import with its `pacing`. No DOM test of the buttons (UI test rules); the rendered check covers them by a screenshot.
4. **`feat(stage-shared,character-mind,stage-ui)`: keep her pacing as the mind's slow state.** Sections 3.2 to 3.4: the split types and `restoreGateMemory`; `MindState.slow`, `initialMindState(slow)`, `reset`; `VoiceRun { id, user }`; the situation store's `run.user`, `gateMemory`, and `savedGateMemory`; the narrowed `SavedGateMemorySchema`; the mind store's reset on `leaderEpoch` and its `recordPacing` listener; the `situation-inner-state` registry comment. Docs `[4]`. Tests: `voice.test.ts`, restore lays the user's slice and her pacing over promotion and normalizes both, the slow pacing follows each gate change and keeps its identity when nothing changed, a JSON round trip of a state with slow pacing continues identically; `mind.test.ts`, `reset` keeps the clock monotonic and the random stream; `urge-gate.test.ts`, `restoreGateMemory` cases replace the `restoreSocialMemory` ones; `inner-state.browser.test.ts`, a stored seven-field `gate` resets alone and the threads survive; the situation store test, a publish updates `run.user` and promotion seeds it with `fires: []`; the mind store test, a card switch reloads the new card's pacing and keeps the user's floor and fires, "Delete all data" leaves no pacing in the record whichever of the two registrations runs first, and a pacing change reaches the record. `state-registry.browser.test.ts`, `use-data-maintenance.browser.test.ts`, and `scripts/dev-tools/storage-writes.test.ts` pass unchanged.
5. **`docs(ai)`: record the slow state decisions and split the roadmap row.** The ADR and the roadmap marked `[5]`. This is the last commit, after the checks in section 8 pass.

**Order.** 1, then 2, then 3 and 4 in either order (they touch different files), then 5. Item 2 lands before the slow state so that the reload in item 4 has one host to live in.

## 8. Checks

- **Each commit:** `pnpm verify`. Inner loops: `pnpm -F @proj-airi/character-mind exec vitest run src/voice.test.ts`; `pnpm -F @proj-airi/stage-shared exec vitest run src/character-state src/situation/urge-gate.test.ts` (the package has one project); `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/character-mind.test.ts src/stores/character-state.test.ts src/services/airi-card-import-export.test.ts`; `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/features/situation/inner-state.browser.test.ts`; the registry: `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/persistence/state-registry.browser.test.ts src/composables/use-data-maintenance.browser.test.ts` and `pnpm exec vitest run --project dev-tools scripts/dev-tools/storage-writes.test.ts`.
- **Policy docs:** `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after each policy doc edit and at the tip.
- **The branch:** `pnpm verify --gate --base luke/feat/character-mind-widget-turns`.
- **Smoke on both hosts.** `.env.qa` is not in this worktree; create it there (it is ignored) or export `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`.
  - `pnpm qa:display run -- pnpm qa:smoke`
  - `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"`
- **Headless motion.** CM4a changes no code of Natural's idle or body motion, so a `qa:motion3d` base-against-tip diff is not required. Because the headless runners construct a mind whose state gains `slow`, run it once anyway: `pnpm qa:motion3d run --model "$AIRI_QA_MMD_MODEL" --scenario idle --seed 1 --out <dir>` at `531dc5aa2` and at the tip, and `pnpm qa:motion3d diff <base run> <tip run>` must print `IDENTICAL`. `pnpm qa:live2d-rig` and `pnpm qa:test:model` pass. The `mmd-motion-qa` skill this step's brief names is not in this worktree's `.agents/skills`; use `.agents/skills/motion-qa/SKILL.md` and the qa-tools README.
- **Rendered check.** A driver under `.temp/cm4/` (not committed), modeled on the state-registry step's driver: `AppSessionCore.create({ repoRoot, profileDir })` with a profile kept across launches, the qa:app replay LLM server for scripted replies, page-side evaluation over CDP to read IndexedDB and localStorage, and the motion QA bridge verbs `state`, `chatSend`, `events`, `configure`, `voiceEvaluate`, and `deleteAllData`. Run it with `pnpm qa:display run --name cm4 -- node --import tsx .temp/cm4/driver.ts <step>`, and stop the display with `pnpm qa:display down --name cm4`. The driver prints no model path.
  1. **The one-time reset (D8), first.** In a worktree of the base made with `pnpm wt new cm4-base` (removed afterward with `pnpm wt rm cm4-base`), launch on a second kept profile, replay one turn, and fire one `voiceEvaluate`, so the old seven-field `gate` is saved. Launch the tip on that profile. Pass: one warning names `gate`, the stored threads survive, and a relaunch prints no warning.
  2. **Idle under Natural, classic window.** Fresh profile, Live2D rig from `AIRI_QA_RIG_FORBOOTH`, Natural. Pass: within 180 s the `idle` events show at least one act start and end from Natural's own draw, as on the base; one replayed user turn and one `voiceEvaluate` that fires give one `mind` event with `posture/cue about-to-speak` before `voice/speak reach-out`, one `idle` event for the `about-to-speak` cue, and one `turn` event; 3 s after the line, the IndexedDB record of the active card has `pacing.unanswered` 1 and a `pacing.lastSpokenAtMs`, and the `gate` field of `settings/situation-inner` holds only `lastFireAtMs` and `day`. The renderer and main logs show no errors.
  3. **Universal.** In step 2's session, after its checks, with the Live2D driver switched to Universal by page-side evaluation of the model's driver setting (the bridge's `configure` accepts only `natural`; the CM1 touch check switched it the same way). Pass: a firing `voiceEvaluate` still gives the `mind` event with its cue and line and a `turn` event, and no `idle` event follows the cue; the record's pacing updates.
  4. **Share and back up.** In the same session, through the settings window, Share and Back up the active card, and read both files' entries: the share has no `memories.json` or `character-state.json`, the backup has both. A screenshot of the two actions goes into the PR.
  5. **A restart keeps the slow state.** Relaunch on step 2's profile. Pass: the first `voiceEvaluate` reports a memory whose `unanswered` and `lastSpokenAtMs` equal the stored record's, and no `[situation-inner] Invalid stored fields` warning appears. Then `deleteAllData`: the `cards` store is empty, and the next `voiceEvaluate` reports `unanswered` 0 and `lastSpokenAtMs` null.
  The MMD desktop stage is covered by the smoke run above, because the mind's host does not depend on the scene.
- Record the run directories, the event excerpts, and the record excerpts (field names and counts, no content) in the PR description.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| A card switch while a line is open: the old line's outcome reaches the reloaded mind | `answerVoiceOutcome` ignores a reach-out or widget turn it has no line for, and the chat turn finishes as an ordinary unprompted turn; a spoken touch line still starts the floor, which is per user. The old card's record misses that one line's pacing. A test covers it |
| Her pacing waits up to 2 s for the debounced save; a crash in that window loses the last change | `flushSave` runs on page hide and at demotion. The loss is one line's pacing, which normalizes anyway |
| The one-time reset of the gate slice lets a ritual repeat on the day of the update | Recorded as D8; it happens once |
| `markRaw` is forgotten and the mind's state becomes deeply reactive | The store test asserts `isReactive(store.mind)` is false |
| The leader promotes before the record loads, so the first tick restores without her pacing | The store connects only after `characterState.ready()`, and every reset reconnects, so the first tick after a load restores from the loaded pacing |
| A share drops memories a user expected to keep | The Back up action sits beside Share; the toast names what each carries |

## 10. CM4b in outline

**Goal.** Natural's idle draw and sleep move onto the mind's clock and source. Closes overlap 3 (two clocks), overlap 5 (each stage would draw its own idle), and overlap 9 (sleep decided by Natural and shown by `useIdleProps`).

**Required reading before its plan:** `docs/ai/adr/2026-11-12-idle-agency.md` (the motion-driver-natural guide requires it before `idle-activities.ts` changes), the render loops skill, the motion QA skill and the qa-tools README sections on `idle-acts` and `rest`, and body ownership Target rule 1.

**Shape.**

- The scheduling half of `NaturalIdleActivities` (the hazard, the pick and its weights, cooldowns, rest, recovery, the sleep delay and the follow-up stretch or yawn, errand pacing, the cues, a requested play) becomes pure rules that `step` composes, as the voice policy composes the gate rules. The rules stay in `motion-driver-natural` and are exported; `MindState.idle` holds their memory.
- The performer reports eligibility once a second, on the conductor's existing idle drive interval: mode, away, blocked, placement, and the ends of acts. The mind answers with posture intents `idle-act` and `sleep`, which the conductor performs only under Natural. Universal, MAGIC, and classic get none (body ownership Target rule 1).
- Sleep becomes a mind episode: `useIdleProps` follows the mind's `sleep` intent instead of Natural's report, and `allowSleep` leaves the idle drive.
- Natural's fast mood: CM4b's plan decides whether it moves into the mind's state or stays a performer channel; the core ADR left it to CM4.

**Decisions its plan will put to the owner's veto:** the hazard resolves once a second instead of once a grid step, and eligibility is read at that rate (no rate constant changes); idle draws come from the mind's source, so headless traces change while the odds do not, and the motion3d base-against-tip diff is expected to print DIFFERENT, with the `idle-acts` and `rest` reports and the gate passing at the tip as at the base; the headless runners drive idle through a mind.

**Checks it will need:** `pnpm qa:motion3d run` of `idle`, `idle-drive`, and `sleepy-no-clip` at its base and tip, `pnpm qa:motion3d diff`, `pnpm qa:motion3d report idle-acts` and `report rest` at the tip, `pnpm qa:live2d-rig`, the two smoke runs, and a rendered idle and sleep check under Natural and Universal through a `.temp/` driver.

## 11. Decisions open to the owner's veto

| # | Fork | Options | Taken | Why |
| --- | --- | --- | --- | --- |
| D1 | One PR or two | CM4 whole; CM4a (host and slow state) then CM4b (idle and sleep) | Split | The host is the foundation the idle move needs; the idle move touches render loops, the MMD director's sleep stance, and every headless runner, and needs its own motion evidence. CM3 set the precedent |
| D2 | Where the mind lives | Keep it in `Stage.vue` and add load and save; a leader-only store; a mind in the leader with an Eventa transport to stages in other windows | A leader-only store | Only the leader renders a stage, so no transport is needed (direction ADR decision 9). A store outlives remounts and runs the gate without a stage |
| D3 | Followers | Run a mirror mind fed by the leader; receive intents over Eventa; run no mind | Run no mind | No follower renders a stage. Zero cross-window cost; a transport waits for a second live stage |
| D4 | How many minds | One per stored card, kept in a map; one for the active card, reloaded at a switch | One, reloaded | Only the active card speaks or renders. A map adds lifecycle for dormant characters with nothing to do |
| D5 | The ritual day | Per user; per card | Per user | Target rule 5 does not name it. Per user keeps one greeting a day across a card switch and leaves the ritual collector, which reads the separate `rituals` field, untouched |
| D6 | The urge and its threshold | Save them in the record; keep them fast | Fast | Today they restart at promotion; saving them would change her pacing after every launch. Rule 5's "urge memory" is reworded to name the fields it means |
| D7 | The hourly cap's fires | Save them per user; keep them per launch | Per launch, carried across a card switch | Unchanged from today; saving them changes the cap's behavior after a restart, which is tuning |
| D8 | Old saved gate slices | Reset the `gate` field once; copy the old pacing into the active card's record; loosen the schema to keep the user's two fields | Reset once | No compatibility path. The cost is one restart of the floor and the ritual day, and one forgotten unanswered count. CM3a's D6 set the precedent |
| D9 | Who applies decay on load | The record's reducer in the store, and the core for her pacing; move the whole record and its reducer into `MindState` | The store for the record, the core for her pacing | The reducer is already pure (`advance` in `stage-shared/character-state`) and needs calendar context that `step`'s fixed signature does not carry. Putting 400 days of history into every step's state would reach every listener and QA event. Rule 5's wording changes accordingly |
| D10 | A card switch | Keep the fast state; start it over | Start over, easing in like a promotion | Fast state belongs to the character on stage; the user's floor and cap carry over through `run.user` |
| D11 | The share's memories | Carry the card's memories in a share; leave them out | Leave them out | Rule 5 and direction ADR decision 10: a share carries the profile only. Memories go with the backup |
| D12 | The backup format | Today's card package with both resources; a new format | Today's package | Rule 5 says today's export becomes the backup; import already reads it |
| D13 | Where the record's pacing is written from | The situation store, from each publish; the mind's store, from `state.slow` | The mind's store | The slow state is the mind's; the situation store keeps only the user's slice |
| D14 | Natural's fast mood and the bridge's slow touch dose | Move them now; leave them for CM4b | CM4b | Neither is slow state, and both sit with the idle and body work CM4b changes. The CM1 plan's note that CM4 moves them is narrowed to CM4b |

## Blocked: needs the owner

- **The CM3a amendment.** The roadmap moved overlap 3 from CM3 to CM4 and says the owner may veto that. This plan takes the amendment as working scope: CM4b closes overlaps 3, 5, and 9, and CM4a narrows 5. A veto moves overlap 3 back to a CM3 follow-up and leaves CM4b with 5 and 9.
- **Overlap 12.** Whether notice turns go through the mind stays the owner's question. CM4a does not change it: a notice turn still starts neither the per-user floor nor her pacing. If the owner rules that it should, the floor and her `lastSpokenAtMs` would start from it through `recordExternalSpeech`, in a later slice.

Nothing else blocks CM4a.

## Must not do

- Do not tune a rate, a threshold, the floor, the hourly cap, a hazard, or an idle weight.
- Do not move Natural's idle draw, sleep, or fast mood in CM4a.
- Do not change a storage key, add a storage location, or bump the record's version.
- Do not copy old saved pacing into a record, and do not add a compatibility guard.
- Do not add an Eventa contract or any cross-window mind traffic.
- Do not send posture intents to Universal, MAGIC, or classic.
- Do not edit the body of an existing ADR.
- Do not commit a model path or any other local path; use the `AIRI_QA_*` variables.

## Done when

The app constructs one `CharacterMind`, in `useCharacterMindStore`, which connects to the gate while its window leads and survives stage remounts; her pacing is saved in the active card's character-state record and survives a restart, while the floor, the hourly cap, and the ritual day stay per user; Share carries the card and its profile and Back up the whole record; State persistence Target rule 5 has moved into the current sections; overlap 5 names only the per-stage idle draw; the roadmap shows CM4a done and CM4b not started; and every check in section 8 passes.

## Departures during implementation

- **Item 1:**
  - The new damp schema in `CharacterPacingMemorySchema` duplicated the one in `inner-state.ts` until item 4 removed the old one.
  - `state-persistence.md` gained a paragraph that lists the record's fields, because no current section listed them.
  - The schema round trip is covered by giving the fixture in `types.test.ts` a pacing value.
  - The full-record literal in `mood.test.ts` gained `pacing: null`.
- **Item 2:**
  - No follower renders a stage today. `Stage.vue` is used only by `/` and `/stage`, only the main and desktop stage windows lead, and one launch builds only one of them. Every window that creates the store still constructs a mind, but only the leader's connects. A test covers a follower's mind that steps without being connected.
  - "One mind in the leader" became Precedence rule 18, appended, so the references to rules 14 to 17 stay valid.
  - `use-character-mind.ts` had no tests to move.
  - Two tests were added: a promotion that a demotion overtakes does not connect, and the follower case.
  - The store test mocks the situation and character-state stores as plain functions and fakes only `Date`.
- **Item 3:**
  - `export_failed` is kept for Share failures. `card-detail.browser.test.ts` was updated in place to click Back up.
  - Back up uses the `i-solar:download-square-linear` icon.
  - `memories.json` is left out when the card has no memories, as the base does.
  - The nine frozen locales keep orphaned `export` and `exported` keys.
- **Item 4:**
  - A null pacing stays null while the gate holds no pacing, so a record reset by "Delete all data" is not refilled with zeros.
  - The situation store tests now give the mind its slow state through `connectMind(..., slow)`.
  - The Card package row of `upstream-policy.md` points to the new section "The mind's slow state".
  - The headless runners needed no change.

## Checks run

| Check | Result |
| --- | --- |
| `pnpm verify --gate --base luke/feat/character-mind-widget-turns` | Passed after each item. The first gate run of item 3 failed only on two pixi-live2d-display "Texture loading error" unhandled rejections in `stage-emotion-routing.browser.test.ts`, a file the item does not touch. It passes when run alone, and the rerun passed |
| `policy-docs.test.ts` | 11 of 11 passed |
| Registry tests (`state-registry`, `use-data-maintenance`, `storage-writes`) | Passed after each item |
| Both `qa:smoke` runs, the classic window and MMD on the desktop stage | `ok: true`, 0 renderer and 0 main-process errors |
| `pnpm qa:live2d-rig` | Passed: 301 samples, 26 channels |
| `pnpm qa:test:model` | 4 files, 15 tests passed |
| `qa:motion3d` `idle` seed 1 at `531dc5aa2` and at `0814ff933` | `IDENTICAL` in all blocks |
| Rendered step 1 | The base saved a seven-field `gate`. The tip printed exactly one warning, `[situation-inner] Invalid stored fields reset to defaults: gate`, and kept `lastFireAtMs` and `day`. The threads, extraction positions, and rituals were unchanged. The profile had 0 threads, so this is a weak check for threads. A relaunch printed no warning |
| Rendered step 2, Natural | Natural's own idle act ran, a `zone-out`. A forced reach-out gave one `mind` step with `posture/cue about-to-speak` before `voice/speak`, an `idle` `about-to-speak` event, and the `turn`. 3 s later the record held `pacing.unanswered` 1 and `lastSpokenAtMs`, and `gate` held only `day` and `lastFireAtMs` |
| Rendered step 3, Universal | The cue and line arrived with no `idle` event, and the pacing updated (`unanswered` 2) |
| Rendered step 4 | The share zip has no `memories.json` or `character-state.json`. The backup has both, and the record carries `pacing` |
| Rendered step 5 | After a restart, the first evaluation's memory matched the stored pacing, with no warning. After `deleteAllData`, the `cards` store was empty, and the next evaluation reported `unanswered` 0 and `lastSpokenAtMs` null |
| Errors | Every launch had 0 renderer and 0 main-process errors |
| Seen and not changed | After a relaunch on a kept profile, the stage loads `preset-live2d-1` instead of the imported model. Step S saw the same, so it predates CM4a |

## Commits

- `e03b882d4` docs(plan): add the plan for the slow state slice of the character mind
- `bfbbc1ad7` feat(stage-shared,stage-ui): give the character-state record her pacing memory
- `8ef7892d0` refactor(character-mind,stage-ui,stage-tamagotchi): run one mind in the leader
- `4d5108f9e` feat(stage-ui,stage-pages,i18n): split the card export into share and back up
- `0814ff933` feat(stage-shared,character-mind,stage-ui): keep her pacing as the mind's slow state
- `deb63dc6d` docs(ai): record the slow state decisions and split the CM4 row

The 10 commits below `e03b882d4` are step S, cherry-picked from #56.
