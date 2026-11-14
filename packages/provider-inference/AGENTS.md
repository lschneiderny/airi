# Provider Inference

## CONVENTIONS
- `defineProvider` returns a definition without registration side effects.
- Registries reject duplicate IDs and provide deterministic ordering.
- Browser-only providers must import safely in Node and report unavailable capabilities.
- Hosts supply Sherpaw resources, Worker URLs, fetch, language, and mobile status.
- Endpoint model lists determine availability. Pinned catalogs enrich exact matches on matching official endpoints.
- Provider definitions own protocol defaults and native tools.
- Existing provider configuration schemas use Zod. This is not a package-wide schema migration instruction.
- The extraction document (`docs/provider-inference-extraction-phase-1-spec.md`) is a proposal, not evidence that every acceptance requirement is complete.

## ANTI-PATTERNS
- Keep persistence, Vue views, Pinia state, authentication, and Electron-native providers in stage-ui.
- Do not infer hosted search support from model names or custom endpoints.
- Do not replace credential refusals with populated fallback selectors.
- Do not invent probe models. Use the configured model before endpoint discovery.
- Apply primitive `anyOf` conversion only in adapters with evidence of provider rejection.
- Abort must discard discovery side effects and release recognition Workers.

## CHECKS
- Node/browser matrix tests do not prove live provider API behavior.
