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

## Usage

```ts
import { electron } from '@proj-airi/electron-eventa'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

const openSettings = useElectronEventaInvoke(electron.window.getBounds)
```

```ts
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
```
