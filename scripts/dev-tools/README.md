# Developer tools

Root commands for working on this repository with many worktrees and parallel agents. They belong to no package.

| Command | What it does |
| --- | --- |
| `pnpm verify` | Lints changed files, typechecks changed packages and their dependents, and runs the tests related to the change in each changed package and its dependents. Each step checks only what changed since that step last passed on the current branch. |
| `pnpm wt ls \| new \| rm \| gc` | Lists, creates, removes, and garbage-collects worktrees. |
| `pnpm dev:top` | Shows dev process memory and CPU per worktree, flags orphans, and stops one worktree's processes. |
| `pnpm qa:display up \| down \| status \| env \| run \| shot` | Runs a headless, GPU-accelerated KWin session on Linux, so agents can run the Electron app and live QA without touching the user's desktop. |
| `pnpm qa:kwin-probe [--seconds N] [--cursor] [--bus <address>]` | Loads the AIRI KWin bridge into a QA session's KWin, prints its messages as JSON lines, then unloads it and confirms KWin no longer has the scripts. |
| `pnpm release <year>.<month>.<n> [--dry-run]` | Builds this machine's desktop installers for a fork release and uploads them to a draft GitHub release. See [`pnpm release`](#pnpm-release). |
| `pnpm qa:test:model` | Runs the test files gated on `AIRI_QA_*` variables, such as the MMD runner, Live2D rig, and mocap reference tests, with `.env.qa` loaded. `pnpm verify` skips these files and names this command. |
| `pnpm check:bundle` | Builds the Electron app and fails if the main window loads three, three-mmd, three-vrm, or Tres at startup, or if any renderer chunk contains the dev-only motion QA bridge. |
| `pnpm test:run` | Runs the `test:run` script of every workspace package through Turbo, one package at a time, each with its node and browser projects. Turbo first builds the packages a test depends on, and it skips a package whose inputs match a cached pass. A failed package does not stop the others. Extra arguments go to Turbo, for example `pnpm test:run --force` to ignore the cache. See [`pnpm test:run`](#pnpm-testrun). |
| `pnpm test:root` | Runs the root Vitest config, which holds only the tests that belong to no package: the `dev-tools` and `root-scripts` projects. |

## When to use

- Use `pnpm verify` before finishing a task, instead of root `pnpm lint` and `pnpm typecheck`.
- Use `pnpm wt` to create and remove worktrees, so installs use the shared store and removal survives Windows path limits.
- Use `pnpm dev:top` when the machine is slow, to see which worktree and tool is responsible.
- Use `pnpm qa:display run -- <command>` on Linux for any agent run that opens app windows, such as T3 runs, agent-browser sessions, and Vishot captures, while the user keeps working on the desktop.
- Use `pnpm check:bundle` after changing how the stage, settings, or hosts import a renderer package.

## When not to use

- Use root `pnpm typecheck`, `pnpm lint`, `pnpm test:run`, and `pnpm test:root` for a release or a whole-repository sweep. `pnpm verify` only covers what changed since the base.
- `pnpm verify` does not run QA gates or Electron builds.

## Environment-gated tests

Some tests run only when a variable is set, for example `it.runIf(process.env.AIRI_QA_MMD_MODEL)(...)` for tests that load a local MMD model. `pnpm verify` does not load `.env.qa`, so it skips them. When its test step skipped such files in a package the change affects (a changed package or one that depends on it), or a gated file that changed itself, it prints one `verify notice:` line after the summary. The notice names the files and the unset variables. It is not a failure.

`pnpm test:run` never runs them, even when the variable is set in your shell. Turbo starts each package's tests with only the variables that the `test:run` task in `turbo.json` lists, and no gate variable is listed, so a cached result never depends on a local model or a live service.

`pnpm qa:test:model` finds the gated files itself, so a new gated test needs no registration. It parses every test file that reads `process.env` (`gateVariables` in `lib/gated-tests.ts`) and counts these gates:

- the condition of `.runIf(...)`, and of `.skipIf(...)` unless it is a bare `process.env.X` (that test runs when X is unset);
- the condition of an `if` whose body declares a test or calls `expect`, such as `if (mocapDir) it(...)`;
- inside those conditions, constants declared in the file, such as `const skipReason = !rigRoot ? ... : undefined` or `const enabled = Boolean(process.env.X)`.

A variable read with a fallback (`process.env.X ?? defaultPath`) is optional and is not required. An `if` around output only, such as writing evidence when a directory is set, is no gate.

It keeps the files whose gates are all `AIRI_QA_*` variables, the only keys `.env.qa` can set, and loads `.env.qa` without overriding shell values. It runs the files whose variables are all set with Vitest in each file's own package, not through Turbo, so the variables reach the tests and no result is cached. Each run takes CPU slots like any test run. It prints one line naming the files it skipped and their unset variables. It exits 2 without running anything when no gated file has its variables set, or when a set variable names an absolute path that does not exist. `pnpm wt new <name> --qa` writes `AIRI_QA_MMD_MODEL` to `.env.qa` for a new worktree. Tests gated on other variables, such as the macOS foreground-window tests, still need their variables set by hand.

## Node compile cache

Node keeps a compile cache only when something enables it: `NODE_COMPILE_CACHE=<dir>`, or a parent process that calls `module.enableCompileCache()` without a directory and so writes under `os.tmpdir()/node-compile-cache`. Some agent harnesses do the latter and pass the directory on to every child through `NODE_COMPILE_CACHE`. On a tmpfs with a fixed inode table, those files filled every inode on 2026-11-12.

The launcher (`scripts/dev.mjs`), `pnpm verify`, `pnpm test:run`, and the install of `pnpm wt new` set `NODE_COMPILE_CACHE=<checkout>/node_modules/.cache/node-compile-cache` for the processes they start, but only when the variable is unset. The `test:run` task in `turbo.json` passes the variable through to each package's tests. A value you set, including an empty one, is kept. The directory belongs to the checkout, so `pnpm wt rm` deletes it with the worktree. `compileCacheEnv` in `lib/compile-cache.ts` makes this decision. To move an inherited `/tmp` cache, set `NODE_COMPILE_CACHE` in your own shell or agent environment. `pnpm qa:doctor` reports the temporary directory's inode and space use and flags a cache directory inside it.

## Quiet dev output

Use `AIRI_DEV_QUIET=1 pnpm dev` (or another `dev:*` command routed through `scripts/dev.mjs`) to keep full child output in `.temp/dev/<package>-<script>-<timestamp>.log`. Set `AIRI_DEV_LOG=<path>` to choose a file; relative paths start at the repository root. The console shows the log path, one `[dev] ready <url>` line, error-looking lines, and the exit status. Ctrl+C and SIGTERM still stop the child tree. Without quiet mode, output is unchanged.

## `pnpm verify`

```bash
pnpm verify                      # changes since each step's last passing tree
pnpm verify --gate               # full branch against the merge base with main
pnpm verify --only lint,test     # some steps
pnpm verify --base origin/main   # another base
pnpm verify --dry-run            # print the plan and commands
pnpm verify --stats              # summarize recorded step outcomes
pnpm verify --stats --since 2d --json
```

The steps, in the order they run:

- **lint** runs `moeru-lint` (oxlint, then ESLint with its cache) on the changed files. It runs first because it is the cheapest step. When it fails, typecheck and test are reported `skipped (not run: lint failed)` and verify exits 1. When ESLint's summary says every problem is fixable with `--fix`, verify prints `hint: every lint problem above is auto-fixable: run pnpm lint:fix, then verify again`. Verify never fixes files itself.
- **typecheck** runs `turbo run typecheck --filter=...{./<package-dir>}` for each changed package. Markdown (`.md`, `.mdx`) and `.txt` files do not count as changes for this step, so a documentation-only change skips it. Directory filters cover its dependents and accept scopes derived from Git trees. Turbo caches results in the main worktree's `.turbo/cache`, which all worktrees share. A change to a root file that every package reads (`tsconfig*.json`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, a root `.d.ts`) typechecks every package.
- **test** first rebuilds stale workspace packages with Turbo, because tests import built output such as the i18n locales.
- **test** then runs `vitest related` on the changed code files and test data files, in one Vitest process per place, one after the other. The first process uses the root config, which holds the projects that belong to no package. Then each changed package and each package that depends on one, according to `turbo ls --filter=...{<package>}`, runs in its own directory with its own config. A package in neither group cannot import the changed code, so it is skipped. Test data is JSON or YAML, such as fixtures, gate bands, and locales, except `package.json`, `tsconfig*.json`, and the workspace and lock files. `vitest related` runs the tests that import a changed file, but not tests that read it through `fs`.
- **test** derives each package command from that package's `test:run` script (`relatedTestCommand` in `verify-plan.ts`): `vitest run --project unit` becomes `vitest related --run --passWithNoTests --project unit <files>`, and a variable the script sets, such as `NODE_OPTIONS`, is kept. The script stays the one definition of how a package's tests start. A package without a `test:run` script is skipped.
- **test** adds `policy-docs.test.ts` when a doc in `docs/ai/context/` changes. The test reads the docs through `fs`: in each doc that says it describes the code, outside its Target sections, every cited repository path must exist and every cited camelCase, PascalCase, or SCREAMING_SNAKE name must occur in a tracked source file.
- **test** passes the changed files to each Vitest process in one command on Linux and macOS. On Windows the list is split to stay under the CreateProcess command-line limit, and each process then runs once per part.

The test step runs related tests per package, not each package's whole `test:run` suite through Turbo. Measured on 2026-11-18, on a 16-core workstation:

- Most packages the fork works on are dependencies of `stage-ui`, and a whole-suite step would run every dependent of a changed package. A change under `stage-ui` would run the suites of `stage-ui` (176 s alone), `stage-pages` (61 s), `stage-tamagotchi` (109 s), and `qa-tools` (112 s): about 8 minutes one after the other, or about 4 minutes with three packages at once. The related-test step had a median of 134 s.
- The whole suites are still one command away. `pnpm test:run` runs them through Turbo's cache, and it also runs the tests that read a file through `fs`, which `vitest related` cannot see. Run it before landing a change to shared fixtures or test data.

Each package's tests run in their own Vitest process. Do not gather the browser projects of several packages into one process: `@vitejs/plugin-vue` 6.0.8 keeps one descriptor cache per Node process, keyed by absolute file name, while it derives a component's scoped id from its path relative to each Vite server's root. With two roots in one process, one server can serve a component's scoped style under the other root's id, and the component renders unstyled for that whole run.

Each step acquires one CPU lease before its first command and releases it after its last command, including on failure. A failed command stops the remaining commands in that step. `--dry-run` prints one lease request per runnable step.

Each step prints its scope. Plain verify uses that step's last passing tree on the current branch, including committed, staged, unstaged, and untracked changes since that tree. A commit without verification does not advance the baseline. Comparing working-tree snapshots also avoids repeatedly checking unchanged untracked files.

The per-branch record lives at `<git common dir>/airi-verify/last/<encoded-branch>.json`, with slashes percent-encoded. It holds the merge base and a `{ tree, head, recordedAt }` entry per step. A missing or malformed record, missing step entry, changed merge base, or pruned tree falls back to the full branch scope and prints why. Detached HEAD always uses branch scope and never reads or writes a last-pass record. `--base` selects the ref used to compute the merge base.

After a pass, only that step's entry advances. Skipped and failed steps leave their entries unchanged. A pass against a different merge base starts a new record so old entries cannot narrow the other steps. Dry runs never write records. Files must remain unchanged during the step before the last-pass record is written.

Use `pnpm verify --gate` before landing to check the full branch regardless of previous passes. After the summary, every run lists the checks the branch still needs that verify does not run, under `also needed, not run by verify`. The list comes from the changed non-test paths since the merge base (`followUpChecks` in `verify-plan.ts`): app runtime paths need `qa:smoke` before landing, Natural and Live2D motion packages need `qa:live2d-rig` and a Live2D session, MMD body packages need `qa:test:model` and `qa:motion3d` runs, and `qa:motion3d` report rules need labelled inject cases.

An empty scope reports `skipped`.

Step history is separate from the last-pass record. Each completed step appends a record to `<git common dir>/airi-verify/runs.jsonl`, including failures and skips. Records contain `ts` (epoch milliseconds), `worktree`, `branch` (null for detached HEAD), `head`, `tree`, `scopeBase`, `mode`, `step`, `status` (`pass`, `fail`, or `skipped`; records written before 2026-11-17 can also say `cached`), `durationMs`, `commands` (argument arrays), `files`, `waitMs`, and `grant`. Executed commands include the granted concurrency. Steps without a lease record zero wait and a null grant. Duration includes waiting for the lease. Dry runs do not append history.

`pnpm verify --stats` reads history without running checks or changing last-pass records. It reports counts by status for each step and scope mode, failure rate, median and p90 duration, and the slowest five executed steps with their worktree and branch. Failure rates and duration distributions use executed passes and failures; cached and skipped steps contribute only to counts. `--since` accepts a positive integer followed by `ms`, `s`, `m`, `h`, or `d`. `--json` prints the summary as JSON. Malformed lines are skipped and counted, including malformed lines outside the requested time window.

Before an append, a history file larger than 5 MiB rotates to `runs.1.jsonl`, replacing the previous generation. Statistics read both generations. History write failures print a warning without changing check results. Set `AIRI_VERIFY_HISTORY_DIR` to use another history directory, such as a temporary directory for QA; this setting does not redirect last-pass records.

Exit codes: 0 every step passed, 1 a step failed, 2 usage error.

## `pnpm test:run`

```bash
pnpm test:run                                  # every package, cached
pnpm test:run --force                          # every package, ignoring the cache
pnpm test:run --filter=@proj-airi/stage-ui     # one package
pnpm -F @proj-airi/stage-ui test:run           # the same suite without Turbo: no cache, no dependency build
pnpm test:root                                 # the tests that belong to no package
```

Every workspace package with tests has a `test:run` script and its own `vitest.config.ts`, in upstream's shape. The root `vitest.config.ts` holds only the `dev-tools` and `root-scripts` projects. `testsWithoutRunner` in `test-run-plan.ts` and its test fail when a tracked test file sits in a package without a `test:run` script, or outside every package and outside `scripts/`. `testRunExclusions` lists the packages whose tests are deliberately not run, with the reason.

The command holds one `test` CPU lease. Turbo runs one package at a time (`--concurrency=1`), and `turbo.json` passes the `AIRI_CPU_*` variables through, so each package's Vitest process inherits the lease and may use the whole grant. Measured on 2026-11-18, the full suite without the cache took 11 minutes this way and 6 minutes with three packages at once. Running packages side by side needs a worker share per process, and overlapping browser suites are unproven, so it is not the default.

The `test:run` task in `turbo.json` decides what the cache reuses:

- It depends on the build of each dependency (`^build`) and on the cpu-slots build, which every Vitest config loads. A change to a dependency therefore reruns the tests of its dependents.
- Its inputs are the package's files, its `.env*` files, and the root files that package tests or configs load: root `.env*` except `.env.qa`, the root `tsconfig.json`, `uno.config.ts`, `vitest.dom-storage.ts`, and `vitest-isolate-host-session.ts`.
- A package whose tests read files of another package, or of the repository, has its own `<package>#test:run` task that adds those files as inputs: stage-ui reads stage-pages sources and qa-tools prompt fixtures, i18n reads the root `README.md` and `docs/`, and cpu-slots reads every Vitest config. When a test reads a file outside its package without a workspace dependency on the owner, add such a task.
- Turbo runs tasks in strict environment mode. `CI`, `NODE_OPTIONS`, and `TESTING_AUDIO_*` reach the tests and are part of the cache key. `AIRI_CPU_*` and `NODE_COMPILE_CACHE` reach the tests and are not. No other variable of your shell reaches a package test, so tests gated on a variable are skipped. See [Environment-gated tests](#environment-gated-tests).
- stage-ui also receives `XDG_CURRENT_DESKTOP`, as part of its cache key. Chromium chooses its font rendering from the desktop session, and the visual baselines were captured in a KDE session: without the variable, three of them differ in their text pixels. A run outside a KDE session fails those baselines, as it does without Turbo.

Turbo skips the tasks that depend on a failed build and runs the rest (`--continue=dependencies-successful`). It prints the output of the packages that ran and one line for each cache hit (`--output-logs=new-only`). Turbo's cache lives in the main worktree and is shared by every worktree.

## `pnpm check:bundle`

```bash
pnpm check:bundle                        # build the Electron app, then check it
pnpm exec tsx scripts/dev-tools/bundle-check.ts   # check the existing build in apps/stage-tamagotchi/out
```

The check starts from the module script in `out/renderer/index.html` and follows static `import` and `export ... from` statements through the emitted chunks. It skips dynamic `import()`, which loads only when a 3D model is selected. No chunk it reaches may contain three, which it recognizes by the `__THREE__` property that three sets when it loads. three-mmd, three-vrm, and Tres all import three, so the same marker covers them. The build writes no sourcemaps, so the check cannot name modules directly. It prints how many chunks and megabytes the main window loads at startup. The [lazy 3D renderers ADR](../../docs/ai/adr/2026-11-04-lazy-3d-renderers.md) records why. The `airi/lazy-3d-renderers` ESLint rule catches the same mistake earlier, in the editor and in `pnpm verify`.

It also scans every `.js` file under `out/renderer` for the dev-only motion QA bridge: the `__airiMotionQa` global, `motion-qa:` Eventa contract ids, and `installMotionQaDispatcher`. Any match fails the check and prints the file, offset, and surrounding text. This is the only check that keeps the bridge out of production bundles.

The check is a separate command because it needs an Electron build. `pnpm release` runs it after its app build.

## `pnpm release`

`pnpm release 2026.11.0` packages the Electron app for the machine it runs on and uploads the installers to a draft release on the fork's GitHub repository (`releaseRepository` in `apps/stage-tamagotchi/src/shared/release-repository.ts`). Run it once on Linux (deb and rpm) and once on macOS (dmg and zip). Windows releases are deferred.

Versions are calendar versions, `<year>.<month>.<n>`, tagged `v<version>`. They never collide with upstream's `0.x` tags, and a fork build always compares as newer than upstream. The version is injected at package time through `extraMetadata.version`, so a release needs no version-bump commit. GitHub creates the tag on the release commit when you publish the draft.

Before it builds, the command refuses to continue unless:

- you are on `main`, with no tracked changes, and `HEAD` matches `origin/main`;
- `GODOT4` names the Godot .NET editor (the `mono` build, at the version `global.json` pins as `Godot.NET.Sdk`), and its .NET export templates are installed under `~/.local/share/godot/export_templates/<version>.stable.mono/`;
- `dotnet` resolves an SDK that `engines/stage-tamagotchi-godot/global.json` accepts, since the Godot .NET editor does not bundle one (Fedora: `sudo dnf install dotnet-sdk-10.0`);
- `gh` is signed in;
- no published release has this tag, and an existing draft targets the same commit as `HEAD`.

It then checks the whole repository, not only a diff: `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, `pnpm test:root`, and a clean-start smoke (through `pnpm qa:display run --` on Linux). `pnpm verify --gate` would check nothing here, because a release builds `main` and the gate compares against `main`. Then it runs the Godot export into `engines/stage-tamagotchi-godot/out/<linux|mac>`, the app build, the [bundle check](#pnpm-checkbundle) on that build, and electron-builder with `AIRI_REQUIRE_GODOT_STAGE=true` under a `build` CPU slot. Any failed step stops the release before upload. The first platform creates the draft; the second adds its files to it. `--dry-run` stops after the preflight checks above and runs nothing else.

The smoke starts the development build, not the installer. Before you publish the draft, install each installer on a real display and start it:

- Linux: `sudo dnf install ./AIRI-<version>-linux-x86_64.rpm` or `sudo apt install ./AIRI-<version>-linux-amd64.deb`.
- macOS: the build is ad-hoc signed and not notarized, so run `xattr -dr com.apple.quarantine /Applications/AIRI.app` after copying it from the dmg.

Then publish with `gh release edit v<version> --repo lschneiderny/airi --draft=false`. Installed Linux builds see the release through the updater. macOS builds cannot install unsigned updates, so their About page points to GitHub Releases instead.

On Linux, the packaging step sets `TMPDIR` to `node_modules/.cache/release-tmp` in the checkout and empties it before and after. The rpm step stages the unpacked app twice there, about 4 GB, which a RAM-backed `/tmp` with a user quota cannot always hold: on 2026-11-15 it failed with `Disk quota exceeded - copy_file_range` after an interrupted run left its copies in `/tmp`.

On Fedora, electron-builder's bundled `fpm` needs `libcrypt.so.1` to build the deb. Install `libxcrypt-compat` once if the deb step fails with `ruby: error while loading shared libraries: libcrypt.so.1`.

## `pnpm wt`

```bash
pnpm wt ls                                  # name, branch, idle time, uncommitted files, merged into main, live processes
pnpm wt new my-feature                      # <repo>-wt/my-feature on <prefix>/feat/my-feature, then pnpm install
pnpm wt new my-feature --base main --branch luke/fix/x --no-install
pnpm wt new my-feature --qa                 # also .env.qa, pnpm qa:setup cubism, install check, one ready line
pnpm wt rm my-feature [--force] [--delete-branch]
pnpm wt gc [--days 14]                      # dry run
pnpm wt gc --yes
```

- The branch prefix comes from `git config airi.branchPrefix`, or else the OS user name.
- The live process count leaves out the caller: the shell and `pnpm` that run `pnpm wt rm <path>` name that worktree on their command line, so they and the pipeline they started do not count as work running in it. A process whose own command line names the worktree still counts.
- `new` refuses a worktree path inside the system temporary directory (`os.tmpdir()`). One install there takes about 144,000 inodes, and a tmpfs has a fixed inode table that every job on the machine shares.
- `new --qa` prepares a worktree for model-gated QA. It takes `AIRI_QA_MMD_MODEL` from the environment, or else from the `.env.qa` of the checkout you run it in, and refuses before creating anything when neither sets it or the file does not exist. After the install it writes `AIRI_QA_MMD_MODEL` to the new worktree's `.env.qa`, runs `pnpm qa:setup cubism` there, checks `node_modules/.modules.yaml`, and prints one `wt: ready ...` line. `--qa` cannot be combined with `--no-install`.
- `rm` refuses while any process still runs from the worktree. It also refuses for uncommitted files (`--force` overrides only this) and for a detached HEAD holding commits main does not contain. If `git worktree remove` fails on long `node_modules` paths, it deletes the directory with extended-length paths and prunes.
- A worktree counts as merged when `git cherry main HEAD` prints no `+` line, so main holds each of its commits by hash or as a patch-equivalent copy. Rebase merges, the fork's only pull request merge, give every commit a new hash, so an ancestor check would never see a landed branch. `rm --delete-branch` deletes a merged branch with `git branch -D`, because `-d` refuses rebased copies, and keeps any other branch.
- `gc` removes a worktree when it is merged into main, its directory is gone, or it is clean and has had no commit for `--days`. Removal deletes only the directory. Branches keep their commits.

## `pnpm dev:top`

```bash
pnpm dev:top                       # rollup per worktree and tool
pnpm dev:top --processes           # every attributed process
pnpm dev:top --json
pnpm dev:top kill <worktree>       # dry run
pnpm dev:top kill <worktree> --yes
pnpm dev:top kill <worktree> --orphans --yes
```

A process belongs to the worktree whose path appears in its command line, or else to its nearest ancestor's worktree. An orphan is a Node.js, Electron, or Godot process whose parent has exited. macOS and Linux reparent an orphan to PID 1, so a parent of PID 1 counts as exited there. A subreaper such as `systemd --user` adopts orphans under its own PID, and those are not flagged. `kill` stops each process tree once, from its top-most member. Windows stops the tree with `taskkill /T`. macOS and Linux have no tree kill, so `kill` signals the top member and every descendant in the snapshot, parents first. Right before each kill it re-reads the live command line, because Windows reuses PIDs. It never stops the tree it runs in.

## `pnpm qa:display`

```bash
pnpm qa:display up                          # headless 1920x1080 session named "qa"
pnpm qa:display up --name agent-2 --size 2560x1440
pnpm qa:display up --name two --outputs 2   # two outputs side by side, each of --size, for multi-display QA (kwin only)
pnpm qa:display up --windowed               # show the session as a window on your desktop
pnpm qa:display up --name ptt --portals     # KWin plus the desktop portal and KDE global shortcuts
pnpm qa:display up --name x --compositor x11    # Xvfb with openbox
pnpm qa:display up --name s --compositor sway   # headless sway
pnpm qa:display up --name a --private-audio     # own PipeWire stack, null sink airi_qa as default
pnpm qa:display pointer 300 200             # move the session pointer
pnpm qa:display run -- pnpm qa:motion ...   # start the session if needed, then run inside it
eval "$(pnpm --silent qa:display env)"      # point the current shell at the session
pnpm qa:display shot .temp/qa/desktop.png   # capture the whole session display
pnpm qa:display status
pnpm qa:display down
```

A session is a `kwin_wayland --virtual` compositor with rootless Xwayland and a private D-Bus session bus. It runs as the transient systemd user unit `airi-qa-display-<name>.service`, so it survives the agent that started it, and `down` stops the compositor, its services, and the bus together. Clients render on the host GPU: Electron reports GPU compositing, WebGL, and WebGPU on the NVIDIA card through ANGLE. Their windows, focus changes, and pointer input stay inside the session. The private bus has no notification server, StatusNotifier host, portal, or global-shortcut service, so notifications, tray icons, and shortcuts from the app never reach the desktop. The exception is `--portals`, described below.

Every session also has a private runtime directory: `XDG_RUNTIME_DIR=<session dir>/runtime` (mode 0700), `XDG_DATA_HOME=<session dir>/data`, and `XDG_CONFIG_HOME=<session dir>/config`, where the session dir is `$XDG_RUNTIME_DIR/airi-qa-display/<name>`. The unit drops the host `WAYLAND_DISPLAY`, `DISPLAY`, `XAUTHORITY`, and the other desktop keys that the systemd user manager passes on. It sets the three directories before `dbus-daemon` starts, so D-Bus-activated helpers inherit them. Once the compositor is ready, the unit hands that compositor's display sockets to the private bus through `UpdateActivationEnvironment`. As a result, helpers such as `xdg-document-portal` and `gvfsd-fuse`, which the private bus activates, put their FUSE mounts under `<session dir>/runtime/doc` and `runtime/gvfs`, never at the user's `/run/user/<uid>/doc` or `/run/user/<uid>/gvfs`. KWin and every service read and write their configuration under the session dir, not in your home. The compositor's Wayland socket and sway's IPC socket live in the private runtime directory too. `down` lazily unmounts anything still mounted under the session dir, then removes it.

Every session also has a private system bus, so the app never reads the host system bus: no logind session or lock state, UPower, or NetworkManager of yours. `up` writes `<session dir>/system-bus.conf`, a minimal `<busconfig>` with `<type>system</type>`, one listen socket at `<session dir>/runtime/system_bus_socket`, no service directories (nothing activates on it), and an allow-all policy, which is safe because only the session's own clients can reach the socket. The unit starts this `dbus-daemon --config-file=<session dir>/system-bus.conf --fork --print-pid` before the session bus, records its pid in `<session dir>/system-bus.pid`, and exports `DBUS_SYSTEM_BUS_ADDRESS=unix:path=<session dir>/runtime/system_bus_socket` before it starts the session `dbus-daemon`. The session bus therefore inherits the private address and hands it to every service it activates, such as `xdg-desktop-portal` and its backends; the unit also sets it in the session bus activation environment through `UpdateActivationEnvironment`. No root is needed. Inside a session, `busctl --system list` shows only `org.freedesktop.DBus` and the session's own processes (KWin, plasma-keyboard, the portals, the app), so the app finds no `org.freedesktop.login1` and reports lock state through the session's ScreenSaver or `null`; lock QA owns a fake logind or ScreenSaver on the private buses. `up` on a running session, `run`, and `status` fail with a restart hint when that daemon has exited or is a zombie (read from `/proc/<pid>/stat`, as for `--private-audio`). An env file without the private `DBUS_SYSTEM_BUS_ADDRESS`, as a session started by an older `qa:display` writes it, counts as not running. `down` stops it with the unit's cgroup and sends `SIGTERM` to it if it ever outlives the stop.

A session stays off your PipeWire graph. The unit also drops `PULSE_SERVER`, `PIPEWIRE_REMOTE`, and `PIPEWIRE_RUNTIME_DIR`, and `run` and `env` delete them from the client environment, so audio clients look only in the private runtime directory. What they find there depends on the audio mode:

| Audio flag | Private runtime directory holds | Use |
| --- | --- | --- |
| none (default) | no audio socket; KWin, the portals, and apps have no audio server | every agent run that needs no sound |
| `--private-audio` | the session's own `pipewire`, `wireplumber`, and `pipewire-pulse`, with the null sink `airi_qa` as default | agent runs that play, capture, or screen-share audio |
| `--host-audio` | your `pipewire-0`, `pipewire-0-manager`, and `pulse/native`, linked one by one | a person who wants to hear the session; agents never use it |

`--private-audio` starts the stack after the private bus and before the compositor, so KWin, the portals, and every client connect to it. The three processes use `<session dir>/state` as `XDG_STATE_HOME`, log to `<session dir>/<binary>.log`, and record their pids in `<session dir>/audio.pids`. `up` writes `config/wireplumber/wireplumber.conf.d/90-airi-qa-no-devices.conf`, which disables WirePlumber's ALSA, MIDI, Bluetooth, V4L2, and libcamera monitors, so the stack opens no hardware device and its only sink is the null sink. The unit then loads `module-null-sink sink_name=airi_qa` and makes it the default sink. Every `pactl` call is pinned to the private pulse socket through `PULSE_SERVER` and runs under `timeout 3`, so it can neither reach another server nor hang. Each step waits a bounded time: 5 seconds for the PipeWire socket, 5 seconds for pipewire-pulse to answer `pactl info`, and 10 seconds for WirePlumber to report `airi_qa` as the default sink. A step that gives up fails `up` with its reason and stops the session; `up` allows the stack 20 seconds beyond the usual startup time. The processes belong to the unit's cgroup, so `down` stops them with the session. `up` or `run` on a running `--private-audio` session whose stack process exited fails and names the `down` and `up` commands that restart it. Inside the session, `pactl info` reports `Default Sink: airi_qa`, and `pw-play --target airi_qa` plays without reaching your speakers.

`--compositor` picks the session type. A running session keeps its type. `up` fails until you run `down` when it asks for a different `--compositor`, for `--portals` on a session without portals, or for an audio flag that differs from the running session's mode.

| Compositor | Starts | Sets | Deletes |
| --- | --- | --- | --- |
| `kwin` (default) | `kwin_wayland --virtual --xwayland` | `XDG_CURRENT_DESKTOP=KDE`, `XDG_SESSION_TYPE=wayland`, `WAYLAND_DISPLAY`, `DISPLAY`, `DBUS_SESSION_BUS_ADDRESS`, `DBUS_SYSTEM_BUS_ADDRESS` | `SWAYSOCK`, `HYPRLAND_INSTANCE_SIGNATURE`, `XAUTHORITY`, and the three audio overrides |
| `x11` | `Xvfb :<n> -screen 0 <W>x<H>x24` (first free display from `:90`) and `openbox` | `XDG_CURRENT_DESKTOP=Openbox`, `XDG_SESSION_TYPE=x11`, `DISPLAY`, `DBUS_SESSION_BUS_ADDRESS`, `DBUS_SYSTEM_BUS_ADDRESS` | `WAYLAND_DISPLAY`, `SWAYSOCK`, `HYPRLAND_INSTANCE_SIGNATURE`, `KDE_FULL_SESSION`, `KDE_SESSION_VERSION`, `XAUTHORITY`, and the three audio overrides |
| `sway` | `WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 sway -c <session dir>/sway.conf`, where the config sets only the output size | `XDG_CURRENT_DESKTOP=sway`, `XDG_SESSION_TYPE=wayland`, `WAYLAND_DISPLAY`, `SWAYSOCK`, `DBUS_SESSION_BUS_ADDRESS`, `DBUS_SYSTEM_BUS_ADDRESS`, and `DISPLAY` when sway started Xwayland | `HYPRLAND_INSTANCE_SIGNATURE`, `KDE_FULL_SESSION`, `KDE_SESSION_VERSION`, `XAUTHORITY`, the three audio overrides, and `DISPLAY` without Xwayland |

`run` and `env` apply both columns. They also set the session's private `XDG_RUNTIME_DIR`, `AIRI_QA_HOST_RUNTIME_DIR` (your own runtime directory, so `pnpm qa:display` still finds your systemd user manager from inside a session), and `AIRI_QA_DISPLAY=<name>` with the same name in `AIRI_QA_DISPLAY_SESSION=<name>`, the marker the host session guard reads. Clients keep your `XDG_DATA_HOME` and `XDG_CONFIG_HOME`. A client whose desktop file the session's portal must see installs it in `<session dir>/data/applications`. `run` starts the command through `systemd-run --user --scope` in the unit `airi-qa-display-<name>.run-<pid>.scope`, so the command and anything it leaves behind stay in a cgroup of the session; qa-tools reads only those cgroups when it lists processes. `down` first stops every `airi-qa-display-<name>.run-*.scope`, also when the session unit has already stopped, so such a leftover does not outlive the session. `run` exits with the command's exit code. `up` fails with `qa-display: <binary> not installed (run: sudo dnf install <package>)` when a binary the session needs is missing; `--private-audio` also needs `pipewire`, `wireplumber`, `pipewire-pulse` (`pipewire-pulseaudio`), `pactl` (`pulseaudio-utils`), and `timeout`. `--windowed` works with `kwin` only. `--outputs <n>` (1 to 4, `kwin` only) passes `--output-count` to KWin, which lays that many outputs of `--size` out side by side; the session records the count as `AIRI_QA_OUTPUTS`, and `up` on a running session with another count fails with a restart hint.

`--portals` (kwin only) runs KWin without `--no-global-shortcuts`, so KWin hosts KDE's global accelerator (`org.kde.kglobalaccel`) in-process through `libKGlobalAccelD`. After KWin is ready, it starts `/usr/libexec/xdg-desktop-portal` and `/usr/libexec/xdg-desktop-portal-kde` on the private bus. When `rpm -ql kglobalacceld kf6-kglobalaccel` lists a standalone `kglobalacceld` executable, that daemon is started there too. `up` seeds `config/kglobalshortcutsrc` with an `[ai.moeru.airi.dev]` group, the app id of a development build, that holds the QA push-to-talk trigger (`voice-push-to-talk=Ctrl+Shift+Space`). `up` returns only after the `GlobalShortcuts` portal and `org.kde.kglobalaccel` answer on the private bus. If they do not answer within 15 seconds, it stops the session and fails with the reason. The private bus D-Bus-activates the portal's helpers (`xdg-document-portal`, `xdg-permission-store`, `gvfsd`) from the system service directories inside the private runtime directory, and `down` stops them with the unit. The screen locker stays off (`--no-lockscreen`); lock QA owns `org.freedesktop.ScreenSaver` on the private bus instead. Clients that `run` started are not part of the unit. They lose their display and exit when the session stops. Stop leftovers with `pnpm dev:top kill <worktree>`.

Real-pointer T3 runs such as `builtin:t3-touch` work inside the session: the QA tools inject pointer input through the session KWin's EIS interface, which the private bus exposes without an authorization prompt. They detect the session through `AIRI_QA_DISPLAY` and refuse to drive the cursor without it. See [Pointer platform preflight](../../packages/qa-tools/README.md#pointer-platform-preflight).

Agent QA commands that open app windows or read desktop sensors (`pnpm qa:smoke`, `pnpm qa:app run`, `pnpm qa:host smoke`, and `pnpm qa:kwin-probe` without `--bus`) refuse to start on Linux outside a live session. They call `requireQaDisplaySession(command, argv)` or `assertQaDisplaySession(command, allowHostSession)` from `qa-display-guard.ts`, which exits 2 with a message naming `pnpm qa:display run --` unless `AIRI_QA_DISPLAY_SESSION` names a session whose unit is active, whose private system bus still runs, and whose env file matches the client environment, `DBUS_SYSTEM_BUS_ADDRESS` included. The pure decision is `qaDisplayGuard` in `qa-display-plan.ts`. `--allow-host-session` is the explicit escape hatch for a person testing on their own desktop; agents never pass it. See [Linux host session guard](../../packages/qa-tools/README.md#linux-host-session-guard).

The `dev-tools` Vitest project and the `stage-tamagotchi` node project load `vitest-isolate-host-session.ts` before every test file. It removes `DISPLAY`, `WAYLAND_DISPLAY`, `SWAYSOCK`, `HYPRLAND_INSTANCE_SIGNATURE`, and `XAUTHORITY`, points `DBUS_SESSION_BUS_ADDRESS` and `DBUS_SYSTEM_BUS_ADDRESS` at a socket that does not exist, and sets `XDG_RUNTIME_DIR` to a fresh temporary directory. A test that needs a bus or display starts a private one and passes its address explicitly; an accidental default connection fails instead of reaching your desktop.

`shot` captures through Spectacle, which asks the session's KWin for the image, so it needs a `kwin` session. In `x11` and `sway` sessions it exits 2 with `qa-display: shot needs a kwin session; use a CDP screenshot`; capture there through CDP `Page.captureScreenshot`. App screenshots that T3 runs and Vishot take through CDP do not need it.

`pointer <x> <y>` moves the session pointer to an absolute position: through KWin's EIS with the qa-tools helper `packages/qa-tools/scripts/linux/kwin-pointer.py` on `kwin` (it prints the position read back from KWin), with `xdotool mousemove` on `x11`, and with `swaymsg seat - cursor set` on `sway`.

Startup failures name the unit. Read its log with `journalctl --user -u airi-qa-display-<name>.service`.

The session isolates the display, not the process environment. An app inside it still shares the user's files, network ports, and default profile. T3 runs already set their own profile through `APP_USER_DATA_PATH`. For other runs, set `APP_USER_DATA_PATH` to a scratch directory so the agent's app does not take the desktop instance's single-instance lock.

## `pnpm qa:kwin-probe`

```sh
pnpm qa:display run --name kp -- pnpm qa:kwin-probe --seconds 15
pnpm qa:display run --name kp -- pnpm qa:kwin-probe --cursor   # also stream the pointer position
pnpm qa:kwin-probe --bus "unix:path=$XDG_RUNTIME_DIR/airi-qa-display/kp/bus"   # an explicitly chosen bus
```

The probe refuses to run on an inherited desktop bus, because the bridge reads the active window as soon as it loads. Before loading anything, it needs an explicit `--bus <address>` or the shared host session guard (`assertQaDisplaySession` in `qa-display-guard.ts`): `AIRI_QA_DISPLAY_SESSION` must name a running qa:display session whose recorded bus, display, and runtime variables equal the inherited ones. Otherwise it exits 2 and names `pnpm qa:display run --`. `--allow-host-session` is the guard's escape hatch for a person; agents never pass it.

The probe runs the Linux desktop KWin backend (`apps/stage-tamagotchi/src/main/services/linux-desktop/backends/kwin/`) outside Electron. It connects to the selected bus, loads `airi-desktop-bridge-<pid>` (and `airi-desktop-cursor-<pid>` with `--cursor`), and prints one JSON line per `Hello`, `Active`, `OwnWindows`, and `Cursor` message for `--seconds` (default 10, from 1 to 3600). `Active` lines replace the window caption with `captionLength`. Afterwards it unloads the scripts, asks KWin `isScriptLoaded` for both names, and prints `scripts-unloaded: true`. It exits 1 with `scripts-unloaded: false` when a script is still loaded, and with `scripts-unloaded: unverified` when KWin has no owner or does not answer. Ctrl+C or SIGTERM ends the run early with the same cleanup.

Script files live in `$XDG_RUNTIME_DIR/airi-kwin/`, which each QA session keeps private. On start, the probe unloads and deletes the scripts of any dead process found there, so a probe killed with SIGKILL is cleaned up by the next one in the same session. Without a KWin on the bus, it exits 1 with `bridge failed: org.kde.KWin has no owner`; a bridge that never says `Hello` fails after 2 seconds. A bad argument exits 2.

The backend imports its compositor scripts with Vite's `?raw` suffix, so the probe registers a small Node loader hook for those imports.

## CPU slots and verify

`pnpm verify` takes a lease from the CPU slot budget for each step, so steps from several worktrees queue instead of oversubscribing the machine. The classes are:

- `typecheck`: one `turbo run typecheck` command, with `--concurrency={grant}`. Its requested maximum is the number of changed packages and their dependents, floored at the class minimum of two. An all-package typecheck keeps the class maximum.
- `lint`: `moeru-lint` in chunks.
- `test`: the prerequisite Turbo build and every `vitest related --run` command share one lease. Turbo receives `--concurrency={grant}`; each Vitest process, in the root or in a package, inherits the lease through `withCpuSlots` and applies its class cap, including the browser cap.

A waiting step prints `cpu-slots: waiting for N slot(s) ...`. Run `pnpm slots status` to see the holders.

`pnpm dev:top` prints `cpu slots: held X/Y, N queued` in its header, with one line per lease and queued caller. If the store lock is held, it prints `cpu slots: busy (lock held), try again`. If the store cannot be read, it prints `cpu slots: unavailable (...)`. `pnpm dev:top kill <worktree>` is a dry run unless `--yes` is passed, and `--orphans` limits it to orphaned processes. Each kill re-reads the live command line first.

Editing any file under `packages/cpu-slots`, including its README, currently invalidates the Turbo typecheck and test caches for the whole repository. The cause and the measured cost are in the cpu-slots README under "Turbo cache cost".

## Moving the repository to a Dev Drive (Windows 11)

A Dev Drive is a ReFS volume that Microsoft Defender scans in performance mode. It cuts the scanning cost of `node_modules` across many worktrees. These steps need an administrator shell and a pause in all dev work.

1. Stop every dev process. Check with `pnpm dev:top`.
2. Create the Dev Drive (at least 50 GB): Settings, System, Storage, Advanced storage settings, Disks and volumes, Create Dev Drive. Choose a new VHD or free space. This guide assumes drive `D:`.
3. Confirm the drive is trusted, so performance mode applies:
   ```powershell
   fsutil devdrv query D:
   fsutil devdrv trust D:   # only if query reports it untrusted
   ```
4. Put the pnpm store on the same volume. pnpm hardlinks only within one volume and copies otherwise:
   ```powershell
   pnpm config set store-dir D:\.pnpm-store --global
   ```
5. Move the main checkout, then repair the worktree links. Linked worktrees are disposable, so recreate them rather than moving them:
   ```powershell
   robocopy C:\Users\Luke\projects\dtuber D:\projects\dtuber /E /MOVE /XD node_modules
   cd D:\projects\dtuber
   git worktree prune
   pnpm install
   ```
   Recreate each worktree you still need with `pnpm wt new <name> --branch <existing-branch>`. A branch that already exists needs `git worktree add <path> <branch>` instead, followed by `pnpm install`.
6. Exclude `D:\` in Indexing Options, so Windows Search stops crawling `node_modules`.
7. Turbo's cache lives in the main checkout's `.turbo/cache`, so it moves with step 5.
