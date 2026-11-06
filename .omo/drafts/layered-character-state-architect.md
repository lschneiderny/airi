# Advisory lane output: architect (st_01a1a36b), 2026-11-03
Claims to verify; not decisions.

st_01a1a36b [completed] transcript via event-log:
assistant: I read this as an advisory-only architecture consult - survey the ADR and the named package boundaries, then return a decomposition with options, a recommendation, and risks. I'll stop when all seven questions are answered with file:line citations in under ~1800 words.
tool: eval
assistant: Found the ADR and boundaries. Now I need the concrete seams: situation store, compose.ts, stage contract cues, memory database, Natural mood, reach-out gate, qa-tools, and the related ADRs.
tool: eval
assistant: Directory layout confirmed. Now reading the key seam files and the three related ADRs (persistence tiers, prompt composition, reach-out cadence).
tool: eval
tool: eval
tool: eval
assistant: All seven questions can be answered from what I read. Here is the consult.

## Layered character state: recommended decomposition

Repo claims cite `file:line`. Anything I could not confirm is marked **[unverified]**.

## 1. Where the pure model lives

**Option A - new package `packages/character-state`.** Clean boundary, own tests. Cost: a new workspace entry, `tsconfig` references, lockfile churn (the Copilot rules forbid touching package files unless required), and a second place for `qa-tools` to import scenario contracts from.

**Option B - `packages/stage-shared/src/character-state/` (recommended).** `stage-shared` already states its purpose as "the pure decision cores of the fork's character systems (`expression-performance`, `situation`, `performance-state`, ...)" (`packages/stage-shared/AGENTS.md:5`) and its decider rule is exactly what the ADR needs: "Resolvers and deciders take explicit time and return memory for the next call. They never read clocks, global randomness, or stores" (`AGENTS.md:30`). The situation reducer is the direct precedent (`packages/stage-shared/src/situation/reducer.ts`, `urge-gate.ts`), and `qa-tools` already shares a scenario contract from there (`AGENTS.md:21`). Export it as a subpath `@proj-airi/stage-shared/character-state`, matching the subpath convention (`AGENTS.md:26`).

Public API (all pure, time passed in):

```text
// types.ts  - Valibot schemas, versioned
CharacterStateV1 { version: 1, cardId, mood: { contributions: MoodContribution[] }, temperament: { valence, energy, updatedAtMs }, relationship?: ... }
MoodContribution { id, valence, energy, reason, source, atMs, halfLifeMs }
// reducer.ts
initialCharacterState(card: RestingDisposition, nowMs)
applyEvent(state, event: CharacterEvent, nowMs): CharacterState      // touch, unanswered reach-out, absence, model cue, significant exchange
advance(state, nowMs): CharacterState                                  // decay + temperament EMA; idempotent for equal nowMs
readMood(state, nowMs): { valence, energy, baseline, topReasons: MoodContribution[2] }
// render.ts
renderMoodSegment(reading, bands): string                              // words, not numbers; quantised (see risk 2)
faceBaseline(reading, sinceInteractionMs, settings): FaceBaseline     // { mouthCorner, eyeOpen, blinkRate, brow }
reachOutMoodFactor(reading): number                                    // bounded, e.g. 0.8..1.2
// migrate.ts
migrateCharacterState(unknown): CharacterStateV1
```

`applyEvent` for a model cue applies the ADR's shrink-near-extremes rule inside the reducer so every caller gets the same bound.

## 2. Which store owns runtime state

**Option A - leader-only like `useSituationStore`.** That store is "intentionally neither synced nor persisted: the leader is the only window that sends chat requests" (`packages/stage-ui/src/stores/situation/index.ts:218-221`). But mood has two readers the situation store does not: the face baseline runs in the stage window, and the devtools inspector may be a third window. The stage is not guaranteed to be the leader.

**Option B - fully synced Pinia store that any window writes.** Violates the persistence-tiers rule for tier 4 ("behind a synced store with leader-routed actions", `docs/ai/adr/2026-11-01-persistence-tiers.md:24`) and creates write races.

