# prompt-composer - Work Plan

## TL;DR (For humans)

**Who this is for and what changes for them:** The character gets the same, size-bounded instructions whether you type, use a devtools path, or a plugin reaction (Spark Notify) makes her speak, and the model evaluation scores the instructions the app really sends. The prompt inspector finally shows what the model received.

**What you'll get:** One place that builds the character's instructions in a fixed order, with a size budget per part; the agent runtime no longer carries character-specific text; Spark Notify reactions gain the formatting rules and the reply length cap; the inspector shows each part's size.

**Why this approach:** The builder is a pure function in the shared domain package, so the app, the evaluation tool, and tests all use the same code without pulling in the UI. The stable start of the prompt stays byte-identical, so prompt caching and the contract fingerprint keep working.

**What it will NOT do:** It does not change what the stage contract says, does not move the situation block or the per-message timestamps, and does not cut the character card (an over-long card is only flagged).

**Effort:** Large
**Risk:** Medium - one cross-package commit removes a runtime option every chat path uses
**Decisions to sanity-check:** Spark keeps the active card's memory; plugin text keeps system authority under a 2000-char cap; the sticker list is capped at 12; memory index drops oldest entries past 40 entries or 6000 chars.

Your next move: start execution with `/ulw-execute` (review was skipped at your request). Full execution detail follows below.

---

> TL;DR (machine): Large, medium risk; pure `composePrompt` in stage-shared, one stage-ui assembler for send/ingest/Spark, core-agent loses prompt text and takes `deps.stage`, projection shows the resolved prompt, qa-tools composes the full prompt, per-segment report in devtools.

## Scope
### Affected user and ideal state
**Affected user:** Luke as the person chatting with the character (typed and voice sends, unprompted turns, Spark Notify reactions); Luke as the developer running `qa:model` evals and reading the devtools prompt inspector; programmers and agents adding the next prompt segment; the provider's prompt cache.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Every character-turn path (send, unprompted, ingest, Spark Notify) builds its system prompt through one composer with one fixed segment order | eight concatenation sites disagree today |
| GAP-1 | Send builds it in `chat.ts:1010-1021` + `:1042-1061` + `rt:1110-1129,1182-1186`; ingest in `chat.ts:891-893`; Spark in `character/orchestrator/store.ts:185-189` | divergent prompts per path |
| IS-2 | Every tail segment declares a char budget and overflow policy; the composer reports each segment's size | only five budgets exist |
| GAP-2 | Card, memory index total, toolset, voice, control events, plugin text, sticker catalog are unbounded | prompt size unbounded |
| IS-3 | The prefix (format rules, card, contract) is first and byte-identical to `composeSystemPrompt`; tail segments follow in fixed order | cacheability, contract hash stability |
| GAP-3 | The ordering guarantee lives only in a comment (`rt:1120-1125`) | regressions go unnoticed |
| IS-4 | Spark Notify uses the active card's memory (memory ADR:20, kept), the format rules, and `REPLY_MAX_TOKENS` | Luke decision 2026-11-01 |
| GAP-4 | Spark lacks CODE_BLOCK/MATH rules and sends no `maxTokens` (`store.ts:185-189`) | inconsistent replies |
| IS-5 | `ingest` (devtools/tests) sends the same prompt and cap as a typed send | devtools runs must match production |
| GAP-5 | `ingest` has no memory, no cap, no `resolveStep` (`chat.ts:873-912`) | devtools fidelity |
| IS-6 | `qa:model` can compose the full production prompt from fixtures; prefix-only mode keeps today's hash | eval scores the real prompt |
| GAP-6 | `qa-tools/src/model/stage-contract.ts:36-41` composes card + contract only | eval drift |
| IS-7 | core-agent holds no stage prompt text; the host supplies decline marker and cue names; the Spark instruction is a host option rendered from i18n; cue-compliance buckets and fixtures stay as a named eval-oracle exception | R4 |
| GAP-7 | `rt:29` default marker, `rt:1075` cue names, `rt:1110-1117` sticker prompt, `spark-notify/agent.ts:87-94` instruction | core-agent owns half the stage contract |
| IS-8 | The display projection, `after-compose` hooks, and prompt inspector show the system prompt actually sent | devtools trust |
| GAP-8 | `rt:1142` renders the stored session prompt + supplement; the resolved prompt (current card + memory) never enters `context` (`chat.ts:603-606`) | inspector shows a prompt the model never gets |
| IS-9 | The supplement reaches the provider once by construction | R3 |
| GAP-9 | Two joins (`rt:1123-1129`, `rt:1182-1186`), correct only because adapters replace the system message (documented in f18a8a420) | fragile |

