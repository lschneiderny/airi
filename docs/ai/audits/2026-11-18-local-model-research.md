# Local character model research (2026-11-18)

Scope: find the best local-only results for the character on a MacBook with an Apple M2 (4 performance and 4 efficiency cores, 10-core GPU) and 16 GB of unified memory, of which macOS lets the GPU wire about 10.7 GiB. The work tested models, server settings, runtimes, and the app's own request, and changed tooling and runtime code where testing showed a gap. It supersedes the model recommendation of the [2026-10-26 benchmark](2026-10-26-ollama-local-model-benchmark.md), which chose `granite4:latest` on Ollama 0.34.3.

Status vocabulary: `measured` comes from a recorded run, `observed` was seen in replies or logs, `inferred` follows from code, and `unverified` names the check that would settle it.

The data is in the [local model screen set](../../../packages/lab-tools/model-eval/sets/live-2026-11-18-mac-m2-local-models/README.md): its transcripts, scores, pooled tables, and `results/app-conditions.json`. The current recommendation and open decisions are kept in [Local character models](../context/local-models.md); this report is the record of how they were reached.

## Summary

- **Use `gemma4:e4b-it-qat` on Ollama 0.40.16 or later** (`measured`). It replies in about 1.3 s at about 30 tok/s, uses about 3.3 GiB of GPU memory with a 16k context, stays in character with short lively lines, and wrote the best cues of the fast models in the screen. `gemma4:12b-it-qat` writes the cleanest cues but takes 7 to 10 s per reply and 7.6 GiB.
- **Keep Ollama's server defaults, at a 16k context, with reasoning off** (`measured`). An 8-bit KV cache was slower and broke more cues; turning off flash attention cost memory and speed; context size cost little memory. Thinking models spend the 320-token reply cap on reasoning and often say nothing.
- **Avoid Ollama's MLX builds on 16 GB** (`measured`). On this Mac, untagged names resolve to MLX `nvfp4` builds whose memory grows about 0.1 GiB per request until the model unloads. Standalone mlx-lm did not grow but was no faster than the GGUF build.
- **The app's own prompt costs more cue quality than any model choice** (`measured`). With the request the app actually sends, `gemma4:e4b-it-qat` wrote 16% well-formed cues instead of 88 to 93%. The Live2D motion list that `formatLive2DActPrompt` adds is the main cause: removing its 561 characters restored 93%.
- **Invented markers snowball through the stored history** (`measured`). `canonicalCueText` keeps well-formed unknown markers such as `<|look: you|>`, and the model copies them in every later reply: 50-turn conversations fell to 18% well-formed cues. Keeping only accepted cue kinds in the history raised that to 73%, or 92% without the motion list.
- **The local prompt cache works on normal turns but not after some events** (`measured`). A normal turn starts in about 0.3 s. A memory write, the first voice turn with `control` events, and the turn after an unprompted turn each re-read the whole prompt, about 15 s at 12 turns with tools.
- **Long chats overflow silently** (`measured`). Past 16k tokens, Ollama drops the oldest messages and leaves about 30 tokens for the reply. The card's history-length setting prevents it but defaults to unlimited.

## Changes made during the work

- `fix(core-agent): speak the text before a tag that never closes` (`e2b59ccdc`). Unclosed tag-like text swallowed the speech before it; `granite4` had answered 6 of 6 turns silently in one run. After the fix its blank replies fell from 7 to 1 of 36.
- `feat(qa-tools): record local server state and client timing in model runs` (`7640bc359`). `qa:model run` writes `server.json` from Ollama's API, and the summary reports cold and warm time to first token, decode speed, and prompt tokens.
- `docs(qa-tools): add the local model screen on a 16 GB M2 Mac` (`6d4c62366`) and `docs(qa-tools): record the lead local model under app conditions` (`fa16752e9`): the set, its results, and the [Local character models](../context/local-models.md) page.
- Ollama was updated from 0.34.3 to 0.40.16 with the owner's approval.

## Method

### Model screen

1. Scratch copies of the committed `general-seeded` and `relationship-stages` scenarios with `reasoning_effort: none` on every config, because the Ollama provider sends `none` while the Consciousness reasoning setting is off. The copies are committed in the set's `inputs/`.
2. For each model, six seeded general conversations of six turns (seeds 1 to 3 at the default temperature and at 0.3) and one 16-turn stage conversation, through `pnpm qa:model run` against Ollama's `/v1` endpoint with a 16k context. Scored with `qa:model score` (`cue-contract-score` version 5).
3. Real GPU memory of GGUF builds read from the Metal buffer sizes in Ollama's server log, because Ollama 0.40.16's `/api/ps` reports 0.3 to 1.0 GiB for GGUF gemma4 models.
4. Server settings (context 8k, 16k, and 32k; `q8_0` KV cache; flash attention off) on a private `ollama serve` per setting.
5. Memory growth over 42 requests per build, and one standalone `mlx_lm.server` run in a separate virtual environment.
6. A prompt-cache probe with Ollama's native `/api/chat`: a 12-turn history with the full prompt and tools, comparing an unchanged system prompt, a changing line at its end, and the same line in the last user message.

