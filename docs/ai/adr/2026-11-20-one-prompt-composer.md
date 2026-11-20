# One prompt composer for every character call

Date: 2026-11-20
Status: accepted. Step P of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/refactor/prompt-composer-everywhere`. It lands LLM prompt Target rules 1 to 4, which decision 12 of the [character mind ADR](2026-11-17-character-mind-direction.md) accepted on 2026-11-17, and builds on the [prompt composition ADR](2026-11-01-prompt-composition.md). The owner was away while the step ran, so each decision below took the recommended option and stays open to the owner's veto. Current rules: [LLM prompt](../context/llm-prompt.md).

## Context

Every character turn composed its system prompt through `composePrompt`, except the Spark Notify commands-only agent. Its host composed the base prompt, and `createSparkNotifyAgent` in `packages/core-agent` then appended three parts with its own join: the host instruction (`base.prompt.spark-notify`), the caller's `appendSystemInstructions`, and each agent plugin's `systemInstructions`. None of them had a budget or appeared in the size report.

The same plugin text was capped at 2000 characters on the spoken route, where it becomes the `plugin` segment of an unprompted turn. One plugin's text therefore had two authorities, depending on the route. The agent also read the active card's memory, while every other path read the memory of the session's character. Two segment ids had no producer: `account`, which nothing in the app ever produced, and `spark`, which was reserved but unused.

Upstream's `createSparkNotifyAgent` appends the same three parts after the host prompt, with no cap. Upstream has no `composePrompt`.

## Decision

### The agent's system turn

1. **The host composes every system part (D2).** The agent sends the host's `systemPrompt` unchanged as the whole system turn. `packages/core-agent` cannot import `stage-shared`, so a cap inside core-agent would be a second composer. A compose callback that the agent calls after its plugins prepare would exist only for plugin `systemInstructions`, which nothing produces.
2. **The agent's appending API is deleted (D3).** The `instruction` option of `createSparkNotifyAgent` and `SparkNotifyPluginSession.systemInstructions` go, with no compatibility path. No plugin produced system instructions, the same reasoning as LLM prompt Target rule 4. The agent's options return to upstream's shape. A future upstream plugin that sets `systemInstructions` fails to typecheck at a sync, and the [upstream policy ledger](../context/upstream-policy.md) row says why.
3. **`appendSystemInstructions` stays in core-agent's `SparkNotifyMessageOverride` (D4).** Its doc says that the host composes it into its system prompt and that the agent does not read it. The widget schema and both Spark Notify routes read it from the shared control type.

### Segments

4. **The host instruction is the `spark` segment (D5).** `ChatPromptInput` gains the field `spark`. This is the reserved id's purpose, it gives `spark` a producer, and the size report covers it.
5. **Composer order holds (D6).** The `plugin` segment comes before `spark`, so the instruction is now the last part of the system message, after the plugin text. The order table is the prompt composition ADR's. The commands-only agent's text output is ignored.
6. **The orchestrator joins the caller's instructions (D7).** `processSparkNotify` joins `appendSystemInstructions` with a blank line into the `plugin` segment, as the spoken route does. A shared helper would mean editing the spoken route's `performSparkNotifyReaction`, which the unmerged CM3b work rewrites.
7. **The `spark` policy stays `fixed` (D19).** The text is host-written from a fixed locale key. It interpolates the module name, a source key that the server channel or a local plugin supplies.

### Memory and inputs

8. **The agent reads the active session's character (D8).** Its prompt and memory index are those of `personaOf(activeSessionId)`, not the active card's. Character mind ADR decision 12 makes the speaking character the memory source, and the spoken route of the same notify already reads that persona. Since the chat selects the character, the two differ only when a turn's session is not the active character's, for example after a wake word or in a scene.
9. **`personaOf` moves to `useChatSessionStore` (D9).** It reads only session members and the active card, which that store owns. The orchestrator then needs no chat store.
10. **The agent declares only `spark` and `plugin` (D10).** It ignores text, so it gets no stickers. It offers no draw-card tool, so it gets no `toolGuidance`, and it is not a recipe run, so it gets no `cardSupplement`. Voice, control, and unprompted inputs have no source there.

### Deletions and scope

11. **The `account` segment is deleted everywhere (D11).** It leaves the order, the budgets, the tests, the qa-tools fixture schema and README, and the glossary, with no compatibility path. A fixture that still carries `account` fails validation, as any unknown key does.
12. **LLM prompt Target rule 5 moves to CM7 (D12).** "Actions follow capabilities" needs performers that declare capabilities, which is Body ownership Target rule 4 in CM7. Landing it now would remove the clip actions under the classic MMD driver, a user-visible removal. The `actions` segment stays as it is.
13. **User-role plugin text stays uncapped (D17).** A widget's `replaceUserMessage`, `appendUserSections`, headline, and note reach the user message or the trigger message at any length, as upstream sends them. Target rule 2 governs the system prompt. The LLM prompt doc now says that plugin text with system authority reaches a character turn only as the capped `plugin` segment.

## Supersedes

- The prompt composition ADR's owner decision (2026-11-01) that Spark Notify reactions use the active card's memory. Both Spark Notify routes read the active session's character.
- The prompt composition ADR's 2026-11-01 amendment that the Spark Notify agent appends its host instruction after the composed prompt, that the `spark` segment id is reserved and unused, and that Spark receives "the toolset and account text". The instruction is the `spark` segment, the agent declares only `spark` and `plugin`, and `account` no longer exists.
- The memory adoption ADR's statement that the Spark Notify prompt uses the active card's index.

## Consequences

- The Spark Notify agent's system turn is exactly the `composePrompt` output for the active session's character. The size report covers the instruction and the caller's text.
- The caller's appended instructions on the commands-only route are cut at the 2000-char `plugin` budget, as on the spoken route. A cut CALL manifest changes nothing there, because the agent ignores text.
- The commands-only agent may read another character than the active card. It emits commands only, so the user sees no text change.
- The agent's system turn departs from upstream's. The ledger records the departure.
- The eval closure digest changes, because `compose.ts` is in `SCORE_CLOSURE_FILES`. No scorer changes.

## Not decided

- Whether a later step caps user-role plugin text too.
- Whether the commands-only agent's provider and model follow the session character's card modules, like chat turns, instead of the Consciousness module's active selection (D20).
- A cap on the module name that the `fixed` `spark` segment interpolates.

## Alternatives considered

- **A compose callback.** The agent would call a host callback after its plugins prepare. It exists only for plugin `systemInstructions`, which nothing produces.
- **A cap in core-agent.** core-agent would cap the appended text itself. That is a second composer with its own budgets, outside the report.
- **Reordering `spark` before `plugin`.** The instruction would stay ahead of the plugin text. The order table is the prompt composition ADR's, and the commands-only agent's text output is ignored.
- **Landing Target rule 5 now.** Emptying `actions` outside Natural removes clip actions under the classic MMD driver. Restating the rule as "the active scene's exposed clips" would land a weaker rule under the same number.
