# @proj-airi/cpu-slots

## Purpose

CPU slot budgeting for AIRI developer tools. This package currently provides the
slot classes, budget parser, and pure FIFO grant rule. It has no dependencies.

## Usage

Run TypeScript consumers with `tsx`. Import `classes`, `parseBudget`, and `decide`
from `@proj-airi/cpu-slots`. `parseBudget()` reads `AIRI_CPU_BUDGET`, defaulting to
12; a supplied value must be a positive safe integer.

`decide(state, budget)` takes already-pruned leases and tickets and returns one
grant for the lowest ticket sequence or a wait reason. It does not mutate state,
read the environment, or access the filesystem. Exclusive requests take the whole
budget; their class bounds use `Infinity` and are clamped to that budget.

## When to use

Use these primitives to decide how many workers a queued developer task can use.
The store, acquisition API, and Vitest integration are separate implementation
steps; this package does not yet coordinate running processes.

## When not to use

Do not use it to limit long-running development servers or as an operating-system
CPU quota.

## Vitest entry

`@proj-airi/cpu-slots/vitest` resolves to a bundled `dist/vitest.mjs` built by `tsdown` (`pnpm -F @proj-airi/cpu-slots build`, also part of `pnpm build:packages`, which runs after install). Vite externalizes the package when it loads a vitest config, so Node imports the entry natively and cannot resolve the extension-less relative imports of `src/`; the bundle inlines them. Everything else, including the CLI, the tests, and the `.` export, runs from `src/`.

An interactive bare `vitest` acquires its lease at startup, so it can queue behind other runs, and releases it as soon as Vitest resolves to watch mode. `vitest --watch` takes no lease and caps workers at the grant a free store would give.

`dist/vitest.mjs` records a hash of the sources it bundles and fails the config load with a stale-build error when they change, because only the post-install build and `turbo` (typecheck depends on the cpu-slots build) rebuild it.
