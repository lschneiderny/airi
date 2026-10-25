# expression-reactions-and-combos - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** Luke, setting up a Live2D model's expressions. The Expressions tab will open on what the character does for each emotion, let him bundle several expressions into one combo that anything can trigger, and file everything else by body area.

**What you'll get:**
- A Reactions view, one row per emotion.
- Combos that the AI, emotions, saved defaults and Luke can all turn on.
- Partial strength for combo members.
- Saved looks that come back after a combo ends.
- Unrecognized expressions kept away from the AI until they are sorted.
- Duplicates shown once.
- Details that no longer stand in for whole moods.
- A way to add model switches that no expression file covers, such as Bear's earphones.

**Why this approach:**
- **Combos are ordinary catalog entries.** Every existing trigger works on them without new plumbing.
- **Conflicts hide instead of delete.** A combo can always put back what it covered.

**What it will NOT do:**
- No free-form parameter editor, no combos inside combos, and no user-made choose-one sets.
- No change to how saved data is stored, so nothing needs migrating.
- No changes to other model types or to motion selection.

**Effort:** XL
<!-- Effort is exactly ONE band, never hours/days. Quick = single edit, minutes of agent work; Short = one focused change, a few files; Medium = multi-file feature in one session; Large = several waves, one long session; XL = multi-session or architectural work. A written duration is rewritten to a band. -->
**Risk:** Medium - the new rule for who owns an expression and the multi-slot combos touch the core of how expressions turn on and off, though every rule has its own test.
**Decisions to sanity-check:**
- Clicking a row that a combo is currently hiding turns that expression off for good, rather than bringing it back over the combo.
- A combo containing an outfit or system expression can only be turned on by you or saved defaults, never by the AI or emotions.
- When two owners share a member, the stronger strength wins.

Your next move: the plan-reviewer review runs automatically; after it approves, start execution with `/ulw-execute expression-reactions-and-combos`. Full execution detail follows below.

---

> TL;DR (machine): XL, risk Medium (store claims model + decider spanning + cross-window contract); 13 todos in 8 waves + F1-F4: unsorted/combo kinds, area, duplicates, detail weight 0.5, combos with masked-claim restore and slot spans, fractional strength, custom free-switch expressions, emotion-first Reactions/Combos/Areas panel, ADR.

## Scope
### Affected user and ideal state
**Affected user:** Luke sets up each Live2D model in the Expressions tab. He uses it in the Electron settings window, which runs in remote-snapshot mode, and on stage-web, which runs in local-store mode.

Today the tab is one flat list. Whole-face moods and small details look identical there, duplicate files appear twice, and unrecognized files land under "face".

After this plan, the tab opens on what the character does for each emotion. Luke can bundle expressions into combos that every trigger can fire, and everything else is filed by body area.

Secondary users:
- **The AI.** It reads the list of exposed expressions and calls `set_expression`.
- **Viewers.** They see the face.
- **Code that consumes the catalog contract:** the Electron and Kirie settings bridges, decider traces, and qa-tools.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | The Expressions tab opens on a Reactions section: one row per emotion listing every expression and combo mapped to it, with preview, add-mapping and remove-mapping on the row | Luke chose emotion-first. He must see what fires for "angry" without opening editors |
| IS-2 | From a Reactions row Luke selects expressions and saves them as a combo mapped to that emotion | A Reactions row is where combos naturally get made |
| IS-3 | A combo fires through every existing trigger (manual switch, saved defaults, automatic emotion pick, AI `set_expression`, ACT marker) and its members appear and leave together | Decision: a combo is a catalog entry |
| IS-4 | A triggered combo replaces conflicting saved defaults and choose-one members while active and restores them when it ends. Nothing saved is lost | Decision: override, then restore |
| IS-5 | While a combo holds face and effect, automatic picks never stack another expression into those slots | Decision: a combo occupies every slot it spans |
| IS-6 | A combo member can run at partial strength | The rigs have partial values, such as Blush at 0.7 |
| IS-7 | Everything else is grouped by area (whole looks, eyes, mouth, cheeks, effects, outfit & hair, props, hidden, unsorted). Choose-one sets are picker rows, and the word "group" never appears in the UI | Decision: two concepts, no "group" noun |
| IS-8 | Expressions the app cannot classify are Unsorted. They stay out of the AI list and automatic picks until Luke gives them a kind | ForBOOTH `expression19`, `Bowtie` and `Bloodstain` reach the AI today |
| IS-9 | Expression files with identical parameter writes appear once, with "Also: ..." and a way to show them separately | ForBOOTH has several duplicate pairs |
| IS-10 | A lone detail (an eyes, mouth or cheeks expression) is picked about half as often as a whole-face mood for the same emotion | Luke chose half weight |
| IS-11 | A model switch that nothing else drives can be added as a custom expression and used like any other. "Nothing else" means no expression file, face tracking, lip sync, Natural motion or physics (example: Bear `Param7` earphone) | Luke chose free switches only |
| IS-12 | Existing saved per-model data (curated overrides, saved defaults) keeps working with no migration and no loss | Luke's profiles already hold curated data |
| IS-13 | Electron (remote snapshot + commands), Kirie, and stage-web (local store) all show and drive the new panel | Same-build cross-window contract |
| IS-14 | Decider replays stay deterministic, and existing recorded traces still parse and replay | Shared decider invariant |
| IS-15 | ADRs, the stage-ui-live2d README and the English strings describe the new behavior. No stale "confirmed" or "group" wording remains | Repo convention: docs ship with code |
| GAP-1 | `live2d.vue:105-164` renders one flat list in catalog order. Emotions are only a summary line per row | No emotion-centric view |
| GAP-2 | `CatalogEntry` has no members (`catalog.ts:35-46`), and `mergeCatalog` only overrides discovered ids (`catalog.ts:82-90`) | Combos cannot exist |
| GAP-3 | The store activates single ids directly on the composer (`expression-store.ts:122-144`, `expression-slot-leases.ts:29-63`). Rest-set load keeps only definition ids (`expression-store.ts:108`) | No expansion, and combo ids would be dropped |
| GAP-4 | Slot activation skips when a same-group conflict is owned by the rest set or a manual toggle (`expression-slot-leases.ts:37-47`). Nothing remembers what to restore | Combos would look half-applied |
| GAP-5 | Decider occupants hold one id per face/effect slot (`picker.ts:13-32`, `planner.ts:26-37`), and an explicit command fills only `entry.kind` (`selection.ts:104-116`) | Combos cannot hold several slots |
| GAP-6 | Composer `targetWeight` is only 0 or 1 (`compose.ts:15`) | No partial strength |
| GAP-7 | There is no area field. The i18n strings use "Group" wording (`settings.yaml:285-374`: `fields.group`, `group-none`). Kind "face" lumps moods, eyes, mouths and details together | Layout by area is impossible, and "group" is visible |
| GAP-8 | `suggestKind` falls back to `face` (`derive.ts:45`), and face is exposed to the AI by default (`derive.ts:147`) | Junk labels reach the AI prompt and the picker |
| GAP-9 | Nothing detects duplicates. Several ForBOOTH sets write identical parameters: `鼓脸`/`Puff Cheeks` (cheekpuff), `expression58`/`Tear Mouth Cancel` (Param165), `expression69`/`Tail Off` (Param175), and `expression70`/`初始状态`/`Watermark (Edit Key)` (Param176) | Duplicates show twice and form fake choose-one sets |
| GAP-10 | Every suggested face mapping has weight 1 (`derive.ts:47-74`) | Details stand in for moods |
| GAP-11 | The catalog is built only from exp3 files (`expression-controller.ts:32-76`) | Free switches are unreachable |
| GAP-12 | No gap today. The schema change introduces the risk | The change must stay additive |
| GAP-13 | The snapshot field is named `groups` (`expression-store.ts:22-25`). The command union has no combo or custom variants. The Electron and Kirie runtime tests assert the old shape | The contract must grow in both apps |
| GAP-14 | The decider and traces assume one slot per entry. qa-tools maps ids to `fileName` (`packages/qa-tools/src/t3/expression-ids.ts:14-21`) | Combos and custom entries need defined behavior |
| GAP-15 | ADR `2026-10-18-expression-performance.md` lines 224-225, 229-232 and 262-270 become stale, as does the auto-setup ADR non-goal "Group creation remains a separate UX pass". `performance.auto-expressions.description` still says "confirmed" | Stale docs |

### Must have
- **New expression kinds.** `ExpressionKind` gains `unsorted` and `combo`. Derivation falls back to `unsorted` when an entry shows no face evidence.
- **Combos.**
  - A combo is a catalog entry with the id prefix `combo:` and members `{ expressionId, strength }`, where strength runs from 0 to 1.
  - Each combo has its own label, mappings and AI switch.
  - Combos are persisted per model in the existing curated document.
  - Every existing trigger can fire them.
- **Store claims model.**
  - The desired set is resolved from base claims (manual, seeded from saved defaults) and slot claims.
  - Conflicts mask entries instead of deleting them, and release restores them.
  - Each change makes one `composer.setTargets` call.
- **Decider.** A combo emits one slot command per spanned slot, occupancy is recorded per spanned slot, and ticket draws are unchanged.
- **Composer.** Target weights are fractional. A member shared by several owners takes the max of their strengths.
- **Derivation.**
  - A derived `area` field, display-only and overridable.
  - Duplicates collapse under a primary, which records them as aliases. A "show separately" override undoes the collapse.
  - Detail expressions get mapping weight 0.5.
- **Custom expressions.** Single-parameter custom expressions over free switches, with the id prefix `custom:`.
- **Panel order.** Reactions, then Combos, then Everything else (area sections, including Unsorted).
- **Docs.** English strings, the ADR and the README.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No raw multi-parameter expression editor. A custom expression writes exactly one parameter.
- No combo inside a combo, and no user-created choose-one sets. The word "group" never appears in UI copy.
- No version bump for the curated document, the rest set or traces, and no migration or compatibility shim. Every new persisted field is optional.
- No edits to non-English locale files, and no `package.json` or lockfile changes.
- No change to Universal/MAGIC motion selection, VRM/MMD/Spine/Tachie, or the Godot sidecar.
- No feedback channel from the decider to store leases. The existing staleness stays a follow-up.
- No new shared primitive in `packages/ui`. Chips and cards are local single-use components under `packages/stage-ui/src/components/scenarios/settings/model-settings/`.
- The snapshot and command types stay in `packages/stage-ui-live2d/src/stores/expression-store.ts`, and the snapshot gets no runtime validation layer.
- No edits in the main checkout. These untracked paths are not touched: `.omo/drafts/*`, `.omo/plans/live2d-cursor-touch-integration.md`, `.omo/plans/expression-panel-auto-setup.md`, `.omo/tmp-idle-gate.ps1`, `.omo/ulw-research/`.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- **Test decision:** tests-after (Luke, 2026-10-24).
  - Vitest node tests in `@proj-airi/stage-shared`, `@proj-airi/stage-ui-live2d` and `@proj-airi/qa-tools`.
  - Vitest browser tests (Playwright Chromium) in `@proj-airi/stage-ui`, `@proj-airi/stage-tamagotchi` and `@proj-airi/stage-tamagotchi-kirie`.
  - An independent reviewer runs mutation probes on each todo.
- **Commands:**
  - stage-ui: `pnpm -F @proj-airi/stage-ui exec vitest run --project node <path>` or `--project browser <path>`.
  - Other packages: `pnpm -F <pkg> exec vitest run <path>`.
  - Typecheck: `pnpm -F <pkg> typecheck`.
  - After every todo, run `pnpm verify` (changed-file typecheck, lint and related tests).
- **i18n before browser runs.** After a YAML edit, run `pnpm -F @proj-airi/i18n build` before any stage-ui browser run. For each new key, assert `t(key) !== key` so a query cannot pass on a raw key.
- **Optimized-dependency reload.** The first browser run after an import-graph change may fail with "optimized dependencies changed. reloading". Rerun once and count only the warm run.
- **Known load-flaky tests.** Both pass when run alone: the `apps/stage-tamagotchi` chat viewport browser test, and `packages/stage-ui/src/stores/modules/speech-settings.browser.test.ts`. If one fails, rerun that file alone and report both runs. Never skip it.
- **Rigs (read-only):**
  - ForBOOTH: `C:/Users/Luke/Documents/Live2d Models/ForBOOTH-231-Holder-only@Do-not-share-or-resell`. 89 exp3 files, with the duplicate and unsorted cases.
  - Bear: `C:/Users/Luke/Documents/Live2d Models/bear Pajama V1.1`. 27 exp3 files, with the hair choose-one set and the `Param7` earphone free switch.
