# Reply-shape rules in the stage contract

Date: 2026-10-31
Status: accepted

## Context

The system prompt of a chat turn is the formatting rules, the character card prompt, the stage contract (cue syntax, the emotion list, the speech-safe text rule), the toolset supplement, and the memory index. Nothing in it constrains the shape of a reply on a user turn. Only the unprompted prompts (`base.prompt.unprompted*`) ask for one or two short sentences and at most one question.

Without that constraint a chat model falls into its default register: a complete, helpful answer that ends on a question to keep the conversation going. The product goal is a character who lives in the corner of the screen and talks like a person, so replies read as too long, contrived, and question-heavy.

## Decision

Add a reply-shape section, `base.prompt.response`, to the stage contract and render it last. It states that a reply is spoken and short unless the content or the user asks for more, that the character is a person rather than an assistant (no offers of help, recaps, or check-ins), that a question is asked only when she wants the answer and never more than one, and that situation awareness is not a topic unless it is the thought itself. The rules are persona-neutral: the character card still owns personality and voice and can tune them.

Back the rules with `REPLY_MAX_TOKENS` (320) from `@proj-airi/stage-shared/stage-contract`, sent as the per-step `maxTokens` of every chat turn in `prepareSend`. A reply that follows the rules stays far below it; it binds only when the model ignores them.

The English contract hash `STAGE_CONTRACT_EN_SHA256` changes with this section, so model-eval runs record the new contract version and before/after results stay distinguishable.

## Consequences

Other locales render the English section through the i18n fallback until they translate it; this fork does not translate frozen locales.

Providers decide whether reasoning tokens count toward `max_tokens`. A thinking model that counts them can reach the cap before it speaks and return a truncated or empty reply. The constant is the single place to raise the cap if a chosen model needs it.

The cap applies to every model request of a turn, tool continuations included. Tool-call arguments on chat turns (memory entries, wake words) are small.

## Validation

`stage-shared/src/stage-contract/index.test.ts` pins the rendered order and the English hash; `stage-ui/src/composables/use-airi-runtime-prompt.test.ts` and `qa-tools/src/model/stage-contract.test.ts` check the same hash through the real i18n instance. Reply length and question rate are measured with the model-eval track, not asserted in tests.
