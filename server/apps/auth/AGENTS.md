# Auth Server Guide

## Conventions
- Preload `instrumentation.ts` before runtime modules. Keep static `pg` imports for instrumentation.
- Public first-party clients require PKCE and seed into PostgreSQL.
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
- `/livez` avoids dependency probes and `/readyz` checks Redis and Auth tables.

## Anti-patterns
- Do not accept native URI schemes as browser callback origins.
- Do not expose `lastSeenAt` as client input or clear ban expiry during a read.
- Do not delete accounts when an external revocation provider is unsupported.
- Do not let JWT issue time replace persisted-session freshness.
- Do not leak Steam Web API URLs or keys in errors.
- Do not let analytics failures break signup or login.
- Keep the Steam plugin's documented Zod introspection workaround limited to Better Auth endpoint schema generation.
