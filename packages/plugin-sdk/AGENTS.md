# Plugin SDK

## OVERVIEW
Runtime-neutral extension authoring and host lifecycle. Score: 8, with conditional Node/web host exports and strict manifest boundaries.

Parent guidance: [root AGENTS.md](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Extension setup and module scopes | `src/extension/` |
| Kit authoring | `src/kit/` |
| Host lifecycle | `src/plugin-host/core.ts` |
| Activation graph and restart closure | `src/plugin-host/activation-plan.ts` |
| Manifest and boundary schemas | `src/plugin-host/shared/` |
| Runtime-specific loaders and adapters | `src/plugin-host/runtimes/` |
| Permission, kit, binding services | `src/plugin-host/runtimes/shared/services/` |
| Client APIs and transport scopes | `src/plugin/apis/`, `src/channels/` |
| Architecture proposals | `docs/design/` |

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

## CHECKS
- `pnpm -F @proj-airi/plugin-sdk typecheck`
- `pnpm -F @proj-airi/plugin-sdk exec vitest run`
- `pnpm -F @proj-airi/plugin-sdk build`
- Follow the root TypeScript and Vitest task routing before implementation changes.
