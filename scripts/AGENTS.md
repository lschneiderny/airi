# Root scripts

## OVERVIEW
Repository developer tooling that belongs to no workspace package: the `pnpm dev:*` launcher, `pnpm verify`, `pnpm wt`, `pnpm dev:top`, and `pnpm test:run`. Score: 12, a distinct tooling domain behind root commands. Follow the [root guide](../AGENTS.md).

## WHERE TO LOOK
| Task | Location | Notes |
| --- | --- | --- |
| Command reference and flags | `dev-tools/README.md` | Verify steps, cache store, worktrees, process attribution, Dev Drive move |
| `pnpm dev:*` process and signal handling | `dev.mjs` | Starts the Node.js entry behind each `.cmd` shim, forwards Ctrl+C, force-stops after 10 seconds |
| Logic that must match pnpm | `dev-launcher.mjs` | Script parsing, shim reading, command lookup, script environment, exit code |
| Launcher design record | `docs/ai/adr/2026-10-19-dev-launcher.md` | Ownership split between `dev.mjs` and `dev-launcher.mjs` |
| Verify CLI and step commands | `dev-tools/verify.ts` | Turbo typecheck, `moeru-lint` batches, `vitest related` |
| Verify planning and arguments | `dev-tools/verify-plan.ts` | `planVerify`, `parseVerifyArgs`, `stripWorkerFlags` |
| Verify pass cache | `dev-tools/verify-cache.ts` | Keys stored under `<git common dir>/airi-verify/` |
| Worktree commands | `dev-tools/wt.ts`, `dev-tools/wt-plan.ts` | `ls`, `new`, `rm`, `gc` |
| Process rollup and kill | `dev-tools/top.ts`, `dev-tools/lib/processes.ts` | Worktree attribution and orphan detection |
| Headless QA display (Linux) | `dev-tools/qa-display.ts`, `dev-tools/qa-display-plan.ts` | `pnpm qa:display`: KWin, Xvfb/openbox or headless sway; KWin `--portals`; each session has a private runtime directory and bus |
| KWin bridge probe | `dev-tools/kwin-probe.ts` | `pnpm qa:kwin-probe`: isolated script handshake, redacted messages and unload receipts |
| CPU slot status display | `dev-tools/lib/cpu-slots.ts` | Renders `@proj-airi/cpu-slots` status for `dev:top` |
| Suite runner | `dev-tools/test-run.ts`, `dev-tools/test-run-plan.ts` | Runs every suite after a failure, exits 1 on any failure |
| Shared process, git, and chunking helpers | `dev-tools/lib/exec.ts`, `dev-tools/lib/git.ts` | Command-line length limits for Windows shims |
| UI component audit | `audit-ui-components.mjs` | Output feeds `docs/assets/ai/audits/ui-components.md` |
| Module size listing | `list-module-loc.mjs` | Ad hoc LOC report |
| Documentation site build | `build-airi-docs.sh` | Clones `moeru-ai/airi-docs`; used by `apps/stage-web/Dockerfile` and `netlify.toml` |

## CONVENTIONS
- Each CLI keeps side effects in its entry file and pure decisions in a sibling `*-plan.ts` or `dev-launcher.mjs`. Put new testable logic in the pure module.
- Root Vitest owns these tests. The `dev-tools` project includes `scripts/dev-tools/**/*.test.ts`. The `root-scripts` project includes `scripts/**/*.test.mjs`.
- Run a focused test with `pnpm exec vitest run --project dev-tools <path>` or `pnpm exec vitest run --project root-scripts <path>`.
- `dev-tools/tsconfig.json` extends the root config with `strict` and Node types. No Turbo package owns these files, so the `pnpm verify` typecheck step skips them. Its lint and test steps still cover them.
- Plain Node.js `.mjs` files keep `.mjs` extensions on relative imports, with a scoped `no-restricted-syntax` disable comment. This is the runtime exception named by the root import rule.
- `parseScript` accepts only `&&` chains of plain words. Scripts with quotes, pipes, variables, or environment assignments must run through pnpm instead of `scripts/dev.mjs`.

## ANTI-PATTERNS
- Do not route `pnpm dev:*` back through `pnpm --filter` or `.cmd` shims. Each shim layer brings back the `Terminate batch job (Y/N)?` prompt after Ctrl+C.
- Do not stop processes by PID alone. Kill paths re-read the live command line first because Windows reuses PIDs, and they never stop their own tree.
- Do not cache a failed verify step, or a pass when files changed during the step. Keep worker-count flags out of cache keys through `stripWorkerFlags`.
- Do not let `wt rm` delete a worktree with live processes, uncommitted files without `--force`, or unmerged detached commits.
- Do not add a `package.json` here or move these tools into a workspace package without asking. Their root-only ownership is deliberate.
- Do not treat a shallow `build-airi-docs.sh` clone as changelog-complete. Pass a full-history checkout through `AIRI_DOCS_DIR` when changelogs matter.
