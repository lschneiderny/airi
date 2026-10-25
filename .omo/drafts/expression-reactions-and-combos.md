---
slug: expression-reactions-and-combos
status: plan-approved-by-review
intent: clear
review_required: true
plan_path: .omo/plans/expression-reactions-and-combos.md
plan_sha256: 330342e7a91fd3e9ba08fdee403a53d0446cc107c033101e9709fdf1c6b7468f
review_round_id: r5-mvmrwhs8
review_round_limit: 5
pending-action: none - hand off; execution via /ulw-execute expression-reactions-and-combos
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/expression-reactions-and-combos.md
    round_id: r5-mvmrwhs8
    plan_sha256: 330342e7a91fd3e9ba08fdee403a53d0446cc107c033101e9709fdf1c6b7468f
    launch_id: r5-mvmrwhs8-launch
    session: st_01a16f51
    result: OKAY (round 5 of 5, st_01a16f51), live sha256 re-validated 330342e7a91fd3e9ba08fdee403a53d0446cc107c033101e9709fdf1c6b7468f
approach: one plan, two tracks in dependency order - Track A (catalog data fixes + emotion-first panel on existing entries) lands first, Track B (combos runtime, decider spans, strength, custom expressions, combo UI) builds on it
---

# Draft: expression-reactions-and-combos

## Affected user and ideal state
Affected users:
- Luke (streamer, configures the model in the Expressions tab of the Electron settings window and stage-web), today sees a flat list where moods (Angry) and details (Puff Cheeks) look identical, duplicates appear twice, unrecognized files land under 'face'.
- The AI (LLM) consuming base.prompt.expressions and the set_expression tool: today receives junk 'face' labels (expression19, Bowtie, Bloodstain).
- Viewers watching the model: today an angry beat can render as only puffed cheeks.
- Executors/programmers and other consumers of the catalog contract (Electron cross-window snapshot, Kirie runtime snapshot, qa-tools t3 expression ids, decider traces).

IS rows (ideal state):
- IS-1 | The Expressions tab opens on Reactions: one row per emotion listing every expression that fires for it, so Luke sees what happens when she is angry without opening editors | emotion-first layout decided 2026-10-24
- IS-2 | From a Reactions row Luke selects chips, previews on the model, and saves a combo mapped to that emotion | combos' natural home
- IS-3 | A combo fires through every existing trigger (manual switch, saved defaults, emotion pick, AI set_expression, ACT marker) and its members appear and leave together | seam decision: combo = catalog entry
- IS-4 | A triggered combo replaces conflicting saved defaults and choose-one members while active and restores them when it ends; defaults are never lost | conflict decision
- IS-5 | While a combo holds face and effect, automatic picks do not stack another expression into those slots | slot-span decision
- IS-6 | A combo member can run at partial strength (e.g. Blush 0.7) | per-member strength
- IS-7 | Everything else is grouped by area (whole look, eyes, mouth, cheeks, effects, outfit & hair, props, hidden); choose-one sets render as picker rows; the word 'group' never appears in the UI | two-concepts decision
- IS-8 | Expressions the guesser cannot classify are Unsorted, excluded from AI and automatic picks until Luke sorts them; the AI prompt never lists them | junk-drawer fix
- IS-9 | An expression duplicated across files appears once, with its duplicates noted | ForBOOTH has 4+ duplicate pairs
- IS-10 | A lone detail (Puff Cheeks, Wink) rarely stands in for a whole mood by default | mood-vs-detail
- IS-11 | A model switch no exp3 file exposes (Bear Param7 earphone) can be added as a custom expression and used like any other | parameter granularity analysis
- IS-12 | Existing saved per-model data (curated overrides, rest set) keeps working after the change; nothing a user already curated is silently dropped | Luke's profiles carry curated data
- IS-13 | Electron (remote snapshot + commands) and stage-web (local store) both show and drive the new panel; Kirie/Godot consumers and qa-tools stay correct | cross-window contract
- IS-14 | Decider replays stay deterministic and traces remain readable with combos | shared decider invariant
- IS-15 | ADRs, package README, ui-components context, i18n English strings describe the new behavior | repo convention

