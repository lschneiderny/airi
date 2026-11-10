# Live granite4 run of the `relationship-stages` scenario

## Provenance

This set contains 16 replies from one live run of `fixtures/model/scenarios/relationship-stages.json` (version 1) on 2026-11-10: the same four user turns at each of the four relationship stages (`stranger`, `friendly`, `close`, `intimate`), each stage as its own conversation. It is the first real model run of level M2; see `docs/ai/adr/2026-10-29-model-eval-levels.md`.

- Model: `granite4:latest` (Ollama id `4235724a127c`, 3.4B parameters, Q4_K_M) on Ollama 0.40.16, through `http://127.0.0.1:11434/v1`.
- Machine: Linux workstation with an NVIDIA RTX 4060 Ti (16 GB), label `luke-linux-4060ti`.
- Context: Ollama loaded the model with a 4096-token context. The largest prompt was 1568 tokens.
- Prompt: the production composer with the built-in card, at stage contract version `0922aabf01ac`. Each stage adds its character text after the user message, where the app puts it. The mood is at rest for every stage.
- No tools were sent, as for every M2 run.

## Production

```sh
pnpm qa:model run --scenario relationship-stages --base-url http://127.0.0.1:11434/v1 --model granite4:latest --machine-label luke-linux-4060ti
pnpm qa:model score <run dir>/transcripts.jsonl
```

The producing runs are `.temp/qa/20261110-181348-model-run-relationship-stages/` and `.temp/qa/20261110-181407-model-score-score/`, on commit `44a561d64`. Their `run.json` records `dirty: true` because the checkout held untracked planning files; no tracked file differed. The scorer is `cue-contract-score` version 4, and its fixtures passed 29/29. `summary.json` and `summary.md` were copied from the score run. The summary labels each stage as a config, for example `default@close`.

## What it shows

Counts are quoted from `summary.json`.

- Every reply parsed and led with a cue at every stage (`outcomes.parsed = 4`, `leadCue = 4` per stage).
- At `friendly` and `intimate`, every reply wrote the cue twice, once bare and once as JSON (`acts = 8` for 4 replies). At `stranger` and `close` it wrote one bare cue.
- At `intimate` it invented two emotion names (`excited`, `thoughtful`) and wrote free-text gestures: `nonverbal.gestures = 1`, `gesturesDropped = 3`.
- At `friendly`, all four replies used emoji (`style.emoji = 4`).
- Mean reply length was 20.5 words at `stranger`, 22.3 at `friendly`, 33.8 at `close`, and 32.5 at `intimate`. Warm replies took 0.4 to 0.9 s.

The scorer cannot tell whether a reply suits its stage; that needs the M3 judge. Reading the transcripts by hand, the stage text shaped the wording less than expected: at `stranger` the model answered "Did I miss you? Oh, I think about you all the time!", and at `close` and `friendly` it kept a `happy` cue for a user turn about a rough day. Treat these as observations from one run, not as measurements.

## When to use

Use it as the first input for the M3 judge and rubric, and as the baseline when changing how relationship stages reach the prompt.

## When not to use

Do not rank models with it: it is one run with default sampling. Do not mix it with the legacy Mac M2 set.
