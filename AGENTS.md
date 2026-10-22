# PROJECT KNOWLEDGE BASE - AIRI

**Generated:** 2026-10-15T06:21:17Z | **Commit:** f3e6a244e1c0738a8181d9377d3b851e0b355d19 | **Branch:** main

## OVERVIEW
AIRI is the `moeru-ai/airi` pnpm monorepo for character interaction across web, Electron, mobile, and Godot hosts.
This personal fork documents account-free clients. Internal hosted/auth adapters do not prove that hosted services or client routes are enabled.
The Vue apps use Vue 3, Vite, TypeScript, Pinia, VueUse, UnoCSS, Vitest, and ESLint.

## STRUCTURE
```text
apps/          Web, Electron, Capacitor, Kirie, and standalone auth UI
engines/       Godot rendering sidecar, separate from Kirie
packages/      Shared UI, orchestration, models, audio, providers, and channel contracts
server/        Hosted API, independent identity, backend-only packages, local edge and stack
services/      Computer-use execution and orchestration
integrations/  Minecraft, messaging bots, X browser automation, and VS Code
plugins/       AIRI plugins and browser context extension
.github/       CI and locale automation
```

## WHERE TO LOOK
Before working in a directory, read its nested `AGENTS.md`. Read the matching task routing entry before starting.
| Task | Location | Notes |
| --- | --- | --- |
| Host apps | `apps/stage-{web,pocket,tamagotchi}/AGENTS.md` | Web pages: `src/pages`. Electron pages/devtools: `src/renderer/pages`. Mobile uses Capacitor, Kotlin, and Swift. |
| Kirie / engine / auth UI | [Kirie](apps/stage-tamagotchi-kirie/AGENTS.md), [renderer](apps/stage-tamagotchi-kirie/src-web/AGENTS.md), [Godot](engines/stage-tamagotchi-godot/AGENTS.md), [auth UI](apps/ui-server-auth/AGENTS.md) | Kirie migration scope lives in `MIGRATION.md`. |
| Routing / settings | `apps/stage-web/vite.config.ts`, `apps/stage-tamagotchi/electron.vite.config.ts` | Layouts: `packages/stage-layouts/src/layouts/settings.vue` and Electron `src/renderer/layouts/settings.vue`. |
| Shared business UI | [stage-ui](packages/stage-ui/AGENTS.md) | Definitions: `src/libs/providers/providers/`. Provider records/instances: `src/stores/providers/`. Orchestration: `src/stores/modules/`. |
| UI composition | `packages/stage-ui/src/{composables,components}` | Single-use business UI: `components/scenarios/`. Stories: `packages/stage-ui/stories`, `histoire.config.ts`, `src/components/misc/Button.story.vue`. |
| Shared boundaries | [core-agent](packages/core-agent/AGENTS.md), [providers](packages/provider-inference/AGENTS.md), [shared](packages/stage-shared/AGENTS.md), [pages](packages/stage-pages/AGENTS.md), [layouts](packages/stage-layouts/AGENTS.md), [primitives](packages/ui/AGENTS.md) | Pure orchestration stays outside Vue/store integration. |
| Models / capture | [Three/VRM](packages/stage-ui-three/AGENTS.md), [Live2D](packages/stage-ui-live2d/AGENTS.md), [MMD](packages/stage-ui-mmd/AGENTS.md), [MediaPipe](packages/model-driver-mediapipe/AGENTS.md) | Read renderer and capture guidance before visual acceptance. |
| Hosted backend | [server](server/AGENTS.md), [API](server/apps/api/AGENTS.md), [identity](server/apps/auth/AGENTS.md) | API owns migrations. Local stack: `server/docker-compose.yaml`. Edge: `server/dev/caddy/Caddyfile`. |
| Server channel | [runtime](packages/server-runtime/AGENTS.md), `packages/server-sdk`, `packages/server-shared` | Separate from hosted `server/packages`. Public plugin types: `@proj-airi/plugin-protocol/types`. |
| Computer use | [service](services/computer-use-mcp/AGENTS.md), [runtime](services/computer-use-mcp/src/AGENTS.md) | AIRI owns planning/providers/chat/approval UX. Service owns execution. Start terminal work at `terminal-lane-status.md`. |
| Automation / styles | [.github](.github/AGENTS.md), `uno.config.ts`, `eslint.config.ts` | Existing animations: `apps/stage-web/src/styles`. |

## CODE MAP
Digest evidence confirms these declarations. Repository-wide symbol totals and reference measurements are unavailable.
| Symbol | Type | Location | Refs | Role |
| --- | --- | --- | --- | --- |
| `createChatOrchestratorRuntime` | Function | `packages/core-agent/src/runtime/` | unavailable | Pure chat coordination |
| `useChatStore` | Store factory | `packages/stage-ui/src/stores/chat.ts` | unavailable | Vue chat integration |
| `createApp`, `buildApp` | Functions | `server/apps/api/src/app.ts` | unavailable | Dependency composition and resolved app construction |
| `createAuth` | Function | `server/apps/auth/src/auth.ts` | unavailable | Better Auth/OIDC ownership |
| `setupApp`, `createServer` | Functions | `packages/server-runtime/src/index.ts`, `src/server/index.ts` | unavailable | Authenticated WebSocket channel |