GAP rows:
- GAP-1 | IS-1 | live2d.vue:105-164 renders one flat catalog-order list; emotions appear only as a per-row summary line | no emotion-centric view exists
- GAP-2 | IS-2,IS-3 | no combo concept: CatalogEntry has no members (catalog.ts:35-46); curated document only overrides discovered ids (mergeCatalog catalog.ts:82-90) | combos cannot be created or triggered
- GAP-3 | IS-3 | store activates single ids via composer.activate/deactivate (expression-store.ts:122-144; expression-slot-leases.ts:29-63); rest-set load filters to definition ids (expression-store.ts:108) so a combo id would be dropped | no expansion
- GAP-4 | IS-4 | slot activation SKIPS when a same-group conflict is rest/manual owned (expression-slot-leases.ts:37-47); no displaced/restore memory | combos would look half-applied
- GAP-5 | IS-5 | picker/planner occupants track one id per face/effect slot (picker.ts:13-32, planner.ts:26-37); explicit command uses entry.kind -> one slot (selection.ts:104-116) | combos cannot hold several slots
- GAP-6 | IS-6 | composer targetWeight is 0|1 (compose.ts:15) | no partial strength
- GAP-7 | IS-7 | no area field; group rows labelled with 'group' strings (i18n group-select/group-members/fields.group/group-none, settings.yaml:285-374); kind 'face' lumps moods, eyes, mouths, details | layout cannot be by area; 'group' noun visible
- GAP-8 | IS-8 | suggestKind falls back to 'face' (derive.ts:45) and deriveCatalog exposes face to AI (derive.ts:147) -> ForBOOTH expression19/20/22/58/59/60/69/70, Bowtie, Bloodstain reach base.prompt.expressions (use-airi-runtime-prompt.ts:9-22) | junk in AI prompt and picker candidates
- GAP-9 | IS-9 | no duplicate detection; ForBOOTH Param85 (expression22/Blush), cheekpuff (鼓脸/Puff Cheeks), Param82 (expression19/Mask), Param175 (expression69/Tail Off), Param176 (expression70/初始状态) | duplicates shown twice, duplicate pairs form fake choose-one sets
- GAP-10 | IS-10 | suggestMappings gives every face mapping weight 1, minBand clear (derive.ts:47-74); Puff Cheeks/Disdain/Angry all map to angry equally | lone details stand in for moods
- GAP-11 | IS-11 | catalog only built from exp3 definitions (expression-controller.ts:32-76) | Bear Param7 earphone unreachable
- GAP-12 | IS-12 | none today; risk introduced by schema change | must keep stored curated v1 docs and rest sets valid (additive optional fields)
- GAP-13 | IS-13 | snapshot field named groups (expression-store.ts:22-25) consumed by live2d.vue, Electron + Kirie runtime tests; commands union lacks combo/custom variants | contract must grow in both apps
- GAP-14 | IS-14 | decider + traces assume single-slot entries; qa-tools t3 rewrites ids by fileName (expression-ids.ts:14-21) | combos/custom entries need defined trace + QA behavior
- GAP-15 | IS-15 | ADR 2026-10-18 lines on pick-one protection (:231-232) and eligibility (:224-225), auto-setup ADR non-goal 'Group creation remains a separate UX pass'; performance.auto-expressions.description still says 'confirmed' | docs stale after change


## Components (topology ledger)
- C1 | catalog data fixes: unsorted fallback, duplicate merge, area field, mood-vs-detail weighting | active | -
- C2 | emotion-first panel: Reactions, area sections, hidden, choose-one picker rows without 'group' | active | -
- C3 | combo runtime: schema + persistence, desired-set expansion, override-then-restore, member strength in composer | active | -
- C4 | decider slot spanning for combos (shared stage-shared) | active | -
- C5 | combo UI: Combos cards, Make combo from Reactions, member checklist + strength, shared trigger editor | active | -
- C6 | custom single-parameter expressions as a second catalog source | active | -
- C7 | contracts + docs: cross-window snapshot/commands, AI prompt/tool listing combos, Kirie, ADR/README/i18n | active | -

