# Prompt composition

Date: 2026-11-01
Status: accepted

## Context

A character turn's system prompt was concatenated in eight places: the typed send, the unprompted turn, `ingest`, Spark Notify, and two joins in the core-agent runtime. The paths disagreed about which parts they included. Only five parts had a size limit, and the order of the parts was guaranteed only by a comment. The [architecture audit](../audits/2026-10-31-architecture-boundaries.md) records this as rows R2 to R4.

## Decision

Every character-turn system prompt is built by `composePrompt` in `@proj-airi/stage-shared/stage-contract` (`packages/stage-shared/src/stage-contract/compose.ts`). The function is pure: it reads no locale, store, or clock. Hosts render the segment texts and pass them in.

### Segment order and tiers

| Order | Segment | Tier | Policy | Budget (chars) |
| --- | --- | --- | --- | --- |
| 1 | `format` (code block and math rules) | prefix | fixed | - |
| 2 | `card` (character prompt) | prefix | warn | 8000 |
| 3 | `register` (conversation register section) | prefix | fixed | - |
| 4 | `contract` (stage contract) | prefix | fixed | - |
| 5 | `actions` (exposed clip instruction) | tail | truncate | 1500 |
| 6 | `memory` (memory index) | tail | drop-oldest | 40 entries, 6000 |
| 7 | `toolset` | tail | warn | 2000 |
| 8 | `account` | tail | warn | 2000 |
| 9 | `voice` | tail | truncate | 1000 |
| 10 | `control` | tail | truncate | 1500 |
| 11 | `unprompted` | tail | fixed | - |
| 12 | `plugin` | tail | truncate | 2000 |
| 13 | `stickers` | tail | drop-oldest | 12 entries |
| 14 | `spark` | tail | fixed | - |

The composer orders segments by this table, not by input order. Non-empty segments are joined by a blank line (`\n\n`). The only exception is `format`, which ends with its own newline and is followed directly by the card. This keeps the prefix byte-identical to `composeSystemPrompt` before the composer existed, so the provider's prompt cache and the contract fingerprint are unaffected. The contract still renders last in the prefix, as the [reply-shape ADR](2026-10-31-reply-shape-contract.md) requires. `composeSystemPrompt` is now `composePrompt([format, card, contract]).prefix`. The `register` segment carries the register section of the conversation settings. It belongs to the character prompt, so it renders after the card and before the contract, and the contract text never depends on the register. With a register section, the prefix equals `composeSystemPrompt` of the card and the section joined by a blank line, which is the stored session system message.

The prefix changes only when the card, the conversation register, or the contract changes. Tail segments change per turn and follow the prefix.

### Overflow policies

- `fixed`: host-written constant text. It has no budget and is never changed or flagged.
- `warn`: the text is kept unchanged, and the report sets `overBudget`. The card uses this policy because cutting it would change the character and the cacheable prefix.
- `truncate`: text over the budget is cut, and `…[truncated]` is appended. The marker counts inside the budget, so a truncated segment is exactly the budget long. A surrogate pair is never split.
- `drop-oldest`: the segment takes its entries oldest first, plus an optional header. Entries are dropped from the front until both the entry cap and the char cap hold. The char cap counts the entries joined by newlines, not the header. The header stays when every entry is dropped.

Overflow never throws. An unknown or duplicate segment id throws, because it is a programming error.

`composePrompt` returns `{ text, prefix, tail, report }`. The report has one entry per supplied segment, in segment order, with `id`, `chars`, `estimatedTokens` (`ceil(chars / 4)`), `dropped`, `truncated`, and `overBudget`. `overBudget` means that the input exceeded the budget, whatever the policy did about it. Budgets are in chars, not tokens, so no tokenizer is needed.

### Owner decisions (2026-11-01)

- Spark Notify reactions use the active card's memory, as the [memory adoption ADR](2026-10-30-long-term-memory-adoption.md) states. They also get the format rules and the reply token cap.
- Plugin text keeps system authority, with a 2000-char cap. Over-cap plugin text is truncated and flagged in the report.
- The sticker list is capped at 12 entries. The memory index drops its oldest entries past 40 entries or 6000 chars.

### Exception: cue-compliance eval oracle

core-agent holds no stage prompt text after this change. The exception is `cue-compliance.ts` and `cue-contract-fixtures.ts`. They stay in core-agent as the eval oracle that `qa-tools` scores against (`packages/qa-tools/src/model/score/closure-files.ts`). Moving them would change the eval closure.

## Consequences

- A new prompt segment needs a row in `PROMPT_SEGMENT_ORDER` and `PROMPT_SEGMENT_BUDGETS`, and an amendment to this record.
- The situation block, the unprompted trigger message, and per-message timestamps are not system-prompt segments and stay where they are.
- The devtools inspector can show each segment's size from the report.

## Validation

`packages/stage-shared/src/stage-contract/compose.test.ts` checks segment order, the join, each overflow policy, the report fields, the thrown errors, and that the prefix keeps the SHA-256 of the pre-composer `composeSystemPrompt` output for six card and contract fixtures.

## Amendments

### 2026-11-04: Exposed clip instruction segment

- **`actions`.** The instruction for the exposed MMD clips (the gesture labels for the ACT `action` field and the `perform_action` labels) is the `actions` tail segment, which `useStageActionsPrompt` renders from the `base.prompt.actions-gestures` and `base.prompt.actions-actions` keys. It is empty while no clip is exposed, so the prompt then keeps its bytes.
- **Why not the situation block.** The situation block keeps only a prefix of its bullets within 6 lines and 500 chars, so on Windows the activity, event, and context bullets routinely pushed a clip bullet out of the request. A system-prompt segment has its own budget and reaches every character turn, chat and Spark Notify alike.
- **Placement.** It leads the tail because the exposed clips change only when the user curates them, so the cacheable span before the per-turn segments stays as long as possible. The `truncate` cap of 1500 chars holds the two sentences and about 80 labels; past it the report flags `overBudget`.

### 2026-11-01: Spark Notify and ingest

- **Spark Notify.** The Spark Notify agent appends its host instruction after the composed prompt. The `spark` segment id is reserved and unused, and the instruction is outside the size report. Spark receives the same segments as chat, including the toolset and account text.
- **`ingest`.** `ingest` keeps the caller's model and provider. It composes the same prompt and output cap as chat. Where the plan says "same provider/model resolution", the shared part is the prompt and the cap, not the provider resolution.
