# Model evaluation levels and offline replay

Date: 2026-10-29
Status: accepted

## Context

The Mac benchmark was run outside the application and reviewed by hand. Its output did not have a stable transcript schema or provenance key, and its scorer duplicated cue rules. This made it difficult to compare saved replies with the behavior users get from the chat runtime. The model evaluation tools provide deterministic fixtures and offline replay first. Live runs and automated persona judgment remain future work.

## Decisions

### Levels

- M0 runs committed cue-contract fixtures through the real runtime at every chunk boundary.
- M1 replays saved transcripts through the real chat runtime and stage controller.
- M2 will run models live and record request options and transcript provenance. It is planned, not implemented.
- M3 will support judged persona review against an explicit rubric. It is planned, not implemented.
- M4 is Luke's reading of replies and evidence for character quality.

These levels answer different questions. M0 locks local behavior, M1 compares captured replies without another model call, M2 will measure live generation, M3 will add a structured judge, and M4 remains human review.

### Runtime oracle and contract renderer

Offline replay uses `createChatOrchestratorRuntime` and the real streaming controller rather than a second implementation of cue behavior. The shared bucket functions provide the same outcomes used by the application. The shared contract renderer produces the contract text used by both the app and prompt command.

### Committed dataset

Datasets live under `packages/qa-tools/model-eval/sets/<set-id>/`. The saved transcript schema carries source, model, generation, prompt, machine, conversation, reply, timing, and usage fields needed to identify each record. Model evaluation output distinguishes contract metrics from style heuristics; heuristics are not combined into a score.

The `legacy-2026-10-27-mac-m2` set remains separate from runs using the canonical current prompt. It reproduces historical findings on fixed replies. It must not be mixed with canonical-contract runs or used to rank models against the current prompt.

### Contract and scorer versions

The rendered stage-contract version is the first 12 characters of its SHA-256. This identifies the exact contract text. Separately, when any scorer definition changes, bump `CUE_CONTRACT_SCORER.version` in the same commit. Run comparison uses `closureDigest`, scorer version, and `coreAgentDistSha256` as one comparability key.

### Provenance

The closure digest covers the sorted model-scoring source closure, with CRLF line endings normalized to LF before hashing. This makes source hashes stable across checkout line-ending settings while preserving other bytes. `coreAgentDistSha256` separately identifies the built runtime that scoring executed. The run manifest records the scorer identity, source revision, and dirty state.

## Consequences

- The legacy Mac M2 comparison confirmed five of six claims: dolphin3's unknown LOOK marker and invented emotion names, hermes3's zero leading cues, gemma4's invented `pouting` and `pouty`, qwen3.5's lower JSON cue count at temperature 0.6, and ministral-3's stage directions in every sweep reply. Row 4, cogito:8b example echo at temperature 0.6, was initially a finding because CRLF extraction returned no examples. The extractor was fixed to accept CRLF, and the regenerated comparison confirms `style.exampleEcho = 4` for `cogito:8b/temp-0.6`.
- Fixture 25 pins the pre-existing chunk-variance defect at `packages/core-agent/src/runtime/response-categoriser.ts:260-289`. Whole-text and per-character replay differ for this case. The finding is recorded, not hidden by changing runtime behavior.
- M2 still needs a scenario schema and a live transcript source. M3 still needs its judge and persona rubric.
- A root `AGENTS.md` routing row for model evaluation remains follow-up work and must land as a separate agent-configuration commit.
- `packages/core-agent/vieval.config.ts` remains an unrelated leftover.
- The stale `[Act 2]` comment in the compliance test was corrected to match runtime behavior.
- `packages/stage-ui/src/stores/providers/use-provider-validation.browser.test.ts` has an intermittent Pinia teardown rejection at line 52. It is a pre-existing test flake, not a model-evaluation failure.
