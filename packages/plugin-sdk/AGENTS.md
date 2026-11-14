# Plugin SDK

## CONVENTIONS
- The host accepts Manifest v2 only.
- Extension package roots contain `extension.airi.json`.
- Kit providers declare exact semantic versions. Kit consumers declare version ranges.
- `defineExtension` IDs must match their manifests.
- Extension authors normally use `ctx.kits.use(...)`. Module scopes add lifecycle and contribution attribution.
- Shared Eventa contracts define remote kit APIs. Local and remote clients expose the same authoring shape.
- Host boundary values use serializable JSON-like data.
- Package `dev` builds once. It is not a persistent host.

## ANTI-PATTERNS
- Do not add kit-specific RPC protocols or transport names to author APIs.
- Module permissions must not widen manifest requests or host grants.
- Do not accept unsafe IDs, unknown manifest fields, or missing runtime entrypoints.
- Do not treat design proposals or empty local/remote setup functions as implemented runtime behavior.
- Keep Node loaders out of web runtime entrypoints.
