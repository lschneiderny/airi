# AIRI

This is a personal fork of the `moeru-ai/airi` pnpm monorepo. It documents account-free clients. Internal hosted/auth adapters do not prove that hosted services or client routes are enabled.

## AGENTS.md POLICY
Agent guidance holds only what an agent cannot learn from the code, `package.json`, a README, or a doc that a task already routes to. In [Gloaguen et al., 2026](https://arxiv.org/abs/2602.11988), context files did not raise task success and raised inference cost by about 20%. Agents follow nearly every instruction, so each line costs steps. Repository overviews did not help them find files, and files that repeated existing docs added nothing. Short, hand-written files limited to non-standard practices did best.
- Write conventions, prohibitions, ownership boundaries, non-standard commands, flags, and environment variables, gotchas, and required reading before a specific task.
- An agent runs what a file names: a tool mentioned in guidance gets used. Name a command or tool only when agents should run it, and say when.
- Do not repeat a README, a skill, a policy doc, or a parent `AGENTS.md`. Link to one only as required reading before a specific task.
- Do not write overviews, directory trees, "where to look" tables, code maps, symbol or reference counts, line numbers, or generated headers. They go stale and the agent can read the code.
- Do not list commands that follow the standard `pnpm -F <package> typecheck | build | test | test:run` shape. List only commands with special flags, projects, or ordering.
- Edit guidance by hand. Do not regenerate it with init-deep, `/init`, or another generator. Add a rule after an agent gets something wrong, and remove rules that stop applying.
- Put a rule in the nested file closest to the code it governs. Put it here only when it applies across packages.
- Keep each nested `AGENTS.md` short. When one has no package-specific rules left, delete it and its `CLAUDE.md`.
- The fork owns every `AGENTS.md`, including those under paths kept from upstream. At a sync, keep the fork's version and add only the upstream rules that meet this policy.

## CONVENTIONS
- Change only Supported projects for fork work. Projects kept from upstream stay as upstream ships them; fix them only to keep the workspace building. See [Support scope](README.md#support-scope).
- The policy docs in `docs/ai/context/` are the current rules. When a change alters a rule they state, update the doc in the same commit. Client ADRs in `docs/ai/adr/` are history; do not edit their bodies.
- Keep changes in scope. Correct rule violations in touched functions/components/tests, not unrelated code. Refactor small changes step by step.
- Do not add one-off patterns. Before adding utilities, search internal implementations. If logic can become shared, propose that approach to the user. Put shared logic in `packages/`. Keep module boundaries clear.
- Use kebab-case filenames. Do not use `any`. Prefer generics. Use `as unknown as <Type>` only when safe type fixes fail.
- Omit TS/JS extensions from relative imports, dynamic imports, and re-exports. Retain extensions required by runtimes or asset formats.
- Use `@moeru/eventa` for all IPC, RPC, and cross-process events. Centralize contracts, for example in Electron `src/shared/eventa/`.
- Use `injeca` dependency injection only at external boundaries: databases, model runtimes, queues, caches, filesystems, networks, clocks, environments, feature gates. Do not add dependency objects for internal sibling calls or parameter forwarding.
- Prefer classes for runtime/browser APIs and substantial stateful business modules with lifecycle or domain ownership. Prefer functions for pure transformations/local helpers.
- Use Valibot schemas near consumers. Use `errorMessageFrom(error)` from `@moeru/std`, with `?? 'fallback'` when needed. Prefer other `@moeru/std` error patterns.
- Use `date-fns` for date and time code, with `@date-fns/utc` for UTC values and `@date-fns/tz` for named time zones, added through the pnpm catalog. Ask before researching or adding another date library. Render-loop clocks and `performance.now()` durations are not date code.
- Settings/devtools pages need `<route lang="yaml"> meta: layout: settings </route>`. Register routes and icons in both settings layouts: `packages/stage-layouts/src/layouts/settings.vue` and `apps/stage-tamagotchi/src/renderer/layouts/settings.vue`.
- Keep pure orchestration outside Vue/store integration.
- Reuse existing animations in `apps/stage-tamagotchi/src/renderer/styles` before adding new ones.
- Group UnoCSS classes only in the markup you change. Do not reformat a component's other classes; this overrides the `enforce-rules-for-unocss` skill.
- Before changing host capabilities, read the [host capability contract ADR](docs/ai/adr/2026-11-08-host-capability-contract.md).
- The Electron desktop stage host is gated by the off-by-default Experimental 3D stage setting. `AIRI_STAGE_HOST=window|desktop` overrides the setting in development builds only, for QA.
- The server channel (`packages/server-runtime`, `packages/server-sdk`, `packages/server-shared`) is separate from hosted `server/packages`.
- For 3D character motion work, track milestones in `docs/ai/context/3d-character-roadmap.md`.
- For character mind work (autonomy, body ownership, prompt, and state refactors), read the [character mind ADR](docs/ai/adr/2026-11-17-character-mind-direction.md) and track slices in `docs/ai/context/character-mind-roadmap.md`.
- Preserve the public `@proj-airi/stage-ui/stores` forwarding barrel. Shared component API edits also update `docs/ai/context/ui-components.md` and stories.
- Put project/client ADRs in `docs/ai/adr/`, hosted backend ADRs in `server/docs/ai/adr/`, and current reference and policy docs in `docs/ai/context/`. Follow [server ADR rules](server/AGENTS.md).
- Keep documentation with its code in the same commit/PR. Put agent configuration changes (`AGENTS.md`, `CLAUDE.md`, skills) in a commit of their own. When they describe the code of a PR, that commit belongs in the same PR.
- Keep structured `README.md` files in each `packages/` and `apps/` entry: purpose, usage, when to use, and when not to use.
- Put translations in `packages/i18n`. Edit only English source and your own locale unless asked. The other locales are frozen copies of upstream's Crowdin exports; this fork does not sync them. Add only implemented locales. Do not insert English placeholders into other locales.
- When adding nested `AGENTS.md`, add adjacent `CLAUDE.md` containing only `@AGENTS.md`. Root Claude guidance otherwise blocks nested discovery.

### Dependencies
- Prefer `es-toolkit` for general utilities. Ask before adding another general utility library, including `unjs` or `tinylib` packages.
- For node builtins, DOM, Vue composables, and Vite plugins, research existing libraries first.
- Before choosing a library, ask the user to choose and compare options. For spec-driven work, provide a Markdown comparison table.
- For requested tools/dependencies, read Context7 documentation first, then repository usage. Ask when returned names lack clear differences. If documentation conflicts with typecheck, inspect dependency source in `node_modules`.

## ANTI-PATTERNS (THIS PROJECT)
- Do not hide import/type errors in `tsconfig.json`. Reconsider ownership for circular imports. Ask if the cycle cannot be resolved confidently.
- Do not add backward-compatibility guards. For extended old caller/data support, document the target refactor and propose a separate session for it.
- Temporary compatibility fallbacks require `// NOTICE:` and removal conditions. Document permanent fallbacks as supported policy, not legacy.
- Nested guidance can override the compatibility rule for public contracts only by naming the overridden root rule.
- Explicit contract exceptions exist in [API](server/apps/api/AGENTS.md) and [CCv3](packages/ccc/AGENTS.md).
- Mark every workaround with this comment format:
```ts
// NOTICE:
// Why this workaround is needed.
// Root cause summary.
// Source/context (file, issue, URL, or node_modules reference).
// Removal condition (when it can be safely deleted).
```

## PRIVATE DATA
- Do not put private data in code, tests, fixtures, docs, comments, or commit messages. Private data describes a real person, device, or network: names, email addresses, usernames, host names, domains, IP addresses, local paths, device names, tokens, and recorded content. The fork's public repository name is not private.
- Do not copy values from the user's configuration, logs, traces, or command output into a commit. In examples and tests, use reserved values: `example.com`, `user@example.com`, `192.0.2.0/24`, `198.51.100.0/24`, and `/home/user`.
- Before committing, search the diff and the commit message for private data. If private data is already pushed, stop and tell the user. Do not rewrite pushed history without approval.

## UNIQUE STYLES
- Write clear, complete sentences. Use consistent terms and remove filler.
- Distinguish requirements, recommendations, and uncertainty. Preserve code, identifiers, commands, and quoted errors.
- Put conditions before commands. Use Conventional Commits without gitmoji, for example `feat(<package name>): add runner reconnect backoff`.
- Name branches `username/<type>/short-name`, where `<type>` is a Conventional Commit type such as `feat` or `fix`. Rebase when pulling.
- This personal fork has no release-note, attachment-upload, or Crowdin maintenance workflow, and no GitHub Actions workflows. `pnpm verify` and the pre-commit hook are the only checks.

### Source control workflow
- Commit small, self-contained changes directly to `main` after `pnpm verify` passes.
- Put plan-sized or multi-commit work, such as a `.omo/plans` execution, on a branch. Open a pull request against `lschneiderny/airi`, never against upstream `moeru-ai/airi`. The fork allows only rebase merges, so keep each commit atomic and passing.
- Move tracked files with `git mv` in a commit of its own with no content edits, so Git detects the rename and history survives upstream syncs.
- Work in the main checkout by default. Create a worktree with `pnpm wt new <name>` only for parallel or long-running work, and remove it with `pnpm wt rm <name>`.
- `/tmp` is RAM-backed. Never export, clone, or install the repository under `/tmp`. To build or test another revision, use `pnpm wt new <name>` and remove it with `pnpm wt rm <name>`; to read an old file, use `git show <rev>:<path>`.
- `main` rejects force pushes and deletion. Never rewrite pushed history on `main`; if a push is rejected, run `git pull --rebase` and push again.
- Sync upstream only when asked: merge `upstream/main` into a `username/chore/upstream-sync` branch, resolve conflicts there, and run `pnpm verify`. Land it locally with `git switch main && git merge --ff-only <branch> && git push`, not through a GitHub pull request: the fork's rebase-only merge would re-create upstream commits under new hashes and break later syncs. Do not rebase the fork onto upstream.

## COMMANDS
Use workspace `package.json` names with pnpm filters, for example `@proj-airi/stage-tamagotchi`. ESLint also formats: fix style with `pnpm lint:fix`, not another formatter.

Checks. [Testing and QA](docs/ai/context/testing.md) says what each check proves and which checks a change needs:
- Inner loop: the narrowest project of the package, `pnpm -F <package> exec vitest run --project <node or browser> <path>`, with `<path>` relative to the package.
- After each change: `pnpm verify`. It lints the changed files, typechecks the changed packages and their dependents, and runs the tests related to the changed code in each changed package and its dependents. To keep working while it runs, start `pnpm verify --detach`, then block once with `pnpm verify --wait` under a 10-minute tool timeout.
- Before landing a branch: `pnpm verify --gate`. It also runs the smoke and motion QA the changed paths need, and lists what remains.
- Platforms: only macOS and Linux KDE Wayland are checked. Windows, sway, and X11 are planned, not checked.

Use root `pnpm lint`, `pnpm typecheck`, or `pnpm test:run` (every package's whole test suite, cached by Turbo) only when a task needs the whole repository checked. Report only executed checks, their commands/results, changes, and follow-up work.
When `pnpm run` or `pnpm exec` fails because dependencies are out of date, run `pnpm install` once explicitly. The workspace sets `verifyDepsBeforeRun: error` so installs never start silently. The same check stops `pnpm qa:mcp` before it starts, and the client reports only `Connection closed` for the `airi-qa` server; run `pnpm install`, then ask the user to reconnect the server with `/mcp`.
Root `vitest.config.ts` owns only the `dev-tools` and `root-scripts` projects: `pnpm test:root`, or `pnpm exec vitest run --project <name> <path>`. Every other test belongs to a package and runs from it. If Vitest finds no tests, inspect the package config's includes.
When a package test reads a file outside its package, add that file to the package's `test:run` inputs in `turbo.json`. Tests gated on an environment variable never run under `pnpm test:run`; see [dev-tools README](scripts/dev-tools/README.md#environment-gated-tests).
The `pnpm verify` typecheck covers Turbo workspace packages (`packages/*`, `apps/*`, `server/**`, `services/*`) only. Root scripts get lint and tests only. Engines use `pnpm typecheck:engines` and `pnpm build:engines`.
The Electron build runs `electron-vite build`, not a typecheck; its typecheck runs `vue-tsc --noEmit`. Stage UI has no compilation build.

To run the app as an agent, use `AIRI_DEV_QUIET=1 pnpm dev`: it writes a log file and prints only the ready URL and errors. On Linux, start every agent command that opens app windows (rendered QA runs, agent-browser on Electron, Vishot) through `pnpm qa:display run --`, so the user's desktop, focus, and cursor stay undisturbed. Use `--name <name>` for parallel sessions and stop yours with `pnpm qa:display down --name <name>`. An `airi-qa` MCP session keeps its app running until `airi_stop`; call it when done.

Create and remove worktrees with `pnpm wt new <name>` and `pnpm wt rm <name>`. Stop a worktree's processes with `pnpm dev:top kill <name> --yes`, never by PID alone.

Run at most three heavy checks (a full verify, a whole package suite, a rendered QA run) at once; more is unmeasured on this machine.

## TASK ROUTING
Read the listed file before starting. Skill paths below are under `.agents/skills/`.
| Task | Read |
| --- | --- |
| UI appearance/interaction design, changes, review | [DESIGN.md](DESIGN.md) |
| Choosing checks that `pnpm verify` does not list after its summary: a visible change, test data read through `fs`, or a performance-sensitive change | [Testing and QA](docs/ai/context/testing.md) |
| TypeScript/Vue writing, refactoring, review, including date, time, and unit helpers | [enforce-rules-for-typescript](.agents/skills/enforce-rules-for-typescript/SKILL.md) |
| Tests, bug reproduction, mocks, test import boundaries | [enforce-rules-for-vitest](.agents/skills/enforce-rules-for-vitest/SKILL.md) |
| Adding, changing, or planning tests or verification for a Vue page, component, or UI flow | [enforce-rules-for-ui-tests](.agents/skills/enforce-rules-for-ui-tests/SKILL.md) |
| UnoCSS, Vue styles, components, animation, icons, color mode | [enforce-rules-for-unocss](.agents/skills/enforce-rules-for-unocss/SKILL.md) |
| Setting or changing a font, `font-family`, `@font-face`, or a font package | [enforce-rules-for-fonts](.agents/skills/enforce-rules-for-fonts/SKILL.md) |
| Building or reviewing a page, panel, list, or form; adding a border, a loading, empty, or error state, or a new component | [enforce-rules-for-ui-components](.agents/skills/enforce-rules-for-ui-components/SKILL.md) |
| Motion, reactions, animations, or springs that a Pixi, TresJS, or Three render loop samples | [enforce-rules-for-render-loops](.agents/skills/enforce-rules-for-render-loops/SKILL.md) |
| A visual that reacts to a microphone or to playback | [design-audio-visualizations](.agents/skills/design-audio-visualizations/SKILL.md) |
| Adding `synced` or changing synced Pinia stores | [enforce-rules-for-pinia-synced](.agents/skills/enforce-rules-for-pinia-synced/SKILL.md) |
| User-visible strings or glossary terms | [i18n guidance](packages/i18n/AGENTS.md) |
| Domain terms in code, docs, or prompts | [Glossary](docs/ai/context/glossary.md) |
| Body or motion ownership: which layer drives a bone, parameter, or expression | [Body ownership](docs/ai/context/body-ownership.md) |
| Anything the character does unasked | [Autonomous behavior](docs/ai/context/autonomous-behavior.md) |
| Prompt or other LLM-facing text | [LLM prompt](docs/ai/context/llm-prompt.md) |
| New persisted state or settings store | [State persistence](docs/ai/context/state-persistence.md) |
| An upstream sync, or a rule or behavior that differs from upstream | [Upstream policy ledger](docs/ai/context/upstream-policy.md) |
| Server work | [server](server/AGENTS.md), plus [API](server/apps/api/AGENTS.md) or [Auth](server/apps/auth/AGENTS.md) for those apps |
| Choosing, configuring, or testing a local character model or Ollama setting | [Local character models](docs/ai/context/local-models.md) |
| Slow/failed chat, speech, audio using saved IO traces | [analyze-io-traces](.agents/skills/analyze-io-traces/SKILL.md) |
| Local file upload via browser/Electron chooser or input | [Upload reference](.agents/skills/use-agent-browser-for-airi/references/input-file.md), [agent-browser](.agents/skills/agent-browser/SKILL.md). For Electron, also [agent-browser-electron](.agents/skills/agent-browser-electron/SKILL.md). |
| Screenshots and visual evidence | [use-vishot](.agents/skills/use-vishot/SKILL.md). Load only the matching runtime and scenario references. |
| Live2D, VRM, MMD import/rendering in the desktop app | [use-agent-browser-for-airi](.agents/skills/use-agent-browser-for-airi/SKILL.md) |
| Motion QA, emotion/idle checks, rendered motion runs, headless MMD body motion (`pnpm qa:motion3d`), headless Live2D rig (`pnpm qa:live2d-rig`) | [motion-qa](.agents/skills/motion-qa/SKILL.md); for `qa:motion3d`, also the [qa-tools README](packages/qa-tools/README.md) |
| Checking a change in the running app: clean start, chat turn, screenshot, errors | [qa-tools README](packages/qa-tools/README.md#clean-start-smoke): `qa:smoke`, `qa:app`, and the `airi-qa` MCP server |
| Live QA on Linux: anything that opens app windows | [`pnpm qa:display`](scripts/dev-tools/README.md#pnpm-qadisplay) |
| Performance history, heavy features, incidents, perf regressions between commits | [qa-tools README](packages/qa-tools/README.md#perf-reports) |

## NOTES
Historical ADRs, audits, and scanner observations are not current runtime acceptance.
Before porting back a retired project, read `docs/ai/context/upstream-watch.md`.
Root `pnpm dev*` scripts run through `node scripts/dev.mjs`, which bypasses Windows `.cmd` shims and supports only `&&` chains of plain words.
Nested `AGENTS.md` and `CLAUDE.md` files are committed, so an agent on any machine gets the same guidance from a fresh clone. Do not add them to `.git/info/exclude`.
