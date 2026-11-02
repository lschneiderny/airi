---
slug: prompt-composer
status: plan-written
intent: clear
review_required: false
plan_path: .omo/plans/prompt-composer.md
plan_sha256: null
review_round_id: null
review_round_limit: 5
pending-action: write and review .omo/plans/prompt-composer.md
review:
  plan_reviewer:
    status: pending
    workspace_root: null
    runtime_home: null
    target: .omo/plans/prompt-composer.md
    round_id: null
    plan_sha256: null
    launch_id: null
    session: null
    result: null
approach: Option A (architect st_01a1964e) - pure `composePrompt` with ordered, tiered, char-budgeted segments in stage-shared/stage-contract; one stage-ui assembler `stores/chat/prompt.ts` used by prepareSend, ingest, Spark; core-agent drops systemPromptSupplement/sticker prompt/joins, receives finished prompt + required `deps.stage` {declineMarker, recoverCueNames}; Spark instruction via agent option + i18n; runtime pre-resolves step 1 into context so projection shows the sent prompt; qa-tools composes through composePrompt with fixtures; cue-compliance + fixtures stay in core-agent as named eval-oracle exception. 8-commit migration, only commit 2 cross-package.
---

# Draft: prompt-composer

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Affected users:
- Luke as the person chatting with the character in the Electron app (typed chat, voice ingest, unprompted turns, Spark Notify reactions).
- Luke as the developer running `qa:model` evals, who needs the scored prompt to be the production prompt.
- Programmers and agents adding the next prompt segment (touch observations, new tools), who need one place with a budget.
- The model provider's prompt cache, which benefits from a stable prefix.

| IS | Property | Reason |
| --- | --- | --- |
| IS-1 | Every character-turn request path (chat send, voice/ingest, unprompted, Spark Notify) gets its system prompt from one composer with one fixed segment order | today 8 concatenation sites disagree (audit Lens 7) |
| IS-2 | Every segment declares a budget and an overflow policy, so total prompt size is bounded | only 5 budgets are enforced; card, memory index, toolset prompts, stickers, history are unbounded |
| IS-3 | The stable prefix (format rules, card, stage contract) comes first and per-request parts come last in a fixed order | cache efficiency; K3 keeps this layout |
| IS-4 | Spark Notify uses the session character's card and memory, the format rules, and the output cap | today it reads the active card's memory, lacks S1-S2, sends no maxTokens |
| IS-5 | The ingest path carries the same memory and output cap as a typed send, or the difference is a stated rule | today chat.ingest has no memory and no 320-token cap |
| IS-6 | The model eval composes its prompt through the same composer, so it scores the production prompt | today qa-tools composes card + contract only |
| IS-7 | core-agent holds no stage semantics; the host injects cue names, decline marker, sticker prompt, compliance buckets, Spark instruction; qa-tools replays the real runtime with that config | R4 |
| IS-8 | The display projection and prompt inspector show the prompt actually sent | today the preview shows the composed message, which the resolved prompt replaces |
| IS-9 | The supplement reaches the provider once by construction | today correct only because adapters replace the message (contract now documented in f18a8a420) |

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

| id | outcome | status | evidence |
| --- | --- | --- | --- |
| C1 | Composer module with ordered, budgeted segments | active | pending |
| C2 | Chat send, ingest, and unprompted turns compose through it | active | pending |
| C3 | Spark Notify composes through it (retires T1) | active | pending |
| C4 | qa-tools model eval composes through it | active | pending |
| C5 | core-agent stage semantics move behind host config (R4) | active | pending |
| C6 | Projection shows the real composed prompt | active | pending |

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| budget unit | characters, not estimated tokens | deterministic, provider-neutral, matches existing SITUATION_MAX_CHARS style | yes |
| ingest path | routes through the composer like a typed send (memory + 320 cap) | ingest is devtools/test-only; fidelity with production is the point | yes |
| thread extraction prompt | stays a separate task prompt, out of the character composer, keeps its own budgets | it is not a character turn | yes |

## Findings (cited - path:lines)