## Open assumptions (announced defaults)
- combo-in-combo forbidden (one-level expansion; no cycles) | reversible
- combos containing an outfit/system/unsorted member are manual + saved-defaults only (no slots -> no AI, no auto pick); AI/auto combos contain only face/effect/prop members | reversible
- combos with a prop member are AI-triggerable but never auto-picked (props are never auto-picked today, selection.ts:13-14)
- shared member strength = max over accepted claims (not sum) | reversible
- planner budget counts a spanning pick as n changes (keeps 'counted per slot', planner.ts:31-33)
- duplicate signature exact (no epsilon); primary = non-generic label > model Name > VTS hotkey > file name > model3-referenced > code-point id; duplicates keep curated overrides (never deleted); primary adopts first duplicate's override when it has none; per-duplicate 'keepSeparate' override promotes it back
- area guess per ultrabrain E with two corrections: add 眼 to eyes tokens; face entry with no region but an emotion-token label -> whole look (Angry 生气按键, Sleepy 犯困)
- detail weight 0.5 = suggested MAPPING weight (picker), not composer strength (Luke's 'Half weight' option text)
- custom expression stored as Add delta = target - parameter default; default target = parameter max; free switch = parameter not written by any exp3 definition, not a Natural/manual/lip-sync channel (Model.vue:710-730, rig-profile channels), not a physics output
- chips: preview button toggles manual activation (set-active); selection checkboxes feed 'Make combo'; rows also offer 'Add expression' (adds mapping at default weight) and remove-mapping
- i18n: English only; 'group' wording replaced (fields.group -> 'Choose one with', group-none -> 'None')
- curated document stays version 1 with additive optional fields; trace version stays 1 (optional members); no compatibility code needed
- snapshot field renamed groups -> entries; adds effective, overriddenBy, via, aliases, area, members, freeParameters
- decider occupant staleness when the store refuses a lease is pre-existing; out of scope, noted as follow-up
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)
### Runtime + decider + AI surface (explore st_01a16f30 + own verification)
- Ownership: expression-store.ts:36-64 ownersOf (rest unless restSuppressed, manual, slot); activate/deactivate :122-144 call composer directly; resetAll :166-174 setActiveSet([]) then reactivate rest; saveDefaults writes manualActive to expression-rest:<modelId> {version:1, active}.
- Slot protection: expression-slot-leases.ts:29-52 activateFromSlot rejects kind mismatch; same-group active conflict is protected if different kind or rest/manual owned -> warn + false (skip); else deactivate conflict, add slot owner, composer.activate. applySlots :65-92 (rejected activation keeps prior lease), tickLeases/onSpeech :94-120, release :54-63 deactivates only if no other owner.
- Composer: targetWeight 0|1, cosine easing, activationSequence retained on reversal, compose in activation order (compose.ts:10-18, 55-117). Production composer callers: expression-store.ts:42,102,131,143,171; expression-slot-leases.ts:50,62,125; expression-controller.ts:75-96. Also qa-tools/src/t2/runner.ts:202-203 constructs a composer.
- Decider: picker.ts:13-32 and planner.ts:26-37 occupants {face, effect} only (prop not tracked); explicitExpressionCommand maps entry.kind -> slot (selection.ts:104-109); candidates isAutoEligible + kind===slot + mapping (selection.ts:45-56); code-point sort + fixed ticket pairs per slot for replay (selection.ts:25-43); trace exact replay (trace.ts:62-70, 99-127); profile.ts applies mapping-weight multipliers to catalog.
- Catalog: catalog.ts:7-10 kinds + llmAllowedKinds; :35-46 entry schema; :92-98 isAutoEligible (face/effect) / isLlmEligible (exposed + allowed kind). curated doc {version:1, overrides} at expression-catalog:<modelId> (expression-catalog-persistence.ts:16-23).
- AI surface: use-airi-runtime-prompt.ts:9-22 groups exposed labels face/effect/prop, :54-70 adds base.prompt.expressions / expression-state; conductor use-stage-performance-conductor.ts:59-64 filters isLlmEligible, :224-239 expression(source,...) resolves label -> AffectSignal (source act|tool) at :236, :495-520 decide -> scene; :580-600 tool port results; tools in packages/stage-ui/src/tools/expression.ts:14-94 (set/clear/list). Model.vue:1507-1514 routes slots to expressionStore.applySlots and speech to onSpeech.
- Derive: derive.ts:24-45 suggestKind (fallback face), :47-74 suggestMappings, :77-124 suggestGroups, :127-155 deriveCatalog (exposedToLlm by kind, confirmed false); tests derive.test.ts.
- Consumers outside stage-ui/live2d: Kirie mirrors Electron: apps/stage-tamagotchi-kirie/src-web/src/shared/model-settings-runtime.ts:1-30 (eventa applyLive2DExpressionSettingsCommand), renderer/composables/model-settings-runtime-owner.ts:48, -snapshot.ts:31-37, pages/index.vue:145 publishes live2dExpressions; same in apps/stage-tamagotchi/src/renderer/composables/model-settings-runtime-{owner,snapshot}.ts and pages/index.vue:225; both have model-settings-runtime browser tests asserting snapshot fields (exposedToLlm etc.). Godot sidecar has no Live2D catalog (VRM only). qa-tools imports CatalogEntry in bin/t2-probe.ts, gates/define.ts, src/motion/gate/{t3-gate,trials}.ts, src/motion/scenario-sink.ts, src/motion/t1/runner.ts (+ more pages), qa-tools/src/t3/expression-ids.ts maps ids->fileName -> any CatalogEntry shape change must typecheck @proj-airi/qa-tools too.
 (explore st_01a16f32 + own verification)
