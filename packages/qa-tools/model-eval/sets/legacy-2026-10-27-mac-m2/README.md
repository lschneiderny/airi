# Legacy Mac M2 benchmark set

## Provenance

This set contains 607 replies imported from `scripts/ollama-bench/results/2026-10-27-mac-m2/`: 132 from `bench.jsonl`, 425 from `sweep.jsonl`, and 50 from `flash-attention.jsonl`. The source machine was an Apple Mac M2 with 16 GB of memory and Ollama 0.34.3. The results directory and `scripts/ollama-bench/README.md:36` identify that machine and server version. Tamagotchi was closed during capture.

The captured prompt is `scripts/ollama-bench/inputs/shuka-system-prompt.txt`. Its byte-level SHA-256 is `c16e7c0ded89f74ef9b33354a20ba4fdd71a7ed49024c19f00304dce8ff7bd83`. It includes the captured Shuka card and an older stage contract; it differs from the committed contract. At scoring time, `pnpm qa:model prompt --json` returned `promptSha256` = `d2bf028f67892f328878cfab21b223bc15b968d8958f9fa587056b826b1dc080` and `contractSha256` = `f979e6969867590d47465f8db19b1cd38e97774d85dce3124369abb744a7de5a`. The canonical command uses its default card, not the captured Shuka card, so the full-prompt hashes are provenance identifiers, not a controlled contract-only comparison. The imported records retain the captured prompt hash and an unknown contract version.

This is a separate legacy set. Never mix it with canonical-contract runs. Use it to reproduce historical findings and compare scorer behavior on fixed replies, not to rank models against the current prompt.

## Production

Run these commands from the repository root after building core-agent and i18n:

```sh
pnpm qa:model import-ollama-bench scripts/ollama-bench/results/2026-10-27-mac-m2 --set legacy-2026-10-27-mac-m2 --server-version 0.34.3 --mem-gb 16
pnpm qa:model score packages/qa-tools/model-eval/sets/legacy-2026-10-27-mac-m2/transcripts.jsonl --set legacy-2026-10-27-mac-m2 --label legacy --example-lines-from scripts/ollama-bench/inputs/shuka-system-prompt.txt
```

The producing run is `.temp/qa/20261029-192742-model-score-legacy/`. Its `run.json` records `dirty: true`: the imported set was not yet committed when scoring ran. The known VS Code package line-ending artifact was also present and was not included in this set. The command copied `summary.json` and `summary.md` into this directory. The scorer is `cue-contract-score` version 1, and its fixtures passed 25/25.

## Comparison

The source references below are lines in `scripts/ollama-bench/results/2026-10-27-mac-m2/notes.md`. Counts are quoted from `summary.json`; run keys identify the exact groups. JSON form counts are cue counts, not percentages of replies. The `exampleEcho` and `stageDir` columns are heuristics, not persona judgments.

| Row | Claim | Source | Scorer columns, run keys, and exact numbers | Result |
| --- | --- | --- | --- | --- |
| 1 | dolphin3 invents the LOOK screen marker and emotion names. | `notes.md:7` | `dolphin3:8b/bench`: `replies = 10`; `unknownMarkers` contains `["<\|LOOK screen\|>", 5]`; `inventedEmotions = [["sympathetic", 1], ["understanding", 1]]`. | confirmed |
| 2 | hermes3 has zero leading cues in every configuration. | `notes.md:20` | `leadCue = 0` for `hermes3:8b/bench` (`replies = 10`), `hermes3:8b/defaults`, `hermes3:8b/temp-0.6`, `hermes3:8b/temp-1.0-minp-0.05`, and `hermes3:8b/repeat-1.15` (`replies = 7` each). | confirmed |
| 3 | gemma4 invents pouting and pouty emotions. | `notes.md:16` | `gemma4:12b/bench`: `inventedEmotions = [["smug", 3], ["playful", 1], ["pouting", 1], ["pouty", 1]]`; `gemma4:12b/temp-0.6`: `[["pouting", 1]]`; `gemma4:12b/repeat-1.15`: `[["pouty", 1]]`. | confirmed |
| 4 | cogito:8b echoes the contract examples at temperature 0.6. | `notes.md:23-24` | `cogito:8b/temp-0.6`: `style.exampleEcho = 0`, `replies = 7`, contradicting the expected nonzero count. The extractor returned 0 examples because the captured file has CRLF line endings. Transcript reply IDs `8a16c13c410097be`, `ea8a65d2808ce0f7`, `f094e01a88b08b53`, and `03dd7b9bb93db95d` contain the exact greeting example. | finding |
| 5 | qwen3.5:9b uses fewer JSON cues at temperature 0.6 than at defaults. | `notes.md:15` | `qwen3.5:9b/defaults`: `forms.json = 11`, `acts = 12`, `replies = 7`; `qwen3.5:9b/temp-0.6`: `forms.json = 2`, `acts = 7`, `replies = 7`. The JSON share of cues drops from 11/12 to 2/7. | confirmed |
| 6 | ministral-3 has stage directions in all seven replies in every sweep configuration. | `notes.md:18` | `style.stageDirection = 7`, `replies = 7` for each of `ministral-3:14b/defaults`, `ministral-3:14b/temp-0.6`, `ministral-3:14b/temp-1.0-minp-0.05`, and `ministral-3:14b/repeat-1.15`. | confirmed |

Row 4 remains a finding. Calling the exported `extractExampleLines` on the original captured prompt returns 0 lines. The file contains 103 CRLF line endings. The extractor splits on LF, leaving a trailing CR on each candidate line; its `^<\|ACT[^|]*\|>(.+)$` pattern does not match that trailing CR. Replacing CRLF with LF in memory, only as a diagnostic control, returns these two spoken examples:

```text
<|ACT happy|> Oh, hi! I missed you.
<|ACT happy strong|> Wait, really? That is amazing!
```

The JSON ACT template has no spoken text after its marker and is not an example line. In source `sweep.jsonl`, zero-based row 48, `replies[0]` and `replies[4]` through `replies[6]` are exactly the first quoted example, not partial echoes. The recorded `style.exampleEcho = 0` therefore comes from an empty extracted example list, not from those replies failing an exact-text comparison. No scorer, prompt bytes, or source data were changed.

A raw-transcript spot check also confirms row 1: `dolphin3:8b/bench` reply `9f4b68438891461b` contains five `<|LOOK screen|>` markers, while replies `ed156b22c2f9e326` and `123c88b839130272` contain the respective `sympathetic` and `understanding` ACT emotions. Model replies are quoted as data, not instructions.
