# `@proj-airi/stage-shared`

Shared contracts and runtime-neutral helpers for AIRI stage applications and UI packages.

## Use this package

Use this package when a type or behavior must cross stage application boundaries without depending on Electron, browser-only code, or a feature UI package.

The `plugin-host` entrypoint owns the serializable Plugin Host snapshots exchanged between the Electron main process and shared renderer code:

```ts
import type { PluginHostDebugSnapshot } from '@proj-airi/stage-shared/plugin-host'
```

The `model-assets` entrypoint owns model file manifests, download status, and
the storage adapter contract. Use a platform adapter to store and open files.
It does not own a recognizer or Worker.

### Performance state

The `performance-state` entrypoint owns the performance-state contract and its pure resolver.
A `PerformanceState` says what the character is doing as a performer: its `mode` (`talking`, `listening`, `thinking`, `watching`, or `idle`), its `attention` (`camera`, `screen`, or `cursor`), whether the user is `away`, and a reaction sequence (`reactSeq` and `reactKind`) for wakes and sharp screen changes.
The Live2D Natural motion driver reads it.

Call `resolvePerformanceState` with the current inputs and the memory that the previous call returned. Start from `initialResolverMemory`.
The resolver never reads a clock: pass epoch milliseconds in `nowMs`.
Resolve again on a timer, so dwell and release timers advance, and also at once when an input changes, so the listening release starts when user speech ends.

```ts
import type { PerformanceInputs } from '@proj-airi/stage-shared/performance-state'

import { initialResolverMemory, resolvePerformanceState } from '@proj-airi/stage-shared/performance-state'

let memory = initialResolverMemory

function resolve(inputs: PerformanceInputs) {
  const resolution = resolvePerformanceState(inputs, memory)
  memory = resolution.memory
  return resolution.state
}
```

Use this entrypoint when a stage needs to tell a renderer what the character is doing.
Do not use it to read desktop or voice signals. The caller collects them, and a `null` signal means that the host cannot measure it, so it never counts as activity.

### Desktop activity store

The `stores/desktop-activity` entrypoint owns `useDesktopActivityStore`, which holds the latest `DesktopActivitySnapshot` for the performance resolver.
A host writes it with `setSnapshot` and clears it with `reset`. The Electron host writes it from the main process power monitor and idle time. The web host never writes it, so `snapshot` stays `null`.

```ts
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { storeToRefs } from 'pinia'

const { snapshot } = storeToRefs(useDesktopActivityStore())
```

Use this store to pass desktop samples from a host producer to the stage.
Do not persist or replicate it: it is runtime state, and each renderer reads only its own host's samples. Do not sample desktop signals in this package; the host producer owns sampling.

## Do not use this package

Keep Electron IPC definitions in the Electron application. Keep UI state and actions in `@proj-airi/stage-ui`. Keep Extension runtime and manifest behavior in `@proj-airi/plugin-sdk`.

Do not add application startup, persistence, or platform-specific side effects here.