- Expression load: Model.vue:780-812 reads internalModel.settings.expressions, archive settings._expFiles, settings._vtubeData -> expression-controller.ts:32-76 initialise -> store.registerDefinitions(modelId ?? 'unknown', ...) (:76). modelId keys expression-catalog:/expression-rest: localStorage.
- Runtime parameter table: coreModel.getModel().parameters {ids,minimumValues,maximumValues,defaultValues} used by Model.vue:596 readLive2DRigProfile and natural-motion/trace.ts:112-123; composer clamp uses coreModel.getParameterMinimumValue/MaximumValue(index) at expression-controller.ts:90-95.
- cdi3 display names ARE available at runtime: zip loader finds .cdi3.json (live2d-zip-loader.ts:50, :253) and exposes settings._cdiData; Model.vue:596 and :1156 pass it as displayInfo; rig-profile.ts:22-53 resolveCheekParameterId reads displayInfo.Parameters[{Id,Name}].
- Frame order: restoreExpressionBases registered as a 'pre' motion-manager plugin (Model.vue:567); applyExpressions runs in a final plugin (motion-manager.ts:702). So expression output composes after motion/Natural/lip-sync writes each frame (compose.ts:21 contract).
- Other parameter writers: lip sync ParamMouthOpenY (Model.vue:498), manual controls Angle/Eye/Brow/Mouth/Cheek/Body/Breath (Model.vue:710-730, 938-1072), Natural adapter (Model.vue:641-670), touch -> Natural (Model.vue:1266-1402). A custom expression on those params fights them.
- QA: motion-qa skill (T2 headless rigs, T3 rendered Electron, temp APP_USER_DATA_PATH isolation); use-agent-browser-for-airi + references/electron.md (dedicated user-data dir + CDP port); agent-browser-electron (enumerate CDP targets); use-vishot for final captures. Prior plan F3 (.omo/plans/expression-panel-auto-setup.md:473-484): pnpm dev:tamagotchi, fresh profile, import Bear from C:/Users/Luke/Documents/Live2d Models/bear Pajama V1.1, clear expression-catalog:/expression-rest: keys, strong angry ACT via motion QA bridge, evidence F3-*/ *.png + notes.
- Known test caveats (prior plan :82-83): first browser run after import-graph change may 'optimized dependencies changed. reloading' -> rerun once; build i18n before stage-ui browser tests after YAML edits. Known load-flaky: tamagotchi chat viewport test, stage-ui speech-settings.browser.test.ts.
- Prior plan conventions: TL;DR, Scope with IS/GAP, todo pattern (category, What to do, References, Acceptance, QA happy+failure with evidence, Commit: Y | ...), F1-F4, IS->todo->QA->evidence success table (:496-508).

## Decisions (with rationale)
- Test strategy: tests-after (Luke 2026-10-24) + agent-executed QA per todo + independent mutation-probing verifiers
- Detail weighting: half mapping weight 0.5 for eyes/mouth/cheeks face entries; moods (whole look) weight 1 (Luke)
- Duplicates: collapse under a primary, 'also: <label>' shown, hidden from AI and picks, promotable (Luke)
- Custom expressions: free switches only (Luke)
- Unsorted = new ExpressionKind value; combo = new kind 'combo' with members; entrySlots() derived, not stored
- Store: ultrabrain claims/resolve/reconcile model (layers base/slot, seq, masks not deletions, plain slot commands never mask base, combo slot commands mask + restore), composer setTarget/setTargets fractional
- Decider: one SlotCommand per spanned slot, occupants per spanned slot, vacate rule, tickets unchanged
- Two concepts: Combos (user-created, triggerable) vs choose-one sets (a rule; picker row, 'Choose one with' in editor; no 'group' noun) - Luke 2026-10-24
- Combo = catalog entry with members; store expands - Luke
- Conflict: override while active, then restore - Luke
- Slots: combo occupies every slot it spans - Luke
- Layout: emotion-first - Luke
- Combos reference expressions, not raw parameters; parameter-level only via custom single-parameter expressions - analysis: ForBOOTH 81/89 and Bear 20/27 exp3 files write one switch parameter
- One plan for both tracks - Luke 'start the ulw plan for both'; ulw-plan one request -> one plan

