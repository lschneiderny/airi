# Server Guide

## Conventions
- Read `apps/api/AGENTS.md` before changing business services.
- Read `apps/auth/AGENTS.md` before changing account lifecycle.
- Use Valibot for HTTP data, Pub/Sub messages, queue jobs, WebSocket events, database JSON, and provider responses.
- Define each schema beside the contract owner.
- Use `parse` when the caller converts invalid data into an error.
- Use `safeParse` when the caller branches on valid and invalid data.
- Infer TypeScript types from schemas.
- Keep API and Auth composition roots independent. Neither app imports the other's service graph.
- API owns shared migrations. Auth startup never runs them.
- Keep `auth-shared` free of routes, environments, database pools, Redis, email, and telemetry.

## Architecture decisions
- Put server ADRs in `server/docs/ai/adr/`, relative to the repository root.
- Create or update the ADR before changing HTTP, provider, persistence, or cross-module lifecycle boundaries.
- Include a module dependency graph, affected-file tree, and sequence diagram in every implementation ADR.
- State the decision, scope, non-goals, and test plan.
- Mark an ADR `accepted` only after the decision is confirmed.
- Update the ADR when implementation changes the accepted design.
- Include ADRs in related commits and pull requests.

## Anti-patterns
- Do not substitute `typeof`, `Record<string, unknown>`, or casts for runtime input validation.
- Do not duplicate schema-derived contracts in interfaces.
- Never expose `/internal/*` through the public edge.
- Do not infer current schema ownership from historical Drizzle snapshots.
- Do not merge into shared test branches. `server-dev` is retired as a deploy source.

## Commands and operations
- Local stack: `pnpm dev:backend`.
- Auth schema generation: `pnpm -F @proj-airi/auth-server auth:generate`.
- Follow app guides for package-scoped tests and typechecks.
- Shared development database resets destroy development writes and leave Redis intact. Read `README.md` before deployment operations.
