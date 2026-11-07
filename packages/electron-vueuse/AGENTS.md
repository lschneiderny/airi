# Electron VueUse Guide

## OVERVIEW

Renderer composables and main-process loops over shared Electron Eventa contracts. Score: 9. Distinct process-adapter boundary.
Follow the [root guide](../../AGENTS.md) for shared rules and task skills.

## WHERE TO LOOK

| Task | Location | Notes |
| --- | --- | --- |
| Renderer API | `src/index.ts` | Displays, updater, mouse, bounds, resize |
| Shared Eventa context | `src/composables/use-electron-eventa-context.ts` | Lazy context and typed invokes |
| Screen mouse | `src/composables/use-electron-mouse.ts` | Shared tracking |
| Coordinate conversion | `src/composables/use-electron-relative-mouse.ts` | Composes mouse and window bounds |
| Bounds tracking | `src/composables/use-electron-window-bounds.ts` | Module-owned initialization |
| Main API | `src/main/index.ts` | Separate process entry |
| Timer loop | `src/main/loop.ts` | Mutex prevents overlapping updates |
| Renderer lifecycle loop | `src/main/renderer-loop.ts` | Visibility, disposal, crashes |

## CONVENTIONS

- IPC contracts belong to `@proj-airi/electron-eventa`.
- Renderer context resolves an explicit IPC renderer or `window.electron.ipcRenderer`.
- Context creation is lazy and shared across composables.
- Relative mouse coordinates compose screen mouse state with current window bounds.
- Main loops use clock intervals rather than Vue mounting scope.
- Renderer loops start when visible, pause when hidden, and stop when the renderer disappears.
- Package builds emit separate root and `/main` ESM entries.

## ANTI-PATTERNS

- Do not move main-only Electron code into renderer entry exports.
- Do not create separate contexts for every display, mouse, or bounds composable.
- Do not overlap asynchronous loop updates.
- Do not keep updating a destroyed or crashed renderer.

## CHECKS

- Typecheck: `pnpm -F @proj-airi/electron-vueuse typecheck`.
- Build: `pnpm -F @proj-airi/electron-vueuse build`.
- No package test script is declared. Validate changed tracking behavior in its Electron consumer.
