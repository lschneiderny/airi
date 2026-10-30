# ollama-bench

A small side tool for comparing local Ollama models as AIRI's chat model. It replays a real AIRI character prompt and tool list against each model, through Ollama's native `/api/chat`, and saves every reply with its timings. It is not part of any package or `pnpm` script.

## Requirements

- [Bun](https://bun.sh) and [Ollama](https://ollama.com), with `ollama` on the `PATH` and the server on `127.0.0.1:11434`.
- Works on macOS, Windows and Linux. On macOS the runner keeps the machine awake with `caffeinate`; on other systems, disable sleep for long runs yourself.

## Usage

Run from this folder:

```sh
bun run.ts gemma4:12b qwen3.5:9b phi4:14b
bun tables.ts results/<run-folder>
```

`run.ts` writes to `results/<date>-<hostname>/` (or `--out <dir>`). For each model it:

1. pulls the model if it is not installed;
2. runs `bench.ts`: an 8-turn conversation plus 4 independent "hey" probes, with AIRI's tool loop emulated (see [Memory turns](#memory-turns));
3. runs `sweep.ts` (skip with `--no-sweep`): 4 turns plus 3 probes for each setting variant (defaults, `temperature 0.6`, `temperature 1.0` with `min_p 0.05`, `repeat_penalty 1.15`, and thinking on for thinking models);
4. deletes the model only if the run pulled it. Models installed before the run are kept.

A rerun into the same folder skips models already recorded there, so an interrupted run can resume.

`tables.ts` prints markdown tables (speed and memory, and the scored sweep) for a results folder. `bun score.ts <sweep.jsonl> [model]` prints the sweep scores as a console table.

## Files

| Path | Contents |
| --- | --- |
| `inputs/shuka-system-prompt.txt` | Luke's "Shuka" character card plus AIRI's stage contract, as AIRI sent it on 2026-10-26 (after the cue-example fix) |
| `inputs/tools.json` | The 13 tools AIRI sent in a captured chat request |
| `inputs/memory-tools.json` | The three memory tools (`builtIn_readMemory`, `builtIn_writeMemory`, `builtIn_forgetMemory`) in Ollama's tool shape. Generated once from `createMemoryTools` in `packages/stage-ui/src/tools/memory.ts`; regenerate it when that file changes |
| `inputs/memory-index.txt` | The memory prompt, as `composeMemoryPrompt` renders it for a fixed two-entry index. `bench.ts` and `sweep.ts` append it to the system prompt |
| `results/2026-10-27-mac-m2/` | The first run: 16 GB M2, Ollama 0.34.3, Tamagotchi closed. `bench.jsonl`, `sweep.jsonl`, `flash-attention.jsonl` (the 14B retest with `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0`) and the author's reading `notes.md` |

The write-up of the first run is in `docs/ai/audits/2026-10-26-ollama-local-model-benchmark.md`.

## Memory turns

`bench.ts` and `sweep.ts` send the memory tools together with the 13 captured tools, and append the memory prompt (`inputs/memory-index.txt`, with the entries `01932b4e-mem-presentation` and `01932b4e-mem-nickname`) to the system prompt.

`bench.ts` has two extra turns:

- `remember that my presentation is on friday at 3pm` (after the nervous-about-the-presentation turn). A good model makes one `builtIn_writeMemory` call and then answers briefly.
- `when was my presentation again?` (after the "did you miss me?" turn). A good model makes one `builtIn_readMemory` call, or answers from the index line alone, without any tool call.

The tool loop answers `builtIn_readMemory` with `01932b4e-mem-presentation (yours): The owner's presentation is on Friday at 3pm.` and `builtIn_writeMemory` with `Saved memory "01932b4e-mem-presentation".` Every other tool still gets `{ "success": true }`. Look for memory calls on other turns in the JSONL: most turns should save nothing. `sweep.ts` has no memory-specific turns; it only carries the tools and the prompt.

## Caveats

- Requests set `num_ctx 8192` and the server's default context is ignored. AIRI sends no context size, so in the app the server default applies.
- AIRI sends no sampling settings. A winning setting has to be baked into a derived model with Modelfile `PARAMETER` lines.
- Server-wide settings such as flash attention are not changed by the tool. Set them, restart Ollama, and note them in the results folder yourself.
- The style scores are heuristics. Read the replies in the JSONL files before trusting a ranking.
- Refresh `inputs/` from a captured request when the character card or AIRI's tools change, or results will not match the app.