### Must have
- `composePrompt(segments)` in `packages/stage-shared/src/stage-contract/compose.ts`, exported from the existing `./stage-contract` subpath, pure (no i18n, stores, clock).
- Segment ids and order: prefix `format`, `card`, `contract`; tail `memory`, `toolset`, `account`, `voice`, `control`, `unprompted`, `plugin`, `stickers`, `spark`. Join `\n\n` between non-empty segments.
- Budgets (chars) and policies, as exported constants next to `REPLY_MAX_TOKENS` (`sc:25`): card warn 8000; memory drop-oldest 40 entries / 6000 chars; toolset warn 2000; account warn 2000; voice truncate 1000; control truncate 1500; unprompted fixed; plugin truncate 2000 and flagged; stickers drop-oldest 12 entries; spark fixed. Truncation appends `…[truncated]`.
- `ComposedPrompt = { text, prefix, tail, report[] }`, report per segment: `id, chars, estimatedTokens (ceil(chars/4)), dropped, truncated, overBudget`.
- `composeSystemPrompt(card, contract)` reimplemented through `composePrompt` with byte-equal output.
- One stage-ui assembler `packages/stage-ui/src/stores/chat/prompt.ts` used by `prepareSend`, `ingest`, and the Spark store.
- core-agent: remove `systemPromptSupplement` send option (`rt:154`), `deps.getSystemPromptSupplement` (`rt:342`, `:1547`), the sticker prompt (`rt:1110-1118`), both joins; keep `stickers` as the marker allow-list (`rt:1036`). Add required `deps.stage: { declineMarker: string, recoverCueNames: readonly string[] }`; delete `DEFAULT_DECLINE_MARKER` (`rt:29`) and the literal at `rt:1075`.
- Runtime resolves step 1 before building the projection and writes `step.systemPrompt` into the context's system turn; `onPromptProjection` carries the composer report.
- `createSparkNotifyAgent` takes `instruction: (moduleName: string) => string`; text moves to i18n key `base.prompt.spark-notify` (English source only).
- qa-tools `buildSystemPrompt` accepts optional segment fixtures; prefix-only mode unchanged.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No change to stage contract text or `STAGE_CONTRACT_EN_SHA256` (`sc:49`); no change to the qa-tools prompt hash in prefix-only mode.
- Do not move the situation block (`rt:1131-1138`), the unprompted trigger text (`chat.ts:1186`), or per-message datetime prefixes (`rt:642`).
- Do not move `cue-compliance.ts` or `cue-contract-fixtures.ts` (eval closure `qa-tools/src/model/score/closure-files.ts:8-9`).
- No default values for `deps.stage` inside core-agent; no compatibility branch for `systemPromptSupplement`.
- Do not truncate the character card. Do not change thread extraction's task prompt (`features/situation/thread-extraction.ts`).
- No token-level budgets or tokenizer dependency. No new dependencies. Do not edit non-English locales.
- No live Electron QA (deferred to Luke).

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD for the pure composer, budgets, overflow policies, and prefix byte-equality (Vitest, `packages/stage-shared`); tests-after for store/runtime wiring (Vitest node and browser projects in `packages/stage-ui`, `packages/core-agent`, `packages/qa-tools`).
- Evidence: `.omo/evidence/prompt-composer/task-<N>-prompt-composer.<ext>` (outside ulw-loop).
- Every todo ends with `pnpm verify` green on the changed tree.

