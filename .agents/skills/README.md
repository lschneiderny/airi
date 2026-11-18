# Repository skills

Skills provide task-specific instructions. They do not install tools or enable application features.
Load only the skill for the current task and the references needed for that task.
This personal fork keeps local development workflows, not upstream publishing or translation maintenance.

## Project rules and diagnostics

| Skill | Use |
| --- | --- |
| `enforce-rules-for-typescript` | TypeScript and Vue contracts, boundaries, and lifecycle rules. Use Composition API with `<script setup lang="ts">` for Vue components. |
| `enforce-rules-for-unocss` | Local styling, shared primitives, icons, and themes. |
| `enforce-rules-for-vitest` | Test scope, regression coverage, Vue tests, and runtime boundaries. |
| `enforce-rules-for-pinia-synced` | Cross-window ownership, replication, and persistence. |
| `enforce-rules-for-ui-tests` | How to verify UI work, and which UI tests are allowed. |
| `enforce-rules-for-ui-components` | Pages, panels, lists, forms, borders, and loading, empty, and error states. |
| `enforce-rules-for-fonts` | Font families, `@font-face`, and font packages. |
| `enforce-rules-for-render-loops` | Motion, reactions, and springs that a render loop samples. |
| `design-audio-visualizations` | Visuals that react to a microphone or to playback. |
| `stage-tamagotchi-godot-csharp` | Godot engine C# method and style. |
| `analyze-io-traces` | Saved chat, voice, and audio trace analysis. |
| `motion-qa` | Motion, emotion, and idle QA levels, gates, and evidence workflow. |

## Planning vault

| Skill | Use |
| --- | --- |
| `idea` | Save an idea or bug to the Obsidian vault inbox (`00 Inbox` under `$DTUBER_VAULT`). |
| `triage` | Propose and apply outcomes for vault inbox notes after the user approves them. |
| `vault-sync` | Bring the vault up to date with the repository after new commits, after the user approves the proposal. |

## Tools and integration references

| Skill | Use |
| --- | --- |
| `agent-browser` | Version-matched instructions for interactive browser inspection. Requires the CLI: install `agent-browser@0.41.2`, the version the fork tests with. |
| `agent-browser-electron` | Electron target discovery and window-role preservation. |
| `use-agent-browser-for-airi` | AIRI model imports. Its references also cover ordinary, detached, and native file inputs. |
| `use-vishot` | Screenshot evidence. Load the Web, Electron, input-file, or AIRI reference as needed. |
| `eventa` | Project event and RPC contracts. Its Electron main example passes `webContents`; the installed adapter takes a `BrowserWindow`. In the desktop app, follow `apps/stage-tamagotchi/AGENTS.md` instead. |
| `xsai` | Existing xsAI integration work. |

## Upstream skill text

The fork owns this file, the `enforce-rules-for-typescript`, `enforce-rules-for-vitest`, and `xsai` skills, the planning vault skills, `motion-qa`, and the reference files named below. Every other skill carries upstream's exact text, so that an upstream sync does not conflict. See the [upstream policy ledger](../../docs/ai/context/upstream-policy.md).

Upstream's text can name hosts the fork retired: stage-web, stage-pocket, and Kirie. Only the desktop app applies. It also invokes upstream skills that the fork merged into references:

| Upstream skill | Read in the fork |
| --- | --- |
| `use-agent-browser-with-input-file` | `use-agent-browser-for-airi/references/input-file.md` and the references beside it |
| `use-vishot-for-airi` | `use-vishot/references/airi.md` |
| `use-vishot-with-electron` | `use-vishot/references/electron.md` |
| `use-vishot-with-web` | `use-vishot/references/web.md` |
| `use-vishot-with-input-file` | `use-vishot/references/input-file.md` |
| `use-vishot-with-capacitor`, and the `web.md` and `mobile.md` references of `use-agent-browser-for-airi` | Nothing. They serve retired hosts. |

When upstream's text and a fork `AGENTS.md` disagree, the `AGENTS.md` wins.

Generic Vue, Pinia, VueUse, UnoCSS, and bundler tutorials are not vendored as skills.
Use installed dependency types, existing repository code, and official documentation for API details.
Keep project-specific conventions in the retained rule skills.
For workspace maintenance, inspect `package.json`, `pnpm-workspace.yaml`, and existing patches before changing dependency configuration.
For translation changes, follow `packages/i18n/AGENTS.md`.
PR publishing, GitHub attachment uploads, release notes, and Crowdin batch maintenance are not repository skills.

`skills-lock.json` records imported skill sources. Local workflows are maintained in this repository.
No tool, application dependency, or runtime feature was removed with the tutorial skills.
