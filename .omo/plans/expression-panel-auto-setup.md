# expression-panel-auto-setup - Work Plan

## TL;DR (For humans)

**Who this is for and what changes for them:** Anyone who loads a Live2D model with many expressions and opens the Expressions settings. Out of the box, the character's emotional faces and effects are recognized from their names and used automatically. The settings list shows only what is in use, instead of every file as a full card.

**What you'll get:** The expression system is on for new profiles. Expressions whose names say an emotion (Angry, Cry, Hearts, Blush, zzz...) are mapped to that emotion with no setup, and the AI can use faces, effects, and props right away. The list shows active, emotion-mapped, and grouped expressions, with "Show all" and a search box for the rest. Each pick-one set (hair styles, chat icons) is a single row with a readable name and a picker. Rows are slimmer. A per-expression "switch shows the opposite" option fixes switches like Bear's coat.

**Why this approach:** Name-based guessing is cheap, and per your call it beats manual setup even when some guesses are wrong. Showing groups as one row both reduces crowding and is the first step toward user-made groups later. The review flag is kept as stored data, so no saved settings are lost.

**What it will NOT do:** No user-created or renamed groups, no split into separate panels, and no automatic detection of "this expression hides something". No change to how emotions pick expressions, beyond removing the review requirement.

**Effort:** Large
**Risk:** Medium - shared catalog eligibility changes affect automatic picking and the AI prompt for every Live2D model.
**Decisions to sanity-check:** Ungrouped outfits and props that are not active (Bear's coat, hat, glasses) are hidden behind "Show all" by default, following the "in use" definition. Effects still need a strong emotion to fire, the existing rule, so hearts and zzz appear less often than faces. The AI sees about 50 labels on ForBOOTH.

Your next move: run `/ulw-execute expression-panel-auto-setup` once the plan review approves this plan. Full execution detail follows below.

---

> TL;DR (machine): Large, Medium risk - lexicon emotion mappings, no confirmed gate, LLM exposure by kind, Expression system default on, set-active command, in-use panel view with Show all/search, group picker rows, inverted display.

## Scope
### Affected user and ideal state
**Affected user:**
- U1: a person who loads a Live2D model in Tamagotchi or stage-web and opens Settings > Models > Expressions. Today they see one card per exp3 file, and nothing fires automatically until every entry is confirmed and mapped by hand. Groups show file names, and switches for "remove" expressions read backwards. After this plan, emotions are mapped automatically and the list shows what matters.
- U2: the programs that consume `isAutoEligible`, `isLlmEligible`, and `llmEligibleEntries`:
  - automatic selection (`pickerCandidates` in `packages/stage-shared/src/expression-performance/selection.ts:47`);
  - the performance conductor (`use-stage-performance-conductor.ts:63,225`);
  - the LLM expression tool port (`use-stage-performance-conductor.ts:567-595`, `packages/stage-ui/src/tools/expression.ts`);
  - the runtime prompt.
- U3: the Electron settings window. It renders `Live2DExpressionSettingsSnapshot` and sends `Live2DExpressionSettingsCommand` over eventa (`apps/stage-tamagotchi/src/shared/model-settings-runtime.ts`).
- U4: the Kirie app, which consumes the same command union, snapshot, and panel (`apps/stage-tamagotchi-kirie/src-web/src/shared/model-settings-runtime.ts:1,15`, `.../pages/settings/models/index.vue:64,388`).

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | On a fresh model, face and effect expressions whose label or file name names an emotion carry that emotion mapping and fire automatically with no user action. | Luke: hands-off setup; some wrong mappings beat per-entry setup. |
| IS-2 | No review or confirm step gates automatic picking or LLM use. | A gate defeats hands-off setup. |
| IS-3 | Face, effect, and prop entries reach the LLM by default. Outfit and system entries never do. | Luke's answer: faces, effects, props. |
| IS-4 | By default the panel lists only in-use rows: every group row, plus ungrouped entries that are active or have mappings. System entries show only when active. "Show all" (with a hidden count) and a search box reach every entry. | Luke: the main issue is showing relevant entries. |
| IS-5 | Each pick-one group is one row with a readable name and a picker of None plus its members. The members stay editable. | Groups showed file names and crowded the list. |
| IS-6 | An entry row shows the label, a mapped-emotion summary, the AI toggle (face/effect/prop only), an on/off switch, and Edit. Kind, group, and status chips are gone from the row. | Reduces crowding. |
| IS-7 | A user can mark an entry inverted. Its switch then reads on while the expression is inactive (Bear coat shown) and turning it off activates the expression. | Luke chose manual flip only. |
| IS-8 | Existing stored curated catalogs (`expression-catalog:*`) and rest sets (`expression-rest:*`) keep loading unchanged, and none are discarded. | No data loss. |
| IS-9 | Rows keep catalog order while toggling. The Electron settings window and the in-renderer panel behave the same. | Stability and cross-window parity. |
| IS-10 | A fresh profile starts with the Expression system on. Profiles with a stored value keep it. | Luke: on by default. |
| IS-11 | README and ADRs describe the new defaults, commands, and fields. | Root rule: docs with code. |
| GAP-1 | `deriveCatalog` sets `mappings: []` (`packages/stage-ui-live2d/src/utils/expression-catalog/derive.ts:100-121`). | Nothing fires. |
| GAP-2 | `isAutoEligible`/`isLlmEligible` require `confirmed` (`packages/stage-shared/src/expression-performance/catalog.ts:88-94`), and derived entries have `confirmed: false`. | Review gate. |
| GAP-3 | Derived `exposedToLlm: false` (derive.ts:113). | AI sees nothing. |
| GAP-4 | `live2d.vue` renders every snapshot entry as a full card (Expressions Section, `v-for="entry in expressionSettingsSnapshot.groups"`). | Crowding. |
| GAP-5 | The group label is `group:<first member id>` with the prefix stripped, so a file id shows (`live2d-expression-entry.vue:34-37`, derive.ts:93-95). | Confusing. |
| GAP-6 | `CatalogEntrySchema`/`CuratedOverrideSchema` have no inverted field (catalog.ts:33-58). | Cannot flip. |
| GAP-7 | `toggle` checks only `manualActive` (`packages/stage-ui-live2d/src/stores/expression-store.ts:143-148`). Clearing a slot-owned active member therefore re-activates it instead. | A group None needs an explicit off. |
| GAP-8 | `settings/live2d/expression-enabled` defaults to `false` (`packages/stage-ui-live2d/src/composables/live2d/live2d.ts:104`). | Fresh profiles get nothing. |
| GAP-9 | `packages/stage-ui-live2d/README.md:20,27-38` and `docs/ai/adr/2026-10-18-expression-performance.md:204,220-221,237` describe confirmed gating, the off default, and `confirm-all-suggested`. | Stale docs. |

### Must have
- A label lexicon that produces emotion mappings for face/effect entries in `deriveCatalog`, with a negation skip.
- Eligibility without `confirmed`. `confirmed` stays in the schemas as a persisted "reviewed" marker that editor Apply sets to true.
- Derived `exposedToLlm` is true exactly for kinds in `llmAllowedKinds`.
- An optional `inverted` field on `CatalogEntrySchema` (output type `inverted?: boolean`) and on `CuratedOverrideSchema`.
- A `set-active` command. The `confirm-all-suggested` command, `confirmAllSuggested`, and the Confirm all button are removed.
- The Expression system defaults to on.
- The panel has the in-use filter, Show all with a hidden count, search, group picker rows with readable names, slim entry rows, and the editor inverted checkbox.
- English i18n keys are added and unused English keys removed (`packages/i18n/src/locales/en/settings.yaml` only).
- Tests are updated and added as listed per todo. README and ADRs are updated.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No UI for creating or renaming groups, and no new group names stored. `group` values stay `group:<id>` or existing curated names.
- No panel split, no tabs by kind, and no active-first sorting.
- No automatic inversion detection: no rendering probes and no label-word heuristics for `inverted`.
- No change to picker/planner/selection scoring, band rules, the `resolveMappings` minBand defaults, slot leases, or Natural.
- No removal of `confirmed` from `CatalogEntrySchema` or `CuratedOverrideSchema`, because `strictObject` would then discard stored documents.
- No removal of the existing `toggle` command, which `use-motion-qa-bridge.ts:161` and the tamagotchi runtime tests use.
- No edits to non-English locale files. No `package.json` or lockfile changes.
- Unrelated dirty paths are not touched: `.omo/drafts/live2d-cursor-touch-integration.md`, `.omo/plans/live2d-cursor-touch-integration.md`.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after. Use Vitest node tests in `stage-shared` and `stage-ui-live2d`, plus Vitest browser (Playwright Chromium) tests in `stage-ui` and `stage-tamagotchi`.
- Before any `stage-ui` browser test run after a YAML edit, run `pnpm -F @proj-airi/i18n build`. Otherwise `t()` returns raw keys and queries pass vacuously, so guard with `expect(t(key)).not.toBe(key)`.
- The first browser run after an import-graph change may fail with "optimized dependencies changed. reloading". Rerun once; only the warm run counts.
- After each todo, run `pnpm verify` (changed-file typecheck, lint, and related tests).
- Rendered QA on Bear only. Luke's rule: acceptance on one rig counts for the other.
- Evidence: `.omo/evidence/expression-panel-auto-setup/task-<N>-expression-panel-auto-setup.<ext>` (outside ulw-loop).

## Execution strategy
### Parallel execution waves
- Wave 1 (parallel): todos 1 and 4 (disjoint files).
- Wave 2: todo 2. Its test edits build on todo 1's rewrite of `expression-store.test.ts:49-63`.
- Wave 3: todo 3.
- Wave 4: todo 5. It creates the group-name helper and the `groups` prop contract.
- Wave 5: todo 6.
- Wave 6 (parallel): todos 7 and 8.
- Final: F1-F4.
- This order keeps every commit's typecheck and tests green: todos 1, 2, and 3 each change expectations in the same store test block.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2, 3, 5, 8 | 4 |
| 2 | 1 | 3, 6, 8 | - |
| 3 | 1, 2 | 5, 6, 7, 8 | - |
| 4 | - | 5, 6, 7, 8 | 1 |
| 5 | 1, 3, 4 | 6, 7 | - |
| 6 | 2, 3, 4, 5 | 7 | - |
| 7 | 5, 6 | F1-F4 | 8 |
| 8 | 1, 2, 3, 4 | F1-F4 | 7 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Shared catalog contract: ungated eligibility and optional inverted field
  Recommended task executor category: unspecified-low - one shared module plus fixture-level test updates.
  What to do:
  - In `packages/stage-shared/src/expression-performance/catalog.ts`:
    - `isAutoEligible(entry)` returns `entry.kind === 'face' || entry.kind === 'effect'`.
    - `isLlmEligible(entry)` returns `entry.exposedToLlm && llmAllowedKinds.includes(entry.kind)`.
    - Add `inverted: optional(boolean())` (no default, so the output type stays `inverted?: boolean`) to the `strictObject` in `createCatalogEntrySchema` and to `CuratedOverrideSchema`.
    - Keep `confirmed` in both schemas, and add a one-line doc comment: "Persisted review marker set by the settings editor; eligibility ignores it."
  - Update tests:
    - `catalog.test.ts:43-50`: unconfirmed entries are eligible by kind, and `exposedToLlm: false` still blocks the LLM.
    - Add a parse case for `inverted: true` on both schemas, and a rejection case for `inverted: 'yes'`.
    - Add a stored-document case: `parseCuratedCatalogDocument({ version: 1, overrides: [{ id: 'a', confirmed: true, exposedToLlm: false, mappings: [] }] })` succeeds. This is the shape existing profiles hold, with no `inverted` field.
    - Add a confirm-all profile case: a document whose overrides are only `{ id, confirmed: true }` for every derived id parses, and `mergeCatalog` keeps each derived entry's `mappings` and `exposedToLlm`.
    - Add a `mergeCatalog` case where an override `{ id, inverted: true }` yields `inverted: true`.
    - `picker.test.ts:85`: the `unconfirmed` face entry is now eligible. Change the expectation, and keep outfit/prop/system excluded.
    - `packages/stage-ui/src/composables/use-airi-runtime-prompt.test.ts:40`: `pout` with `confirmed: false` now appears in the exposed list. Update the expected prompt text.
    - `packages/stage-ui-live2d/src/stores/expression-store.test.ts:49-63`: rewrite the eligibility expectations for the gate-free rule. An unconfirmed face such as `frown` is now in `autoEligibleEntries`. `confirmAllSuggested` still exists in this commit and stays called. Todos 2 and 3 edit this block later.
  - Rewrite the doc comment at `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts:60` to "The labels and kinds the LLM may see: exposed face, effect, and prop entries only."
  - Must NOT do: change `resolveMappings`, `mappingWeightRange`, band logic, or remove `confirmed`.
  Closes: GAP-2, GAP-6 (schema part)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 2, 3, 5, 8
  References: `packages/stage-shared/src/expression-performance/catalog.ts:33-94`, `catalog.test.ts:1-60`, `picker.test.ts:80-95`, `packages/stage-ui/src/composables/use-airi-runtime-prompt.test.ts:25-60`, `packages/stage-ui-live2d/src/stores/expression-store.ts:46-47` (consumers).
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` exits 0.
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/stores` exits 0.
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables src/tools` exits 0, which also runs `src/tools/expression.test.ts`. This covers `use-airi-runtime-prompt.test.ts` and `performance/use-stage-performance-conductor.test.ts`. The conductor filters with `isLlmEligible` at `use-stage-performance-conductor.ts:63,225`, and its fixtures (`use-stage-performance-conductor.test.ts:28,230`) must be checked for expectations that relied on `confirmed: false` exclusion.
  - `pnpm -F @proj-airi/stage-shared typecheck` exits 0.
  - Searching `catalog.ts` for `entry.confirmed` returns 0 matches.
  QA scenarios:
  - Happy: the vitest output lists the new inverted parse and merge cases passing. Evidence `.omo/evidence/expression-panel-auto-setup/task-1-expression-panel-auto-setup.txt`.
  - Failure: the `inverted: 'yes'` rejection case passes (safeParse fails). Same evidence file.
  Commit: Y | feat(stage-shared): drop the review gate from expression eligibility and add inverted display

- [x] 2. Automatic catalog derivation: lexicon mappings and exposure by kind
  Recommended task executor category: unspecified-low - one derivation module plus a table-driven test.
  What to do:
  - In `packages/stage-ui-live2d/src/utils/expression-catalog/derive.ts`, add an exported `suggestMappings(label: string, fileName: string, kind: ExpressionKind): EmotionMapping[]`:
    - Return `[]` unless `kind` is `face` or `effect`.
    - Build `text = \`${label} ${baseName(fileName)}\`.toLowerCase()`.
    - Return `[]` when `text` matches a negation token. English: `cancel`, `off`, `hide`, `hidden`, `remove`, `no`, `disappear`. CJK by substring: `取消`, `隐藏`, `关闭`.
    - English tokens use the same boundary regex as `suggestKind`: `(?:^|[^a-z])${token}s?(?=$|[^a-z])`. CJK tokens match by substring.
    - Emotion tokens, in this exact table and emotion order:
      - happy: `happy`, `smile`, `grin`, `joy`, `laugh`, `wink`, `star eyes`, `cat mouth`, `tongue out`, `笑`, `吐舌`
      - sad: `sad`, `cry`, `crying`, `tear`, `sob`, `哭`, `流泪`
      - angry: `angry`, `anger`, `rage`, `mad`, `disdain`, `black face`, `puff cheeks`, `pout`, `生气`, `愤怒`, `鼓脸`
      - think: `think`, `thinking`, `思考`
      - surprised: `surprise`, `surprised`, `shock`, `shocked`, `exclamation`, `惊`
      - awkward: `awkward`, `sweat`, `尴尬`, `汗`
      - question: `question`, `confusion`, `confused`, `问号`, `疑问`
      - curious: `curious`
      - love: `love`, `heart`, `爱心`
      - flustered: `blush`, `red`, `shy`, `embarrassed`, `spiral eyes`, `脸红`, `害羞`
      - sleepy: `sleepy`, `sleep`, `zzz`, `snot`, `困`, `睡`
    - Return one mapping per matched emotion, in that emotion order and without duplicates: `{ emotion, weight: 1, minBand: kind === 'effect' ? 'strong' : 'clear' }`.
  - In `deriveCatalog`:
    - Set `mappings: suggestMappings(label, def.id, kind)`. Compute `kind` first.
    - Set `exposedToLlm: (llmAllowedKinds as readonly ExpressionKind[]).includes(kind)`.
    - Keep `confirmed: false`.
    - Import `llmAllowedKinds` from `@proj-airi/stage-shared/expression-performance`.
  - Update `derive.test.ts:34-48` (the test "uses model3 then VTS then basename and leaves all entries unconfirmed"). It must assert `confirmed` false, `exposedToLlm` by kind, and mappings from the lexicon.
  - Add `it.each` table cases in `derive.test.ts`:
    | label | expected kind | expected mappings |
    | --- | --- | --- |
    | `anger` | face | angry/clear |
    | `cry` | face | sad/clear |
    | `love` | effect | love/strong |
    | `red` | effect | flustered/strong |
    | `Snot bubbles` | effect | sleepy/strong |
    | `coat` | outfit | [] |
    | `Tear Mouth Cancel` | effect | [] (negation) |
    | `Cat Mouth （no bread）` | face | [] (negation) |
    | `Hearts 1` | face | love/clear |
    | `Grin` | face | happy/clear |
    | `Blush` | face | flustered/clear |
    | `Crying Eyes` | face | sad/clear |
    | `zzz` | effect | sleepy/strong |
    | `game` | prop | [] |
    | `脸红2` | face | flustered/clear |
  - In `packages/stage-ui-live2d/src/stores/expression-store.test.ts:49-63`, adjust the `llmEligibleEntries` expectations for derived exposure by kind.
  - In `packages/stage-ui/src/tools/expression.test.ts`, add a case that registers definitions through the real store without any `updateEntry`. It asserts the `set_expression` enum contains the derived face, effect, and prop labels and excludes outfit and system labels.
  - Must NOT do: change `rules`, `suggestKind`, `suggestGroups`, or the label precedence.
  Closes: GAP-1, GAP-3
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 3, 6, 8
  References: `packages/stage-ui-live2d/src/utils/expression-catalog/derive.ts:1-121`, `derive.test.ts:1-120`, `packages/stage-shared/src/expression-performance/catalog.ts:10-31` (`EmotionMapping`, `llmAllowedKinds`). Real labels: Bear hotkeys in `C:/Users/Luke/Documents/Live2d Models/bear Pajama V1.1/bear Pajama V1.1/bear Pajama V1.1.vtube.json`; ForBOOTH hotkeys in its `.vtube.json` (read-only).
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/utils/expression-catalog src/stores` exits 0, with all table rows passing.
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/tools` exits 0.
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0.
  QA scenarios:
  - Happy: a throwaway script under `.omo/evidence/` runs `deriveCatalog` over Bear's 29 definitions (ids plus parameters read from the exp3 files) and the vtube hotkeys. It records the entries with non-empty mappings, expected to include anger, cry, love, red, and Snot bubbles. Evidence `task-2-expression-panel-auto-setup.json`.
  - Failure: the `Tear Mouth Cancel` and `coat` cases yield `[]`. Evidence: vitest output appended to `task-2-expression-panel-auto-setup.txt`.
  Commit: Y | feat(stage-ui-live2d): suggest emotion mappings and AI access when deriving the expression catalog

- [x] 3. Store command contract: set-active replaces confirm-all-suggested
  Recommended task executor category: unspecified-low - store command plus tests in two packages.
  What to do:
  - In `packages/stage-ui-live2d/src/stores/expression-store.ts`:
    - Add `| { type: 'set-active', id: string, active: boolean }` to `Live2DExpressionSettingsCommand`.
    - Remove `| { type: 'confirm-all-suggested' }`.
    - In `applySettingsCommand`, `case 'set-active'` calls `activate(command.id)` when `active` is true and `deactivate(command.id)` when false.
    - Remove `case 'confirm-all-suggested'` and remove `confirmAllSuggested` from the destructure and the returned object.
  - In `expression-catalog-persistence.ts`, delete `confirmAllSuggested` and its return member.
  - In `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`, delete the `<Button>` that sends `{ type: 'confirm-all-suggested' }`. That keeps typecheck green. The UI rework happens in todo 7.
  - Tests in `expression-store.test.ts`:
    - Delete the remaining `confirmAllSuggested` calls in the block at lines 49-63. Todos 1 and 2 already rewrote its expectations.
    - Add `set-active` true on a group member, which deactivates its siblings.
    - Add `set-active` false on an entry activated through `activateFromSlot`, which leaves `isActive` false (snapshot `active` false).
    - Add `set-active` false on a rest-set member, which suppresses it until `resetAll`.
    - Add `activateFromSlot` on an entry, then `set-active` true, which puts the id in `manualActive`. A user switch is manual intent.
  - In `apps/stage-tamagotchi/src/renderer/composables/model-settings-runtime.browser.test.ts`, add one case where `sendLive2DExpressionCommand({ type: 'set-active', id: 'happy.exp3.json', active: true })` returns true and the returned snapshot shows it active. Mirror the existing toggle case at :128.
  - Kirie (`apps/stage-tamagotchi-kirie`) consumes the same command union through `src-web/src/shared/model-settings-runtime.ts` and the shared store. It needs no code change, and its typecheck must stay green.
  - Must NOT do: remove or change `toggle`.
  Closes: GAP-7
  Parallelization: Wave 3 | Blocked by: 1, 2 | Blocks: 5, 6, 7, 8
  References: `expression-store.ts:28-34,121-148,186-207`, `expression-catalog-persistence.ts:39-47`, `expression-store.test.ts:40-70`, `live2d.vue` (Expressions Section action buttons, around line 941), `apps/stage-tamagotchi/src/renderer/composables/model-settings-runtime-owner.ts` (passes commands through), `model-settings-runtime.browser.test.ts:110-190`, `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts:161`.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/stores` exits 0.
  - `pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/composables/model-settings-runtime.browser.test.ts` exits 0.
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck`, `pnpm -F @proj-airi/stage-ui typecheck`, `pnpm -F @proj-airi/stage-tamagotchi typecheck`, and `pnpm -F @proj-airi/stage-tamagotchi-kirie typecheck` exit 0.
  - Searching `packages` and `apps` for `confirm-all-suggested|confirmAllSuggested` returns 0 matches in .ts/.vue.
  QA scenarios:
  - Happy: vitest output for the set-active cases. Evidence `task-3-expression-panel-auto-setup.txt`.
  - Failure: the slot-owned set-active false case asserts inactive. A regression to `toggle` semantics would fail it. Same file.
  Commit: Y | feat(stage-ui-live2d): add the set-active expression command and remove confirm-all

- [x] 4. Expression system on by default and new English strings
  Recommended task executor category: quick - one default value and YAML key additions.
  What to do:
  - In `packages/stage-ui-live2d/src/composables/live2d/live2d.ts:104`, change the default of `settings/live2d/expression-enabled` to `true`.
  - Under `settings.live2d.expressions` in `packages/i18n/src/locales/en/settings.yaml`, add:
    - `switch: On`
    - `show-all: Show all ({count} hidden)`
    - `show-fewer: Show only expressions in use`
    - `search: Search expressions`
    - `none-in-use: No expressions are in use yet.`
    - `no-match: No expressions match this search.`
    - `group-select: Choose one`
    - `group-option-none: None`
    - `group-members: Edit members`
    - `group-members-close: Close members`
    - `fields.inverted: Switch shows the opposite`
    - `fields.inverted-description: Use this when turning the expression on hides something, such as a coat.`
  - Do not remove keys here.
  - Run `pnpm -F @proj-airi/i18n build`.
  - Must NOT do: edit other locales or change any other setting default.
  Closes: GAP-8
  Parallelization: Wave 1 | Blocked by: - | Blocks: 5, 6, 7, 8
  References: `live2d.ts:100-125`, `packages/i18n/src/locales/en/settings.yaml:285-330`, `packages/i18n/AGENTS.md` (glossary and English-only rules), `packages/qa-tools/src/t2/runner.ts:186` (its comment already assumes default true; no edit).
  Acceptance criteria:
  - `pnpm -F @proj-airi/i18n build` exits 0.
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0.
  - Create `packages/stage-ui-live2d/src/composables/live2d/live2d-settings.browser.test.ts`, which runs in the browser project with real localStorage. Two cases:
    - After `localStorage.clear()`, `vi.resetModules()`, and a dynamic import of `./live2d`, `useSettingsLive2d(createPinia()).live2dExpressionEnabled` is `true`.
    - Set it to `false` through the store, then `vi.resetModules()` and re-import: the value is still `false`.
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project browser src/composables/live2d/live2d-settings.browser.test.ts` exits 0.
  QA scenarios:
  - Happy: `git diff --stat` shows only `live2d.ts`, the new settings browser test, and the en `settings.yaml`. Evidence `task-4-expression-panel-auto-setup.txt`.
  - Failure: searching `packages/i18n/src/locales` for `show-all:` returns matches only in the `en/` directory. Same file.
  Commit: Y | feat(stage-ui-live2d): enable the expression system by default

- [x] 5. Slim entry row and editor: switch with inversion, emotion summary, reviewed marker
  Recommended task executor category: visual-engineering - Vue component layout and interaction with browser tests.
  What to do:
  - Rework the header row of `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d-expression-entry.vue`.
    - Show the label, then a single muted text line with the mapped emotions: unique `entry.mappings` emotions, translated through `settings.live2d.expressions.emotions.*` and joined with ", ". Omit the line when there are no mappings.
    - Remove the kind chip, the group chip, and the Confirmed/Suggested chip from the row.
    - Keep the AI checkbox (`llmKinds` only).
    - Replace the Preview checkbox with a `switch`-labelled Checkbox whose `model-value` is `entry.inverted ? !entry.active : entry.active`. On update it emits `{ type: 'set-active', id: entry.id, active: entry.inverted ? !$event : $event }`.
    - Keep the Edit button.
  - Editor:
    - Remove the Confirmed checkbox and `draftConfirmed`.
    - Add `draftInverted`, loaded from `entry.inverted ?? false`, as a Checkbox labelled `fields.inverted` with `fields.inverted-description` as help text.
    - `apply()` patch becomes `{ label, kind, group, confirmed: true, inverted: draftInverted, mappings }`.
    - Create `expression-group-name.ts` with `groupDisplayName` and its node test `expression-group-name.test.ts`, exactly as specified in todo 6. Todo 6 only consumes them.
    - Replace the entry prop `groupNames: string[]` with `groups: { name: string, labels: string[] }[]`: every group in the catalog, with its member labels in catalog order.
    - Group Select options use `groupDisplayName(labels)` as the label and `name` as the value. Delete `groupLabel`.
    - In `live2d.vue`, replace `expressionGroupNames` (line 102) with the matching computed and pass it as `groups`.
  - Update `live2d.browser.test.ts`:
    - Rewrite the case at 191-205:
      - lines 198-201 now assert that the kind texts (`kinds.face`, `kinds.outfit`), the group text (`Cheeks`), and the Confirmed chip are absent from the row;
      - a mapping summary text such as "Angry" is present;
      - rename the `preview`-based switch query at line 184 to the `switch` key.
    - The case at 206-218 expects the patch to include `confirmed: true, inverted: false`.
    - The case at 133-190 expects `{ type: 'set-active', id: 'happy.exp3.json', active: true }` instead of toggle.
    - Add a case where an entry with `inverted: true, active: false` renders the switch checked, and clicking it emits `set-active` with `active: true`.
    - Add a case where the editor inverted checkbox is included in the Apply patch.
  - Must NOT do: add new components here, or change mapping editing or validation.
  Closes: GAP-6 (UI part); IS-6, IS-7
  Parallelization: Wave 4 | Blocked by: 1, 3, 4 | Blocks: 6, 7
  References: `live2d-expression-entry.vue:1-272`, `live2d.browser.test.ts:1-260`, `packages/i18n/src/locales/en/settings.yaml:285-330`, `.agents/skills/enforce-rules-for-unocss/SKILL.md`, `DESIGN.md`, memory: stage-ui browser test pitfalls (i18n build, warm rerun).
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui exec vitest run src/components/scenarios/settings/model-settings/live2d.browser.test.ts` exits 0 on a warm run.
  - `pnpm -F @proj-airi/stage-ui typecheck` exits 0.
  - `pnpm lint` on the changed files is clean (via `pnpm verify`).
  QA scenarios:
  - Happy: a browser test screenshot of a row with a mapping summary and the inverted switch, at `page.viewport(1280, 1000)` and `(390, 1000)`. Evidence `task-5-expression-panel-auto-setup-desktop.png`, `-mobile.png`.
  - Failure: the inverted-click case fails if the emitted `active` is not negated. Vitest output in `task-5-expression-panel-auto-setup.txt`.
  Commit: Y | feat(stage-ui): slim Live2D expression rows with inverted switches

- [x] 6. Group picker row with readable group names
  Recommended task executor category: visual-engineering - new Vue component plus a pure naming helper and browser tests.
  What to do:
  - `groupDisplayName(labels: string[]): string` lives in `packages/stage-ui/src/components/scenarios/settings/model-settings/expression-group-name.ts`, which todo 5 creates to this spec:
    - Split each label on whitespace.
    - Take the longest leading word sequence shared by all labels (case-insensitive compare, keeping the first label's casing), then drop trailing words that are only digits.
    - If the result has at least 3 characters, return it.
    - Otherwise return the first two labels joined with " / ", plus ` +${n}` when there are more than two.
    - Expected results:
      - `['Chat Icon 1','Chat Icon 2','Chat Icon 3','Chat Icon 4']` -> `Chat Icon`
      - `['Hold Bag 1','Hold Bag 2']` -> `Hold Bag`
      - `['Glasses 1','Glasses 12']` -> `Glasses`
      - `['Black braids','White hair braids','White hair','White ponytail']` -> `Black braids / White hair braids +2`
  - Its node test `expression-group-name.test.ts`, written in todo 5, has those four cases plus a two-member case without a shared prefix.
  - Create `live2d-expression-group-row.vue` with props `group: string`, `members: Entry[]`, and `groups: { name: string, labels: string[] }[]` (forwarded to member entries). It emits `command`.
    - The `Select` carries the `group-select` text as its aria-label.
    - The members toggle button reads `group-members` while closed and `group-members-close` while open.
    - It renders the name `groupDisplayName(members.map(m => m.label))` and a `Select` (from `@proj-airi/ui`) with options None (`group-option-none`) plus each member label.
    - The value is the first member with `active` true, else None.
    - Choosing a member emits `{ type: 'set-active', id, active: true }`.
    - Choosing None emits `{ type: 'set-active', id, active: false }` for each active member.
    - A `group-members` toggle button expands a list of `Live2dExpressionEntry` for each member (passing `groups`) and forwards their `command` events.
  - Create `live2d-expression-group-row.browser.test.ts` next to the component. It mounts the row directly with the same i18n and pinia setup as `live2d.browser.test.ts`. Cases:
    - The picker shows the active member.
    - Choosing another member emits set-active true.
    - Choosing None emits set-active false for the active member.
    - The members expander reveals the member rows.
  - Must NOT do: allow creating or renaming groups, or persist group names.
  Closes: GAP-5; IS-5
  Parallelization: Wave 5 | Blocked by: 2, 3, 4, 5 | Blocks: 7
  References: `live2d-expression-entry.vue:30-50` (`groupLabel`, `groupOptions`), `packages/stage-ui-live2d/src/stores/expression-store.ts:121-133` (activate deactivates group siblings), `packages/stage-ui-live2d/src/utils/expression-catalog/derive.ts:45-98`, `packages/ui` Select usage in `live2d-expression-entry.vue:212-218`, `packages/stage-ui/vitest.config.ts` (node vs browser project includes).
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui exec vitest run src/components/scenarios/settings/model-settings/expression-group-name.test.ts` exits 0.
  - The browser test file for the group row exits 0 on a warm run.
  - `pnpm -F @proj-airi/stage-ui typecheck` exits 0.
  QA scenarios:
  - Happy: a screenshot of the hair group row collapsed and expanded. Evidence `task-6-expression-panel-auto-setup.png`.
  - Failure: the None case asserts exactly one set-active false per active member. Vitest output in `task-6-expression-panel-auto-setup.txt`.
  Commit: Y | feat(stage-ui): show Live2D expression groups as one picker row

- [x] 7. Relevance view in the Expressions panel
  Recommended task executor category: visual-engineering - panel composition, filtering, and browser tests.
  What to do:
  - In `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue` Expressions Section, build a computed `expressionRows` from `expressionSettingsSnapshot.groups` in catalog order:
    - The first member of each distinct non-null `group` produces `{ type: 'group', group, members }`, where members are all entries with that group in catalog order. Later members produce no row.
    - Ungrouped entries produce `{ type: 'entry', entry }`.
  - `inUse(row)`:
    - group rows: true;
    - system entries: `entry.active`;
    - other entries: `entry.active || entry.mappings.length > 0`.
  - Local refs: `showAll = ref(false)` and `search = ref('')`, both unpersisted.
  - Visible rows:
    - When `search.trim()` is non-empty, show every row whose entry label, group display name, or any member label contains it (case-insensitive), ignoring `inUse`.
    - Otherwise show all rows when `showAll` is true, else only `inUse` rows.
  - Render an `Input` (`search` placeholder) above the list.
    - Group rows use `Live2dExpressionGroupRow`; entry rows use `Live2dExpressionEntry`.
    - Below the list, a Button toggles `showAll`. Its label is `show-all` with `count` = number of rows hidden by the in-use filter, or `show-fewer` while showing all. Hide the button when nothing is hidden.
    - Show `none-in-use` when the in-use view is empty, and `no-match` when a search matches nothing.
    - Keep Save defaults and Reset buttons.
  - Remove now-unused English keys from `settings.yaml`: `confirm-all`, `confirmed`, `suggested`, `preview`, `fields.confirmed`. Run `pnpm -F @proj-airi/i18n build`. Orphaned copies of these keys in non-English locales are expected and left for Crowdin.
  - Browser tests in `live2d.browser.test.ts`, using a Bear-like snapshot (anger mapped, coat unmapped, watermark system, hair group of two):
    - The default view shows anger and the hair group row but not coat or watermark.
    - The Show all label shows the number of rows the in-use filter hides, equal to `rows.length - inUseRows.length` for the fixture (coat and watermark: 2). Clicking it reveals coat and watermark.
    - Searching `coat` reveals coat without Show all.
    - A search for `zzzz` shows `no-match`.
    - An active watermark is visible by default.
    - Toggling anger off keeps row order: rows re-queried before and after are in the same order, and anger stays visible because it is mapped.
    - Remote-snapshot mode emits the `live2dExpressionCommand` event, not the local store.
  - Must NOT do: sort rows, persist `showAll` or search, or add kind tabs.
  Closes: GAP-4; IS-4, IS-9
  Parallelization: Wave 6 | Blocked by: 5, 6 | Blocks: F1-F4
  References: `live2d.vue:86-100` (`expressionSettingsSnapshot`, `applyExpressionSettingsCommand`), the Expressions Section template near the end of `live2d.vue`, `live2d.browser.test.ts:112-260`, `packages/ui` `Input`/`Button`, `DESIGN.md`, `.agents/skills/enforce-rules-for-unocss/SKILL.md`.
  Acceptance criteria:
  - `pnpm -F @proj-airi/i18n build` exits 0.
  - `pnpm -F @proj-airi/stage-ui exec vitest run src/components/scenarios/settings/model-settings` exits 0 on a warm run.
  - `pnpm -F @proj-airi/stage-ui typecheck` exits 0.
  - Searching `packages/stage-ui/src` for `expressions.(confirm-all|suggested|preview)'` and `expressions.confirmed'` returns 0 matches.
  QA scenarios:
  - Happy: screenshots of the default view and the Show all view at 1280x1000 and 390x1000. Evidence `task-7-expression-panel-auto-setup-{default,all}-{desktop,mobile}.png`.
  - Failure: the search-no-match case shows the `no-match` text. The guard `expect(t(key)).not.toBe(key)` is present. Vitest output in `task-7-expression-panel-auto-setup.txt`.
  Commit: Y | feat(stage-ui): show only in-use Live2D expressions with search and show-all

- [x] 8. Documentation: README and ADR for automatic expression setup
  Recommended task executor category: writing - README and ADR prose that follows the repo style rules.
  What to do:
  - In `packages/stage-ui-live2d/README.md` Expressions and Expression catalog sections:
    - line 20: a fresh profile starts with the Expression system on;
    - line 27: replace "a confirmed flag" with "a reviewed flag", and add the optional inverted display flag;
    - describe lexicon mappings (face/effect only, negation skip, weight 1, effect minimum band strong, face clear) and default AI access by kind;
    - replace the "Users confirm entries" sentence;
    - change the bullets at 34-35 to kind-based eligibility;
    - change the command list at 38 to `toggle`, `set-active`, `save-defaults`, `reset-all`, `update-entry`, `reset-entry`.
  - Create `docs/ai/adr/2026-10-24-expression-auto-setup.md`, following the structure of `docs/ai/adr/2026-10-19-natural-emotion-revamp.md`. Contents:
    - context (Luke's QA friction);
    - decision (lexicon, no gate, exposure by kind, default on, set-active, relevance view, groups as picker rows, manual inversion);
    - an "Overrides" list naming `2026-10-18-expression-performance.md` lines 194, 204, 220-221, and 237;
    - consequences, including wrong mappings accepted and the effect band;
    - a non-goal: group creation, deferred to a separate UX pass;
    - a Limitations line: the lexicon and group naming cover English and Chinese labels only, and Japanese VTS labels are common.
  - In `2026-10-18-expression-performance.md`, add at each of those four spots a one-line pointer "Superseded by [2026-10-24-expression-auto-setup](2026-10-24-expression-auto-setup.md)." Follow the pointer style at `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md:144`.
  - Must NOT do: edit agent configuration files or other ADRs.
  Closes: GAP-9; IS-11
  Parallelization: Wave 6 | Blocked by: 1, 2, 3, 4 | Blocks: F1-F4
  References: `packages/stage-ui-live2d/README.md:14-40`, `docs/ai/adr/2026-10-18-expression-performance.md:190-240`, `docs/ai/adr/2026-10-19-natural-emotion-revamp.md:1-30`, root `AGENTS.md` Unique Styles.
  Acceptance criteria:
  - Searching `packages/stage-ui-live2d/README.md` for `starts with it off|confirm-all-suggested|Only confirmed` returns 0 matches.
  - The new ADR file exists and links resolve (relative paths checked by `ls`).
  - `pnpm lint` on the changed markdown (via `pnpm verify`) is clean.
  QA scenarios:
  - Happy: a grep listing for `set-active` in the README and ADR. Evidence `task-8-expression-panel-auto-setup.txt`.
  - Failure: the README search for the old phrases returns 0 matches, recorded in the same file.
  Commit: Y | docs(stage-ui-live2d): document automatic expression setup

- [x] 9. Follow-up: rewrite the stale LLM-eligibility doc comment in the performance conductor
  Recommended task executor category: quick - one doc comment in a file todo 1 touched.
  What to do / Must NOT do: In `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts:219`, rewrite the doc comment "Only confirmed, LLM-exposed face, effect, and prop entries ..." so it no longer names confirmation. Keep the rest of the sentence's meaning: only LLM-exposed face, effect, and prop entries qualify. Change no code. Must NOT touch any other line.
  Closes: GAP-9 (stale doc of touched code; found by the todo 1 verifier st_01a16bed)
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: F1-F4
  References: `use-stage-performance-conductor.ts:60` (already rewritten by todo 1), `:219`.
  Acceptance criteria (agent-executable): searching that file for "confirmed" returns 0 matches; `pnpm -F @proj-airi/stage-ui typecheck` exits 0; `pnpm verify` exits 0.
  QA scenarios: Happy: the grep result is 0 matches. Failure: `git show --stat HEAD` lists only that file. Evidence `task-9-expression-panel-auto-setup.txt`.
  Commit: Y | docs(stage-ui): drop the confirmation wording from the LLM eligibility comment

- [x] 10. Follow-up: update the Kirie runtime snapshot test for derived AI exposure
  Recommended task executor category: quick - one stale expectation in one test file.
  What to do / Must NOT do:
  - `apps/stage-tamagotchi-kirie/src-web/src/renderer/composables/model-settings-runtime.browser.test.ts:102` expects `exposedToLlm: false` for an entry that the derived catalog now exposes by kind (todo 2, commit e21f10b8). The todo 9 lane's `pnpm verify` saw it fail: expected false, received true.
  - First reproduce the failure on the current tip and record it. Then update only the expectation(s) that encode the old derived default. Keep every other assertion. Change no product code.
  - Must NOT touch any other file.
  Closes: GAP-9 (failing test of touched behavior; found by the todo 9 lane)
  Parallelization: Wave 2 | Blocked by: 2 | Blocks: F1-F4
  References: `packages/stage-ui-live2d/src/utils/expression-catalog/derive.ts` (`exposedToLlm` by kind), the Kirie test above, `apps/stage-tamagotchi-kirie/vitest.config.ts:38` (browser project includes it).
  Acceptance criteria (agent-executable):
  - `pnpm -F @proj-airi/stage-tamagotchi-kirie exec vitest run --project browser src-web/src/renderer/composables/model-settings-runtime.browser.test.ts` (or the path form its vitest config accepts) exits 0 after the change and failed before it.
  - `pnpm -F @proj-airi/stage-tamagotchi-kirie typecheck` exits 0.
  - `pnpm verify` exits 0.
  QA scenarios: Happy: the post-change run passes with counts. Failure: the pre-change run fails on the exposedToLlm assertion. Evidence `task-10-expression-panel-auto-setup.txt`.
  Commit: Y | test(stage-tamagotchi-kirie): expect derived AI exposure in the runtime snapshot test

- [x] 11. Follow-up: fix ADR pointer rendering and kind wording found by F1
  Recommended task executor category: quick - two markdown edits in files todo 8 touched.
  What to do / Must NOT do:
  - In `docs/ai/adr/2026-10-18-expression-performance.md`, put a blank line before every "Superseded by [2026-10-24-expression-auto-setup](...)" pointer that todo 8 added (four spots). The one after the command table currently renders as an extra table row, and the ones after bullet lists render as list-item continuations. Keep the pointer text unchanged.
  - In `docs/ai/adr/2026-10-24-expression-auto-setup.md`, correct the wording that says the lexicon suggests kinds: kind suggestion (`suggestKind`) already existed and this plan did not change it; the lexicon suggests emotion mappings only.
  - Must NOT change any other line or file.
  Closes: GAP-9 (incorrect docs of touched code; found by F1 st_01a16c88)
  Parallelization: Final follow-up | Blocked by: 8 | Blocks: F1-F4 re-check of the delta
  References: F1 report `.omo/evidence/expression-panel-auto-setup/F1-expression-panel-auto-setup.md`; `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md:144` (pointer style).
  Acceptance criteria: scoped `pnpm exec eslint` on the two files exits 0; `git show --stat HEAD` lists only the two files; each pointer is preceded by a blank line (show with `Select-String -Context`).
  QA scenarios: Happy: the eslint exit and context lines. Failure: the diff shows no other changed line. Evidence `task-11-expression-panel-auto-setup.txt`.
  Commit: Y | docs(stage-ui-live2d): fix ADR pointer rendering and lexicon wording

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Recommended task executor category: unspecified-high
  Check every Must have / Must NOT have against `git diff main...HEAD`. Searching `packages` and `apps` for `confirmAllSuggested` must return 0 matches, and `confirmed` must still be present in both schemas. Evidence `F1-expression-panel-auto-setup.md`.
- [x] F2. Code quality review
  Recommended task executor category: unspecified-high
  Run `pnpm verify`, plus `pnpm -F @proj-airi/stage-shared typecheck`, `pnpm -F @proj-airi/stage-ui-live2d typecheck`, `pnpm -F @proj-airi/stage-ui typecheck`, `pnpm -F @proj-airi/stage-tamagotchi typecheck`, and `pnpm -F @proj-airi/stage-tamagotchi-kirie typecheck`, all exit 0. Review against the `enforce-rules-for-typescript`, `enforce-rules-for-vitest`, and `enforce-rules-for-unocss` skills. Evidence `F2-expression-panel-auto-setup.txt`.
- [x] F3. Real manual QA
  Recommended task executor category: unspecified-high
  In `pnpm dev:tamagotchi`, start with a fresh profile (or `useSettingsLive2d().resetState()`). Import Bear (`C:/Users/Luke/Documents/Live2d Models/bear Pajama V1.1`) per `.agents/skills/use-agent-browser-for-airi/SKILL.md` and `.agents/skills/agent-browser-electron/SKILL.md`.
  Before importing, clear the `localStorage` keys matching `expression-catalog:*` and `expression-rest:*` for Bear, and record the removed key names in the notes file. An earlier hand-edited catalog would mask the lexicon.
  Then verify:
  1. The Expression system is on.
  2. The default Expressions view shows the hair group, the activity group, and the mapped anger, cry, love, red, and Snot bubbles, but not coat, hat, or glasses.
  3. Show all lists every row, with groups collapsed, and the hidden count it showed matches the number of rows that appear. Record the row order before and after one toggle; it must not change.
  4. Searching "coat" finds it. After marking it inverted and applying, the switch reads on with the coat visible, and turning it off hides the coat.
  5. The hair picker switches styles, and None clears them.
  6. With no catalog setup, dispatch an `angry` ACT marker at strong through the motion QA bridge (`dispatchAct` in `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts:150-152`). Anger must become active, read from `store.leases.face` or the performance visualizer devtools page. No LLM provider is needed.
  Take screenshots with `.agents/skills/use-vishot/SKILL.md`. ForBOOTH is covered by Luke's one-rig rule. Evidence `F3-expression-panel-auto-setup/*.png` plus a notes file.
- [x] F4. Ideal-state fidelity
  Recommended task executor category: unspecified-high
  Check IS-1..IS-11 one by one against the delivered behavior and the evidence. A shortfall becomes a new `- [ ] N.` row. Evidence `F4-expression-panel-auto-setup.md`.

## Commit strategy
- One Conventional Commit per todo, in dependency order, each leaving typecheck green (todo 3 removes the Confirm all button for that reason). Commit messages are listed per todo.
- Docs (todo 8) commit with the code branch, not separately from it.
- No agent configuration changes in these commits.
- Branch: `luke/feat/expression-auto-setup`.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 2, 1 | Todo 2 Bear derive script; F3 step 6 | `task-2-expression-panel-auto-setup.json`, `F3-expression-panel-auto-setup/` |
| IS-2 | 1, 3 | Todo 1 eligibility cases; todo 3 store case | `task-1-...txt`, `task-3-...txt` |
| IS-3 | 2, 1 | Todo 2 exposure assertions and `tools/expression.test.ts` derived-enum case; todo 1 prompt test | `task-2-...txt`, `task-1-...txt` |
| IS-4 | 7 | Todo 7 default, Show all, and search cases; F3 steps 2-3 | `task-7-...png`, `task-7-...txt` |
| IS-5 | 6, 7 | Todo 6 picker cases; F3 step 5 | `task-6-...png`, `task-6-...txt` |
| IS-6 | 5 | Todo 5 row screenshot and chip-absence case | `task-5-...png` |
| IS-7 | 1, 5 | Todo 5 inverted-click case; F3 step 4 | `task-5-...txt`, `F3-...` |
| IS-8 | 1 | Todo 1 stored-document and confirm-all profile cases | `task-1-...txt` |
| IS-9 | 3, 7 | Todo 7 order case; todo 3 tamagotchi set-active case | `task-7-...txt`, `task-3-...txt` |
| IS-10 | 4 | Todo 4 settings browser test (default true, stored false kept); F3 step 1 | `task-4-...txt`, `F3-...` |
| IS-11 | 8 | Todo 8 grep | `task-8-...txt` |