## Execution strategy
### Parallel execution waves
- Wave 1: todo 1.
- Wave 2: todo 2.
- Wave 3: todos 3 and 4 (disjoint files: `chat.ts` ingest region vs Spark store and agent).
- Wave 4: todos 5 and 7 (todo 5: runtime deps, `chat.ts:750` creation, `reply-replay.ts`; todo 7: devtools stores and pages).
- Wave 5: todo 6.
- Wave 6: todo 8.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2, 3, 4, 6 | - |
| 2 | 1 | 3, 4, 5, 7 | - |
| 3 | 2 | 8 | 4 |
| 4 | 2 | 8 | 3 |
| 5 | 2 | 6, 8 | 7 |
| 6 | 1, 5 | 8 | - |
| 7 | 2 | 8 | 5 |
| 8 | 3, 4, 5, 6, 7 | - | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Pure prompt composer with tiered, budgeted segments in stage-shared
  Recommended task executor category: deep-low
  What to do / Must NOT do: TDD. Write `packages/stage-shared/src/stage-contract/compose.test.ts` first, then `compose.ts` with `PromptSegment`, `PromptTier`, `OverflowPolicy`, `PROMPT_SEGMENT_ORDER`, `PROMPT_SEGMENT_BUDGETS` (values in Must have), `composePrompt`, `ComposedPrompt`. Order follows `PROMPT_SEGMENT_ORDER`, not array order; unknown or duplicate ids throw; overflow never throws. `drop-oldest` takes `text: readonly string[]` oldest first. Re-export from `src/stage-contract/index.ts`. Reimplement `composeSystemPrompt` (`sc:43-46`) as `composePrompt([format, card, contract]).prefix`. Must NOT change `renderStageContract` or the contract hash. Add a short "Prompt composition" ADR `docs/ai/adr/2026-11-0X-prompt-composition.md` (date of execution) recording segment order, tiers, budgets, overflow policies, Luke's decisions (Spark active-card memory, plugin authority capped), and the cue-compliance exception.
  Closes: GAP-2, GAP-3
  Parallelization: Wave 1 | Blocked by: - | Blocks: 2, 3, 4, 6
  References: `packages/stage-shared/src/stage-contract/index.ts:3-49`; `packages/stage-shared/src/stage-contract/index.test.ts:49-51` (existing composeSystemPrompt assertions); `docs/ai/adr/2026-10-31-reply-shape-contract.md:14` (contract renders last); `packages/stage-ui/src/tools/memory.ts:33-45` (memory segment, `'', ''` join hack to remove in todo 2); `docs/ai/adr/2026-11-01-persistence-tiers.md` (ADR format).
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/stage-contract` passes, including: order independence of input array, `\n\n` join skipping empty segments, each overflow policy, report fields, unknown id throws, prefix byte-equal to the pre-change `composeSystemPrompt` for 3 card fixtures; `pnpm -F @proj-airi/stage-shared typecheck` exits 0.
  QA scenarios: happy - vitest run above, save output to `.omo/evidence/prompt-composer/task-1-prompt-composer.txt`; failure - a test with a duplicate `memory` segment asserts the thrown message.
  Commit: Y | feat(stage-shared): add a budgeted prompt composer

- [x] 2. Compose chat sends through one stage-ui assembler; core-agent stops appending prompt text; projection shows the sent prompt
  Recommended task executor category: deep-high
  What to do / Must NOT do: Create `packages/stage-ui/src/stores/chat/prompt.ts` exporting `buildChatPromptSegments({ characterId, sessionId, origin, voiceContext?, controlEvents?, unprompted?, plugin?, stickers? })` that reads card prompt (`session-store.ts:231-235` resolution), stage contract, memory entries (`memory.indexFor(characterId)` as a list for drop-oldest; `composeMemoryPrompt` rules text becomes the segment header, drop its `'', ''` prefix at `tools/memory.ts:35-36`), toolset prompt, account supplement, and returns segments; sticker segment renders the English instructions now at `rt:1112-1115` plus one `<|STICKER id|>: description` line per catalog entry. In `chat.ts` `prepareSend` (`:984-1080`): `resolveStep.systemPrompt = composePrompt(buildChatPromptSegments(...)).text`, keep `maxTokens: REPLY_MAX_TOKENS`; stop building `systemPromptSupplement` (`:1010-1021`) and stop passing it (`:1078`). In core-agent `chat-orchestrator-runtime.ts`: delete `systemPromptSupplement` option (`:154`) and its doc, `getSystemPromptSupplement` dep (`:342`, fallback `:1547`), sticker prompt (`:1110-1118`), both joins (`:1120-1129`, `:1182-1186`); keep `stickers` for marker validation (`:1036`). Before rendering the projection (`:1142`), when `options.resolveStep` exists, call it once and replace the system turn's content with `step.systemPrompt` (insert a system turn if none), and reuse that step as the stream's first step so `resolveStep` is not called twice for step 1 (pass it through `StreamOptions` or memoize; adapters already take `initialStep` in `llm-service.ts:82`). Add `promptReport?` to `onPromptProjection` payload and to the `resolveStep` return type in `types/llm.ts:45-60`. Update `StreamOptions.resolveStep` doc (`types/llm.ts:44-50`). Must NOT change ingest (todo 3), Spark (todo 4), or `deps.stage` (todo 5).
  Closes: GAP-1 (send path), GAP-8, GAP-9
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 3, 4, 5, 7
  References: `packages/stage-ui/src/stores/chat.ts:595-650` (stream helper and projection capture `:603-606`), `:984-1080` (prepareSend, resolveStep `:1042-1061`), `:750-790` (runtime creation, `getSystemPromptSupplement` at `:774`); `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts:150-210, 330-345, 1100-1200, 1540-1550`; `packages/core-agent/src/runtime/llm-service.ts:75-110`; `packages/core-agent/src/runtime/chat-completions.ts:41-98` and `responses.ts:192-240` (system message replacement); tests to update: `chat-orchestrator-runtime.test.ts:81,125,281,1107-1165,3031-3066`, `chat-completions.test.ts` (resolved prompt replacement test from f18a8a420), `packages/stage-ui/src/stores/chat.contract.test.ts:526-600,673-711,2071-2101` and projection cases `:1108,1192,1315,1338`, `packages/stage-ui/src/stores/chat-stickers.browser.test.ts`.
  Acceptance criteria: `pnpm -F @proj-airi/core-agent exec vitest run src/runtime` and `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/chat.contract.test.ts` pass; a new contract test asserts the projection's system message equals the resolved prompt including the memory index; a new runtime test asserts `resolveStep` is called once for a single-step turn; `grep -n "systemPromptSupplement\|getSystemPromptSupplement" packages/core-agent/src packages/stage-ui/src` returns nothing; `pnpm verify` green.
  QA scenarios: happy - contract test output saved to `.omo/evidence/prompt-composer/task-2-prompt-composer.txt`; failure - a turn whose card changes between creation and send shows the new card text in the projection (test asserts it).
  Commit: Y | refactor(core-agent,stage-ui): compose the chat system prompt in one place

- [x] 3. Route ingest through the same assembler with resolveStep and the reply cap
  Recommended task executor category: unspecified-low
  What to do / Must NOT do: In `chat.ts` `ingest` (`:873-912`), build a `resolveStep` with the same provider/model resolution and `composePrompt(buildChatPromptSegments(...))` as `prepareSend`, and `maxTokens: REPLY_MAX_TOKENS`; delete the private supplement builder at `:891-893`. Extract the shared resolveStep construction into one local function used by both paths rather than duplicating it. Must NOT add memory tools to ingest (callers pass tools explicitly).
  Closes: GAP-5
  Parallelization: Wave 3 | Blocked by: 2 | Blocks: 8
  References: `packages/stage-ui/src/stores/chat.ts:873-912, 1042-1061, 1393-1407`; callers `packages/stage-ui/src/stores/markdown-stress.ts:312,364`, `apps/stage-web/src/pages/devtools/performance-playground.vue:210`, `apps/stage-pocket/src/pages/devtools/performance-playground.vue:210`; tests `packages/stage-ui/src/stores/chat-stickers.browser.test.ts:82,118,246`.
  Acceptance criteria: new contract test: `ingest` request's resolved prompt contains the memory index and `maxTokens === REPLY_MAX_TOKENS`; existing ingest tests pass; `pnpm verify` green.
  QA scenarios: happy - test output to `.omo/evidence/prompt-composer/task-3-prompt-composer.txt`; failure - ingest with no configured provider rejects with the same error as a send.
  Commit: Y | fix(stage-ui): give ingest the production prompt and reply cap

- [x] 4. Spark Notify composes through the assembler; the instruction becomes a host option
  Recommended task executor category: deep-low
  What to do / Must NOT do: core-agent: add `instruction: (moduleName: string) => string` (required) to `CreateSparkNotifyAgentOptions` (`spark-notify/agent.ts:62`), use it at `:228` instead of `getSparkNotifyHandlingAgentInstruction` (`:87-94`), delete that function and its export (`spark-notify/index.ts:10`). Add i18n key `base.prompt.spark-notify` to `packages/i18n/src/locales/en/base.yaml` with the current English text, `{moduleName}` interpolated. stage-ui Spark store (`character/orchestrator/store.ts:74, 185-192`): pass `instruction` rendered through `t`; build the system prompt with `composePrompt(buildChatPromptSegments({ characterId: cardStore.activeCardId ?? 'default', ... }))` so it gains the format rules, keeps the active card's memory (Luke decision, memory ADR:20), and pass `maxTokens: REPLY_MAX_TOKENS` to the agent run. Must NOT change Spark command behavior or the memory scope.
  Closes: GAP-4, part of GAP-7
  Parallelization: Wave 3 | Blocked by: 2 | Blocks: 8
  References: `packages/core-agent/src/agents/spark-notify/agent.ts:62-94, 196-235`; `agent.test.ts:35,68,96,125`; `packages/stage-ui/src/stores/character/orchestrator/store.ts:60-200`; `docs/ai/adr/2026-10-30-long-term-memory-adoption.md:20`; `packages/i18n/AGENTS.md` (English only).
  Acceptance criteria: agent tests pass with an injected instruction; a stage-ui test asserts the Spark system prompt starts with the format rules prefix and the run options carry `maxTokens: 320`; `grep -rn "life pod" packages/core-agent/src` returns nothing; `pnpm verify` green.
  QA scenarios: happy - tests to `.omo/evidence/prompt-composer/task-4-prompt-composer.txt`; failure - creating the agent without `instruction` is a type error (assert with `// @ts-expect-error` in the test).
  Commit: Y | refactor(core-agent,stage-ui): move the Spark Notify prompt to the host

