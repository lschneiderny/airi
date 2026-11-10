# Model evaluation levels and offline replay

Date: 2026-10-29
Status: accepted

## Context

The Mac benchmark was run outside the application and reviewed by hand. Its output did not have a stable transcript schema or provenance key, and its scorer duplicated cue rules. This made it difficult to compare saved replies with the behavior users get from the chat runtime. The model evaluation tools provide deterministic fixtures and offline replay first. Live runs and automated persona judgment remain future work.

## Decisions

### Levels

- M0 runs committed cue-contract fixtures through the real runtime at every chunk boundary.
- M1 replays saved transcripts through the real chat runtime and stage controller.
- M2 runs a model live against a scenario and records request options and transcript provenance. The tooling is implemented; see [M2: live runs](#m2-live-runs). The first real run, of `granite4:latest`, is committed as two live sets.
- M3 will support judged persona review against an explicit rubric. It is planned, not implemented.
- M4 is Luke's reading of replies and evidence for character quality.

These levels answer different questions. M0 locks local behavior, M1 compares captured replies without another model call, M2 measures live generation, M3 will add a structured judge, and M4 remains human review.

### Runtime oracle and contract renderer

Offline replay uses `createChatOrchestratorRuntime` and the real streaming controller rather than a second implementation of cue behavior. The shared bucket functions provide the same outcomes used by the application. The shared contract renderer produces the contract text used by both the app and prompt command.

### M2: live runs

Added 2026-11-10. `pnpm qa:model run --scenario <id|file.json> --base-url <url> --model <id> [--config <name>] [--out <dir>]` sends a scenario to a chat endpoint and writes one transcript record per reply. `qa:model score` reads the result like any other transcript file; the scorer has no branch for live records.

#### Why older replies do not carry over

`STAGE_CONTRACT_EN_SHA256` has changed several times since the Mac benchmark. A reply answers the contract it was shown, so replies to an older contract say nothing about the current one. A run therefore never takes a contract or a prompt as input. It renders the contract from the current source and composes the system prompt with the production composer (`buildSystemPrompt`, which calls the shared `composePrompt`). It refuses to start when the rendered English contract is not `STAGE_CONTRACT_EN_SHA256`. That happens when the i18n build is stale, because the locale messages come from that build. Each record names the contract it answered. Compare two runs only when their `prompt.contractVersion` values are equal; the score summary lists the versions in its header.

#### Scenario

A scenario is a JSON file with the schema `airi.model-scenario/v1`, validated by `ModelScenarioSchema` in `packages/qa-tools/src/model/run/scenario.ts`. Committed scenarios live in `packages/qa-tools/fixtures/model/scenarios/`. A scenario fixes everything about a run except the endpoint and the model:

| Field | What it fixes |
| --- | --- |
| `id`, `version` | The identity of the scenario. Bump `version` with any change that alters a request. |
| `description` | What the scenario is for. |
| `prompt.cardFile` | A card prompt file beside the scenario. Without it, the run uses the built-in card (`base.prompt.prefix`). |
| `prompt.register`, `prompt.textingFlavor` | The register section, required because the app always sends one. |
| `prompt.exposedActions` | Exposed clips in the `--exposed-actions` syntax. Only gestures are accepted; see [Tools](#tools). |
| `startsAt` | The wall-clock time of the first user turn. Each later turn is one minute later. |
| `stages` | Optional relationship stages. Each stage is its own conversation over the same turns. |
| `configs` | Named request options: `temperature`, `top_p`, `max_tokens`, `seed`, and `reasoning_effort`. `--config` selects one; the default name is `default`. |
| `turns` | The user turns, in order. |

The config keys are wire names and reach the request body unchanged. A key the config omits is not sent, so the endpoint's default applies. The committed scenarios set `max_tokens` to `REPLY_MAX_TOKENS`, the cap the app sends; a test fails when they drift. `reasoning_effort` takes `none`, `low`, `medium`, or `high`, the values the app's Ollama provider sends for its thinking mode. The committed scenarios omit it, as the app does in its `auto` mode. A thinking model then reasons by default, and a provider may count reasoning tokens toward the cap; add a config with `reasoning_effort: none` to run such a model without reasoning.

A scenario cannot set a context size. An OpenAI-compatible request has no field for it, and Ollama's compatible endpoint uses the server's context size. The benchmark audit measured Ollama truncating the prompt without an error at a 4,096-token default. Ollama 0.40.16 picks a default of 4k, 32k, or 256k tokens from the available VRAM. Before a run against Ollama, set the context size on the server (`OLLAMA_CONTEXT_LENGTH`, or a derived model with `PARAMETER num_ctx`). The run cannot record the context size, because the endpoint does not report it. Compare `usage.prompt_tokens` with the configured context to detect truncation.

The run builds each request as the app does, with these parts:

- The system message is the composed prompt: formatting rules, card, register section, stage contract, and the `actions` segment when clips are exposed.
- Each user message is the app's time prefix (`formatTimePrefix`, from the scenario clock) and the turn text. A stage adds a blank line and the `system:character` text of that stage, which is the position the app's request assembly gives runtime context. The text comes from the same preset renderer as `pnpm qa:character render --stage`, with the mood at rest. A stranger at rest has no character text, as in the app.
- Each reply joins the history as the assistant message of the next request. A failed request ends its conversation, because later turns would continue from a reply that never arrived.

Known differences from an app request: there is no situation block, no memory, toolset, or sticker segment, no widget instruction on the built-in card, and no tools. The tail segments and the widget instruction name tools, so they wait for the tools decision below.

#### Endpoint shape

One shape is supported: an OpenAI-compatible base URL, to which the run posts `<base-url>/chat/completions` with `stream: true` and `stream_options.include_usage: true`, as the app does. This covers Ollama (`http://127.0.0.1:11434/v1`) and the replay server (`pnpm qa:llm serve`). It is also the shape the app itself uses for Ollama: its provider is created with the `/v1/` base URL. The run sends no credentials and refuses a base URL that contains them, because the records and `run.json` name the base URL. Hosted endpoints that need a key are out of scope until a run needs one.

Ollama's native `/api/chat` shape is not implemented. It would add a per-request context size, load and evaluation durations, and the model digest. It should be added and verified against a real model, not written from memory.

#### Record provenance

A live record uses the schema `airi.reply-transcript/v2`: every v1 field plus a `live` block. v1 remains the format of imported replies, which have no live provenance, so the committed legacy set is unchanged and both versions are current. The rule for every field is that it holds what the runner sent or what the endpoint returned. A value the endpoint did not report is `null`.

| Field | Value in a live record |
| --- | --- |
| `set` | The scenario id. |
| `runKey` | `<scenario id>@<version>/<model>/<config>`, with `@<stage>` appended to the config when the scenario has stages. |
| `source` | `kind: live`, the scenario file and its SHA-256, the zero-based turn index, and a path that includes the request start time. |
| `model.id` | The model id the request asked for. It names the run because it exists even when the request fails. |
| `model.provider`, `model.digest`, `model.capabilities` | `openai-compatible`, `null`, and an empty list: this endpoint shape reports neither a digest nor capabilities. |
| `generation.config` | The config name, with `@<stage>` appended when the scenario has stages, so the summary shows one labeled row per stage. |
| `generation.options` | Every key of the request body except `model` and `messages`: the config options sent, `stream`, and `stream_options`. |
| `generation.think`, `generation.withTools` | The `reasoning_effort` that was sent, or `null` when none was sent; and `false`. |
| `prompt.sha256`, `prompt.shaSource` | The SHA-256 of the system prompt text, `recorded`. |
| `prompt.contractVersion`, `live.contractSha256` | The first 12 characters and the full SHA-256 of the stage contract in that prompt. |
| `prompt.toolsSha256` | `null`, because no tools are sent. |
| `machine.label` | `--machine-label`, or the host of the base URL. The run does not know the hardware behind an endpoint. |
| `conversation` | The one-based turn number and the user text of the scenario, without the time prefix or context. |
| `reply` | The text, reasoning text, tool calls, and finish reason the endpoint streamed; `error` for a failed request; `steps: 1`. |
| `timing.ttftMs`, `timing.totalMs` | Client-measured time to the first text, reasoning, or tool-call delta, and to the end of the stream. `ttftMs` is `null` when no delta arrived. |
| `usage` | The endpoint's `usage` object as returned, or `null`. |
| `live.scenario` | The scenario `id` and `version`, and the `stage` or `null`. |
| `live.endpoint` | `shape: openai-chat-completions` and the base URL. |
| `live.request` | The requested `model`, the request start time, and `bodySha256`, the SHA-256 of the request body bytes. |
| `live.response` | The HTTP `status`, the response `id`, the `model` the endpoint reported, `systemFingerprint`, and the end time. All but the end time are `null` when not reported. |

The run directory comes from the evidence helper (`createRun`), so `run.json` records the command, the source revision, and the dirty state. It holds `transcripts.jsonl` and `requests.jsonl`. `requests.jsonl` has one line per record with its reply id and the exact request body, so a reader can see the user message and history behind any reply. The command exits 0 when every request returned a reply, 1 when one failed, and 2 for invalid arguments or a refused setup.

The summary reports mean time to first token and mean total time for a live run. It reports no generation speed, because `genTps` needs the evaluation duration, which this endpoint shape does not return.

#### Tools

A run sends no tools. This is a decision about M2 as built, not a claim that tools do not matter. The benchmark audit measured that the 13 tool schemas were about three quarters of the prompt, that they decide cold and warm reply times, and that several small models answered turns with tool calls alone.

The alternatives were rejected for these reasons:

- **Send the production tool list.** No Node function produces it. The app assembles it at run time from stores: the loaded model's expression list, MCP servers, and plugins. The only committed copy is the capture in `scripts/ollama-bench/inputs/tools.json` from 2026-10-26, which has neither `perform_action` nor the memory tools. Sending it would present an old tool list as the current one.
- **Make tools a scenario field now.** Tools without a tool loop distort the turns after a tool call. The audit recorded that a harness without the loop made granite4 call `get_weather` on every later turn. A field would therefore need the loop with stubbed results as well, and neither would have a committed scenario that uses it.

Consequences that a reader of M2 results must know:

- The prompt is much smaller than the app's for a tool-capable model, so reply times are not the app's reply times.
- A run does not measure tool misfires. It measures the cue contract, the register, and the persona under the system prompt alone.
- A scenario may expose gestures only. The prompt tells the model to call `perform_action` for an action or a dance, and that tool is not sent, so the schema rejects those kinds.

Tools should become a scenario field when two things exist: a current capture of the app's tool list, which a `qa:app` run writes to the `requests.jsonl` of its run directory, and a tool loop that mirrors the app's step loop with stubbed results. The record then needs the tool names beside `prompt.toolsSha256`, which is another schema version.

#### Committed scenarios

- `general`: six turns with the built-in card in the talking register: a greeting, an emotional turn, good news, a request for a visible reaction, a request for the exposed `wave` gesture, and a factual question.
- `relationship-stages`: four turns at each of the four relationship stages, as four separate conversations. The summary has one row per stage.

Each scenario has a replay script in `packages/qa-tools/fixtures/model/scenarios/replay/` with one scripted reply per request. The scripts exist to exercise the pipeline without a model. Their replies are written by hand and are not model output.

#### What M2 still lacks

- More than one real run. The first, on 2026-11-10, ran `granite4:latest` on Ollama 0.40.16 for both scenarios and is committed as `model-eval/sets/live-2026-11-10-granite4-general` and `live-2026-11-10-granite4-relationship-stages`. It is one model with default sampling, so it ranks nothing yet.
- Tools, the native Ollama shape, and the situation block, as described above.
- Mood as a scenario input. Stages render with the mood at rest.

### Committed dataset

Datasets live under `packages/qa-tools/model-eval/sets/<set-id>/`. The saved transcript schema carries source, model, generation, prompt, machine, conversation, reply, timing, and usage fields needed to identify each record. Model evaluation output distinguishes contract metrics from style heuristics; heuristics are not combined into a score.

The `legacy-2026-10-27-mac-m2` set remains separate from runs using the canonical current prompt. It reproduces historical findings on fixed replies. It must not be mixed with canonical-contract runs or used to rank models against the current prompt.

### Contract and scorer versions

The rendered stage-contract version is the first 12 characters of its SHA-256. This identifies the exact contract text. Separately, when any scorer definition changes, bump `CUE_CONTRACT_SCORER.version` in the same commit. Run comparison uses `closureDigest`, scorer version, and `coreAgentDistSha256` as one comparability key.

### Provenance

The closure digest covers the sorted model-scoring source closure, with CRLF line endings normalized to LF before hashing. This makes source hashes stable across checkout line-ending settings while preserving other bytes. `coreAgentDistSha256` separately identifies the built runtime that scoring executed. The run manifest records the scorer identity, source revision, and dirty state.

## Consequences

- The legacy Mac M2 comparison confirmed five of six claims: dolphin3's unknown LOOK marker and invented emotion names, hermes3's zero leading cues, gemma4's invented `pouting` and `pouty`, qwen3.5's lower JSON cue count at temperature 0.6, and ministral-3's stage directions in every sweep reply. Row 4, cogito:8b example echo at temperature 0.6, was initially a finding because CRLF extraction returned no examples. The extractor was fixed to accept CRLF, and the regenerated comparison confirms `style.exampleEcho = 4` for `cogito:8b/temp-0.6`.
- Fixture 25 pins the pre-existing chunk-variance defect at `packages/core-agent/src/runtime/response-categoriser.ts:260-289`. Whole-text and per-character replay differ for this case. The finding is recorded, not hidden by changing runtime behavior.
- M2 has its scenario schema and live transcript source since 2026-11-10, and one real run of `granite4:latest` (see the two `live-2026-11-10-granite4-*` sets). In that run every `general` reply opened with a malformed `|<ACT` marker that the runtime recovered. A repeat with the identical prompt wrote well-formed markers, so one unseeded run does not characterise a model; comparisons need repeated or seeded runs. M3 still needs its judge and persona rubric; the `relationship-stages` transcripts are its first input, because the cue-contract scorer cannot tell whether a reply suits a stage.
- A root `AGENTS.md` routing row for model evaluation remains follow-up work and must land as a separate agent-configuration commit.
- `packages/core-agent/vieval.config.ts` remains an unrelated leftover.
- The stale `[Act 2]` comment in the compliance test was corrected to match runtime behavior.
- `packages/stage-ui/src/stores/providers/use-provider-validation.browser.test.ts` has an intermittent Pinia teardown rejection at line 52. It is a pre-existing test flake, not a model-evaluation failure.