- **Evidence:** `.omo/evidence/expression-reactions-and-combos/task-<N>-expression-reactions-and-combos.<ext>` and `.omo/evidence/expression-reactions-and-combos/F<n>-expression-reactions-and-combos.*`, inside the execution worktree.
- **Temp files.** Every QA temp file lives under a per-task `RUN_TMP` outside the repository. Record its removal.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.
- **Wave 1** (parallel, disjoint files): todos 1, 2, 3, 4.
- **Wave 2** (parallel, disjoint packages): todos 5, 6, 7.
- **Wave 3:** todo 8, the store claims engine. It is one file family and needs todos 1, 2 and 5.
- **Wave 4:** todo 9: persistence, commands, custom definitions, and the snapshot rename across Electron and Kirie. It edits the same store files as todo 8.
- **Wave 5:** todo 10: the shared trigger editor extraction and the Combos UI.
- **Wave 6:** todo 11: area sections, Unsorted, duplicates and the custom creator. It edits the entry component that todo 10 refactors.
- **Wave 7:** todo 12: Reactions. It mounts into the section component that todo 11 edits.
- **Wave 8:** todo 13: docs, the ADR, and removal of now-unused English keys. It has to see the final UI.
- **Final:** F1-F4 in parallel.
- **Why waves 3-8 hold one todo each.** Each edits a file the previous todo just changed: `expression-store.ts`, `live2d-expression-entry.vue`, `live2d-expressions-section.vue` or `settings.yaml`. Splitting them would put two concurrent writers on one file.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 5, 6, 7, 8, 9 | 2, 3, 4 |
| 2 | - | 8 | 1, 3, 4 |
| 3 | - | 10, 11, 12, 13 | 1, 2, 4 |
| 4 | - | 9, 10, 11, 12 | 1, 2, 3 |
| 5 | 1 | 8, 9 | 6, 7 |
| 6 | 1 | 13, F1-F4 | 5, 7 |
| 7 | 1 | 13, F1-F4 | 5, 6 |
| 8 | 1, 2, 5 | 9 | - |
| 9 | 4, 8 | 10, 11, 12 | - |
| 10 | 3, 9 | 11, 12 | - |
| 11 | 10 | 12 | - |
| 12 | 11 | 13 | - |
| 13 | 6, 7, 12 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Shared catalog contract: unsorted and combo kinds, area, aliases, combos and custom documents, slot helpers
  Recommended task executor category: deep-low - shared Valibot contract plus pure helpers with invariant tests; decisions are fixed below.
  What to do:
  - In `packages/stage-shared/src/expression-performance/catalog.ts`:
    - Extend `ExpressionKindSchema` to `picklist(['face', 'effect', 'outfit', 'prop', 'system', 'unsorted', 'combo'])`. Leave `llmAllowedKinds` as `['face', 'effect', 'prop']`.
    - Add and export these schemas:
      - `ExpressionAreaSchema = picklist(['whole-look', 'eyes', 'mouth', 'cheeks', 'effects', 'outfit-hair', 'props', 'hidden'])`, with `ExpressionArea` as its type.
      - `ComboMemberSchema = strictObject({ expressionId: string(), strength: pipe(number(), finite(), minValue(0), maxValue(1)) })`.
      - `SlotNameSchema = picklist(['face', 'effect', 'prop'])`.
    - In `createCatalogEntrySchema`, add these optional fields. Each is `optional(...)` with no default, so stored documents and recorded traces without them still parse:
      - `area: optional(ExpressionAreaSchema)`
      - `members: optional(array(ComboMemberSchema))`
      - `slots: optional(array(SlotNameSchema))`
      - `aliases: optional(array(string()))`
      - `duplicateOf: optional(string())`
      - `labelSource: optional(picklist(['model', 'vtube', 'file', 'user']))`
    - Add `area: optional(ExpressionAreaSchema)` and `keepSeparate: optional(boolean())` to `CuratedOverrideSchema`.
    - Add two exported schemas.
      - `ComboDocumentSchema = strictObject({ id, label, members, mappings, exposedToLlm, area })`, where:
        - `id` is `pipe(string(), startsWith('combo:'))`;
        - `label` is a non-empty string;
        - `members` is `pipe(array(ComboMemberSchema), minLength(1))`;
        - `mappings` is `array(persistedPendingMappingSchema)`;
        - `exposedToLlm` is a boolean;
        - `area` is `optional(ExpressionAreaSchema)`.
      - `CustomExpressionDocumentSchema = strictObject({ id, label, kind, area, parameterId, delta, mappings, exposedToLlm })`, where:
        - `id` is `pipe(string(), startsWith('custom:'))`;
        - `label` is a non-empty string;
        - `kind` is `ExpressionKindSchema` with `combo` rejected (use a `check`);
        - `area` is `optional(ExpressionAreaSchema)`;
        - `parameterId` is a string;
        - `delta` is `pipe(number(), finite())`;
        - `mappings` is `array(persistedPendingMappingSchema)`;
        - `exposedToLlm` is a boolean.
    - `CuratedCatalogDocumentSchema` stays at `version: literal(1)`. Add `combos: optional(array(ComboDocumentSchema))` and `customs: optional(array(CustomExpressionDocumentSchema))`.
    - Change `isAutoEligible(entry)`. It returns false when `entry.duplicateOf !== undefined`. Otherwise it returns `entry.kind === 'face' || entry.kind === 'effect' || (entry.kind === 'combo' && (entry.slots?.length ?? 0) > 0 && !entry.slots!.includes('prop'))`.
    - Change `isLlmEligible(entry)`. It returns false when `duplicateOf` is set. Otherwise it returns `entry.exposedToLlm && (llmAllowedKinds.includes(entry.kind) || (entry.kind === 'combo' && (entry.slots?.length ?? 0) > 0))`.
    - Replace `mergeCatalog(derived, curated)` with `mergeCatalog(derived, curated, customEntries = [])`. It runs these steps in order:
      1. **Overrides.** Apply each override to its own id, as today.
      2. **Alias adoption.** An entry that has `aliases` and no override of its own adopts the whole override of its first alias, in `aliases` order, that has one. Overrides are never deleted.
      3. **Custom entries.** Append `customEntries` after the derived entries. These are entries the store builds from `curated.customs` with `customEntryFromDocument` (below).
      4. **Combos.** Append each `curated.combos` document as an entry:
         - Copy `label`, `mappings`, `exposedToLlm` and `members` from the document. Set `kind: 'combo'`, `group: null`, `confirmed: true`, `fileName: ''` and `labelSource: 'user'`.
         - `parameterIds` is the union of the members' `parameterIds`, in member order.
         - `area` is the document area when set. Otherwise it is the single shared area of the usable members, or `'whole-look'` when they span two or more areas.
         - `slots` is `entrySlots(...)` (see `combos.ts`).
         - Run mappings through `resolveMappings` as other entries do. For a combo, the minBand default is `'clear'`.
    - Export `customEntryFromDocument(document): CatalogEntry`, which sets `fileName: ''`, `parameterIds: [document.parameterId]`, `group: null`, `confirmed: true` and `labelSource: 'user'`.
  - Create `packages/stage-shared/src/expression-performance/combos.ts` and re-export it from `index.ts`. It exports these pure functions:
    - `resolveAlias(id, catalog)`: returns the primary id when `id` is some entry's alias; otherwise returns `id`.
    - `usableMembers(entry, catalog)`: returns `{ expressionId, strength }[]` in member order. Each member's `expressionId` is first resolved through `resolveAlias`. A member is dropped when:
      - its expression is unknown;
      - its expression is a combo;
      - its strength is 0;
      - its expressionId already appeared in the list.
    - `entrySlots(entry, catalog)`: returns `SlotName[]`.
      - A plain entry returns `[entry.kind]` when the kind is face, effect or prop, and `[]` otherwise.
      - For a combo, take the slot kinds of its usable members, de-duplicated, in face, effect, prop order. Return `[]` when it has no usable members, or when any usable member's kind is outfit, system or unsorted.
    - `expandEntry(entry, catalog)`: a plain entry returns `[{ expressionId: entry.id, strength: 1 }]`; a combo returns `usableMembers`.
    - `validateComboDocument(document, catalog)`: returns `{ success: true } | { success: false, error }`. It rejects:
      - a member id that starts with `combo:`;
      - duplicate member ids;
      - zero usable members.
  - Tests:
    - In `catalog.test.ts`:
      - A stored version-1 document without any new field parses (`version: 1, overrides: [...]` from the existing fixture).
      - Documents with `combos` and `customs` parse.
      - A combo document with `members: []` is rejected, and so is one whose member has strength 1.5.
      - A custom document with `kind: 'combo'` is rejected.
      - Eligibility table: `unsorted` is ineligible for both. A `combo` with slots `['face', 'effect']` is auto- and LLM-eligible when exposed. A `combo` with slots `['face', 'prop']` is LLM-eligible but not auto-eligible. A `combo` with slots `[]` is neither. Any entry with `duplicateOf` is neither.
      - `mergeCatalog`: alias adoption, own override wins, combos appended with computed `slots`/`area`/`parameterIds`, customs appended.
    - New `combos.test.ts`:
      - Alias resolution.
      - `usableMembers` drops unknown, combo, zero-strength and repeated members.
      - `entrySlots` covers these cases: face+effect gives `['face', 'effect']`; an outfit member gives `[]`; members in effect-then-face order still give face first.
      - `validateComboDocument` rejections.
    - The qa-tools fixture `packages/qa-tools/fixtures/forbooth-catalog.json` stays unchanged and must still parse. Prove it with `pnpm -F @proj-airi/qa-tools exec vitest run src/t3/expression-ids.test.ts`.
  - Must NOT do: bump any `version` literal; make a new field required; change `resolveMappings`, band logic or `llmAllowedKinds`.
  Closes: GAP-2, GAP-8 (eligibility), GAP-12, GAP-14 (schema part)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 5, 6, 7, 8, 9
  References:
  - `packages/stage-shared/src/expression-performance/catalog.ts:1-98` (whole file: schemas `:33-67`, `mergeCatalog` `:82-90`, eligibility `:92-98`).
  - `catalog.test.ts:1-100`, `index.ts:1-15`.
  - `trace.ts:11,33` (the trace embeds the entry schema, which is why fields must be optional).
  - `profile.ts:41` (`EffectiveCatalogEntrySchema`).
  - `packages/qa-tools/fixtures/forbooth-catalog.json`.
  - ADR `docs/ai/adr/2026-10-18-expression-performance.md:200-226`.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` exits 0 with the new cases listed.
  - `pnpm -F @proj-airi/stage-shared typecheck`, `pnpm -F @proj-airi/qa-tools typecheck`, `pnpm -F @proj-airi/stage-ui-live2d typecheck` and `pnpm -F @proj-airi/stage-ui typecheck` all exit 0.
  - `pnpm -F @proj-airi/qa-tools exec vitest run src/t3` exits 0.
  - `git grep -n "literal(2)" packages/stage-shared/src/expression-performance` returns nothing.
  QA scenarios:
  - Happy: the vitest output lists the version-1 stored-document case and the combo merge case passing. Evidence `.omo/evidence/expression-reactions-and-combos/task-1-expression-reactions-and-combos.txt`.
  - Failure: the empty-members and strength-1.5 rejection cases pass, meaning `safeParse` returns `success: false`. Same evidence file.
  Commit: Y | feat(stage-shared): add combo and unsorted expression kinds with area and alias fields

- [x] 2. Composer fractional target weights
  Recommended task executor category: deep-low - one renderer class with exact math below.
  What to do:
  - In `packages/stage-ui-live2d/src/composables/live2d/expression/compose.ts`:
    - Change `ExpressionInstance.targetWeight` to `number` in [0, 1].
    - Add `setTarget(id, target, now)`. A `target` outside [0, 1] or non-finite is clamped, and NaN becomes 0. An id with no definition is a no-op. The method runs these steps:
      1. **No change.** If an instance exists and `instance.targetWeight === target`, return. Re-targeting is idempotent and never restarts a fade.
      2. **Nothing to fade out.** If no instance exists and `target === 0`, return.
      3. **Start a fade.** Set `from = weightOf(id, now)`, `duration = target > from ? fadeDuration(def.fadeIn) : fadeDuration(def.fadeOut)` and `transitionAt = now`. Keep the existing `activationSequence`, or assign `this.sequence++` for a new instance.
    - Turn `activate(id, now)` into `setTarget(id, 1, now)` and `deactivate(id, now)` into `setTarget(id, 0, now)`.
    - Add `setTargets(targets: { id: string, weight: number }[], now)`. It first calls `setTarget(id, 0)` for every existing instance id not in `targets`. It then calls `setTarget` for each listed target, in list order, so new instances get increasing `activationSequence` in that order.
    - `weightOf` keeps the cosine formula `from + (target - from) * (1 - cos(pi*u)) / 2`. An instance retires only when `targetWeight === 0` and the weight is 0.
    - Keep `setActiveSet(ids, now)` as `setTargets(ids.map(id => ({ id, weight: 1 })), now)` until todo 8 removes its last caller.
    - Blend math in `compose` is unchanged.
  - Tests in `compose.test.ts`:
    - target 0.5 reaches 0.5 after the fade-in;
    - re-targeting 0.5 twice does not reset `transitionAt`;
    - 1 to 0.4 fades over fadeOut and is not retired;
    - 0.4 to 0 retires after fadeOut;
    - `setTargets` orders new instances by list order;
    - a reactivated fading instance keeps its sequence;
    - Add and Multiply at weight 0.5 produce half effects.
  - Must NOT do: change `restoreBases` or the `compose` blend formulas.
  Closes: GAP-6
  Parallelization: Wave 1 | Blocked by: - | Blocks: 8
  References: `compose.ts:1-160` (instances `:10-18`, activate/deactivate `:55-90`, weightOf `:93-102`, compose `:115-150`), `compose.test.ts:1-217`, `packages/qa-tools/src/t2/runner.ts:202-203` (another composer constructor, must still compile).
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables/live2d/expression` exits 0. `pnpm -F @proj-airi/stage-ui-live2d typecheck` and `pnpm -F @proj-airi/qa-tools typecheck` exit 0.
  QA scenarios: Happy: the fractional and idempotence cases pass. Failure: a mutation probe that changes the idempotence early-return to always restart makes the "does not reset transitionAt" case fail; record the failing output, then restore. Evidence `.omo/evidence/expression-reactions-and-combos/task-2-expression-reactions-and-combos.txt`.
  Commit: Y | feat(stage-ui-live2d): let the expression composer fade to fractional weights

