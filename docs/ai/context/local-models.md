# Local Character Models

This page records which local model and server settings to use for the character on a MacBook with an Apple M2 and 16 GB of memory, and what limits local results today. The measurements are in the [local model screen set](../../../packages/qa-tools/model-eval/sets/live-2026-11-18-mac-m2-local-models/README.md). Re-check this page when Ollama, the stage contract, or the prompt layout changes.

## Recommended setup

- Model: `gemma4:e4b-it-qat` on Ollama (GGUF, Q4_0 quantization-aware build). It replies in about 1.3 s at about 30 tok/s, uses about 3.3 GiB of GPU memory with a 16k context, and follows the cue contract best among the fast models.
- Larger option: `gemma4:12b-it-qat` writes the cleanest cues, but takes 7 to 10 s per reply and 7.6 GiB. Use it only when reply time does not matter.
- Server: Ollama 0.40.16 or later, with the Ollama app's context length at 16384 or above. A plain `ollama serve` uses a 4096-token context on this machine, and the app's prompt with tools is about 4.1k to 4.4k tokens, so it is truncated. The app connects through the OpenAI-compatible `/v1` endpoint and cannot set the context itself.
- Keep Ollama's defaults for flash attention (on) and the KV cache type (f16). `OLLAMA_KV_CACHE_TYPE=q8_0` saves 0.15 GiB with this model but decodes about 20% slower and broke more cues.
- Keep the Consciousness reasoning setting off. With reasoning on, thinking models spend the 320-token reply cap (`REPLY_MAX_TOKENS`) on reasoning and often return no speech after 10 to 14 s.

## Avoid on 16 GB

- Ollama's MLX builds. On Apple Silicon, untagged names such as `gemma4:e4b` and `qwen3.5:4b` resolve to MLX `nvfp4` builds, whose memory grows by about 0.1 GiB per request until the model unloads (one reached 11.7 GiB). Pick an explicit GGUF tag such as `-it-qat` or `-q4_K_M`. Standalone mlx-lm did not grow, but it was no faster than the GGUF build.
- Ternary builds (`bonsai-2`), `lfm3`, `granite4`, and `dolphin3` for the character: they are small or fast, but break the cue format or the persona more often. See the set for details.
- `/api/ps` sizes for GGUF gemma4 models on Ollama 0.40.16. They read 0.3 to 1.0 GiB, far below the real allocation, and `qa:model run` copies them into `server.json`. Read the `MTL0` buffer sizes in Ollama's server log instead.

## Known limits

These are open decisions, not rules. Each needs an owner decision before it changes code or another doc.

1. **Per-request text breaks the local prompt cache.** The `voice` and `control` segments change every voice turn and sit in the system message, before the history. A local server reuses its cache only up to the first changed token, so each voice turn processes the whole conversation again: about 9 s with `gemma4:e4b-it-qat` and tools at 12 turns, against 0.25 s when the same text rides in the last user message. Moving these segments would amend the [prompt composition ADR](../adr/2026-11-01-prompt-composition.md) and [LLM prompt](llm-prompt.md). `unprompted` and `plugin` behave the same way, but `plugin` keeps system authority by an owner decision.
2. **The gesture wording collides.** The contract offers a `"gesture"` field with a fixed list, and the actions segment offers an `"action"` field for exposed clips, so models write `"gesture":"wave"`, which the runtime drops.
3. **Invented emotion names.** Models write near-synonyms such as `concerned`, `worried`, `excited`, `surprise`, and `thinking`. The runtime has aliases for expressions but not for emotions.
4. **`MOOD` is not recovered.** A malformed `MOOD` marker is not in `recoverCueNames` (`packages/stage-shared/src/stage-contract/index.ts`). Adding it changes scores, so it needs a scorer version bump.
5. **Time to first speech is not measured.** `qa:model` measures time to the first streamed token, which can be reasoning or a long JSON cue. `gemma4:12b-it-qat` often spends 4 to 5 s on a cue before its first word.
6. **Small decision models** could serve auxiliary yes/no tasks, such as the voice end judge, beside the character model. This was not tested.
