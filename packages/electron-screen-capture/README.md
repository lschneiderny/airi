# Electron screen capture

Typed Eventa operations for selecting desktop capture sources and requesting
system loopback audio in Electron.

## Usage

Call `initScreenCaptureForMain` before app readiness and
`initScreenCaptureForWindow(window, context)` for each participating window.
`context` is the Eventa main context that serves that window, created with
`onlySameWindow: true`. The package registers its invoke handlers on it and
creates no context of its own, so pass the context the window already uses:

```ts
const { context } = createContext(ipcMain, window, { onlySameWindow: true })
initScreenCaptureForWindow(window, context)
```

In the renderer,
use `setupElectronScreenCapture(context).selectWithSource`, or the Vue
`useElectronScreenCapture` equivalent:

```ts
const stream = await capture.selectWithSource(
  sources => sources[0].id,
  () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }),
  { sourcesOptions: { types: ['screen'] } },
)
```

Handle an empty source list in your selector. The helper resets the selection
after `getDisplayMedia` resolves or rejects.

On Linux, `getSources` can open the system portal picker. Main retains that
window's returned native sources until `setSource` consumes the selection.
Call `getSources` again for each new capture; a previously consumed source ID
cannot be reused. Each `getSources` call clears the retained list when it
starts and stores its own sources only when it resolves. For sequential calls,
a cancelled picker therefore leaves no earlier list behind. Overlapping calls
are not ordered: the last call to resolve owns the list, so an older pending
call can restore its sources after a newer call was cancelled. Windows and
macOS retain their existing re-enumeration
when the display-media request arrives.

Missing sources and failed request-handler lookups deny capture with
`callback(null)`, so the renderer receives a rejection instead of hanging.

## When to use

Use this package for Electron desktop capture with renderer-owned source
selection and system loopback audio.

## When not to use

Browser-only capture should call the browser media APIs directly. This package
does not bypass system capture consent or guarantee audio support on every host.
