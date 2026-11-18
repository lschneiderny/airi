# Provider Inference

`@proj-airi/provider-inference` owns runtime-neutral AIRI provider definitions.

Use this package to list built-in providers, create provider configuration schemas, and create provider instances. The package runs in Node.js and Browser runtimes.

Do not use this package for provider configuration persistence, Vue views, Pinia state, authentication, or Electron-native providers. Those concerns remain in `@proj-airi/stage-ui`.

## Use

```ts
import { getDefinedProvider, listProviders } from '@proj-airi/provider-inference'

const provider = getDefinedProvider('openai')
const providers = listProviders()
```

Browser-only definitions, such as Web Speech API, load in Node.js. Their availability hook returns `false` when the required Browser capability is absent.

OpenCode Go leaves `User-Agent` to the browser transport. Node.js requests identify AIRI with `User-Agent: Project-AIRI`.
This applies to generation, model discovery, and validation. The Go endpoint does not allow a custom `User-Agent` in CORS preflights.

The Electron desktop app replaces the portable Go definition with a main-owned IPC transport.
Go completion requests currently lack browser CORS support. Browser clients require a separate backend transport.
OpenAI-compatible validators accept `fetchForConfig` for host-owned connectivity probes.
Completion probes preserve the generation provider's transport. Connectivity probes cancel unread response bodies.
Go model discovery preserves its pinned catalog when the host supplies a model-provider transport.

The root entry exports Sherpaw model presets and a definition factory. Vite plugins can use `@proj-airi/provider-inference/sherpaw-transcription/models` to load only model metadata. The presets include stable IDs, languages, recognizer types, pinned revisions, and artifact URLs. Neither entry downloads or loads model files.

`createSherpawTranscriptionDefinition` owns recognition, Worker cleanup, and the first model choice.
The host supplies exposed models, a Worker URL, a fetch function, and the current interface language.
The host also reports whether it runs on mobile. Chinese and English default to X-ASR on desktop and Paraformer on mobile.
`stage-ui` supplies these resources and adds the Hearing settings view.

Use `@proj-airi/stage-ui` for saved provider configuration, Vue settings views, Pinia state, authentication, and Electron-native providers. Do not use this package to manage those application concerns.

## Verify

Run the package checks from the workspace root:

```text
pnpm -F @proj-airi/provider-inference typecheck
pnpm -F @proj-airi/provider-inference test:node
pnpm -F @proj-airi/provider-inference test:browser
pnpm -F @proj-airi/provider-inference build
```

## Generation protocols

OpenAI and OpenAI Compatible configurations accept `api: 'chat-completions' | 'responses'`. OpenAI defaults to `responses`. OpenAI Compatible defaults to `chat-completions`. Saved protocol choices take precedence. The provider settings page renders this field as an API protocol selector.

`ProviderDefinition` owns configuration and instance creation. `getGenerationProvider(instance)` adapts SDK Chat instances at that boundary.
`GenerationProvider.generation(model, options)` selects a protocol and returns its request configuration.
Core-agent receives this single interface and projects context directly into the selected protocol.
Protocol defaults and native tools remain provider-owned policy. The validation probe uses the selected protocol.
`generationProtocolDefinitions` owns the display metadata for every protocol.
Provider schemas use `generationProtocolOptions` to keep selector labels consistent.
Adding a protocol requires a request type and a matching metadata entry. TypeScript reports an incomplete registry or provider request switch.

```ts
const definition = getDefinedProvider('openai')
const provider = await definition.createProvider({
  apiKey: 'your-key',
  api: 'responses',
})
```

User-configured providers send Responses requests directly to their configured endpoint with their own API key. They do not require AIRI backend changes or Flux billing.
The official provider defaults to Responses and lets the user select Chat Completions.

OpenAI has a `webSearch` switch, disabled by default. The selected protocol must be Responses.
Explicitly enabling search sends the hosted tool on the official OpenAI endpoint. The provider validates model support.
Custom endpoints do not inherit this tool declaration. Model names never determine search support.
Search uses the configured OpenAI key and does not require an AIRI login or Tavily key.

## Anthropic Messages API

The Anthropic provider's `api` setting selects the endpoint of its chat requests: `chat-completions`, Anthropic's OpenAI compatibility endpoint and the default, or `messages`, the native Messages API. Both speak the `chat-completions` generation protocol to core-agent, so the rest of AIRI sends the same requests either way.

With `messages`, the provider's `fetch` is `createAnthropicMessagesFetch`. It translates each `POST <baseURL>chat/completions` into a native `/v1/messages` call through `@anthropic-ai/sdk` and translates the response or event stream back. Other requests, such as model listing, pass through. The translation follows the compatibility endpoint where AIRI depends on it:

- Every system and developer message joins the top-level system prompt in order.
- Fields that the compatibility endpoint ignores, such as `seed` and `response_format`, are dropped.
- The API version is `2023-06-01`, whose sampling rules match the compatibility endpoint's; see `MESSAGES_API_VERSION`.

It differs where the native API adds something:

- It marks prompt cache breakpoints at the end of the system prompt, at the end of the history before the newest input, and at the end of a request that ends with tool results.
- `reasoning_effort` sets `output_config.effort`, and `none` turns thinking off.
- A request without `max_tokens` gets `DEFAULT_MAX_TOKENS`, because the Messages API requires one.
- Tool calls arrive whole after the model stops. A response cut off by the output cap or refused carries none, so xsAI never runs a tool on partial input.
- An API error comes back as an HTTP response with the API's status, headers, and body, and the SDK makes no retries, so core-agent's retry policy applies.
- Audio input is refused.

Choose `messages` for prompt caching and effort control, or for a proxy that serves only `/v1/messages`: the SDK appends `/v1/messages` to the base URL without its trailing `/v1`. Over 50 turns of the app's prompt, Claude Haiku 5.5 read 97% of its prompt tokens from the cache and cost 85% less on `messages`, but its first speech came about 75 ms later, so `chat-completions` stays the default. The [Anthropic Messages translator ADR](../../docs/ai/adr/2026-11-18-anthropic-messages-translator.md) has the numbers.

## Model metadata

OpenAI and OpenRouter use their provider-specific [model-bank](https://github.com/lobehub/lobehub/tree/canary/packages/model-bank) catalogs.
The endpoint model list remains authoritative for availability. Catalog data only enriches exact model IDs on the matching endpoint.
Custom endpoints receive no metadata from official routes. There is no separate online catalog request or cache.
Upgrade the pinned model-bank dependency to refresh metadata.

`ModelInfo.metadata` uses model-bank's exported `AIChatModelCard` contract for abilities, settings, and pricing.
Currency and fixed, tiered, or lookup pricing remain intact. Catalog prices are advisory data, not Flux billing quotes.
Reported search abilities do not select a native tool implementation.

OpenAI reasoning controls use the exact model entry and effort levels from the pinned catalog.
Unsupported effort values are omitted. In particular, models without a `none` effort keep their server default when reasoning is disabled.
Generation validation uses the configured model before consulting the endpoint model list.
