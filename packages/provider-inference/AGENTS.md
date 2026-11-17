# Provider Inference

## CONVENTIONS
- `defineProvider` returns a definition without registration side effects.
- Existing provider configuration schemas use Zod. This is not a package-wide schema migration instruction.
- The extraction document (`docs/provider-inference-extraction-phase-1-spec.md`) is a proposal, not evidence that every acceptance requirement is complete.

## ANTI-PATTERNS
- Do not replace credential refusals with populated fallback selectors.
- Do not invent probe models.
- Apply primitive `anyOf` conversion only in adapters with evidence of provider rejection.
- Abort must discard discovery side effects and release recognition Workers.

## CHECKS
- Node/browser matrix tests do not prove live provider API behavior.