**Recommended: hybrid, modelled on tier 4 + tier 5.** `useCharacterStateStore` (new file `packages/stage-ui/src/stores/character-state.ts`) is a synced store built with `setupSynced` (`packages/stage-ui/src/libs/pinia/setup-synced.ts:24`). Only the leader folds events, runs `advance` on the existing 1 s leader ticker cadence (`index.ts:81`), and writes IndexedDB. The replicated value is the small `MoodReading` plus a `revision`, never the event list - tier 5 forbids replicating events (`persistence-tiers.md:25`). Followers (stage window, devtools) read the replicated reading; the stage computes `faceBaseline` locally from it. Writers from other windows (touch from the stage) already reach the leader through the situation touch bus (`stores/situation/touch-bus.ts`; `situationTouchObservedEvent` imported at `index.ts:71`), so mood events ride the same path: situation store calls `characterState.applyEvent` as a chat-store-style hook rather than the chat store growing logic (`packages/stage-ui/AGENTS.md:38`).

## 3. Persistence

Use IndexedDB per card, beside memory. Two drivers exist: `unstorage` mounts `airi-local` / `airi-sync-queue` (`packages/stage-ui/src/database/storage.ts:10-11`) and memory uses `localforage` instance `airi-memory` with a `navigator.locks` write lock (`memory.repo.ts:16-22`). Recommend **localforage, a new instance `airi-character-state`, store `cards`, one record per `cardId`**, and reuse the lock pattern (`airi:character-state`). Reason: the record is one document per card, not a key-value sync queue, and memory's repo shape (`list/write/remove/clear`, `memory.repo.ts:33-99`) is the one card export already understands.

Schema versioning: embed `version` in the record and validate with Valibot on read; `migrateCharacterState` runs in the repo's `load`, writes back under the lock. Register the store with `useDataMaintenance` (`packages/stage-ui/src/composables/use-data-maintenance.ts:46`) in the same commit, as the tiers ADR requires (`persistence-tiers.md:12`). Card delete = `repo.remove(cardId)`. Card export: add the record under an owned extension field of the card JSON; the stage-ui rule "Preserve unowned character-card extension fields" (`AGENTS.md:84`) means pick one namespaced key. **[unverified]** which module writes card export today - I did not read `src/libs/character-card-sync/`.

Load applies elapsed decay: `advance(loaded, Date.now())` on leader promotion, which is what the ADR asks for (restart keeps mood, long absence returns to baseline).

## 4. Integration seams

- **Prompt segment.** Add `mood` to `PROMPT_SEGMENT_ORDER` and `PROMPT_SEGMENT_BUDGETS` in the **tail** tier, `truncate`, ~400 chars (`compose.ts:6`, `:25-40`). Place it after `memory`, before `toolset`. The prompt ADR says a new segment needs an order row, a budget row, and an amendment (`prompt-composition.md`, Consequences). Callers already go through `composePrompt(buildChatPromptSegments(...))` (`stores/character/orchestrator/store.ts:187`, `chat.ts:897`), so the segment is added in `buildChatPromptSegments` only. **[unverified]** its definition file - grep for `export function buildChatPromptSegments` returned nothing; it may be a `const` or re-export.
- **MOOD cue.** Add `MOOD` to `STAGE_RUNTIME_CONFIG.recoverCueNames` (`stage-contract/index.ts:26`) only if near-miss recovery is wanted; add the cue text to the contract rendering (`renderStageContract`, `index.ts:38-41`) and bump `STAGE_CONTRACT_EN_SHA256` (`index.ts:62`). The eval oracle fixtures in core-agent (`cue-compliance.ts`, `cue-contract-fixtures.ts`) must gain the cue in the same commit, per `packages/core-agent/AGENTS.md:27`. core-agent itself gets no mood input: it takes stage semantics "from the host as options or dependencies" (`AGENTS.md:27`), so the parsed `MOOD` cue reaches the character-state store through the existing chat hook registry (`onTokenLiteral` is already consumed by the situation store, `index.ts:200`).
- **Reach-out factor.** `hazardsOf` already composes a `multipliers` record (`urge-gate.ts:380-388`) that the inspector traces. Add `mood: number` to `UrgeGateMultipliers` and to `UrgeGateInput`, multiplied into `open` only (not ritual/due/continuation), so sulky does not cancel a due reminder. Default 1 keeps `gate.simulation.test.ts` stable.
- **Face baseline.** Natural's `NaturalMood` is the moment layer (`mood.ts:22-83`) and `modulateByMood` / `moodMouthForm` read it (`mood-modulation.ts:15-30`). Do **not** dose the slow baseline into `NaturalMood` - its `step` decays everything with `valenceTau` (`mood.ts:76-81`), so a slow offset would be eaten in seconds. Add a separate `FaceBaseline` input on the Natural controller (new `baseline.ts`, consumed in `face.ts`), additive after the moment layer, clamped per channel. This keeps "Preserve seeded stream indices, integration order, and numeric behavior" (`motion-driver-natural/AGENTS.md`) intact when the baseline is zero.