Disk stayed within a rolling 20 GB budget: models that lost were deleted, and the owner's installed models were kept.

### App conditions

1. One `pnpm qa:app run` turn with the bundled Hiyori Live2D model and the replay server captured the request the app sends from a fresh profile: 12 tools (26.8k characters) and a 6.3k-character system prompt, about 6.4k tokens before any history.
2. A scratch harness sent scenario turns with that system prompt and those tools through `/v1`, with the app's time prefixes and a situation block on the last user message, answered tool calls with stubs, and fed replies back as raw text, as canonical text (`canonicalCueText`, as the app stores them), or as canonical text with unknown markers removed. `qa:model score` scored the spoken text.
3. A 50-turn evening conversation (two seeds) with six early facts asked again around turn 36.
4. An event probe that left the server cache in the state the app would leave it, then timed the first token after each real event.
5. Three seeded conversations while `pnpm qa:smoke --settle 300` rendered the default Live2D character, against the same three with the app closed, with system memory sampled every 2 s.
6. Cold-start timing after an unload, and a check of whether `/v1` honors `keep_alive`.
7. A context-overflow probe with a canary in the system prompt and another in the first user message, padded past 16k tokens.

## Results

### Model screen (general scenario, 36 replies per row)

| Model | Parsed % | Rejected % | Words | Total s | Decode tok/s | Memory GiB |
| --- | --- | --- | --- | --- | --- | --- |
| `gemma4:e4b-it-qat` | 88 | 4 | 11.1 | 1.27 | 29.5 | 3.25 |
| `gemma4:e4b` (MLX) | 97 | 3 | 17.0 | 1.86 | 27.6 | 9.6, growing |
| mlx-lm `gemma-4-e4b-it-4bit` | 100 | 0 | 10.8 | 1.65 | 27.7 | about 5, flat |
| `gemma4:12b-it-qat` | 100 | 0 | 15.1 | 6.86 | 12.0 | 7.63 |
| `qwen3.5:9b-q4_K_M` | 85 | 15 | 23.2 | 5.12 | 16.2 | 5.49 |
| `qwen3.5:4b` (MLX) | 89 | 11 | 16.3 | 2.84 | 23.7 | 7.5, growing |
| `qwen3.5:4b-q4_K_M` | 69 | 31 | 23.8 | 2.44 | 26.7 | 3.22 |
| `lfm3:latest` (MLX) | 47 | 53 | 28.9 | 1.50 | 48.7 | 1.7 |
| `bonsai-2:9b` | 61 | 39 | 17.1 | 2.82 | 21.8 | 2.90 |
| `bonsai-2:4b` | 42 | 58 | 16.3 | 1.79 | 34.9 | 1.89 |
| `granite4:latest` | 60 (31 recovered) | 9 | 31.9 | 1.89 | 35.2 | 3.37 |
| `dolphin3:8b` | 68 | 29 | 25.6 | 3.26 | 18.8 | 6.56 |

Per-model notes (`observed`): `gemma4:12b-it-qat` often opens with a 4 to 5 s JSON cue before its first word. `qwen3.5:9b` has the wittiest persona but is wordy and writes malformed JSON cues. `qwen3.5:4b` duplicates cues, echoes `<label>` placeholders, and quotes its own speech. `lfm3` put emoji in 89% of replies, appended `<|SILENT|>` after speech, and broke character once. `bonsai-2` writes malformed cues. `granite4` and `dolphin3` sound generic. Only `qwen3.5:9b` (three times), `granite4`, and `dolphin3` (once each) played the exposed `wave` clip in an accepted form, because models write `"gesture":"wave"` into the contract's `gesture` field.

### Server settings and runtimes (`gemma4:e4b-it-qat`)

| Setting | Memory GiB | Decode tok/s | Parsed % |
| --- | --- | --- | --- |
| Context 8192 | 3.08 | 29.6 | 92 |
| Context 16384 | 3.25 | 29.7 | 92 |
| Context 32768 | 3.45 | 29.8 | 85 |
| `OLLAMA_KV_CACHE_TYPE=q8_0` | 3.10 | 24.0 | 58 |
| `OLLAMA_FLASH_ATTENTION=false` | 3.76 | 26.7 | 85 |

