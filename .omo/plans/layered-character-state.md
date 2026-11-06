# layered-character-state - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** For you, as the person she has a relationship with: her feelings now last for hours, carry a reason, and survive restarts. Her disposition drifts over days, and over weeks she grows closer to you, which shows as new behaviour like teasing, nicknames, and opening up, rather than as a meter.

**What you'll get:** Her text tone and her resting face follow a slow mood. She reaches out a little more when she is happy and a little less, or more pointedly, when she is hurt or ignored. A relationship that builds slowly and cannot be farmed. Card settings for her resting personality and starting relationship. A developer page to inspect everything and fast-forward time, and a simulator that plays out months in seconds.

**Why this approach:** All the logic is plain math with no hidden clock, so it can be tested and simulated exactly. The model only ever sees her state in words, in the part of the request that already changes every turn. Judging relationship moments reuses the summary call that already runs after each conversation, so it costs no extra model calls.

**What it will NOT do:** Show any mood or relationship values outside the developer page. Work on VRM models. Guess a starting relationship from your existing chat history. Run live model evaluations (it only prepares the test inputs for them).

**Effort:** XL
<!-- Effort is exactly ONE band, never hours/days. Quick = single edit, minutes of agent work; Short = one focused change, a few files; Medium = multi-file feature in one session; Large = several waves, one long session; XL = multi-session or architectural work. A written duration is rewritten to a band. -->
**Risk:** Medium - many packages and two cross-window flows (events into the leader window, mood out to the stage window), plus a stage contract hash change.
**Decisions to sanity-check:** the starting constants (how fast she warms up: about "close" after a month of regular use, "intimate" after about two months); the stage sentences that tell her how to behave at each relationship stage; dropping the numeric face mood from expression state feedback.

Your next move: start execution with `/ulw-execute layered-character-state` once the review below approves. Full execution detail follows below.

---

> TL;DR (machine): XL, Medium risk; 21 todos in 4 waves + F1-F4: pure character-state core (mood, temperament, relationship), IndexedDB store, MOOD cue, situation-context text, Natural face baseline, urge factor, extraction appraisal, card field, devtools page, qa:character simulator.

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected users:**
- **U1 Luke, the person in the relationship.** Today she talks, texts, reacts to pet and poke, and reaches out a few times a day, but her feelings reset within a minute and nothing accumulates. After: her mood lasts hours with a reason, her disposition drifts over days, and the relationship grows over weeks and shows up as new behaviour.
- **U2 the chat model.** Today it reads the per-request situation block (`packages/stage-ui/src/stores/chat.ts:337-357`), which can include the fast Natural mood as raw numbers when expression state feedback is on (`packages/stage-ui/src/composables/use-airi-runtime-prompt.ts:29-31`). After: it reads one feeling line and one relationship line in plain words, emits at most one bounded `MOOD` cue per turn, and never sees numbers.
- **U3 Luke or an agent as developer.** After: a devtools page shows every value, contribution, reason, and stage, can jump the clock, and a `qa:character` CLI simulates 30-90 days deterministically.
- **U4 later plans** (callbacks, nicknames content, live model-eval M2) consume the stored state and rendered text.

Design record: `docs/ai/adr/2026-11-03-layered-character-state.md`. Constants and formulas: Appendix A of this plan (copied from the advisory math lane, `.omo/drafts/layered-character-state-math.md`).

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Her text tone follows a mood that lasts hours, carries one or two reasons, survives restarts, decays by wall-clock time, and is not reset at 04:00. | Luke's decisions: mood shows in text; hours-to-days timescale; natural decay only. |
| IS-2 | Her resting face (mouth corners, eye openness, blink rate, brows) subtly matches the mood on Live2D and MMD, strongest right after an interaction, never frozen; fast reactions play on top unchanged; a zero baseline leaves motion bit-identical. | Luke: "show in face, or at least certain aspects of face"; Natural numeric-stability rule. |
| IS-3 | Mood scales how often she reaches out (open hazard only) and the reach-out wording; unanswered reach-outs and returns after absence move mood. | Luke chose "Rate + prompt". |
| IS-4 | Her resting disposition (temperament) drifts over days toward recent mood, anchored to the card's resting values. | Luke chose "Include now" for the days layer. |
| IS-5 | Closeness, trust, and familiarity grow with real engagement, cannot be farmed, never drop from absence except gentle familiarity erosion, trust drops faster than it builds; stages unlock teasing, nicknames, initiative, vulnerability, and callbacks; stage-ups land at the 04:00 rollover. | Product frame: realistic relationship over a long timeline. |
| IS-6 | None of this appears in the normal UI; the devtools Character page shows it all. Card resting disposition and starting stage are editable in the card editor because they describe who she is, not her live state. | Luke: hidden except devtools; card field editable. |
| IS-7 | The model sees exactly one mood, in words, plus a relationship line; the text changes only when a bucket, reason, or stage changes. | No contradictory signals; turn-to-turn stability. |
| IS-8 | State is durable per card in IndexedDB, schema-versioned with migration, included in card export and import, removed on card delete and by Delete all data. | Persistence-tiers ADR tier 4; months of state. |
| IS-9 | State is plain data independent of the provider or model. | Switching models keeps the relationship. |
| IS-10 | A deterministic simulator runs 30-90 days of scripted events and checks invariants; devtools can jump the clock; relationship-stage fixtures exist for model evaluation. | Long timelines cannot be tuned by live QA. |
| IS-11 | The model cannot run its mood away: bounded steps, rolling budgets, saturation, and caps are proven by property tests. | Feedback-loop risk. |
| IS-12 | When her state sits at rest (mood in its resting buckets, no live reason, relationship below `friendly`), the model receives no feeling or relationship text at all. | A flat "feeling even, steady" line is noise for U2. |
| GAP-1 | Only the 20-45 s Natural mood exists (`packages/motion-driver-natural/src/mood.ts:75-80`). | No hours-scale state. |
| GAP-2 | The model can see raw fast-mood numbers (`use-airi-runtime-prompt.ts:29-31`, `packages/stage-shared/src/situation/render.ts:177-183`). | Contradicts IS-7 once a slow mood exists. |
| GAP-3 | No `MOOD` cue in the contract, parser path, scorer, or fixtures. | IS-1, IS-11. |
| GAP-4 | Natural has no external baseline input and tension never reaches the face (`packages/motion-driver-natural/src/mood-modulation.ts:14-30`). | IS-2. |
| GAP-5 | The urge gate has no mood factor (`packages/stage-shared/src/situation/urge-gate.ts:380-388`); unanswered and return do not affect mood. | IS-3. |
| GAP-6 | No temperament, relationship model, thresholds, or relationship text. | IS-4, IS-5. |
| GAP-7 | No detection of disclosure, kept promise, unkind, hurtful, milestone, or significant moments. | IS-5. |
| GAP-8 | No repo, store, schema, card field, export, delete, or data-maintenance registration. | IS-6, IS-8, IS-9. |
| GAP-9 | No devtools page, clock jump, simulator, or stage fixtures. | IS-6, IS-10. |
| GAP-11 | No rule suppresses neutral text, and no runtime context message carries character state. | IS-12. |
| GAP-10 | The 2026-11-03 ADR says "two plans" and is `proposed`; persistence-tiers and reach-out cadence ADRs do not list the new state. | Docs ship with code. |

