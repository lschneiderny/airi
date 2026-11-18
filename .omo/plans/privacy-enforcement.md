# privacy-enforcement - Work Plan

Status: done on `luke/feat/privacy-enforcement` (2026-11-17). Luke approved V1, titles plus credential shapes, and V2, drop the item, the same day. Roadmap row: step V in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md). Source: recommendation R14 of `docs/ai/audits/2026-10-31-architecture-boundaries.md`.

## TL;DR (For humans)

**What changes:** Four privacy rules that exist only as prompt text or as a comment get code behind them. A window or page title that the situation holds cannot be saved into long-term memory, an extracted thread, a relationship event, or a MOOD cue reason. A widget reaction about a browser page stores the kind of topic in chat history, not the page title. The rule for plugin text with system authority is written down.

**Why:** Titles reach the model through the situation block, which is never stored. The model can still copy a title into text that is stored: a memory entry, a thread summary, or a mood reason. Today only a prompt sentence asks it not to.

**Branch:** `luke/feat/privacy-enforcement`, from `main` after PR A lands. One PR. The code is fork-only, so the step does not wait for the upstream sync.

**Effort:** M. **Risk:** Low to medium. The risk is a filter that refuses a save the user asked for; default D2 covers it.

## What the code does today

| Rule | Where it is stated | Enforcement today |
| --- | --- | --- |
| Memory never holds window titles or secrets | `composeMemoryHeader` in `packages/stage-ui/src/tools/memory.ts` | Prompt text only. `builtIn_writeMemory` saves whatever the model sends, through `memory.write` bound in `packages/stage-ui/src/stores/chat.ts`. |
| A trigger message never holds a raw window title or a web extension page title or link | The comment on `ChatUnpromptedPayload` in `chat.ts` | Gate-fired turns go through `unpromptedTopicText` in `packages/stage-ui/src/stores/situation/index.ts`. `performSparkNotifyReaction` in `packages/stage-ui/src/stores/mods/api/context-bridge.ts` builds `topicText` from the raw headline and note and skips that function. |
| Extracted threads and events are personal, leader-only content | `docs/ai/context/state-persistence.md` | `sanitizedThreads` and `sanitizedEvents` in `packages/stage-ui/src/features/situation/thread-extraction.ts` remove markers and role injections. Nothing checks for titles. |
| A MOOD cue reason is cleaned before it is stored | `parseMoodCue` in `packages/stage-shared/src/character-state/cue.ts` | `cleanReason` caps and cleans the text. Nothing checks for titles. |
| Plugin text keeps system authority under a 2000-character cap | Owner decisions in the prompt composition ADR | Chat turns cap it in the `plugin` segment. `createSparkNotifyAgent` in `packages/core-agent/src/agents/spark-notify/agent.ts` appends it with no cap. |

Titles the leader holds: the situation's current activity title, and the page and video titles of web extension context. Recent apps carry no title. The web extension sends its title as `metadata.title`, which the situation now keeps beside the context text. While the "Share window titles" setting is off, the host sends no window title.

## Decisions (Luke, 2026-11-17)

| # | Question | Decision |
| --- | --- | --- |
| V1 | What does the memory filter match besides titles? | **Titles plus a short list of credential shapes** (provider key prefixes such as `sk-` and `ghp_`, and `password:`-style pairs). It is a narrow list with a stated purpose. The prompt sentence stays as the main rule. |
| V2 | What happens on a match? | **Drop the item.** A memory write is refused with a reason the model can read, and a thread, an event, or a MOOD cue is dropped. One predicate serves all four sites. |

## Defaults adopted without asking (veto any)

| # | Default |
| --- | --- |
| D1 | A title shorter than 8 characters is not matched, so a title such as "Mail" cannot block ordinary sentences. Matching is case-insensitive on the whole title. |
| D2 | The owner may state a title. A memory write that contains a held title is allowed when the user's own message in the same turn contains that title. This is the prompt's "unless the owner states it" rule in code. |
| D3 | Step V states the plugin authority rule in `docs/ai/context/llm-prompt.md`. The 2000-character cap on the Spark Notify agent's appended text lands with step P, which routes that text through `composePrompt`. Capping it here would be replaced a few weeks later. |
| D4 | `unpromptedTopicText` moves beside `isTopicFromSource` in `packages/stage-shared/src/situation/`, because it is a pure function and two stores now call it. |

## Steps

1. **The predicate.** Add a pure function in `packages/stage-shared/src/situation/` that answers whether a text repeats a held title, and a selector that lists the titles a situation holds. Tests cover the length floor, case, the three title sources, and an empty list while titles are not shared.
2. **Memory writes.** The write binding in `chat.ts` refuses an entry whose description or body repeats a held title, unless D2 applies, and refuses one that matches a credential shape (V1). The tool result tells the model why. Tests cover a refused write, an owner-stated title, and an unaffected write.
3. **Widget topic text.** Move `unpromptedTopicText` (D4). `performSparkNotifyReaction` passes its topic text through it, so a web extension topic stores only the kind of topic. Other plugins' headlines are unchanged, as they are for gate-fired turns. Extend `context-bridge-spark-reaction.test.ts` with a web extension source.
4. **Extraction.** `sanitizedThreads` and `sanitizedEvents` drop an entry whose summary, cue, reason, or memory text repeats a held title. The extractor receives the titles through its existing options object. Tests cover a dropped thread and a dropped event.
5. **MOOD cue reasons.** The stage-ui consumer of `parseMoodCue` drops a cue whose reason repeats a held title. `parseMoodCue` stays pure and unchanged.
6. **Docs.** In `docs/ai/context/llm-prompt.md`, state the plugin authority rule and keep the Spark Notify cap in Known gaps with its owner, step P. In `docs/ai/context/state-persistence.md` and `docs/ai/context/autonomous-behavior.md`, replace the statements this PR makes false. Add the predicate to the glossary if it gains a name used in prose. Set roadmap step V to done if PR B has merged.

## Must not do

- Do not change what the situation block shows the model. This step filters what is stored.
- Do not add a setting for the filter.
- Do not edit ADR bodies.
- Do not touch the urge gate or the forced-turn path beyond the topic text. Widget turns move to the voice policy in CM3.

## Checks

- Each commit: `pnpm verify`.
- The PR: `pnpm verify --gate` and `pnpm qa:display run -- pnpm qa:smoke`.
- Rendered check: one `qa:app` replayed chat turn in which the scripted reply calls `builtIn_writeMemory` with a held title, confirming the refusal and no renderer or main-process errors.

## Done when

Each rule in the table above has code behind it or, for the Spark Notify cap, a named owner step. The policy docs describe the new behavior, and the checks pass.