## Scope IN
Packages: stage-shared (catalog/combos/selection/picker/planner/trace), stage-ui-live2d (derive, compose, store, leases, persistence, controller, Model.vue threading), stage-ui (panel components, conductor, prompt, tools), qa-tools (t3 ids), apps/stage-tamagotchi + apps/stage-tamagotchi-kirie (snapshot rename consumers + tests), packages/i18n en settings.yaml, docs/ai/adr (new ADR + supersede notes), packages/stage-ui-live2d README.
Planned waves: W1 {1 shared schema+combos helpers, 2 composer fractional}; W2 {3 derive (unsorted/area/dedupe/weights + cdi threading), 4 decider spanning, 5 AI surface + qa-tools}; W3 {6 store claims/reconcile/spanning leases, 7 persistence+commands+custom definitions+snapshot rename incl app consumers}; W4 {8 i18n strings, 9 split live2d.vue expressions section}; W5 {10 combos UI+editor, 11 area sections+unsorted+duplicates+choose-one rows, 12 custom expression creator}; W6 {13 Reactions section, 14 docs/ADR/README}; final F1-F4.

## Scope OUT (Must NOT have)
- no raw parameter editor beyond single-parameter custom expressions
- no combo-in-combo; no user-created choose-one sets; no 'group' noun in UI
- no curated-document or trace version bump; no compatibility shims
- no non-English locale edits (Crowdin owns them)
- no changes to Universal/MAGIC motion selection, VRM/MMD/Spine/Tachie, Godot sidecar
- no decider->store lease feedback channel (follow-up)
- no main-checkout edits during execution (worktree only); untracked .omo files untouched

## Open questions

## Approval gate
status: approved (Luke: Approve, 2026-10-24)
next: on Approve -> scaffold plan, plan-consultant, append todos, TL;DR, self-check, plan-reviewer rounds (max 5)
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

## Plan consultant (st_01a16f40) - folded in
- 1 todo 8 must update slotActive consumers (qa-tools t2 runner :202-216, stage-ui tests :254 / tools :101) + acceptance src/tools, qa-tools src/t2 -> fixed
- 2 todo 7 ExposedExpressionGroup type separate from ExposedExpressionKind (runtime-state.ts:7), combo active via slots -> fixed
- 3 todo 5 token table: 口罩/面罩 -> outfit-hair, cheeks 鼓脸/鼓腮 not bare 鼓 -> fixed
- 4 todo 5 registerDefinitions must load curated before derive; rederive() for keepSeparate -> fixed
- 5 todo 9 pass full parameterIds for custom validation -> fixed
- 6 F3 page-side access (pinia via __vue_app__, bridge runScenario act events, capture for parameter values) -> fixed
- 7 F3 teardown via pnpm dev:top kill + pnpm wt ls -> fixed
- 8 todo 13 dynamic key prefixes kinds/emotions/bands/areas -> fixed
- 9 todo 8 may edit SlotLease/createLease in slots.ts (claimSequence only) -> fixed
- 10 toggle vs set-active semantics: DEFAULTED (reversible) - switch shows own claim; switching off a masked entry removes its claim; toggle = set-active(!hasClaim); reassert rules dropped. Surfaced in TL;DR 'Decisions to sanity-check'.
- 11 unsorted kind select also sets exposedToLlm by kind and opens the editor -> fixed
- 12 line drift corrected (bridge :161-167/:166, dispatchAct :40/:152, group-select already 'Choose one')
## Review rounds
- r1-mvmrk965: plan_sha256 b36bd3ad067820db5c41d4786824676a39500492b80ddbb831d2ff7d477f03a7; plan-reviewer st_01a16f49 -> REJECT (changes_requested)
  - Frozen blocker ledger (round 1):
    - B1 (IS-4, IS-6): F3 used an outfit-only combo 'Braids' through ACT, but outfit combos have no slots and are not AI/ACT-eligible -> F3 rewritten: slot restore + strength proven on the ForBOOTH face combo 'Shy' (expression22 + Spiral Eyes) over saved Blush (same face choose-one set, Param85); 'Braids' restore proven through its manual switch.
    - B2 (IS-1, IS-11): todo 12 sent update-entry for custom ids, which todo 9 ignores -> todo 12 routes combo:/custom:/other ids to update-combo/update-custom/update-entry for add and remove; todo 9 adds update-custom mapping persistence test; todo 12 browser tests for custom routing; success rows IS-4/6/11/12 updated.