### Must have
- One pure core at `packages/stage-shared/src/character-state/` exported as `@proj-airi/stage-shared/character-state`: types and Valibot schemas, settings constants, mood, temperament, relationship, reducer (`applyEvent`, `advance`), rendering, face baseline, urge factor, cue parsing, migration. No clock, randomness, or store reads inside (`packages/stage-shared/AGENTS.md`).
- Three mood axes: valence and energy in [-1, 1], tension in [0, 1].
- Every number in Appendix A lives in one settings module (`settings.ts`) and is read at evaluation time, never stored in records.
- Feeling and relationship text reach the model as a sibling per-request runtime context message (`contextId: 'system:character'`) next to the situation block, never the system prompt.
- The `MOOD` cue is parsed, applied on the leader only, at most once per turn, and is never spoken or shown as text.
- Relationship events come from the existing exchange-end thread extraction call (no new model call).
- Storage: one record per card in a localforage instance `airi-character-state`, writes under `navigator.locks` name `airi:character-state`, behind a synced store whose mutating actions are leader-routed; replicated state is the small reading plus a revision, never events.
- Card field `extensions.airi.modules.character` `{ resting: { valence, energy, tension }, startingStage }` with neutral defaults, editable in the card editor, preserved on import and export.
- Relationship starts fresh (the card's starting stage) for every existing card.
- Delete all data, card delete, and the existing situation "forget everything" path clear the state.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No mood, temperament, or relationship values, labels, or meters in the chat window, stage, settings pages other than devtools, or notifications.
- No numbers in any model-facing text.
- No new dependency (no `fast-check`; seeded loops use `packages/stage-shared/src/situation/rng.ts`). No change to lockfile beyond the workspace subpath export.
- No change to the fast Natural mood (`NaturalMood` decay, doses, `active` gating) or to `motion-driver-natural` numeric behaviour when the baseline is zero.
- No VRM work (VRM does not use Natural).
- No second exchange-end model call; no change to the chat model's tools.
- No bootstrapping relationship values from chat history or memories.
- No live Electron QA by the agent (standing agreement); rows that need a live check are marked partial `[~]` for Luke.
- No live model-eval runner (milestone M2 is out of scope); this plan ships fixtures only.
- No edits to frozen non-English locales.
- No backward-compatibility shims beyond the schema migration function.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD for the pure core (todos 2-7, 9, 10, 11 pure parts): write the failing Vitest cases first, capture the red run, then implement. Tests-after for store, repo, wiring, and UI. Framework: Vitest through the package projects (`pnpm -F <pkg> exec vitest run --project node|browser <path>`); stage-ui browser tests run in headless Chromium.
- Property tests: seeded loops (`createRng` style from `packages/stage-shared/src/situation/rng.ts`), at least 200 seeds per property, fixed seed list in the test file.
- Every todo ends with `pnpm verify` passing on the working tree; the run waits in the foreground until it exits.
- Live Electron behaviour is not exercised by the agent. QA uses Vitest browser tests (real Chromium, real Pinia synced plugin), the `qa:character` simulator, the motion headless rig through `pnpm qa:motion` where named, and CLI output. Rows that still need a live look are marked `[~]` in the F3 report for Luke.
- Evidence: `.omo/evidence/layered-character-state/task-<N>-<slug>.<ext>`. Each todo lists its exact files.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

- Branch: `luke/feat/layered-character-state` off `main`; per-lane worktrees through `pnpm wt new <name>` for parallel lanes, each removed with `pnpm wt rm <name>` after its commit lands on the integration branch.
- Wave 0 (7 todos): 1 -> 2 -> {3, 4, 5 in parallel, disjoint files} -> 6 -> 7. Todo 8 has no core dependency and may start during wave 0.
- Wave 1 (8 todos): 8, 9, 10, 11, 14, 15 in parallel (disjoint write scopes listed per todo); 12 after 11; 13 after 12.
- Wave 2 (4 todos): 16, 17, 18, 19 in parallel. Write scopes: 16 owns `stores/character-state/situation-bridge.ts` and wiring lines in `stores/situation/index.ts` `startLeading` and `applyForget`; 18 owns the gate-tick line in `stores/situation/index.ts` and `situation-gate.vue` (16 and 18 touch different functions of the same file: land 16 first, then rebase 18); 17 owns `chat.ts`, `use-airi-runtime-prompt.ts`, `render.ts`, `base.yaml`; 19 owns the conductor and adapters.
- Wave 3 (2 todos): 20, then 21.
- Final wave: F1-F4 in parallel.
- Workers wait in the foreground for `pnpm verify` to exit before reporting (a known failure mode of earlier runs).
- After each wave lands, run the touched packages' whole Node projects once (`pnpm -F @proj-airi/stage-ui exec vitest run --project node`, `pnpm -F @proj-airi/stage-shared exec vitest run`), because row gates only run row-local files.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2 | 8 |
| 2 | 1 | 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15 | 8 |
| 3 | 2 | 6, 7 | 4, 5, 8 |
| 4 | 2 | 6 | 3, 5, 8 |
| 5 | 2 | 6, 7 | 3, 4, 8 |
| 6 | 3, 4, 5 | 7, 11, 15 | 8, 9, 10, 14 |
| 7 | 3, 5, 6 | 11, 15, 17, 19 | 8, 9, 10, 14 |
| 8 | - | 19 | 1-7, 9-15 |
| 9 | 2 | 18 | 3-8, 10-15 |
| 10 | 2 | 17 | 3-9, 11-15 |
| 11 | 6, 7 | 12, 16, 17, 18, 19, 20 | 8, 9, 10, 14, 15 |
| 12 | 2, 11 | 13 | 14, 15 |
| 13 | 12 | - | 14, 15, 16-19 |
| 14 | 2 | 16 | 3-13, 15 |
| 15 | 6, 7 | 21 | 8-14 |
| 16 | 11, 14 | 20 | 17, 19 (18 after 16 lands) |
| 17 | 7, 10, 11 | 20 | 16, 18, 19 |
| 18 | 9, 11, 16 (same file) | 20 | 17, 19 |
| 19 | 7, 8, 11 | 20 | 16, 17, 18 |
| 20 | 11, 16, 17, 18, 19 | 21 | - |
| 21 | 15, 20 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
### Wave 0 - decision record and pure core

- [x] 1. Revise the layered character state ADR to match this plan
  What to do: Edit `docs/ai/adr/2026-11-03-layered-character-state.md` (currently untracked; add it in this commit). (a) Delivery: one plan, `.omo/plans/layered-character-state.md`, replacing "Plan 1 / Plan 2". (b) Mood: three axes (valence, energy, tension), not two. (c) Prompt placement: feeling and relationship text are a sibling per-request runtime context message `system:character` next to the situation block, never a `composePrompt` segment; the prompt-composition ADR is unchanged. (d) Relationship events come from the exchange-end thread extraction call. (e) Card field `extensions.airi.modules.character` holds the resting disposition and starting stage, editable in the card editor. (f) Existing cards start fresh. (g) Expression state feedback no longer sends the fast Natural mood numbers; the feeling line is the only mood signal. (h) Neutral state renders no text. (i) Point to Appendix A of the plan for starting constants. Keep `Status: proposed` (todo 21 sets `accepted`). Follow the root AGENTS.md prose rules (complete sentences, no filler).
  Must NOT do: no other ADRs in this commit; no code.
  Closes: GAP-10
  Parallelization: Wave 0 | Blocked by: none | Blocks: 2
  References: `docs/ai/adr/2026-11-03-layered-character-state.md`; `docs/ai/adr/2026-11-01-prompt-composition.md`; `packages/stage-ui/src/stores/chat.ts:337-357`; decisions in `.omo/drafts/layered-character-state.md` (D-user-1..12).
  Acceptance criteria: `git diff --stat` shows only the ADR; `pnpm verify` exits 0 (lint step on the markdown).
  QA scenarios: happy - `pnpm exec eslint docs/ai/adr/2026-11-03-layered-character-state.md` exits 0, output saved to `.omo/evidence/layered-character-state/task-1-lint.txt`; failure - `rg -n "Plan 2|two axes|segment of the prompt composition" docs/ai/adr/2026-11-03-layered-character-state.md` returns no matches (exit 1), saved to `task-1-stale-terms.txt`.
  Commit: Y | docs(adr): record the layered character state decisions
  Recommended task executor category: writing - prose-only ADR revision.

- [x] 2. Add the character-state core types, schemas, settings, and subpath export
  What to do: Create `packages/stage-shared/src/character-state/{types.ts,settings.ts,index.ts}` and add `"./character-state": "./src/character-state/index.ts"` to `packages/stage-shared/package.json` `exports` beside `"./situation"`. Types and Valibot schemas (Valibot near consumers, as the repo does): `MoodAxes {valence, energy, tension}`; `MoodSource` = `model-cue | touch | reach-out-unanswered | reply | return | significant | ritual`; `MoodContribution {id, source, reason, atMs, halfLifeMs, delta: MoodAxes, expiresAtMs}`; `CharacterProfile {resting: MoodAxes, startingStage: 'stranger' | 'friendly' | 'close'}` with default `{ resting: {valence: 0.1, energy: 0, tension: 0.15}, startingStage: 'stranger' }`; `RelationshipLevels {closeness, trust, familiarity}` in [0, 1]; `RelationshipStages {closeness: 'stranger'|'friendly'|'close'|'intimate', trust: 'guarded'|'open'|'confiding', familiarity: 'new'|'knows-you'}`; `CharacterStateRecordV1 {version: 1, cardId, createdAtMs, updatedAtMs, mood: {contributions: MoodContribution[] (max 64), modelCueLog: {atMs, delta}[]}, temperament: {axes: MoodAxes, throughHourMs}, relationship: {levels, stages, wound, woundAtMs, day: {key, sums: RelationshipLevels, negatives, milestones, countedTouchHours: number[]}, activeDays, milestoneIds: string[] (max 64, newest kept), lastSeenAtMs, lastDayKey, pendingStageUps}, history: DailySummary[] (max 400, one per logical day: {dayKey, mood: MoodAxes mean, temperament: MoodAxes, levels, stages})}`; `CharacterEvent` discriminated union for every event in Appendix A tables A2 and A5 plus `model-cue {directions, reason, turnId}`; `CharacterReading {mood: MoodAxes, resting: MoodAxes, temperament: MoodAxes, buckets, reasons: {id, text, atMs}[], levels, stages, unlocks: string[], urgeFactor, pointed: boolean, lastInteractionAtMs, renderKey}`; `AdvanceContext {nowMs, logicalDayKeyOf(ms): string, logicalDayStartOf(ms): number}` so the pure core never reads a clock or time zone. `settings.ts` exports one frozen `CHARACTER_STATE_SETTINGS` object holding every constant in Appendix A, grouped by layer. `index.ts` re-exports the public API of todos 2-7.
  Must NOT do: no `Date.now()`, `Math.random()`, Vue, Pinia, or stage-ui imports (`packages/stage-shared/AGENTS.md`); no constants stored inside records.
  Closes: GAP-6, GAP-8 (schema)
  Parallelization: Wave 0 | Blocked by: 1 | Blocks: 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15
  References: `packages/stage-shared/AGENTS.md` (deciders take explicit time); `packages/stage-shared/package.json:17-35` (exports map); `packages/stage-shared/src/situation/types.ts` (schema style); `packages/stage-ui/src/features/situation/inner-state.ts` (Valibot `v: optional(literal(1), 1)` versioning pattern); Appendix A.
  Acceptance criteria (TDD): `types.test.ts` written first and seen failing, then `pnpm -F @proj-airi/stage-shared exec vitest run src/character-state/types.test.ts` passes: the default profile parses; a record with 65 contributions or 65 milestone ids or 401 history rows fails validation; an unknown event kind fails; `CHARACTER_STATE_SETTINGS` is frozen (`Object.isFrozen`).
  QA scenarios: happy - the vitest run above, saved to `.omo/evidence/layered-character-state/task-2-vitest.txt`; failure - a scratch file in `packages/qa-tools/src` importing `@proj-airi/stage-shared/character-state/nonexistent` makes `pnpm -F @proj-airi/qa-tools typecheck` fail, while importing `@proj-airi/stage-shared/character-state` passes; both outputs saved to `task-2-typecheck.txt`, scratch file removed afterwards and the removal shown by `git status --short`.
  Commit: Y | feat(stage-shared): add character state types, schemas, and settings
  Recommended task executor category: deep-low - typed contracts settled by this plan.

- [x] 3. Implement the mood model with budgets, headroom, saturation, and pruning
  What to do: `packages/stage-shared/src/character-state/mood.ts`: `remaining`, `rawAt`, `moodAt(contributions, temperament, nowMs)` using Appendix A1 formulas (`tanh(atanh(T) + raw)` for valence and energy, logistic with gain 4 for tension, `atanh` input clamped to ±0.999); `insertContribution(state, event, ctx)` applying the A2 event table, headroom rail |raw| <= 2.5, the model-cue step 0.08 per axis with 90 min half-life, the rolling 60 min model budget 0.24 per axis (excess truncated), the pleasant-touch budget 0.3 per hour, the significant cap 2 per logical day, idempotency by `id`, and `expiresAtMs = atMs + halfLifeMs * log2(maxAbs(delta) / 0.01)`; `pruneMood(state, nowMs)` removing only expired entries.
  Must NOT do: no reads of the Natural fast mood; no numbers leave this module as text.
  Closes: GAP-1, part of GAP-3 (budgets)
  Parallelization: Wave 0 | Blocked by: 2 | Blocks: 6, 7 | Parallel with: 4, 5
  References: Appendix A1, A2; `packages/motion-driver-natural/src/mood.ts:22-80` (fast mood, for contrast only).
  Acceptance criteria (TDD, tests first in `mood.test.ts`): ten `brighter` cues with distinct turn ids at the same `atMs` from resting valence 0.10 give valence 0.328 ± 0.001 at that instant (three accepted, seven truncated by the budget); 4,320 `brighter` cues one per minute over three days, sampled after every cue, keep model-only raw valence <= 0.65 (the burst peak `0.24 / (1 - 2^(-60/90))` = 0.649; a scratch simulation of this exact stream peaked at 0.644) and valence <= 0.64, with live contributions <= 64; a `hurtful` significant event plus a second unanswered reach-out at resting tension 0.15 give (v, e, t) = (-0.26, -0.15, 0.32) ± 0.01 immediately and v = -0.07 ± 0.01 after 9 h; applying the same event id twice equals applying it once; `moodAt(pruneMood(s, t), t')` deep-equals `moodAt(s, t')` for 200 seeded random states and t' >= t; with no inserts |raw| never increases over 200 seeded timelines.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-shared exec vitest run src/character-state/mood.test.ts` green, saved `task-3-vitest.txt`; failure - red run captured before implementation, saved `task-3-red.txt`.
  Commit: Y | feat(stage-shared): add the hours-scale mood model
  Recommended task executor category: deep-low - formulas fully specified in Appendix A.

- [x] 4. Implement temperament as an epoch-hour anchored average
  What to do: `packages/stage-shared/src/character-state/temperament.ts`: `advanceTemperament(temperament, contributions, resting, nowMs)` processing only completed epoch hours `[h, h + 1h)` after `throughHourMs` with Appendix A3 (`k_T = ln2 / 5 d`, `k_A = ln2 / 10 d`, sample mood at `h + 30 min`, clamp |T - R| to v 0.3, e 0.25, t 0.15); cap a single call at 400 days of hours and jump `throughHourMs` past older gaps by applying only the anchor pull in closed form for the skipped span.
  Must NOT do: no dependence on the load time; no randomness.
  Closes: GAP-6 (temperament)
  Parallelization: Wave 0 | Blocked by: 2 | Blocks: 6 | Parallel with: 3, 5
  References: Appendix A3.
  Acceptance criteria (TDD): advancing ten days in one call and in four arbitrary splits gives bit-identical axes (`toEqual`, 200 seeded split sets); one significant +0.25 valence event moves T.v from 0.100 to 0.115 ± 0.002 after one day and to 0.109 ± 0.002 after ten days; |T - R| never exceeds the clamp under the 3-day model-spam stream from todo 3; with no contributions |T - R| never increases.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-shared exec vitest run src/character-state/temperament.test.ts` green, `task-4-vitest.txt`; failure - red run before implementation, `task-4-red.txt`.
  Commit: Y | feat(stage-shared): add the days-scale temperament layer
  Recommended task executor category: deep-low - specified math.

- [x] 5. Implement the relationship layer with daily diminishing returns, asymmetric trust, and staged hysteresis
  What to do: `packages/stage-shared/src/character-state/relationship.ts`: `applyRelationshipEvent(rel, event, ctx)` with Appendix A5 points, per-logical-day sums and `E(S) = G (1 - e^-S)` with G closeness 0.02, trust 0.012, familiarity 0.03, `level += (1 - level) ΔE`, trust gains times `(1 - wound)`, wound half-life 5 d, unkind and hurtful multipliers, at most 2 negative events per day, pleasant touch counted at most once per hour, milestone at most 1 per day (id appended to `milestoneIds`, cap 64 newest); `absenceOnReturn(rel, gapMs)` touching familiarity only after a 3-day grace; `rolloverStages(rel, dayKey)` applying at most one stage-up per dimension per rollover from `pendingStageUps`, while stage-downs apply immediately inside `applyRelationshipEvent`; `unlocksOf(stages, milestoneCount)` per A6; `initialRelationship(profile)` mapping `startingStage` to levels at the stage's up-threshold plus 0.01.
  Must NOT do: absence never changes closeness or trust; positive events never lower a level.
  Closes: GAP-6 (relationship)
  Parallelization: Wave 0 | Blocked by: 2 | Blocks: 6, 7 | Parallel with: 3, 4
  References: Appendix A5, A6.
  Acceptance criteria (TDD): a day with sum 10 gives G per dimension within 1e-4 (farming cap), and the day's gain never exceeds G; a 10-day gap reduces familiarity by 3% ± 0.5% and leaves closeness and trust unchanged; a hurtful event drops trust by 15% and further same-day negatives beyond two are ignored; ±0.005 seeded noise around every threshold produces at most one stage change per rollover and zero stage-downs over 200 seeds; a level crossing `close` up-threshold mid-day changes the stage only at the next rollover; a crossing of a down-threshold changes it immediately; the 30-day typical scenario of A7 ends with closeness 0.35 ± 0.03.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-shared exec vitest run src/character-state/relationship.test.ts` green, `task-5-vitest.txt`; failure - red run before implementation, `task-5-red.txt`.
  Commit: Y | feat(stage-shared): add the relationship layer
  Recommended task executor category: deep-low - specified rules.

- [x] 6. Add the reducer, advance, daily history, and record migration
  What to do: `packages/stage-shared/src/character-state/reducer.ts`: `initialCharacterState(cardId, profile, ctx)`, `applyEvent(state, event, profile, ctx)` routing mood and relationship parts and updating `lastInteractionAtMs` for user turns, touch, and character speech events, `advance(state, profile, ctx)` (prune mood, advance temperament, decay wound, run `rolloverStages` once per crossed logical day, append one `DailySummary` per completed logical day, trim history to 400), idempotent for equal `nowMs`. `migrate.ts`: `migrateCharacterState(value: unknown, cardId, profile, ctx)` returning a valid V1 record: V1 passes through after validation with per-field fallback (an invalid field resets to its initial value, like `readStoredInnerState`), anything else returns `initialCharacterState`.
  Must NOT do: no backward-compatibility branches beyond `migrate.ts`.
  Closes: GAP-6, GAP-8 (replay)
  Parallelization: Wave 0 | Blocked by: 3, 4, 5 | Blocks: 7, 11, 15
  References: `packages/stage-ui/src/features/situation/inner-state.ts` (`readStoredInnerState` per-field validation); Appendix A.
  Acceptance criteria (TDD): `advance(advance(s, t1), t2)` deep-equals `advance(s, t2)` for 200 seeded states and t1 < t2; `migrateCharacterState(JSON.parse(JSON.stringify(s)))` deep-equals `s`; a record with one corrupted relationship field keeps its mood contributions; crossing three rollovers appends exactly three history rows; 401 days keep 400 rows.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-shared exec vitest run src/character-state` green, `task-6-vitest.txt`; failure - red run, `task-6-red.txt`.
  Commit: Y | feat(stage-shared): add the character state reducer and migration
  Recommended task executor category: deep-low.

- [x] 7. Add reading, rendering to words, face baseline, urge factor, and MOOD cue parsing
  What to do: In `packages/stage-shared/src/character-state/`: `reading.ts` `readCharacter(state, profile, previous: CharacterReading | null, ctx)` producing buckets with exit hysteresis, reasons (weight per A4, model-cue weight x0.5, top two with w >= 0.04, sticky until w < 0.03 or < half the best excluded, ordered by `atMs`), unlocks, `urgeFactor` (A8), `pointed` (A8 rule), and `renderKey` = JSON of `{buckets, reasonIds, reasonTimeWords, stages, unlocks}`, so every change of rendered text (including a time word moving from "earlier today" to "yesterday") changes the key and nothing else does. `render.ts` `renderCharacterContext(reading, ctx)` returning `''` when every bucket equals the resting bucket, no reason is live, and closeness is below `friendly` (IS-12), else at most two English lines: `Feeling: <valence word>, <energy word>[, <tension word>] (<reason>; <reason>).` with coarse time words from the logical day ("earlier today", "last night", "yesterday", "a few days ago"), and `You two: <stage sentence>.` from A6 wording (for example "you are close and comfortable with him; you can tease him a little; you may use a nickname for him if you have one", when those unlocks are reached; the stage and unlock sentences were corrected by row 22, see A6). `face.ts` `faceBaselineOf(reading, nowMs)` per A9 with damping `D(τ)` and per-channel clamps. `cue.ts` `parseMoodCue(body)`: grammar `<|MOOD w1[ w2]: reason|>`, words from {brighter, lower, livelier, tireder, tenser, calmer}, at most two, contradictory pairs (brighter+lower, livelier+tireder, tenser+calmer) rejected, reason trimmed to 60 characters with `<|`, `|>`, and newlines removed; returns directions per axis in {-1, 0, 1} or `null`.
  Must NOT do: no digits in rendered text (assert); no i18n (the situation block family is English, see `use-airi-runtime-prompt.ts:56-60`).
  Closes: GAP-2 (text side), GAP-3 (parse), GAP-11, IS-7, IS-12
  Parallelization: Wave 0 | Blocked by: 3, 5, 6 | Blocks: 11, 15, 17, 19
  References: Appendix A4, A6, A8, A9; `packages/stage-shared/src/situation/render.ts:17-19,177-199` (English block style).
  Acceptance criteria (TDD): a resting state renders `''`; valence oscillating ±0.04 around 0.15 for 200 seeded sequences never changes the bucket; ranking changes never reorder reasons; `renderCharacterContext` output never matches `/\d/`; `urgeFactor` for (0.4, 0.2, 0.1) is 1.185 ± 0.001 and for (-0.4, -0.1, 0.5) is 0.823 ± 0.001; `faceBaselineOf` returns all-zero offsets (including `blinkRateOffset` 0) when mood equals resting; `parseMoodCue('brighter tenser: he remembered')` returns directions (1, 0, 1); `parseMoodCue('brighter lower: x')` and `parseMoodCue('happy')` return `null`.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-shared exec vitest run src/character-state` green, `task-7-vitest.txt`; failure - red run, `task-7-red.txt`.
  Commit: Y | feat(stage-shared): render character state and parse the MOOD cue
  Recommended task executor category: deep-low.

### Wave 1 - parallel lanes with disjoint write scopes

- [x] 8. Add an external face baseline input to the Natural driver
  What to do: In `packages/motion-driver-natural/src/`: add `baseline.ts` (`FaceBaseline {mouthForm, eyeOpen, blinkRateOffset, browAngle}`, every field an offset that is neutral at 0 and zero by default, first-order filter τ = 1.5 s stepped with the driver's dt), `NaturalMotion.setFaceBaseline(baseline)` storing the target, and apply the filtered value in the step: add `mouthForm` and `browAngle` offsets in `withHints` (`face-hints.ts:13`, called at `natural-motion.ts:673`) after the existing `moodMouthForm` term, multiply `eyeOpenMultiplier` by `1 + eyeOpen` at `natural-motion.ts:686`, and set the blink scheduler's `intervalScale` fresh on every step as `base / (1 + blinkRateOffset)`, where `base` is `mod.blinkInterval` when `performanceSettings.heldEmotions` is on (today assigned at `natural-motion.ts:585`) and `1` when it is off (today set once at `:420-421`). Compute from `base` each step; never multiply into the stored `intervalScale`, which would compound. Use the brow sign that `impulses.ts:14-18` uses for a worried brow. Export the type from the package index.
  Must NOT do: no change to `NaturalMood`, its decay, `active`, seeded stream order, or numeric behaviour at zero baseline (`packages/motion-driver-natural/AGENTS.md`).
  Closes: GAP-4
  Parallelization: Wave 1 | Blocked by: none (independent of the core) | Blocks: 19 | Parallel with: 9-15
  References: `packages/motion-driver-natural/src/{face-hints.ts:13-43,natural-motion.ts:388-412,421,585,673-693,blink.ts:32-77,face.ts:12-103,impulses.ts:14-18,mood.test.ts:49-68}`; `packages/qa-tools/src/motion/cache/guard.test.ts:26` (the source hash changes; expected).
  Acceptance criteria: new `baseline.test.ts`: two `NaturalMotion` instances with the same seed, one with `setFaceBaseline` never called and one set to all zeros, produce deep-equal frames over 600 steps; a non-zero baseline reaches its target within 5 τ and moves `mouthForm`, `eyeOpenMultiplier`, brow angle, and blink interval in the stated direction; an existing held-emotion blink modulation is still applied with a baseline set; a non-zero `blinkRateOffset` changes the blink interval with held emotions both on and off; with held emotions off and a constant non-zero offset, `intervalScale` after 600 steps equals its value after 60 steps (no compounding). `pnpm -F @proj-airi/motion-driver-natural exec vitest run` green; `pnpm -F @proj-airi/qa-tools exec vitest run src/motion/cache` green after updating only the expected hash fixture if the guard pins one.
  QA scenarios: happy - `pnpm -F @proj-airi/motion-driver-natural exec vitest run src/baseline.test.ts`, `task-8-vitest.txt`; failure - same file with the zero-baseline equality case run against a deliberately non-zero baseline must fail (capture once, revert), `task-8-mutation.txt`.
  Commit: Y | feat(motion-driver-natural): accept an external face baseline
  Recommended task executor category: deep-low - motion math with exact hooks named.

- [x] 9. Let mood scale the reach-out open hazard
  What to do: In `packages/stage-shared/src/situation/urge-gate.ts`: add `moodFactor?: number` to `UrgeGateInput` (default 1, clamped to [0.67, 1.35]) and `mood: number` to `UrgeGateMultipliers`; multiply it into the `open` hazard only (`urge-gate.ts:380-396`), not ritual, due, or continuation. Amend `docs/ai/adr/2026-10-29-unprompted-reach-out-cadence.md` with a short dated section naming the factor and its range.
  Must NOT do: no change to `urge.ts` rates, `SAFETY_CAP_PER_HOUR`, floors, or RNG draw count.
  Closes: GAP-5 (gate side)
  Parallelization: Wave 1 | Blocked by: 2 | Blocks: 18 | Parallel with: 8, 10-15
  References: `packages/stage-shared/src/situation/{urge-gate.ts:360-400,urge.ts,gate.simulation.test.ts,urge-gate.test.ts}`.
  Acceptance criteria (TDD): `urge-gate.test.ts` new cases: factor 1.35 multiplies the open hazard by 1.35 and leaves ritual and due hazards unchanged; factor 5 is clamped to 1.35; omitted factor leaves every existing trace identical; `gate.simulation.test.ts` unchanged and green.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-shared exec vitest run src/situation` green, `task-9-vitest.txt`; failure - red run before implementation, `task-9-red.txt`.
  Commit: Y | feat(stage-shared): scale the reach-out open hazard by mood
  Recommended task executor category: quick - one multiplier with tests named.

- [x] 10. Add the MOOD cue to the stage contract, scorer, and fixtures
  What to do: Add an English `base.prompt.mood` key to `packages/i18n/src/locales/en/base.yaml` (one short paragraph: when her feelings shift during a reply she may add one `<|MOOD word[ word]: short reason|>` marker, words from the closed list, never more than one per reply, never numbers) and render it in `renderStageContract` (`packages/stage-shared/src/stage-contract/index.ts:28,38-41`) after the emotion section. Update `STAGE_CONTRACT_EN_SHA256` (`index.ts:62`) and the hash pins in `packages/stage-shared/src/stage-contract/index.test.ts:35-45`, `packages/stage-ui/src/composables/use-airi-runtime-prompt.test.ts`, and `packages/qa-tools/src/model/stage-contract.test.ts`. Teach the qa-tools scorer to count MOOD markers (`packages/qa-tools/src/model/score/cue-contract.ts:10,47-56,186-189`, bump its version) and add MOOD fixtures to `packages/core-agent/src/runtime/cue-contract-fixtures.ts`. Confirm in a test that a reply `Hi<|MOOD brighter: you came back|>` speaks and stores `Hi` only (the marker reaches special-token hooks and is stripped from speech like ACT; see `chat-orchestrator-runtime.test.ts:2007-2019`). Rebuild i18n dist (`pnpm -F @proj-airi/i18n build`) before contract tests.
  Must NOT do: do not add MOOD to `recoverCueNames` (near-miss spellings stay prose); no core-agent runtime logic change; no other locales.
  Closes: GAP-3
  Parallelization: Wave 1 | Blocked by: 2 | Blocks: 17 | Parallel with: 8, 9, 11-15
  References: as listed; `packages/core-agent/AGENTS.md` (fixtures change with the cue); `packages/i18n/AGENTS.md`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/stage-contract`, `pnpm -F @proj-airi/core-agent exec vitest run src/runtime`, `pnpm -F @proj-airi/qa-tools exec vitest run src/model` all green; `pnpm qa:model prompt --json` prints the new contract hash.
  QA scenarios: happy - `pnpm qa:model prompt --json > .omo/evidence/layered-character-state/task-10-prompt.json` contains `<|MOOD`; failure - the speech test above fails when the stripping assertion is pointed at `Hi<|MOOD` (capture once), `task-10-speech.txt`.
  Commit: Y | feat(stage-shared): add the MOOD cue to the stage contract
  Recommended task executor category: unspecified-high - cross-package contract change with pinned hashes.

- [x] 11. Add the character-state repository and synced store
  What to do: Read `.agents/skills/enforce-rules-for-pinia-synced/SKILL.md` first. Create `packages/stage-ui/src/database/repos/character-state.repo.ts` (localforage instance `airi-character-state`, store `cards`, one record per `cardId`, writes inside `navigator.locks.request('airi:character-state')`, `load(cardId)`, `save(record)`, `remove(cardId)`, `clear()`, `loadAll()`), its Node mock `database/repos/__mocks__/character-state.repo.ts` (pattern: `__mocks__/memory.repo.ts`), and `packages/stage-ui/src/stores/character-state.ts`: a synced store whose replicated state is `{ cardId, reading: CharacterReading | null, revision, updatedAtMs }` only; leader-routed actions `apply(event)`, `forget(cardId | 'everything')`, `importRecord(cardId, record | null)` (validates through `migrateCharacterState`, writes the record or a fresh initial state for the card), `devtoolsJump(ms)`, `devtoolsApply(event)`; on gaining leadership it loads the active card's record through `migrateCharacterState`, calls `advance`, and starts a 60 s advance ticker; it saves after each event (debounced 2 s) and on hide; followers never write storage and ignore a snapshot whose `revision` is lower than the one they hold; active-card switches load the other record. `logicalDayKeyOf` and `logicalDayStartOf` are built from the existing 04:00 helpers `localLogicalDayKey` (`packages/stage-ui/src/features/situation/inner-state.ts`), `LOGICAL_DAY_ROLLOVER_HOUR`, and `nextLogicalDayEndsAtMs` (`stores/situation/index.ts:143-159`); import them rather than re-implementing, and export one only if it is module-private. Register `resetState` in `resetModulesSettings` (`composables/use-data-maintenance.ts:88-103`). Add a row to `docs/ai/adr/2026-11-01-persistence-tiers.md` tier 4 members.
  Must NOT do: no events in replicated state; no writes from followers; no `Date.now()` inside pure calls (pass it in).
  Closes: GAP-8
  Parallelization: Wave 1 | Blocked by: 6, 7 (uses `readCharacter`) | Blocks: 12, 16, 17, 18, 19, 20 | Parallel with: 8-10, 14, 15
  References: `packages/stage-ui/src/database/repos/memory.repo.ts:8-99`; `packages/stage-ui/src/libs/pinia/setup-synced.ts:24`; `packages/stage-ui/src/stores/situation/index.ts:214-236` (leader-only rationale), `:81` ticker; `packages/stage-ui/src/composables/use-data-maintenance.{ts,browser.test.ts}`; `docs/ai/adr/2026-11-01-persistence-tiers.md:12-25`.
  Acceptance criteria: node tests `stores/character-state.test.ts` (fake leadership like `situation/index.test.ts:83`): leader apply updates the reading and revision; a follower apply forwards to the leader; a stale snapshot is ignored; reload restores the record and applies elapsed decay. Browser test: `use-data-maintenance.browser.test.ts` gains a case proving Delete all data empties `airi-character-state`. `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/character-state.test.ts` and `--project browser src/composables/use-data-maintenance.browser.test.ts` green.
  QA scenarios: happy - both runs saved to `task-11-node.txt` and `task-11-browser.txt`; failure - a follower-write case asserting storage stays untouched, red when the follower guard is commented out (capture once), `task-11-guard.txt`.
  Commit: Y | feat(stage-ui): persist character state behind a leader-routed store
  Recommended task executor category: unspecified-high - synced store and IndexedDB with cross-window rules.

- [x] 12. Carry the character profile and state through cards, import, export, and delete
  What to do: Add `character?: CharacterProfile` to `AiriExtension.modules` (`packages/stage-ui/src/types/airiCard.ts:13-16`); carry it in `sanitizeAiri` (`services/airi-card-import-export.ts:232`) and `cardFromAiriCard` (`:199`) using the todo 2 schema (absent or invalid becomes the default). `exportAiriCardPackage` (`:87`) gains an optional `characterState` record written to a zip entry like memories; `importAiriCardPackage` (`:119`) returns it validated through `migrateCharacterState` (or `null`). The import caller `packages/stage-pages/src/pages/settings/airi-card/index.vue:65` calls `useCharacterStateStore().importRecord(newCardId, record)` (todo 11), which starts fresh from the profile when the record is `null`. The export caller `CardDetailDialog.vue:130` passes the current record. `removeCard` (`stores/modules/airi-card.ts:276-287`) also calls the repo `remove(id)`.
  Must NOT do: no change to `packages/ccc` codec; preserve unowned extension fields (`packages/stage-ui/AGENTS.md`).
  Closes: GAP-8 (cards)
  Parallelization: Wave 1 | Blocked by: 2, 11 | Blocks: 13 | Parallel with: 14, 15
  References: as listed; `packages/stage-ui/src/services/airi-card-import-export.test.ts:150-190` (memories round trip); `packages/stage-pages/src/pages/settings/airi-card/index.browser.test.ts:54`; `CardDetailDialog.browser.test.ts:89-99`; `packages/ccc/AGENTS.md`.
  Acceptance criteria: export then import round-trips the profile and the state record; a card zip without them imports with defaults and fresh state; an unknown `extensions.airi` field survives; deleting a card removes its record (node test with the repo mock). All named tests green.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/services/airi-card-import-export.test.ts`, `task-12-node.txt`; failure - an import with a corrupted `characterState` entry yields fresh state and no throw, `task-12-corrupt.txt`.
  Commit: Y | feat(stage-ui): carry character state through cards
  Recommended task executor category: unspecified-high.

- [x] 13. Let the card editor set her resting disposition and starting relationship
  What to do: Read `DESIGN.md` and `.agents/skills/enforce-rules-for-unocss/SKILL.md`. In the card editing UI under `packages/stage-pages/src/pages/settings/airi-card/components/` (locate the form that edits `extensions.airi.modules`, for example the performance profile fields), add a "Personality" group: three sliders (Cheerful to gloomy for valence, Energetic to calm-low for energy, Relaxed to tense for tension; range per schema, step 0.05) and a starting-relationship select (Stranger, Friendly, Close). English strings in `packages/i18n/src/locales/en/settings.yaml` (or the file that holds the card editor keys). No live values shown.
  Must NOT do: no display of current mood, temperament, or relationship; no other locales.
  Closes: GAP-8 (editable profile), IS-6
  Parallelization: Wave 1 | Blocked by: 12 | Blocks: none | Parallel with: 14, 15
  References: `packages/stage-pages/src/pages/settings/airi-card/components/CardDetailDialog.vue`; sibling card editor components; `DESIGN.md`; `packages/ui` primitives.
  Acceptance criteria: the performance profile fields live in `packages/stage-pages/src/pages/settings/airi-card/components/CardEditor.vue`, which has no browser test yet; create `CardEditor.browser.test.ts` beside it (pattern: `CardDetailDialog.browser.test.ts`) that sets each slider and the select, saves, and reads `extensions.airi.modules.character` back from the card store; text found via `t()` lookups.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-pages exec vitest run --project browser src/pages/settings/airi-card/components/CardEditor.browser.test.ts` green plus a component screenshot from the browser test saved to `task-13-editor.png`; failure - saving an out-of-range value (forced through the model) clamps to the schema range, `task-13-clamp.txt`.
  Commit: Y | feat(stage-pages): edit the character profile in the card editor
  Recommended task executor category: visual-engineering - form UI in the design system.

- [x] 14. Return relationship events from the exchange-end thread extraction
  What to do: In `packages/stage-ui/src/features/situation/thread-extraction.ts`: change the answer to a JSON object `{"threads": [...], "events": [...]}` (prompt text at `:101` and the `[]` instruction updated in the same commit); `events` is at most 3 items `{kind: 'disclosure' | 'kept-promise' | 'unkind' | 'hurtful' | 'milestone' | 'significant-positive' | 'significant-negative', reason: string (<= 60 chars, sanitized like thread text), memory?: string (<= 150 chars, milestones only)}`; add `onEvents(events, sessionId)` to `ThreadExtractorDeps`; the ledger entry (`ThreadExtractionLedgerEntry` and `stores/devtools/situation-observability.ts:161-178`) gains an `events` summary. A `length` finish reason fails both threads and events as today. Keep the added output small: the prompt asks for `"events": []` unless something clearly happened, reasons stay short, and the devtools ledger already shows the finish reason, so a rise in `length` failures is visible; record the answer length of every test fixture in the ledger assertion.
  Must NOT do: no second model call; no change to `EXTRACTION_MAX_TOKENS`, timeouts, or message caps.
  Closes: GAP-7
  Parallelization: Wave 1 | Blocked by: 2 | Blocks: 16 | Parallel with: 8-13, 15
  References: `packages/stage-ui/src/features/situation/thread-extraction.{ts,test.ts}` (`:39-48` schema, `:101` prompt, `:126,147` invalid cases, `:182-270` run).
  Acceptance criteria: existing thread cases pass with object-shaped answers; new cases: events parse and reach `onEvents`; unknown kinds, long reasons, marker text, or a bare array are `invalid`; a milestone without memory text is dropped; `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/features/situation/thread-extraction.test.ts` green.
  QA scenarios: happy - that run, `task-14-vitest.txt`; failure - an answer with `"kind": "love"` yields status `invalid` and no `onEvents` call, `task-14-invalid.txt`.
  Commit: Y | feat(stage-ui): extract relationship events with open threads
  Recommended task executor category: unspecified-high.

- [x] 15. Add the qa:character simulator CLI and relationship-stage fixtures
  What to do: Create `packages/qa-tools/src/character-state/{cli.ts,scenario.ts,scenarios/{typical-month,model-spam,absence,hurt}.json,cli.test.ts}` and a `character` script in `packages/qa-tools/package.json` plus root `"qa:character": "pnpm -F @proj-airi/qa-tools run character"` (pattern: `qa:motion`). Commands: `simulate --scenario <name|path> --days <n> --seed <n> [--json]` drives the pure core with a UTC logical-day context, checks every invariant of Appendix A10 each simulated hour, prints a daily table, and exits 1 on any violation; `render --stage stranger|friendly|close|intimate [--mood <bucket names>]` prints the exact `system:character` text. Write fixtures `packages/qa-tools/model-eval/fixtures/character-stages/<stage>.json` (`{stage, text}`) from `render` for a later live run (M2). Document both commands in `packages/qa-tools/README.md`.
  Must NOT do: no stage-ui import (qa-tools rule); no live model calls.
  Closes: GAP-9 (simulator, fixtures), IS-10, IS-11
  Parallelization: Wave 1 | Blocked by: 6, 7 | Blocks: 21 | Parallel with: 8-14
  References: `packages/qa-tools/src/motion/gate/cli.ts` (CLI shape); `packages/qa-tools/src/model/cli.ts:11-86` (usage, exit codes); root `package.json:35-39`; Appendix A7, A10.
  Acceptance criteria: `pnpm qa:character simulate --scenario typical-month --days 30 --seed 41 --json` exits 0 and reports closeness 0.35 ± 0.03 on day 30; `--scenario model-spam --days 3` (all `brighter`, one cue per minute, sampled after every cue) exits 0 with max model-only raw valence <= 0.65; `cli.test.ts` covers a scenario file that violates an invariant (an injected bogus event with delta 5) and expects exit 1.
  QA scenarios: happy - the 30-day run JSON saved to `task-15-month.json`; failure - the violating scenario run saved to `task-15-violation.txt` with exit code 1.
  Commit: Y | feat(qa-tools): add the character state simulator
  Recommended task executor category: deep-low.

- [x] 7F. Deduplicate repeated reason text in the rendered Feeling line
  What to do: In packages/stage-shared/src/character-state/reading.ts (shownReasons) or render.ts, never show two reasons with the same rendered text; when the top two contributions share text, show it once and take the next distinct reason that passes the A4 weight rule. Keep reason order by atMs and the sticky rule. Add a regression test: two touch-pleasant events one minute apart render the reason once.
  Closes: follow-up found by the todo 15 gate (reproduced: "Feeling: good, steady (he touched you gently earlier today; he touched you gently earlier today).")
  Parallelization: after 15 | Blocks: 17, 20
  Acceptance criteria: the regression test fails before the fix and passes after; pnpm -F @proj-airi/stage-shared exec vitest run src/character-state green; renderKey still changes exactly when text changes (existing 200-seed test).
  Commit: Y | fix(stage-shared): show each character reason once (fold into the todo 7 commit before the PR)
  Recommended task executor category: quick

### Wave 2 - wiring

- [x] 16. Feed situation and extraction events into character state
  What to do: Create `packages/stage-ui/src/stores/character-state/situation-bridge.ts` exporting `bridgeSituationToCharacter(...)`, called from the situation store's `startLeading` with wiring lines only. Map: reduced touch events `touch-pet` and `touch-pet-long` to pleasant touch, `touch-poke-burst` to unwelcome touch, plain `touch-poke` to nothing; a reach-out with no user reply 90 min after delivery to first unanswered, a second consecutive one to second unanswered, a user reply after an unanswered one to late reply, a user reply within 2 h of a reach-out to the relationship reply event; presence `returned` with the away gap to return (mood) and `absenceOnReturn` (relationship); user turns to first-real-exchange-of-day (third user turn of the logical day) and later-turn events; a user reply to a ritual reach-out to ritual reciprocated; extraction `onEvents` to the matching events, writing milestones as card-owned memory entries through `useMemoryStore().write({ description, body }, cardId)` and storing the returned id. Character speech updates `lastInteractionAtMs`. In the situation store's `applyForget` (`packages/stage-ui/src/stores/situation/index.ts:1105-1135`), when `request.scope === 'everything'`, also call `useCharacterStateStore().forget('everything')` (wiring line only; the follower-forwarding path already routes `forget` to the leader). Event ids are derived from source ids (reach-out turn id, touch event id, extraction ledger id) so replays are idempotent.
  Must NOT do: no logic in `chat.ts`; no change to gate timing.
  Closes: GAP-5 (event side), GAP-7 (wiring), IS-3, IS-5
  Parallelization: Wave 2 | Blocked by: 11, 14 | Blocks: 18, 20 | Parallel with: 17, 19
  References: `packages/stage-ui/src/stores/situation/index.ts` (`applyForget` `:1105-1135`, `startLeading`, `ingest`, `:1011` touch listener, thread extractor wiring near `createThreadExtractor`, `recordUrgeFireOutcome` and `recordUrgeUserTurn` call sites); `packages/stage-shared/src/situation/reducer.ts` (`applyTouch`, `applyPresence`); `packages/stage-ui/src/stores/memory.ts` (`write`); `packages/stage-ui/AGENTS.md` (chat.ts wiring only).
  Acceptance criteria: node tests in `situation-bridge.test.ts` drive the situation store with fake leadership and a fake clock: a pet raises valence; an unanswered reach-out after 90 min lowers valence once even when the gate ticks repeatedly; a disclosure event raises familiarity; a milestone writes one memory entry; replaying the same events changes nothing; after `situationStore.forget({ scope: 'everything' })` the character record is gone from the repo mock and the reading equals the initial state.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/character-state` green, `task-16-vitest.txt`; failure - the idempotency case fails when ids are randomized (capture once), `task-16-idempotency.txt`.
  Commit: Y | feat(stage-ui): feed situation and extraction events into character state
  Recommended task executor category: unspecified-high.

- [x] 17. Send the feeling and relationship text, consume MOOD cues, and drop the numeric mood
  What to do: (a) Add `useCharacterStateStore().observeChat(hooks)` and call it next to `situationStore.observeChat` (`packages/stage-ui/src/stores/chat.ts:851`): on a special token matching `<|MOOD ...|>` it parses with `parseMoodCue` and applies one `model-cue` event per turn (later ones ignored) on the leader. (b) Add `characterContextMessage()` beside `situationContextMessage` (`chat.ts:341`) returning a `ContextMessage` with `contextId: 'system:character'`, `strategy: ContextUpdateStrategy.ReplaceSelf`, text from `renderCharacterContext`, or `undefined` when the text is empty; include it wherever `situationContextMessage()` is included (grep its call sites), for user and unprompted turns. (c) Remove the numeric mood: delete `formatMood` and the `mood` field of `StageLiveState` (`composables/use-airi-runtime-prompt.ts:29-31,66-95`), drop `Mood: {mood}.` from `base.prompt.expression-state` (`packages/i18n/src/locales/en/base.yaml:80-81`), drop the `mood` part of `stageBullet` (`packages/stage-shared/src/situation/render.ts:177-183`) and its type fields (`situation/types.ts:96-101,220`); update `chat.contract.test.ts:2132-2240`, `use-airi-runtime-prompt.test.ts:106-176`, and render tests. (d) When `reading.pointed` is true on an unprompted turn, append the English `base.prompt.unprompted-pointed` sentence ("If you write, say one thing plainly about how you feel instead of several light messages.") to the unprompted segment.
  Must NOT do: no change to `composePrompt` order or budgets; the situation block's text for the same situation state stays byte-identical apart from the removed mood part.
  Closes: GAP-2, GAP-3 (consume), GAP-11, IS-1, IS-7, IS-12
  Parallelization: Wave 2 | Blocked by: 7, 10, 11 | Blocks: 20 | Parallel with: 16, 18, 19
  References: as listed; `packages/stage-ui/src/stores/chat/prompt.ts:80-93`; `packages/stage-ui/src/stores/situation/index.ts:204,394` (hook pattern).
  Acceptance criteria: `chat.contract.test.ts` new cases: a request carries a `system:character` context message when the state is not at rest and none at rest; an unprompted turn with a `pointed` reading carries the `base.prompt.unprompted-pointed` sentence in its unprompted segment and a `system:character` message, and an unprompted turn with an unpointed reading carries no pointed sentence; two MOOD markers in one reply apply one event; the stage line never contains `mood:`; no request text matches `valence \d`. All touched tests green.
  QA scenarios: happy - `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/chat.contract.test.ts`, `task-17-contract.txt`; failure - a reply with `<|MOOD happy: x|>` (invalid word) applies nothing, `task-17-invalid.txt`.
  Commit: Y | feat(stage-ui): send character context and consume MOOD cues
  Recommended task executor category: unspecified-high.

- [x] 18. Pass the mood factor into the reach-out gate
  What to do: In the situation store's gate tick (`stores/situation/index.ts`, `gateTick` near `:685`), pass `moodFactor: characterState.reading?.urgeFactor ?? 1` into `evaluateUrgeGate`; show `multipliers.mood` in the devtools gate trace (`packages/stage-pages/src/pages/devtools/situation/components/situation-gate.vue`) with an English i18n label.
  Must NOT do: no other gate change.
  Closes: GAP-5
  Parallelization: Wave 2 | Blocked by: 9, 11, 16 (same file, land 16 first) | Blocks: 20 | Parallel with: 17, 19
  References: `stores/situation/index.ts:88,270`; `situation-gate.vue:25-165`; `situation-gate.browser.test.ts:72`.
  Acceptance criteria: a node test with a sulky reading shows `multipliers.mood < 1` in the gate trace; `situation-gate.browser.test.ts` shows the mood row via `t()`.
  QA scenarios: happy - node and browser runs saved `task-18-node.txt`, `task-18-browser.txt`; failure - with no character store reading the trace shows mood 1, `task-18-default.txt`.
  Commit: Y | feat(stage-ui): let mood scale reach-out timing
  Recommended task executor category: unspecified-low.

- [x] 19. Drive the Live2D and MMD resting face from the replicated reading
  What to do: Add `setFaceBaseline(baseline)` to the stage scene API in `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` (beside `addMood`, `:104-107`) and implement it for Live2D (`packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts`, forwarding through `Live2D.vue:176` and `live2d/Model.vue:1694` like `addMood`) and MMD (`packages/stage-ui-mmd/src/composables/mmd/natural/adapter.ts`, wired in `MMD.vue`). The stage window reads `useCharacterStateStore().reading` (replicated) and calls `faceBaselineOf(reading, Date.now())` once per second, passing the result to the scene; no reading means a zero baseline.
  Must NOT do: no VRM change; no write to the character store from the stage.
  Closes: GAP-4 (wiring), IS-2
  Parallelization: Wave 2 | Blocked by: 7, 8, 11 | Blocks: 20 | Parallel with: 16-18
  References: as listed; `packages/stage-ui-mmd/src/composables/mmd/natural/face.ts:8-38` (Natural face mapping); `packages/stage-ui/src/components/scenes/stage-emotion-routing.browser.test.ts:519-547`.
  Acceptance criteria: adapter node tests (Live2D `natural-motion-adapter.test.ts`, MMD `adapter.test.ts`) prove the baseline reaches `NaturalMotion`; `stage-emotion-routing.browser.test.ts` gains a case where a low-valence, low-energy reading lowers the Natural `mouthForm` output and changes the blink interval after 10 s of fake time, and a resting reading leaves the blink interval equal to the no-baseline control.
  QA scenarios: happy - the adapter and browser runs, `task-19-*.txt`; failure - a null reading yields frames deep-equal to the no-baseline control, `task-19-null.txt`; live look on Luke's machine marked `[~]` in F3.
  Commit: Y | feat(stage-ui): show slow mood in the resting face
  Recommended task executor category: unspecified-high.

- [x] 7G. Let the mood buckets return to rest after decay
  What to do: In packages/stage-shared/src/character-state (render.ts bucketsOf / reading.ts), exit hysteresis currently keeps a bucket forever when the mood decays toward a temperament that sits on or inside the hysteresis band of the boundary (resting valence 0.10 = 0.15 - 0.05, so a reading that ever entered 'good' never returns to 'even'; the feeling line is then sent indefinitely, breaking IS-12). Fix so that once no reason is live and the mood is within a small epsilon of the temperament (or equivalently the hysteresis-free bucket equals the resting bucket), the bucket returns to the hysteresis-free bucket. Keep IS-7 stability for oscillation around a boundary while reasons are live.
  Closes: follow-up from the todo 17 round-2 gate (N1)
  Acceptance criteria: a regression test: resting profile, one cue taken fresh so the bucket enters 'good', advance 72 h -> renderCharacterContext returns '' (fails before the fix); existing 200-seed +/-0.04 oscillation test still never changes bucket; qa:character simulations still pass.
  Commit: Y | fix(stage-shared): let the mood return to rest after decay (fold into the todo 7 commit before the PR)
  Recommended task executor category: deep-low

- [x] 22. Make every relationship unlock change her behaviour text
  What to do: In `packages/stage-shared/src/character-state/`: cut the `close` stage sentence down to closeness only (it currently hardcodes "you tease him and may use a nickname for him", so teasing and nicknames appear on closeness alone and their trust/familiarity conditions do nothing, while `initiative` has no text at all). Add `unlockSentences` for teasing, nicknames and initiative beside the existing callbacks and vulnerability sentences, and render each only when `unlocksOf` reports it (render.ts `relationshipSentence`). Update the ADR constants table, the `character-stages` fixtures and the `qa:character render` presets in the same commit. Appendix A6 of this plan carries the same inconsistency; the ADR is the shipped record, so correct it there and note the appendix is superseded.
  Closes: IS-5 shortfall found by F4
  Acceptance criteria: in `render.test.ts`, `close` with trust `guarded` shows no tease or nickname wording; `friendly` + `open` shows the teasing sentence; `close` + `knows-you` shows the nickname sentence; `close` shows the initiative sentence; rendered text still has no digits and the renderKey-iff-text 200-seed test stays green.
  Commit: Y | feat(stage-shared): tie each relationship unlock to its own sentence
  Recommended task executor category: deep-low

### Wave 3 - developer surfaces and docs

- [x] 20. Add the devtools Character page with clock jump
  What to do: Create `packages/stage-ui/src/stores/devtools/character-state-observability.ts` (pattern: `situation-observability.ts` and `memory-observability.ts:58`: `defineInvokeEventa` contracts `characterStateInspectInvoke`, `characterStateJumpInvoke`, `characterStateApplyInvoke`, `characterStateResetInvoke` answered by the leader over `getDevtoolsBusContext()`; followers time out). Create the page `packages/stage-pages/src/pages/devtools/character-state/index.vue` with `<route lang="yaml"> meta: layout: settings </route>` and components for mood (axes, buckets, rendered text), contributions (source, reason, remaining weight), temperament, relationship (levels, stages, unlocks, wound, milestones), the last 30 history rows, and buttons: jump +1 h, +1 d, +7 d (leader applies `advance` at now + offset, offset kept in leader memory and shown), apply a chosen test event, reset this card. Register `/devtools/character-state` in `apps/stage-tamagotchi/src/renderer/pages/settings/system/developer.vue` beside the situation entry (`:87-90`). English keys under `tamagotchi.settings.devtools.pages.character-state.*`.
  Must NOT do: no link from non-devtools pages; no other locales.
  Closes: GAP-9, IS-6, IS-10 (clock jump)
  Parallelization: Wave 3 | Blocked by: 11, 16, 17, 18, 19 | Blocks: 21
  References: as listed; `packages/stage-pages/src/pages/devtools/situation/index.vue:23-81`; its `components/*.browser.test.ts`.
  Acceptance criteria: browser tests for the page components render a seeded record via `t()` lookups; a jump of +1 d through the invoke handler advances temperament and appends a history row in a node test.
  QA scenarios: happy - browser test runs and a component screenshot `task-20-page.png`; failure - inspect with no leader times out and the page shows the timeout message, `task-20-timeout.txt`; live look marked `[~]` in F3.
  Commit: Y | feat(stage-pages): add the character state devtools page
  Recommended task executor category: visual-engineering.

- [x] 21. Document the layered character state and accept the ADR
  What to do: Set `Status: accepted` in `docs/ai/adr/2026-11-03-layered-character-state.md` and add the shipped constants table (from `settings.ts`). Add a "Character state" section to `packages/stage-shared/README.md` and `packages/stage-ui/README.md` (purpose, usage, when to use, when not), and confirm `packages/qa-tools/README.md` from todo 15. Update the root `AGENTS.md` only if a command was added there (`qa:character` in COMMANDS) - that is an agent configuration change and goes in its own commit.
  Must NOT do: no code.
  Closes: GAP-10
  Parallelization: Wave 3 | Blocked by: 15, 20 | Blocks: F1-F4
  References: the ADR; the READMEs; root `AGENTS.md` COMMANDS.
  Acceptance criteria: `pnpm verify` exits 0; `rg -n "Status: accepted" docs/ai/adr/2026-11-03-layered-character-state.md` matches.
  QA scenarios: happy - verify output `task-21-verify.txt`; failure - `rg -n "Plan 2" docs/ai/adr/2026-11-03-layered-character-state.md` finds nothing, `task-21-stale.txt`.
  Commit: Y | docs: document the layered character state (plus a separate `docs(agents): add qa:character` commit if AGENTS.md changes)
  Recommended task executor category: writing.

- [x] 23. Make the compiler require a sentence for every unlock
  What to do: In `packages/stage-shared/src/character-state/settings.ts`, type the sentence maps so a missing entry is a type error: `unlockSentences` with `satisfies Record<Unlock, string>` (and the stage sentence maps against their own stage unions the same way), using whatever the exported union types are actually called. Change no wording and no behaviour.
  Closes: the type hole F4 named as the cause of the IS-5 shortfall - three unlocks were computed with no sentence, rendered nothing, and it compiled.
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared typecheck` exits 0 unchanged; deleting any one entry from `unlockSentences` makes typecheck FAIL (capture that proof run, then restore); `pnpm -F @proj-airi/stage-shared exec vitest run src/character-state` stays 179/179 and `pnpm -F @proj-airi/qa-tools exec vitest run src/character-state` stays 26/26; the four `qa:character render` outputs are byte-identical to before.
  Commit: Y | refactor(stage-shared): require a sentence for every relationship unlock
  Recommended task executor category: deep-low

- [x] 24. Stop model cues from moving her resting disposition
  What to do: In `packages/stage-shared/src/character-state/temperament.ts`, exclude contributions whose `source` is `model-cue` from the hourly mood sample that drives temperament drift. Model cues still feed the mood layer exactly as today; they simply stop reshaping her disposition. Explain in a comment that the model's narration of a moment must not change who she is over days, which is the feedback loop the plan's guardrails exist to prevent. Do NOT introduce a tunable weight: the policy is a boundary, not a setting. Add the invariant to the `qa:character` simulator so a regression bites: on the `model-spam` scenario, overall valence must stay at or below 0.64 on every simulated day.
  Decision record: the orchestrator measured a weighted-damping sweep (seed 41) before choosing this. A partial weight cannot satisfy both criteria at once - any weight below 1 moves the `typical-month` day-30 temperament figure, and only a weight at or near zero holds the bound past day 10 (at weight 0.25 valence reaches 0.6589 at day 10 and 0.7010 at day 30; at weight 0.05 it is still rising at day 30). Excluding model cues outright is the only option with a proven ceiling: model-spam valence is then level at 0.5916 on every day, because temperament stays at its resting value. Measurements are in the escalation from `st_01a1a4eb`.
  Expected figure changes (update every committed copy; do not leave a stale number anywhere): `typical-month` day-30 temperament valence moves from 0.19345 to 0.17877. Appendix A7's "about 0.19" becomes the new figure, and the ADR's shipped constants and known-gaps text must match. `typical-month` closeness stays 0.3490845623854665 and trust stays 0.0567 / 0.1239 / 0.1869 at days 30/60/90, because neither is driven by mood; confirm this rather than assuming it.
  Closes: IS-11 FAIL found by F3 (3-day model-cue spam reached 0.678 against the 0.64 bound, saturating at 0.763 by day 9)
  Acceptance criteria: a day of only `model-cue` contributions produces no temperament drift beyond the anchor pull, while a day of touch and reply contributions still drifts, both asserted in `temperament.test.ts`; the `model-spam` scenario reports overall valence at or below 0.64 on every day for 30 days, and the new simulator invariant fails when model cues are fed back in; all four scenarios report zero violations; two identical runs of `typical-month` produce identical JSON; every committed copy of a changed figure is updated in the same commit.
  Commit: Y | fix(stage-shared): keep model cues out of her resting disposition
  Recommended task executor category: deep-high

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Read this plan and `git log main..HEAD`; confirm each todo's commit exists, its acceptance commands were run with captured evidence under `.omo/evidence/layered-character-state/`, and every Must NOT have holds (run `rg -n "Date\.now|Math\.random" packages/stage-shared/src/character-state` expecting no matches; `git diff main --stat -- packages/i18n/src/locales` shows only `en`). Recommended task executor category: unspecified-high.
- [x] F2. Code quality review
  Review the full diff against `.agents/skills/enforce-rules-for-typescript/SKILL.md`, `enforce-rules-for-vitest`, `enforce-rules-for-pinia-synced`, and `enforce-rules-for-unocss`; flag `any`, missing `// NOTICE:` on workarounds, timing-based tests, and mocks that hide the asserted behaviour. Run `pnpm typecheck` and `pnpm lint` once. Recommended task executor category: unspecified-high.
- [x] F3. Real manual QA
  Agent-executable surfaces only (standing agreement: no new live Electron QA by the agent): run `pnpm qa:character simulate` for all four scenarios at 30, 3, 30, and 30 days with seed 41; run `pnpm qa:character render` for every stage; run the stage-ui and stage-pages browser projects for the touched files; run `pnpm qa:model prompt --json`; run `pnpm qa:motion` gates that cover Natural face channels if the motion-qa skill lists a headless rig gate for them. Record PASS or FAIL per IS row. Mark as `[~] partial (Luke live check)`: IS-2 face on Live2D and MMD in the Electron app, IS-6 devtools page in Electron, cross-window leader and stage behaviour in Electron. Recommended task executor category: unspecified-high.
- [x] F4. Ideal-state fidelity
  For each IS row in Scope, compare the delivered behaviour with the row 1:1 using the Success criteria table and F3 evidence; any shortfall becomes a new `- [ ] N.` todo in this plan, not a note. Recommended task executor category: unspecified-high.

## Commit strategy
- One commit per todo on `luke/feat/layered-character-state`, Conventional Commits without gitmoji as written in each todo; every commit passes `pnpm verify` on its own (the fork only rebase-merges).
- Fold any fix found later into the commit that introduced the breakage before the PR is pushed; verify each commit with `pnpm verify --base HEAD~1` at that commit, rebuilding `@proj-airi/i18n` and `@proj-airi/core-agent` dist when they change.
- Documentation ships with the code it describes (ADR amendments in todos 9 and 11 ride with their code); an `AGENTS.md` change is its own commit.
- Deliver as one PR against `lschneiderny/airi` (never upstream). Final commit footer: `Plan: .omo/plans/layered-character-state.md`.
- Never commit nested `AGENTS.md`/`CLAUDE.md` files that `.git/info/exclude` ignores.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 3, 4, 6, 7, 11, 17 | mood worked examples; reload applies elapsed decay; `system:character` context present when not at rest | `task-3-vitest.txt`, `task-11-node.txt`, `task-17-contract.txt` |
| IS-2 | 7, 8, 19 | zero-baseline 600-step equality; low valence lowers `mouthForm`; null reading equals control; live look `[~]` | `task-8-vitest.txt`, `task-19-*.txt` |
| IS-3 | 7, 9, 16, 17, 18 | open hazard scaled, ritual unchanged; unanswered lowers valence once; trace shows mood factor; a pointed unprompted turn carries the pointed sentence and `system:character`, an unpointed one carries no pointed sentence | `task-9-vitest.txt`, `task-16-vitest.txt`, `task-17-contract.txt`, `task-18-node.txt` |
| IS-4 | 4, 6 | split-advance equality; +0.25 event drift numbers | `task-4-vitest.txt` |
| IS-5 | 5, 14, 16 | farming cap; absence affects familiarity only; stage-ups at rollover; disclosure raises familiarity | `task-5-vitest.txt`, `task-14-vitest.txt`, `task-16-vitest.txt` |
| IS-6 | 13, 20 | editor round trip; devtools page renders a seeded record; no non-devtools surface (F1 grep) | `task-13-editor.png`, `task-20-page.png` |
| IS-7 | 7, 17 | rendered text has no digits; reasons never reorder; stage line has no `mood:`; no `valence \d` in requests | `task-7-vitest.txt`, `task-17-contract.txt` |
| IS-8 | 6, 11, 12, 16 | migration round trip; Delete all data empties the store; card export/import/delete round trip; situation forget everything clears the record | `task-6-vitest.txt`, `task-11-browser.txt`, `task-12-node.txt`, `task-16-vitest.txt` |
| IS-9 | 2, 6, 12 | records are plain JSON (round trip through `JSON.stringify`); no provider fields in schema | `task-6-vitest.txt` |
| IS-10 | 15, 20 | 30-day simulation numbers; violation exits 1; +1 d jump appends history | `task-15-month.json`, `task-15-violation.txt`, `task-20-*.txt` |
| IS-11 | 3, 15 | 3-day all-`brighter` spam keeps model-only raw <= 0.65 and valence <= 0.64; budget truncation | `task-3-vitest.txt`, `task-15-month.json` |
| IS-12 | 7, 17 | resting state renders `''`; no `system:character` message at rest | `task-7-vitest.txt`, `task-17-contract.txt` |

## Appendix A - starting constants and formulas
Copied from the advisory math lane (`.omo/drafts/layered-character-state-math.md`, worked examples verified there by scratch simulation). All values live in `CHARACTER_STATE_SETTINGS`; tuning never needs a migration.

**A1 Mood.** Axes valence, energy in [-1, 1]; tension in [0, 1]. `remaining(c, t) = t < atMs || t >= expiresAtMs ? 0 : 2^(-(t - atMs) / halfLifeMs)`; `raw_a = Σ delta_a · remaining`; `valence = tanh(atanh(T_v) + raw_v)`, same for energy; `tension = σ(logit(T_t) + 4 · raw_t)`. `MOOD_EPSILON = 0.01`; `expiresAtMs = atMs + halfLifeMs · log2(maxAbs(delta) / 0.01)`. Headroom at insertion: `d_eff = sign(d) · min(|d|, max(0, 2.5 - sign(d) · raw))`. Live contributions capped at 64.

**A2 Mood events** (Δv, Δe, Δt, half-life): model cue 0.08 per axis direction, 90 min, one per turn, rolling 60 min budget 0.24 per axis; pleasant touch +0.10, +0.05, -0.03, 1.5 h, budget 0.3 per hour; unwelcome touch -0.08, +0.05, +0.08, 1 h; first unanswered reach-out (90 min no reply) -0.06, -0.03, +0.06, 3 h; second consecutive unanswered -0.12, -0.05, +0.10, 6 h; late reply +0.06, 0, -0.06, 2 h (original stays); significant positive +0.25, +0.10, 0, 9 h; significant negative or hurtful -0.25, -0.10, +0.15, 9 h (significant at most 2 per logical day); ritual reciprocated +0.05, +0.03, 0, 2 h; return after gap g: f = clamp(log2(g / 12 h) / 3, 0, 1), +0.15f, +0.10f, +0.10f, 4 h.

**A3 Temperament.** `k_T = ln2 / 5 d`, `k_A = ln2 / 10 d`; per completed epoch hour h: `T <- R + (T - R) · e^(-k_A · 1 h) + k_T · 1 h · (m(h + 30 min) - T)`; clamp |T - R| to v 0.3, e 0.25, t 0.15.

**A4 Rendering.** Valence buckets: upset < -0.45 <= low < -0.15 <= even < 0.15 <= good < 0.45 <= bright; energy: drained / tired / steady / lively / buzzing on the same boundaries; tension: relaxed < 0.22 <= a little on edge < 0.45 <= tense. Exit hysteresis 0.05 (tension 0.04). Reason weight `w = remaining · (|Δv| + |Δe| + |Δt|)`, x0.5 for model cues; show the top two with w >= 0.04; a shown reason stays until w < 0.03 or < half the best excluded; order by `atMs`.

**A5 Relationship.** Levels closeness, trust, familiarity in [0, 1]. Daily `E(S) = G (1 - e^-S)`, G closeness 0.02, trust 0.012, familiarity 0.03; `level += (1 - level) · ΔE`. Points: first real exchange of the day (third user turn) c 0.4, f 0.4, t 0.2; each later user turn c 0.05, f 0.05; reply to a reach-out within 2 h c 0.2, t 0.2; disclosure c 0.3, f 0.4, t 0.1; kept promise t 0.4; milestone (at most 1 per day) c 0.5, f 0.2 plus a memory id; pleasant touch (at most once per hour) c 0.1; ritual reciprocated c 0.1, f 0.1. Unkind: trust x0.95, closeness -0.01. Hurtful: trust x0.85, closeness -0.03, wound +0.15. Persistent unwelcome touch (third burst in a day): trust x0.97. At most 2 negative events per day. Trust gains x(1 - wound); wound half-life 5 d. Absence after a 3-day grace: `f = 0.6 f + 0.4 f · 2^(-(g - 3 d) / 60 d)`; closeness and trust untouched.

**A6 Stages and unlocks.** Closeness up/down: friendly 0.15/0.10, close 0.35/0.28, intimate 0.60/0.52. Trust: open 0.35/0.30, confiding 0.45/0.39. Familiarity: knows-you 0.25/0.20. Stage-ups only at the 04:00 rollover, at most one per dimension per rollover; stage-downs immediately. Unlocks: teasing = friendly and open; nicknames = close and knows-you; initiative = close; vulnerability = close and confiding; callbacks = knows-you and at least 3 milestones. Stage sentences (English, no digits): stranger "you are still getting to know him; keep it polite and a little reserved"; friendly "you are friendly and at ease with him"; close "you are close and comfortable with him"; intimate "you are very close; you can be openly affectionate and say what you feel"; append "you may bring up things you shared before" when callbacks unlock and "you can admit when something hurts" when vulnerability unlocks. Unlock sentences, each rendered only when that unlock is reached (added by row 22): teasing "you can tease him a little"; nicknames "you may use a nickname for him if you have one"; initiative "you may start conversations and suggest things yourself"; callbacks "you may bring up things you shared before"; vulnerability "you can admit when something hurts". CORRECTED after row 22: this appendix originally folded teasing and nicknames into the close stage sentence, which made them fire on closeness alone and left initiative with no text at all. The shipped values in `packages/stage-shared/src/character-state/settings.ts` and the ADR constants table are authoritative.

**A7 Expected 30-day trace** (typical-month scenario: greeting 08:00, one unanswered reach-out per day, evening session with 3 cues 75% positive, 2 touches, a significant positive every third day, away days 15-17, a hurtful event day 22): valence 0.03-0.65; T.v 0.10 -> about 0.18 (0.17877 as shipped; row 24 removed model cues from drift, which lowered it from 0.19345); closeness about 0.35 on day 30, 0.62 on day 60.

**A8 Reach-out.** `urgeFactor = exp(clamp(0.35 v + 0.15 e - 0.2 max(0, t - 0.3), -0.4, 0.3))`, range [0.67, 1.35]. `pointed` when v <= -0.2, t >= 0.35, and an unanswered reason is among the shown two.

**A9 Face.** `d_a = m_a - R_a`. Damping `D(τ) = 0.25 + 0.75 · 2^(-max(0, τ - 2 min) / 20 min)`, τ = time since the last user message, touch, or character speech. `mouthForm += 0.35 d_v D`; `eyeOpen = 0.15 d_e D` (multiplier `1 + eyeOpen`); `blinkRateOffset = clamp(-0.25 d_e D, -0.4, 0.4)` (neutral 0; the driver scales the blink interval by `1 / (1 + blinkRateOffset)`); `browAngle += 0.4 d_t D` with the worried-brow sign. Each offset clamped to 35% of its channel range; first-order filter τ = 1.5 s in the driver.

**A10 Invariants checked by tests and the simulator.** |raw| <= 2.5 per axis; model-only raw <= 0.65 (burst peak of the rolling budget); |T - R| within clamp; levels in [0, 1]; daily gain <= G; at most one stage-up per dimension per rollover; equal `advance` results for any split; pruning never changes `moodAt`; rendered text has no digits.
