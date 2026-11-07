# Electron Capture Scenarios Guide

## OVERVIEW

Product-specific Vishot flows and raw screenshots for the desktop app. Score: 10. Distinct automation boundary.
Follow the [root guide](../../AGENTS.md) for TypeScript and test skill routing.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Public scenario API | `src/index.ts` | Scenarios, model input, gesture types |
| Scenario context | `src/runtime/` | Selectors, windows, settings, overlays, gestures |
| Product flows | `src/scenarios/` | Widgets, plugins, models, capture sequences |
| Manual walkthrough | `src/scenarios/demo-controls-settings-chat-websocket/` | Sections and capture manifest |
| File model import | `src/scenarios/display-model-from-file.ts` | Upload, selection, state restoration |

## CONVENTIONS

- Generic scenario loading and capture belong to `@vishot/source-electron`.
- This package owns Electron product flows, not app launching or browser composition.
- Scenarios share the stage-tamagotchi context and can use Chromium CDP touch input.
- Capture readiness must distinguish the requested page from its predecessor.
- Vision readiness needs a unique `/devtools/vision` signal.
- Data-page readiness uses `Open app data folder`, not generic chat/open text.
- Consciousness description readiness depends on predecessor order. Recheck it when the sequence changes.

## ANTI-PATTERNS

- Do not publish docs directly from this package.
- Do not match widgets with a substring that also accepts devtools routes.
- Widget asset checks require HTTP loopback extension-session UI paths.
- Do not accept the old `t` authentication query parameter in widget asset checks.
- Restore persisted settings and remove imported model fixtures after capture.
- Do not label a screenshot from the preceding page as a successful capture.

## CHECKS

- Unit tests: `pnpm -F @proj-airi/scenarios-stage-tamagotchi-electron test:run`.
- Typecheck: `pnpm -F @proj-airi/scenarios-stage-tamagotchi-electron typecheck`.
- Build the desktop app before capture. See `README.md` for Vishot entrypoint and output arguments.
