# Linux desktop bridge

The main process owns the bridge, its bus connections, script lifecycle and
runtime facts. Follow the stage-tamagotchi guide and the
`docs/ai/adr/2026-11-09-linux-desktop-bridge.md` contract.

- Only `dbus/transport.ts` imports `dbus-native`.
- Only `index.ts` imports Electron. Backends and session sources run under Node.
- The factory receives `env` explicitly and converts it to backend options.
  Backends never read `process.env`; displays, sockets and buses are injected.
- KWin's temp directory comes from that environment's runtime directory.
  Stale-script cleanup must stay inside the owning session.
- Use pushed signals, coalescing and bounded handshakes. Never poll KWin.
- (a) Report the currently active window, whatever app owns it, through
  `Active`: caption, resourceClass, desktopFileName, pid and fullScreen.
  Update on activation, captionChanged and fullScreenChanged. App-side
  presence rules enforce sharing, the denylist and 120-character titles.
- (b) Own-window discovery may enumerate windows reading only pid for an
  OwnPids comparison inside KWin. For windows neither active nor AIRI's own,
  never read, send, store or log any other property.
- Never persist host facts or log titles. A handshake alone verifies no sensor.
- Run sensor fixtures on private buses. Every live app run uses
  `pnpm qa:display run --name <task> -- ...`, a temporary profile and private
  runtime/data directories. Never attach to the user's compositor, display or
  session bus. Use a fake/private system bus for lock QA as well.

Run the node project for `src/main/services/linux-desktop` and
`src/main/services/electron/host-capabilities.test.ts`, then `pnpm verify`.
Live evidence must include the snapshot, script-unload receipt and manifest
cleanup, as well as the ready log line.
