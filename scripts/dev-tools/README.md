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
pnpm verify                      # changes since each step's last passing tree
pnpm verify --gate               # full branch against the merge base with main
pnpm verify --only lint,test     # some steps
pnpm verify --base origin/main   # another base
pnpm verify --dry-run            # print the plan and commands
pnpm verify --force              # ignore cached passes
pnpm verify --stats              # summarize recorded step outcomes
pnpm verify --stats --since 2d --json
```

The steps:

- **typecheck** runs `turbo run typecheck --filter=...{./<package-dir>}` for each changed package. Directory filters cover its dependents and accept scopes derived from Git trees. Turbo caches results in the main worktree's `.turbo/cache`, which all worktrees share. A change to a root file that every package reads (`tsconfig*.json`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, a root `.d.ts`) typechecks every package.
- **lint** runs `moeru-lint` (oxlint, then ESLint with its cache) on the changed files.
- **test** runs `vitest related` on the changed code files with the root config. When a changed code file is inside a workspace package, it also runs each config that `pnpm test:run` adds whose package is that package or depends on it, according to `turbo ls --filter=...{<package>}`. A config in an unrelated package cannot import the changed code, so it is skipped.

Each step acquires one CPU lease before its first command and releases it after its last command, including on failure. A failed command stops the remaining commands in that step. `--dry-run` prints one lease request per uncached, runnable step.

Each step prints its scope. Plain verify uses that step's last passing tree on the current branch, including committed, staged, unstaged, and untracked changes since that tree. A commit without verification does not advance the baseline. Comparing working-tree snapshots also avoids repeatedly checking unchanged untracked files.

The per-branch record lives at `<git common dir>/airi-verify/last/<encoded-branch>.json`, with slashes percent-encoded. It holds the merge base and a `{ tree, head, recordedAt }` entry per step. A missing or malformed record, missing step entry, changed merge base, or pruned tree falls back to the full branch scope and prints why. Detached HEAD always uses branch scope and never reads or writes a last-pass record. `--base` selects the ref used to compute the merge base.

After a pass, including a cached pass, only that step's entry advances. Skipped and failed steps leave their entries unchanged. A pass against a different merge base starts a new record so old entries cannot narrow the other steps. Dry runs never write records. Files must remain unchanged during the step before either the pass cache or the last-pass record is written.

Use `pnpm verify --gate` before landing to check the full branch regardless of previous passes. If the branch touches app runtime paths (`apps/stage-tamagotchi/src/`, `packages/stage-ui*/src/`, `packages/stage-shared/src/`, `packages/stage-pages/src/`, or `packages/stage-layouts/src/`), the gate prints a reminder to run `pnpm qa:display run -- pnpm qa:smoke`.

A passing step is recorded under `<git common dir>/airi-verify/`, keyed by the working tree hash, step, exact command, Node.js version, and platform. Entries also carry `scopeBase` and `mode`; those fields do not change the key. Every worktree reads the same store. An identical tree and command reports `cached` without running anything; an empty incremental scope reports `skipped`. Failures are never stored. A pass is not stored if files changed while the step ran. Pass-cache entries older than 30 days are pruned.

Step history is separate from the pass cache. Each completed step appends a record to `<git common dir>/airi-verify/runs.jsonl`, including failures, cached passes, and skips. Records contain `ts` (epoch milliseconds), `worktree`, `branch` (null for detached HEAD), `head`, `tree`, `scopeBase`, `mode`, `step`, `status` (`pass`, `fail`, `cached`, or `skipped`), `durationMs`, `commands` (argument arrays), `files`, `waitMs`, and `grant`. Executed commands include the granted concurrency; cached steps list their planned commands. Steps without a lease record zero wait and a null grant. Duration includes waiting for the lease. Dry runs do not append history.

`pnpm verify --stats` reads history without running checks or changing cache records. It reports counts by status for each step and scope mode, failure rate, median and p90 duration, and the slowest five executed steps with their worktree and branch. Failure rates and duration distributions use executed passes and failures; cached and skipped steps contribute only to counts. `--since` accepts a positive integer followed by `ms`, `s`, `m`, `h`, or `d`. `--json` prints the summary as JSON. Malformed lines are skipped and counted, including malformed lines outside the requested time window.

Before an append, a history file larger than 5 MiB rotates to `runs.1.jsonl`, replacing the previous generation. Statistics read both generations. History write failures print a warning without changing check results. Set `AIRI_VERIFY_HISTORY_DIR` to use another history directory, such as a temporary directory for QA; this setting does not redirect pass-cache or last-pass records.

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

`run` and `env` apply both columns. They also set the session's private `XDG_RUNTIME_DIR`, `AIRI_QA_HOST_RUNTIME_DIR` (your own runtime directory, so `pnpm qa:display` still finds your systemd user manager from inside a session), and `AIRI_QA_DISPLAY=<name>` with the same name in `AIRI_QA_DISPLAY_SESSION=<name>`, the marker the host session guard reads. Clients keep your `XDG_DATA_HOME` and `XDG_CONFIG_HOME`. A client whose desktop file the session's portal must see installs it in `<session dir>/data/applications`. `run` starts the command through `systemd-run --user --scope` in the unit `airi-qa-display-<name>.run-<pid>.scope`, so the command and anything it leaves behind stay in a cgroup of the session; qa-tools reads only those cgroups when it lists processes. `down` first stops every `airi-qa-display-<name>.run-*.scope`, also when the session unit has already stopped, so such a leftover does not outlive the session. `run` exits with the command's exit code. `up` fails with `qa-display: <binary> not installed (run: sudo dnf install <package>)` when a binary the session needs is missing; `--private-audio` also needs `pipewire`, `wireplumber`, `pipewire-pulse` (`pipewire-pulseaudio`), `pactl` (`pulseaudio-utils`), and `timeout`. `--windowed` works with `kwin` only.

`--portals` (kwin only) runs KWin without `--no-global-shortcuts`, so KWin hosts KDE's global accelerator (`org.kde.kglobalaccel`) in-process through `libKGlobalAccelD`. After KWin is ready, it starts `/usr/libexec/xdg-desktop-portal` and `/usr/libexec/xdg-desktop-portal-kde` on the private bus. When `rpm -ql kglobalacceld kf6-kglobalaccel` lists a standalone `kglobalacceld` executable, that daemon is started there too. `up` seeds `config/kglobalshortcutsrc` with an `[ai.moeru.airi]` group that holds the QA push-to-talk trigger (`voice-push-to-talk=Ctrl+Shift+Space`). `up` returns only after the `GlobalShortcuts` portal and `org.kde.kglobalaccel` answer on the private bus. If they do not answer within 15 seconds, it stops the session and fails with the reason. The private bus D-Bus-activates the portal's helpers (`xdg-document-portal`, `xdg-permission-store`, `gvfsd`) from the system service directories inside the private runtime directory, and `down` stops them with the unit. The screen locker stays off (`--no-lockscreen`); lock QA owns `org.freedesktop.ScreenSaver` on the private bus instead. Clients that `run` started are not part of the unit. They lose their display and exit when the session stops. Stop leftovers with `pnpm dev:top kill <worktree>`.

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

## CPU slots and the verify cache

`pnpm verify` takes a lease from the CPU slot budget for each step, so steps from several worktrees queue instead of oversubscribing the machine. The classes are:

- `typecheck`: one `turbo run typecheck` command, with `--concurrency={grant}`. Its requested maximum is the number of changed packages and their dependents, floored at the class minimum of two. An all-package typecheck keeps the class maximum.
- `lint`: `moeru-lint` in chunks.
- `test`: the prerequisite Turbo build and every `vitest related --run` command share one lease. Turbo receives `--concurrency={grant}`; child Vitest wrappers inherit the lease and apply their class caps, including the browser cap.

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
