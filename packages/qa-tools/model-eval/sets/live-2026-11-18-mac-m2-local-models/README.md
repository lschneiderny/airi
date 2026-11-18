# Local model screen on a 16 GB M2 Mac

## Provenance

This set holds 644 replies from 122 live runs of 11 local models on 2026-11-18. It was made to choose a local character model for a MacBook with an Apple M2 (4 performance and 4 efficiency cores, 10-core GPU) and 16 GB of unified memory. macOS lets the GPU wire about 10.7 GiB of it. The machine label is `mac-m2-16gb`.

- Server: Ollama 0.40.16 at `http://127.0.0.1:11434/v1`, with the Ollama app's context setting of 16384 tokens. One model ran on `mlx_lm.server` (mlx-lm in a separate virtual environment) at `http://127.0.0.1:8090/v1`.
- Prompt: the production composer with the built-in card, at stage contract version `0922aabf01ac`. The scenarios expose the `wave` gesture. No tools were sent.
- Scenarios: `inputs/general-seeded-nothink.json` and `inputs/relationship-stages-nothink.json` are the committed `general-seeded` and `relationship-stages` scenarios with `reasoning_effort: none` added to every config and `-nothink` appended to each config name. Nothing else differs. ESLint reformatted the copies when they were committed, so their hashes differ from each record's `source.fileSha256`. The app sends `reasoning_effort: none` on chat turns while the Consciousness reasoning setting is off, its default, so these copies match the app. Runs named `default` used the committed scenarios as they are, so thinking models reasoned.
- Each model ran the configs `seed-1` to `seed-3` and `temp-0.3-seed-1` to `temp-0.3-seed-3` of the general scenario (six conversations of six turns), and the `default` config of the stage scenario (16 turns).
- Scoring: `cue-contract-score` version 5. `summary.json` and `summary.md` come from `.temp/qa/20261118-104627-model-score-local-models/` on commit `7640bc359`; its `dirty` flag records only this untracked set directory.

| Model (Ollama tag) | Digest | Family | Parameters | Quantization | Backend |
| --- | --- | --- | --- | --- | --- |
| `gemma4:e4b-it-qat` | `ee6656371218` | gemma4 | 7.5B | Q4_0 (QAT) | GGUF |
| `gemma4:12b-it-qat` | `38044be4f923` | gemma4 | 11.9B | Q4_0 (QAT) | GGUF |
| `gemma4:e4b` | `eb2177adf764` | gemma4 | 8.1B | nvfp4 | MLX |
| `qwen3.5:4b` | `7f3251fa6878` | qwen3_5 | 4.5B | nvfp4 | MLX |
| `qwen3.5:4b-q4_K_M` | `d8b0f5e9760c` | qwen35 | 4.2B | Q4_K_M | GGUF |
| `qwen3.5:9b-q4_K_M` | `56671c2ab938` | qwen35 | 9.0B | Q4_K_M | GGUF |
| `lfm3:latest` | `f609fc0ab12a` | lfm3 | 1.7B | nvfp4 | MLX |
| `bonsai-2:4b` | `93edd652c932` | qwen35 | 4.2B | Q2_0 (ternary) | GGUF |
| `bonsai-2:9b` | `c8b5462f8688` | qwen35 | 9.0B | Q2_0 (ternary) | GGUF |
| `granite4:latest` | `4235724a127c` | granite | 3.4B | Q4_K_M | GGUF |
| `dolphin3:8b` | `d5ab9ae8e1f2` | llama | 8.0B | Q4_K_M | GGUF |
| `mlx-community/gemma-4-e4b-it-4bit` | not recorded | gemma4 | 4-bit | MLX | mlx-lm |

`granite4` and `dolphin3` are not thinking models, so they ran the committed scenarios. The other models ran the no-think copies. `gemma4:e4b` and `qwen3.5:4b` also ran three general conversations with thinking on.

## Production

```sh
pnpm qa:model run --scenario <path to scenario> --config <config> --base-url http://127.0.0.1:11434/v1 --model <tag> --machine-label mac-m2-16gb
pnpm qa:model score packages/qa-tools/model-eval/sets/live-2026-11-18-mac-m2-local-models/transcripts.jsonl --exposed-actions wave:gesture
```