With thinking on, `gemma4:e4b` returned 10 of 18 replies blank and `qwen3.5:4b` 13 of 18, after 10 to 14 s each.

### App prompt and tools

| Run | Parsed % | Recovered % | Rejected % |
| --- | --- | --- | --- |
| Screen prompt, no tools (six conversations) | 88 | 0 | 4 |
| App prompt, no tools | 16 | 68 | 16 |
| App prompt without the motion list, no tools | 93 | 0 | 7 |
| App prompt with 12 tools | 23 | 57 | 17 |
| 50 turns, app prompt, tools, raw history | 16 | 0 | 84 |
| 50 turns, canonical history | 18 | 0 | 82 |
| 50 turns, canonical history, unknown markers removed | 73 | 1 | 26 |
| 50 turns, without the motion list, unknown markers removed | 92 | 0 | 8 |

- Tools were almost never called: 5 of 536 tool-enabled replies, four memory reads and one card (`measured`). Asked for an early fact, the model sometimes said it would check memory or wrote `<|builtIn_readMemory…` as text instead of reading the history (`observed`).
- Recall of six early facts was 4 to 5 of 6 with canonical history and 5 to 6 of 6 with unknown markers removed (`measured`).
- In one seed, a turn-1 reply of only a cue and `<|SILENT|>` was copied for most of the remaining 49 turns, with and without the filter (`observed`).
- The 50-turn runs kept a flat first-token time of 0.4 to 0.6 s at 6.4k to 11.5k-token prompts (`measured`).

### Prompt cache events (12 turns, tools, 7.1k-token prompt)

| Event | First token |
| --- | --- |
| Normal next turn | 0.34 s |
| Next turn after a memory write | 14.7 s once |
| Unprompted turn | 5.5 s |
| Unprompted turn, instruction in the user message, same tools | 0.5 s |
| Normal turn after an unprompted turn | 14.7 s |
| First voice turn with control events | 14.9 s once |
| The same, control text in the user message | 0.56 s |

The `voice` segment is empty with default settings, because only voice input plugins attach speech context and no built-in plugin does (`inferred`). The unprompted turn sends only `builtIn_readMemory`, and the tool list sits at the start of the prompt, so its instruction's position does not matter while the tools differ (`measured`). llama-server keeps earlier prompt states in RAM, about 200 MB each, so a layout it has seen before is fast after its first appearance (`observed` in the server log).

### Cold start, concurrent load, and overflow

- After an unload, the first reply took 3.7 s with the 1.1k-token screen prompt (1.3 s load plus prompt); the first load from disk took 6.6 s, and a load while the app ran took 10.4 s (`measured`). With the app's 6.4k-token request the prompt alone takes about 9 s (`measured` by the cache probe). `/v1` honors a request-body `keep_alive` (`measured`).
- With the app rendering, decode fell from 29.6 to 25.6 tok/s and replies took 1.29 s instead of 1.16 s. Mean used memory rose from 10.3 to 12.3 GiB; Electron used 1.35 GiB (`measured`).
- Past 16k tokens, a fact from the first user message was lost while the system prompt's canary survived in 2 of 3 requests, and replies had about 30 tokens of room (`measured`).

## Corrections made during the work

- An early claim that standalone MLX decoded faster than GGUF was wrong; matched runs showed equal or faster GGUF decode.
- An early claim that every voice turn re-reads the whole conversation was wrong for default settings: the `voice` segment is empty unless a plugin attaches context. The events in the table above are what re-read the prompt.
- An early worry that the provider's `auto` thinking mode affects chat turns was wrong: the Ollama provider sends `reasoning_effort: none` while the Consciousness reasoning setting is off. The generic OpenAI-compatible provider sends nothing, so a thinking model reasons through it.

## Follow-ups

Open decisions for the owner, in rough order of effect. Each would change code or a policy doc.

1. Rewrite or trim the Live2D motion prompt from `formatLive2DActPrompt`, or route motions through the exposed-actions path.
2. Store only accepted cue kinds in the history that returns to the model, and decide whether a reply of only `<|SILENT|>` should be stored.
3. Keep the tool list of unprompted turns the same as chat turns, or accept the two full re-reads per unprompted turn; move `control` text into the user message. Both amend the [prompt composition ADR](../adr/2026-11-01-prompt-composition.md).
4. Send `keep_alive` from the Ollama provider, and recommend a card history length for local models.
5. Fix the `gesture`/`action` wording collision, add an emotion alias map, and add `MOOD` to `recoverCueNames` with a scorer version bump.
6. Give `qa:model` an app-conditions mode: the captured tools, the Live2D motion list, canonical history, and a time-to-first-speech metric. Its current scores are far better than the app's.
7. Test small decision models for auxiliary tasks such as the voice end judge (`unverified`).
