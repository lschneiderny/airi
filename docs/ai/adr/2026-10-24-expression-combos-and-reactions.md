# Expression combos and reactions

Date: 2026-10-24
Status: accepted

## Context

The Live2D expression tab showed one flat list. Whole-face moods and small details looked the same there, duplicate files appeared twice, and files that the app could not classify landed under `face`. Each emotion mapped to single expressions only, so a look built from several expressions, such as an angry face with puffed cheeks and a dark face, could not be saved or triggered as one unit.

Choose-one sets also had no memory. A slot activation that conflicted with a saved default or a manual toggle was skipped, so nothing restored the conflicting expression when the activation ended.

## Decision

### Combos are catalog entries

A combo is a catalog entry with kind `combo`. It lists members with a strength from 0 to 1, and it stores its slots and mappings like any other entry. Every existing trigger works on a combo without new plumbing. A combo can be triggered by an emotion mapping, by the AI through the exposed label list, by a saved default, or by the user from the Combos card.

A combo's slots are the distinct slot kinds of its usable members, in face, effect, prop order. A combo with an outfit, system, or unsorted member has no slots, so it can only be turned on by the user or by a saved default. The Combos card shows a manual-only note for such combos and omits the AI marker.

A combo's area is its stored area when one is set. Otherwise it is the shared area of its members, or `whole-look` when the members span two or more areas. An area can be chosen when a combo is created and cleared later. Re-saving a combo sends an area only when the user changed the Area select, so a derived area is not written to storage.

### Claims model with masks and restore

The store no longer deletes conflicting expressions. It resolves a set of claims into the desired set on each change.

- Base claims are manual activations, seeded from the rest set. Each base claim has a sequence number.
- Slot claims come from the non-null leases of the face, effect, and prop slots.
- Claims are walked from the highest layer and newest sequence first. A member whose choose-one group is already held by a different entry is masked, and the store records which trigger masked it.
- A masked member is not deleted. Releasing the claim that masked it restores it, so a saved default or a manual toggle comes back when a combo ends.
- A switch row marked "Hidden by X while it is active" turns its own base claim off. That entry does not return when X ends.

Saving defaults stores the base claims in sequence order, including combo ids and masked entries. Slot claims are never saved.

### Slot spanning

A combo occupies every slot it spans. The decider emits one slot command per spanned slot, and every command of one trigger creates an identical lease. Replacing, clearing, muting, expiring, or ending speech releases a spanning lease through the same path, so the combo releases atomically. After a combo pick, the decider marks each spanned slot occupied for the rest of the episode, so no later effect pick stacks on a face and effect combo. Ticket draws are unchanged, and a combo that spans prop is never picked automatically.

A spanning pick consumes one budget entry per spanned slot.

### Fractional strength and max

Mapping weights and combo strengths are fractional. An expression that adds to its parameters blends smoothly. When one expression is shared by several owners, the composer takes the maximum of their strengths and does not add them. Re-targeting the same weight does not reset its fade.

### Unsorted kind and the area field

`ExpressionKind` gains `unsorted` and `combo`. `derive` falls back to `unsorted` when a file shows no face evidence and its label matches no emotion token. Unsorted entries have no mappings, are not exposed to the LLM, and are not offered for automatic picks. They stay visible in the Unsorted section until the user gives them a kind.

Every entry has an optional `area`: whole looks, eyes, mouth, cheeks, effects, outfit and hair, props, hidden, or unsorted. The area is derived from parameter names and display names, and a user can override it. An entry override can clear its area, and the merged entry then falls back to the derived area. The panel groups entries by area. Choose-one sets are shown as picker rows.

### Duplicate collapse and its primary rule

Expression files with identical parameter writes collapse into one primary entry. The primary is chosen by this key, in order: system entries first, then entries without a generic label, then the label source (model setting, VTube hotkey, or file name), then entries referenced by the model file, then the id in code-point order. The primary records the other ids as `aliases`. Each other member gets `duplicateOf` and is excluded from automatic picks, the LLM list, and the reactions picker. The panel shows "Also: ..." on the primary, and a "Show {label} separately" action removes the collapse for one member.

Duplicate detection runs before choose-one sets are derived, so duplicates do not form a set.

### Detail weight 0.5

Face entries whose area is eyes, mouth, or cheeks get mapping weight 0.5. Whole-look faces keep weight 1. Derived effect mappings keep weight 1, while the Reactions picker chooses its default weight by area alone, so an entry whose area the user overrode to eyes, mouth, or cheeks gets 0.5 even when it is an effect. The reactions row shows a "½" marker on every mapping whose weight is below 1, and the user can change the weight in the entry editor.

### Custom single-parameter expressions over free switches

The user can add a custom expression for one parameter that the model does not use for any other expression. The parameter list offers only free switches. A custom expression is stored in `expression-catalog:<modelId>` as a custom document, with a label, kind, area, value, and mappings. The Reactions picker can map a custom face or effect entry through `update-custom`.

### Additive optional persistence with no version bumps

All new fields are optional. The stored catalog document, `expression-catalog:<modelId>`, and the rest set, `expression-rest:<modelId>`, keep `version: 1`. A document written before this change loads unchanged, and a document written after it loads on an older build with the new fields ignored. Combo and custom documents are additional optional arrays in the same version 1 document.

### Snapshot rename to `entries`

The settings snapshot field that lists catalog entries is renamed to `entries`. The renamed field is the only contract change in the snapshot, and every window that renders the snapshot reads it under the new name.

## Behavior of the delivered panel

The Expressions tab opens on Reactions, then Combos, then Everything else.

- Reactions has one row per emotion: happy, sad, angry, think, surprised, awkward, question, curious, love, flustered, and sleepy. Each row shows its mapped entries as chips. A chip has a preview button, a remove button, and a select checkbox. Add expression chooses from face, effect, and combo entries that are not duplicates and not already mapped to the emotion.
- Make combo is disabled until at least one chip is selected. It opens the combo editor with the selected plain faces and effects as members at strength 1. Selected combos are not added as members.
- Combos lists saved combos with their members, strengths, slots, area, and AI marker. The marker text comes from `settings.live2d.expressions.combos.marker-ai` and `marker-default`, so both translate.
- Everything else lists the remaining entries by area, with Unsorted for entries the app could not classify.

## Superseded passages

The following passages in earlier ADRs are replaced by this one. Each has a pointer to this ADR.

- The Eligibility section of `docs/ai/adr/2026-10-18-expression-performance.md`. Automatic and LLM eligibility now also cover combos, and they exclude duplicates and unsorted entries.
- The "Pick-one groups at runtime" section of `docs/ai/adr/2026-10-18-expression-performance.md`. Masks replace the skipped slot activation, and they restore on release.
- The "Slot leases" section of `docs/ai/adr/2026-10-18-expression-performance.md`. A spanning combo lease releases atomically.
- The settings command table of `docs/ai/adr/2026-10-18-expression-performance.md`. Commands now include `set-active` with an `active` flag, and the claims model maintains the list.
- The non-goal "Group creation remains a separate UX pass" in `docs/ai/adr/2026-10-24-expression-auto-setup.md` (lines 33-35). Choose-one sets are now picker rows in the Reactions and Everything else sections.

## Consequences

Combos, custom expressions, and areas add optional fields to a version 1 document. Older data loads without migration, and no compatibility code is needed for the previous per-parameter defaults.

A slot activation that used to be skipped now masks the conflicting entry for the length of the activation. The user can see the masked entry with its "Hidden by" line, so the change is visible.

The AI sees combos only when they are exposed and have slots. Unsorted, outfit, system, and duplicate entries never reach the AI.
