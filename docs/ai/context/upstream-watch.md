# Upstream watch list

This list tracks upstream `moeru-ai/airi` systems that the fork does not carry, or carries without the part that matters. Each entry says what upstream has, why it matters here, and the condition for another look.

The fork merges upstream as a whole ([upstream policy ledger](upstream-policy.md)). `main` contains upstream through `b3a6d6071` (2026-11-18), so every upstream system from before that commit is in the tree unless the README's Retired table or the ledger says otherwise. The sync of 2026-11-18 removed four entries from this list, because their systems arrived as upstream ships them: speaker recognition, rule-based voice input decisions, chat actions in the window with the speech-player role, and speech text transformation.

## How to re-check an entry

1. Fetch upstream with `git fetch upstream`.
2. Look for follow-ups with `git log --oneline main..upstream/main -i --grep=<search terms>`.
3. When an entry's revisit condition holds, judge the whole system at the next sync, not one commit. The fork does not port single upstream commits.
4. Record the outcome: remove the entry, or add or change a row in the ledger.

## Automations (auto-run recipes)

- **Upstream:** The skills, automations, and memory design in `docs/ai/adr/2026-10-10-skills-automations-and-memory.md`. The sync brought recipes, decisions, background tasks, chat notices, and scene sessions. Recipes start from a keyword in the owner's message, the use-recipe tool, or the judge tool. The auto-run tab in Settings shows a banner that says the feature is in development, and no trigger runs a recipe unasked.
- **Why it matters here:** Upstream's planned triggers (silence, intervals, local time, owner activity, module observations) overlap the fork's situation gate. Two systems would then decide when the character speaks unasked.
- **Fork position:** The mind's voice channel is the only decider for unasked speech ([autonomous behavior](autonomous-behavior.md)). A background task that settles sends a notice turn, and the model can speak then; such turns do not count as the owner or the character speaking in the situation sensors.
- **Revisit when:** Upstream ships a trigger. At that sync, route it through the voice policy or keep it off, and record the choice in the ledger.
- **Search terms:** `recipe`, `auto-run`, `automation`, `scheduler`, `background task`, `scene`.

## Kirie desktop host

- **Upstream:** `apps/stage-tamagotchi-kirie`, a Godot desktop host that renders the Stage Vue renderer through CEF on [`moeru-ai/godot-kirie`](https://github.com/moeru-ai/godot-kirie).
- **What it adds:** A replacement for Electron as the desktop shell. Upstream ships Electron and keeps it as the behavior reference while Kirie catches up.
- **Why it matters here:** If upstream makes Kirie its primary desktop host, upstream desktop fixes will land there and stop applying to the fork's Electron app.
- **Fork position:** Retired on 2026-10-31; each sync drops upstream's changes to it. Every fork desktop feature is Electron-only: the foreground sensor, situational presence, unprompted turns, chat attention, and the Godot VRM sidecar launch. A port means reimplementing those host adapters for Kirie. The Godot VRM engine in `engines/stage-tamagotchi-godot` is separate and stays.
- **Revisit when:** Upstream ships Kirie as a packaged desktop release, the Windows CEF exit crash (GAP-015 in its `MIGRATION.md`) is fixed, and the deferred server channel, plugin host, and model-rendering acceptance are done.
- **Search terms:** `kirie`, `godot-kirie`, `tamagotchi-kirie`, `cef`.

## Pocket mobile host

- **Upstream:** `apps/stage-pocket`, the Capacitor Android and iOS host, and its `packages/cap-vite` development wrapper.
- **Fork position:** Retired on 2026-11-04 under H2 in the [architecture boundaries audit](../audits/2026-10-31-architecture-boundaries.md). Neither package serves the desktop companion. Their native builds, scripts, and shared host branches imposed maintenance on every routing change. Each sync drops upstream's changes to them, and the catalog leaves out the `@capacitor/*` entries.
- **Revisit when:** The owner chooses to support a native mobile host again, with maintained Android and iOS build and device validation. Port the host and its adapters together against the current shared contracts; do not restore the old routing exclusions blindly.
- **Search terms:** `stage-pocket`, `cap-vite`, `capacitor`, `android`, `ios`.
