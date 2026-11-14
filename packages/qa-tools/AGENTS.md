# QA Tools Guide

## CONVENTIONS

- `README.md` is the authoritative operating manual.
- Product packages must not depend on this package. It is not for ordinary development commands.
- Run `pnpm qa:doctor` before gates or T3 runs. Doctor reports problems and never repairs the environment.
- Exit codes are contractual: 0 passed, 1 a check failed or a run broke, 2 invalid arguments or refused setup, 130 interrupted. T3 also uses 3 for a CPU-lease timeout.
- Scenarios use the `@proj-airi/stage-shared/motion-scenario` contract and can run at several levels.
- `fixtures/model/scenarios/replay/` holds hand-written replies for the replay server, not model output.
- The `gate` Vitest project includes `gates/**/*.gate.ts` only when `QA_RUN_DIR` is set. Unset it before running package tests directly.
- Gate worker counts default to the CPU slot grant and are clamped to it.
- App sessions use the `live` CPU lease and may share capacity with tests. Motion gates use `gate`; frame-timing runs use `exclusive`.
- Gate rules live in `stage-ui-live2d` `natural-motion/gates.ts`.
- Changing a gate requires editing `gates.ts` and bumping its `version` in a commit before running it.
- T1 simulation uses no rig; expressions are decided, not applied.
- The headless rig runner (`src/t2/`) needs a local ForBOOTH rig and Cubism Core.
- Review report `limitations.ts` text is quoted verbatim.
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
- Node tests: `pnpm -F @proj-airi/qa-tools exec vitest run --project node`.
- Doc path audit: `pnpm -F @proj-airi/qa-tools exec tsx scripts/check-doc-paths.ts`. It checks paths named in the motion QA ADR and skill.
- Bridge leak scan after a desktop build: `pnpm -F @proj-airi/qa-tools exec tsx bin/check-prod-bundle.ts`.
