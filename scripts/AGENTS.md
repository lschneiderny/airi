# Root scripts

## CONVENTIONS
- Each CLI keeps side effects in its entry file and pure decisions in a sibling `*-plan.ts` or `dev-launcher.mjs`. Put new testable logic in the pure module.
- Logic in `dev-launcher.mjs` must match pnpm: script parsing, shim reading, command lookup, script environment, and exit code. `docs/ai/adr/2026-10-19-dev-launcher.md` records the ownership split between `dev.mjs` and `dev-launcher.mjs`.
- Plain Node.js `.mjs` files keep `.mjs` extensions on relative imports, with a scoped `no-restricted-syntax` disable comment.
- `parseScript` accepts only `&&` chains of plain words. Scripts with quotes, pipes, variables, or environment assignments must run through pnpm instead of `scripts/dev.mjs`.

## ANTI-PATTERNS
- Do not route `pnpm dev:*` back through `pnpm --filter` or `.cmd` shims. Each shim layer brings back the `Terminate batch job (Y/N)?` prompt after Ctrl+C.
- Do not stop processes by PID alone. Kill paths re-read the live command line first because Windows reuses PIDs, and they never stop their own tree.
- Do not let `wt rm` delete a worktree with live processes, uncommitted files without `--force`, or unmerged detached commits.
- Do not add a `package.json` here or move these tools into a workspace package without asking. Their root-only ownership is deliberate.
