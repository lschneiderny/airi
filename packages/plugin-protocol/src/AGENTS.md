# Plugin Protocol Source Guide

## OVERVIEW

Central Eventa wire contracts for peers, extensions, permissions, assets, and delivery. Score: 8. Distinct public contract.
Follow the [root guide](../../../AGENTS.md) for shared rules and task skills.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Public contracts | `types/events.ts` | Payloads, constants, metadata, event map |
| Export entry | `types/index.ts` | Built as the `/types` subpath |
| Contract tests | `types/events.test.ts` | Authentication and announcement metadata |
| Root entry warning | `index.ts` | No public exports |

## CONVENTIONS

- Consumers import `@proj-airi/plugin-protocol/types`, not the empty package root.
- Contracts use Eventa definitions and typed protocol metadata.
- `ProtocolEvents` and `ProtocolEventOf` connect event names to payloads.
- Input text and voice events use first-consumer delivery in the `chat-ingestion` group.
- Actual grants can be narrower than declarations or requested permissions.
- Permission requests trigger evaluation, not access confirmation.
- Registry and health events describe peer discovery and availability.

## ANTI-PATTERNS

- Do not grant access from declared permissions before current grants reflect it.
- Do not treat permission-denial `reason` text as a stable error code.
- Do not discover peers by waiting for `module:announce`.
- Use `module:announced`, `module:de-announced`, and registry synchronization instead.
- Do not put high-frequency telemetry or large blobs in Spark notifications.
- Do not assume exactly-once Spark delivery or trust unauthenticated broadcasts.
- Chat attachments reference `airi-asset:<id>`, not inline image or audio bytes.
- Asset responses link their parent request through response metadata.

## CHECKS

- Typecheck: `pnpm -F @proj-airi/plugin-protocol typecheck`.
- Tests: `pnpm -F @proj-airi/plugin-protocol exec vitest run`.