- [x] 3. English strings for reactions, combos, areas, unsorted, duplicates and custom expressions
  Recommended task executor category: writing - one YAML file of user-facing copy, exact keys given.
  What to do:
  - In `packages/i18n/src/locales/en/settings.yaml`, add these keys under `settings.live2d.expressions` with exactly this English text:
    - `reactions.title`: "Reactions"
    - `reactions.description`: "What the character shows for each emotion. Select expressions and save them as a combo."
    - `reactions.empty`: "Nothing is mapped to this emotion yet."
    - `reactions.add`: "Add expression"
    - `reactions.remove`: "Remove {label} from {emotion}"
    - `reactions.preview`: "Preview {label}"
    - `reactions.select`: "Select {label}"
    - `reactions.make-combo`: "Make combo"
    - `reactions.make-combo-hint`: "Select expressions first."
    - `combos.title`: "Combos"
    - `combos.description`: "Expressions that turn on together. Emotions, the AI, saved defaults, and you can all turn a combo on."
    - `combos.empty`: "No combos yet. Make one from a reaction."
    - `combos.new`: "New combo"
    - `combos.default-label`: "{emotion} look"
    - `combos.members`: "Members"
    - `combos.add-member`: "Add member"
    - `combos.remove-member`: "Remove {label}"
    - `combos.strength`: "Strength"
    - `combos.strength-hint`: "Strength blends smoothly only for expressions that add to their parameters."
    - `combos.manual-only`: "Contains an outfit, system, or unsorted expression, so only you and saved defaults can turn it on."
    - `combos.save`: "Save combo"
    - `combos.cancel`: "Cancel"
    - `combos.delete`: "Delete combo"
    - `combos.delete-confirm`: "Delete {label}? Saved defaults that use it stop using it."
    - `areas.title`: "Everything else"
    - `areas.whole-look`: "Whole looks"
    - `areas.eyes`: "Eyes"
    - `areas.mouth`: "Mouth"
    - `areas.cheeks`: "Cheeks"
    - `areas.effects`: "Effects"
    - `areas.outfit-hair`: "Outfit & hair"
    - `areas.props`: "Props"
    - `areas.hidden`: "Hidden"
    - `areas.unsorted`: "Unsorted"
    - `areas.unsorted-description`: "The app couldn't tell what these are. They stay out of the AI's list and automatic picks until you give them a kind."
    - `fields.area`: "Area"
    - `duplicates.also`: "Also: {labels}"
    - `duplicates.keep-separate`: "Show {label} separately"
    - `custom.add`: "Add custom expression"
    - `custom.parameter`: "Switch"
    - `custom.value`: "Value"
    - `custom.label`: "Label"
    - `custom.create`: "Create"
    - `custom.none-free`: "This model has no free switches left."
    - `custom.delete`: "Delete custom expression"
    - `kinds.unsorted`: "Unsorted"
    - `kinds.combo`: "Combo"
    - `overridden-by`: "Hidden by {label} while it is active"
  - Change these existing values:
    - `fields.group` becomes "Choose one with".
    - `group-none` becomes "None".
    - `settings.live2d.performance.auto-expressions.description` becomes "Pick expressions from emotions without an explicit AI request."
  - Do not remove any key here; todo 13 removes keys that the final UI no longer uses.
  - Run `pnpm -F @proj-airi/i18n build`.
  Closes: GAP-7 (copy), GAP-15 (stale "confirmed")
  Parallelization: Wave 1 | Blocked by: - | Blocks: 10, 11, 12, 13
  References: `packages/i18n/src/locales/en/settings.yaml:285-374`, `packages/i18n/AGENTS.md`, `packages/i18n/package.json` (build script).
  Acceptance criteria:
  - `pnpm -F @proj-airi/i18n build` exits 0.
  - A node one-liner that loads the built English locale prints every new key with a non-empty value. Write it to `RUN_TMP` and run it with `pnpm exec tsx`.
  - `git diff --stat` lists only `packages/i18n/src/locales/en/settings.yaml`.
  QA scenarios: Happy: the key dump shows all new keys. Failure: the same script exits 1 when a listed key is missing (prove by temporarily querying a misspelled key). Evidence `.omo/evidence/expression-reactions-and-combos/task-3-expression-reactions-and-combos.txt`.
  Commit: Y | feat(i18n): add English copy for expression reactions, combos and areas