## CONVENTIONS
- Keep changes in scope. Correct rule violations in touched functions/components/tests, not unrelated code. Refactor small changes step by step.
- Do not add one-off patterns. Before adding utilities, search internal implementations. If logic can become shared, propose that approach to the user. Put shared logic in `packages/`. Keep module boundaries clear.
- Use kebab-case filenames. Do not use `any`. Prefer generics. Use `as unknown as <Type>` only when safe type fixes fail.
- Omit TS/JS extensions from relative imports, dynamic imports, and re-exports. Retain extensions required by runtimes or asset formats.
- Use `@moeru/eventa` for all IPC, RPC, and cross-process events. Centralize contracts, for example in Electron `src/shared/eventa/`.
- Use `injeca` dependency injection only at external boundaries: databases, model runtimes, queues, caches, filesystems, networks, clocks, environments, feature gates.
- Do not add dependency objects for internal sibling calls or parameter forwarding.
- Prefer classes for runtime/browser APIs and substantial stateful business modules with lifecycle or domain ownership. Prefer functions for pure transformations/local helpers.
- Use Valibot schemas near consumers. Use `errorMessageFrom(error)` from `@moeru/std`, with `?? 'fallback'` when needed. Prefer other `@moeru/std` error patterns.
- Settings/devtools pages need `<route lang="yaml"> meta: layout: settings </route>`. Register routes and icons in the settings layout.
- Electron main/renderer examples: `src/main/services/electron`. DI example: `apps/stage-tamagotchi/src/main/index.ts`.
- Preserve the public `@proj-airi/stage-ui/stores` forwarding barrel. Shared component API edits also update `docs/assets/ai/context/ui-components.md` and stories.
- Put project/client ADRs in `docs/ai/adr/`, hosted backend ADRs in `server/docs/ai/adr/`. Follow [server ADR rules](server/AGENTS.md).
- Keep documentation with its code in the same commit/PR. Keep agent configuration changes in a separate commit/PR.
- Keep structured `README.md` files in each `packages/` and `apps/` entry: purpose, usage, when to use, and when not to use.
- Put translations in `packages/i18n`. Edit only English source and your own locale unless asked. Crowdin owns other locales.
- Add only implemented locales. Do not insert English placeholders into other locales.
- When adding nested `AGENTS.md`, add adjacent `CLAUDE.md` containing only `@AGENTS.md`. Root Claude guidance otherwise blocks nested discovery.

### Dependencies
- Prefer `es-toolkit` for general utilities. Ask before adding another general utility library, including `unjs` or `tinylib` packages.
- For node builtins, DOM, Vue composables, React hooks, Vite plugins, and GitHub workflows, research existing libraries first.
- Before choosing a library, ask the user to choose and compare options. For spec-driven work, provide a Markdown comparison table.
- For requested tools/dependencies, read Context7 documentation first, then repository usage. Ask when returned names lack clear differences.
- If documentation conflicts with typecheck, inspect dependency source in `node_modules`.

## ANTI-PATTERNS (THIS PROJECT)
- Do not hide import/type errors in `tsconfig.json`. Reconsider ownership for circular imports. Ask if the cycle cannot be resolved confidently.
- Do not add backward-compatibility guards. For extended old caller/data support, document the target refactor. Start another Codex/Claude shell session for it.
- Temporary compatibility fallbacks require `// NOTICE:` and removal conditions. Document permanent fallbacks as supported policy, not legacy.
- Nested guidance can override the compatibility rule for public contracts only by naming the overridden root rule.
- Explicit contract exceptions exist in [API](server/apps/api/AGENTS.md), [auth UI](apps/ui-server-auth/AGENTS.md), [CCv3](packages/ccc/AGENTS.md), and [MediaPipe](packages/model-driver-mediapipe/AGENTS.md).
- Mark every workaround with this comment format:
```ts
// NOTICE:
// Why this workaround is needed.
// Root cause summary.
// Source/context (file, issue, URL, or node_modules reference).
// Removal condition (when it can be safely deleted).
```

## UNIQUE STYLES
- Write clear, complete sentences. Use consistent terms and remove filler.
- Distinguish requirements, recommendations, and uncertainty. Preserve code, identifiers, commands, and quoted errors.
- Put conditions before commands. Use Conventional Commits without gitmoji, for example `feat(<package name>): add runner reconnect backoff`.
- Name branches `username/feat/short-name`. Rebase when pulling.
- This personal fork has no required PR, release-note, attachment-upload, or Crowdin maintenance workflow.

