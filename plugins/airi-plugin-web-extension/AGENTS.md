# Web context extension

## CONVENTIONS
- This is the AIRI context extension, not the computer-use service's observation extension.
- Browser runtime messaging carries Eventa invocation contracts with per-instance source IDs.
- Context updates use `ReplaceSelf` and separate `web:page`, `web:video`, and `web:subtitle` lanes.
- Popup state uses VueUse global state and localStorage, not Pinia.
- Typecheck with `compile`, not `typecheck`.
- WXT generates `.wxt/tsconfig.json`. `postinstall` runs `wxt prepare`.

## ANTI-PATTERNS
- Do not conflate popup localStorage with background browser storage. They currently use different settings keys.
- Do not place source changes or guidance in `.wxt` build output.
- Do not enable vision or broaden host permissions as an incidental context-capture change.
- Preserve observer/timer cleanup and subtitle deduplication when changing content collection.
