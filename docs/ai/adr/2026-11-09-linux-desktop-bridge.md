# Linux desktop bridge

## Decision

The Electron main process owns one Linux desktop bridge. `main/index.ts`
provides `services:linux-desktop` through injeca after app readiness and starts
it before constructing windows. Windows wait at most two seconds, including
connection setup and the KWin Hello handshake. Failure leaves the ordinary
window host usable. `onAppBeforeQuit` stops the bridge before process exit.
Windows and macOS neither construct nor start it.

`createLinuxDesktopBridge({ env, tempDir, sessionBus, systemBus })` is the only
environment-to-backend boundary. Backends receive explicit display, socket and
bus options; they never read `process.env`. The factory uses
`env.XDG_RUNTIME_DIR` as KWin's manifest directory root, with the supplied
temporary directory only when the runtime directory is absent. Injected bus
connections transfer ownership to the bridge. The system connection is
optional: its absence leaves ScreenSaver on the session bus available.

Detection checks Hyprland's instance signature, sway's socket, KDE, GNOME,
then X11 and finally `none`, in that order. Socket evidence takes precedence
over inherited desktop names. The factory's `backends` map registers KWin,
X11 EWMH, sway and Hyprland. GNOME remains reason-only.
KWin confirms the current owner of `org.kde.KWin` before loading a script.

| Backend | Selected when | Explicit input from `env` | Ready after | Readings | Failure |
| --- | --- | --- | --- | --- | --- |
| `kwin` | KDE desktop name | Session bus, `XDG_RUNTIME_DIR` | Supported Hello | Pushed active window, own windows, cursor stream | Owner loss, unsupported API, two-second Hello deadline |
| `x11-ewmh` | X11 session only, never XWayland | `DISPLAY` | One display connection opened | Active window read on demand from `_NET_ACTIVE_WINDOW`; Electron keeps cursor, origin and displays | Display unavailable, or a failed read |
| `sway` | `SWAYSOCK` | `SWAYSOCK` | Subscription and first tree | Pushed active window and own-window geometry; no cursor (`sway-cursor-unreported`) | Socket missing, closed, malformed or timed out |
| `hyprland` | `HYPRLAND_INSTANCE_SIGNATURE` | `XDG_RUNTIME_DIR`, `HYPRLAND_INSTANCE_SIGNATURE` | Event socket and first replies | Pushed active window and own-window geometry; cursor once per `requestCursor` tick | Missing or escaping signature, socket closed, reply too large or timed out |

Every failure clears the readings and publishes `failed` with
`bridgeFailure: other` and its fixed reason in the log; the bridge never
keeps a reading from a dead connection. Own-window geometry from sway and
Hyprland is delivered through `ownWindows()`; todo 9's coordinate provider
owns how it is used. No caller drives Hyprland's `requestCursor` yet; todo 9's
renderer-paced cursor tick owns that call.

## Facts and evidence

All facts live in the current process. Neither configuration nor a previous
launch can establish verification. `reportLinuxDesktop` merges patches and
publishes a new snapshot when signals or the backend change. No fact is
persisted. Hello proves that the bridge runs; it proves no sensor's accuracy.

| Fact | Initial value | Evidence that changes it |
| --- | --- | --- |
| `backend` | `none` | Injected environment and registered backend selection; KWin additionally confirms its bus owner |
| `bridge` | `starting` | KWin's supported Hello and completed script startup give `ready`; missing owner, transport failure, unsupported API or two-second deadline give `failed`; reason-only backends become `ready` without claiming sensors |
| `bridgeFailure` | `null` | Unsupported Hello gives `api-unsupported`; other startup or backend failures give `other`; a new successful handshake clears it |
| `foregroundVerified` | `false` | An AIRI window's `focus` event followed within 1 s by an AIRI pid in the bridge's active window gives `true`; three consecutive focus events that see only foreign or null pids give `false` |
| `cursorVerified` | `false` | Verified geometry and two distinct compositor positions; two renderer mismatches within ten seconds revoke it |
| `geometryVerified` | `false` | A bound own window whose compositor size matches its Electron size within one pixel, and known outputs (on native Wayland, every display mapped to an output) |
| `keepAboveVerified` | `false` | Todo 10: own-window keep-above state observed after the actuator |
| `lockSource` | `null` | Readable logind LockedHint with a subscription, otherwise ScreenSaver GetActive with ActiveChanged |
| `portalShortcuts` | `absent` | Todo 11: a portal session gives `session`; an accepted current key-up binding gives `bound` |
| `clickThroughToggle` | Version-derived | Electron at least 43.7.6 on Linux supplies the primitive; cursor and origin must independently resolve live before click-through becomes limited/emulated |
| `systemAudioVerified` | `false` | A capture reports an input level above 0.05 on a Linux host; main accepts only a finite level above 0.05 |

