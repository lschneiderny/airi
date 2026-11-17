# Server Guide

## Conventions
- Use Valibot for HTTP data, Pub/Sub messages, queue jobs, WebSocket events, database JSON, and provider responses.
- Define each schema beside the contract owner.
- Use `parse` when the caller converts invalid data into an error.
- Use `safeParse` when the caller branches on valid and invalid data.
- Infer TypeScript types from schemas.
- Keep API and Auth composition roots independent. Neither app imports the other's service graph.
- Keep `auth-shared` free of routes, environments, database pools, Redis, email, and telemetry.

## Architecture decisions
- Create or update the ADR before changing HTTP, provider, persistence, or cross-module lifecycle boundaries.
- Include a module dependency graph, affected-file tree, and sequence diagram in every implementation ADR.
- State the decision, scope, non-goals, and test plan.
- Mark an ADR `accepted` only after the decision is confirmed.
- Update the ADR when implementation changes the accepted design.

## Anti-patterns
- Do not substitute `typeof`, `Record<string, unknown>`, or casts for runtime input validation.
- Do not duplicate schema-derived contracts in interfaces.
- Do not infer current schema ownership from historical Drizzle snapshots.

## Operations
- Read `README.md` before deployment operations.