## COMMANDS
Use workspace `package.json` names with pnpm filters, for example `@proj-airi/stage-tamagotchi`.
```bash
pnpm dev                           # Web
pnpm dev:tamagotchi                 # Electron
pnpm dev:pocket:ios                 # Mobile iOS
pnpm dev:pocket:android             # Mobile Android
pnpm dev:backend                    # Local backend stack
pnpm dev:ui                         # UI development
pnpm -F <package-name> typecheck
pnpm exec vitest run <path>
pnpm -F <package-name> exec vitest run
pnpm test:run
pnpm -F <package-name> build
pnpm qa:doctor
pnpm qa:test
pnpm qa:motion
pnpm qa:report
pnpm typecheck
pnpm lint                          # ESLint also formats
pnpm lint:fix
pnpm verify                        # Changed-file typecheck, lint, and related tests
pnpm wt ls                         # Worktrees: idle time, uncommitted files, live processes
pnpm dev:top                       # Dev process memory and CPU per worktree
pnpm slots status                  # CPU slot budget: store path, held leases, queued work
```
After each task, run `pnpm verify` before finishing. It typechecks the changed packages and their dependents through Turbo, lints the changed files, and runs the tests related to them. It typechecks every package when a root config file changes. It skips a step that already passed on the same working tree.
Use `pnpm lint` or root `pnpm typecheck` only when a task needs the whole repository checked. Report only executed checks, their commands/results, changes, and follow-up work.
When `pnpm run` or `pnpm exec` fails because dependencies are out of date, run `pnpm install` once explicitly. The workspace sets `verifyDepsBeforeRun: error` so installs never start silently.
Create and remove worktrees with `pnpm wt new <name>` and `pnpm wt rm <name>`. Stop a worktree's processes with `pnpm dev:top kill <name> --yes`, never by PID alone.
If Vitest finds no tests, inspect `vitest.config.ts` includes. Source-only packages can lack build scripts. Use their nested guidance.
Electron build runs `electron-vite build`, not typecheck. Its typecheck runs `vue-tsc --noEmit`. Stage UI uses `test:run` and has no compilation build.

Build, typecheck, and QA scripts take CPU slots from a shared budget through `pnpm slots run --class <class>`. If a command waits, run `pnpm slots status` to see who holds the budget and what is queued. Set `AIRI_CPU_SLOTS=off` to disable the broker for a shell and run commands without a lease. If a command prints `cpu-slots: dist/vitest.mjs is stale`, run `pnpm -F @proj-airi/cpu-slots build`. Never bypass the broker or its stale guard.

## TASK ROUTING
Read the listed file before starting. Skill paths below are under `.agents/skills/`.
| Task | Read |
| --- | --- |
| UI appearance/interaction design, changes, review | [DESIGN.md](DESIGN.md) |
| TypeScript/Vue writing, refactoring, review | [enforce-rules-for-typescript](.agents/skills/enforce-rules-for-typescript/SKILL.md) |
| Tests, bug reproduction, mocks, test import boundaries | [enforce-rules-for-vitest](.agents/skills/enforce-rules-for-vitest/SKILL.md) |
| UnoCSS, Vue styles, components, animation, icons, color mode | [enforce-rules-for-unocss](.agents/skills/enforce-rules-for-unocss/SKILL.md) |
| Adding `synced` or changing synced Pinia stores | [enforce-rules-for-pinia-synced](.agents/skills/enforce-rules-for-pinia-synced/SKILL.md) |
| User-visible strings or glossary terms | [i18n guidance](packages/i18n/AGENTS.md) |
| Server work | [server](server/AGENTS.md), plus [API](server/apps/api/AGENTS.md) or [Auth](server/apps/auth/AGENTS.md) for those apps |
| Documentation, comments, and commit text | Follow the prose rules under Unique Styles above. |
| Slow/failed chat, speech, audio using saved IO traces | [analyze-io-traces](.agents/skills/analyze-io-traces/SKILL.md) |
| Local file upload via browser/Electron chooser or input | [Upload reference](.agents/skills/use-agent-browser-for-airi/references/input-file.md), [agent-browser](.agents/skills/agent-browser/SKILL.md). For Electron, also [agent-browser-electron](.agents/skills/agent-browser-electron/SKILL.md). |
| Screenshots and visual evidence | [use-vishot](.agents/skills/use-vishot/SKILL.md). Load only the matching runtime and scenario references. |
| Live2D, VRM, MMD import/rendering in web, desktop, mobile | [use-agent-browser-for-airi](.agents/skills/use-agent-browser-for-airi/SKILL.md) |
| Motion QA, emotion/idle gates, rendered motion runs | [motion-qa](.agents/skills/motion-qa/SKILL.md) |

## NOTES
Nested guides own local exceptions and package-specific checks. Historical ADRs/audits and scanner observations are not current runtime acceptance.
Kirie is separate from Electron and the Godot sidecar. Its deferred features and native approvals remain governed by its migration guidance.
