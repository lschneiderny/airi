# Character mind roadmap

This page tracks the order and status of the work that moves the client to the target design in the [character mind ADR](../adr/2026-11-17-character-mind-direction.md). The ADR records the decisions. The Target sections of the policy docs hold the rules. This page records the order, the dependencies, and what "done" means for each step.

## How the work lands

- **Strangler slices.** Each slice routes one kind of [stimulus](glossary.md#stimulus) through the [character mind](glossary.md#character-mind) and deletes the old path it replaces in the same PR. The app works after every slice. No slice keeps the old path behind a setting.
- **Docs move with code.** A slice moves each rule it lands from a policy doc's Target section into that doc's current sections, and removes the overlaps and gaps it closes, in the same PR. The open entries in the Target tables are the remaining work.
- **Upstream first.** A slice starts after a sync. Its plan opens with what upstream has for that behavior today, and says what the slice adopts, builds beside, or changes. It names each upstream file it changes and why ([ADR decision 14](../adr/2026-11-17-character-mind-direction.md#scope-and-order)).
- **One plan per slice.** A slice gets an `.omo/plans/<slug>.md` plan when it starts. The plan links back to its row here.
- **One PR per slice**, against `lschneiderny/airi`, rebase-merged. Each commit passes `pnpm verify`; the PR passes `pnpm verify --gate`. A slice that changes app runtime behavior also passes `pnpm qa:display run -- pnpm qa:smoke`, and a rendered check with `qa:app` or the `airi-qa` MCP server for the behavior it moves.

## Steps

| Step | What lands | Depends on | Done when | Status |
| --- | --- | --- | --- | --- |
| 0a | Support scope, policy docs, tooling cleanup (`luke/refactor/lock-in`) | | Merged to `main` | Done (`dfe5a2ead`) |
| 0b | This roadmap, the character mind ADR, and the policy Target sections (`luke/docs/character-mind-direction`) | 0a | Merged to `main` | Done (`80c1b759d`) |
| 1 | Upstream sync (see [Upstream sync](#upstream-sync)) | 0a, 0b | `main` contains `upstream/main` as of the sync; the policy ledger exists; the fork runs upstream's per-package `test:run` | Done on 2026-11-18: merges `4b1e405a4`, `9d9b45354`, `14c763cfb`, and `e259d4c6e` bring upstream through `b3a6d6071` |
| CM1 | Touch, and with it the mind's pure core, its types, and the shell that calls it in-process in the window that hosts the stage. Decides where the mind lives together with whether `stage-shared` is renamed or split (architecture audit R5) | 1 | Autonomous behavior overlap 4 closed under Natural: one touch gets one coordinated response that keeps the touch rulings in the autonomous-behavior Target. The expression decider splits: emotion in the mind, asset choice in each performer. Core tests run with a seeded random source and no Vue; the package decision is recorded | Not started |
| CM2 | Return and desktop events | CM1 | Overlap 6 closed | Not started |
| CM3 | Voice channel: the urge gate and spoken reactions become the mind's voice policy. States the responsibility boundary of `chat.ts` and the orchestrator runtime (audit R11): the mind decides to speak, chat runs the turn | CM1, V | Overlaps 3 and 10 closed; Autonomous behavior Target rule 9 and LLM prompt Target rule 6 land; widget and plugin turns go through the voice policy with the model's veto, the caller always gets the outcome, and a turn not spoken before the caller's timeout falls back to the notify route; the voice rulings hold; the chat boundary is written in the stage-ui guide | Not started |
| S | State registry and its test; the four hand-rolled settings documents move onto `useSettingsDocument` | 1 | State persistence Target rules 1, 2, and 6 land; every persisted renderer key is registered; the main-process records stay with `storedDataDeleteActivity`, and perf records stay a named exception | Not started. `main` already deletes the main-process logs, IO traces, and computer-use store with all data (`5d0f65556`) |
| V | Privacy enforcement (audit R14): a memory write filter for titles and secrets; widget topic text through `unpromptedTopicText` instead of the headline and note; a stated rule for plugin system authority, including the text the Spark Notify agent appends uncapped; title filtering for extracted thread summaries and MOOD-cue reasons | 0a | Each stated privacy rule has code behind it | Done. Held titles stay out of memory, extracted threads and events, MOOD cue reasons, and widget trigger messages; the plugin authority rule is stated in the LLM prompt doc. The cap on the text the Spark Notify agent appends lands with step P |
| CM4 | Idle draw moves into the mind; one mind per character in the leader; slow state persists | CM3, S, V | Overlaps 5 and 9 closed; State persistence Target rule 5 lands: the per-card character-state record is the mind's slow state, leader-written. Sharing a card carries the profile only, and a backup carries the whole record (today's export becomes the backup). The floor and the hourly cap stay per user | Not started |
| CM5 | Music under Natural: one detector and a groove episode; beat sync stays only for the upstream drivers | CM4 | Overlaps 1 and 2 closed under Natural; Body ownership Target rule 2 lands for grooves | Not started |
| H | One desktop host: remove the classic window mode for MMD. The host-service wiring is already shared (`useStageHostWiring`, `1a2ede5a9`) | 0a | The rollback branch in `selectHostMode` and its `NOTICE` are gone, or keeping them is recorded | Done (`df8d1beba`): the saved stage mode is removed, and the Experimental 3D stage setting is the only switch |
| CM6 | Gaze: cursor notice and glances through the mind; the MMD director acts on intents | CM4, H | Overlaps 7 and 8 closed; Body ownership Target rule 8 lands; walking toward a resting pointer no longer makes presses aimed at her miss | Not started |
| CM7 | Natural becomes the only driver the mind drives, and Universal, MAGIC, and classic declare no capabilities; performers declare capabilities; one character-behavior settings document | CM5, CM6 | Body ownership Target rules 1, 3, 4, and 5 land; Autonomous behavior Target rules 7 and 8 land; State persistence Target rule 4 lands. The screen-awareness and Presence sensor settings split into behavior and realisation parts; expression mapping weights become editable per character; the conversation register's home is decided | Not started |
| P | One prompt composer for every character call: the Spark Notify agent's appended instructions and plugin text go through `composePrompt`, and the `account` segment, which no app path produces, is deleted | 1 | LLM prompt Target rules 1 to 5 land | Partly done. Chat, `ingest`, unprompted turns, and the Spark Notify agent's base prompt already use `composePrompt` |
| T | cpu-slots as command-level leases; the intermittent `pnpm verify` browser import failure ("Failed to fetch dynamically imported module") | 1 | The A2 steps in `.omo/plans/fork-policy-and-tooling.md` are done; the flake is fixed or explained | Not started |
| L | Leftovers: the `isStageWeb()` branches and the `web` host profile (owner ruling 2026-11-17: remove); the three process-listing modules; the Live2D emotion gate code that lost its runner (`natural-emotion-t3` in `gates.ts`, `score-natural-captures.ts`, `extract-natural-reference.ts`; the idle liveliness test still runs); the `Emotion` enum duplicated in four packages; Mac confirmation of the observer golden hashes | 1 | Each is removed, merged, confirmed, or recorded as kept | Not started |

CM2 starts once CM1 has landed the core. S, V, H, P, T, and L are independent of one another and can run in parallel with the mind slices, but each must land before the slices that depend on it.

## Feature and tuning work

Tuning a behavior that a slice is about to rewrite is wasted work. Feature and tuning work waits for the slice that rewrites it. Work outside the slices proceeds at any time.

| Work | Waits for |
| --- | --- |
| Touch thresholds and the pet roll; cue gestures and reaction odds | CM1 |
| Reach-out cadence in daily use; reaching out without foreground data | CM3 |
| The Natural idle retune gate band; calibrating the character state over a month; cross-day callbacks and stored daily beats (reach-out cadence ADR, deferred) | CM4 |
| Screen-aware attention on real rigs; windows as surfaces on the desktop stage (3D roadmap M4) | CM6 |
| MMD feel against Live2D; the VRM adapter (3D roadmap M5); emotion clip craft and exaggeration (the 2026-10-24 motion research run) | CM7 |
| Foreground sensors (push-based sampling, the macOS sampler), packaging gates, model evaluation | Nothing |

## Upstream sync

The sync merged upstream in four steps on the `luke/chore/upstream-sync` branch. Each step is a real merge of the last upstream commit of a day on `upstream/main`'s first-parent history, resolved and checked before the next step started. `main` takes the finished branch by fast-forward, never through a GitHub PR, because a rebase merge would rewrite upstream's commits.

| Step | Upstream commit | Merge upstream as of | Upstream commits in step | Merge commit |
| --- | --- | --- | --- | --- |
| 1.1 | `6874cecc2` | 2026-10-23 | 114 | `4b1e405a4` |
| 1.2 | `ae9dfe5ec` | 2026-10-29 | 101 | `9d9b45354` |
| 1.3 | `120cad3a7` | 2026-11-04 | 117 | `14c763cfb` |
| 1.4 | `b3a6d6071` | 2026-11-18, upstream's tip | 107 | `e259d4c6e` |

The [upstream policy ledger](upstream-policy.md) lists every departure the sync made and the procedure for the next sync. Each merge commit message records that step's resolutions.

The sync adopted upstream's recipes, decisions, background tasks, chat notices, and scene sessions, which the memory adoption plan had kept out. Upstream has no trigger for auto-run recipes yet. A trigger that makes her speak unasked stays out: the mind's voice channel is the only decider for unasked speech.

Upstream features that collide with the target arrived in these steps. Under ADR decision 14 each is adopted: the merge takes upstream's version, and the slice that rewrites the behavior builds beside it or redesigns around it. The last column says what the sync did. Where it departs from plain adoption, the ledger records the reason.

| Upstream change | Step | Collides with | What the sync did |
| --- | --- | --- | --- |
| `c4048b6fa` Live2D expression store and controller deleted; card-owned controls and a Live2D context replace them | 1.1 | The fork's expression store, controller, panel, reactions, combos, rest look, and string ACT label; CM1 | Kept the fork's system and merged upstream's context in beside it (owner ruling 2026-11-17). CM1 reconciles the two |
| Recipes, decisions, background tasks, chat notices, and scene sessions | 1.1 | The voice channel as the only decider for unasked speech; CM3 | Adopted. Background task, scene, and notice turns do not count as the owner or the character speaking in the situation sensors, the character state, or the presence record |
| Update feed: the updater reads upstream's release store with upstream's key | 1.2 | Nothing in the target; a fork build must not install upstream's bundles | Departed: updates are off unless a build sets its own feed and key |
| `259b6188a` Live2D taps and head pats (#3292): a touch module in `stage-ui-live2d` | 1.3 | A second touch decider beside Natural's pet and poke layers; CM1 | Adopted under Universal and MAGIC. Under Natural the fork's pet, poke, touch regions, and spoken reaction stay the only response |
| `84df1c2df` MAGIC motion turns toward the cursor (#3285) | 1.3 | Cursor attention under Natural; CM6 | Adopted, under MAGIC only |
| `543d8dfe3` Beat Sync on top of MAGIC poses and on one clock (#3420) | 1.4 | Beat sync, which stays for the upstream drivers and leaves Natural in CM5; overlaps 1 and 2 | Adopted for the upstream drivers; the new layer is inactive under Natural |
| Error reporting through Sentry (#3458) | 1.4 | Nothing in the target; a fork build must not report to upstream | Departed: reports are off unless a build sets its own DSN, and an unset switch means off |
| The unstorage migration for IndexedDB repositories | 1.4 | The state registry (step S); the per-card character-state record (CM4) | Adopted. Fork-only repositories, the character-state repository among them, move to mounts on the same database and store, and old records still read |
| `2026-11-13-chat-selects-character.md` (proposed ADR) | 1.4 | Which character the mind belongs to; one mind per character (ADR decision 1) | Adopted with its code |
| `1c010856b` display model settings per model (#3544): the keys of five renderers move under `settings/models/<model id>/<renderer>/` | 1.4 | The Members table of the state persistence doc; the registry (step S); the character-behavior settings document (ADR decision 11) | Adopted. The fork's MMD motion driver and clip metadata move the same way; stance slots, clip curation, stage character height, and roam mode stay global. Live2D, Spine, and VRM keep the fork's defaults |
| `2026-11-11-module-defaults-and-character-values.md` (proposed ADR) | 1.4 | The character-behavior settings document (ADR decision 11) | Adopted with its code |

## Open questions

- **Where the mind lives.** CM1 decides between a new `packages/character-mind` and a module in `packages/stage-shared`, together with whether `stage-shared` is renamed or split. The pure core must not import Vue or a store.
- The open questions of the [character mind ADR](../adr/2026-11-17-character-mind-direction.md#open-questions).
