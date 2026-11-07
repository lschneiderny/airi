# CPU Slots Guide

## OVERVIEW

Machine-wide broker that queues CPU-heavy developer processes from every worktree behind one slot budget. Score: 10. Distinct cross-worktree coordination domain used by root configs and QA tools.
Follow the [root guide](../../AGENTS.md) for shared rules. `README.md` documents classes, environment variables, and troubleshooting.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Public API | `src/index.ts` | `acquire`, `decide`, `readStatus`, `Store`, errors, classes |
| Lease acquisition and inheritance | `src/acquire.ts` | `AIRI_CPU_LEASE` reuse, `assertShareable` |
| Pure grant rule | `src/grant.ts` | FIFO by ticket sequence with one wait reason |
| Store transactions and reclamation | `src/store.ts` | Directory lock, adopt, withdraw, snapshots |
| Process lookup | `src/processes.ts`, `src/liveness.ts` | PowerShell snapshots with timeouts |
| Class bounds and budget | `src/classes.ts`, `src/budget.ts` | Default budget 12 |
| CLI and status | `src/cli.ts`, `src/status.ts`, `src/win32-command.ts` | Root `pnpm slots` runs `src/cli.ts` |
| Vitest wrapper | `src/vitest.ts`, `src/stale-build.ts`, `tsdown.config.ts` | Built `/vitest` subpath with source hash |
| Tests | `test/` | Store, acquire, CLI, wrapper, file replacement |

## CONVENTIONS

- The root export resolves to source. The `/vitest` export resolves to built `dist/vitest.mjs`.
- `decide(state, budget)` stays pure. Process lookups never run while the store lock is held.
- Every store mutation runs in one transaction. A grant is written, checked again, and removed if the check fails.
- A failed process lookup proves nothing. Report it as `snapshot-failed` and retry.
- A lease is reclaimed only after its owner's death is observed and a later snapshot shows the workload is gone.
- One `acquire` call uses one id for its tickets and its lease.
- Child processes reuse an inherited lease and never release the parent's lease.
- The build stages output under `node_modules/.cache/dist-<pid>/` and renames files over `dist/`. It never cleans `dist/` directly.
- Editing this package's `README.md` invalidates every Turbo typecheck task, so expect a full typecheck after it.

## ANTI-PATTERNS

- Do not bypass `StaleBuildError`. Run `pnpm -F @proj-airi/cpu-slots build` instead.
- Do not delete the lock directory or store files unless the owner is confirmed dead.
- Do not use the broker as an operating-system quota, for long-running dev servers, or across machines.
- Do not request an `exclusive` lease under a shared lease. It fails with `exclusive-under-shared`.

## CHECKS

- Typecheck: `pnpm -F @proj-airi/cpu-slots typecheck`.
- Tests run as a project of the root Vitest config: `pnpm exec vitest run packages/cpu-slots`.
- Build after changing `src/vitest.ts` or its imports: `pnpm -F @proj-airi/cpu-slots build`.
- Inspect live state: `pnpm slots status`.
