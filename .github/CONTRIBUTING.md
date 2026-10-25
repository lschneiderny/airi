# Developing this fork

This guide covers setting up, running, and checking this personal fork of [Project AIRI](https://github.com/moeru-ai/airi). Read [`AGENTS.md`](../AGENTS.md) for the repository conventions. Each app and package also has its own `README.md`, and many have a nested `AGENTS.md`.

## Prerequisites

- [Git](https://git-scm.com/downloads)
- [mise](https://mise.jdx.dev/installing-mise.html), or another version manager that reads `.tool-versions`

[`.tool-versions`](../.tool-versions) pins Node.js, pnpm, and .NET. The `packageManager` field in [`package.json`](../package.json) pins the same pnpm version.

<details>
<summary>Windows setup</summary>

1. Open PowerShell.
2. Install [Scoop](https://scoop.sh/).

   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
   ```

3. Install Git and mise.

   ```powershell
   scoop install git mise
   ```

</details>

<details>
<summary>macOS setup</summary>

```shell
xcode-select --install   # Command Line Tools, for native modules
brew install git mise
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
```

Open a new shell, then check that Node.js comes from mise and matches [`.tool-versions`](../.tool-versions):

```shell
command -v node   # a path under ~/.local/share/mise
node --version
```

A Node.js that appears earlier on `PATH`, such as Homebrew's `node` or a `node_modules/.bin` in your home directory, breaks native bindings. For example, Node.js older than 22.12 makes pnpm skip the rolldown binding, and every tsdown build then fails with `Cannot find native binding`.

What each kind of work needs beyond that:

| Work | Needs |
| --- | --- |
| Web app, desktop app, packages | Nothing more |
| Godot sidecar and Kirie | `cd apps/stage-tamagotchi-kirie && mise trust && mise install` installs the Godot Mono version that the root [`global.json`](../global.json) pins. Before `pnpm dev:tamagotchi`, point `GODOT4` at it: `export GODOT4="$(cd apps/stage-tamagotchi-kirie && mise which godot)"`. |
| iOS app | Full Xcode from the App Store, selected with `sudo xcode-select -s /Applications/Xcode.app`. The project uses Swift Package Manager, so CocoaPods is not needed. `pnpm lint:swift` needs `brew install swiftlint`. |
| Packaged desktop app | Xcode 26 or later builds the `.icon` app icon. With an older Xcode, the build uses `.icns` and prints a warning. |
| Local backend | Docker Desktop or another Docker engine for `pnpm dev:backend` |

macOS version limits:

- Xcode 26 requires macOS Sequoia 15.6 or later. Release builds use Xcode 26.2.
- Apple Speech transcription requires macOS 26.

In development, macOS asks for Accessibility (global shortcuts) and Screen Recording (screen capture) on behalf of the app that launched Electron, which is usually your terminal. Grant them to the terminal, then restart it.

</details>

<details>
<summary>Linux setup</summary>

Install Git with the [Linux instructions](https://git-scm.com/downloads/linux), then install mise with the [method for your distribution](https://mise.jdx.dev/installing-mise.html).

</details>

## Install

```shell
git clone https://github.com/lschneiderny/airi.git
cd airi
git remote add upstream https://github.com/moeru-ai/airi.git
mise install
pnpm install
```

If mise is not [activated in your shell](https://mise.jdx.dev/dev-tools/shims.html), prefix commands with `mise exec --`, for example `mise exec -- pnpm install`.

The workspace sets `verifyDepsBeforeRun: error`. If `pnpm run` or `pnpm exec` reports that dependencies are out of date, run `pnpm install` once.

## Run an app

### Desktop (Stage Tamagotchi)

```shell
pnpm dev:tamagotchi
```

> [!NOTE]
> The `dev` and `start` scripts run `install-electron` before `electron-vite`. Electron 42 downloads its binary on first use of its `bin` entry, but `electron-vite` reads `node_modules/electron/path.txt` directly and never triggers that download. Without this step, a fresh install fails with `Error: Electron uninstall`.

### Web (Stage Web)

```shell
pnpm dev
```

### Mobile (Stage Pocket)

The mobile app is inherited from upstream and is not tested in this fork.

```shell
pnpm dev:pocket:ios --target "<DEVICE_ID_OR_SIMULATOR_NAME>"
pnpm dev:pocket:android
```

Quote the target, because simulator names such as `iPhone 16 Pro` contain spaces. To list devices, run `pnpm -F @proj-airi/stage-pocket exec cap run ios --list`. See [`apps/stage-pocket/README.md`](../apps/stage-pocket/README.md) for more.

### Integrations

The Discord, Telegram, Minecraft, and other integrations in `integrations/` are inherited from upstream. Their setup is in each directory's `README.md`.

## Check your changes

Run this after each change:

```shell
pnpm verify
```

`pnpm verify` typechecks the changed packages and their dependents, lints the changed files, and runs the related tests. It skips any step that already passed on the same working tree. If a root config file changed, it typechecks every package.

Narrower and broader commands:

```shell
pnpm -F <package-name> typecheck
pnpm -F <package-name> exec vitest run <path>
pnpm lint:fix        # ESLint also formats
pnpm typecheck       # whole repository
pnpm test:run        # whole repository
```

Build, typecheck, and QA scripts draw from a shared CPU slot budget. If a command waits, run `pnpm slots status` to see which jobs hold the budget.

### Motion QA

Live2D motion and emotion changes have their own gates:

```shell
pnpm qa:doctor   # preflight
pnpm qa:test     # tests, reporting only new failures
pnpm qa:motion   # motion gates
pnpm qa:report   # HTML review report
```

The levels and gates are described in [`docs/ai/adr/2026-10-20-motion-qa-levels.md`](../docs/ai/adr/2026-10-20-motion-qa-levels.md).

## Parallel work in worktrees

```shell
pnpm wt new <name>   # create a worktree
pnpm wt ls           # idle time, uncommitted files, live processes
pnpm dev:top         # memory and CPU of dev processes per worktree
pnpm wt rm <name>    # remove a worktree
```

To stop the processes of a worktree, run `pnpm dev:top kill <name> --yes`.

## Commits and branches

- Use [Conventional Commits](https://www.conventionalcommits.org/) with the package name as the scope, for example `feat(stage-ui-live2d): add touch debug overlay`.
- Name branches `<username>/feat/<short-name>`.
- Pull with rebase.
- Keep documentation in the same commit as the code it describes. Put agent configuration changes (`AGENTS.md`, `.agents/`, `.github/copilot-instructions.md`) in a separate commit.
- Add user-visible strings in English under `packages/i18n/src/locales/en/`. Do not add placeholder translations for other locales.

## Bring in upstream changes

The fork has diverged heavily from upstream, so upstream fixes are brought in by cherry-pick instead of merge:

```shell
git fetch upstream
git log --oneline main..upstream/main
git cherry-pick <commit>
```

Run long verification for a sync in a dedicated worktree.
