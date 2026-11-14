# AIRI

This is a personal fork of the `moeru-ai/airi` pnpm monorepo. It documents account-free clients. Internal hosted/auth adapters do not prove that hosted services or client routes are enabled.

## AGENTS.md POLICY
Agent guidance holds only what an agent cannot learn from the code, `package.json`, or a README. Repository overviews cost tokens without improving task success ([Gloaguen et al., 2026](https://arxiv.org/abs/2602.11988)).
- Write conventions, prohibitions, ownership boundaries, non-standard commands, flags, and environment variables, gotchas, and required reading before a specific task.
- Do not write overviews, directory trees, "where to look" tables, code maps, symbol or reference counts, or generated headers. They go stale and the agent can read the code.
- Do not list commands that follow the standard `pnpm -F <package> typecheck | build | test` shape. List only commands with special flags, projects, or ordering.
- Edit guidance by hand. Do not regenerate it with init-deep, `/init`, or another generator. Add a rule after an agent gets something wrong, and remove rules that stop applying.
- Put a rule in the nested file closest to the code it governs. Put it here only when it applies across packages.
- Keep each nested `AGENTS.md` short. When one has no package-specific rules left, delete it and its `CLAUDE.md`.

## CONVENTIONS
- Keep changes in scope. Correct rule violations in touched functions/components/tests, not unrelated code. Refactor small changes step by step.
- Do not add one-off patterns. Before adding utilities, search internal implementations. If logic can become shared, propose that approach to the user. Put shared logic in `packages/`. Keep module boundaries clear.
- Use kebab-case filenames. Do not use `any`. Prefer generics. Use `as unknown as <Type>` only when safe type fixes fail.
- Omit TS/JS extensions from relative imports, dynamic imports, and re-exports. Retain extensions required by runtimes or asset formats.
- Use `@moeru/eventa` for all IPC, RPC, and cross-process events. Centralize contracts, for example in Electron `src/shared/eventa/`.
- Use `injeca` dependency injection only at external boundaries: databases, model runtimes, queues, caches, filesystems, networks, clocks, environments, feature gates. Do not add dependency objects for internal sibling calls or parameter forwarding.
- Prefer classes for runtime/browser APIs and substantial stateful business modules with lifecycle or domain ownership. Prefer functions for pure transformations/local helpers.
- Use Valibot schemas near consumers. Use `errorMessageFrom(error)` from `@moeru/std`, with `?? 'fallback'` when needed. Prefer other `@moeru/std` error patterns.
- Settings/devtools pages need `<route lang="yaml"> meta: layout: settings </route>`. Register routes and icons in the settings layout: `packages/stage-layouts/src/layouts/settings.vue` for web, `apps/stage-tamagotchi/src/renderer/layouts/settings.vue` for Electron.
- Keep pure orchestration outside Vue/store integration.
- Reuse existing animations in `apps/stage-web/src/styles` before adding new ones.
- Before changing host capabilities, read the [host capability contract ADR](docs/ai/adr/2026-11-08-host-capability-contract.md).
- The Electron desktop stage host is gated by the off-by-default Experimental 3D stage setting. `AIRI_STAGE_HOST=window|desktop` overrides the saved mode in development builds only, for QA.
- The server channel (`packages/server-runtime`, `packages/server-sdk`, `packages/server-shared`) is separate from hosted `server/packages`.
- For 3D character motion work, track milestones in `docs/ai/3d-character-roadmap.md`.
- Electron main/renderer examples: `src/main/services/electron`. DI example: `apps/stage-tamagotchi/src/main/index.ts`.
- Preserve the public `@proj-airi/stage-ui/stores` forwarding barrel. Shared component API edits also update `docs/assets/ai/context/ui-components.md` and stories.
- Put project/client ADRs in `docs/ai/adr/`, hosted backend ADRs in `server/docs/ai/adr/`. Follow [server ADR rules](server/AGENTS.md).
- Keep documentation with its code in the same commit/PR. Keep agent configuration changes in a separate commit/PR.
- Keep structured `README.md` files in each `packages/` and `apps/` entry: purpose, usage, when to use, and when not to use.
- Put translations in `packages/i18n`. Edit only English source and your own locale unless asked. The other locales are frozen copies of upstream's Crowdin exports; this fork does not sync them. Add only implemented locales. Do not insert English placeholders into other locales.
- When adding nested `AGENTS.md`, add adjacent `CLAUDE.md` containing only `@AGENTS.md`. Root Claude guidance otherwise blocks nested discovery.

### Dependencies
- Prefer `es-toolkit` for general utilities. Ask before adding another general utility library, including `unjs` or `tinylib` packages.
- For node builtins, DOM, Vue composables, React hooks, Vite plugins, and GitHub workflows, research existing libraries first.
- Before choosing a library, ask the user to choose and compare options. For spec-driven work, provide a Markdown comparison table.
- For requested tools/dependencies, read Context7 documentation first, then repository usage. Ask when returned names lack clear differences. If documentation conflicts with typecheck, inspect dependency source in `node_modules`.

## ANTI-PATTERNS (THIS PROJECT)
- Do not hide import/type errors in `tsconfig.json`. Reconsider ownership for circular imports. Ask if the cycle cannot be resolved confidently.
- Do not add backward-compatibility guards. For extended old caller/data support, document the target refactor. Start another Codex/Claude shell session for it.
- Temporary compatibility fallbacks require `// NOTICE:` and removal conditions. Document permanent fallbacks as supported policy, not legacy.
- Nested guidance can override the compatibility rule for public contracts only by naming the overridden root rule.
- Explicit contract exceptions exist in [API](server/apps/api/AGENTS.md), [CCv3](packages/ccc/AGENTS.md), and [MediaPipe](packages/model-driver-mediapipe/AGENTS.md).
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
- Name branches `username/<type>/short-name`, where `<type>` is a Conventional Commit type such as `feat` or `fix`. Rebase when pulling.
- This personal fork has no release-note, attachment-upload, or Crowdin maintenance workflow, and no GitHub Actions workflows. `pnpm verify` and the pre-commit hook are the only checks.
- Desktop releases are manual: `pnpm release <year>.<month>.<n>` on Linux and on macOS uploads installers to a draft GitHub release on the fork. See `scripts/dev-tools/README.md#pnpm-release`.

### Source control workflow
- Commit small, self-contained changes directly to `main` after `pnpm verify` passes.
- Put plan-sized or multi-commit work, such as a `.omo/plans` execution, on a branch. Open a pull request against `lschneiderny/airi`, never against upstream `moeru-ai/airi`. The fork allows only rebase merges, so keep each commit atomic and passing.
- Work in the main checkout by default. Create a worktree with `pnpm wt new <name>` only for parallel or long-running work, and remove it with `pnpm wt rm <name>`.
- `main` rejects force pushes and deletion. Never rewrite pushed history on `main`; if a push is rejected, run `git pull --rebase` and push again.
- Sync upstream only when asked: merge `upstream/main` into a `username/chore/upstream-sync` branch, resolve conflicts there, and run `pnpm verify`. Land it locally with `git switch main && git merge --ff-only <branch> && git push`, not through a GitHub pull request: the fork's rebase-only merge would re-create upstream commits under new hashes and break later syncs. Do not rebase the fork onto upstream.

## COMMANDS
Use workspace `package.json` names with pnpm filters, for example `@proj-airi/stage-tamagotchi`.
```bash
pnpm dev | dev:tamagotchi | dev:ui            # Web, Electron, UI development
pnpm dev:backend                              # Local backend stack (server/docker-compose.yaml)
pnpm -F <package-name> typecheck | build | exec vitest run
pnpm exec vitest run <path>; pnpm test:run
pnpm qa:doctor | qa:test | qa:motion | qa:report
pnpm qa:setup cubism | qa:llm serve            # Cubism Core download, scripted replay provider
pnpm qa:app run --dry-run ...                 # Rendered app session: seed, send chat, wait for events, summary
AIRI_DEV_QUIET=1 pnpm dev                     # Agent dev session: log file, ready URL, and errors only
pnpm typecheck; pnpm lint | lint:fix          # ESLint also formats
pnpm verify                                   # Incremental changed-file typecheck, lint, and related tests
pnpm verify --gate                            # Full branch check before landing
pnpm verify --stats                           # Summarize verify step history
pnpm wt ls; pnpm dev:top; pnpm slots status   # Worktrees, per-worktree CPU/memory, CPU slot budget
pnpm slots history                            # Summarize CPU lease history
pnpm qa:display run -- <command>              # Linux: run app windows in a headless KWin session, off the user's desktop
pnpm qa:smoke [--model <path>]                # Fresh-profile start; fails on any renderer or main-process error
pnpm qa:app run --model <path> --say <text>   # Replayed chat turn in the real app: ACT, expression, speech events
```
On Linux, start every agent command that opens app windows (T3 runs, agent-browser on Electron, Vishot) through `pnpm qa:display run --`, so the user's desktop, focus, and cursor stay undisturbed. Use `--name <name>` for parallel sessions and stop yours with `pnpm qa:display down --name <name>`.
The `airi-qa` MCP server in `.mcp.json` (`pnpm qa:mcp`) offers the same app session as tools: `airi_start`, `airi_send`, `airi_screenshot`, `airi_errors`, `airi_eval`, and `airi_stop`. Always call `airi_stop` when done, because the session holds a `live` CPU lease.

Testing tiers:
- Inner loop: run the narrowest relevant package tests.
- Commit loop: run `pnpm verify` after each change.
- Branch gate: run `pnpm verify --gate` before landing.

For live acceptance and the change-to-check policy, see [Testing and QA](docs/ai/testing.md).

After each task, run `pnpm verify` before finishing. It typechecks the changed packages and their dependents through Turbo, lints the changed files, and runs the tests related to them. It typechecks every package when a root config file changes. It skips a step that already passed on the same working tree.
Use `pnpm lint` or root `pnpm typecheck` only when a task needs the whole repository checked. Report only executed checks, their commands/results, changes, and follow-up work.
When `pnpm run` or `pnpm exec` fails because dependencies are out of date, run `pnpm install` once explicitly. The workspace sets `verifyDepsBeforeRun: error` so installs never start silently.
Create and remove worktrees with `pnpm wt new <name>` and `pnpm wt rm <name>`. Stop a worktree's processes with `pnpm dev:top kill <name> --yes`, never by PID alone.
Root `vitest.config.ts` also owns the `dev-tools`, `root-scripts`, `github-scripts`, `web-extension`, `telegram-bot`, and `twitter-services` projects: `pnpm exec vitest run --project <name> <path>`.
The `pnpm verify` typecheck covers Turbo workspace packages (`packages/*`, `apps/*`, `server/**`, `services/*`) only. Root scripts get lint and tests only. Engines use `pnpm typecheck:engines` and `pnpm build:engines`.
If Vitest finds no tests, inspect `vitest.config.ts` includes. Source-only packages can lack build scripts. Use their nested guidance.
Electron build runs `electron-vite build`, not typecheck. Its typecheck runs `vue-tsc --noEmit`. Stage UI uses `test:run` and has no compilation build.

Build, typecheck, and QA scripts take CPU slots ([cpu-slots](packages/cpu-slots/AGENTS.md)) from a shared budget through `pnpm slots run --class <class>`. If a command waits, run `pnpm slots status` to see who holds the budget and what is queued. `AIRI_CPU_SLOTS=off` is a supported opt-out only for one-off diagnosis of the broker itself; never use it for routine runs. If a command prints `cpu-slots: dist/vitest.mjs is stale`, run `pnpm -F @proj-airi/cpu-slots build`. Never bypass the stale-build guard.

## TASK ROUTING
Read the listed file before starting. Skill paths below are under `.agents/skills/`.
| Task | Read |
| --- | --- |
| UI appearance/interaction design, changes, review | [DESIGN.md](DESIGN.md) |
| Choosing which checks to run | [Testing and QA](docs/ai/testing.md) |
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
| Live2D, VRM, MMD import/rendering in web and desktop | [use-agent-browser-for-airi](.agents/skills/use-agent-browser-for-airi/SKILL.md) |
| Motion QA, emotion/idle gates, rendered motion runs | [motion-qa](.agents/skills/motion-qa/SKILL.md) |
| Checking a change in the running app: clean start, chat turn, screenshot, errors | [qa-tools README](packages/qa-tools/README.md#clean-start-smoke): `qa:smoke`, `qa:app`, and the `airi-qa` MCP server |
| Live QA on Linux: anything that opens app windows | [`pnpm qa:display`](scripts/dev-tools/README.md#pnpm-qadisplay) |

## NOTES
Nested guides own local exceptions and package-specific checks. Historical ADRs/audits and scanner observations are not current runtime acceptance.
The fork removed the Kirie Godot/CEF desktop host on 2026-10-31. `docs/ai/upstream-watch.md` records when to port it back.
The fork retired the Pocket native mobile host on 2026-11-04. The same watch list records its port-back condition; mobile browser layouts remain part of the web host.
Root `pnpm dev*` scripts run through `node scripts/dev.mjs`, which bypasses Windows `.cmd` shims and supports only `&&` chains of plain words.
Nested `AGENTS.md` and `CLAUDE.md` files are committed, so an agent on any machine gets the same guidance from a fresh clone. Do not add them to `.git/info/exclude`.
