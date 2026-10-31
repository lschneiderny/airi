# Upstream watch list

This list tracks upstream `moeru-ai/airi` systems that could fit dTuber but are not ready to import. Each entry names the upstream commits, why the system matters here, how far it conflicts with the fork, and the condition for another look.

The upstream review of 2026-10-26 created this list. Commits that the fork took or rejected are not listed here.

## How to re-check an entry

1. Fetch upstream with `git fetch upstream`.
2. Look for follow-ups with `git log --oneline main..upstream/main -i --grep=<search terms>`.
3. Dry-run a commit against `main` without touching the working tree: `git merge-tree --write-tree --name-only --merge-base=<commit>^ main <commit>`. Exit code 1 lists the conflicting files.
4. When an entry's revisit condition holds, judge the whole system, not one commit. Then import it, or record why it stays out.

## Skills, long-term memory, and background tasks

- **Upstream:** Long-term memory was ported by hand on 2026-10-30 from `d70ab4dd3` ([#2748](https://github.com/moeru-ai/airi/pull/2748)) and `2c4d66c6b` ([#3241](https://github.com/moeru-ai/airi/pull/3241)). The memory code uses upstream paths: `packages/stage-ui/src/types/memory.ts`, `packages/stage-ui/src/database/repos/memory.repo.ts` and its `__mocks__` implementation, `packages/stage-ui/src/stores/memory.ts`, `packages/stage-ui/src/tools/memory.ts`, and `packages/stage-pages/src/pages/settings/modules/memory-long-term.vue` plus `memory-long-term-memories.vue`.
- **What it adds:** The character keeps a local index and one entry per lasting fact, with tools to read, write, and forget entries. The fork adds a settings page to manage memories, includes a card's own memories in its exported package, and exposes memory activity to devtools.
- **Why it matters here:** Long-term memory lets a character recall facts across sessions. The adoption keeps upstream paths for the memory subsystem while fitting the fork's chat and unprompted-turn contracts.
- **Fork conflicts:** The port omits upstream's localStorage legacy move and settings-search sidecar. Its prompt rules say the situation block does not establish a lasting fact unless the owner states it. Chat memory is bound to the character that owns the session, not the currently selected card. Spark Notify uses the active card's index. Unprompted turns receive only `builtIn_readMemory`, through the runtime's `unpromptedTools` option and stage-ui's `llm.ts` custom-tools-only path.
- **Revisit when:** If the fork wants skills, revisit this system and judge recipes alone. Recipes, decisions, background tasks, scene bindings, and automations stay out. Upstream automations for silence, intervals, local time, owner activity, and module observations overlap the fork's situation gate. Importing them would give two systems authority to decide when the character speaks unasked.
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

## Kirie desktop host

- **Upstream:** `apps/stage-tamagotchi-kirie`, a Godot desktop host that renders the Stage Vue renderer through CEF on [`moeru-ai/godot-kirie`](https://github.com/moeru-ai/godot-kirie). Recent ports include the system tray ([#3077](https://github.com/moeru-ai/airi/pull/3077)), the floating chat window ([#3140](https://github.com/moeru-ai/airi/pull/3140)), settings search ([#3113](https://github.com/moeru-ai/airi/pull/3113)), and renderer sync from stage-tamagotchi ([#3076](https://github.com/moeru-ai/airi/pull/3076)).
- **What it adds:** A replacement for Electron as the desktop shell. Upstream ships Electron and keeps it as the behavior reference while Kirie catches up.
- **Why it matters here:** If upstream makes Kirie its primary desktop host, upstream desktop fixes will land there and stop applying to the fork's Electron app.
- **Fork conflicts (2026-10-31):** The fork removed the app on 2026-10-31. Every fork desktop feature is Electron-only: the foreground sensor, situational presence, unprompted turns, chat attention, the IO trace hub, and the Godot VRM sidecar launch. A port means reimplementing those host adapters for Kirie. The Godot VRM engine in `engines/stage-tamagotchi-godot` is separate and stays.
- **Revisit when:** Upstream ships Kirie as a packaged desktop release, the Windows CEF exit crash (GAP-015 in its `MIGRATION.md`) is fixed, and the deferred server channel, plugin host, and model-rendering acceptance are done.
- **Search terms:** `kirie`, `godot-kirie`, `tamagotchi-kirie`, `cef`.

## Chat actions in the tab that has the Stage

- **Upstream:** `599336d03` ([#3101](https://github.com/moeru-ai/airi/pull/3101)), 2026-10-24. 7 files, and a `pinia-plugin-synced` bump from 0.1.5 to 0.1.6 for synced roles.
- **What it adds:** A context that mounts a Stage claims a speech-player role, and every chat action runs in a speech player. Without one, the leader runs them silently.
- **Why it matters here:** On stage-web with several tabs, a tab without a Stage can win the leader election. Replies then generate in that tab, and nothing speaks them. The desktop app is not affected: only the main window mounts a Stage, and it is the only window that can lead. Pocket runs one webview.
- **Fork conflicts (2026-10-26):** 2 files, `Stage.vue` and `chat.ts`. The change also moves chat actions away from the leader, while the fork's presence turns rely on the leader running them.
- **Revisit when:** Stage-web is used in several tabs, or upstream settles which Stage tab speaks. Upstream's own review note says that with several Stage tabs, an arbitrary one speaks and a cancel can miss its turn.
- **Search terms:** `speech player`, `syncedRoles`, `pinia-plugin-synced`, `Stage tab`.