- [x] 5. Host-supplied stage config for the decline marker and cue names
  Recommended task executor category: deep-low
  What to do / Must NOT do: Add `STAGE_RUNTIME_CONFIG = { declineMarker: '<|SILENT|>', recoverCueNames: ['ACT', 'DELAY'] } as const` to `stage-shared/src/stage-contract/index.ts`. core-agent: required `deps.stage: { declineMarker: string, recoverCueNames: readonly string[] }` on `ChatOrchestratorRuntimeDeps`; use `deps.stage.declineMarker` where `DEFAULT_DECLINE_MARKER` (`rt:29`) is used (the per-send `declineMarker` option at `rt:206` still overrides), pass `deps.stage.recoverCueNames` at `rt:1075`; delete `DEFAULT_DECLINE_MARKER`. Callers: `chat.ts:750` passes `STAGE_RUNTIME_CONFIG`; `reply-replay.ts:36` takes `stage` as an input and the qa-tools score command passes `STAGE_RUNTIME_CONFIG` so replay matches live cue recovery. core-agent must NOT import stage-shared (layering K1) - the config is a plain object type. Update `packages/core-agent/AGENTS.md` integration-hub bullet to name the cue-compliance/fixtures eval-oracle exception.
  Closes: rest of GAP-7
  Parallelization: Wave 4 | Blocked by: 2 | Blocks: 6, 8
  References: `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts:29, 195-206, 320-345, 664-666, 1021, 1075`; `llm-marker-parser.ts:28, 530-568`; `reply-replay.ts:36-95`; `packages/qa-tools/src/model/score/command.ts:67, 97-110` and `score/cue-contract.ts:83`; `packages/stage-ui/README.md:393,421` (decline marker docs).
  Acceptance criteria: a runtime test constructs the runtime with a custom `stage` (`declineMarker: '<|QUIET|>'`, `recoverCueNames: ['ACT']`) and asserts decline and recovery follow it; a replay test asserts DELAY recovery now happens in `reply-replay`; `grep -n "'<|SILENT|>'\|\['ACT', 'DELAY'\]" packages/core-agent/src --include=*.ts` returns only test files and fixtures; `pnpm verify` green.
  QA scenarios: happy - tests to `.omo/evidence/prompt-composer/task-5-prompt-composer.txt`; failure - runtime constructed without `stage` is a type error (`@ts-expect-error`).
  Commit: Y | refactor(core-agent): take the decline marker and cue names from the host

