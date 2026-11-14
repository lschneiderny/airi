# MAGIC motion driver

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