- [x] 4. Extract the Expressions section of the Live2D settings into its own component
  Recommended task executor category: unspecified-low - behavior-preserving extraction from one Vue file.
  What to do:
  - Move the Expressions section into a new `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d-expressions-section.vue`. That covers:
    - the computeds at `live2d.vue:92-164`: `expressionSettingsSnapshot`, `applyExpressionSettingsCommand`, `expressionGroups`, `expressionRows`, `expressionRowInUse`, `expressionRowKey`, search and show-all state;
    - its markup at `live2d.vue:968-1038`.
  - The new component's interface:
    - Props: `snapshot: Live2DExpressionSettingsSnapshot` and `enabled: boolean`.
    - Emit: `command(Live2DExpressionSettingsCommand)`.
  - `live2d.vue` keeps the Expression system checkbox and the remote-vs-local routing (`usesRemoteExpressionRuntime`, emit `live2dExpressionCommand` versus `expressionStore.applySettingsCommand`). It renders `<Live2dExpressionsSection>`.
  - Markup, classes and texts stay identical, and all existing tests pass unchanged.
  - The Emotion performance section stays in `live2d.vue`.
  Closes: none directly; enables GAP-1/GAP-7 work without a 1100-line file conflict.
  Parallelization: Wave 1 | Blocked by: - | Blocks: 9, 10, 11, 12
  References: `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:1-1105` (expressions logic `:92-164`, markup `:968-1038`), `live2d.browser.test.ts:1-386`, `.agents/skills/enforce-rules-for-unocss/SKILL.md`.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings` exits 0 with no test file changed. Prove it with `git diff --stat` listing only the two Vue files.
  - `pnpm -F @proj-airi/stage-ui typecheck` exits 0.
  QA scenarios: Happy: all model-settings browser tests pass. Failure: a deliberate break (the section emits no command) makes the "emits a command without changing the local store" test fail; record and restore. Evidence `.omo/evidence/expression-reactions-and-combos/task-4-expression-reactions-and-combos.txt`.
  Commit: Y | refactor(stage-ui): move the Live2D expressions section into its own component

- [x] 5. Derive unsorted, area, duplicates and detail weights from parameters and display names
  Recommended task executor category: deep-low - deterministic derivation rules with table tests over real rig data.
  What to do:
  - **Threading display names.**
    - `expression-controller.ts` `initialise(...)` gains a trailing `displayInfo?: unknown` and forwards it to `store.registerDefinitions(..., vtube, displayInfo)`.
    - `Model.vue:780-812` passes `(internalModel.settings as { _cdiData?: unknown })._cdiData`, the same access as `Model.vue:596`.
    - `registerDefinitions` currently derives before it reads the curated document (`expression-store.ts:85-99`). Reorder it: load and parse `expression-catalog:<modelId>` first, then derive. Hold the derive inputs (`defs`, `model3Refs`, `vtube`, `displayInfo`) in the store so a function `rederive()` can recompute `derived` with the current `keepSeparate` ids, meaning the ids whose curated override has `keepSeparate: true`. `registerDefinitions` calls `rederive()`. Todo 9 calls it again when `keepSeparate` changes.
  - **Display-name reader.** Add `packages/stage-ui-live2d/src/utils/expression-catalog/display-names.ts` exporting `readParameterDisplayNames(displayInfo: unknown): Map<string, string>`. It reads `Parameters[{ Id, Name }]` with string fields and ignores everything else.
  - **Area guess.** Add `packages/stage-ui-live2d/src/utils/expression-catalog/area.ts` exporting `suggestArea(...)` and `faceRegions(...)`.
    - **Token matching.**
      - ASCII tokens use the same word-boundary-plus-optional-`s` rule as `matchesToken` in `derive.ts:63-66`. Move `matchesToken` to a shared module-local helper and import it.
      - CJK tokens match by substring.
      - Parameter ids are split on camelCase and on non-alphanumerics, then lowercased.
    - **Region order.** Each written parameter (id plus display name) takes the first region that matches, in this order:
      - effects: `tear sweat heart star mark line shadow 汗 泪`
      - outfit-hair: `hair cloth hat mask 髪 发 口罩 面罩`
      - cheeks: `cheek blush tere 頬 腮 脸红 鼓脸 鼓腮`
      - mouth: `mouth lip tongue teeth jaw 口 嘴 舌 牙`
      - eyes: `eye eyeball brow pupil iris 目 眉 瞳 眼`
    - **Face regions.** Let F be the set of {eyes, mouth, cheeks} found across the written parameters. When none is found, match the label tokens instead.
    - **Area by kind.** system gives `hidden`, prop gives `props`, outfit gives `outfit-hair` and effect gives `effects`.
    - **Area for face and unsorted entries:**
      - two or more face regions give `whole-look`;
      - exactly one gives that region;
      - none, but the label matches an emotion token (the `emotionTokens` table in `derive.ts`), gives `whole-look`;
      - otherwise `hidden`.
  - **Kind fallback.** In `deriveCatalog`, when `suggestKind` returns `face` and F is empty and the label matches no emotion token, set kind to `unsorted`. Unsorted entries get `exposedToLlm: false`, `mappings: []` and area `hidden`.
  - **Detail weight.** In `suggestMappings`, face entries whose area is eyes, mouth or cheeks get weight 0.5. Whole-look faces stay 1, and effects are unchanged. Pass `area` into `suggestMappings`, or apply the weight after it.
  - **labelSource.** Record the label source: model3 Name gives `model`, a VTube hotkey gives `vtube`, and the file base name gives `file`.
  - **Duplicates.** Add `packages/stage-ui-live2d/src/utils/expression-catalog/dedupe.ts`.
    - **Signature.** The sorted list of effective writes `(paramId, blend, value)`: Add with value ≠ 0, Multiply with value ≠ 1, and Overwrite always. Values compare exactly, fades are ignored, and an empty signature never merges.
    - **Primary.** The entry with the smallest key `(kind === 'system' ? 0 : 1, isGenericLabel ? 1 : 0, labelSourceRank model 0 / vtube 1 / file 2, referencedByModel3 ? 0 : 1, id code-point order)`. `isGenericLabel` matches `/^(?:exp|expr|expression|face|f|表情)?[\s_.-]*\d+$/i`.
    - **The primary** gets `aliases`, the other ids in key order.
    - **Each other member** gets `duplicateOf: primaryId`, plus `exposedToLlm: false`, `mappings: []`, `group: null` and `area: 'hidden'`.
    - **keepSeparate.** Ids listed in it are excluded from merging.
    - **Grouping.** Run duplicate detection BEFORE `suggestGroups`, and pass only non-duplicate entries to `suggestGroups`. Duplicates get `group: null`.
  - Tests in `derive.test.ts` plus new `area.test.ts` and `dedupe.test.ts`, as table cases built from these ForBOOTH and Bear facts:

    | Label | Writes | Expected |
    | --- | --- | --- |
    | `expression19` | `Param82` (display `口罩`) | kind `unsorted`, not exposed (`口罩` matches outfit-hair first, which is not a face region) |
    | `Bowtie` | `换领结` | unsorted |
    | `Bloodstain` | `血迹` | unsorted |
    | `Angry` | `Param60` `生气按键` | face, whole-look, angry weight 1 |
    | `Puff Cheeks` | `cheekpuff` `鼓脸` | face, cheeks, angry weight 0.5 |
    | `Hearts 1` | `心心眼` | face, eyes |
    | `Flat Mouth` | `贱兮兮` | mouth, from the label |
    | `Drum mouth` | `[Drum mouth]鼓嘴→` | mouth (`鼓嘴` matches mouth via `嘴`; cheeks only matches `鼓脸`/`鼓腮`) |

    Duplicate cases:
    - `鼓脸` and `Puff Cheeks` merge, both writing cheekpuff=1.
    - `expression58` and `Tear Mouth Cancel` merge, primary `Tear Mouth Cancel`.
    - `expression70`, `初始状态` and `Watermark (Edit Key)` merge, primary the system entry.
    - `expression22` (Param85=1) and `Blush` (Param85=0.7029...) do NOT merge.
    - `keepSeparate` keeps an id unmerged.
    - Duplicates do not form a group.
  - **Real rig script.** Add a QA script under `RUN_TMP`. It reads both rig folders read-only, parses every `.exp3.json` with `parseExp3Expression`, `*.vtube.json` and `*.cdi3.json`, runs `deriveCatalog`, and writes the full table (label, kind, area, mappings, duplicateOf/aliases, exposedToLlm) as JSON to the evidence path.
  Must NOT do: change `suggestKind`'s token tables; change `llmAllowedKinds`; delete any curated override.
  Closes: GAP-7 (area), GAP-8, GAP-9, GAP-10
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 8, 9
  References:
  - `packages/stage-ui-live2d/src/utils/expression-catalog/derive.ts:1-155` (suggestKind `:24-45`, emotion tokens and `matchesToken` `:47-74`, `suggestGroups` `:77-124`, `deriveCatalog` `:127-155`), `derive.test.ts:1-145`.
  - `expression-controller.ts:27-77`, `Model.vue:596,780-812`, `expression-store.ts:82-119`.
  - `natural-motion/rig-profile.ts:22-53` (existing displayInfo reading pattern).
  - Rig facts: draft findings in `.omo/drafts/expression-reactions-and-combos.md`.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/utils/expression-catalog src/composables/live2d/expression-controller.test.ts src/stores` exits 0, and `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0.
  - In the rig script JSON:
    - ForBOOTH `expression19`, `expression20`, `Bowtie` and `Bloodstain` have kind `unsorted` and `exposedToLlm: false`.
    - `Puff Cheeks` and `鼓脸` resolve to one primary that holds the other in `aliases`.
    - Bear `Black braids`, `White hair` and `White hair braids` still share one group, and `White ponytail` (identical effective writes to `White hair`) is that primary's alias. (Amended during execution; the duplicate rule applies.)
  QA scenarios:
  - Happy: the rig script prints the asserted rows. Evidence `.omo/evidence/expression-reactions-and-combos/task-5-expression-reactions-and-combos.json`.
  - Failure: the Blush and expression22 non-merge case passes, and a mutation with epsilon 0.5 makes it fail. Record the failure in `task-5-expression-reactions-and-combos.txt`, then restore.
  Commit: Y | feat(stage-ui-live2d): derive unsorted, area and duplicate expressions from parameters

- [x] 6. Decider: combos occupy every slot they span
  Recommended task executor category: deep-low - pure decider logic with replay invariants, exact rules below.
  What to do (in `packages/stage-shared/src/expression-performance/`):
  - `selection.ts`:
    - **Explicit commands.** `explicitExpressionCommand(signal, ctx)` returns `(SlotCommand & { expressionId: string })[] | null`.
      - A plain face, effect or prop entry returns one command, as today.
      - A combo returns one command per `entrySlots(entry, ctx.catalog)` slot, in face, effect, prop order, all with the same `expressionId`, `holdSeconds`, `until` and `turnId`.
      - Return `null` for empty slots or an unknown id.
      - Update `explicitExpressionReaction`, which takes the first command, and every caller.
    - **Candidates.** `pickerCandidates(catalog, episode, slot, occupants)` accepts a plain entry when `kind === slot`. It accepts a combo when `entrySlots[0] === slot` and every slot in `entrySlots` that the decider tracks (face, effect) has a null occupant.
    - **autoPicks.** After a combo pick, mark every spanned tracked slot occupied for the rest of the episode, so no effect pick follows a face+effect combo. Ticket draws stay unchanged: `drawEpisodeTickets` still draws per slot, unconditionally.
  - `picker.ts` and `planner.ts`:
    - **Occupants.** An occupant records the combo id in every spanned tracked slot.
    - **Vacate rule.** Before writing slot X, or on `clear` or `neutral` of X, every tracked occupant equal to the id previously in X becomes null. A command or clear for `prop` also vacates any tracked occupant whose entry's `entrySlots` includes `prop`.
    - **Planner arbitration.** Arbitration marks all of a pick's slots as arbitrated, and a pending plan whose slots intersect them is dropped. `withoutSlots` filters on intersection.
    - **Budget.** `admit` counts a pick spanning n slots as n changes: it requires `changes.length + n <= windowMax` and appends `at` n times.
    - **Plan slots.** A planned pick's slots are computed from the catalog at emit time. The trace format does not change.
  - `trace.ts`: no version change. Existing trace tests must pass unchanged.
  - Tests (`picker.test.ts`, `planner.test.ts`, `trace.test.ts`, `holds.test.ts` as needed):
    - an explicit face+effect combo emits two commands in face, effect order and records both occupants;
    - `autoPicks` never picks a combo whose spanned slot is occupied, or one that spans prop;
    - after a face+effect combo pick, no effect pick happens in that episode;
    - replacing face, held by a face+effect combo, nulls the effect occupant;
    - a prop clear vacates a face+prop combo's face occupant;
    - the planner drops a plan intersecting an emitted combo pick;
    - a spanning pick consumes n budget entries;
    - ticket streams advance identically with or without a combo in the catalog: compare `state.streams` after the same signal sequence;
    - an exact replay of a trace containing a combo reproduces the live decisions;
    - every existing trace fixture still parses and replays.
  Must NOT do: change `drawPickerTickets`/`drawEpisodeTickets`; change the `SlotCommand` shape; bump the trace version.
  Closes: GAP-5, GAP-14 (decider part)
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 13, F1-F4
  References:
  - `selection.ts:1-140` (tickets `:25-43`, candidates `:45-56`, autoPicks `:80-97`, explicit `:104-116`, reaction `:150+`).
  - `picker.ts:1-80` (occupants `:13-32`, signal handling `:34-76`).
  - `planner.ts:1-190` (state `:19-37`, release/arbitration `:49-53,93-129`, admit `:146-184`).
  - `trace.ts:62-127`, `types.ts:41-48`.
  - ADR `2026-10-18-expression-performance.md:250-330`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` exits 0, and `pnpm -F @proj-airi/stage-shared typecheck` and `pnpm -F @proj-airi/stage-ui typecheck` exit 0. `pnpm -F @proj-airi/qa-tools exec vitest run src/motion` exits 0, because qa-tools runs the decider.
  QA scenarios: Happy: the span and replay cases pass. Failure: a mutation that skips the vacate rule makes "replacing face nulls the effect occupant" fail; record and restore. Evidence `.omo/evidence/expression-reactions-and-combos/task-6-expression-reactions-and-combos.txt`.
  Commit: Y | feat(stage-shared): let expression combos occupy every slot they span

