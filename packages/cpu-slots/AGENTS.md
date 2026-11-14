# CPU Slots

## CONVENTIONS

- The root export resolves to source. The `/vitest` export resolves to built `dist/vitest.mjs`.
- `decide(state, budget, now, pressure?)` stays pure. Pass ticket age and any CPU pressure sample as data; process lookups never run while the store lock is held.
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
- App sessions use the `live` class. Reserve `exclusive` for frame-timing work that must not share CPU.

## CHECKS

- Tests run as a project of the root Vitest config: `pnpm exec vitest run packages/cpu-slots`.
- Build after changing `src/vitest.ts` or its imports: `pnpm -F @proj-airi/cpu-slots build`.
