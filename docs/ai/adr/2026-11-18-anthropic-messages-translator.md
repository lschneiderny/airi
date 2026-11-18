# Anthropic Messages API through a fetch translator

Date: 2026-11-18
Status: accepted. Current reference: [provider-inference README](../../../packages/provider-inference/README.md#anthropic-messages-api).

## Context

The Anthropic provider sends xsAI's OpenAI-shaped chat requests to Anthropic's OpenAI compatibility endpoint, `/v1/chat/completions`. That endpoint has no prompt cache, ignores `reasoning_effort`, cannot reach proxies that serve only the native `/v1/messages`, and returns HTTP 400 when the output cap cuts a tool call mid-arguments. Anthropic documents it as a way to compare models, not as a production path.

Native support has two possible shapes:

- A third generation protocol in core-agent, next to Chat Completions and Responses. It could keep Claude's reasoning across turns and place cache breakpoints from the composer's stable prefix. But upstream changes the two existing protocol adapters every week or two (retry policy, output caps, tool step limits, tool-call ordering), and each change would have to be ported by hand at every sync.
- A translator at the provider's `fetch` boundary, the shape of the Amazon Bedrock provider in `provider-inference` and of upstream's closed PR #2098. Core-agent and the rest of AIRI keep sending Chat Completions requests. An upstream sync touches one provider file.

## Decision

The Anthropic provider gains an `api` setting. `messages` sets its `fetch` to `createAnthropicMessagesFetch`, which translates each chat request to the Messages API through the official `@anthropic-ai/sdk` and translates the response or event stream back. Core-agent is unchanged.

- **Compatibility first.** The translation keeps the compatibility endpoint's behavior where AIRI depends on it. It joins every system message into the system prompt, drops fields that endpoint ignores, and pins API version `2023-06-01`. On that version, sampling parameters work wherever the model accepts them; on `2026-10-21` they fail on every model.
- **What the native API adds.** Cache breakpoints sit at the end of the system prompt, at the end of the history before the newest input (the situation block rides on the newest user message), and at the end of a request that ends with tool results. `reasoning_effort` becomes `output_config.effort`. Tool calls are sent whole after the stop reason arrives, and none are sent when the output cap or a refusal stopped the reply, because xsAI runs every tool call it receives. API errors keep their status and headers, and the SDK makes no retries, so core-agent's transient retry still decides.
- **The default stays `chat-completions`.** See the measurement below.

## Measurement

The 50-turn `long-conversation` scenario was run with the app capture `hiyori` (system prompt about 12k tokens, 12 tools), canonical history, a 2048-token cap, and `claude-haiku-5-5`. Both endpoints ran at the same time from the same machine.

| | Compatibility endpoint | Messages API |
| --- | --- | --- |
| Errors | 0 | 0 |
| Cues parsed | 100% | 98% (one rejected reply) |
| Recall checks | 6/6 | 6/6 |
| Prompt tokens read from cache | 0% | 97% |
| Estimated cost of the run | $0.078 | $0.012 |
| Median time to first token | 546 ms | 632 ms |
| Warm first speech, mean | 0.68 s | 0.76 s |

The latency gap is not the translator. Interleaved requests with one turn's body showed these medians:

- Raw `fetch` to `/v1/messages`: 620 ms. The compatibility endpoint: 546 ms.
- Without cache markers, and with a plain string system prompt: the gap stayed at 63 to 83 ms.
- With a five-word prompt: no gap (820 ms against 818 ms).
- Low effort, thinking off, and API version `2026-10-21` did not close it. None of these requests produced thinking tokens.

Reading the cached prefix did not lower time to first token either (665 ms with markers, 641 ms without). Claude Haiku 5.5 prefills 12k tokens fast enough that the cache saves money, not time.

## Consequences

- With the default, nothing changes for current users. The Messages API is one setting away. It suits a costlier model, where an 85% smaller input bill matters: Claude Opus 5.5 input costs 40 times Claude Haiku 5.5's. It also suits a native-only proxy, or effort control.
- The core-agent protocol is not built. Revisit it only if a measurement shows that the translator's limits cost something: lost reasoning across turns, or cache misses from system prompt churn.
- Revisit the default when Anthropic's native endpoint matches the compatibility endpoint's time to first token on a long prompt (rerun the comparison above), or when the compatibility endpoint loses a feature that AIRI uses.
- The `2023-06-01` pin is permanent policy until AIRI stops sending sampling parameters to Anthropic or Anthropic announces its retirement.
- If upstream ships native Anthropic support (issue #1565), the fork takes upstream's and deletes the translator ([upstream policy ledger](../context/upstream-policy.md)).