- [x] 6. qa-tools composes the full production prompt from fixtures
  Recommended task executor category: unspecified-low
  What to do / Must NOT do: `buildSystemPrompt` (`qa-tools/src/model/stage-contract.ts:36-41`) gains optional `segments` (memory entries, toolset, stickers fixtures) and composes with `composePrompt`; without them the output is byte-identical to today (prefix-only mode). Add a `--full` flag to the prompt CLI (`src/model/prompt.ts:43-57`) that loads fixtures from a JSON file path. Update the model-eval README in `packages/qa-tools` with when to use each mode. Must NOT change existing hashes or `closure-files.ts` contents beyond adding `packages/stage-shared/src/stage-contract/compose.ts` to the closure.
  Closes: GAP-6
  Parallelization: Wave 5 | Blocked by: 1, 5 | Blocks: 8
  References: `packages/qa-tools/src/model/stage-contract.ts:3-41`, `stage-contract.test.ts:96-101`, `prompt.ts:43-57`, `prompt.test.ts:38-64`, `score/closure-files.ts:8-9`; `docs/ai/adr/2026-10-29-model-eval-levels.md`.
  Acceptance criteria: existing `stage-contract.test.ts` and `prompt.test.ts` pass unchanged; a new test asserts `--full` with a fixture equals `composePrompt` of the same segments as stage-ui's assembler would build; `pnpm -F @proj-airi/qa-tools typecheck` and `pnpm verify` green.
  QA scenarios: happy - `pnpm -F @proj-airi/qa-tools exec tsx src/model/prompt.ts --full <fixture.json>` output saved to `.omo/evidence/prompt-composer/task-6-prompt-composer.txt`; failure - a missing fixture path exits non-zero with a clear message.
  Commit: Y | feat(qa-tools): compose the full production prompt for model evals

