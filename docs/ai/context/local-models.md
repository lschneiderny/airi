# Local Character Models

This page records which local model and server settings to use for the character on a MacBook with an Apple M2 and 16 GB of memory, and what limits local results today. The measurements are in the [local model screen set](../../../packages/qa-tools/model-eval/sets/live-2026-11-18-mac-m2-local-models/README.md), including its follow-up under app conditions. The [local model research report](../audits/2026-11-18-local-model-research.md) records how these conclusions were reached. Re-check this page when Ollama, the stage contract, or the prompt layout changes.

## Recommended setup

- Model: `gemma4:e4b-it-qat` on Ollama (GGUF, Q4_0 quantization-aware build). It replies in about 1.3 s at about 30 tok/s, uses about 3.3 GiB of GPU memory with a 16k context, and follows the cue contract best among the fast models.
- Larger option: `gemma4:12b-it-qat` writes the cleanest cues, but takes 7 to 10 s per reply and 7.6 GiB. Use it only when reply time does not matter.
- Provider: the Ollama provider, not the generic OpenAI-compatible one. Only the Ollama provider sends `reasoning_effort: none` while the Consciousness reasoning setting is off; through the generic provider, a thinking model reasons on every turn.
- Server: Ollama 0.40.16 or later, with the Ollama app's context length at 16384 or above. A plain `ollama serve` uses a 4096-token context on this machine, and the app's request is about 6.4k tokens before any history (12 tools and the system prompt), so it is truncated. The app connects through the OpenAI-compatible `/v1` endpoint and cannot set the context itself.
- History length: set the card's history-length setting (in turns) for long conversations, for example 60. With the default (unlimited), a conversation of roughly a hundred turns passes 16k tokens, and Ollama then silently drops the oldest messages and leaves about 30 tokens for the reply. The app's own trimming cuts 10% of the window at a time, so the prompt cache stays valid between cuts.
- Keep Ollama's defaults for flash attention (on) and the KV cache type (f16). `OLLAMA_KV_CACHE_TYPE=q8_0` saves 0.15 GiB with this model but decodes about 20% slower and broke more cues.
- Keep the Consciousness reasoning setting off. With reasoning on, thinking models spend the 320-token reply cap (`REPLY_MAX_TOKENS`) on reasoning and often return no speech after 10 to 14 s.
- Idle unload: Ollama unloads a model after 5 idle minutes, and the next reply then waits for the load and the whole 6.4k-token prompt, several seconds and more while the app runs. Set `OLLAMA_KEEP_ALIVE` (for example `-1`) for the Ollama app when the character should answer quickly after a pause, such as for unprompted turns.

## Avoid on 16 GB

- Ollama's MLX builds. On Apple Silicon, untagged names such as `gemma4:e4b` and `qwen3.5:4b` resolve to MLX `nvfp4` builds, whose memory grows by about 0.1 GiB per request until the model unloads (one reached 11.7 GiB). Pick an explicit GGUF tag such as `-it-qat` or `-q4_K_M`. Standalone mlx-lm did not grow, but it was no faster than the GGUF build.
- Ternary builds (`bonsai-2`), `lfm3`, `granite4`, and `dolphin3` for the character: they are small or fast, but break the cue format or the persona more often. See the set for details.
- `/api/ps` sizes for GGUF gemma4 models on Ollama 0.40.16. They read 0.3 to 1.0 GiB, far below the real allocation, and `qa:model run` records the buffer sizes from Ollama's server log beside them in `server.json`, and `qa:model compare` prefers the log's sizes.
- Running the app alone does not exhaust memory: with the default Live2D character on screen, the model decoded about 13% slower and replies took about 10% longer.

## Known limits

These are open decisions, not rules. Each needs an owner decision before it changes code or another doc.

1. **The Live2D motion list breaks cues.** `formatLive2DActPrompt` adds a motion list with a `<|ACT {"motion":"motion/…motion3.json"}|>` example to the card segment. With it, `gemma4:e4b-it-qat` wrote 16% well-formed cues; without it, 93%. Over long conversations the model also invents `<|motion:…|>` markers.
2. **Invented markers spread through the history.** `canonicalCueText` keeps well-formed unknown markers such as `<|look: you|>` in stored replies, and the model copies them in every later reply. Storing only accepted cue kinds raised well-formed cues in 50-turn conversations from 18% to 73%. A reply of only `<|SILENT|>` can also repeat for the rest of a conversation.
3. **Some events re-read the whole prompt.** On normal turns the local prompt cache works (about 0.3 s to the first token). `pnpm qa:model probe cache-events` measured, with five turns of history and the 12 tools: the turn after an unprompted turn costs about 11 s, and a voice turn with `control` events about 11 s; a memory write costs at least 2.4 s and the unprompted turn itself about 2 s, because its smaller tool list changes the start of the prompt. The probe appends segments at the end of the system prompt, so the app's costs can be higher; with 12 turns of history in the app, these events cost about 15 s. Moving the unprompted instruction into the user message helps only if the tool list stays the same. Changes here would amend the [prompt composition ADR](../adr/2026-11-01-prompt-composition.md) and [LLM prompt](llm-prompt.md). The `voice` segment is empty unless a voice input plugin attaches context.
4. **Tools go almost unused.** With the 12 default tools, the model called a tool in 5 of 536 replies. Asked for an early fact, it sometimes looked in memory or wrote a tool call as text instead of reading the history.
5. **The gesture wording collides.** The contract offers a `"gesture"` field with a fixed list, and the actions segment offers an `"action"` field for exposed clips, so models write `"gesture":"wave"`, which the runtime drops.
6. **Invented emotion names.** Models write near-synonyms such as `concerned`, `worried`, `excited`, `surprise`, and `thinking`. The runtime has aliases for expressions but not for emotions.
7. **`MOOD` is not recovered.** A malformed `MOOD` marker is not in `recoverCueNames` (`packages/stage-shared/src/stage-contract/index.ts`). Adding it changes scores, so it needs a scorer version bump.
8. **`qa:model run` without a capture does not measure the app's conditions.** It sends no tools and uses the built-in card without the Live2D motion list, so its cue scores are far better than the app's. Pass `--app-request` with a capture from `pnpm qa:model capture` to measure what the app sends; see the [app conditions ADR](../adr/2026-11-18-model-eval-app-conditions.md).
9. **Small decision models** could serve auxiliary yes/no tasks, such as the voice end judge, beside the character model. This was not tested.
