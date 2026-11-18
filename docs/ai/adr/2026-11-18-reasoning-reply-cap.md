# Reply cap for requests that may reason

Date: 2026-11-18
Status: accepted. Amends the output cap of the [reply-shape ADR](2026-10-31-reply-shape-contract.md). Current rules: [LLM prompt](../context/llm-prompt.md).

## Context

The reply-shape ADR backed its rules with `REPLY_MAX_TOKENS` (320) on every chat request and noted that a thinking model whose provider counts reasoning tokens can reach the cap before it speaks.

That happens with Claude. The app's Anthropic provider sends the OpenAI chat request to Anthropic's compatibility endpoint, which ignores `reasoning_effort`, and Claude 5 models reason on every request there. With the app's captured prompt, Claude Haiku 5.5 spent the whole cap on reasoning and returned no speech on two of two tries of a turn that asked it to remember a fact. In a 3-turn run, one reply stopped mid-word and the next request failed with HTTP 400, because the cap cut a memory tool call mid-arguments. With a 2048-token cap the same turn used 593 to 711 tokens and wrote the memory cleanly. Over 100 ordinary turns at a high cap, Haiku's median was 75 tokens, reasoning included, and it followed the cue contract on 98 to 100% of replies.

Disabling reasoning is not a general fix. The compatibility endpoint accepts `thinking: {type: "disabled"}` for Haiku 5.5, but Claude Opus 5.5 and Sonnet 5.5 reject it, and Haiku without reasoning wrote its reasoning into the reply text, which the app would speak.

## Decision

The output cap depends on whether the request may reason. `replyMaxTokensFor` in `packages/stage-ui/src/libs/providers/reply-max-tokens.ts` holds the rule, and `useConsciousnessStore().replyMaxTokens(provider, model)` applies it with the same reasoning mode that `getChatProviderInstance` sends:

- Reasoning `disabled`: `REPLY_MAX_TOKENS` (320).
- Reasoning `enabled`: `REASONING_REPLY_MAX_TOKENS` (2048).
- No reasoning mode (the provider has no reasoning control, or OpenRouter uses the model default): 2048 for a cloud provider, whose default may reason; 320 for a local provider or an endpoint whose deployment the catalogue does not state.

Chat turns, background task turns, notice turns, `ingest`, unprompted turns, and the Spark Notify agent all take the cap from this function.

## Consequences

- Claude and other cloud models that reason by default keep their speech and their tool calls.
- The reply-shape rules still govern length. On a cloud request that may reason, the cap no longer stops a reply that ignores them before 2048 tokens; at cloud speeds that is seconds.
- A local model keeps the 320 cap that stops a slow runaway reply, unless the user turns reasoning on.
- A generic OpenAI-compatible endpoint has no deployment in the catalogue and keeps 320, even when it serves a cloud model that reasons. The user can choose the provider's own entry instead.
- A request that asks for reasoning `disabled` keeps 320 even when the model cannot turn reasoning off (older OpenAI reasoning models), as before.
- `qa:model run` scenarios pin `max_tokens` to `REPLY_MAX_TOKENS`, which is the local cap; a run of a cloud model that reasons sets a larger cap in its own config.