- [x] 7. AI surface and QA tools understand combos, unsorted and duplicate entries
  Recommended task executor category: unspecified-low - small edits in the conductor, prompt, tool and qa-tools mapping.
  What to do:
  - In `packages/stage-ui/src/composables/use-airi-runtime-prompt.ts:9-22`, exposed labels are grouped by kind in face, effect, prop order. Add a fourth group for `combo`, placed after prop, using the same formatting as the existing groups. Read the file for how the group headings are produced, and add the combo heading in the same place and style. Unsorted and duplicate entries never appear, because `isLlmEligible` excludes them.
  - In `packages/stage-ui/src/features/performance/runtime-state.ts:7`, keep `ExposedExpressionKind = SlotCommand['slot']`; it still types `expressionSlots` and `clear(slot?)` in `tools/expression.ts:12,37`, so `clear('combo')` stays a type error. Add `ExposedExpressionGroup = ExposedExpressionKind | 'combo'` and use it as the type of the exposed expression's `kind` field.
  - In `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts:45,59-65,580-590`:
    - `toExposedExpressions` keeps a combo when `entry.slots` is non-empty and reports its `kind` as `'combo'`. It still skips entries without a slot.
    - The tool port's `active` for a combo is true when any lease in `entry.slots` holds the combo id (today `:585` reads `performer.leases[kind]`, which has no `combo` key).
    - Label resolution at `:224-239` already works for combo entries.
  - `use-airi-runtime-prompt.ts:10`: `EXPRESSION_KINDS` gains `'combo'` after `'prop'`.
  - In `packages/stage-ui/src/tools/expression.ts`, update the `set_expression` description to say that names may be combos that show several expressions together. Keep the enum derived from the exposed labels.
  - In `packages/qa-tools/src/t3/expression-ids.ts:14-21`, leave an entry with an empty `fileName` (combo or custom) unmapped. Add a test case.
  - Tests:
    - `use-airi-runtime-prompt.test.ts`: a combo appears under its group; an unsorted entry and a duplicate entry do not appear.
    - `use-stage-performance-conductor.test.ts`: an exposed combo label resolves, and the `expression` signal carries the combo id. An unexposed or duplicate label returns `success: false` with `available`.
    - `tools/expression.test.ts`: enum cases.
  Must NOT do: list unsorted, outfit, system or duplicate labels to the AI; add new tools.
  Closes: GAP-8 (AI side), GAP-14 (qa-tools part)
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 13, F1-F4
  References: `packages/stage-ui/src/features/performance/runtime-state.ts:1-20`, `use-airi-runtime-prompt.ts:1-80`, `use-airi-runtime-prompt.test.ts:1-148`, `use-stage-performance-conductor.ts:40-70,220-240,575-600`, `use-stage-performance-conductor.test.ts:1-895`, `tools/expression.ts:1-94`, `tools/expression.test.ts:1-130`, `packages/qa-tools/src/t3/expression-ids.ts:1-25`, `expression-ids.test.ts:1-31`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables src/tools` exits 0. `pnpm -F @proj-airi/qa-tools exec vitest run src/t3` exits 0. `pnpm -F @proj-airi/stage-ui typecheck` and `pnpm -F @proj-airi/qa-tools typecheck` exit 0.
  QA scenarios: Happy: the prompt text in the test output contains the combo group and lacks `expression19`. Failure: a mutation that drops the `duplicateOf` check in `isLlmEligible` makes the duplicate-absent case fail; record and restore. Evidence `.omo/evidence/expression-reactions-and-combos/task-7-expression-reactions-and-combos.txt`.
  Commit: Y | feat(stage-ui): expose expression combos to the AI and hide unsorted entries

- [x] 8. Store claims engine: desired set, override then restore, spanning leases
  Recommended task executor category: deep-low - stateful renderer store rewrite against the exact rules below; tests enumerate the invariants.
  What to do (in `packages/stage-ui-live2d/src/stores/expression-store.ts` and `expression-slot-leases.ts`; the rules are normative):
  - **Claims.**
    - The base layer (layer 0) is `manualActive`, ordered by claim sequence and seeded from the rest set by `resetAll`. The slot layer (layer 1) is the distinct `expressionId`s of non-null leases.
    - Keep a store counter `claimSeq`. It increments on every manual claim, every reassert and every new lease.
    - Store each base claim's seq in a parallel `manualSeq: Record<string, number>`.
    - Add `claimSequence: number` to `SlotLease` and `createLease` in `packages/stage-ui-live2d/src/composables/live2d/expression/slots.ts`. That is the only `slots.ts` change; `leaseReleaseAt`, `isLeaseExpired` and `applySpeechEvent` stay unchanged.
    - Remove `slotActive`. Derive slot claims from `leases`. Update every consumer in this same commit:
      - `packages/qa-tools/src/t2/runner.ts:202-216` builds its own `slotActive` and passes it to `createSlotLeases`; move it to the new context shape.
      - `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.test.ts:254` and `packages/stage-ui/src/tools/expression.test.ts:101` assert `store.slotActive`; replace them with `store.leases.<slot>?.expressionId` checks.
    - `ownersOf(id)` becomes `{ rest, manual, slot }`, computed from these claims, with `slot` true when any lease holds `id`.
  - **resolve(claims, catalog) -> { targets: { id, weight }[], masked: Map<memberId, triggerId>, effective: Set<id>, via: Map<memberId, comboId[]> }**. A pure function.
    1. Sort claims by layer descending, then seq descending.
    2. Walk the claims in that order. For each claim, walk `expandEntry(entry, catalog)`, members in member order. Let `g` be the member's `group`.
       - If `g` is non-null and `holder[g]` is set to a different id, record `masked[member] = holder claim` and skip the member.
       - Otherwise set `holder[g] = member` (when `g` is non-null) and `weight[member] = max(weight[member] ?? 0, strength)`.
    3. Build the output order by walking claims from lowest to highest precedence, members in member order. Each accepted id appears once, at its first occurrence.
    4. Return the targets in that order.
  - **reconcile(now).** Calls `resolve`, then `composer.setTargets(targets, now)`. Every mutation calls `reconcile`: toggle, set-active, applySlots, lease release or expiry, onSpeech, resetAll, saveDefaults, update-entry, and the combo and custom edits added in todo 9. Nothing else calls `composer.activate`, `composer.deactivate` or `composer.setActiveSet`. Delete `setActiveSet` from `compose.ts` once it has no caller.
  - **Slot admission** in `activateFromSlot(slot, command)`. Resolve the entry with `resolveAlias`.
    - **Combo.** Admitted when `entrySlots(entry).includes(slot)`. It masks conflicting base members and never removes them.
    - **Plain entry.** Admitted when its kind equals `slot`. It is refused, keeping today's protection from ADR line 232, when any member of any base claim, masked or not, shares its group with a different id, or when such a group-mate has a different kind. A refusal leaves the previous lease untouched.
    - **Plain-vs-slot conflicts.** Today's behavior holds: a plain slot activation that displaces only slot-owned group-mates releases those leases.
  - **Spanning leases.**
    - Every command of one trigger creates an identical lease (same `now`, fields and `claimSequence`) in its slot.
    - `releaseSlot(slot)` nulls every slot whose lease has the same `expressionId`. Replace, clear, neutral, `tickLeases` expiry and `onSpeech` release all go through it, so a spanning combo releases atomically.
    - A refresh with the same id rebuilds the lease in that slot only.
  - **Manual switch** (`set-active`, and `toggle(id)`, which becomes `set-active` with `active: !hasOwnBaseClaim(id)`). The switch state is "has its own base claim", whether or not that claim is masked.
    - **`active: false`:** remove the entry's own base claim, even while it is masked (decision: clicking a row marked "Hidden by X while it is active" turns that entry off, so it does not come back when X ends). If it is a rest id, add it to `restSuppressed`.
    - **`active: true` on an entry without a claim:** add a base claim with a new seq. If a slot claim would immediately mask it, release that slot claim first, so a user click is never invisible.
    - **Plain activation removes plain peers.** A manual plain activation removes plain base claims in the same group, suppressing rest ids, as today. It never removes a base combo; it only masks that combo's conflicting member.
    - **Combo activation removes nothing.** It masks lower-seq base members.
    - `set-active` with `active: false` removes only the entry's own base claim.
  - **saveDefaults.** Writes `restSet = base claims in seq order`, including combo ids and masked entries, and excluding slot claims. It clears `restSuppressed`.
  - **Rest-set load** (`expression-store.ts:103-111`). Keep ids present in the merged catalog after `resolveAlias`, which includes combo ids, instead of only definition ids.
  - **resetAll.** Reproduces the same targets and order after a save.
  - **Snapshot.** The snapshot entry additionally carries:
    - `effective: boolean`;
    - `overriddenBy: string | null`, the label of the masking trigger;
    - `via: string[]`, the combo ids through which the entry is effective;
    - `isDefault: boolean`, set when the id is in `restSet`.
    - `active` keeps its meaning: it has a base or slot claim.
  - Tests in `expression-store.test.ts`. Cover the ultrabrain invariants as individual cases, one per bullet:
    - `resolve` is pure, and reconcile is idempotent: a second reconcile restarts no fade.
    - Combo ids never reach the composer.
    - Members shared at 0.4 and 0.7 target 0.7, then fade to 0.4 when the 0.7 owner releases.
    - A slot combo masking a rest member restores it on release. A manual combo masking a rest member restores it when toggled off, and `restSuppressed` is unchanged.
    - A plain manual toggle removes plain peers and suppresses a rest peer. A plain manual toggle masks only the conflicting member of a base combo.
    - A plain slot command conflicting with a base member is refused and keeps the previous lease. A combo slot command conflicting with base is admitted and masks.
    - The later claim wins within a layer, and the earlier member wins inside one combo.
    - Newer claims get a higher `activationSequence`.
    - Switching off an entry masked by a combo removes its claim, and it stays off after the combo releases.
    - Switching on an entry that a slot combo would mask releases that slot claim first, and the entry is effective.
    - Toggling on a combo-only member adds a base claim that survives the combo's release.
    - Save excludes slot combos and keeps masked base entries. Save followed by reset reproduces the targets.
    - A face+effect combo creates two identical leases. Release, replace or clear of either slot nulls both. `clip-stopped` and hold expiry release both in one call. Neutral on a face+prop combo releases its prop.
    - A rest set containing a combo id survives `registerDefinitions`.
    - Existing store tests that encode today's rules (`expression-store.test.ts:1-401`) are updated only where the claims model deliberately changes them. Note each such change in the evidence file.
  - `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts:161-167` keeps using `toggle` (`:166`); it must still pass its tests.
  Must NOT do: persist claims or masks; add a decider feedback path; change lease timing math in `slots.ts`.
  Closes: GAP-3, GAP-4, GAP-6 (store part)
  Parallelization: Wave 3 | Blocked by: 1, 2, 5 | Blocks: 9
  References:
  - `expression-store.ts:1-208` (ownership `:36-68`, activate/deactivate `:122-144`, save/reset `:153-174`, snapshot `:72-81`).
  - `expression-slot-leases.ts:1-133` (admission `:29-52`, applySlots `:65-92`, tick/speech `:94-120`, release `:54-63`).
  - `composables/live2d/expression/slots.ts:1-80` (`SlotLease`, `createLease`), `compose.ts` (after todo 2), `expression-store.test.ts:1-401`, `expression-controller.test.ts:1-222`.
  - `slotActive` consumers: `packages/qa-tools/src/t2/runner.ts:202-216`, `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.test.ts:254`, `packages/stage-ui/src/tools/expression.test.ts:101`.
  - ADR `2026-10-18-expression-performance.md:229-232,262-280`.
  - `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts:150-165`, `Model.vue:1507-1514`.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/stores src/composables/live2d` exits 0.
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance src/tools` exits 0.
  - `pnpm -F @proj-airi/qa-tools exec vitest run src/t2` exits 0.
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck`, `pnpm -F @proj-airi/stage-ui typecheck` and `pnpm -F @proj-airi/qa-tools typecheck` exit 0.
  - `git grep -n "composer\.\(activate\|deactivate\|setActiveSet\)" packages/stage-ui-live2d/src/stores` returns nothing.
  QA scenarios: Happy: the invariant cases pass. Failure: two mutation probes, each recorded and restored:
  - Restore by deletion: drop masked rest members from `manualActive`. The "slot combo restores rest member" case must fail.
  - Sum instead of max: the 0.4/0.7 case must fail.
  Evidence `.omo/evidence/expression-reactions-and-combos/task-8-expression-reactions-and-combos.txt`.
  Commit: Y | feat(stage-ui-live2d): resolve expression combos through masked claims that restore on release

