# Developer tools

Root commands for working on this repository with many worktrees and parallel agents. They belong to no package.

| Command | What it does |
| --- | --- |
| `pnpm verify` | Typechecks changed packages and their dependents, lints changed files, and runs related tests. Skips a step that already passed on the same working tree. |
| `pnpm wt ls \| new \| rm \| gc` | Lists, creates, removes, and garbage-collects worktrees. |
| `pnpm dev:top` | Shows dev process memory and CPU per worktree, flags orphans, and stops one worktree's processes. |
| `pnpm qa:display up \| down \| status \| env \| run \| shot` | Runs a headless, GPU-accelerated KWin session on Linux, so agents can run the Electron app and live QA without touching the user's desktop. |
| `pnpm qa:kwin-probe [--seconds N] [--cursor] [--bus <address>]` | Loads the AIRI KWin bridge into a QA session's KWin, prints its messages as JSON lines, then unloads it and confirms KWin no longer has the scripts. |
| `pnpm check:bundle` | Builds the Electron app and fails if the main window loads three, three-mmd, three-vrm, or Tres at startup. |
| `pnpm test:run` | Runs the root Vitest config and then each package suite (`test-stage-tamagotchi:run`, `test-stage-web:run`, `test-stage-pages:run`, `test-ui:run`, `test-stage-ui-live2d:run`, `test-model-driver-lipsync:run`, `test-stage-ui-three:run`, `test-stage-ui-mmd:run`). Every suite runs even after a failure. It prints a per-suite summary and exits 1 if any suite failed. |

## When to use

- Use `pnpm verify` before finishing a task, instead of root `pnpm lint` and `pnpm typecheck`.
- Use `pnpm wt` to create and remove worktrees, so installs use the shared store and removal survives Windows path limits.
- Use `pnpm dev:top` when the machine is slow, to see which worktree and tool is responsible.
- Use `pnpm qa:display run -- <command>` on Linux for any agent run that opens app windows, such as T3 runs, agent-browser sessions, and Vishot captures, while the user keeps working on the desktop.
- Use `pnpm check:bundle` after changing how the stage, settings, or hosts import a renderer package.

## When not to use

- Use root `pnpm typecheck`, `pnpm lint`, or `pnpm test:run` for a release or a whole-repository sweep. `pnpm verify` only covers what changed since the base.
- `pnpm verify` does not run QA gates or Electron builds.

## Quiet dev output

Use `AIRI_DEV_QUIET=1 pnpm dev` (or another `dev:*` command routed through `scripts/dev.mjs`) to keep full child output in `.temp/dev/<package>-<script>-<timestamp>.log`. Set `AIRI_DEV_LOG=<path>` to choose a file; relative paths start at the repository root. The console shows the log path, one `[dev] ready <url>` line, error-looking lines, and the exit status. Ctrl+C and SIGTERM still stop the child tree. Without quiet mode, output is unchanged.

## `pnpm verify`

```bash
pnpm verify                      # all steps against the merge base with main
pnpm verify --only lint,test     # some steps
pnpm verify --base origin/main   # another base
pnpm verify --dry-run            # print the plan and commands
pnpm verify --force              # ignore cached passes
```

The steps:

- **typecheck** runs `turbo run typecheck --filter=...[<merge base>]`. That covers every package with a changed file and every package that depends on one. Turbo caches results in the main worktree's `.turbo/cache`, which all worktrees share. A change to a root file that every package reads (`tsconfig*.json`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, a root `.d.ts`) typechecks every package.
- **lint** runs `moeru-lint` (oxlint, then ESLint with its cache) on the changed files.
- **test** runs `vitest related` on the changed code files with the root config. When a changed code file is inside a workspace package, it also runs the configs that `pnpm test:run` adds.

Changed files are those that differ between the merge base and the working tree, including uncommitted and untracked files.

A passing step is recorded under `<git common dir>/airi-verify/`, keyed by the working tree hash, the exact command, the Node.js version, and the platform. Every worktree reads the same store. A rerun on an identical tree reports `cached` without running anything. Failures are never stored. A pass is not stored if files changed while the step ran. Entries older than 30 days are pruned.

Exit codes: 0 every step passed, 1 a step failed, 2 usage error.

## `pnpm check:bundle`

```bash
pnpm check:bundle                        # build the Electron app, then check it
pnpm exec tsx scripts/dev-tools/bundle-check.ts   # check the existing build in apps/stage-tamagotchi/out
```

The check starts from the module script in `out/renderer/index.html` and follows static `import` and `export ... from` statements through the emitted chunks. It skips dynamic `import()`, which loads only when a 3D model is selected. No chunk it reaches may contain three, which it recognizes by the `__THREE__` property that three sets when it loads. three-mmd, three-vrm, and Tres all import three, so the same marker covers them. The build writes no sourcemaps, so the check cannot name modules directly. It prints how many chunks and megabytes the main window loads at startup. The [lazy 3D renderers ADR](../../docs/ai/adr/2026-11-04-lazy-3d-renderers.md) records why. The `airi/lazy-3d-renderers` ESLint rule catches the same mistake earlier, in the editor and in `pnpm verify`. The check is a separate command because it needs an Electron build.

