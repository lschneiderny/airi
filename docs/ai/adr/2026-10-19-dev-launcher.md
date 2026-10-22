# Development launcher without batch-file prompts

Date: 2026-10-19
Status: accepted

## Problem

On Windows, one Ctrl+C in `pnpm dev` asked `Terminate batch job (Y/N)?` four times before the terminal returned.
Each prompt comes from one `cmd.exe` batch context in the launch chain:

```text
pnpm.CMD (pnpm home shim)
  pnpm.exe 10.x
    11.x\bin\pnpm.cmd        (pnpm switches to the packageManager version)
      pnpm -r -F <package> dev  (root script starts a nested pnpm through pnpm.cmd)
        node_modules\.bin\vite.CMD
          node vite.js
```

`cmd.exe` asks the question when a batch file's child exits after Ctrl+C. The development tool itself stops on the first Ctrl+C.

## Decision

The root `dev:*` scripts that run one package script call `scripts/dev.mjs`:

```sh
node scripts/dev.mjs <package-dir> <script> [args...]
```

The launcher reads the script from the package's `package.json` and runs it like `pnpm --filter <package> run <script>`.
On Windows, it reads each pnpm `.cmd` shim in `node_modules/.bin` and starts the shim's Node.js entry point directly. No batch file runs between the root script and the tool.
On other platforms, it runs the `.bin` shim directly, as pnpm does.

`scripts/dev.mjs` owns arguments, signals, and child processes. `scripts/dev-launcher.mjs` holds the logic that must match pnpm: script parsing, shim reading, command lookup, the script environment, and the exit code. `scripts/dev-launcher.test.mjs` tests that logic in the `root-scripts` Vitest project.

These root scripts use the launcher: `dev`, `dev:web`, `dev:web:https`, `dev:ui`, `dev:server-auth`, `dev:server`, `dev:tamagotchi`, and `dev:tamagotchi:xwayland`.
`dev:pocket:*`, `dev:backend`, `dev:apps`, and `dev:packages` still use pnpm or Docker directly.

## Behavior that must match pnpm

The launcher gives each command what pnpm gives it:

- the same Node.js binary, entry point, arguments, and working directory (the package directory);
- `PATH` with the package `.bin`, pnpm's `node-gyp-bin`, and the root `.bin` in front of the inherited `PATH`;
- `NODE_PATH` from the shim;
- `npm_lifecycle_event`, `npm_lifecycle_script`, `npm_package_json`, `PNPM_SCRIPT_SRC_DIR`, `PWD`, and `INIT_CWD`;
- `npm_package_*` variables flattened from the package's `name`, `version`, `config`, `engines`, and `bin` fields, after the inherited `npm_package_*` variables are removed, as pnpm's `makeEnv` does.

Arguments after the script name go to the last command of an `&&` chain, as pnpm appends them to the script.
Commands in an `&&` chain run in order, and a failed command stops the chain with its exit code.
The launcher rejects scripts that need a shell (quotes, pipes, redirects, variables, or `VAR=value` prefixes), so it never runs a script differently from pnpm.

When the launcher runs through `pnpm <script>`, pnpm also provides its own variables, such as `npm_config_user_agent` and `npm_execpath`.
When the launcher runs directly with `node`, those variables are absent, and pnpm does not check dependencies before the run.

## Stopping

On Windows, the console delivers Ctrl+C to every process in it, so the tool stops by itself. The launcher waits for it.
On other platforms, the launcher also forwards `SIGINT`, `SIGTERM`, and `SIGHUP` to the running command, as pnpm does.
If the command still runs 10 seconds after the first stop request, or the user presses Ctrl+C a second time, the launcher kills the command's process tree (`taskkill /t /f` on Windows, `SIGKILL` elsewhere).
On Windows, closing the console window kills the tree at once, because Windows ends the launcher a few seconds later.
The launcher stops only processes that it started.

A stop that the user requests with Ctrl+C ends with exit code 0, even when the tool exits with another code or the launcher kills it. This differs from pnpm, which reports the tool's code and prints `ELIFECYCLE` errors after every Ctrl+C. Other stops (`SIGTERM`, `SIGHUP`) and failures keep the command's exit code.

## Remaining prompts through `pnpm`

`pnpm dev` still runs two batch files before the launcher starts: the `pnpm.CMD` shim in the pnpm home directory and the `.cmd` that pnpm uses to switch to the `packageManager` version.
These files belong to the local pnpm installation, not to this repository. They cause two prompts.
`node scripts/dev.mjs <package-dir> <script>` runs no batch file and causes no prompt.

## Verification

The results below come from Windows 11 and from Linux (WSL 2) with pnpm 11.24.0 and Node.js 26.11.1. On Windows, a harness sent a console Ctrl+C with `GenerateConsoleCtrlEvent`, read the console buffer, and listed the process tree.

A Node.js `--import` hook recorded the argv, working directory, and environment of each tool process. Old and new runs were compared field by field.

| Check | `pnpm` before | `pnpm` with launcher | `node scripts/dev.mjs` |
| --- | --- | --- | --- |
| Prompts after one Ctrl+C, `dev` | 4 | 2 | 0 |
| Prompts, `dev:tamagotchi`, `dev:ui`, `dev:server` | 4 (3 without the root script layer) | 2 | 0 |
| Processes left after Ctrl+C | none | none | none |
| Vite argv, Node.js binary, and working directory for `dev` | baseline | equal | equal |
| Vite environment for `dev` | baseline | equal | equal except pnpm's own variables |

Other results:

- `pnpm dev --port 5199 --strictPort` passed the same arguments to Vite as the old script did, and set `npm_lifecycle_script` the same way.
- `dev:tamagotchi` ran `install-electron` and then `electron-vite dev` with the same argv, binary, and working directory. Ctrl+C stopped electron-vite, esbuild, and every Electron process.
- When the Electron app exits by itself, the session ends with exit code 1 in both versions, as before.
- Closing the console window stopped the whole desktop session.
- A command that ignores Ctrl+C was killed 10.5 seconds after one Ctrl+C, and 0.7 seconds after a second Ctrl+C.
- A failed command in an `&&` chain stopped the chain. An unknown Vite option failed with exit code 1 in both versions.
- `dev:server-auth` failed in both versions without `VITE_WEB_APP_URL`, and started in both versions with it.
- After Ctrl+C, the launcher exited with 0 for Vite and for a command that ignored Ctrl+C. A missing entry point still exited with 1.
- On Linux, a pseudo-terminal sent Ctrl+C. The old script exited with 129 and printed `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`. `pnpm dev` and `node scripts/dev.mjs` exited with 0 within 0.2 seconds and left no processes. Vite received the same argv and working directory. The environment differed only in the root script `PATH` entries and shell bookkeeping variables (`SHLVL`, `OLDPWD`).
- Each test fails when one of these is broken: the Ctrl+C exit code, the `PATH` order, the removal of inherited `npm_package_*` variables, and the `.bin` lookup order.

These paths were not run: `dev:web:https` (it installs a local certificate authority), `dev:tamagotchi:xwayland` (it is a Linux X11 option), and macOS.
