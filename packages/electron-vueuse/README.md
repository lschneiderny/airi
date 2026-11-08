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
`useElectronRelativeMouse()` also returns this ref as `available`. Consumers must use it
before treating cached coordinates as current host input.

## Usage

```ts
import { electron } from '@proj-airi/electron-eventa'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

const openSettings = useElectronEventaInvoke(electron.window.getBounds)
```

```ts
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
```
