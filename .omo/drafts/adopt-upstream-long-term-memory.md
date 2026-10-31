---
slug: adopt-upstream-long-term-memory
status: drafting
intent: clear
review_required: true
plan_path: .omo/plans/adopt-upstream-long-term-memory.md
plan_sha256: 21bafc22642e8724768bc63ec00a15a4be356363c59ab9da9a19a735264528e9
review_round_id: r4-d51f1f16
review_round_limit: 5
pending-action: none (plan approved; execution via /ulw-execute adopt-upstream-long-term-memory)
round_status: approved
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/adopt-upstream-long-term-memory.md
    round_id: r4-d51f1f16
    plan_sha256: 21bafc22642e8724768bc63ec00a15a4be356363c59ab9da9a19a735264528e9
    launch_id: r4-d51f1f16-launch
    session: st_01a18e7f
    result: OKAY (unconditional approval, 2026-10-30; note: live QA depends on a configured tool-capable provider, already handled by todo 16 pre-step)
approach: Port upstream's long-term memory subsystem alone (types, IndexedDB repo, store, tools, settings page, i18n, tests) into the fork at upstream's exact paths and names, wire the index into the per-step system prompt and the tools into the per-run tool list in chat.ts, allow only builtIn_readMemory in unprompted turns, keep the situation gate (no recipes/automations), bundle memories with card export and delete, and feed the index to Spark Notify and autonomous artistry prompts; add memory tool cases to local-model eval and a devtools memory panel.
---

# Draft: adopt-upstream-long-term-memory

## Affected user and ideal state
**Affected users**
- U1 Luke as the owner talking to a character (Tamagotchi desktop, stage-web). Today: the character forgets everything between sessions; the only ambient context is the 500-char situation block. After: each card remembers facts he states, recalls them in normal and unprompted turns, and he manages what is remembered in Settings.
- U2 The character run (the model, as an agent consuming the prompt and tools). Today: no memory index, no memory tools. After: the index sits after the identity in every step's system prompt; read/write/forget tools in owner turns; read-only in unprompted turns.
- U3 Luke as developer/evaluator. Today: no way to see what memory reached a turn, no eval of memory tool use by local models. After: devtools shows the index and per-turn memory tool calls; ollama-bench exercises the memory tools.
- U4 Future upstream syncs (the programmer merging moeru-ai/airi later). After: memory files live at upstream's paths with upstream's names, so the next sync is a near no-op for them.

| IS | Property | Reason |
| --- | --- | --- |
| IS-1 | In an owner conversation the system prompt of every model step is `systemPromptFrom(identity, stageContract) + composeMemoryPrompt(indexFor(card))` when `memory.enabled`, and the run tools include builtIn_readMemory/writeMemory/forgetMemory bound to the session's card; with `enabled=false` neither the index nor the tools reach the run | U2 can use memory; U1's toggle is absolute |
| IS-2 | A fact the character saves persists across app restart and appears in every window (chat, settings) without reload; a settings removal or make-general is never undone by a chat write from a window that has not read it yet | IDB + BroadcastChannel + navigator.locks, as upstream |
| IS-3 | An unprompted (situation-gate) turn carries builtIn_readMemory and no other tool; writeMemory/forgetMemory never appear in an unprompted request; hold/decline/`<\|SILENT\|>` semantics unchanged; a declined turn leaves no memory change | reach-outs can recall facts without side effects before the turn is decided |
| IS-4 | Settings > Modules > Long-term memory shows the enable toggle and a Memories page listing general entries first then one group per card (name or id), each entry with description/body, make-general (own entries only) and forget buttons, an empty state; the WIP placeholder is gone | U1 reviews and curates memory |
| IS-5 | Delete all data and Reset modules clear every memory record including tombstones and reset `memory/enabled` | no leftover personal data |
| IS-6 | Deleting a card removes its memories; exporting a card bundles its own (non-general) memories as `memories.json` referenced from an optional manifest field; importing restores them under the new card id; a v1 package without memories still imports | memories belong to the card |
| IS-7 | Spark Notify's system prompt and the autonomous artistry director prompt include the active card's memory index when memory is enabled | the character's other model calls know what she knows |
| IS-8 | A devtools Memory page shows the enabled flag, the index per card, and the last N memory tool calls (turn, tool, ids, outcome) | U3 can debug what memory did in a turn |
| IS-9 | `scripts/ollama-bench` includes the three memory tool definitions, a memory index in the system prompt input, a turn that should write a fact and a later turn that should read it; the JSONL records the tool calls so a model's memory tool-use is comparable | U3 picks local models that handle strict memory schemas |
| IS-10 | `docs/ai/upstream-watch.md` records that memory was ported and why recipes/automations stay out; a fork ADR in `docs/ai/adr/` records the adoption and the fork-specific deviations (unprompted read-only, card bundling, no legacy move); stage-ui README/AGENTS name the memory store; i18n EN keys exist | docs with code, per repo rules |
| IS-11 | Ported unit and browser tests pass; chat contract tests cover index + tools + enabled off + unprompted read-only; `pnpm verify` green; no `any`, kebab-case, no compat guards | repo quality bar |

