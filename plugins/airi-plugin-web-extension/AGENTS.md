# Web context extension

## OVERVIEW
WXT extension sending page, video, subtitle, and optional vision context to AIRI. Score: 8. Follow the [root guide](../../AGENTS.md).

## WHERE TO LOOK
| Task | Location |
| --- | --- |
| Background lifecycle and reconnect | `entrypoints/background.ts` |
| Content-script entry | `entrypoints/content.ts` |
| DOM, video, subtitle observation | `src/content/index.ts` |
| AIRI connection and context lanes | `src/background/client.ts` |
| Persisted settings | `src/background/storage.ts`, `src/shared/constants.ts` |
| Eventa contracts and runtime transport | `src/shared/eventa.ts`, `src/shared/eventa-runtime.ts` |
| Payload shapes and supported sites | `src/shared/types.ts`, `src/shared/sites.ts` |
| Popup controls and state | `entrypoints/popup/`, `src/popup/` |
| Browser permissions and build | `wxt.config.ts` |

## CONVENTIONS
- This is the AIRI context extension, not the computer-use service's observation extension.
- Browser runtime messaging carries Eventa invocation contracts with per-instance source IDs.
- Context updates use `ReplaceSelf` and separate `web:page`, `web:video`, and `web:subtitle` lanes.
- Popup state uses VueUse global state and localStorage, not Pinia.
- Defaults enable context/subtitle notifications and disable vision capture.
- Default AIRI endpoint is `ws://localhost:6121/ws`.
- Use `pnpm -F @proj-airi/airi-plugin-web-extension dev` or `build`.
- Firefox variants are `dev:firefox` and `build:firefox`. Typecheck with `compile`, not `typecheck`.
- WXT generates `.wxt/tsconfig.json`. `postinstall` runs `wxt prepare`.

## ANTI-PATTERNS
- Do not conflate popup localStorage with background browser storage. They currently use different settings keys.
- Do not place source changes or guidance in `.wxt` build output.
- Do not enable vision or broaden host permissions as an incidental context-capture change.
- Preserve observer/timer cleanup and subtitle deduplication when changing content collection.
