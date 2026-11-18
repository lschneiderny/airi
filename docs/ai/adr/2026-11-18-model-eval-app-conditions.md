# Model evaluation under the app's request conditions

Date: 2026-11-18
Status: accepted. Extends M2 of the [model evaluation levels ADR](2026-10-29-model-eval-levels.md).

## Context

The local model screen of 2026-11-18 scored `qa:model run` replies far better than the app's replies to the same model: 88% against 16% well-formed cues for `gemma4:e4b-it-qat`. `qa:model run` composed a smaller prompt, sent no tools, and stored the raw reply text as history. The app sends the card, the stage contract, the Live2D motion list, plugin and memory segments, and a dozen tools, and it stores the canonical cue text. The run also timed the first streamed token, not the first spoken word, and recorded the GPU memory that Ollama's `/api/ps` reports, which reads 0.3 to 1.0 GiB for gemma4 GGUF models that hold more than 3 GiB.

The screen's follow-up measured cache costs, cold starts, overflow, and server settings with scratch scripts that nobody could rerun.

## Decision

`qa:model` measures what the app sends and what the listener hears, and the follow-up measurements become subcommands.

- **Capture, then replay.** `qa:model capture` saves the system prompt, tools, and reply budget of the first chat request in a `qa:app` run or replay request log as `airi.app-request/v1`, with hashes of both. `qa:model run --app-request <file>` sends that system prompt and those tools instead of composing a prompt, and refuses a capture whose text no longer matches its hashes or that lacks the current English stage contract.
- **Tool calls get stub answers.** A run with a capture answers tool calls for up to `--max-steps` steps (default 5). Memory tools keep a per-conversation map; every other tool answers `{"ok":true}`. The turn's record joins the steps' text and sums their timing.
- **Simplifications.** A capture replays the first turn's prompt for every turn: it has no situation block, no memory written during the run, and no per-turn segments. The history holds each turn's words as one assistant message, without tool rounds. Probes that need a segment append it to the end of the system prompt, so they measure the lowest cost of that event. These simplifications are permanent policy for this tool, not compatibility fallbacks.
- **History modes.** `--history raw` stores the reply as written, `canonical` stores what the app stores and is the default with a capture, and `accepted` stores only literals and the cue kinds that the stage controller parses, plus `MOOD`, `SILENT`, and `STICKER`. `accepted` measures a proposed app change; it is not what the app does today.
- **Reasoning and recall.** `--reasoning none|low|medium|high` sends `reasoning_effort`. A scenario may list recall checks (`turn` and words of which any must be spoken). The run writes them to `checks.json`. The committed `long-conversation` scenario has 50 turns, with checks on turns 35 to 40.
- **Time to first speech.** Each record carries `timing.firstSpeechMs`: the earliest streamed prefix at which the core-agent replay yields spoken text. The score summary reports its warm mean.
- **Real memory.** For a loopback Ollama server, the run reads the last load of the model's blob from the server log and records the GPU weight, KV cache, and compute buffers, the CPU weights, the context, and the flash-attention and cache types in `server.json`. `--ollama-log` names another log.
- **Compare.** `qa:model compare` scores several runs together and prints one row per contender (model and config without seed and stage) with cue outcomes, style, timing, recall, and memory, preferring the server log's memory to `/api/ps`.
- **Probes.** `qa:model probe` measures the prompt-cache cost of app events (`cache-events`), cold start (`cold-start`), context overflow (`overflow`), and server settings on private `ollama serve` processes (`server-sweep`). The stage-ui parity test keeps the probe's control-event text equal to the app's.
- **Memory during app QA.** `qa:app` samples the host's memory while the app runs, so a run reports the peak memory pressure of the app and the model server together.

## Consequences

- A cue score from `qa:model run --app-request` can be compared with the app's own replies; a score without a capture still measures the model under a reduced prompt and says so in its config name (`+app-<file>` is absent).
- Captures name the app's prompt at one moment. A stage contract or card change requires a new capture, and the run refuses a capture without the current contract.
- First-speech time replaces first-token time as the latency that a listener notices. On gemma4 it is about 0.1 s later, because replies open with a cue.
- `/api/ps` remains in `server.json` for servers without a readable log, and compare marks which source each row used.
- Probes measure the lower bound of segment changes because they append segments at the end. A change in where the app places a segment needs a probe change too.
