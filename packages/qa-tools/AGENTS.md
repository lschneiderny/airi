# QA Tools Guide

## OVERVIEW

Private, Node-only QA CLIs for motion gates, rendered T3 scenarios, model evaluation, known-failure test runs, reports, and evidence. Distinct agent-QA domain with its own Vitest projects.
Follow the [root guide](../../AGENTS.md) and its motion-qa task routing. `README.md` is the authoritative operating manual.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| CLI entrypoints | `bin/` | `doctor`, `motion`, `report`, `test`, `evidence`, `t2-probe`, `check-prod-bundle`, `setup`, `llm`, `app`, `smoke`, `mcp` |
| Experience session driver | `src/app/` | `pnpm qa:app run`: temporary profile, seeded replay provider and model, chat send, named bridge events, JSON summary |
| Clean-start smoke and page errors | `src/smoke/` | `pnpm qa:smoke`: CDP error collector for every window, main-log scan, allowlist in `fixtures/smoke/allowed-errors.json` |
| Agent MCP server | `src/mcp/` | `pnpm qa:mcp`: `airi_*` tools over one `AppSession`; registered in the root `.mcp.json` |
| Replay chat and speech server | `src/llm/` | `pnpm qa:llm serve`: scripted OpenAI-compatible replies and WAV speech, JSONL request log |
| Model evaluation CLI | `bin/model.ts` | Dispatches `prompt`, `score`, `import-ollama-bench`, and `help` |
| Model evaluation implementation | `src/model/` | Prompt rendering, transcript import, runtime scoring, provenance, and summaries |
| Committed model datasets | `model-eval/sets/` | One directory per set id, including the separate legacy Mac M2 benchmark |
| Gate definitions run by Vitest | `gates/*.gate.ts` | Gate rules live in `stage-ui-live2d` `natural-motion/gates.ts` |
| Gate CLI, T3 planning and scoring | `src/motion/gate/` | `t3-scenario.ts`, `t3-score.ts`, `t3-archive.ts` |
| T1 simulation and scenario sink | `src/motion/t1/`, `src/motion/scenario-sink.ts` | No rig; expressions are decided, not applied |
| T1 result cache | `src/motion/cache/` | Key, module-graph closure, replay |
| Scorer validation | `src/motion/validation/` | `evaluate.ts` is the largest module |
| Headless rig runner | `src/t2/` | Needs local ForBOOTH rig and Cubism Core |
| Rendered Electron runs | `src/t3/` | Launch, bridge client, pointer, teardown, trace verification |
| Known-failure baseline | `known-failures.json`, `src/known-failures/` | Package, project, file, and full test name key |
| Review report | `src/report/` | Self-contained HTML; `limitations.ts` text is quoted verbatim |
| Run directories and archives | `src/evidence/` | `.temp/qa/` runs, `.omo/evidence/<slug>` archives |
| Doctor probes and setup | `src/env/` | Pinned pnpm, processes, stray Electron, pointer platform; `.env.qa` loading; `qa:setup cubism` |

## CONVENTIONS

- Product packages must not depend on this package. It is not for ordinary development commands.
- Run `pnpm qa:doctor` before gates or T3 runs. Doctor reports problems and never repairs the environment.
- Exit codes are contractual: 0 passed, 1 a check failed or a run broke, 2 invalid arguments or refused setup, 130 interrupted. T3 also uses 3 for a CPU-lease timeout.
- Scenarios use the `@proj-airi/stage-shared/motion-scenario` contract and can run at several levels.
- The `gate` Vitest project includes `gates/**/*.gate.ts` only when `QA_RUN_DIR` is set. Unset it before running package tests directly.
- Gate worker counts default to the CPU slot grant and are clamped to it.
- App sessions use the `live` CPU lease and may share capacity with tests. Motion gates use `gate`; frame-timing runs use `exclusive`.
- Changing a gate requires editing `gates.ts` and bumping its `version` in a commit before running it.
- Run output and archived evidence are not committed.

## ANTI-PATTERNS

- Never skip, delete, or weaken a test to clear a failure. Add a registry entry only with a concrete cause, date, and removal condition.
- Never tune a gate, scorer constant, or Natural recipe to make a failing run pass. Failures and missed validation thresholds are findings.
- A cached T1 run is never T3 acceptance evidence.
- A `qa:motion t3` capture takes the `live` lease by default and may run beside verify, tests, and other checks. A T3 timing run (the `qa:motion` T3 gate, or `qa:motion t3 --lease exclusive`) keeps the `exclusive` lease: do not start it during heavyweight checks, because its lease waits until every other lease ends. Check selection follows `docs/ai/testing.md`.
- Keep the desktop, focus, and app window undisturbed until a T3 run ends. On Linux, start it through `pnpm qa:display run --` so it runs in a headless KWin session instead of the user's desktop.
- Do not kill leftover processes by PID alone. Confirm that their command lines contain your worktree path first.
- Statistical gates do not prove naturalness. Naturalness remains Luke's visual review.

## CHECKS

- Choose required tiers from the [testing guide](../../docs/ai/testing.md); this section lists command mechanics only.
- Typecheck: `pnpm -F @proj-airi/qa-tools typecheck`.
- Node tests: `pnpm -F @proj-airi/qa-tools exec vitest run --project node`.
- Doc path audit: `pnpm -F @proj-airi/qa-tools exec tsx scripts/check-doc-paths.ts`. It checks paths named in the motion QA ADR and skill.
- Bridge leak scan after a desktop build: `pnpm -F @proj-airi/qa-tools exec tsx bin/check-prod-bundle.ts`.
