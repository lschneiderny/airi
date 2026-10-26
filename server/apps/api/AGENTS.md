# API Server Guide

## Overview
Hono resource API for billing, chat, generation forwarding, and observability. Score: 12. Separate composition and persistence ownership justify this guide.

Follow the [server guide](../../AGENTS.md) for validation and ADR rules.

## Structure
- `src/routes/`: HTTP and WebSocket boundaries.
- `src/services/domain/`: business logic and transactions.
- `src/services/adapters/`: providers, storage, configuration, external integrations.
- `src/schemas/`: Drizzle tables. `drizzle/` contains startup migrations and historical metadata.
- `src/libs/`: environment, database, authentication, test infrastructure.
- `src/otel/`: metric bundles and collection callbacks.
- `src/utils/`: encryption, errors, Redis keys, origins, broadcast contracts.

## Where to look
| Task | Location under `src/` | Notes |
| --- | --- | --- |
| Startup and DI | `main.ts`, `server.ts`, `app.ts` | `runApiServer` calls `createApp`, which wires `buildApp` |
| Wallet writes | `services/domain/billing/` | Atomic balance, usage, ledger, capacitor settlement |
| Wallet display | `services/domain/flux.ts`, `flux-cache.ts` | Validated 60-second snapshots, not admission authority |
| Provider dispatch | `services/domain/llm-router/` | Retries, encrypted keys, attempts, distributed capacity |
| Protocol serialization | `services/adapters/llm/` | Chat Completions and Responses wire adapters |
| Speech | `services/adapters/tts/`, `services/domain/openai-speech/` | Azure, DashScope, StepFun, Volcengine through unspeech |
| OpenAI surface | `routes/openai/v1/` | Keep AIRI voice/model extensions under `/api/v1/audio` |
| Chat transport | `routes/chat-ws/` | Local connection registry and Redis fanout |
| Field revisions | `services/domain/field-sync/`, `character-cards.ts` | Shared algorithm, feature-owned schemas and limits |
| Payments | `services/domain/payment/`, `routes/{stripe,apple-iap,revenuecat}/` | Signed receipts, idempotent grants, entitlements |
| Diagnostics | `services/domain/request-log.ts`, `request-content.ts` | Strips inline media, caps content at 8 MiB, five-second error-body deadline |
| Product analytics | `services/domain/product-events.ts` | Best-effort writer; capture errors never change business flow; no PII or raw prompts |
| Account cleanup | `services/domain/user-deletion/`, `routes/internal-auth.ts` | Idempotent handlers and private Auth calls |

## Conventions
- Design for multiple Railway replicas sharing PostgreSQL and Redis.
- PostgreSQL owns business truth. Redis owns caches, Pub/Sub, and distributed coordination.
- Keep routes thin: validation, guards, error mapping. Services own business logic and transactions.
- Billing owns wallet mutations and matching ledger writes in one PostgreSQL transaction, never `flux.ts`.
- `postFluxUsage` owns debits. One Flux equals 1,000,000 micro-Flux. Preserve usage-source idempotency.
- Admission reads PostgreSQL. Missing provider cost stays pending, without token-price fallback.
- Persist dispatch attempts before upstream calls. Persistence failure stops dispatch rather than triggering fallback.
- Wipe decrypted key buffers after use. Never skip a key decryption failure.
- Initialize telemetry through `instrumentation.ts` before application modules.
- Register WebSockets and live transcription before session/body-limit middleware.
- Default bodies allow 1 MiB. Authenticated Responses requests have a separate 40 MiB allowance.
- Liveness avoids external probes. Readiness checks PostgreSQL and Redis, not provider credentials.
- Session middleware fills nullable JWT identity. `authGuard` rejects anonymous calls. Better Auth belongs to Auth.
- Rate limits are process-local, not distributed.
- `ApiError` in `utils/error.ts` owns client error envelopes. Keep upstream bodies and secrets out of gateway details.

## Public transport policy
- This overrides the root **Backward Compatibility** ban only for existing deployed chat transport contracts.
- Preserve `/ws/chat` query-token authentication and beta.13 envelopes accepted by the beta.15 Eventa adapter.
- `/ws/v2/chat` authenticates after upgrade. Preserve anonymous frame limits, deadlines, and disconnect cleanup.
- This supported policy does not authorize new compatibility guards elsewhere.

## Anti-patterns
- No background business polling, independent fire-and-forget business writes, or asynchronous billing pipeline.
- No authoritative cross-request business state in one process. Derived caches and local socket registries are not business truth.
- Do not debit failed or incomplete generations. Keep request-owned stream cleanup and settlement attached to the request lifecycle.
- Do not share request telemetry context or use user IDs as metric labels.
- Do not sum replicated cluster gauges. Use average for pool inflight and maximum or average for online users.
- Never treat decoded Apple claims as authorization or grant Sandbox purchases outside dedicated allowlisted accounts.
- Do not log plaintext provider keys or put secrets in synced card JSON.

## Commands
```sh
pnpm -F @proj-airi/api-server dev
pnpm -F @proj-airi/api-server typecheck
pnpm -F @proj-airi/api-server exec vitest run
pnpm -F @proj-airi/api-server build
pnpm -F @proj-airi/api-server db:generate
pnpm -F @proj-airi/api-server db:push
```
Local observability lives in `proj-airi/airi-railway`, under `otel/docker-compose.yaml`.