- [x] 9. Persist combos and custom expressions, add the commands, and rename the snapshot entries
  Recommended task executor category: deep-low - persistence plus a same-build cross-window contract change across two apps.
  What to do:
  - In `packages/stage-ui-live2d/src/stores/expression-catalog-persistence.ts`, add six functions: `createCombo(input)`, `updateCombo(id, patch)`, `deleteCombo(id)`, `createCustom(input)`, `updateCustom(id, patch)` and `deleteCustom(id)`. Each one validates and writes the `combos` / `customs` arrays of the same `expression-catalog:<modelId>` document, still version 1.
    - New ids are `combo:${crypto.randomUUID()}` and `custom:${crypto.randomUUID()}`.
    - `createCombo` and `updateCombo` call `validateComboDocument` against the merged catalog. They canonicalize member ids through `resolveAlias`.
    - A combo created from Reactions gets the mapping `{ emotion, weight: 1, minBand: 'clear' }`.
    - The default `exposedToLlm` is true when `entrySlots` is non-empty, and false otherwise.
    - `deleteCombo` removes the combo, its claims and leases, and its id from the persisted rest set. The masked members restore through `reconcile`.
    - `deleteCustom` also removes the custom id from every combo's members, and deletes a combo left with zero members.
  - **Custom definitions.**
    - `registerDefinitions(id, defs, refs, vtube, displayInfo, parameterIds, freeParameters)` turns each `curated.customs` document into an `ExpressionDefinition`. `parameterIds` is the full `coreModel.getModel().parameters.ids` list (read as at `Model.vue:596`), and custom validation checks against it; `freeParameters` only feeds the snapshot: `{ id, name: label, parameters: [{ id: parameterId, value: delta, blend: 'Add' }] }`, with no fades, so `slots.defaultFadeSeconds` applies.
    - It then calls `composer.define([...exp3Defs, ...customDefs])` and passes `customEntryFromDocument` results to `mergeCatalog`.
    - A custom document whose `parameterId` is not in the model's parameter table is skipped with `console.warn`.
  - **Free parameters.**
    - New pure helper `packages/stage-ui-live2d/src/utils/expression-catalog/free-parameters.ts`: `findFreeParameters({ parameters, exp3Definitions, drivenIds, displayNames })`. It returns `{ id, name, min, max, default }[]` for parameters that meet all of these conditions:
      - no exp3 definition writes them;
      - they are not in `drivenIds`;
      - `min !== max`.
    - `parameters` is `{ ids, minimumValues, maximumValues, defaultValues }` from `coreModel.getModel().parameters`.
    - `drivenIds` is the union of three sets:
      - every rig-profile channel id (`readLive2DRigProfile(...).channels`, `rig-profile.ts:69-97`);
      - every physics output destination id from `internalModel.physics?._physicsRig`, read the same way as `Model.vue:596`;
      - the manual-control parameter ids written at `Model.vue:710-730` (`ParamAngleX/Y/Z`, eye open and smile, brows, `ParamMouthOpenY`, `ParamMouthForm`, `ParamCheek`, body angles, `ParamBreath`). Hoist them into an exported constant next to their writer.
    - `Model.vue` computes the list and passes it through `expression-controller.initialise`, as it does `displayInfo`.
    - The `create-custom` command takes `{ label, parameterId, target }`, with `target` clamped to [min, max]. It stores `delta = target - default`, `kind: suggestKind(label, '') === 'face' ? 'unsorted' : suggestKind(label, '')` and `mappings: []`. `exposedToLlm` is true when the kind is face, effect or prop.
  - **Commands.** Extend `Live2DExpressionSettingsCommand` with:
    - `{ type: 'create-combo', combo: { label, members, mappings?, emotion? } }`
    - `{ type: 'update-combo', id, patch: { label?, members?, mappings?, exposedToLlm?, area? } }`
    - `{ type: 'delete-combo', id }`
    - `{ type: 'create-custom', custom: { label, parameterId, target } }`
    - `{ type: 'update-custom', id, patch: { label?, kind?, area?, mappings?, exposedToLlm?, target? } }`
    - `{ type: 'delete-custom', id }`

    `update-entry` on a `combo:` or `custom:` id is ignored with `console.warn`. Changing `keepSeparate` re-derives the catalog in place, with the same model and definitions.
  - **Snapshot rename.**
    - Rename `Live2DExpressionSettingsSnapshot.groups` to `entries`.
    - Add `freeParameters` and `usesOverwrite: boolean` per entry, which is true when any parameter of its definition (or of a usable member) blends with `Overwrite`.
    - Update every consumer:
      - `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d-expressions-section.vue`, `live2d-expression-entry.vue`, `live2d-expression-group-row.vue` (the `['groups'][number]` types) and `runtime.ts`;
      - `live2d.browser.test.ts` and `live2d-expression-group-row.browser.test.ts` fixtures;
      - `apps/stage-tamagotchi/src/renderer/composables/model-settings-runtime.browser.test.ts`;
      - `apps/stage-tamagotchi-kirie/src-web/src/renderer/composables/model-settings-runtime.browser.test.ts`;
      - any other `live2dExpressions?.groups` use: `git grep -n "live2dExpressions" apps packages`.
  - Tests:
    - In the store tests:
      - the combo create, update and delete round-trip persists to `expression-catalog:<modelId>` and survives `registerDefinitions`;
      - a stored document with only `overrides` still loads;
      - deleting an active combo restores its masked members;
      - a custom definition composes `Add delta`;
      - `update-custom { mappings }` changes the custom entry's mappings in the merged catalog, persists them in the document's `customs` array, and they survive `registerDefinitions`; `update-entry` on the same `custom:` id changes nothing;
      - a custom expression on a non-free id is still applied when the document is valid. Free filtering is a UI offer, not enforcement, and the case documents this.
    - `free-parameters.test.ts`: excludes exp3-written, channel, physics-output and manual-control ids, and `min === max`.
    - In the Electron and Kirie runtime tests: a `create-combo` command round-trips through Eventa and the refreshed snapshot `entries` contains the combo.
  Must NOT do: add a new localStorage key; bump the document version; move the snapshot types to another package.
  Closes: GAP-2 (persistence), GAP-11, GAP-13
  Parallelization: Wave 4 | Blocked by: 4, 8 | Blocks: 10, 11, 12
  References:
  - `expression-catalog-persistence.ts:1-41`, `expression-store.ts` (after todo 8), `expression-controller.ts:27-96`, `Model.vue:596,710-730,780-812`, `natural-motion/rig-profile.ts:69-153`.
  - `apps/stage-tamagotchi/src/shared/model-settings-runtime.ts:25-31`, `apps/stage-tamagotchi/src/renderer/composables/model-settings-runtime-{owner,snapshot}.ts`, `apps/stage-tamagotchi/src/renderer/pages/index.vue:218-227`, `apps/stage-tamagotchi/src/renderer/pages/settings/models/index.vue:64,384-390`.
  - Kirie mirrors: `apps/stage-tamagotchi-kirie/src-web/src/shared/model-settings-runtime.ts:1-30`, `.../renderer/composables/model-settings-runtime-owner.ts:48`, `-snapshot.ts:31-37`, `.../renderer/pages/index.vue:145`.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src` exits 0.
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings` exits 0.
  - `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project browser src/renderer/composables/model-settings-runtime.browser.test.ts` exits 0.
  - `pnpm -F @proj-airi/stage-tamagotchi-kirie exec vitest run --project browser src-web/src/renderer/composables/model-settings-runtime.browser.test.ts` exits 0. The Kirie package root is `apps/stage-tamagotchi-kirie/`, and its `vitest.config.ts` `browser` project includes this file.
  - Typechecks for stage-ui-live2d, stage-ui, stage-tamagotchi and stage-tamagotchi-kirie exit 0.
  - `git grep -n "live2dExpressions?.groups\|\.groups\b" packages/stage-ui/src/components/scenarios/settings/model-settings apps/stage-tamagotchi/src apps/stage-tamagotchi-kirie/src-web/src` shows no snapshot `.groups` use.
  QA scenarios: Happy: the Eventa round-trip cases pass in both apps. Failure: a mutation that drops `combos` in `parseCuratedCatalogDocument` makes the persistence round-trip fail; record and restore. Evidence `.omo/evidence/expression-reactions-and-combos/task-9-expression-reactions-and-combos.txt`.
  Commit: Y | feat(stage-ui-live2d): persist expression combos and custom switches across settings windows

- [x] 10. Shared trigger editor and the Combos section
  Recommended task executor category: visual-engineering - new settings UI with rendered checks at desktop and mobile widths.
  What to do (under `packages/stage-ui/src/components/scenarios/settings/model-settings/`):
  - **Shared trigger editor.** Extract the emotion-mapping editor and the "Let the AI use it" control from `live2d-expression-entry.vue` into `live2d-expression-trigger-editor.vue`.
    - Props: `mappings`, `exposedToLlm`, `canExposeToLlm`, `defaultMinBand`.
    - Emits: `update:mappings` and `update:exposedToLlm`.
    - The existing weight validation (0.1-5) moves with it.
    - `live2d-expression-entry.vue` uses it, and its behavior and tests stay unchanged.
  - **Combos section.** New `live2d-expression-combos.vue`, rendered in `live2d-expressions-section.vue` after the existing rows for now. Todo 12 moves it below Reactions.
    - **Cards.** One card per combo entry, reusing the bordered rounded style of the entry rows. A card shows:
      - the label;
      - member chips: the member label plus a percentage when strength is below 1;
      - a mapped-emotions line;
      - an "AI" marker when `exposedToLlm` and `slots` is non-empty;
      - a "Default" marker when `isDefault`;
      - the `combos.manual-only` note when `slots` is empty;
      - an on/off Checkbox that sends `set-active`;
      - an Edit button.
    - **Empty state.** `combos.empty`.
    - **New combo.** A `combos.new` button opens the editor with no members.
  - **Combo editor.** New `live2d-expression-combo-editor.vue`, inline under its card, or at the section top for a new combo.
    - Label input, required.
    - Members list in member order. Each member has a `FieldRange` strength from 0 to 1, step 0.05, defaulting to 1. When the member entry has `usesOverwrite`, the `combos.strength-hint` is shown under its slider. Each member has a remove button.
    - "Add member" opens a `FieldCombobox` of entries that are neither combos nor duplicates nor already members, with label search.
    - Area select.
    - The shared trigger editor.
    - Save sends `create-combo` or `update-combo`, and Cancel discards.
    - Delete asks `combos.delete-confirm`, then sends `delete-combo`.
    - Props let todo 12 open it prefilled: `initialMembers` and `initialEmotion`. `initialEmotion` adds the mapping `{ emotion, weight: 1, minBand: 'clear' }` and the label `combos.default-label`.
  - Use `@proj-airi/ui` `Button`, `Checkbox`, `Input`, `FieldRange`, `FieldCombobox` and `Select`, plus UnoCSS class arrays, per `.agents/skills/enforce-rules-for-unocss/SKILL.md`. No new `packages/ui` component.
  - **Browser tests.** New `live2d-expression-combos.browser.test.ts`:
    - a card renders members and markers;
    - the toggle emits `set-active`;
    - the editor saves `create-combo` with members and strengths;
    - delete confirms;
    - the manual-only note shows for an outfit member;
    - the Overwrite hint shows only for `usesOverwrite`;
    - the "Add member" list excludes duplicates and combos.

    Keep `live2d.browser.test.ts` green.
  Closes: GAP-2 (UI), GAP-6 (UI)
  Parallelization: Wave 5 | Blocked by: 3, 9 | Blocks: 11, 12
  References: `live2d-expression-entry.vue:1-270` (editor `:33-170,198-267`), `live2d-expressions-section.vue` (todo 4), `live2d.browser.test.ts:35-102` (mount pattern), `docs/assets/ai/context/ui-components.md:64-96,168-203,317-330,410-430,481-501,567-580`, `DESIGN.md:20-195`.
  Acceptance criteria:
  - `pnpm -F @proj-airi/i18n build` runs first.
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings` exits 0.
  - `pnpm -F @proj-airi/stage-ui typecheck` exits 0.
  QA scenarios: Happy: a Vishot or browser-test screenshot of the Combos section with two combos, one manual-only, at desktop (1280px) and mobile (390px) widths, light and dark: `.omo/evidence/expression-reactions-and-combos/task-10-*.png`. Failure: the editor's Save is disabled with an empty label (test case), and the test output shows it. Evidence `task-10-expression-reactions-and-combos.txt`.
  Commit: Y | feat(stage-ui): add the Live2D combos section and a shared trigger editor

- [x] 11. Area sections, Unsorted, collapsed duplicates and the custom expression creator
  Recommended task executor category: visual-engineering - restructures the remaining list UI and adds one creator form.
  What to do:
  - **Area sections.** New `live2d-expression-areas.vue` replaces the flat row list in `live2d-expressions-section.vue`.
    - Heading `areas.title`, then one section per area in this order: whole-look, eyes, mouth, cheeks, effects, outfit-hair, props, hidden. Each section is a `Collapsible` titled with `areas.<area>`.
    - Inside each section, rows are built as today: choose-one picker rows via `live2d-expression-group-row.vue` and single entry rows, in catalog order, and only for entries whose `area` (override or derived) matches.
    - Combo entries are excluded, because they appear in the Combos section. Duplicate entries (`duplicateOf` set) are excluded too.
    - The existing in-use filter, search and Show all keep working across all sections. A section with no visible rows is not rendered.
  - **Unsorted.** It renders last, always expanded, and is not filtered by the in-use rule. It shows `areas.unsorted-description` and a count. Each unsorted row shows a kind `Select`. Choosing a kind sends `update-entry { kind, exposedToLlm: ['face', 'effect', 'prop'].includes(kind) }` (or `update-custom` for a custom id) and opens that row's editor, so a mapping can be added right away.
  - **Entry row changes** (`live2d-expression-entry.vue`):
    - The editor gains an Area `Select` (`fields.area`), which sends `update-entry { area }`.
    - A primary entry with `aliases` shows `duplicates.also` with the alias labels, and one `duplicates.keep-separate` button per alias, which sends `update-entry { id: alias, patch: { keepSeparate: true } }`.
    - When `overriddenBy` is set, the row shows `overridden-by`.
    - Custom entries (`custom:` id) show `custom.delete`, which sends `delete-custom`, and route their edits through `update-custom`.
  - **Choose-one rows.** In `live2d-expression-group-row.vue` and the entry editor, nothing user-visible says "group". `group-select` already reads "Choose one" (`settings.yaml:294`); todo 3 changes `fields.group` (`:316`) and `group-none` (`:310`).
  - **Custom creator.** New `live2d-expression-custom-creator.vue`, opened from a `custom.add` button at the top of Everything else.
    - A `FieldCombobox` over `snapshot.freeParameters`, labelled with display name and id.
    - A `FieldRange` value from min to max, defaulting to max.
    - A label `Input` that defaults to the display name, or the id.
    - Create sends `create-custom`.
    - When `freeParameters` is empty, it shows `custom.none-free` and a disabled create button.
  - **Browser tests.** New `live2d-expression-areas.browser.test.ts`:
    - rows land in their area sections;
    - choose-one rows render inside the right area;
    - Unsorted shows its count, the kind select sends `update-entry { kind: 'face', exposedToLlm: true }` for face and `exposedToLlm: false` for outfit, and the row editor opens;
    - duplicates are hidden and the primary shows "Also: …";
    - keep-separate sends the alias patch;
    - the overridden-by note renders;
    - the creator lists only `freeParameters` and sends `create-custom`;
    - no text node in the panel contains "Group" or "group". Assert with a case-insensitive text search over the rendered section.

    Update `live2d.browser.test.ts` expectations that the new layout deliberately changes, and note each in the evidence.
  Closes: GAP-7, GAP-8 (UI), GAP-9 (UI), GAP-11 (UI)
  Parallelization: Wave 6 | Blocked by: 10 | Blocks: 12
  References: `live2d-expressions-section.vue`, `live2d-expression-entry.vue`, `live2d-expression-group-row.vue:1-104`, `expression-group-name.ts:1-23`, `live2d.browser.test.ts:140-386`, `live2d-expression-group-row.browser.test.ts:35-104`, `docs/assets/ai/context/ui-components.md` (Collapsible, FieldCombobox, FieldRange).
  Acceptance criteria:
  - `pnpm -F @proj-airi/i18n build` runs first.
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings` exits 0.
  - `pnpm -F @proj-airi/stage-ui typecheck` exits 0.
  QA scenarios: Happy: screenshots of Everything else with ForBOOTH-shaped fixture data (eyes, mouth, cheeks, outfit & hair, unsorted with four entries, one duplicate primary) at 1280px and 390px, light and dark: `task-11-*.png`. Failure: the "no Group text" assertion fails when `group-select` is temporarily reverted to "Group"; record and restore. Evidence `task-11-expression-reactions-and-combos.txt`.
  Commit: Y | feat(stage-ui): sort Live2D expressions by area with unsorted, duplicates and custom switches

