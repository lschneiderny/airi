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