`results/pooled.json` and `results/pooled.md` pool the score of each model's runs into one row per model, scenario family, and mode. They were computed from per-model score runs of the same transcripts and from each run's `server.json`. Their last five rows are the server-setting runs described under [Server settings](#server-settings), whose transcripts are not in this set because they repeat the run keys of the `gemma4:e4b-it-qat` rows.

## Results

General scenario, 36 replies per row, no thinking. "Parsed" counts replies whose speech carried a well-formed cue; "rejected" counts replies with a cue the runtime dropped. Seconds are means per reply. Memory is the GPU allocation in GiB: for GGUF builds it was read from the Metal buffer sizes in Ollama's server log, because Ollama 0.40.16's `/api/ps` (and so `server.json`) reports 0.3 to 1.0 GiB for GGUF gemma4 models. For MLX builds it is the `/api/ps` size at the end of the run.

| Model | Parsed % | Rejected % | Blank | Words | Warm TTFT s | Total s | Decode tok/s | Memory GiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `gemma4:e4b-it-qat` | 88 | 4 | 10 | 11.1 | 0.26 | 1.27 | 29.5 | 3.25 |
| `gemma4:e4b` (MLX) | 97 | 3 | 5 | 17.0 | 0.31 | 1.86 | 27.6 | 9.6, growing |
| mlx-lm `gemma-4-e4b-it-4bit` | 100 | 0 | 11 | 10.8 | 0.32 | 1.65 | 27.7 | about 5, flat |
| `gemma4:12b-it-qat` | 100 | 0 | 0 | 15.1 | 1.33 | 6.86 | 12.0 | 7.63 |
| `qwen3.5:9b-q4_K_M` | 85 | 15 | 1 | 23.2 | 0.88 | 5.12 | 16.2 | 5.49 |
| `qwen3.5:4b` (MLX) | 89 | 11 | 0 | 16.3 | 0.54 | 2.84 | 23.7 | 7.5, growing |
| `qwen3.5:4b-q4_K_M` | 69 | 31 | 0 | 23.8 | 0.46 | 2.44 | 26.7 | 3.22 |
| `lfm3:latest` (MLX) | 47 | 53 | 0 | 28.9 | 0.16 | 1.50 | 48.7 | 1.7 |
| `bonsai-2:9b` | 61 | 39 | 0 | 17.1 | 0.69 | 2.82 | 21.8 | 2.90 |
| `bonsai-2:4b` | 42 | 58 | 0 | 16.3 | 0.41 | 1.79 | 34.9 | 1.89 |
| `granite4:latest` | 60 (31 recovered) | 9 | 1 | 31.9 | 0.16 | 1.89 | 35.2 | 3.37 |
| `dolphin3:8b` | 68 | 29 | 5 | 25.6 | 0.42 | 3.26 | 18.8 | 6.56 |

## What it shows

Read these as tendencies: each row is six seeded conversations of six turns, scored by heuristics, and the persona notes come from reading the replies.

- `gemma4:e4b-it-qat` is the best fit for this machine. It replies in about 1.3 s, stays in character with short, lively lines, uses the `DELAY` and `MOOD` cues, and rarely invents an emotion. Its blank replies carry a cue and no words, and answer the turns that ask for a face or a wave.
- `gemma4:12b-it-qat` writes the cleanest cues (100% parsed, no invented names), but at 12 tok/s a reply takes 7 to 10 s. It often opens with a long JSON cue, which delays the first spoken word by 4 to 5 s, and its 7.6 GiB leaves little room for the app on 16 GB.
- `qwen3.5:9b-q4_K_M` has the wittiest persona but is slow and wordy, and writes malformed JSON cues. `qwen3.5:4b` complies but sounds bland; it writes the cue twice (bare and JSON), echoes `<label>` placeholders, and quotes its own speech. Its GGUF build had more rejected cues than its MLX build (31% against 11%).
- `lfm3` is the fastest model (49 tok/s) and coherent, but 89% of its replies carried emoji, it appended `<|SILENT|>` after speech, confused names, and broke character once.
- The ternary `bonsai-2` builds are small and fast but write malformed cues; the 4B model answers some turns with no words or with invented markers.
- `granite4` and `dolphin3` sound generic. `granite4` swaps marker openers (`|<ACT`), which the runtime recovers, and `dolphin3` invents emotions.
- With thinking on, `gemma4:e4b` and `qwen3.5:4b` spend the 320-token reply cap on reasoning: 10 of 18 and 13 of 18 replies came back blank, and replies took 10 to 14 s.
- The exposed `wave` clip was rarely played: across all general rows, only `qwen3.5:9b-q4_K_M` (3 times), `granite4`, and `dolphin3` (once each) wrote it in a form the runtime accepts. The contract asks for a `"gesture"` field from a fixed list, and the actions segment asks for an `"action"` field, so models write `"gesture":"wave"`, which the runtime drops. `gemma4:e4b-it-qat` also tried `"motion":"wave"` and `<|CALL ["wave"]|>`.
- The invented emotions are mostly near-synonyms of allowed ones: `concerned`, `worried`, `excited`, `surprise`, `thinking`, `playful`, `joyful`, `shocked`.

### Memory of Ollama's MLX runner

On this Mac, untagged Ollama names such as `gemma4:e4b` and `qwen3.5:4b` resolve to MLX `nvfp4` builds. Their allocation grows by about 0.1 GiB per request until the model unloads: `qwen3.5:4b` went from 3.8 to 8.0 GiB over 42 requests and reached 11.7 GiB in the thinking runs, and `gemma4:e4b` went from 8.8 to 9.9 GiB. GGUF builds stayed flat over the same requests. Standalone mlx-lm with a 4-bit gemma4 e4b stayed at about 5 GB and decoded at the same speed as the GGUF QAT build, so MLX gives no speed advantage on this M2.

### Server settings

Three seeded general conversations of `gemma4:e4b-it-qat` on a private `ollama serve` per setting (`results/pooled.md`, last five rows):

| Setting | Memory GiB | Decode tok/s | Parsed % | Rejected % |
| --- | --- | --- | --- | --- |
| Context 8192 | 3.08 | 29.6 | 92 | 8 |
| Context 16384 (default of this set) | 3.25 | 29.7 | 92 | 8 |
| Context 32768 | 3.45 | 29.8 | 85 | 8 |
| Context 16384, `OLLAMA_KV_CACHE_TYPE=q8_0` | 3.10 | 24.0 | 58 | 33 |
| Context 16384, `OLLAMA_FLASH_ATTENTION=false` | 3.76 | 26.7 | 85 | 8 |

The defaults are best. Context size costs little memory with this model, the 8-bit KV cache is slower and hurt the cues, and turning off flash attention costs memory and speed. A plain `ollama serve` uses a 4096-token context on this machine, which truncates an app prompt with tools (about 4.1k to 4.4k tokens), so the context setting must stay at 16384 or above.

### Prompt cache

A probe sent a 12-turn history with the full app prompt and tools through Ollama's native `/api/chat` with a 4-token reply, in three conditions: A, the same system prompt as the previous request; B, a per-request line at the end of the system prompt that changes every request, as the `voice` and `control` segments do; C, the same line moved into the last user message.

| Model | A s | B s | C s |
| --- | --- | --- | --- |
| `granite4` with tools (about 5.4k tokens) | 0.23 | 14 to 15 | 0.35 |
| `gemma4:e4b-it-qat` with tools | 0.14 | 8.7 | 0.25 |
| `gemma4:12b-it-qat` with tools | 0.85 | 39 | 1.1 |

A local server reuses its cache only up to the first changed token. Because the per-request segments sit in the system message, before the history, every voice turn processes the whole conversation again. Moving per-request text into the last user message keeps the time near condition A.

## When to use

Use it to compare a new local model or server setting on the same machine and scenarios, and as a replay source of current-contract replies from many model families (`pnpm qa:llm serve --set live-2026-11-18-mac-m2-local-models`).

## When not to use

Do not compare its timings with app sessions, which send tools and a longer prompt, or with runs on other hardware. Do not rank models by a single row; the differences of a few points are within run-to-run variation.
