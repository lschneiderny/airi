# Character mind: expression picks and refusal reports

Date: 2026-11-22
Status: accepted; CM7b implemented, with headless and rendered acceptance reserved for the orchestrator.

Current rules are in [Body ownership](../context/body-ownership.md). The
[performers plan](../../../.omo/plans/character-mind-performers.md) records the
approved design, implementation departures, commits, and every check command.
This slice implements the expression portion of decision 6 of the
[character mind direction](2026-11-17-character-mind-direction.md).

## Context

The mind already decides an emotion, its strength, its hold, and its id. Each
stage maps that decision onto its model's catalog. The picker and planner
previously drew from a conductor-specific seed, so identical intents could
pick different assets. Mind moment ids were discarded before `useIdleProps`
drew their chance and entry with `Math.random`.

Expression stores silently rejected missing or unusable entries. Live2D also
protected manual groups and groups held by another slot without reporting
those refusals through the conductor. A planner could lose an entry between
selection and its timing event, before a store ever received a command.

CM7a already replaced driver gates with declarations. Its upstream face
routes, classic clip playback, tool exposure, and capability refusals stay
unchanged, as do CM5b's beats, CM6b's gaze and director inputs, CM6a's rest
position and sidestep, and c6's mapping weights and catalog mirror.

## Decisions

### Intent ids seed asset selection

The four intent-answering affect signals (`reaction`, `expression`, `neutral`,
and `clear`) require `intentId`. `expressionSeed` hashes that id and the slot
with FNV-1a, then the existing Mulberry32 draw supplies the gate and selection
tickets. The picker and planner use the same tickets for each slot.

Equal intent sequences, catalogs, effective settings, and selection history
produce equal picks despite different conductor seeds. The mind's random
source, habituation, bands, holds, recency weights, and planner budget do not
change. Timing and deadline signals release previously selected entries and
make no new selection.

An escalation keeps the episode's tickets and occupied slots, preserving the
existing no-reroll rule. A decider first attached or switched during an
escalation seeds its first tickets from the intent it receives. Agreement is
defined for stages fed the same history, rather than a stage missing the
episode's start and one that saw it.

The conductor forwards a moment's id through Stage to `useIdleProps`, where
it seeds the 0.6 chance and entry choice. Performer idle-behaviour reports and
lab previews have no mind moment id; their separate local Mulberry32 stream
starts at 0. They never consume a mind moment's tickets. The existing moment
cooldown, hold, and claim precedence stay unchanged.

### Affect traces record the identity used to pick

Affect trace version 3 records required intent ids beside the decided
episodes. Exact replay keeps the checkpoint, and comparison replay uses the
same intent identities despite a different initial conductor seed.
Versions 1 and 2 are rejected. Traces are explicit debugging exports, so no
compatibility reader or new persisted state is added.

### Refusals observe existing ownership

`ExpressionRefusal` belongs to stage-shared. An expression store's `applySlots`
returns at most one report per refused entry in a batch, with its entry id and
reason, never a label. The conductor forwards it through `onRefusal`, the
reaction inspector, and the motion QA `performer-refusal` mind event.
Expression reports have `kind: 'entry'` and `cause: null`; they are diagnostics,
not inputs to a mind policy. Shown entries and clears produce no refusal.

Both stores report `missing-asset` for an absent catalog entry or an entry
without the requested usable slot. The conductor reports an exposed entry
without usable slots before it asks the mind to derive an emotion. The
planner reports a scheduled entry that disappears before emission.

Live2D reports `masked-by-manual` for its existing protected manual group and
`masked-by-expression` for the distinct existing protection of another slot's
group. The extra reason avoids misidentifying a slot owner as a manual or
clip owner. Reports describe command admission; normal lease replacement,
expiration, and fades retain their previous behavior.

The plan assumed clip-owned expression slots, but neither current renderer
has them. Live2D composes expression parameters after motion curves; MMD's
expression layer outranks clip morphs. MMD's slot claims also outrank its manual
claims. Adding masks would change Natural, so this slice preserves those rules.
The report contract supports `masked-by-clip`, and the conductor and QA tests
cover carrying it, but no current store produces that reason. A playing clip
alone is not evidence that an expression was masked.

## Consequences

Body ownership's former Target rule 5 is current for the expression ownership
that exists. Two stages receiving the same decisions agree on asset selection,
and existing admission refusals are observable without changing composition.
No body or gaze rule, dependency, settings document, stored key, or fixed
prompt changes.

**Orchestrator acceptance placeholder: replace this sentence with the headless
identity results, any b1 Live2D rig hash re-pin with the old and new emotion
picks, and the rendered CM7b results.**

The orchestrator must compare every scenario named in plan section 9; that
list contains ten scenarios including `music`, although the plan says nine.
Only `emotions` and `touch` may differ, only in face morph channels where the
pick changed. Body and gaze blocks must remain `IDENTICAL`. The Live2D rig
hash may change at b1 only; this implementation did not run the rig or re-pin
its hash.

Rendered acceptance uses Live2D Natural with the expression panel: a poke and
an ACT emotion on a free slot produce no refusal. A manual entry in the same
protected face group as the requested expression makes the next ACT emotion
report `masked-by-manual` with its entry id and no label. The manual entry
must remain shown. MMD's manual precedence is intentionally different and is
not a substitute for this Live2D check. Each launch must have zero renderer
and main-process errors.

Scores prove direction, size relative to the recipe, release, and detectability
above the rig's idle noise. They do not prove naturalness, which stays a visual
review.

## Verification

The owner replaced repository-wide verification with package checks and
reserved all QA and Electron runs for the orchestrator. The final code checks
passed: stage-shared 1,884 Node tests; stage-ui 1,959 Node and 1,018 browser tests
with five existing skips; Live2D 790 Node and 43 browser tests; MMD 433 Node
and 34 browser tests; all 28 dependent packages typechecked with concurrency 2.
Focused tests cover cross-seed agreement, version 3 replay and version 2
rejection, 10,000 moment ids at the unchanged chance tolerance, real store
admission outcomes, and id-only observer events.

Policy-document checks passed with 11 tests. b2's four MMD devtools browser
timeouts passed in the single isolated rerun without changing timeouts.
Changed TypeScript passed ESLint; one existing Stage trivial-function warning
outside the changed callback remains. The plan contains the per-item commands
and counts. No headless or rendered result is claimed by these unit and browser
suites.