- [x] 7. Show per-segment prompt sizes in devtools
  Recommended task executor category: visual-engineering
  What to do / Must NOT do: Carry `promptReport` from `onPromptProjection` into `useContextObservabilityStore` (`stores/devtools/context-observability.ts:77-122`) and render a per-segment table (id, chars, est. tokens, dropped, truncated, over budget) in the existing context inspector page; `situation-observability.ts:308-319` reads the report's total instead of summing message text. Follow `DESIGN.md` and the UnoCSS skill; add i18n keys in English only. Must NOT add a new devtools page.
  Closes: IS-2 visibility
  Parallelization: Wave 4 | Blocked by: 2 | Blocks: 8
  References: `packages/stage-ui/src/stores/devtools/context-observability.ts`, `situation-observability.ts:261-319`; the context inspector page (find via `grep -rn useContextObservabilityStore packages/stage-pages packages/stage-ui/src`); `DESIGN.md`; `.agents/skills/enforce-rules-for-unocss/SKILL.md`.
  Acceptance criteria: a browser test renders the inspector with a fixture report and asserts one row per segment and the over-budget marker; `pnpm verify` green.
  QA scenarios: happy - Vishot or browser-test screenshot of the inspector table saved to `.omo/evidence/prompt-composer/task-7-prompt-composer.png`; failure - a projection without a report renders the table's empty state.
  Commit: Y | feat(stage-ui): show prompt segment sizes in the context inspector