## `pnpm wt`

```bash
pnpm wt ls                                  # name, branch, idle time, uncommitted files, merged into main, live processes
pnpm wt new my-feature                      # <repo>-wt/my-feature on <prefix>/feat/my-feature, then pnpm install
pnpm wt new my-feature --base main --branch luke/fix/x --no-install
pnpm wt rm my-feature [--force] [--delete-branch]
pnpm wt gc [--days 14]                      # dry run
pnpm wt gc --yes
```

- The branch prefix comes from `git config airi.branchPrefix`, or else the OS user name.
- `rm` refuses while any process still runs from the worktree. It also refuses for uncommitted files (`--force` overrides only this) and for a detached HEAD holding commits main does not contain. If `git worktree remove` fails on long `node_modules` paths, it deletes the directory with extended-length paths and prunes.
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
pnpm qa:display up --windowed               # show the session as a window on your desktop
pnpm qa:display up --name ptt --portals     # KWin plus the desktop portal and KDE global shortcuts
pnpm qa:display up --name x --compositor x11    # Xvfb with openbox
pnpm qa:display up --name s --compositor sway   # headless sway
pnpm qa:display pointer 300 200             # move the session pointer
pnpm qa:display run -- pnpm qa:motion ...   # start the session if needed, then run inside it
eval "$(pnpm --silent qa:display env)"      # point the current shell at the session
pnpm qa:display shot .temp/qa/desktop.png   # capture the whole session display
pnpm qa:display status
pnpm qa:display down
```

A session is a `kwin_wayland --virtual` compositor with rootless Xwayland and a private D-Bus session bus. It runs as the transient systemd user unit `airi-qa-display-<name>.service`, so it survives the agent that started it, and `down` stops the compositor, its services, and the bus together. Clients render on the host GPU: Electron reports GPU compositing, WebGL, and WebGPU on the NVIDIA card through ANGLE. Their windows, focus changes, and pointer input stay inside the session. The private bus has no notification server, StatusNotifier host, portal, or global-shortcut service, so notifications, tray icons, and shortcuts from the app never reach the desktop. The exception is `--portals`, described below.

Every session also has a private runtime directory: `XDG_RUNTIME_DIR=<session dir>/runtime` (mode 0700), `XDG_DATA_HOME=<session dir>/data`, and `XDG_CONFIG_HOME=<session dir>/config`, where the session dir is `$XDG_RUNTIME_DIR/airi-qa-display/<name>`. The unit drops the host `WAYLAND_DISPLAY`, `DISPLAY`, `XAUTHORITY`, and the other desktop keys that the systemd user manager passes on. It sets the three directories before `dbus-daemon` starts, so D-Bus-activated helpers inherit them. Once the compositor is ready, the unit hands that compositor's display sockets to the private bus through `UpdateActivationEnvironment`. As a result, helpers such as `xdg-document-portal` and `gvfsd-fuse`, which the private bus activates, put their FUSE mounts under `<session dir>/runtime/doc` and `runtime/gvfs`, never at the user's `/run/user/<uid>/doc` or `/run/user/<uid>/gvfs`. KWin and every service read and write their configuration under the session dir, not in your home. The compositor's Wayland socket and sway's IPC socket live in the private runtime directory too. `down` lazily unmounts anything still mounted under the session dir, then removes it. The host PipeWire and PulseAudio sockets (`pipewire-0`, `pipewire-0-manager`, `pulse/native`) are linked into the private runtime directory one by one, so apps in the session keep sound.

`--compositor` picks the session type. A running session keeps its type; `up` with a different `--compositor`, or with `--portals` on a session without portals, fails until you run `down`.

| Compositor | Starts | Sets | Deletes |
| --- | --- | --- | --- |
| `kwin` (default) | `kwin_wayland --virtual --xwayland` | `XDG_CURRENT_DESKTOP=KDE`, `XDG_SESSION_TYPE=wayland`, `WAYLAND_DISPLAY`, `DISPLAY`, `DBUS_SESSION_BUS_ADDRESS` | `SWAYSOCK`, `HYPRLAND_INSTANCE_SIGNATURE`, `XAUTHORITY` |
| `x11` | `Xvfb :<n> -screen 0 <W>x<H>x24` (first free display from `:90`) and `openbox` | `XDG_CURRENT_DESKTOP=Openbox`, `XDG_SESSION_TYPE=x11`, `DISPLAY`, `DBUS_SESSION_BUS_ADDRESS` | `WAYLAND_DISPLAY`, `SWAYSOCK`, `HYPRLAND_INSTANCE_SIGNATURE`, `KDE_FULL_SESSION`, `KDE_SESSION_VERSION`, `XAUTHORITY` |
| `sway` | `WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 sway -c <session dir>/sway.conf`, where the config sets only the output size | `XDG_CURRENT_DESKTOP=sway`, `XDG_SESSION_TYPE=wayland`, `WAYLAND_DISPLAY`, `SWAYSOCK`, `DBUS_SESSION_BUS_ADDRESS`, and `DISPLAY` when sway started Xwayland | `HYPRLAND_INSTANCE_SIGNATURE`, `KDE_FULL_SESSION`, `KDE_SESSION_VERSION`, `XAUTHORITY`, and `DISPLAY` without Xwayland |

`run` and `env` apply both columns. They also set the session's private `XDG_RUNTIME_DIR`, `AIRI_QA_HOST_RUNTIME_DIR` (your own runtime directory, so `pnpm qa:display` still finds your systemd user manager from inside a session), and `AIRI_QA_DISPLAY=<name>` with the same name in `AIRI_QA_DISPLAY_SESSION=<name>`, the marker the host session guard reads. Clients keep your `XDG_DATA_HOME` and `XDG_CONFIG_HOME`. A client whose desktop file the session's portal must see installs it in `<session dir>/data/applications`. `run` exits with the command's exit code. `up` fails with `qa-display: <binary> not installed (run: sudo dnf install <package>)` when a binary the session needs is missing. `--windowed` works with `kwin` only.

`--portals` (kwin only) runs KWin without `--no-global-shortcuts`, so KWin hosts KDE's global accelerator (`org.kde.kglobalaccel`) in-process through `libKGlobalAccelD`. After KWin is ready, it starts `/usr/libexec/xdg-desktop-portal` and `/usr/libexec/xdg-desktop-portal-kde` on the private bus. When `rpm -ql kglobalacceld kf6-kglobalaccel` lists a standalone `kglobalacceld` executable, that daemon is started there too. `up` seeds `config/kglobalshortcutsrc` with an `[ai.moeru.airi]` group that holds the QA push-to-talk trigger (`voice-push-to-talk=Ctrl+Shift+Space`). `up` returns only after the `GlobalShortcuts` portal and `org.kde.kglobalaccel` answer on the private bus. If they do not answer within 15 seconds, it stops the session and fails with the reason. The private bus D-Bus-activates the portal's helpers (`xdg-document-portal`, `xdg-permission-store`, `gvfsd`) from the system service directories inside the private runtime directory, and `down` stops them with the unit. The screen locker stays off (`--no-lockscreen`); lock QA owns `org.freedesktop.ScreenSaver` on the private bus instead. Clients that `run` started are not part of the unit. They lose their display and exit when the session stops. Stop leftovers with `pnpm dev:top kill <worktree>`.

Real-pointer T3 runs such as `builtin:t3-touch` work inside the session: the QA tools inject pointer input through the session KWin's EIS interface, which the private bus exposes without an authorization prompt. They detect the session through `AIRI_QA_DISPLAY` and refuse to drive the cursor without it. See [Pointer platform preflight](../../packages/qa-tools/README.md#pointer-platform-preflight).

Agent QA commands that open app windows or read desktop sensors (`pnpm qa:smoke`, `pnpm qa:app run`, `pnpm qa:host smoke`, and `pnpm qa:kwin-probe` without `--bus`) refuse to start on Linux outside a live session. They call `requireQaDisplaySession(command, argv)` or `assertQaDisplaySession(command, allowHostSession)` from `qa-display-guard.ts`, which exits 2 with a message naming `pnpm qa:display run --` unless `AIRI_QA_DISPLAY_SESSION` names a session whose unit is active and whose env file matches the client environment. The pure decision is `qaDisplayGuard` in `qa-display-plan.ts`. `--allow-host-session` is the explicit escape hatch for a person testing on their own desktop; agents never pass it. See [Linux host session guard](../../packages/qa-tools/README.md#linux-host-session-guard).

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

## CPU slots and the verify cache

`pnpm verify` takes a lease from the CPU slot budget for each step, so steps from several worktrees queue instead of oversubscribing the machine. The classes are:

- `typecheck`: one `turbo run typecheck` command, with `--concurrency={grant}`.
- `lint`: `moeru-lint` in chunks.
- `test`: `vitest related --run` for the root config.
- `browser`: extra configs and browser-mode projects.

A waiting step prints `cpu-slots: waiting for N slot(s) ...`. Run `pnpm slots status` to see the holders.

Passing steps are cached under `<git common dir>/airi-verify/`, keyed by the working tree hash, the command, the Node version, and the platform. `--force` ignores that cache and reruns every step. Verify strips `--concurrency` and `--maxWorkers` from each step's arguments before it caches the step (`stripWorkerFlags` in `scripts/dev-tools/verify-plan.ts:61`, applied at `scripts/dev-tools/verify.ts:107`), so worker counts do not change the cache key. Failures are never cached. A pass is not cached when files changed while its step ran.

`pnpm dev:top` prints `cpu slots: held X/Y, N queued` in its header, with one line per lease and queued caller. If the store lock is held, it prints `cpu slots: busy (lock held), try again`. If the store cannot be read, it prints `cpu slots: unavailable (...)`. `pnpm dev:top kill <worktree>` is a dry run unless `--yes` is passed, and `--orphans` limits it to orphaned processes. Each kill re-reads the live command line first.

Editing any file under `packages/cpu-slots`, including its README, currently invalidates the Turbo typecheck cache for the whole repository. The cause and the measured cost are in the cpu-slots README under "Turbo cache cost".

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
