# Electron VueUse

## CONVENTIONS

- IPC contracts belong to `@proj-airi/electron-eventa`.
- Renderer context resolves an explicit IPC renderer or `window.electron.ipcRenderer`.
- Context creation is lazy and shared across composables.
- Relative mouse coordinates compose screen mouse state with current window bounds.
- Main loops use clock intervals rather than Vue mounting scope.
- Renderer loops start when visible, pause when hidden, and stop when the renderer disappears.
- Package builds emit separate root and `/main` ESM entries.
- No package test script is declared. Validate changed tracking behavior in its Electron consumer.

## ANTI-PATTERNS

- Do not move main-only Electron code into renderer entry exports.
- Do not create separate contexts for every display, mouse, or bounds composable.
- Do not overlap asynchronous loop updates.
- Do not keep updating a destroyed or crashed renderer.