- [x] 8. Docs: audit rows, guides, ADR amendments
  Recommended task executor category: writing
  What to do / Must NOT do: Mark R2, R3, R4, T1 done in `docs/ai/audits/2026-10-31-architecture-boundaries.md` with commit hashes, and correct the Spark memory row (active card is intended, memory ADR:20). Amend `docs/ai/adr/2026-10-30-long-term-memory-adoption.md` (memory index is the first tail segment, budgeted). Update `packages/stage-shared/README.md` (stage-contract entrypoint now holds the composer) and `packages/stage-shared/AGENTS.md`. Amend the presence ADR's mention of the supplement if any. Must NOT edit accepted ADR decisions in place; use dated amendment notes.
  Closes: documentation for all GAPs
  Parallelization: Wave 6 | Blocked by: 3, 4, 5, 6, 7 | Blocks: -
  References: `docs/ai/audits/2026-10-31-architecture-boundaries.md:48-87, 213-240`; `docs/ai/live2d-parameter-ownership.md` section (d) (amendment style); root `AGENTS.md` Unique Styles.
  Acceptance criteria: `pnpm exec eslint` on changed markdown exits 0; relative links resolve; `git diff --check` clean.
  QA scenarios: happy - lint output to `.omo/evidence/prompt-composer/task-8-prompt-composer.txt`; failure - a link checker run reports zero broken links.
  Commit: Y | docs: record the prompt composer and close audit rows R2-R4 and T1

- [x] 9. Docs polish from todo 8 gate notes
  Recommended task executor category: quick
  What to do / Must NOT do: Fix gate notes N1-N4 (task-8-gate.txt): audit:73 site count matches the listed items; blank line before the three new amendment headings; replace "todo 8" in the composition ADR heading with a dated description; add the sticker prompt text move (c8c9a7749) to the R4 done note. Docs only.
  Closes: documentation accuracy (follow-up)
  Parallelization: after 8 | Blocked by: 8 | Blocks: F1-F4
  References: .omo/evidence/prompt-composer/task-8-gate.txt
  Acceptance criteria: eslint on changed md exit 0; git diff --check clean.
  QA scenarios: lint output appended to task-8-prompt-composer.txt.
  Commit: Y | docs: tidy the prompt composer records

- [x] 10. Fix diff-introduced findings from F2 (N1 lint warning, N5 stale doc comment)
  Recommended task executor category: quick
  What to do / Must NOT do: Shorten the edited comment at packages/stage-ui/src/stores/chat.ts:288 under the slop/max-comment-length limit; correct the getSessionSystemPrompt doc comment in packages/stage-ui/src/stores/chat/session-store.ts (~228-230) so it no longer claims chat requests read it before each step. Comments only; no behavior change.
  Closes: code-quality follow-up
  Parallelization: after F2 | Blocked by: F2 | Blocks: PR
  References: .omo/evidence/prompt-composer/final-F2.md
  Acceptance criteria: eslint on both files with no warning from these lines; stage-ui typecheck exit 0.
  QA scenarios: lint output saved to final-F2-followup.txt.
  Commit: Y | docs(stage-ui): correct prompt comments after the composer change

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
- [x] F2. Code quality review
- [x] F3. Real manual QA
- [x] F4. Ideal-state fidelity

## Commit strategy
Eight commits on a branch `luke/refactor/prompt-composer` (plan-sized work per root AGENTS.md), one per todo, each passing `pnpm verify`; open a pull request against `lschneiderny/airi`. Commit 2 is the only cross-package commit and cannot be split without a compatibility branch, which the root rules forbid.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 2, 3, 4 | send, ingest, and Spark prompts built by `composePrompt` (contract tests) | task-2/3/4-prompt-composer.txt |
| IS-2 | 1, 7 | overflow policy tests; inspector table test | task-1-prompt-composer.txt, task-7-prompt-composer.png |
| IS-3 | 1 | prefix byte-equality test | task-1-prompt-composer.txt |
| IS-4 | 4 | Spark prompt prefix + maxTokens test | task-4-prompt-composer.txt |
| IS-5 | 3 | ingest resolved prompt + cap test | task-3-prompt-composer.txt |
| IS-6 | 6 | `--full` equals assembler output test | task-6-prompt-composer.txt |
| IS-7 | 4, 5 | custom stage config test; "life pod" grep empty | task-4/5-prompt-composer.txt |
| IS-8 | 2 | projection equals resolved prompt test | task-2-prompt-composer.txt |
| IS-9 | 2 | supplement grep empty; single resolveStep call test | task-2-prompt-composer.txt |
