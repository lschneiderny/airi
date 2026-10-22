# Developer tools

Root commands for working on this repository with many worktrees and parallel agents. They belong to no package.

| Command | What it does |
| --- | --- |
| `pnpm verify` | Typechecks changed packages and their dependents, lints changed files, and runs related tests. Skips a step that already passed on the same working tree. |
| `pnpm wt ls \| new \| rm \| gc` | Lists, creates, removes, and garbage-collects worktrees. |
| `pnpm dev:top` | Shows dev process memory and CPU per worktree, flags orphans, and stops one worktree's processes. |
| `pnpm test:run` | Runs the root Vitest config and then each package suite (`test-stage-tamagotchi:run`, `test-stage-web:run`, `test-stage-pages:run`, `test-ui:run`, `test-stage-ui-live2d:run`, `test-model-driver-lipsync:run`). Every suite runs even after a failure. It prints a per-suite summary and exits 1 if any suite failed. |

## When to use

- Use `pnpm verify` before finishing a task, instead of root `pnpm lint` and `pnpm typecheck`.
- Use `pnpm wt` to create and remove worktrees, so installs use the shared store and removal survives Windows path limits.
- Use `pnpm dev:top` when the machine is slow, to see which worktree and tool is responsible.

## When not to use

- Use root `pnpm typecheck`, `pnpm lint`, or `pnpm test:run` for a release or a whole-repository sweep. `pnpm verify` only covers what changed since the base.
- `pnpm verify` does not run QA gates or Electron builds.

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

A process belongs to the worktree whose path appears in its command line, or else to its nearest ancestor's worktree. An orphan is a Node.js, Electron, or Godot process whose parent has exited. `kill` stops each process tree once, from its top-most member. Right before each kill it re-reads the live command line, because Windows reuses PIDs. It never stops the tree it runs in.

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