## 5. Time-travel harness

**Devtools fast-forward** needs a fake clock threaded through the leader ticker and sensors; it is the most realistic but least repeatable. **Pure simulator CLI in qa-tools** is cheap because the model is pure: a `pnpm qa:character-state simulate --scenario <file> --days 30` command under `packages/qa-tools/src/character-state/` that feeds a scripted event timeline through `applyEvent`/`advance` and prints mood/temperament traces, mirroring the motion gate CLI (`qa-tools/src/motion/gate/cli.ts`). **Recommend both, in that order of value: CLI first (wave 2), devtools "jump clock" later.** The devtools version can be a thin wrapper that calls `applyEvent`/`advance` with a synthetic `nowMs` and writes the result through the leader action - no fake clock in sensors.

Model-eval relationship-stage scenario: the model pipeline already has prompt fixtures (`qa-tools/src/model/prompt.ts:33 segmentsFromFixture`) and a transcript scorer. Add fixtures that supply the `mood` segment and (plan 2) a relationship segment at three stages, run the same user turns, and score with a new style dimension (nickname use, initiative) in `score/style.ts`. Runs record the new contract SHA, as the ADR notes.

## 6. Wave order

Wave 0 (serial, one owner): ADR amendment to prompt-composition + persistence-tiers; `character-state` types and reducer with tests. Write scope: `packages/stage-shared/src/character-state/**`, `docs/ai/adr/`.

Wave 1 (parallel, disjoint):
- Lane A: repo + store + data-maintenance registration + card export. Scope: `stage-ui/src/database/repos/character-state.repo.ts`, `stage-ui/src/stores/character-state.ts`, `use-data-maintenance.ts`, card sync module.
- Lane B: prompt segment + MOOD cue + contract hash + core-agent fixtures. Scope: `stage-shared/src/stage-contract/**`, `core-agent/src/runtime/cue-*.ts`, `buildChatPromptSegments` file.
- Lane C: urge-gate mood multiplier. Scope: `stage-shared/src/situation/urge-gate.ts` + tests.
- Lane D: Natural `FaceBaseline` input. Scope: `motion-driver-natural/src/{baseline,face}.ts`.
- Lane E: qa-tools simulator CLI. Scope: `qa-tools/src/character-state/**`.

Wave 2 (serial): wiring - situation store emits events to the character-state store, chat segment reads the store, stage reads the replicated reading into Natural, gate receives the factor. Scope: `stores/situation/index.ts`, `stores/chat.ts` (wiring lines only), stage conductor.

Wave 3: devtools inspector + jump-clock; model-eval fixtures.

## 7. Top 5 risks

1. **Cross-window races.** Stage touch and leader cue arrive on different windows. Mitigation: all events funnel to the leader (touch bus already does), the repo write holds `navigator.locks`, and the replicated value carries a `revision` so a follower never applies a stale snapshot over a newer one.
2. **Prompt-cache churn.** A mood line that changes every turn sits in the tail tier, so the prefix cache is safe (`compose.ts:2-4`), but a tail that changes per turn still invalidates everything after it. Mitigation: quantise mood into a small band vocabulary (5x5 words) and include reasons only when a contribution's remaining weight crosses a threshold, so the segment text is identical across most consecutive turns.
3. **Contract hash churn.** Adding `MOOD` changes `STAGE_CONTRACT_EN_SHA256` and the core-agent fixtures, and every prior eval run becomes incomparable. Mitigation: one commit for cue + hash + fixtures; record the version in the eval report; land it once in plan 1, not again in plan 2.
4. **Feedback loop.** Model reads "sulky", writes sulky, emits `[MOOD sad]`. Mitigation already in the ADR (bounded steps shrinking near extremes, decay); add a per-turn cap of one model cue and a daily cap on model-sourced magnitude in the reducer, and test the loop in the simulator with a worst-case "always confirms" model stub.
5. **Migration.** Months of state with changing constants. Mitigation: `version` field, Valibot validation on read, migration in the repo under the lock, and a rule that constants (half-lives, EMA) live in settings read at `advance` time, not baked into stored records, so retuning never requires a migration.
