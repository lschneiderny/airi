# Long-term memory adoption

Date: 2026-10-30
Status: accepted

## Context

Upstream combines long-term memory with recipes, decisions, background tasks, scene bindings, and automations. The fork has a situation gate that already decides whether the character speaks without a user prompt. Importing upstream automations would create a second decider. The fork also has chat-store and runtime behavior for unprompted turns that differs from upstream.

Long-term memory was ported by hand from upstream commits `d70ab4dd3` (#2748) and `2c4d66c6b` (#3241). The memory subsystem uses upstream paths: `packages/stage-ui/src/types/memory.ts`, `packages/stage-ui/src/database/repos/memory.repo.ts` and `packages/stage-ui/src/database/repos/__mocks__/memory.repo.ts`, `packages/stage-ui/src/stores/memory.ts`, `packages/stage-ui/src/tools/memory.ts`, and `packages/stage-pages/src/pages/settings/modules/memory-long-term.vue` and `memory-long-term-memories.vue`.

## Decision

Port long-term memory alone. In `chat.ts`, append the memory rules and the session character's index in `prepareSend`'s step prompt after identity and the stage contract, and before the request supplement. The index and tools are bound to the character that owns the chat session; selecting another card does not change a queued turn. Do not put the index in `session-store.ts`; the stage-contract prompt hash therefore stays identical.

Normal user turns receive `builtIn_readMemory`, `builtIn_writeMemory`, and `builtIn_forgetMemory` when memory is enabled. Unprompted turns receive only the read tool through the core-agent runtime's `unpromptedTools` option. In stage-ui `llm.ts`, unprompted requests resolve only the supplied custom tools, excluding built-in tools.

The card package may include its own memories as optional `resources.memories`, stored in `memories.json`. Keep package `VERSION` at 1 and do not add a compatibility branch. Deleting a card removes its memories after `memory.ready()` resolves. Do not migrate legacy localStorage entries.

Keep the situation gate as the only decider for unasked speech. Do not import recipes, decisions, background tasks, scene bindings, or automations. The Spark Notify prompt uses the active card's index; both artistry director variants use the card being processed. The devtools Memory inspector reads the leader over `eventa:devtools:memory:inspect` and displays one row per tool invocation. Delete-all and reset clear memory.

## Consequences

Memory is stored in local IndexedDB and does not sync through the cloud. A card's memories are removed with the card unless exported first. General entries are included in every character's index; entries owned by a card are scoped to that character. Memory tools use strict function calling, which some local models may not support; `ollama-bench` exercises those tools.

## Validation

The implementation is covered by `memory.browser.test.ts`, `tools/memory.test.ts`, memory cases in `chat.contract.test.ts`, unprompted cases in `llm.test.ts`, `use-data-maintenance.browser.test.ts`, `airi-card.test.ts`, `airi-card-import-export.test.ts`, `orchestrator/index.test.ts`, `artistry-autonomous.test.ts`, `memory-observability.test.ts`, and `memory-long-term-memories.browser.test.ts`. Live Electron validation is described in plan row 16.
