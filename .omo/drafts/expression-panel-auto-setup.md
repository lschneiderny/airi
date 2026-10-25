---
slug: expression-panel-auto-setup
status: reviewed-approved
intent: clear
review_required: true
plan_path: .omo/plans/expression-panel-auto-setup.md
plan_sha256: 8887ef811ce3f233ca07c336d5d226dfe0f2ab8288d987c173dbd5f0733aa131
review_round_id: r1-mvlt3v3u
review_round_limit: 5
pending-action: write and review .omo/plans/expression-panel-auto-setup.md
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/expression-panel-auto-setup.md
    round_id: r1-mvlt3v3u
    plan_sha256: 8887ef811ce3f233ca07c336d5d226dfe0f2ab8288d987c173dbd5f0733aa131
    launch_id: L1-st_01a16bd5
    session: st_01a16bd5
    result: "[OKAY] executable; references relevant; every IS row maps to delivering tasks and QA; no blocking contradictions (round r1, 1m32s)"
approach: Make Live2D expression setup hands-off (label-lexicon emotion mappings, no review gate, LLM exposure by kind) and make the single Expressions panel show relevant entries (in-use default view with Show all and search, groups as one picker row with readable names, slim rows, manual inverted display). Group creation is out of scope.
---

# Draft: expression-panel-auto-setup

Stance: one-by-one (one prior planning-style episode in this repo: Luke picked recommended options on one-by-one forks). Luke answered a 4-question batch this session without friction.

## Affected user and ideal state
Users:
- U1: Luke (and any AIRI user) loading a Live2D model with many exp3 files (Bear 29, ForBOOTH 89) in Tamagotchi or stage-web, opening Settings > Models > Expressions. Today: every entry is a full card in one flat list, nothing fires automatically until each entry is confirmed and mapped by hand, groups show file names, and switches for "remove" expressions read backwards.
- U2: The performance conductor, picker, and LLM prompt (programs) consuming the catalog via `isAutoEligible` / `isLlmEligible` / `llmEligibleEntries`.
- U3: The Electron settings window consuming `Live2DExpressionSettingsSnapshot` and sending `Live2DExpressionSettingsCommand` over eventa (`apps/stage-tamagotchi/src/shared/model-settings-runtime.ts`).

| id | ideal-state property | reason |
| --- | --- | --- |
| IS-1 | On a fresh model, expressions whose labels name an emotion are mapped to it and fire automatically with no user action. | Luke: hands-off setup; some wrong mappings beat per-entry setup. |
| IS-2 | No review/confirm step gates automatic picking or LLM use. | A gate defeats hands-off setup. |
| IS-3 | Face, effect, and prop entries are available to the LLM by default; outfit and system never are. | Luke's answer "Faces, effects, props". |
| IS-4 | The default panel view lists only relevant entries (active, emotion-mapped, grouped), with system entries hidden unless active; "Show all (N)" and a search box reach the rest. | Luke: the main issue is showing relevant entries; chose "In use + Show all". |
| IS-5 | Each pick-one group is one row with a readable name and a picker (members + none). | Groups as a field showing file names was confusing; Luke likes groups. |
| IS-6 | A row shows label, emotion summary, AI access, and an on/off switch; kind/group/status move into the editor. | Reduces crowding. |
| IS-7 | A user can mark an entry inverted so its switch shows "on" when the expression is inactive (e.g. Bear coat shown). | Luke chose manual flip only. |
| IS-8 | Existing curated catalogs and rest sets keep loading; no stored data is discarded. | No data loss for current profiles. |
| IS-9 | Rows do not reorder while toggling; the Electron settings window behaves the same as the in-renderer panel. | Stability and cross-window parity. |
| IS-10 | Docs (README, ADR) describe the new defaults. | Root rule: docs with code. |

| id | gap | reason | closed by |
| --- | --- | --- | --- |
| GAP-1 | `deriveCatalog` sets `mappings: []` (derive.ts:107-118). | no lexicon | todo: lexicon mappings |
| GAP-2 | `isAutoEligible`/`isLlmEligible` require `confirmed` (catalog.ts:88-94); derived `confirmed: false`. | gate | todo: drop gate |
| GAP-3 | derived `exposedToLlm: false`. | default | todo: exposure default |
| GAP-4 | Panel renders every entry as a card (live2d.vue v-for over snapshot.groups). | no filter | todo: relevance view |
| GAP-5 | Group label is `group:<first member id>` stripped to a file id (live2d-expression-entry.vue:34-37, derive.ts:93-95). | naming | todo: group rows |
| GAP-6 | No inverted field in CatalogEntry/CuratedOverride (catalog.ts:33-58). | missing field | todo: inverted |
| GAP-7 | Group "none" needs an explicit deactivate; `toggle` only checks `manualActive` (expression-store.ts:143-148), so a slot-owned active entry would be re-activated, not cleared. | command gap | todo: set-active command |
| GAP-8 | Expression system defaults off (live2d.ts:104), so a fresh profile gets none of this. | default | pending fork |
| GAP-9 | README/ADR describe confirmed gating and the off default. | docs | todo: docs |