- [x] 12. Reactions section and the final panel order
  Recommended task executor category: visual-engineering - emotion-first section composing the combo editor from todo 10.
  What to do:
  - New `live2d-expression-reactions.vue`, rendered first in `live2d-expressions-section.vue`. The final order is Reactions, Combos (todo 10), Everything else (todo 11).
  - **Rows.** One row per emotion, in this order: happy, sad, angry, think, surprised, awkward, question, curious, love, flustered, sleepy. Each row is titled with `emotions.<emotion>`.
  - **Chips.** One chip per entry (combos included) that has a mapping for the emotion and no `duplicateOf`, in catalog order. Each chip has:
    - the label, plus a small area or `kinds.combo` caption;
    - "½" when its mapping weight for this emotion is below 1;
    - a select Checkbox (`reactions.select`);
    - a preview Button (`reactions.preview`) that toggles `set-active` and shows the pressed state from `active`;
    - a remove Button (`reactions.remove`). It sends the entry's mappings without this emotion through the command for its id: `update-combo { mappings }` for a `combo:` id, `update-custom { mappings }` for a `custom:` id, and `update-entry { mappings }` for every other id.
  - **Empty rows** show `reactions.empty`.
  - **Add expression.** A `FieldCombobox` (`reactions.add`) of entries of kind face, effect or combo with non-empty slots, that are not duplicates and not already mapped to the emotion. Choosing one adds the mapping `{ emotion, weight: area in eyes/mouth/cheeks ? 0.5 : 1, minBand: kind === 'effect' ? 'strong' : 'clear' }` through the same id routing as remove: `update-combo` for a `combo:` id, `update-custom` for a `custom:` id, and `update-entry` otherwise.
  - **Make combo.** `reactions.make-combo` is disabled with `reactions.make-combo-hint` until at least one chip is selected. It opens `live2d-expression-combo-editor.vue` with `initialMembers` set to the selected plain entries, each at strength 1, and `initialEmotion` set to the row emotion. Selected combo chips are not members.
  - **Browser tests.** New `live2d-expression-reactions.browser.test.ts`:
    - rows appear in order, with chips for mapped entries, including combos;
    - duplicates are excluded;
    - the "½" marker shows;
    - preview sends `set-active`;
    - remove sends `update-entry` for an exp3 entry, `update-combo` for a combo and `update-custom` for a custom entry, each with the emotion dropped from `mappings`;
    - Add expression on a custom entry of kind face sends `update-custom` with the new mapping, and the picker offers a custom face entry but not a custom unsorted or outfit entry;
    - Add expression sends the weight-0.5 mapping for a cheeks entry;
    - Make combo opens the editor prefilled and saving sends `create-combo` with the emotion mapping;
    - the panel order is Reactions, Combos, Everything else.
  Closes: GAP-1, GAP-2 (Reactions entry point), GAP-10 (visible weighting)
  Parallelization: Wave 7 | Blocked by: 11 | Blocks: 13
  References: `live2d-expressions-section.vue`, `live2d-expression-combo-editor.vue` (todo 10), `live2d-expression-trigger-editor.vue` (todo 10), i18n keys from todo 3, `live2d.browser.test.ts:71-102` (mount).
  Acceptance criteria:
  - `pnpm -F @proj-airi/i18n build` runs first.
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings` exits 0.
  - `pnpm -F @proj-airi/stage-ui typecheck` exits 0.
  QA scenarios: Happy: screenshots of the full Expressions tab with ForBOOTH-shaped fixture data, showing the Angry row with Angry, Disdain, Puff Cheeks ½ and Black Face, at 1280px and 390px, light and dark: `task-12-*.png`. Failure: Make combo stays disabled with nothing selected (test case output). Evidence `task-12-expression-reactions-and-combos.txt`.
  Commit: Y | feat(stage-ui): open the Live2D expressions tab on per-emotion reactions

- [x] 13. ADR, README and unused English keys
  Recommended task executor category: writing - docs that describe delivered behavior plus a key cleanup.
  What to do:
  - Write a new ADR, `docs/ai/adr/<execution-date>-expression-combos-and-reactions.md`, following the shape of `docs/ai/adr/2026-10-24-expression-auto-setup.md`. It covers:
    - combos as catalog entries;
    - the claims model with masks and restore;
    - slot spanning;
    - fractional strength (max);
    - the unsorted kind and the area field;
    - duplicate collapse and its primary rule;
    - detail weight 0.5;
    - custom single-parameter expressions over free switches;
    - additive optional persistence with no version bumps;
    - the snapshot rename to `entries`.
  - **Superseded passages.** List the 2026-10-18 lines this replaces: pick-one protection `:229-232`, eligibility `:224-225`, slot leases `:262-270`, and the settings command list `:236-243`. Also list the auto-setup ADR non-goal at `:31-33` ("Group creation remains a separate UX pass").
  - **Pointers.** At each superseded location, add a one-line pointer, preceded by a blank line, to the new ADR. Use the pointer style of `docs/ai/adr/2026-10-24-expression-auto-setup.md`.
  - **README.** Update `packages/stage-ui-live2d/README.md` "Expressions" and "Expression catalog" (`:14-60`): kinds (including unsorted and combo), areas, duplicates, combos, custom expressions and the claims rule. The stored-key paragraph stays accurate: same keys, still version 1.
  - **Unused keys.** Remove English keys under `settings.live2d.expressions` that no `.vue` or `.ts` file references anymore. Find them with a script that greps `packages/` and `apps/` for each key's full path. A key also counts as referenced when an ancestor path appears in a template literal such as `` t(`settings.live2d.expressions.kinds.${kind}`) `` (`live2d-expression-entry.vue:38-45`). The dynamic prefixes are `kinds`, `emotions`, `bands` and `areas`, and every key under them stays. Record the removed list.
  - `docs/assets/ai/context/ui-components.md` needs no change, because no shared component API changed. State this in the evidence.
  Closes: GAP-15
  Parallelization: Wave 8 | Blocked by: 6, 7, 12 | Blocks: F1-F4
  References: `docs/ai/adr/2026-10-18-expression-performance.md:1-431`, `docs/ai/adr/2026-10-24-expression-auto-setup.md:1-40`, `packages/stage-ui-live2d/README.md:1-375`, `packages/i18n/src/locales/en/settings.yaml:285-374`, `AGENTS.md` (Unique Styles prose rules).
  Acceptance criteria:
  - `pnpm -F @proj-airi/i18n build` exits 0.
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings` exits 0 after the key removal.
  - `pnpm exec eslint docs/ai/adr packages/stage-ui-live2d/README.md` exits 0, if the repository lints markdown. Otherwise `git diff --check` exits 0.
  - Each pointer is preceded by a blank line: show it with `Select-String -Context 1`.
  QA scenarios: Happy: a grep shows each superseded location has its pointer. Failure: the unused-key script reports zero remaining unreferenced `settings.live2d.expressions` keys. A key deliberately left unreferenced during the run is reported, then restored. Evidence `.omo/evidence/expression-reactions-and-combos/task-13-expression-reactions-and-combos.txt`.
  Commit: Y | docs(stage-ui-live2d): record expression combos, reactions and areas

- [x] 14. Follow-up: English strings for the Combos card markers
  Recommended task executor category: quick - two i18n keys and their use in one component.
  What to do: add `settings.live2d.expressions.combos.marker-ai`: "AI" and `settings.live2d.expressions.combos.marker-default`: "Default" to `packages/i18n/src/locales/en/settings.yaml`; replace the literal "AI" and "Default" strings in `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d-expression-combos.vue` with `t()` of those keys; update the combos browser test to find the markers through `t(key)` and assert `t(key) !== key`.
  Closes: GAP-15 (user-visible strings in i18n; found during todo 10 execution)
  Parallelization: after todo 10, parallel with todo 11 (disjoint files: settings.yaml, live2d-expression-combos.vue, live2d-expression-combos.browser.test.ts) | Blocked by: 10 | Blocks: 13
  References: todo 10 commit fd18e2383 risk note; AGENTS.md i18n rule; `packages/i18n/AGENTS.md`.
  Acceptance criteria: `pnpm -F @proj-airi/i18n build` and `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings` exit 0; `git grep -n "'AI'\|>AI<\|'Default'\|>Default<" -- packages/stage-ui/src/components/scenarios/settings/model-settings/live2d-expression-combos.vue` returns nothing.
  QA scenarios: Happy: browser tests pass with markers found by translated text. Failure: removing the key makes the t(key) !== key assertion fail. Evidence `.omo/evidence/expression-reactions-and-combos/task-14-expression-reactions-and-combos.txt`.
  Commit: Y | fix(stage-ui): translate the Live2D combo card markers