- r2-mvmrncnf: plan_sha256 df0074dc86c4971391eeaeada7494a2919e2b34a79e036ee3bd72f8dbf7d0564; plan-reviewer st_01a16f4b -> REJECT (changes_requested); B1, B2 not re-raised (closed)
  - B3 (IS-11, regression from the B2 fix): F3 step 8 mapped the new 'Earphones' custom to happy from Reactions, but it is unsorted and the picker excludes unsorted -> F3 step 8 now: create -> appears in Unsorted -> classify as outfit via the Unsorted kind Select -> switch on -> add to manual combo 'Braids' -> step 9 persistence; the Reactions custom-mapping path stays proven by todo 9/12 tests with a custom face fixture; todo 12 test asserts picker offers custom face but not custom unsorted/outfit.
- r3-mvmrqbkd: plan_sha256 991dfeebfc9abf9f55fa1203771ce0a635e2c12d914021790e78a9a19723a381; plan-reviewer st_01a16f4d -> REJECT (changes_requested); B3 not re-raised (closed)
  - B4 (IS-11, regression from the B3 fix): F3 8.3 left Earphones manually claimed, then expected Braids release to hide it; todo 8 keeps independent base claims -> Earphones is switched off (active false) before being added to Braids; assertion via 'via' then hidden after Braids off. Re-checked steps 5-7 against the claims rules: consistent.
- r4-mvmrsxhz: plan_sha256 9c10382426558ee1e96ce740fc72889c20d423e7922b2e4126258eee152a6497; plan-reviewer st_01a16f4f -> REJECT (changes_requested); B4 not re-raised (closed)
  - B5 (IS-13): todo 9 cited non-existent apps/stage-tamagotchi-kirie/src-web/package.json -> Kirie commands use package root apps/stage-tamagotchi-kirie with --project browser src-web/src/renderer/composables/model-settings-runtime.browser.test.ts (verified vitest.config.ts browser include); F2 names the Kirie typecheck and both runtime browser tests; stage-tamagotchi runtime test gets --project browser (its node project include src/**/*.test.ts also matches *.browser.test.ts). Pre-submit scan: all 50+ pnpm -F package names and test paths exist; only cited missing files are ones the plan creates.
- r5-mvmrwhs8: plan_sha256 330342e7a91fd3e9ba08fdee403a53d0446cc107c033101e9709fdf1c6b7468f; plan-reviewer st_01a16f51 -> OKAY (unconditional, no notes). Live plan sha256 re-validated equal before handoff.
## Convergence ledger
- rounds: 5 of 5; accepted blockers B1-B5 all closed; non-blocking notes: none
- consultant findings 1-12 folded; finding 10 defaulted (switch-off removes own claim) and surfaced to Luke in TL;DR
## Notepad (session working log, copied before RUN_TMP removal)
### Ultrawork Notepad — ulw-plan: expression reactions panel + combos (one plan, tracks A and B)
Started: 2026-10-24T18:29:18.564Z

#### Plan (exhaustively detailed)
ulw-plan workflow: discovery wave -> ideal state/gaps -> intent verdict -> forks -> approval brief -> write plan -> plan-reviewer loop.

#### Success criteria + QA scenarios
(planning session) Plan file .omo/plans/<slug>.md exists, decision-complete, structural self-check passes, plan-reviewer OKAY recorded.

#### Now
bootstrap

#### Todo

#### Findings

#### Learnings

#### Now
discovery wave running: explore st_01a16f30 (runtime) st_01a16f31 (ui) st_01a16f32 (model/QA), architect st_01a16f33, ultrabrain st_01a16f34
#### Findings
- draft scaffolded at C:/Users/Luke/projects/dtuber/.omo/drafts/expression-reactions-and-combos.md; main checkout dirty only with untracked .omo files (dirty_worktree risk: keep out of scope)
- stance: batch (episode 2026-10-24 expression panel plan, same domain)

- forks answered: tests-after, half weight, collapse, free switches
- ultrabrain spec A-F adopted with corrections (no trace bump; 眼 token; emotion-label -> whole look)
#### Now
approval gate

#### Now
review round 1 in flight st_01a16f49 sha b36bd3ad067820db5c41d4786824676a39500492b80ddbb831d2ff7d477f03a7
 (closure scope: B4 and regressions) (closure scope: B3 and regressions) (closure scope: B1, B2, regressions from the fixes)
