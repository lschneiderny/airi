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

The producing runs are `.temp/qa/20261110-181301-model-run-general/` and `.temp/qa/20261110-181405-model-score-score/`, on commit `44a561d64`. Their `run.json` records `dirty: true` because the checkout held untracked planning files; no tracked file differed. The scorer is `cue-contract-score` version 4, and its fixtures passed 29/29. `summary.json` and `summary.md` were copied from the score run.

## What it shows

Counts are quoted from `summary.json`. The style columns are heuristics, not persona judgments.

- Every reply opened with a malformed marker, `|<ACT ...|>` instead of `<|ACT ...|>`. The runtime recovered all six (`outcomes.recovered = 6`, `parsed = 0`), and no reply led with a valid cue (`leadCue = 0`). This is run-to-run variation, not an effect of the scenario: two uncommitted repeats on the same day wrote well-formed opening markers, one of them with the identical prompt, and one repeat ended every reply with a stray `|>` instead. The scenario sets no seed, so a single run does not show how often each habit occurs.
- Four of six replies wrote the cue twice, once bare and once as JSON (`acts = 11`, `forms.bare = 5`, `forms.json = 6`).
- The exposed gesture was used once and correctly: `actionsAccepted = 1`, `actionsUnknown = 0`.
- Two replies carried a `|<SILENT|>` marker in front of ordinary speech.
- Replies averaged 16.2 words. The first turn took 43.4 s, which includes loading the model; later turns took 0.3 to 0.8 s.

Do not rank models with this set alone: it is one run of six turns with default sampling and no seed. Comparing models or prompt changes needs repeated or seeded runs.

## When to use

Use it as the baseline when changing how the prompt or runtime handles small local models, and as a replay source (`pnpm qa:llm serve --set live-2026-11-10-granite4-general`).

## When not to use

Do not mix it with the legacy Mac M2 set, and do not compare its timings with app sessions, which send tools.
