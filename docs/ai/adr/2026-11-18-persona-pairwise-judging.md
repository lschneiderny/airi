# Persona judging: blind pairwise human review

Date: 2026-11-18
Status: accepted. Extends M4 of the [model evaluation levels ADR](2026-10-29-model-eval-levels.md).

## Context

The cue-contract scorer measures whether a reply drives the stage; it cannot tell whether the reply sounds like the character. M4, the owner's reading, answered that question, but it left no record: the local model screen of 2026-11-18 ranked eleven models by cue metrics and latency, and persona quality stayed an impression. M3, the rubric judge, needs a reference that says what good persona looks like before a model can be trusted to grade it.

Absolute ratings of one reply at a time drift within a session and between sessions. People compare two replies more consistently than they score one, and comparisons with known names favor the name.

## Decision

`pnpm qa:model judge serve` shows the owner two replies at a time and records a verdict; `pnpm qa:model judge report` ranks contenders from the verdicts.

- **Pairs share a slot.** Both replies answer the same turn, seed, relationship stage, and user text, so the only difference is the contender. A contender is the model id plus the run config with its seed removed, so the seeds of one config pool.
- **Blind.** The page shows the user line, the previous exchange, and each reply's spoken text and cue chips. Contender names reach the page only in the answer to a saved verdict. Sides are shuffled per pair.
- **What the listener gets.** The spoken text and cues come from the core-agent runtime replay, the same oracle the scorer uses, not from the raw reply text. A reply with cues and no words shows as such.
- **Verdict.** Five steps: left much better, left better, tie, right better, right much better. Twelve tags (five good, seven bad, for example `in-character` and `generic-assistant`) say why without a free-text burden; a note is optional.
- **Order.** Pairs interleave round-robin across matchups, so a short session still covers every matchup.
- **Storage.** Each verdict is one `airi.persona-judgment/v1` line appended to a JSONL file before the page moves on. A later session with the same file skips judged pairs. Judgments stay under `.temp/qa/judge/` unless a set commits them with its README.
- **Report.** Bradley–Terry strengths (with a weak prior so an unbeaten contender stays finite), win rate with a 95% Wilson interval, ties as half a win, clear wins, tag shares, and head-to-head counts.
- **Local only.** The server binds `127.0.0.1` and refuses writes whose `Origin` is not its own page.

## Consequences

- Persona quality gets numbers that can sit next to cue metrics in a set's summary, and the tags show what a weak contender does wrong.
- The verdicts are labeled preferences that a future M3 judge can be checked against before anyone trusts it.
- One judge's taste is the measure. The report counts judges, but nothing yet weighs or reconciles several.
- A slot needs at least two contenders that answered it, so single-model runs give nothing to judge.
