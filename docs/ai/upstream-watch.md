# Upstream watch list

This list tracks upstream `moeru-ai/airi` systems that could fit dTuber but are not ready to import. Each entry names the upstream commits, why the system matters here, how far it conflicts with the fork, and the condition for another look.

The upstream review of 2026-10-26 created this list. Commits that the fork took or rejected are not listed here.

## How to re-check an entry

1. Fetch upstream with `git fetch upstream`.
2. Look for follow-ups with `git log --oneline main..upstream/main -i --grep=<search terms>`.
3. Dry-run a commit against `main` without touching the working tree: `git merge-tree --write-tree --name-only --merge-base=<commit>^ main <commit>`. Exit code 1 lists the conflicting files.
4. When an entry's revisit condition holds, judge the whole system, not one commit. Then import it, or record why it stays out.

## Skills, long-term memory, and background tasks

- **Upstream:** `d70ab4dd3` ([#2748](https://github.com/moeru-ai/airi/pull/2748)), 2026-10-15. 75 files.
- **What it adds:** Recipes work as skills that the model loads by tool or keyword. Decision recipes pick an action through `builtIn_judge`. Background tasks run in hidden sessions without voice. Long-term memory is an index plus one entry per fact, owned by a character card, read and written through tools. A scene binding gives an external input, such as a Discord channel, its own persistent session.
- **Why it matters here:** Long-term memory per character fits the dating-sim direction. A character that remembers facts about Luke across sessions is a core requirement there.
- **Fork conflicts (2026-10-26):** 18 files, including the chat store, the session store, and the core-agent runtime that the fork changed for unprompted turns.
- **Revisit when:** Recipes can start on their own. At this commit, "recipes do not start on their own", and the Auto-run settings tab only describes the idea. Also wait until upstream's follow-ups settle how memory reaches normal turns. Then decide how memory relates to the fork's situation model, which is the only channel for ambient context today.
- **Search terms:** `memory`, `recipe`, `background task`, `scene`, `scheduler`, `auto-run`.

## Speaker recognition

- **Upstream:**
  - `ef13f5bd3` ([#2971](https://github.com/moeru-ai/airi/pull/2971)), Sherpaw 0.3.0.
  - `d7c973711` ([#2975](https://github.com/moeru-ai/airi/pull/2975)), the speaker tracker runtime and the CAM++ speaker model pack, about 28 MB.
  - `7189b7ead` ([#2980](https://github.com/moeru-ai/airi/pull/2980)), voiceprint enrollment.
  - `79792e161` ([#2989](https://github.com/moeru-ai/airi/pull/2989)), speaker recognition.
- **What it adds:** The owner enrolls a voiceprint. While Speaker recognition is on, each voice input is compared with it, and the score goes into the IO trace of the input.
- **Why it matters here:** A desktop character plays through open speakers. Speaker gates would start voice input only for the owner and would reject the character's own echo and other people in the room.
- **Fork conflicts (2026-10-26):** #2975 4 files, #2980 4 files, #2989 11 files. #2971 applies cleanly.
- **Revisit when:** The speaker gates exist. At #2989, recognition "changes no input": it records a score, and the chat model does not receive it. Import the series when a gate actually decides whether a voice input starts.
- **Search terms:** `speaker`, `voiceprint`, `CAM++`, `sherpaw`, `speaker gate`.

## Rule-based voice input decisions and speculative rewrites

- **Upstream:** `b039c917c` ([#2995](https://github.com/moeru-ai/airi/pull/2995)), 2026-10-17. 108 files across core-agent, stage-ui, stream-kit, pipelines-audio, and the audio test harness.
- **What it adds:** Rules decide when a voice input is complete, and the runtime speculates rewrites of the input while the user still speaks.
- **Why it matters here:** Turn-taking is what makes voice conversation with the character feel natural.
- **Fork conflicts (2026-10-26):** 8 files. The change overlaps the fork's presence work: the `user-speaking` gate suppressor and the voice interruption control records.
- **Revisit when:** Upstream's voice input pipeline stops changing, with no follow-up rewrites of the same modules for a few weeks. Also wait until speaker gates land, because they decide which voice inputs start at all. Before importing, check the fork's `user-speaking` and interruption behavior against the new decision rules.
- **Search terms:** `voice input`, `speculat`, `rewrite`, `turn detection`, `stream-kit`.