| GAP | Difference from today | Reason | Closed by |
| --- | --- | --- | --- |
| GAP-1 | No memory types/repo/store/tools exist in the fork | never imported | todos 1-4 |
| GAP-2 | chat.ts builds the system prompt without a memory index and the tools callback without memory tools; first send does not await memory.ready() | not wired | todos 5-6 |
| GAP-3 | Runtime passes `tools: undefined` for unprompted turns (runtime 1189) and drops toolReferences (855) | blanket rule | todo 7 |
| GAP-4 | memory-long-term.vue is `<WIP />`; no memories page; i18n keys missing | placeholder | todos 8-9 |
| GAP-5 | use-data-maintenance resets no memory | not wired | todo 10 |
| GAP-6 | removeCard leaves orphan entries; export/import ignore memories | not wired | todos 11-12 |
| GAP-7 | Orchestrator store L180 and artistry L92-128 build prompts without memory | not wired | todo 13 |
| GAP-8 | No devtools memory visibility | none | todo 14 |
| GAP-9 | ollama-bench tools.json lacks memory tools; no memory turns | none | todo 15 |
| GAP-10 | upstream-watch entry stale; no ADR; README/AGENTS silent | docs | todo 16 |

## Components (topology ledger)
| id | outcome | status | evidence |
| --- | --- | --- | --- |
| C1 memory-core | types, IDB repo (+mock), store, tools, composeMemoryPrompt at upstream paths, unit + browser tests green | active | packages/stage-ui/src/{types,stores,tools}/memory.ts, database/repos/memory.repo.ts |
| C2 chat-wiring | index in per-step system prompt, tools in owner turns, ready() awaited, enabled toggle honored, read-only tool in unprompted turns (runtime option) | active | stores/chat.ts, core-agent runtime |
| C3 settings-ui | long-term memory page + memories page + i18n EN; delete-all/reset clears memory | active | stage-pages settings/modules, use-data-maintenance.ts |
| C4 card-lifecycle | card delete removes memories; export bundles, import restores | active | airi-card.ts, airi-card-import-export.ts |
| C5 other-prompts | Spark Notify + artistry director get the index | active | character/orchestrator/store.ts, artistry-autonomous.ts |
| C6 dev-visibility | devtools memory page; ollama-bench memory cases | active | stage-pages devtools, scripts/ollama-bench |
| C7 docs | upstream-watch, fork ADR, README/AGENTS | active | docs/ai |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| Legacy localStorage move | Omit upstream's `moveLegacyEntries` NOTICE block | the fork never shipped `memory/entries` in localStorage | yes |
| Where the index joins the prompt | In chat.ts `prepareSend` systemPrompt resolution (`getSessionSystemPrompt(...) + composeMemoryPrompt(...)`), not inside session-store `systemPromptFrom` | keeps the stage-contract hash tests from model-eval byte-identical; mirrors upstream placement after identity | yes |
| Unprompted read-only mechanism | New runtime send option `unpromptedTools?: StreamOptions['tools']` passed as `tools` only when `origin === 'unprompted'`; toolReferences stay dropped; chat.ts supplies `[readMemoryTool]` | explicit allowlist, no generic bypass of the blanket rule | yes |
| Card package shape | Keep manifest `version: 1`; add optional `resources.memories: { path: 'memories.json' }`; file holds `MemoryWrite[]` (description, body) of the card's own entries; general entries excluded | optional field = no version bump, no compat guard, old packages validate | yes |
| Card delete | `removeCard` calls `memory.remove` for every entry with `persona === id` before deleting the card | simplest; matches 'memories belong to the card' | yes |
| Devtools shape | New page `packages/stage-pages/src/pages/devtools/memory/index.vue` fed by a small `stores/devtools/memory-observability.ts` store that chat.ts notifies from the tool bindings | mirrors situation-observability pattern | yes |
| Settings search sidecar | Do not port `memory-long-term-memories.search.ts` | the fork has no settings search (#3112/#3159 not imported) | yes |
| Locales | English only; no zh-Hans edits | fork rule: other locales frozen | n/a |
| `memory/enabled` default | true, as upstream | memory is the point of the feature | yes |
| Test strategy | Tests after, with ported upstream tests landing in the same todo as their module (confirmed at gate) | Luke chose tests-after on 2026-10-29 | n/a |

## Findings (cited - path:lines)
- Upstream HEAD 324f8547c (v0.14.1); fork merge-base f3e6a244e (2026-10-14). Memory commits: d70ab4dd3 (#2748, 75 files, memory bundled with recipes/decisions/tasks/scenes) and 2c4d66c6b (#3241, IndexedDB). merge-tree dry-run of #2748 vs main: 18 conflicting files (chat.ts, session-store.ts, chat-orchestrator-runtime.ts, core-agent types/chat.ts, 3x App.vue, history.vue, Stage.vue, wire-message.ts, i18n stage.yaml, character orchestrator store, chat-session types, 3 tests). Full upstream merge: 582 conflicting paths. => cherry-pick is not viable; port by hand.
- Upstream memory files (upstream/main): packages/stage-ui/src/types/memory.ts (MemoryEntry{id,description,body,persona?,updatedAt}, MemoryWrite{id?,description,body}); packages/stage-ui/src/database/repos/memory.repo.ts (localforage instance name 'airi-memory' store 'entries', navigator.locks 'airi:memory', tombstones {id,updatedAt,deleted:true}, list/add/write/makeGeneral/forget/remove/clear); __mocks__/memory.repo.ts (Map-backed for Node tests); stores/memory.ts (useMemoryStore: enabled via useLocalStorageManualReset 'memory/enabled' default true, BroadcastChannel 'airi:memory', ready(), indexFor(persona) => 'Your own:\n- id: desc' + 'General:\n...', read/write/makeGeneral/forget/remove/resetState; moveLegacyEntries NOTICE for localStorage 'memory/entries'); tools/memory.ts (READ/WRITE/FORGET_MEMORY_TOOL_NAME = builtIn_readMemory/writeMemory/forgetMemory, composeMemoryPrompt(index), createMemoryTools({read,write,forget}) with valibot strictObject + xsschema toJsonSchema, nullable id); tests tools/memory.test.ts (3 cases) and stores/memory.browser.test.ts (6 cases, localforage + two-window race).
- Upstream chat.ts wiring: personaOf(sessionId) = sessionMetas[sessionId]?.characterId || activeCardId || 'default'; sessionSystemPrompt = composeSystemPrompt(identity) + (memory.enabled ? composeMemoryPrompt(memory.indexFor(persona)) : ''); withRunTools appends createMemoryTools bound to persona when memory.enabled; first send awaits memory.ready().
- Upstream settings: modules/memory-long-term.vue (FieldCheckbox enabled + RouterLink cards to -recipes and -memories), modules/memory-long-term-memories.vue (groups: general first then per card, GhostButton make_general/forget, data-settings-search sidecar memory-long-term-memories.search.ts), settings/memory/index.vue is WIP upstream too. i18n en settings.yaml keys under settings.pages.modules.memory-long-term: description, enable, enable-description, memories.{title,description,empty,forget,make_general,general,entry.{title,description}}.
- Upstream use-data-maintenance.ts: resetModulesSettings includes memoryStore.resetState() (line 87) with comment 'Memories and recipes hold what the character learned about the owner.'
- Upstream contract test (chat.contract.test.ts 640-672): mocks '../database/repos/memory.repo', asserts tool names include builtIn_writeMemory, prompt contains own + general index lines and not another card's, and enabled=false removes tools and index.
- Fork deps already present in packages/stage-ui/package.json: @xsai/tool, localforage, uuid (catalog ^14.0.2, v7 available), xsschema. No dependency change needed.
- Fork chat.ts: runtimeContextProviders [situationContextMessage] (line ~753); prepareSend (945-1035) reads chatSession.getSessionSystemPrompt(payload.sessionId) at 1007 and builds systemPromptSupplement; submitUnprompted (1112+) uses i18n base.prompt.unprompted / unprompted-forced and trigger text '(No one spoke to you. You may speak up about: <topic>)'.
- Fork session-store.ts 241-245: getSessionSystemPrompt(sessionId) = systemPromptFrom(cards.getSystemPrompt(characterId ?? current), stageContract) re-read before each model step; generateInitialMessageForSession stores a system message in history (line 247-254).
- Fork core-agent chat-orchestrator-runtime.ts: line 855 `...(options.toolReferences?.length && !unprompted ? { tools: options.toolReferences } : {})`, line 1189 `tools: unprompted ? undefined : options.tools` with comment 'An unprompted turn may only speak or decline. Tool effects would run before the turn is decided.'
- Fork settings: packages/stage-pages/src/pages/settings/modules/memory-long-term.vue is `<WIP />` placeholder; memory-short-term.vue and settings/memory/index.vue exist. No 'memory' refs in stage-layouts settings.vue.
- Fork memory-adjacent features: situation store + sensors (context, conversation, desktop, foreground, minecraft, notify, stage), situation gate in stage-shared/src/situation/gate.ts (code-only decision), spark-notify agent (core-agent/src/agents/spark-notify) with host-built systemPrompt in stores/mods/api/spark-notify-reaction.ts, artistry-autonomous.ts director prompt lines 92-130 built from activeCard.personality, airi-card-import-export.ts service, devtools stores situation-observability/context-observability/act-compliance.
- Fork never shipped localStorage 'memory/entries' => upstream's moveLegacyEntries NOTICE block is not needed in the port (announced default).

## Decisions (with rationale)
- D1 Port memory alone at upstream paths/names; no recipes, decisions, background tasks, scene bindings (user, 2026-10-30). Cherry-pick impossible: #2748 conflicts in 18 files and bundles memory with recipes.
- D2 Unprompted turns get builtIn_readMemory only (user). Reads have no effects, so the 'nothing before the turn is decided' rule holds.
- D3 Keep the situation gate; do not import upstream automations (user). Two deciders for unasked speech would conflict.
- D4 Card export bundles the card's own memories; card delete removes them (user).

## Scope IN
- C1-C7 above, English i18n, tests ported and extended, docs (upstream-watch, ADR, README/AGENTS for stage-ui).

## Scope OUT (Must NOT have)
- Recipes, decisions (`builtIn_judge`), background tasks/notices, scene bindings, automations/auto-run, `builtIn_armRecipe`, recipes settings page.
- Settings search sidecar files; any zh-Hans or other locale edits.
- Cloud/chat-sync of memories; memory in `wire-message.ts`.
- Changes to the situation gate thresholds, situation render, or unprompted prompt wording beyond nothing (index already in system prompt).
- Memory in short-term memory page; changes to `settings/memory/index.vue` beyond nothing.
- A localStorage legacy migration.
- Any version bump of the card package format or a compat guard for it.
- Dependency or lockfile changes (all deps present).

## Open questions

## Approval gate
status: approved (2026-10-30, "Approve"; tests: "Tests after")
approach: see frontmatter `approach`. Post-approval: scaffold plan, plan-consultant gap analysis, append todos (16 impl + F1-F4), fill TL;DR, then plan-reviewer rounds until unconditional approval.
test strategy: tests after (confirmed by user).
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

## Plan consultant (2026-10-30)
Session st_01a18e6f. 15 findings; folded in: F1 (contract beforeEach turns memory off; exact-equality assertions protected), F2 (prompt order identity -> contract -> memory everywhere; IS-1 reworded), F3/F4 (devtools registration in apps/*/settings/system/developer.vue; keys under tamagotchi.settings.devtools.pages.memory), F5 (named CardDetailDialog.vue and airi-card/index.vue callers + browser test), F6/--project flags, F7 (no artistry test file, no extra sentence), F8 (todo 12 owns observability wrapping + origin threading), F9 (only bench.ts/sweep.ts load tools.json; no tests), F10 (core-agent README update unconditional), F11 (memories page titleKey), F12 (upstream has add(); F1 verifier wording), F13 (IS-1 notes rules text with empty index), F14 (todo 16 provider pre-step). Own finding added: stage-ui llm.ts:33 is a second unprompted tool gate (resolves [] for origin unprompted); todo 5 now changes it to resolve custom tools only, with llm.test.ts cases; todo 5 category raised to deep-high.

## Review ledger
- Round r1-d1b3a8bd: plan_sha256 387fc6d1726ab4658df05fa21351c8d6d28aff87827521825509bb9952dc5ef4; status changes_requested (session st_01a18e77, REJECT). Blockers accepted into the ledger: B1 todo 16 step 5 tested history not the toggle -> fixed: fresh session, prompt projection without 'Long-term memory.', steps 6-7 added, F3 and IS-1 row updated; B2 IS-7 cited artistry tests that todo 11 excluded -> fixed: todo 11 adds artistry-autonomous.test.ts capturing streamFrom for both director variants, enabled/disabled, card isolation; IS-7 row updated. Ledger frozen after round 1: {B1, B2}.
- Round r2-e7a21bbf: plan_sha256 472943f6c922d72d3aa320538ffd9fdd1ab00c253aed057d4e090212870e0311; status changes_requested (session st_01a18e7a, REJECT). New blocker-eligible findings (round made progress): B3 todos 9/10 filtered memory.entries without awaiting ready() (reproducible broken flow: fresh window deletes/exports without memories) -> fixed: await ready() in removeCard and the export dialog; tests seed the repo/localforage before a fresh store; B4 todo 12 inspector had no cross-window transport -> fixed: memoryInspectInvoke + serve/setLeading/inspectLeader over the devtools bus, leader hook beside publishLiveState, two-tab QA and cross-window step in todo 16; B5 todo 6 YAML check read d.settings.pages but the file's top key is pages -> fixed. Ledger: {B1 closed, B2 closed, B3 closed, B4 closed, B5 closed}.
- Round r3-075c7e1f: plan_sha256 b4e51bfb11da2f3853d342c667c1f9d350ece723efefe5c75139d6ee91d79587; status changes_requested (session st_01a18e7d, REJECT). New blocker-eligible finding: B6 todo 12 recorded at store bindings, splitting one tool call into many rows and dropping refused calls (IS-8 unreachable) -> fixed: observeMemoryTools wraps tool execute, one row per invocation with all ids, result text, outcome ok/missing/refused; four one-row-per-call test cases; IS-8 reworded. Ledger: {B1..B6 closed}.
- Round r4-d51f1f16: plan_sha256 21bafc22642e8724768bc63ec00a15a4be356363c59ab9da9a19a735264528e9; status approved (session st_01a18e7f, OKAY). Final live-plan sha256 re-validated = approved digest. Convergence: 4 rounds, 6 accepted blockers all closed, 0 open notes.
