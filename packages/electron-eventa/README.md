# @proj-airi/electron-eventa

Shared Eventa contract definitions for Electron IPC across AIRI apps.

## Exports

- `@proj-airi/electron-eventa`: core Electron contracts (`electron`, `electronEvents`, `bounds`, `cursorScreenPoint`, `getHostCapabilities`, `hostCapabilitiesChanged`, etc.)
- `@proj-airi/electron-eventa/electron-updater`: auto-updater contracts and state types

## Host capabilities

`electron.hostCapabilities.get` is an invoke that returns the window's `HostCapabilities` snapshot (type from `@proj-airi/stage-shared/host-capabilities`).
`electronEvents.hostCapabilities.changed` is an event that carries the new snapshot when a runtime failure or verification changes it.

Use them to learn which signals the host supplies. Do not derive host guarantees from `process.platform` in a renderer.
