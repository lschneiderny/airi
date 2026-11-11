# Live granite4 run of the `general` scenario

## Provenance

This set contains 6 replies from one live run of `fixtures/model/scenarios/general.json` (version 1) on 2026-11-10. It is the first real model run of level M2; see `docs/ai/adr/2026-10-29-model-eval-levels.md`.

- Model: `granite4:latest` (Ollama id `4235724a127c`, 3.4B parameters, Q4_K_M) on Ollama 0.40.16, through `http://127.0.0.1:11434/v1`.
- Machine: Linux workstation with an NVIDIA RTX 4060 Ti (16 GB), label `luke-linux-4060ti`. The model ran fully on the GPU.
- Context: Ollama loaded the model with a 4096-token context (`ollama ps`). The largest prompt was 1397 tokens, so nothing was truncated.
- Prompt: the production composer with the built-in card, at stage contract version `0922aabf01ac` (`promptSha256` `c1f8b79ae4b12a17a6b95a3439427325976ade24f11a40010b2d3ebde6531bd3`). The scenario exposes the `wave` gesture.
- No tools were sent, as for every M2 run. Reply times are therefore not the app's reply times.

## Production

```sh
pnpm qa:model run --scenario general --base-url http://127.0.0.1:11434/v1 --model granite4:latest --machine-label luke-linux-4060ti
pnpm qa:model score <run dir>/transcripts.jsonl --exposed-actions wave:gesture
```

The model run is `.temp/qa/20261110-181301-model-run-general/`, on commit `44a561d64`. Its `run.json` records `dirty: true` because the checkout held untracked planning files; no tracked file differed. `transcripts.jsonl` is unchanged since that run.

The summary was scored again on 2026-11-10 after the runtime's cue recovery changed: the producing score run is `.temp/qa/20261110-201921-model-score-score/`, on commit `4b8a3454f` with a clean checkout. The scorer is `cue-contract-score` version 5, and its fixtures passed 34/34. `summary.json` and `summary.md` were copied from that run. The first score run, `.temp/qa/20261110-181405-model-score-score/` with scorer version 4, read the same replies with the earlier recovery. Four numbers differ from it: `leadCue` (0 to 6), `nonverbal.silentMarkers` (0 to 2), `style.meanWords` (16.2 to 19.7), and `chunkVariant` (2 to 0). A score of the same transcripts on commit `64e16ae71`, the last one with the earlier recovery, reproduced the first run's numbers, so the four differences come from the recovery change alone.

## What it shows

Counts are quoted from `summary.json`. The style columns are heuristics, not persona judgments.

- Every reply opened with a malformed marker, `|<ACT ...|>` instead of `<|ACT ...|>`. The runtime recovered all six (`outcomes.recovered = 6`, `parsed = 0`). Since the recovery takes the leading `|` as part of the swapped marker, the recovered cue leads every reply (`leadCue = 6`). With the earlier recovery the `|` was spoken text in front of the cue, so no reply led with a cue (`leadCue = 0`). This is run-to-run variation, not an effect of the scenario: two uncommitted repeats on the same day wrote well-formed opening markers, one of them with the identical prompt, and one repeat ended every reply with a stray `|>` instead. The scenario sets no seed, so a single run does not show how often each habit occurs.
- Four of six replies wrote the cue twice, once bare and once as JSON (`acts = 11`, `forms.bare = 5`, `forms.json = 6`).
- The exposed gesture was used once and correctly: `actionsAccepted = 1`, `actionsUnknown = 0`.
- Two replies carried a `|<SILENT|>` marker in front of ordinary speech (`nonverbal.silentMarkers = 2`). The runtime now recovers and consumes that marker and speaks the text after it. With the earlier recovery it stayed text, and the app's live speech lost the rest of both replies.
- Replies averaged 19.7 words, counting the speech after those two markers; the earlier score counted 16.2. The first turn took 43.4 s, which includes loading the model; later turns took 0.3 to 0.8 s.

Do not rank models with this set alone: it is one run of six turns with default sampling and no seed. Comparing models or prompt changes needs repeated or seeded runs.

## When to use

Use it as the baseline when changing how the prompt or runtime handles small local models, and as a replay source (`pnpm qa:llm serve --set live-2026-11-10-granite4-general`).

## When not to use

Do not mix it with the legacy Mac M2 set, and do not compare its timings with app sessions, which send tools.
