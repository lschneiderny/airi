# one-desktop-host - Work Plan

Status: done on `luke/refactor/one-desktop-host` (2026-11-17). Luke approved H1, remove now, the same day. The roadmap row moves to done once the roadmap is on `main`. Roadmap row: step H in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md).

## TL;DR (For humans)

**What changes:** The saved stage mode (`window` or `desktop`) goes away. With the Experimental 3D stage setting on, an MMD model always gets the desktop stage. With it off, every model gets the classic window. The setting is the only switch.

**Why:** Two switches decide one thing today. `selectHostMode` ends with `return config.mode`, a rollback path that lets an MMD model keep the classic window while the setting is on. The setting already gives that rollback. CM6 builds gaze intents for one host mode per launch, and this branch is the last place where an MMD model on an opted-in profile can land on either host.

**Branch:** `luke/refactor/one-desktop-host`, from `main` after PR A lands. One PR.

**Effort:** S. **Risk:** Low. The change removes a path; it adds none.

## What the code does today

- `selectHostMode` in `apps/stage-tamagotchi/src/main/windows/stage/mode.ts` picks the host once per launch. Step 5 returns the saved `config.mode` under a `// NOTICE:` block.
- The `NOTICE` names its removal condition: roaming, chat anchoring, and display hand-off ship, plus one feedback cycle. Roaming, chat anchoring, and display hand-off have landed. The fullscreen stage ADR still lists a crossing between two physical displays as a check only Luke can run.
- `mode` has three writers:
  - The mode selector in `packages/stage-ui/src/components/scenarios/settings/model-settings/mmd.vue`, through `DesktopStageHost.setMode` and `electronStageSetMode`.
  - The watcher in `apps/stage-tamagotchi/src/renderer/composables/use-desktop-stage-host.ts`, which writes `window` when the stage model is not MMD.
  - The click-through notice in `apps/stage-tamagotchi/src/main/windows/stage/index.ts`, which writes `window` and relaunches when click-through is unusable.
- `mode` has these readers: `selectHostMode`, `buildStageHostState`, the settings page, the `nonMmdNotice` computed value, and the story in `desktop-stage.story.vue`.

## Decision (Luke, 2026-11-17)

| # | Question | Decision |
| --- | --- | --- |
| H1 | Remove the saved mode now, or keep the rollback and record why? | **Remove now.** The Experimental setting stays, so the classic window is still one toggle and a relaunch away. The pending physical-display check does not need a second switch. |

## Steps

1. **Main process.** Remove `mode` from `stageConfigSchema` and `defaultStageConfig`. `selectHostMode` returns `'desktop'` after the renderer check, and the `NOTICE` block is deleted. The click-through notice turns `experimental` off instead of writing `mode`. Remove `electronStageSetMode`, its handler, and `mode` from `StageHostState` and `buildStageHostState`. A stored `mode` key in `stage-config.json` is dropped by the schema on the next read, so no compatibility guard is added.
2. **Renderer and settings.** Remove `setMode` from `DesktopStageHost` and from `useDesktopStageHost`, with the watcher that writes `window` for a model that is not MMD. `nonMmdNotice` reads `experimental` and `running`. Remove the mode selector from `mmd.vue`, its `settings.mmd.stage.mode.*` strings from the English locale, and the `mode` field from the story.
3. **QA tooling.** Find every `qa-tools` profile seed that writes `mode` into the stage config and remove the key. `AIRI_STAGE_HOST` stays, because QA runs use it to force a host.
4. **Tests.** Update `mode.test.ts`: the cases that pass `mode: 'window'` for an MMD model go, and the remaining cases assert `'desktop'` after the renderer check. Update the config, RPC, and composable tests that name `mode`.
5. **Docs.** Update the "Desktop stage window" section of `apps/stage-tamagotchi/README.md` and `docs/ai/context/ui-components.md` for the removed selector. Set roadmap step H to done if PR B has merged; otherwise the roadmap edit rides with B's rebase.

## Must not do

- Do not change the Experimental setting, the Linux eligibility gate, or the renderer rule.
- Do not edit the body of the fullscreen stage ADR. The follow-up it lists is history.
- Do not tune stage behavior. Gaze and locomotion wait for CM6.

## Checks

- Each commit: `pnpm verify`.
- The PR: `pnpm verify --gate` and `pnpm qa:display run -- pnpm qa:smoke`.
- Rendered check: one `qa:app` run with an MMD model and the Experimental setting on, confirming the launch builds the desktop stage, and one with the setting off, confirming the classic window.

## Done when

The rollback branch in `selectHostMode` and its `NOTICE` are gone, no code reads or writes a saved stage mode, and the checks above pass.
