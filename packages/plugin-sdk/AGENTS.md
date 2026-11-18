# Plugin SDK

## CONVENTIONS
- Host boundary values use serializable JSON-like data.
- `injeca` is the lifecycle runtime here: plugin sessions are child containers, and Kit Providers are injeca units. The root rule that limits `injeca` to external boundaries does not forbid this use.

## ANTI-PATTERNS
- Module permissions must not widen manifest requests or host grants.
- Do not treat design proposals or empty local/remote setup functions as implemented runtime behavior.
- Keep Node loaders out of web runtime entrypoints.
