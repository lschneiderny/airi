# QA Tools Guide

## CONVENTIONS

- `README.md` is the authoritative operating manual.
- Product packages must not depend on this package. It is not for ordinary development commands.
- Run `pnpm qa:doctor` before rig or rendered runs. Doctor reports problems and never repairs the environment.
- Exit codes are contractual: 0 passed, 1 a check failed or a run broke, 2 invalid arguments or refused setup, 130 interrupted. `qa:bench` also uses 3 for a lease or mount timeout.
- Scenarios use the `@proj-airi/stage-shared/motion-scenario` contract.
- `fixtures/model/scenarios/replay/` holds hand-written replies for the replay server, not model output.
- App sessions use the `live` CPU lease and may share capacity with tests. Frame-timing runs (`qa:stage measure`, `qa:bench`) use `exclusive`.
- The headless Live2D rig runner (`src/t2/`) needs a local ForBOOTH rig and Cubism Core.
- Live2D acceptance on ForBOOTH counts for Bear Pajama too (Luke, 2026-10-18; [motion QA levels ADR](../../docs/ai/adr/2026-10-20-motion-qa-levels.md)).
- Luke's VTS desk recordings are a reference for idle liveliness only, not for emotion or speech (Luke, 2026-10-19).
- A stage run that presses on the character locates her by opaque pixels with an alpha-qualified locator. A locator built from a composite screenshot reports false fall-throughs on transparent edge pixels (`.omo/plans/linux-sensor-parity.md`, todo 34).
- Run output and rig, model, or core assets are not committed.

## ANTI-PATTERNS

- Never skip, delete, or weaken a test to clear a failure.
- Never tune a gate, scorer constant, or Natural recipe to make a failing run pass. Failures are findings.
- Keep the desktop, focus, and app window undisturbed during rendered runs. On Linux, start them through `pnpm qa:display run --` so they run in a headless KWin session instead of the user's desktop.
- Do not kill leftover processes by PID alone. Confirm that their command lines contain your worktree path first.
- Statistical gates do not prove naturalness. Naturalness remains Luke's visual review.

## CHECKS

- Choose required tiers from the [testing guide](../../docs/ai/context/testing.md); this section lists command mechanics only.
- Node tests: `pnpm -F @proj-airi/qa-tools exec vitest run --project node`.
- Bridge leak scan: `pnpm check:bundle` builds the desktop app and fails if a renderer chunk contains the motion QA bridge.
