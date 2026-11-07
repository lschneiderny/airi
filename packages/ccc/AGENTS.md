# Character Card Codec

## OVERVIEW
Runtime-neutral Character Card protocol primitives. Score: 8, with a public codec boundary and separate protocol tests.

Parent guidance: [root AGENTS.md](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Public exports | `src/index.ts` |
| CCv3 parsing and compatibility | `src/codec/characterCardV3.ts` |
| Card construction | `src/define/` |
| JSON and PNG export | `src/export/` |
| Text construction helpers | `src/utils/` |
| Protocol regression tests | `test/` |

## CONVENTIONS
- Parse decoded JSON values or JSON text through `parseCharacterCardV3`.
- Malformed JSON and invalid structures throw `InvalidCharacterCardError`.
- Compatibility classification is `older`, `current`, or `newer`, relative to specification version 3.0.
- Unknown fields remain intact after validation.
- Older and newer CCv3 version values remain importable.
- This supported public data policy overrides the root rule against backward-compatibility guards for the CCv3 codec.
- JSON exports use `chara_card_v3` and `3.0`.
- PNG exports store base64 JSON under `ccv3`.
- Follow the root TypeScript and Vitest task routing.

## ANTI-PATTERNS
- Do not add active-card state, local persistence, module settings, or editor policy.
- Do not construct provider messages or apply Lorebook policy here.
- Do not strip unknown fields while validating community cards.
- Do not infer implemented APNG or Markdown behavior from exported placeholder functions.

## CHECKS
- `pnpm -F @proj-airi/ccc typecheck`
- `pnpm -F @proj-airi/ccc test`
- `pnpm -F @proj-airi/ccc lint`
- Vitest includes `test/**/*.test.ts`, not source-adjacent tests.
