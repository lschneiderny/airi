# Plugin protocol

## CONVENTIONS

- Actual grants can be narrower than declarations or requested permissions.
- Permission requests trigger evaluation, not access confirmation.

## ANTI-PATTERNS

- Do not grant access from declared permissions before current grants reflect it.
- Do not treat permission-denial `reason` text as a stable error code.
- Do not discover peers by waiting for `module:announce`.
- Use `module:announced`, `module:de-announced`, and registry synchronization instead.
- Do not put high-frequency telemetry or large blobs in Spark notifications.
- Do not assume exactly-once Spark delivery or trust unauthenticated broadcasts.
- Chat attachments reference `airi-asset:<id>`, not inline image or audio bytes.
