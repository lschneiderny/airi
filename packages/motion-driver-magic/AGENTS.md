# MAGIC Motion Driver Guide

## OVERVIEW

Numerical VAR and AR-HMM fitting with seeded procedural motion generation. Score: 9. Distinct model boundary.
Follow the [root guide](../../AGENTS.md) for shared rules and test skills.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Public API | `src/index.ts`, `src/fit.ts` | Models, method dispatch, public types |
| Common frames | `src/types.ts` | Training sequence and generator contracts |
| VAR model | `src/var.ts` | Model facade |
| AR-HMM model | `src/ar-hmm.ts` | Clustering, expectations, transitions, generation |
| Channel conversion | `src/shared/channels.ts` | Duplicate channels, baseline, bounded reconstruction |
| Numerical fitting | `src/shared/numeric.ts`, `src/shared/var.ts` | Features, solvers, coefficients |
| Randomness | `src/shared/random.ts` | Seeded sampling |
| Regression coverage | `src/var-ar-hmm.test.ts` | Determinism and probability normalization |

## CONVENTIONS

- Callers convert application recordings to fixed-width numerical frames.
- Training sequences carry sample rate and original duration.
- Model fitting and frame generation do not own scheduling or transport.
- Generators have independent seeded state.
- Channel extraction folds exact duplicate source curves and skips constant channels.
- Reconstruction preserves baseline values and clamps varying channels to source bounds.

## ANTI-PATTERNS

- Do not import Vue, renderer objects, or recording editors.
- Do not add browser scheduling to numerical model code.
- Do not let one generator's state affect another generator.
- Do not use uncontrolled randomness in deterministic regression tests.

## CHECKS

- Tests: `pnpm -F @proj-airi/motion-driver-magic test`.
- Typecheck: `pnpm -F @proj-airi/motion-driver-magic typecheck`.
- Build: `pnpm -F @proj-airi/motion-driver-magic build`.