The pointer and system-audio Eventa invokes are registered per sending window
and removed on window close or app quit. Pointer samples reach the coordinate
verifier below; the system-audio invoke feeds the verifier described next.

### System audio capture

The Live2D system-audio lip-sync driver sends `reportSystemAudioHeard` once per
capture, the first time the capture's input level exceeds 0.05 while the
window's host snapshot names a Linux host. `recordSystemAudioHeard` in main
then sets `systemAudioVerified`, and `systemAudioCapture` resolves live. Off
Linux the renderer never reports, and `reportLinuxDesktop` ignores the fact.
A silent capture proves nothing, so the status stays degraded with
`linux-capture-audio-unverified` until sound actually arrives. The proof lives
in process memory, so each launch starts degraded again.

On native Wayland under KWin, the first live investigation (todo 12 part A)
found that capture never started. The main-process display-media handler
called `desktopCapturer.getSources` again. On Wayland that opened a second
ScreenCast portal picker and returned a new source id, so the requested id was
not found. The handler threw inside its async callback without answering, and
`getDisplayMedia` stayed pending. Todo 23 fixed this in
`packages/electron-screen-capture`: on Linux, main keeps the sources from the
renderer's one `getSources` call and grants the selected one with the existing
`loopback` audio mode, and every failed lookup answers the callback with
`null`. With that fix, one picker yields a live `System audio` track through
`PulseaudioLoopbackForScreenShare`, and a 440 Hz tone on a private PipeWire
sink raises the input level above 0.05.

## Backend and signal contract

This table describes the target resolver result after the named evidence is
available, not claims that this bootstrap implements those verifiers.
`E` means the existing Electron status for the session. Native X11 already
has cursor, origin, display and z-order support; XWayland has Electron
origins but no global cursor; native Wayland has no trusted window origin.
`U` is unavailable. `L` requires the proof in the Evidence column.

| Signal | KWin | X11 EWMH | sway | Hyprland | GNOME | none | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Foreground | L | L | L | L | U, needs extension | U, unsupported | Focus/pid correlation and sampler integration, todo 8, over each registered backend's active window |
| Cursor | L on Wayland/XWayland; E on X11 | E | U, cursor unreported | L | U, needs extension | E | Coordinate provider and two distinct samples, todo 9 |
| Window origin | L on native Wayland; E otherwise | E | L on native Wayland; E on XWayland | L on native Wayland; E on XWayland | U on native Wayland; E otherwise | E | Bound own window and matching dimensions, todo 9 |
| Display origins | L on native Wayland; E otherwise | E | L on native Wayland; E on XWayland | L on native Wayland; E on XWayland | E | E | Output identity, size and scale agreement, todo 9 |
| Always on top | L on native Wayland; E otherwise | E | E | E | E | E | Own-window actuator readback, todo 10 |
| System idle | E | E | E | E | E | E | Existing advancing-idle verifier; XWayland remains unavailable |
| Screen lock | L | L | L | L | L | L | Successful logind or ScreenSaver read and subscription |
| Global key-up | L on Wayland/XWayland; E on X11 | E | L | L | L | L where portal is bound | Accepted portal binding, todo 11; existing X11 hook |
| Click-through | Limited/emulated when cursor and origin are live | Limited/emulated | U without cursor | Limited/emulated when cursor and origin are live | E | E | Version primitive plus live cursor and origin; stage integration is todo 13 |
| System audio | L | L | L | L | L | L | Capture verification, todo 12; otherwise existing degraded status |

Until verification, the resolver publishes its `*-verifying` reasons.
Startup publishes `linux-bridge-starting`; failure publishes
`linux-bridge-failed` or `kwin-api-unsupported` for foreground while retaining
the static status of the other signals. A compositor owner change clears all
compositor readings and verification immediately, then a successful reload
returns to ready with verification still false.

Lock and busy sources operate independently of compositor readiness. Only
lock transitions are forwarded, through the existing power-monitor events
to each window. Windows and macOS retain their Electron lock listeners.
Suspend and resume still use Electron on every host.

## Coordinate ownership and verification

`services/electron/coordinates.ts` is the only main-process reader of the
cursor, window rectangles and displays. Off Linux, or without a ready bridge,
it returns exactly what Electron returns, gated by the capability snapshot. On
Linux with a ready bridge, each reading has one owner, and only that owner is
read, so Electron and compositor origins never meet in one computation:

| Backend | Session | Cursor | Window rect | Displays |
| --- | --- | --- | --- | --- |
| `x11-ewmh`, `gnome`, `none` | any | Electron, gated | Electron, gated | Electron |
| `kwin`, `hyprland` | XWayland | bridge | Electron | Electron |
| `kwin`, `hyprland` | native Wayland | bridge | bridge | bridge outputs |
| `sway` | XWayland | none | Electron | Electron |
| `sway` | native Wayland | none | bridge | bridge outputs |

