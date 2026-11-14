# Auth Server Guide

## Conventions
- Auth owns Better Auth, OIDC, sessions, email, social authorization, and identity deletion.
- Keep billing, chat, model routing, and business WebSockets in the resource API.
- Reach the resource API through private HTTP calls in `src/resource-api.ts`, never API module imports.
- Use neutral tables and principal contracts from `@proj-airi/auth-shared`.
- API owns shared migrations. This process only connects to the resulting schema.
- Schema generation (`src/tooling/auth-config.ts`) writes `../../packages/auth-shared/src/schema.ts`.
- Preload `instrumentation.ts` before runtime modules. Keep static `pg` imports for instrumentation.
- Public first-party clients require PKCE and seed into PostgreSQL.
- Keep `cachedTrustedClients` disabled while redirects can mutate.
- Keep session cookie caching disabled until its documented logout workaround can be removed.
- Verify JWT signature, issuer, audience, claims, and current user bans before accepting identity.
- Read JWKS locally from PostgreSQL rather than fetching this service's own HTTP endpoint.
- Request-only JWT identity uses epoch session timestamps. It cannot appear freshly signed in.
- Sensitive operations require the active original persisted session. JWT refresh does not renew sign-in time.
- Account deletion checks subscriptions, revokes external authorization, then cleans resources before deleting identity.
- Refusals preserve authorization. Cleanup failures leave accounts available for retry.
- Ban enforcement in `src/plugins/ban-guard.ts` must preserve concurrent ban changes.
- Email changes require confirmation at the current address.
- Requested email delivery fails visibly when delivery configuration is missing.
- Trust proxy address headers only under explicit deployment ownership.

## Anti-patterns
- Never import the API service graph or run its migrations.
- Do not accept native URI schemes as browser callback origins.
- Do not expose `lastSeenAt` as client input or clear ban expiry during a read.
- Do not delete accounts when an external revocation provider is unsupported.
- Do not let JWT issue time replace persisted-session freshness.
- Do not leak Steam Web API URLs or keys in errors.
- Do not let analytics failures break signup or login.
- Keep the Steam plugin's documented Zod introspection workaround limited to Better Auth endpoint schema generation.

## Commands
```sh
pnpm -F @proj-airi/auth-server auth:generate
```
Tests use one worker without file parallelism. `/livez` avoids dependency probes and `/readyz` checks Redis and Auth tables.
