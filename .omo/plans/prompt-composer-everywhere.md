# prompt-composer-everywhere - Work Plan

## Status and links

Status: planned on 2026-11-20, not started. Roadmap row: step P in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Rules: [LLM prompt](../../docs/ai/context/llm-prompt.md), Target rules 1 to 5; the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md), decisions 6, 12, and 14; the [prompt composition ADR](../../docs/ai/adr/2026-11-01-prompt-composition.md) with its amendments; the [memory adoption ADR](../../docs/ai/adr/2026-10-30-long-term-memory-adoption.md); the upstream [chat selects character ADR](../../docs/ai/adr/2026-11-13-chat-selects-character.md). Earlier plan: [`prompt-composer.md`](prompt-composer.md), whose body is frozen history; this plan finishes what it left open. Step V's plan, [`privacy-enforcement.md`](privacy-enforcement.md), default D3, hands the cap on the text that the Spark Notify agent appends to this step.

Branch: `luke/refactor/prompt-composer-everywhere`, cut from `main` at `e835d67ac`. One PR against `lschneiderny/airi`, rebase-merged (D1).

The owner is away and ruled "go without plan review". Every fork below takes the recommended option and is listed under [Decisions](#decisions), open to veto. Where the owner must decide, the plan takes the conservative option and lists it under [Owner questions](#owner-questions).

## The problem

Every character turn composes its system prompt through `composePrompt`, except one: the Spark Notify commands-only agent. Its host composes the base prompt, and then `createSparkNotifyAgent` appends three more parts with its own `join('\n\n')`, outside the composer, its budgets, and its report:

- the host instruction (`base.prompt.spark-notify`);
- the caller's `messageOverride.appendSystemInstructions`, which is plugin text with system authority and no cap;
- each agent plugin's `systemInstructions`.

The same plugin text is capped at 2000 characters on the spoken route, because `useContextBridgeStore` passes it as the `plugin` segment. So one plugin's text has two authorities depending on the route. The agent also reads the active card's memory, while every other path reads the memory of the session's character. Two segment ids have no producer: `account`, which nothing in the app ever produced, and `spark`, which is reserved but unused.

## What exists today

### Upstream first

As of the last sync (`b3a6d6071`), upstream's `createSparkNotifyAgent` takes `{ runner, plugins?, createId? }`. Its system turn joins the host's `systemPrompt`, the hard-coded instruction `getSparkNotifyHandlingAgentInstruction(moduleName)`, the caller's `appendSystemInstructions`, and each plugin's `systemInstructions`, with no cap. Upstream's orchestrator store passes the character store's `systemPrompt`, adds `createSparkNotifyReactionPlugin`, and speaks the agent's text. Upstream has no `composePrompt`.

The fork already departs: the instruction is a host option rendered from i18n, the agent runs commands-only, and spoken reactions are unprompted chat turns. The [upstream policy ledger](../../docs/ai/context/upstream-policy.md) records the composer ("System prompt" and "Memory index" rows, both revisited at step P) but has no row for the Spark Notify agent. This step changes three upstream-derived files and names them, as ADR decision 14 requires:

| Upstream file | Change | Why |
| --- | --- | --- |
| `packages/core-agent/src/agents/spark-notify/agent.ts` | The agent appends nothing to `systemPrompt`; the `instruction` option goes | The host composes every system part (D2, D3) |
| `packages/core-agent/src/agents/spark-notify/types.ts` | `SparkNotifyPluginSession.systemInstructions` goes; two doc comments change | No plugin produces it, and uncapped system text is what Target rule 2 forbids (D3, D4) |
| `packages/stage-ui/src/stores/character/orchestrator/store.ts` | The agent's prompt is composed for the active session's character with the `spark` and `plugin` segments | Target rules 1 to 3 (D5, D8) |

The agent's options return to upstream's shape. Its system turn departs from upstream's, and item 4 adds a ledger row for that.

### The code

| Part | Where | Today |
| --- | --- | --- |
| Composer | `composePrompt`, `PROMPT_SEGMENT_ORDER`, `PROMPT_SEGMENT_BUDGETS` in `packages/stage-shared/src/stage-contract/compose.ts` | 14 ids. `account` (8, `warn` 2000) and `spark` (14, `fixed`) have no app producer |
| Segment builder | `useChatPrompt` (`buildChatPromptSegments`) and `ChatPromptInput` in `packages/stage-ui/src/stores/chat/prompt.ts` | Emits every id except `account` and `spark`; `plugin` comes from `ChatPromptInput.plugin` |
| Session layer | `personaOf` and `sessionPromptSegments` in `useChatStore`, `packages/stage-ui/src/stores/chat.ts` | Every chat path: typed and voice turns, `ingest`, unprompted turns, background tasks, notices, scenes. `personaOf` is the session's first character member, else the active card, else `'default'` |
| Spoken Spark route | `performSparkNotifyReaction` in `packages/stage-ui/src/stores/mods/api/context-bridge.ts` | `supplement: appendSystemInstructions.join('\n\n')` becomes the capped `plugin` segment of an unprompted turn. The unmerged CM3b PR (#53) rewrites this function |
| Commands-only agent | `processSparkNotify` in `packages/stage-ui/src/stores/character/orchestrator/store.ts` | `composePrompt(buildChatPromptSegments({ characterId: cardStore.activeCardId ?? 'default' })).text` |
| Agent | `createSparkNotifyAgent` in `packages/core-agent/src/agents/spark-notify/agent.ts` | System turn: `[systemPrompt, instruction(getEventSourceKey(event)), ...appendSystemInstructions, ...systemInstructions].filter(Boolean).join('\n\n')` |
| Plugin system text | `SparkNotifyPluginSession.systemInstructions` in `packages/core-agent/src/agents/spark-notify/types.ts` | No plugin sets it: not `createSparkNotifyBuiltinToolsPlugin`, the observer, or the reaction plugin, and the app passes no plugins |
| Caller system text | `SparkNotifyMessageOverride.appendSystemInstructions` | Set by widget requests (`use-bridge-spark.ts` in the desktop app) and by `withStreamingCallPrompt` (the CALL manifest) in `context-bridge.ts`; reaches the agent only when a notify has destinations beyond the character or forces a command |
| `account` outside the composer | `segmentsFromFixture` in `packages/qa-tools/src/model/prompt.ts`; `packages/qa-tools/README.md`; the glossary's Prompt segment entry; `compose.test.ts` | The fixture schema accepts it; the committed fixture omits it |
| Actions | `useStageActionsPrompt` in `packages/stage-ui/src/composables/use-airi-runtime-prompt.ts` ← `exposedActions` of `usePerformanceRuntimeState` ← `listActions` in `use-stage-performance-conductor.ts` ← `Stage.vue` | The MMD scene's curated clips, under Natural and classic alike. No performer declares capabilities |

### Each Target rule against the code

| Rule | Holds today | Gap |
| --- | --- | --- |
| 1. One composer for every character call | Every chat path composes through `sessionPromptSegments` and `composePrompt` (`createReplyResolveStep` in `chat.ts`) | The agent concatenates three parts after the composed text |
| 2. Same segments, same caps | The spoken route caps plugin text | The agent's plugin text is uncapped and outside the report |
| 3. One memory source | Every chat path reads `personaOf(sessionId)` | The agent reads `activeCardId` |
| 4. No segment without a producer | Twelve ids have producers | `account` and `spark` have none. The roadmap names only `account` |
| 5. Actions follow capabilities | The segment is empty without a clip library (Live2D, VRM) | Needs performers that declare capabilities, which CM7 lands (D12) |

## Decisions

Each decision stays open to veto. The ones most likely to be vetoed are D8, D12, and D17.

| # | Fork | Options | Taken | Why |
| --- | --- | --- | --- | --- |
| D1 | Split | One PR; two PRs (deletions, then Spark) | One PR, seven commits | Small, one subject, and the roadmap's "one PR per slice". The behavior-neutral items come first |
| D2 | Who composes the agent's system prompt | The host composes everything and the agent sends `systemPrompt` unchanged; the agent calls a host compose callback after its plugins prepare; core-agent caps the appended text itself | The host | core-agent cannot import `stage-shared`, so a cap in core-agent would be a second composer. A callback exists only for plugin `systemInstructions`, which nothing produces (D3) |
| D3 | The agent's appending API | Delete the `instruction` option and `SparkNotifyPluginSession.systemInstructions`; keep them behind a callback | Delete both | No producer, the same reasoning as Target rule 4. The options return to upstream's shape. A future upstream plugin that sets `systemInstructions` fails to typecheck at a sync, which the ledger row flags |
| D4 | Where `appendSystemInstructions` lives | Keep it in core-agent's `SparkNotifyMessageOverride` as a field the host reads; move it to stage-ui's `SparkNotifyReactionOptions` | Keep it; its doc says the host composes it into the `plugin` segment | The widget schema and both routes read it from the shared control type. Moving it touches `context-bridge.ts` |
| D5 | The host instruction | The `spark` segment; part of the `plugin` segment; delete `spark` and keep the instruction outside | The `spark` segment, as `ChatPromptInput.spark` | It is the reserved id's purpose, it gives `spark` a producer (Target rule 4), and the report covers it. It stays `fixed` (D19) |
| D6 | Order of plugin text and instruction | Composer order (`plugin` 12, then `spark` 14); reorder the composer to put `spark` first | Composer order | The order table is the ADR's. The instruction moves to the very end, after the plugin text, which is a small change in what the commands-only model reads; its text output is ignored |
| D7 | Joining the caller's instructions | The orchestrator joins them with a blank line, as `context-bridge.ts` does; a shared helper that both routes call | The orchestrator joins | A shared helper means editing `performSparkNotifyReaction`, which the unmerged CM3b PR rewrites. The join is one expression |
| D8 | Whose prompt and memory the agent reads | The active session's persona in the leader (`personaOf(activeSessionId)`); the active card | The active session's persona | Target rule 3 and ADR decision 12 make the speaking character the memory source, and the spoken route of the same notify already reads that persona. Since the chat selects the character, the two differ only when a turn's session is not the active character's, for example after a wake word or in a scene |
| D9 | Home of `personaOf` | `useChatSessionStore`; export it from `useChatStore`; copy it into the orchestrator | `useChatSessionStore` | It reads only session members and the active card, which that store owns. The orchestrator then needs no chat store, and `chat.ts` changes by one moved function |
| D10 | The agent's declared inputs | `spark` and `plugin` only; also stickers, `toolGuidance`, and `cardSupplement` as the session would add them | `spark` and `plugin` | `ChatPromptInput` declares the others per run. The agent ignores text (stickers), offers no draw-card tool (`toolGuidance`), and is not a recipe run (`cardSupplement`). Voice, control, and unprompted have no source there |
| D11 | Scope of the `account` deletion | Order, budgets, tests, the qa-tools fixture schema and README, and the glossary, with no compatibility path; keep the fixture key | Delete everywhere | Target rule 4. A fixture that still carries `account` fails validation, as any unknown key does under `strictObject`. The README's sentence about a "user-account context" describes code that does not exist |
| D12 | Target rule 5 | Move it to CM7, which makes performers declare capabilities; land it now by emptying `actions` outside Natural; restate it as "the active scene's exposed clips" | Move it to CM7 | Rule 5 needs Body ownership Target rule 4, which CM7 lands. Landing it now removes the clip actions under the classic MMD driver, a user-visible removal (ADR decision 7). Restating it would land a weaker rule under the same number |
| D13 | Where the decisions are recorded | A new ADR that supersedes the "active card" and "appends its host instruction" statements; amend the old ADRs | A new ADR | The root `AGENTS.md` freezes ADR bodies. The Target table's "amend the ADRs' wording" is met by superseding |
| D14 | Target rule numbers after landing | Keep 5 and 6 numbered as they are; renumber | Keep | The roadmap cites "LLM prompt Target rule 6" (CM3) |
| D15 | Ledger | A new row for the Spark Notify agent's system turn; set the "System prompt" and "Memory index" rows' Revisit to "Not planned" | Both | "A departure that has no row here is a bug in the sync", and step P is what those rows waited for |
| D16 | The unused second composer in `prompt-recipe.ts` | Keep; delete | Keep | It is upstream code that no call path runs. Rule 1 is about calls, and deleting it adds sync friction. Its Known gap stays |
| D17 | User-role plugin text: `replaceUserMessage`, `appendUserSections`, the headline and note | Leave it uncapped; cap it too | Leave it | Target rule 2 governs the system prompt. A user-role cap changes what the model sees on upstream's data path. The sentence in "Who may add a segment" that says plugin text reaches a turn "only as the capped `plugin` segment" is corrected to say "with system authority" |
| D18 | The agent's composer report | Drop it; show it in devtools | Drop it | No consumer exists today |
| D19 | The `spark` policy | `fixed`; `truncate` | `fixed` | Host text from a fixed locale key. It interpolates the peer-supplied module name, a source key (Risks) |
| D20 | The agent's provider and model | Keep the Consciousness module's active selection; use the persona's card modules like chat turns | Keep | Not one of the five rules. Recorded as a follow-up |

## Work items

Each item is one commit that passes `pnpm verify` and, at the tip, `pnpm verify --gate --base main`. Items 1 and 2 are behavior-neutral; item 3 and item 4 change what the commands-only agent sees. A policy doc changes in the commit that makes its statement false; after each policy doc edit, run `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` with the files staged.

### 1. `refactor(stage-ui): move the persona of a session into the session store`

- **Files:** `packages/stage-ui/src/stores/chat/session-store.ts` gains `personaOf(sessionId)`, moved verbatim from `chat.ts` with its doc comment. `packages/stage-ui/src/stores/chat.ts` deletes its copy and calls `chatSession.personaOf` at every call site. `packages/stage-ui/src/stores/chat/session-store.browser.test.ts` gets one test.
- **Tests:** one test of `personaOf` with three cases: a session with a character member returns that card; a session without members returns `activeCardId`; neither returns `'default'`. The existing `chat.contract.test.ts` cases that assert exact system prompts and session characters pass unchanged, which is the byte-for-byte proof: "reads the session character settings and prompt again before each model step" and "keeps a queued typed turn on its session character after the active card changes".
- **Acceptance:** `git grep -n "function personaOf" -- packages/stage-ui/src` prints only the session store. No other line of `chat.ts` changes.

### 2. `refactor(stage-shared,qa-tools): delete the account prompt segment`

- **Files:**
  - `packages/stage-shared/src/stage-contract/compose.ts`: `account` leaves `PROMPT_SEGMENT_ORDER` and `PROMPT_SEGMENT_BUDGETS`.
  - `compose.test.ts`: the join test uses another empty segment, such as `{ id: 'voice', text: '' }`.
  - `packages/qa-tools/src/model/prompt.ts`: the key leaves `fixtureSchema` and the id leaves the loop in `segmentsFromFixture`.
  - `packages/qa-tools/README.md` (Prompt command): `account` leaves both lists, and the two sentences about the user-account context go.
  - `docs/ai/context/glossary.md` (Prompt segment): the order list loses `account`.
  - `docs/ai/context/llm-prompt.md`: the segments table loses row 8, and the Order column is renumbered 1 to 13. The qa-tools paragraph loses its last sentence. The Known gap "The `account` segment has no producer" and its Target table row go.
- **Tests:** none new. A test that `account` is rejected would test a deletion. The prefix SHA-256 cases in `compose.test.ts`, `prompt.test.ts`, `prompt-full.test.ts`, and `prompt-fixture-parity.test.ts` pass unchanged.
- **Acceptance:**
  - `git grep -nw account -- packages/stage-shared/src packages/qa-tools/src docs/ai/context/llm-prompt.md docs/ai/context/glossary.md` prints no prompt-segment hit.
  - The byte check below prints the same hashes as on `main`. Measured at `e835d67ac`: `pnpm --silent qa:model prompt | sha256sum` gives `45a72604fb5f2f9b4c8b6a4c839a9a0ca30a656c4c434a3d579e38fb78f7878f` (the empty-card hash in `compose.test.ts`), and `pnpm --silent qa:model prompt --full packages/qa-tools/fixtures/model/full-prompt.json | sha256sum` gives `83fa9a60fb4ee7ec54d7823a5b0b50b1e5b6f2af2e1822ba8aa602fbc151156b`.
- **If PR #55 (lab-tools) lands first,** the qa-tools model prompt files and their README section live under `packages/lab-tools`. Make the same edits there.

### 3. `refactor(stage-ui): give the Spark Notify agent the active session's character`

- **Files:**
  - `packages/stage-ui/src/stores/character/orchestrator/store.ts`: `characterId: chatSession.personaOf(chatSession.activeSessionId)` replaces `cardStore.activeCardId ?? 'default'`. Drop the `useAiriCardStore` import if nothing else uses it, and replace the comment "Spark uses the active card's memory".
  - `packages/stage-ui/src/stores/character/orchestrator/index.test.ts`.
  - `packages/stage-ui/README.md`: the sentence "Spark Notify instead uses the active card's index" goes. In the same paragraph, correct "The memory index is the first segment after the identity and stage contract" (`actions` leads the tail).
  - `docs/ai/context/llm-prompt.md`: the commands-only bullet under Paths says "for the active session's character". The Known gap "Spoken Spark Notify reactions use the session character's memory, not the active card's" and its Target table row go, because both routes now read the session character.
- **Tests:** rewrite "gives the commands-only agent the index of the active card after the identity and stage contract" as "... the index of the active session's character ...". Make the active session's character member a card other than the active card, with one memory entry for each card. The system message contains the member card's index line and not the active card's. "Leaves the memory prompt out when memory is off" is unchanged.
- **Acceptance:** the orchestrator, chat contract, and context-bridge Spark tests pass; `activeCardId` no longer appears in `orchestrator/store.ts`.

### 4. `refactor(core-agent,stage-ui): compose the Spark Notify instruction and plugin text as segments`

One cross-package commit, because the agent stops appending in the same change that the host starts composing. Splitting it would ship one commit whose prompt has no instruction.

- **core-agent:**
  - `agent.ts`: the system turn's text is `request.systemPrompt`. Delete `instruction` from `CreateSparkNotifyAgentOptions`, the `systemInstructions` flatMap, and the `getEventSourceKey` import if unused.
  - `types.ts`: delete `SparkNotifyPluginSession.systemInstructions`. `appendSystemInstructions` documents that the host composes it into its system prompt and the agent does not read it. `SparkNotifyHandleRequest.systemPrompt` in `agent.ts` documents that it is the whole system turn.
  - `agent.test.ts`: drop `instruction` from every `createSparkNotifyAgent` call. Replace "requires the host to supply the notify instruction" with "sends the host system prompt unchanged as the system turn": with `appendSystemInstructions` set, the system turn text equals `systemPrompt` exactly.
- **stage-ui:**
  - `packages/stage-ui/src/stores/chat/prompt.ts`: `ChatPromptInput` gains `spark?: string`, documented as the Spark Notify agent's host instruction. `buildChatPromptSegments` emits `{ id: 'spark', text: input.spark ?? '' }` last.
  - `orchestrator/store.ts`: `createSparkNotifyAgent` loses `instruction`. `processSparkNotify` passes `spark: t('base.prompt.spark-notify', { moduleName: getEventSourceKey(event) })` (stage-ui's `utils/event-source`, which gives the same key as core-agent's) and `plugin: control?.messageOverride?.appendSystemInstructions?.join('\n\n')`. No i18n key changes.
- **Tests** in `orchestrator/index.test.ts`, without snapshots:
  - "composes the commands-only system prompt...": the system message starts with the format rules and ends with `\n\nbase.prompt.spark-notify` (the i18n mock returns the key).
  - "preserves runtime rules when a Spark caller replaces the user payload": also checks the order of `base.prompt.emotion` (contract), then `Plugin-specific hint` (plugin), then `base.prompt.spark-notify` (spark), and that `Plugin-specific hint` occurs once.
  - A new test, "caps the caller's appended instructions at the plugin budget": one instruction of `PROMPT_SEGMENT_BUDGETS.plugin.maxChars + 500` characters. The system message contains exactly `maxChars - PROMPT_TRUNCATION_MARKER.length` of them followed by `PROMPT_TRUNCATION_MARKER`, then `\n\nbase.prompt.spark-notify`.
  - A new test, "joins several appended instructions with a blank line inside the plugin segment".
- **Docs:**
  - `docs/ai/context/llm-prompt.md`:
    - Segments table: the `spark` row's producer is `ChatPromptInput` (field `spark`), and the `plugin` row says both Spark routes supply it.
    - Paths, commands-only bullet: its system prompt is `composePrompt(buildChatPromptSegments(...)).text` with the `spark` and `plugin` segments, and the agent appends nothing.
    - "Who may add a segment": the plugin bullet says that plugin text with system authority reaches a character turn only as the capped `plugin` segment, on both routes (D17), and loses "The commands-only agent does not apply the cap yet". The core-agent bullet says that the agent receives a composed system prompt and holds no stage prompt text.
    - Known gaps: "Plugin text on the Spark Notify agent is not capped" and "Spark Notify does not receive the same segments as chat" go, with their Target table rows.
  - `docs/ai/context/upstream-policy.md`: a new row under "Character, motion, and prompt" (D15). Area: Spark Notify system turn. Upstream: the agent appends its instruction, the caller's `appendSystemInstructions`, and plugin `systemInstructions` after the host prompt. Fork: the host composes the instruction as the `spark` segment and the caller's text as the capped `plugin` segment; plugin sessions have no `systemInstructions`. Reason: one composer (character mind ADR decision 12). Revisit: when upstream changes the agent's system turn.
- **Acceptance:**
  - `git grep -n "systemInstructions\b\|instruction: moduleName" -- packages/core-agent/src packages/stage-ui/src` prints nothing.
  - `git grep -n "appendSystemInstructions" -- packages/core-agent/src/agents/spark-notify/agent.ts` prints nothing.
  - The core-agent, orchestrator, and context-bridge Spark tests pass.

### 5. `docs(adr): record one prompt composer for every character call`

`docs/ai/adr/2026-11-20-one-prompt-composer.md`. Status: accepted, with each decision open to the owner's veto, in the wording of the CM slice ADRs. It records D2 to D12, D17, and D19. It supersedes three statements:

- the prompt composition ADR's owner decision that Spark Notify reactions use the active card's memory;
- that ADR's 2026-11-01 amendment that the agent appends its host instruction, that `spark` is reserved and unused, and that Spark receives "the toolset and account text";
- the memory adoption ADR's "the Spark Notify prompt uses the active card's index".

Alternatives: a compose callback, a core-agent cap, reordering `spark` before `plugin`, and landing rule 5 now. No existing ADR body is edited.

### 6. `docs(ai): land the one-composer prompt rules and mark step P done`

- `docs/ai/context/llm-prompt.md`: Target rules 1 to 4 move into the current sections (a short "Rules" list after the opening paragraphs, or into the paragraphs they describe), and each Target list entry is replaced by "Landed in", followed by a link to the section that now holds it. Rule 5 stays with "Closed by CM7". Keep the numbers (D14). The Target table keeps only rows still open. The opening paragraph names the Spark Notify agent among the callers of `buildChatPromptSegments`.
- `docs/ai/context/character-mind-roadmap.md`: row P becomes Done with the PR's commit hashes. Its Done-when reads "LLM prompt Target rules 1 to 4 land; rule 5 moved to CM7". Row CM7's Done-when gains "LLM prompt Target rule 5 lands". Row V's "The cap on the text the Spark Notify agent appends lands with step P" gains "(done)".
- `docs/ai/context/upstream-policy.md`: the "System prompt" and "Memory index" rows' Revisit becomes "Not planned" (D15).
- **Acceptance:** the policy-docs test passes; `git grep -n "Spark Notify.*active card" -- docs/ai/context packages/*/README.md` prints nothing.

### 7. `docs(plan): mark the prompt composer everywhere plan done`

Set Status to done with the date, append "Departures during implementation" and "Checks run" sections, and list the commits. Run it last, after every check below passes.

## Checks

- **Each commit:** `pnpm verify`. Inner loops:
  - `pnpm -F @proj-airi/stage-shared exec vitest run src/stage-contract`
  - `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/model/prompt.test.ts src/model/prompt-full.test.ts`
  - `pnpm -F @proj-airi/core-agent exec vitest run src/agents/spark-notify`
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/character/orchestrator/index.test.ts src/stores/chat.contract.test.ts src/stores/chat/prompt-fixture-parity.test.ts src/stores/mods/api/context-bridge-spark-reaction.test.ts`
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/stores/chat/session-store.browser.test.ts`
- **Policy docs:** stage the files first, because the test reads staged files through `git grep`, then run `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after each policy doc edit and at the tip.
- **The branch:** `pnpm verify --gate --base main`.
- **Byte checks for the neutral items:** the two `qa:model prompt` hashes in item 2, at the tip. The exact-prompt cases of `chat.contract.test.ts` stay unchanged across items 1 to 4.
- **Smoke, both hosts.** `.env.qa` supplies `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`.
  - `pnpm qa:display run -- pnpm qa:smoke`
  - `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"`
- **Replayed chat turn** (item 1 touches every chat path). No provider token: `qa:app` runs the `qa:llm` replay server in process.
  - Run `pnpm qa:display run -- pnpm qa:app run --model "$AIRI_QA_RIG_FORBOOTH" --script packages/qa-tools/fixtures/llm/example.json --say hello --expect act,tts` at the tip.
  - Run the same command in a base worktree at `main` (`pnpm wt new p-base`, then `pnpm wt rm p-base`).
  - Pass: both runs pass. The system message of the first chat request in each run's replay request log is byte-identical once the sticker segment is cut off, from the line `You can send one optional sticker per reply` to the end, because `selectCatalogForReply` draws the catalog per reply. Compare SHA-256 values; do not paste the text.
- **Spark Notify in the running app.** The commands-only agent runs only for a notify addressed beyond the character, and no shipped plugin sends one, so drive it through the `airi-qa` MCP server, which uses the in-process replay server and needs no provider token.
  1. `airi_start` with the ForBOOTH rig and a replay script under `.temp/p/` (not committed) that holds two empty-content entries.
  2. `airi_eval` an expression that reaches the stage window's Pinia through the app's mount element (`__vue_app__.config.globalProperties.$pinia`, development build). It calls the `character-orchestrator` store's `handleSparkNotify` with `{ type: 'spark:notify', source: 'qa-module', data: { id, eventId, kind: 'ping', urgency: 'immediate', headline: 'QA', destinations: ['qa-module'] } }` and `{ messageOverride: { appendSystemInstructions: ['P'.repeat(2500)] } }`.
  3. Pass, from the session's `requests.jsonl`: the last chat request's system message ends with the rendered English `base.prompt.spark-notify` text naming `qa-module`. It contains `PROMPT_TRUNCATION_MARKER` right after 1988 `P` characters and no run of 2500. `airi_errors` lists none. Call `airi_stop`.
  - If the store cannot be reached from the page, or the agent logs `Spark notify ignored: missing active provider or model`, record why, run the devtools context-flow page's "Send spark:notify" with `destinations: ["qa-module"]` instead (it checks the `spark` segment and the session character, not the cap), and rely on the store tests for the cap.
- **Not needed:** `qa:live2d-rig`, `qa:motion3d`, and `qa:test:model`. No motion or MMD body code changes. Follow `pnpm verify`'s "also needed" list if it says otherwise.

## Records

The PR description records:

- the commits;
- each check's command and result;
- the two `qa:model prompt` hashes at the tip;
- the `qa:app` comparison's two SHA-256 values;
- the Spark Notify run's findings as segment facts only (the system message ends with the instruction, and the plugin segment is 2000 characters with the marker);
- every departure from this plan.

Item 7 copies the same into this plan. The eval closure digest changes, because `compose.ts` is in `SCORE_CLOSURE_FILES`; note that in the PR.

## Risks

| Risk | Mitigation |
| --- | --- |
| Conflicts with the unmerged CM stack and step S (#47, #51 to #53, #56 to #60) in `llm-prompt.md`, the glossary, the roadmap, the ledger, and `chat.ts` | `context-bridge.ts` is not touched (D7), and `chat.ts` changes only by moving `personaOf`. When the stack lands first, rebase and keep both sides: the stack's spoken-route text and this step's commands-only text. The Known gap about spoken Spark memory is deleted on either side |
| PR #55 moves the qa-tools model prompt to `packages/lab-tools`, and PR #54 changes `verify` and cpu-slots | Item 2 names the alternative path. Use the check commands that `main` has when the work runs |
| The commands-only agent reads another character when the active session's character is not the active card | Intended (D8). The agent emits commands only, so the user sees no text change |
| The plugin cap cuts a widget's long instructions on the commands-only route | The same 2000-char cap already applies on the spoken route. The agent ignores text, so a cut CALL manifest changes nothing there |
| The instruction moves after the plugin text | Item 4's order test pins it. The text is unchanged |
| A long or hostile module name in the `fixed` `spark` segment | The name is a source key that the server channel or a local plugin supplies. Out of scope here. A follow-up may cap it in the host |
| The eval closure digest changes, so model-eval runs before and after do not compare by closure | Recorded in the PR. No scorer changes, so no scorer version bump |
| `useChatSessionStore` in the orchestrator test needs a session set up | Item 3's test seeds one through the store's state, as the session store tests do |
| A future upstream Spark plugin sets `systemInstructions` | The type no longer has it, so the sync fails to typecheck where it matters; the ledger row says why |

## Owner questions

1. **Target rule 5 moves to CM7 (D12).** The roadmap says P lands rules 1 to 5. Rule 5 needs performers that declare capabilities, which is Body ownership Target rule 4 in CM7. Landing it now would remove clip actions under the classic MMD driver. The plan takes the conservative option: it leaves `actions` as it is and moves the rule to CM7's Done-when.
2. **User-role plugin text stays uncapped (D17).** A widget's `replaceUserMessage`, `appendUserSections`, headline, and note reach the user message or the trigger message at any length, as upstream sends them. The plan changes only the wording of the rule. Should a later step cap user-role plugin text too?
3. **The commands-only agent's provider and model (D20).** It uses the Consciousness module's active selection, while chat turns use the session character's card modules. The plan leaves it. Should it follow the session character like the prompt now does?

## Must not do

- Do not change the stage contract text, `STAGE_CONTRACT_EN_SHA256`, the prefix bytes, or any budget besides deleting `account`.
- Do not touch `context-bridge.ts`, the spoken route, or the unprompted turn path.
- Do not keep `instruction`, `systemInstructions`, or the fixture's `account` key behind a compatibility path.
- Do not cap user-role plugin text, and do not change the agent's provider, model, tools, or response policy.
- Do not gate the `actions` segment on the driver; that is CM7.
- Do not add or rename an i18n key, and do not edit a non-English locale.
- Do not edit an existing ADR body or the body of `.omo/plans/prompt-composer.md`.
- Do not delete the unused composer in `prompt-recipe.ts` (D16).
- Do not commit a model path or any other local path; use `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`.

## Done when

- The Spark Notify agent's system turn is exactly `composePrompt` output for the active session's character, with the host instruction as the `spark` segment and the caller's system instructions as the capped `plugin` segment.
- The agent appends nothing, and plugin sessions have no system text.
- `account` is gone from the order, the budgets, the fixtures, and the docs.
- LLM prompt Target rules 1 to 4 are in the current sections, their gaps have left Known gaps and the Target table, and rule 5 is CM7's.
- The new ADR and the ledger row exist, and the roadmap shows P done.
- Every check above passes.
