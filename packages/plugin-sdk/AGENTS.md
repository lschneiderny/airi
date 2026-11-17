# Plugin SDK

## CONVENTIONS
- Host boundary values use serializable JSON-like data.

## ANTI-PATTERNS
- Module permissions must not widen manifest requests or host grants.
- Do not treat design proposals or empty local/remote setup functions as implemented runtime behavior.
- Keep Node loaders out of web runtime entrypoints.
