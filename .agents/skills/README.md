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
| `stage-tamagotchi-godot-csharp` | Kirie and Godot C# migration guidance. |
| `analyze-io-traces` | Saved chat, voice, and audio trace analysis. |
| `motion-qa` | Motion, emotion, and idle QA levels, gates, and evidence workflow. |

## Planning vault

| Skill | Use |
| --- | --- |
| `idea` | Save an idea or bug to the Obsidian vault inbox at `Z:/Obsidian/dTuber/00 Inbox`. |
| `triage` | Propose and apply outcomes for vault inbox notes after the user approves them. |
| `vault-sync` | Bring the vault up to date with the repository after new commits, after the user approves the proposal. |

## Tools and integration references

| Skill | Use |
| --- | --- |
| `agent-browser` | Version-matched instructions for interactive browser inspection. Requires the CLI. |
| `agent-browser-electron` | Electron target discovery and window-role preservation. |
| `use-agent-browser-for-airi` | AIRI model imports. Its references also cover ordinary, detached, and native file inputs. |
| `use-vishot` | Screenshot evidence. Load the Web, Electron, Capacitor, input-file, or AIRI reference as needed. |
| `eventa` | Project event and RPC contracts. Check the installed dependency when API details differ. |
| `xsai` | Existing xsAI integration work. |

Generic Vue, Pinia, VueUse, UnoCSS, and bundler tutorials are not vendored as skills.
Use installed dependency types, existing repository code, and official documentation for API details.
Keep project-specific conventions in the retained rule skills.
For workspace maintenance, inspect `package.json`, `pnpm-workspace.yaml`, and existing patches before changing dependency configuration.
For translation changes, follow `packages/i18n/AGENTS.md`.
PR publishing, GitHub attachment uploads, release notes, and Crowdin batch maintenance are not repository skills.

`skills-lock.json` records imported skill sources. Local workflows are maintained in this repository.
No tool, application dependency, or runtime feature was removed with the tutorial skills.