Native X11 sessions keep Electron for every reading on every backend. Bridge
displays are Electron displays moved to the origin of the output with the same
size and scale; a display without exactly one such output leaves Electron's
displays in place and withholds geometry verification.

The bridge script reports `Outputs` (name, origin, size, scale) at load and on
output-set, geometry and scale changes, and adds `caption` to own windows
only. Binding gives an AIRI window the unique title `airi-bind-<n>`, waits up
to two seconds for an own window with that caption, records its compositor id
and restores the title. Binding runs for every visible window when the bridge
becomes ready, for a window when it shows, and for an unbound window when it
gains focus. After a revocation, the next show or focus rebinds every visible
window as one batch, and geometry is not granted until the whole batch settles.
A window that has not proved its id reads `null`. While the origin is live,
its renderer receives a `null` bounds event, which clears the availability of
its cached bounds, so no renderer pairs an Electron origin with compositor
cursor or display coordinates. Origin consumers check that availability as
well as the global status, and display lists refresh on every capability
change.

Renderers send `reportPointerSample` at most every 250 ms while the cursor is
`linux-cursor-verifying` or live on a Linux backend. Main compares each sample
with `cursor - window origin` over readings from the last 500 ms. Two
disagreements over two pixels within ten seconds revoke both facts, clear the
bindings and log `linux-desktop: coordinate mismatch revoked verification`.
Silence never revokes: a resting pointer keeps its reading. The compositor
cursor becomes `null` when KWin loses its owner or restarts, when the cursor
script is found unloaded, when the bridge fails, and when the last cursor loop
stops, because the stopped script no longer reports movement. The first
running cursor loop starts compositor cursor streaming and the last one stops
it. A capability change makes every screen service resend its cursor.

## Script lifecycle and cost

Names include the app pid: `ai.moeru.airi.LinuxDesktop.p<pid>`,
`airi-desktop-bridge-<pid>` and `airi-desktop-cursor-<pid>`. Scripts are written
under `<runtime dir>/airi-kwin/`. That directory is also the crash manifest.
Startup unloads scripts for dead pids and deletes their files. Live pids are
left alone. A private QA runtime directory therefore limits stale cleanup to
that QA session. Stop unloads the bridge, cursor and actuator scripts and
removes their files. Failed unloads retain their manifest for recovery.

The exported `/bridge` accepts only the current unique bus owner of
`org.kde.KWin`. An unrelated sender receives AccessDenied. Owner changes
invalidate in-flight generations and reload the bridge and any requested
cursor stream. Stop cancels a pending Hello. A late load is cleaned rather
than resurrecting the stopped bridge.

The bridge script permits one outstanding D-Bus call. Pending snapshots
replace older snapshots of the same kind. The separate cursor script runs
only when a consumer requests streaming; it coalesces changes behind one
outstanding call and delivers the final changed position after the reply.
There is no compositor polling timer. A dead receiver stops the reply-driven
pump. Payload parsing caps each text field at 4,096 characters, own windows
at 32, own pids at 256 and each JSON message at 65,536 characters.

## Privacy and host isolation

(a) The currently active window, whatever app owns it, is reported through
`Active` with caption, resourceClass, desktopFileName, pid and fullScreen.
Activation, captionChanged and fullScreenChanged update that reading.
App-side presence rules govern what reaches consumers: the sharing toggle,
denylist and 120-character title limit apply, and titles are never logged.
`createLinuxSampler` maps that reading to a foreground sample and reads only
`/proc/<pid>/exe` beyond it, never the process command line or environment.

(b) Own-window discovery may enumerate windows reading only `pid` to compare
against OwnPids inside the compositor. For a window that is neither active
nor AIRI's own, no other property is read, sent, stored or logged. Discovery
retains only matched AIRI windows. Actuators accept an AIRI pid and inspect
no foreign property beyond the ownership comparison. Host facts and window
titles are not persisted.

Every agent app run uses `pnpm qa:display run` with a named private compositor,
runtime directory, bus, temporary profile and data directory. Sensor fixtures
use private D-Bus daemons, including their fake logind. The system bus is
private per qa:display session, like the session bus, so live QA cannot
observe the host login session. Before and after QA, record the host document-portal mount and
user service status; neither may change.

GNOME is excluded from compositor sensing because its equivalent requires
an installed Shell extension. AIRI does not install or require one. GNOME
still uses independently proven lock, portal and audio sources.

## Interim smoke policy

Until todo 18 introduces exact backend profiles, `qa:host smoke` accepts the
static Linux status, an unavailable starting/verifying status for a
bridge-owned signal, or a live screen-lock signal. It still rejects bridge
failures and unrelated signal changes. Windows and macOS comparisons remain
exact. Node evaluation cases cover both acceptance and rejection.
