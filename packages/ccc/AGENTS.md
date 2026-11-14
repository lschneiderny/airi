# Character Card Codec

## CONVENTIONS
- Parse decoded JSON values or JSON text through `parseCharacterCardV3`.
- Malformed JSON and invalid structures throw `InvalidCharacterCardError`.
- Compatibility classification is `older`, `current`, or `newer`, relative to specification version 3.0.
- Unknown fields remain intact after validation.
- Older and newer CCv3 version values remain importable.
- This supported public data policy overrides the root rule against backward-compatibility guards for the CCv3 codec.
- JSON exports use `chara_card_v3` and `3.0`.
- PNG exports store base64 JSON under `ccv3`.
- Vitest includes `test/**/*.test.ts`, not source-adjacent tests.

## ANTI-PATTERNS
- Do not add active-card state, local persistence, module settings, or editor policy.
- Do not construct provider messages or apply Lorebook policy here.
- Do not strip unknown fields while validating community cards.
- Do not infer implemented APNG or Markdown behavior from exported placeholder functions.