- [x] 15. Follow-up: set a combo's area on creation and allow clearing it
  Recommended task executor category: unspecified-low - small contract widening in the store plus the editor.
  What to do: `create-combo` accepts an optional `area`; `update-combo` accepts `area: null` to clear a stored area (the persisted ComboDocument then omits area and the merged entry falls back to the derived member area). `live2d-expression-combo-editor.vue` shows the Area select for new combos too, sends `area` on create, and sends `area: null` when the user picks None on an existing combo.
  Closes: todo 10 editor contract (plan: editor has an Area select) found by todo 10 verifier
  Parallelization: parallel with todo 11 and row 14 (files: expression-store.ts, expression-catalog-persistence.ts, expression-store.test.ts, live2d-expression-combo-editor.vue, live2d-expression-combos.browser.test.ts) | Blocked by: 10 | Blocks: 12
  References: todo 10 verifier notes (task-10-verified.json); `packages/stage-ui-live2d/src/stores/expression-store.ts` command union; `expression-catalog-persistence.ts` createCombo/updateCombo; `packages/stage-shared/src/expression-performance/catalog.ts` ComboDocumentSchema (area optional).
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/stores`, `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings`, `pnpm -F @proj-airi/stage-ui-live2d typecheck` and `pnpm -F @proj-airi/stage-ui typecheck` exit 0; new cases: create-combo with area persists it; update-combo area null clears it and the merged area falls back to the derived value; the editor shows Area for a new combo and emits area on create and area null on None.
  QA scenarios: Happy: store + browser cases pass. Failure: a mutation that drops `area: null` handling makes the clear case fail. Evidence `.omo/evidence/expression-reactions-and-combos/task-15-expression-reactions-and-combos.txt`.
  Commit: Y | fix(stage-ui): let combos take an area on creation and clear it later

- [x] 16. Follow-up: clear an entry's area and stop pinning derived areas on save
  Recommended task executor category: unspecified-low - one store patch field plus change-tracking in two editors.
  What to do:
  - `update-entry` accepts `area: null` to clear a stored area override; the override document then omits area and the merged entry falls back to the derived area. A patch without an `area` key leaves the stored override unchanged.
  - `live2d-expression-entry.vue` sends `area` only when the user changed the Area select: the chosen area, or `area: null` when they picked None. The None option uses its own key `settings.live2d.expressions.areas.none` ("None", added to the English settings.yaml) instead of the group-none key. The overridden-by line renders `entry.overriddenBy` directly, since the snapshot already carries the overriding entry's label; drop the `labelOf` id lookup over it.
  - `live2d-expression-combo-editor.vue` sends `area` on update-combo only when the user changed the Area select, so re-saving a combo whose area was derived does not persist the derived value.
  Closes: todo 11 verifier note (entry area cannot be cleared) and todo 15 verifier note (combo re-save pins the derived area)
  Parallelization: after todo 12, parallel with todo 13 (disjoint files) | Blocked by: 12 | Blocks: F1-F4
  References: `.omo/evidence/expression-reactions-and-combos/task-11-verified.json`, `task-15-verified.json`; `packages/stage-ui-live2d/src/stores/expression-store.ts` (update-entry), `expression-catalog-persistence.ts` (override document), row 15 (`area: null` for combos).
  Acceptance criteria: `pnpm -F @proj-airi/i18n build`; `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/stores`; `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings`; `pnpm -F @proj-airi/stage-ui-live2d typecheck`; `pnpm -F @proj-airi/stage-ui typecheck` all exit 0. New cases: update-entry area null clears the override and the entry falls back to its derived area after reload; a patch without area keeps it; the entry editor emits area null on None and no area key when the select was untouched; re-saving a combo with an untouched Area select sends no area key.
  QA scenarios: Happy: the new store and browser cases pass. Failure: a mutation that always sends the area makes the untouched-select cases fail. Evidence `.omo/evidence/expression-reactions-and-combos/task-16-expression-reactions-and-combos.txt`.
  Commit: Y | fix(stage-ui): clear Live2D expression areas and keep derived areas unsaved

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Recommended task executor category: deep-low
  Check every Must have and Must NOT have item against `git diff main...HEAD`. Each of these must return nothing:
  - `git grep -n "literal(2)" packages/stage-shared/src/expression-performance`;
  - `git grep -n "composer\.\(activate\|deactivate\|setActiveSet\)" packages/stage-ui-live2d/src/stores`;
  - `git diff main...HEAD --stat -- packages/i18n/src/locales` lists any file other than `en/settings.yaml`;
  - `git diff main...HEAD --stat -- engines package.json pnpm-lock.yaml` lists anything.

  The rendered Expressions panel contains no visible "group" text, as proven by todo 11's test and F3's screenshots. Evidence `.omo/evidence/expression-reactions-and-combos/F1-expression-reactions-and-combos.md`.
- [x] F2. Code quality review
  Recommended task executor category: deep-low
  These commands must all exit 0:
  - `pnpm verify`;
  - `pnpm -F @proj-airi/stage-shared typecheck`, `pnpm -F @proj-airi/stage-ui-live2d typecheck`, `pnpm -F @proj-airi/stage-ui typecheck`, `pnpm -F @proj-airi/stage-tamagotchi typecheck`, `pnpm -F @proj-airi/stage-tamagotchi-kirie typecheck` (package root `apps/stage-tamagotchi-kirie/`; runs `vue-tsc -p src-web/tsconfig.json --noEmit`) and `pnpm -F @proj-airi/qa-tools typecheck`;
  - `pnpm -F @proj-airi/stage-tamagotchi exec vitest run --project browser src/renderer/composables/model-settings-runtime.browser.test.ts` and `pnpm -F @proj-airi/stage-tamagotchi-kirie exec vitest run --project browser src-web/src/renderer/composables/model-settings-runtime.browser.test.ts`;
  - `pnpm -F @proj-airi/qa-tools exec vitest run src/t3 src/motion`.

  If one of the known load-flaky tests fails, rerun that file alone and report both runs. Review the diff against `.agents/skills/enforce-rules-for-typescript/SKILL.md`, `enforce-rules-for-vitest` and `enforce-rules-for-unocss`, and check for `any`, unused exports and dead code (for example, `setActiveSet` left without callers). Evidence `F2-expression-reactions-and-combos.txt`.
- [x] F3. Real manual QA
  Recommended task executor category: deep-low
  **Setup.**
  - From the execution worktree, run `pnpm dev:tamagotchi` with `APP_MOTION_QA_BRIDGE=true` and a fresh `APP_USER_DATA_PATH` under `RUN_TMP`, per `.agents/skills/motion-qa/SKILL.md` and `packages/qa-tools/src/t3/launch.ts:24`.
  - Drive both windows over CDP per `.agents/skills/agent-browser-electron/SKILL.md` and `.agents/skills/use-agent-browser-for-airi/SKILL.md`. Take final captures with `.agents/skills/use-vishot/SKILL.md`.
  - Before importing each rig, record the `expression-catalog:*` and `expression-rest:*` keys present.

  **Page-side access in the stage window,** through `Runtime.evaluate`:
  - **Pinia stores:** `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('live2d-expressions')`. Read `leases`, `llmEligibleEntries` and `settingsSnapshot` from it.
    - Before step 1, check the root selector in `apps/stage-tamagotchi/src/renderer/index.html` or its `main.ts`, and use whatever element the app mounts on.
  - **ACT markers:** `globalThis.__airiMotionQa.dispatch({ name: 'runScenario', input: { scenario: { levels: ['t3'], events: [{ kind: 'act', at: 0, marker: '<marker>' }] } } })`. See `packages/qa-tools/src/t3/run-t3.ts:150`, `bridge-client.ts:69` and `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts:40,152`.
  - **Parameter values:** start a bridge capture (`startCapture` with `extraParameterIds: [<id>]`), then `awaitCapture`, and read the trace. See `use-motion-qa-bridge.ts`.

  **ForBOOTH steps:**
  1. Import ForBOOTH. The Expressions tab in the settings window shows Reactions first. The Angry row contains Angry, Disdain, Puff Cheeks with "½", and Black Face. No `鼓脸` chip appears separately; the Puff Cheeks row shows "Also: 鼓脸". Screenshot.
  2. Unsorted lists `expression19`, `expression20`, `Bowtie` and `Bloodstain`. In the stage window, `llmEligibleEntries.map(e => e.label)` contains none of those four labels and no alias label.
  3. In the Angry row, select Angry, Puff Cheeks and Black Face, then Make combo and save as "Angry look". A Combos card appears with the AI marker and the angry emotion.
  4. Dispatch the marker `<|ACT {"emotion":"angry","intensity":"strong","expression":"Angry look"}|>`. `leases.face.expressionId` and `leases.effect.expressionId` both equal the combo id, and the three member entries have `effective: true` in `settingsSnapshot.entries`. Then wait past `slots.holdCap` (15 s): both slots end null and the members are no longer effective.
  5. **Slot-triggered override and restore (IS-4).**
     - `Blush` and `expression22` both write `Param85` with non-zero values, so they share one choose-one set of kind face. Confirm this in `settingsSnapshot.entries`, where their `group` values are equal.
     - Switch `Blush` on and click Save expression defaults.
     - Create the combo "Shy" with members `expression22` and `Spiral Eyes`, both face entries, so its slots are `['face']`.
     - Dispatch `<|ACT {"expression":"Shy"}|>`. While the combo is active, `Blush` has `effective: false` and `overriddenBy` equal to "Shy", and its row shows "Hidden by Shy while it is active".
     - After the lease expires (wait past `slots.holdCap`), `Blush` is effective again. Screenshots before, during and after.
  6. **Partial strength (IS-6).** Edit "Shy" to set `expression22` to strength 0.5. Dispatch `<|ACT {"expression":"Shy"}|>` again and capture `Param85` with the bridge capture while it is active. Do the same at strength 1. The steady value at 0.5 is half the strength-1 offset over the parameter default, within 10%.

  **Bear steps:**
  7. **Manual override and restore (IS-4, manual path).**
     - Switch `White hair braids` on and click Save expression defaults.
     - Create the combo "Braids" with member `Black braids`. It is outfit-only, so its card shows the manual-only note and no AI marker.
     - Switch "Braids" on from its card. The braids show, the `White hair braids` row shows "Hidden by Braids while it is active", and `overriddenBy` is "Braids".
     - Switch "Braids" off. `White hair braids` is effective again. Screenshots for each state.
  8. Click Add custom expression. The Switch list includes `Param7` and excludes `ParamMouthOpenY`, `ParamAngleX` and `Param14`. Then exercise create, classify, use and persist:
     1. **Create.** Create "Earphones" at the default value. `suggestKind` does not recognize the label, so the entry appears in the Unsorted section, and `llmEligibleEntries` does not contain it.
     2. **Classify.** Use that row's Unsorted kind `Select` to choose Outfit. The row moves to the Outfit & hair section. The stored `expression-catalog:<modelId>` document's `customs` entry has `kind: 'outfit'` and `exposedToLlm: false`.
     3. **Use.** Switch Earphones on; the earphone is visible in a screenshot. Switch Earphones off again, so it has no claim of its own; `settingsSnapshot.entries` shows `active: false`. Edit the combo "Braids" to add Earphones as a member. Switching "Braids" on shows the braids and the earphone together, with Earphones reporting `via: [<Braids id>]`. Switching "Braids" off hides both and restores `White hair braids`.

     The Reactions mapping path for custom entries (`update-custom` from Add expression and remove) is proven by todo 9's persistence test and todo 12's browser tests. A custom outfit is not offered in the Reactions picker, by design.
  9. Quit and relaunch with the same `APP_USER_DATA_PATH`. All of these are still present:
     - the ForBOOTH combos "Angry look" and "Shy", with the 0.5 strength;
     - the Bear combo "Braids";
     - the custom expression "Earphones", classified as outfit and a member of "Braids";
     - the saved defaults `Blush` and `White hair braids`.

  **Teardown.** Stop the dev processes with `pnpm dev:top kill <worktree-name> --yes`. Receipts:
  - `pnpm wt ls` shows no live process for the worktree;
  - `Test-Path <RUN_TMP>` returns False after its removal.

  Evidence `.omo/evidence/expression-reactions-and-combos/F3-expression-reactions-and-combos/*.png` plus `notes.md`, which records each step's evaluate output.
- [x] F4. Ideal-state fidelity
  Recommended task executor category: deep-low
  Check IS-1 through IS-15 one by one against the delivered behavior and the evidence. Each shortfall becomes a new `- [ ] N.` row, not a note. Evidence `F4-expression-reactions-and-combos.md`.

## Commit strategy
- One Conventional Commit per todo, in dependency order. Each commit leaves typecheck and the related tests green. Each todo's Commit line names its message.
- Docs (todo 13) ship on the same branch as the code.
- No agent configuration changes in these commits.
- Execution runs in a task-owned worktree on the feature branch `luke/feat/expression-combos`. Nothing is merged to main or pushed without Luke's explicit okay.
- Final commit footer: `Plan: .omo/plans/expression-reactions-and-combos.md`.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 12, 4 | Todo 12 order and chip tests; F3 step 1 | `task-12-*.png`, `F3-.../` |
| IS-2 | 12, 10, 9 | Todo 12 Make combo test; F3 step 3 | `task-12-...txt`, `F3-.../` |
| IS-3 | 1, 6, 7, 8, 9 | Todo 6 explicit combo; todo 7 label resolution; todo 8 rest-set combo id; F3 step 4 | `task-6/7/8-...txt`, `F3-.../notes.md` |
| IS-4 | 8, 10 | Todo 8 masked restore cases; F3 step 5 (slot-triggered face combo over saved `Blush`) and step 7 (manual outfit combo over saved `White hair braids`) | `task-8-...txt`, `F3-.../` |
| IS-5 | 6, 8 | Todo 6 no-effect-after-combo case; todo 8 two-lease case | `task-6-...txt`, `task-8-...txt` |
| IS-6 | 2, 8, 10 | Todo 2 fractional cases; todo 8 max-strength case; F3 step 6 (`Param85` capture at strength 0.5 and 1) | `task-2-...txt`, `F3-.../notes.md` |
| IS-7 | 5, 11, 3 | Todo 5 area table; todo 11 sections and no-"group" test | `task-5-...json`, `task-11-*.png` |
| IS-8 | 5, 1, 7, 11 | Todo 5 rig script; todo 7 prompt case; F3 step 2 | `task-5-...json`, `F3-.../notes.md` |
| IS-9 | 5, 11 | Todo 5 duplicate cases; todo 11 "Also" test; F3 step 1 | `task-5-...json`, `task-11-...txt` |
| IS-10 | 5, 12 | Todo 5 weight 0.5 cases; todo 12 "½" test | `task-5-...txt`, `task-12-...txt` |
| IS-11 | 9, 11, 12 | Todo 9 free-parameters and `update-custom` mapping persistence tests; todo 11 creator and Unsorted classify tests; todo 12 custom routing tests; F3 step 8 (create, then Unsorted, then classify as outfit, then switch on and add to the Braids combo) and step 9 (persists) | `task-9-...txt`, `task-12-...txt`, `F3-.../` |
| IS-12 | 1, 9 | Todo 1 stored version-1 document case; todo 9 overrides-only load case; F3 step 9 | `task-1-...txt`, `task-9-...txt`, `F3-.../notes.md` |
| IS-13 | 4, 9 | Todo 9 Electron and Kirie Eventa round-trips; local-store browser tests; F3 runs in the settings window | `task-9-...txt`, `F3-.../` |
| IS-14 | 6, 1 | Todo 6 ticket-stream and replay cases; existing trace fixtures parse | `task-6-...txt` |
| IS-15 | 13, 3 | Todo 13 pointer grep and key cleanup | `task-13-...txt` |