Prompt assembly sites (explore st_01a1964c):
- S1-S4 `composeSystemPrompt` stage-shared/src/stage-contract/index.ts:43-46 via session-store.ts:201-203 (CODE_BLOCK, MATH, card, contract).
- Send supplement chat.ts:1010-1021 (toolset prompt, account supplement, voice context :1012-1013, control events :1015-1016, unprompted instruction :1018-1019).
- resolveStep chat.ts:1042-1059: session prompt + `composeMemoryPrompt(memory.indexFor(characterId))` :1055, `maxTokens: REPLY_MAX_TOKENS` :1059. Only path carrying memory + cap.
- Sticker prompt + supplement rt:1110-1128; resolved-step append rt:1185; runtime-context block on last user turn rt:~1131-1136.
- `ingest` chat.ts:873-912: supplement only, no memory, no cap, no resolveStep. Verified: `ingest` and `ingestOnFork` (chat.ts:1393-1407) are low-level APIs called only by devtools (markdown-stress.ts:312,364; stage-web and stage-pocket devtools/performance-playground.vue:210) and tests. The user send path is `prepareSend` chat.ts:984 -> :1113, which builds resolveStep. So IS-5 is a devtools-fidelity gap, not a user-facing one; default: route ingest through the same composer so devtools runs see the production prompt.
- Spark Notify orchestrator/store.ts:185-189: `systemPrompt.value` + `stageContractPrompt.value` + memory of `cardStore.activeCardId` (:188); no S1-S2; no maxTokens in this call.
- qa-tools eval stage-contract.ts:36-38 via prompt.ts:57: S1-S4 only.
- `composeMemoryPrompt` tools/memory.ts:33-45; other caller artistry-autonomous.ts:96.
- Thread extraction thread-extraction.ts:228 has its own task prompt and budgets (:20-33); not a character turn.
- Budget constants: REPLY_MAX_TOKENS sc:25; EXTRACTION_* thread-extraction.ts:20-33; SITUATION_MAX_LINES/CHARS render.ts:18,20; THREADS_MAX etc. reasons/types.ts:147-151; WINDOW_TITLE_MAX_CHARS window-title.ts:4. Card, memory index total, toolset prompts, sticker catalog, voice context, runtime context entries, history: unbounded.
- Audit citation `tool-resolver.ts:167-177` as a concatenation site looks wrong (tool lists only).

R4 stage semantics (explore st_01a1964d; claims to verify before planning):
- Decline marker default `<|SILENT|>` rt:29; `declineMarker?` send option rt:206 already injectable; stage-ui relies on the default.
- `recoverCueNames: ['ACT','DELAY']` hardcoded rt:1075; parser already parameterized (llm-marker-parser.ts:28, :530-568); qa-tools scorer passes the same list (qa-tools/src/model/score/cue-contract.ts:83); `reply-replay.ts` passes neither recoverCueNames, declineMarker, nor supplement, so replay differs from live.
- Sticker prompt text rt:1110-1119; marker syntax rt:1036 and strip regex; catalog already a send option (`stickers?` rt:156); host selects the catalog (chat.ts:898).
- Compliance buckets: pure functions `cue-compliance.ts:28,41`, re-exported core-agent/src/index.ts:32; consumers stage-ui devtools act-compliance.ts and qa-tools cue-contract.ts:230.
- Spark instruction `spark-notify/agent.ts:87-94`, used :228; `CreateSparkNotifyAgentOptions` has no instruction field.
- Emotion vocabulary stage-shared/src/stage-contract/index.ts:3-16; cue syntax prose lives in i18n base.yaml:77-81.
- Existing patterns: per-send options (`systemPromptSupplement`, `stickers`, `unpromptedTools`, `origin`, `declineMarker`) and runtime deps (`getSystemPromptSupplement` rt:342, `runtimeContextProviders`).
- qa-tools drives the real runtime through core-agent dist (`score/command.ts:67,97-108`) and `reply-replay.ts:36`.

## Decisions (with rationale)

- Option A over B (qa-tools would import stage-ui; breaks layering) and C (budgets and order would sit in core-agent, contradicting R4). Evidence: architect st_01a1964e.
- New finding (architect): devtools projection shows the stored session prompt plus supplement, never the resolved prompt (no memory index, possibly stale card) - rt:1142, chat.ts:603-606. Closed by pre-resolving step 1 into context (IS-8).
- Scope boundary: composer owns the system message only; unprompted trigger text, situation block on the last user turn, datetime prefixes stay (K3).
- Prefix byte-equality with composeSystemPrompt is a test invariant so STAGE_CONTRACT_EN_SHA256 and the qa-tools prompt hash stay stable.
- Memory ADR:20 says Spark uses the active card's index; audit calls it wrong -> owner decision.
- Luke 2026-11-01 (batch): Spark memory = active card (keep ADR, correct the audit row; add format rules + 320 cap); plugin text = keep in system message as `plugin` segment, 2000-char truncate + warn; overflow = mixed per segment (architect table: card warn, memory drop-oldest 40/6000, stickers 12, voice/control/plugin truncate, toolset/account warn); tests = TDD for pure composer/budgets/prefix equality, tests-after for wiring.

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

Candidate forks (finalize after architect st_01a1964e):
- F1 composer home: stage-shared pure module beside `composeSystemPrompt` (qa-tools can import it; recommended) vs one stage-ui module.
- F2 overflow policy per segment: hard caps on host-controlled list segments (memory index drops lowest-priority entries, sticker catalog caps count, toolset prompts truncate) plus per-segment usage in the inspector; the character card is warn-only because it is the user's own text (recommended) vs warn-only everywhere vs hard caps everywhere.
- F3 compliance buckets (R4): parameterize the pure functions by host cue names and keep them in core-agent (recommended) vs move them to stage-shared.
- F4 test strategy: TDD for the pure composer and budgets, tests-after for wiring (recommended) vs tests-after throughout.

## Approval gate
status: approved (Luke 2026-11-01: "approve skip review"); plan written to .omo/plans/prompt-composer.md; plan-reviewer and plan-consultant skipped at Luke's request
next: on Approve, scaffold plan, run plan-consultant, append todos per 8-commit migration, then plan-reviewer rounds (review_required).
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
