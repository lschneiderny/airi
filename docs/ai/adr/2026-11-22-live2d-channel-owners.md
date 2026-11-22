# Live2D channel owners under Natural

Date: 2026-11-22
Status: accepted; CM7d implemented and accepted on macOS (results below).

Current rules are in [Body ownership](../context/body-ownership.md). The
[performers plan](../../../.omo/plans/character-mind-performers.md) records the
channel inventory, departures, commands and commits.

## Context

Natural's frame already composed eyelids and face over their expression and
manual inputs, yielded to lipsync and manual breath, and excluded physics
outputs. Two boundaries remained implicit. The Root expression context wrote
after the fork's composer, so plugin order made its preview win. Expression
head angles were written before Natural and overwritten at full posture
ownership.

The implementation starts after CM7a, retaining its capability gates and
upstream driver routes. It also retains CM5b's beat input, CM6b's gaze arbiter
and director intents, CM6a's rest position and sidestep, and c6's independent
expression catalog mirror. Their behavior under Natural is unchanged.

## Decision

The owner approved D12 of the performers plan on 2026-11-21. This implements
direction decision 8 and Body ownership Target rule 2 for expression tilts,
and Target rule 3 for Live2D under Natural.

An owner is the final composition boundary of a channel. Earlier SDK motion
and plugin parameter values are inputs that it consumes. Nothing subsequently
replaces its result. This permits intermediate parameter assignments within
the composition; it does not treat their order alone as an ownership rule.

The channel inventory found no third independent owner requiring a wider
refactor. Natural composes posture, gaze and face. Lipsync and manual breath
have explicit ownership windows that Natural yields. Physics owns the
outputs the adapter excludes. SDK pose owns part opacity. The fork expression
composer owns parameters outside those composed channels.

### The context preview is a lease

Under Natural, the controller samples active Root context controls and
temporary previews into `useExpressionStore.contextPreview`. This is a
frame-scoped parameter lease above catalog claims, not a new catalog entry
or another timer. `ExpressionComposer` writes its combined result once.
The direct context plugin writes only under Universal and MAGIC.

The lease retains upstream's blend semantics: Add is relative to the model
default, Multiply uses the fork's composed parameter, and Overwrite replaces
it. Underlying slot lifetimes and fades keep running. Withdrawal reveals the
underlying lease or clean base immediately, and model disposal clears the
input. Entering Natural first releases any prior direct upstream context
writes, so they cannot become a stale captured base.

Universal and MAGIC retain their direct plugin and its existing release
semantics. Keeping a second plugin writer under Natural was rejected because
its precedence would still depend on registration order.

### Expression tilt is a weighted posture input

The expression composer exposes its current contribution relative to the
clean frame base in model parameter units. This excludes motion curves,
manual pose and SDK focus from the expression input. The adapter converts
head XYZ deltas into normalized units using the rig's directional ranges
and passes them to `NaturalMotion.advance`.

Natural composes the input into that frame's head and eye compensation. It
does not retain the input or modify any seeded process or body intent.
Physics exclusions, manual handoff, and clip residuals retain their existing
rules. The stage declares `EXPRESSION_TILT_WEIGHT = 0`, and the zero-weight
path preserves the existing arithmetic and output exactly.

Keeping an unexplained overwrite was rejected because it hid the expression's
ownership. Raising the weight now was also rejected: a visible contribution
belongs to the later motion review, not this ownership change.

## Consequences

No setting, persisted state, dependency, seeded draw, decision constant or
motion threshold changes. The preview keeps priority while it is active,
and the expression tilt contributes zero to the rendered posture.

Target rule 3 remains explicitly open for renderer channels outside this
Live2D inventory; this slice does not claim to have audited them.

On macOS, all ten headless scenarios (`idle`, `idle-drive`, `gaze-shift`, `speak`, `gesture-under-clip`, `emotions`, `walk`, `sleepy-no-clip`, `touch`, and `music`, seed 1) are `IDENTICAL` against `main`, and the `pnpm qa:live2d-rig` trial's `sha256` is unchanged. In the rendered app with 0 renderer and 0 main-process errors, Live2D Natural refused an ACT `shrug` as `undeclared`, played an ACT `nod`, and issued the emotion; under Universal both gestures were refused and the mind took no emotion step. The context preview itself was not exercised rendered, because it is driven from the card editor's Live2D controls; the expression controller tests cover the lease, its release, and upstream's plugin path.

Scores prove direction, size relative to the recipe, release, and detectability
above the rig's idle noise. They do not prove naturalness, which stays a visual
review.

## Verification

Deterministic Node regressions cover context preview precedence over a slot,
withdrawal, Multiply without repeated application, upstream driver behavior,
driver handoff, definition unload, and model disposal. Natural and adapter
regressions cover weight-zero identity, weight-one contribution, range clamping
and immediate withdrawal. Existing observer hashes were not changed.

The plan records package suites and dependent typechecks. No headless motion,
Live2D rig, or Electron command ran in this worker. The orchestrator owns those
checks and section 9's rendered preview check.
