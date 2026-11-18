# Developing this fork

This guide covers setting up, running, and checking this personal fork of [Project AIRI](https://github.com/moeru-ai/airi). Read [`AGENTS.md`](../AGENTS.md) for the repository conventions. Each app and package also has its own `README.md`, and many have a nested `AGENTS.md`.

## Prerequisites

- [Git](https://git-scm.com/downloads)
- [mise](https://mise.jdx.dev/installing-mise.html), or another version manager that reads `.tool-versions`

[`.tool-versions`](../.tool-versions) pins Node.js, pnpm, and .NET. The `packageManager` field in [`package.json`](../package.json) pins the same pnpm version.

<details>
<summary>Windows setup</summary>

Windows is planned, not checked: the code stays, but no release is built and no change is tested on Windows. See [Platform support](../README.md#platform-support).

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
| Desktop app, packages | Nothing more |
| Godot VRM stage sidecar | `cd engines/stage-tamagotchi-godot && mise trust && mise install` installs the Godot Mono version that the root [`global.json`](../global.json) pins. Before `pnpm dev:tamagotchi`, point `GODOT4` at it: `export GODOT4="$(cd engines/stage-tamagotchi-godot && mise which godot)"`. |
| Packaged desktop app | Xcode 26 or later builds the `.icon` app icon. With an older Xcode, the build uses `.icns` and prints a warning. |
| Local backend | Docker Desktop or another Docker engine for `pnpm dev:backend` |

macOS version limits:

- Xcode 26 requires macOS Sequoia 15.6 or later.
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

To bump dependencies, run `pnpm deps:up`. It picks updates interactively with taze, which skips versions younger than the workspace's `minimumReleaseAge` (three days), so `pnpm install` accepts every version it writes. It is not named `up`, because `pnpm up` is pnpm's own `update` command.

## Run an app

### Desktop (Stage Tamagotchi)

```shell
pnpm dev:tamagotchi
```

> [!NOTE]
> The `dev` and `start` scripts run `install-electron` before `electron-vite`. Electron 42 downloads its binary on first use of its `bin` entry, but `electron-vite` reads `node_modules/electron/path.txt` directly and never triggers that download. Without this step, a fresh install fails with `Error: Electron uninstall`.

### Integrations

The Discord, Minecraft, and other integrations in `integrations/` are inherited from upstream. Their setup is in each directory's `README.md`.

## Check your changes

Use the [testing and QA guide](../docs/ai/context/testing.md) to choose checks for your change. It defines the inner loop, incremental commit loop, full branch gate, live acceptance, and checks required for each change type.

The [dev-tools README](../scripts/dev-tools/README.md) documents verify,
branch-gate, and QA display command mechanics. Package READMEs document
their test commands and local requirements. The [motion QA levels ADR](../docs/ai/adr/2026-10-20-motion-qa-levels.md)
describes the evidence each motion level provides.

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
- Name branches `<username>/<type>/<short-name>`, where `<type>` is a Conventional Commit type such as `feat` or `fix`.
- Pull with rebase.
- Keep documentation in the same commit as the code it describes. Put agent configuration changes (`AGENTS.md`, `CLAUDE.md`, `.agents/`) in a separate commit.
- Add user-visible strings in English under `packages/i18n/src/locales/en/`. Do not add placeholder translations for other locales.

## Bring in upstream changes

Upstream changes come in by merge, never by cherry-pick or rebase. Merge `upstream/main` into a `<username>/chore/upstream-sync` branch, resolve the conflicts there, and run `pnpm verify --gate`:

```shell
git fetch upstream
git switch -c <username>/chore/upstream-sync main
git merge upstream/main
pnpm verify --gate
```

Land the branch locally with a fast-forward, not through a GitHub pull request:

```shell
git switch main
git merge --ff-only <username>/chore/upstream-sync
git push
```

The fork's pull requests allow only rebase merges, which would copy every upstream commit under a new hash and make the next sync conflict with the last one. For the same reason, do not rebase the fork onto upstream.

Run long verification for a sync in a dedicated worktree.

When upstream is far ahead, merge in steps of about 100 commits and finish each step before the next. The [upstream policy ledger](../docs/ai/context/upstream-policy.md#at-each-sync) has the full procedure: which files keep the fork's version, which paths stay deleted, and what to record.