## Components (topology ledger)
| id | outcome | status | evidence |
| --- | --- | --- | --- |
| C1 | Automatic setup: lexicon mappings, no confirmed gate, exposure by kind | active | derive.ts, catalog.ts |
| C2 | Relevance view: in-use filter, Show all, search, slim rows | active | live2d.vue, live2d-expression-entry.vue |
| C3 | Groups as one picker row with readable names | active | derive.ts suggestGroups, expression-store activate |
| C4 | Manual inverted display | active | catalog.ts schemas |
| C5 | Group creation/renaming | deferred (Luke: separate UX pass) | - |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| Fate of `confirmed` | Keep the persisted field (no schema break, no data loss); eligibility ignores it; it becomes a "reviewed" marker set by editor Apply; remove the row chip and the "Confirm all suggested" button. | Avoids discarding stored curated docs (strictObject) and avoids compat code. | yes |
| Exposure scope | All face/effect/prop entries, mapped or not. | Literal reading of Luke's answer; prompt grows by about 50 labels on ForBOOTH. | yes |
| Lexicon | English + Chinese tokens in derive.ts; weight 1; minBand from the existing kind default (effect strong, else clear). | Reuses resolveMappings. | yes |
| Group name | Shared leading words of member labels (e.g. "Chat Icon", "Hold Bag"); otherwise the first two labels joined with " / " plus "+N". | Readable without user input. | yes |
| Group row control | Select with "None" + members; uses a new `set-active` command. | Fixes GAP-7. | yes |
| Ordering | Catalog order, stable; no active-first sorting. | IS-9. | yes |
| Test strategy | Tests-after: update the derive, catalog, store, and panel browser tests; rendered check on Bear only (Luke's one-rig acceptance rule). | Repo keeps these tests. | yes |

## Findings (cited - path:lines)
- derive.ts:100-121 deriveCatalog defaults; kind rules derive.ts:27-32; groups derive.ts:45-98.
- catalog.ts:88-94 eligibility; CuratedOverrideSchema catalog.ts:51-59 strictObject.
- expression-store.ts:121-148 activate/deactivate/toggle; commands :28-34.
- expression-catalog-persistence.ts:39-46 confirmAllSuggested.
- live2d.vue expressions Section; live2d-expression-entry.vue full card.
- live2d.ts:104 `settings/live2d/expression-enabled` default false; README:20 documents it.
- autoExpressions defaults true (settings.ts:198).
- Prompt lists exposed labels (use-airi-runtime-prompt.ts:52-65).
- Bear labels: about 6/29 lexicon hits; ForBOOTH: about 20/78. Bear coat.exp3 Param22=1 hides the coat; the label word cannot reveal that.
- Tests: derive.test.ts:42-43, catalog.test.ts:43-50, picker.test.ts:85, use-airi-runtime-prompt.test.ts:40, expression-store.test.ts:49-63, live2d.browser.test.ts.
- Unrelated dirty paths: .omo/drafts|plans/live2d-cursor-touch-integration.md (keep out of scope).

## Decisions (with rationale)
- One panel, no split (Luke).
- Hands-off over accuracy (Luke).
- Default view: in use + Show all (Luke).
- AI access: faces, effects, props (Luke).
- Inversion: manual flip only (Luke).
- Plan both auto-setup and relevance view together (Luke).
- Group creation deferred (Luke).

## Scope IN
C1-C4, docs, tests.

## Scope OUT (Must NOT have)
- No group creation/renaming UI, no new panel split, no visibility measurement for inversion.
- No changes to picker/planner selection logic beyond eligibility.
- No other locales edited.
- No change to Natural, VRM, or MMD.

## Open questions
- Q1 resolved 2026-10-24: Expression system on by default (Luke).

## Review ledger
- plan-consultant spawn refused by the harness plan-gate (the ulw-plan workflow was not requested in Luke's own words). Self-review was done instead and added the conductor consumers (use-stage-performance-conductor.ts:63,225) to todo 1.
- plan-reviewer: not run, for the same gate. It is pending until Luke requests the review in his own words.

## Approval gate
status: approved 2026-10-24 (Approve; Expression system on by default)
next: on approval, write .omo/plans/expression-panel-auto-setup.md, run plan-consultant, then plan-reviewer rounds (max 5).

- 2026-10-24: Luke requested the review in his own words. plan-consultant st_01a16bc9 completed with 22 findings: 20 folded, 1 needed no change (17), and 1 declined (15). Round r1-mvlt3v3u was initialized at sha 8887ef811ce3f233ca07c336d5d226dfe0f2ab8288d987c173dbd5f0733aa131.
- Round r1-mvlt3v3u completed: plan-reviewer st_01a16bd5 returned [OKAY] with no blockers. The live sha 8887ef811ce3f233ca07c336d5d226dfe0f2ab8288d987c173dbd5f0733aa131 matches the round sha. Convergence ledger: 0 accepted blockers, 0 notes, 1 round.
