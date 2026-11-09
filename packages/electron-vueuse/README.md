# @proj-airi/electron-vueuse

VueUse-like composables and helpers shared across AIRI Electron apps.

## What it provides

- Renderer composables for common Electron behaviors (`mouse`, `window bounds`, `auto updater`, etc.)
- A reusable Eventa context/invoke pattern (`useElectronEventaContext`, `useElectronEventaInvoke`)
- Eventa context/invoke ergonomics for renderer code
- Main-process loop utilities (`useLoop`, `createRendererLoop`)

For IPC contract definitions, use `@proj-airi/electron-eventa`.

`useElectronAllDisplays` starts empty and refreshes every 5 seconds. It keeps the last completed display snapshot while
the next IPC response is pending, so a refresh never appears to consumers as a temporary display removal.

`useElectronCursorAvailable()` reports whether a trusted screen cursor has arrived.
It starts false and becomes false again when the host withholds a reading.
Mouse coordinates retain their last trusted values without dispatching a synthetic move to zero.
`useElectronWindowBounds()` keeps its numeric defaults at zero and exposes `available`,
which becomes true only after its first bounds event. A real zero origin is valid;
the numeric value alone does not establish that a reading has arrived.
`useElectronRelativeMouse().available` requires both an available cursor and received
window bounds. Consumers must check it before treating relative coordinates as current
host input, and must still check the host capability snapshot for origin trust.

`useElectronMouseInElement()` uses DOM pointer events for `isOutside` hit-testing
while the trusted Electron cursor or the first window bounds are unavailable. This fallback supports UI
hover behavior only. It does not make DOM coordinates trusted desktop input or
feed them to presence and motion resolution.
Without a native reading or a delivered DOM entry/move, `isOutside` stays true:
unknown cursor state never establishes hover. DOM exit clears that fallback
even while native hit-testing is authoritative.

## Usage

```ts
import { electron } from '@proj-airi/electron-eventa'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

const openSettings = useElectronEventaInvoke(electron.window.getBounds)
```

```ts
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
```
