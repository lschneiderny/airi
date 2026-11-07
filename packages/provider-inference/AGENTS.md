# Provider Inference

## OVERVIEW
Runtime-neutral provider definitions, protocols, catalogs, and validation. Score: 8, with built exports and Node/browser contracts.

Parent guidance: [root AGENTS.md](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Public contracts and protocols | `src/types.ts`, `src/generation.ts` |
| Explicit provider registration | `src/providers/index.ts`, `src/providers/registry.ts` |
| Cloud and local implementations | `src/providers/cloud/`, `src/providers/local/` |
| Probe planning and execution | `src/validators/` |
| Sherpaw metadata and recognition | `src/providers/local/sherpaw-transcription/` |
| Extraction proposal | `docs/provider-inference-extraction-phase-1-spec.md` |

## CONVENTIONS
- `defineProvider` returns a definition without registration side effects.
- Registries reject duplicate IDs and provide deterministic ordering.
- Browser-only providers must import safely in Node and report unavailable capabilities.
- Hosts supply Sherpaw resources, Worker URLs, fetch, language, and mobile status.
- Endpoint model lists determine availability. Pinned catalogs enrich exact matches on matching official endpoints.
- Provider definitions own protocol defaults and native tools.
- Existing provider configuration schemas use Zod. This is not a package-wide schema migration instruction.
- The extraction document is a proposal, not evidence that every acceptance requirement is complete.

## ANTI-PATTERNS
- Keep persistence, Vue views, Pinia state, authentication, and Electron-native providers in stage-ui.
- Do not infer hosted search support from model names or custom endpoints.
- Do not replace credential refusals with populated fallback selectors.
- Do not invent probe models. Use the configured model before endpoint discovery.
- Apply primitive `anyOf` conversion only in adapters with evidence of provider rejection.
- Abort must discard discovery side effects and release recognition Workers.

## CHECKS
- `pnpm -F @proj-airi/provider-inference typecheck`
- `pnpm -F @proj-airi/provider-inference test:node`
- `pnpm -F @proj-airi/provider-inference test:browser`
- `pnpm -F @proj-airi/provider-inference build`
- Node/browser matrix tests do not prove live provider API behavior.
