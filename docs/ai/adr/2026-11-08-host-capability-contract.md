# Host capability contract

## Context

The Linux audit found that a single platform label does not describe what the
desktop host can actually report. On this machine, native Wayland idle time
advanced during the live probe, while XWayland idle time was null. The native
Wayland window bounds reported an origin of `(1796, 420)`, not `(0, 0)`, but
Electron does not provide a trustworthy global origin there. The value is
therefore untrusted rather than evidence of a zero origin. The probe verdict
file is not present in the supplied evidence locations; the observations here
are limited to the recorded probe facts and todo 16 smoke reports.

## Decision

`packages/stage-shared/src/host-capabilities/index.ts` defines one
renderer-neutral snapshot for `windows`, `macos`, `linux-x11`,
`linux-xwayland`, `linux-wayland`, and `web`. It reports each signal as
`live`, `degraded(reason)`, or `unavailable(reason)`. A status describes what
the host guarantees, not a sampled value. Stable reason codes explain every
degraded or unavailable status.

The Electron main process owns sampling and sends each window its own snapshot
through Eventa. When a runtime check changes a status, that window receives the
updated snapshot. The web host publishes the same shape, with sandbox
limitations reported explicitly.

Consumers use only readings the host can vouch for. Wayland cursor readings
are withheld on both native Wayland and XWayland. Native Wayland window
origins are untrusted, so the app does not use them for placement or persist
coordinates it cannot know. The Linux window-placement policy uses the primary
display when an origin is unavailable and leaves placement to the compositor.

Persisted caption and widget placement schemas accept an entry whose `x` and `y` are missing, because a host that cannot know an origin must not invent one to save. Where the origin is untrusted, the caption and widget windows persist and restore only their size and leave placement to the compositor. Where it is trusted and a saved entry has no coordinates, the caption places itself relative to the main window on that window's display, and the widget window uses its default position on the primary display. On KDE native Wayland the origin turns trusted only after the window proves its compositor identity, so a saved position waits until then and is applied through the KWin placement actuator; until it is applied, the compositor's initial position is not saved over it.

Native Wayland idle time becomes live only after the running sensor is verified
to advance. XWayland idle remains unavailable because its reading is
constant-zero. The performance resolver keeps `unknown -> idle`; no substitute
such as focus, pointer hover, typing, or voice activity is treated as desktop
activity. The idle fallback and its retune are documented in the Natural idle
ADR.

Settings > System > Presence sensing shows signal status and reason. If a
presence signal is unavailable, a dismissible notice names the missing
sensing. Its host-and-reason key prevents it from repeating for the same
condition, and Delete all data clears the dismissal.

The `pnpm qa:host smoke` command launches the real app and checks its host
snapshot and live idle delivery. Host-profile motion gates use only signals
available to the declared host and exercise the real resolver. `alwaysOnTop`
and `displayOrigins` are diagnostics-only. `systemAudioCapture` can feed
watching while capture runs, and `screenLock` can feed away detection where
its events are reported.

## Host parity matrix

Each signal cell is the canonical result of `capabilitiesForHost(host)`.
`degraded` and `unavailable` cells include their stable reason code.

| Signal or feature | windows | macos | linux-x11 | linux-xwayland | linux-wayland | web |
| --- | --- | --- | --- | --- | --- | --- |
| `cursorScreenPoint` | live | live | live | unavailable (wayland-cursor-unreported) | unavailable (wayland-cursor-unreported) | degraded (web-page-pointer-only) |
| `windowOrigin` | live | live | live | live | unavailable (wayland-window-origin-hidden) | unavailable (web-sandbox) |
| `displayOrigins` (diagnostics-only) | live | live | live | live | degraded (wayland-display-origin-unverified) | unavailable (web-sandbox) |
| `systemIdleTime` | live | live | live | unavailable (xwayland-idle-constant-zero) | unavailable (wayland-idle-unverified) | unavailable (web-sandbox) |
| `screenLock` | live | live | degraded (linux-lock-events-undocumented) | degraded (linux-lock-events-undocumented) | degraded (linux-lock-events-undocumented) | unavailable (web-sandbox) |
| `foregroundWindow` | live | live | unavailable (platform-no-foreground-binding) | unavailable (platform-no-foreground-binding) | unavailable (platform-no-foreground-binding) | unavailable (web-sandbox) |
| `globalKeyUp` | live | live | live | unavailable (wayland-no-global-input-hook) | unavailable (wayland-no-global-input-hook) | unavailable (web-sandbox) |
| `clickThroughForward` | live | live | unavailable (linux-no-click-through-forward) | unavailable (linux-no-click-through-forward) | unavailable (linux-no-click-through-forward) | unavailable (web-sandbox) |
| `alwaysOnTop` (diagnostics-only) | live | live | live | live | unavailable (wayland-no-z-order) | unavailable (web-sandbox) |
| `systemAudioCapture` | live | live | degraded (linux-capture-audio-unverified) | degraded (linux-capture-audio-unverified) | degraded (linux-capture-audio-unverified) | unavailable (web-sandbox) |
| Cursor attention | Yes | Yes | Yes | No | No | Page pointer only |
| Screen placement | Yes | Yes | Yes | Yes | No | No |
| Watching mode | Yes (idle, screen change, audio, stage pointer) | Yes (idle, screen change, audio, stage pointer) | Yes (idle, screen change, audio, stage pointer; audio capture unverified) | Yes (screen change, audio; audio capture unverified) | Yes (idle, screen change, audio; audio capture unverified; idle-based watching only after idle verification) | Page pointer only |
| Away detection | Yes (idle, suspend, lock) | Yes (idle, suspend, lock) | Yes (idle, suspend, lock; lock events degraded) | Yes (suspend, lock; lock events degraded) | Yes (idle, suspend, lock; lock events degraded; idle-based away only after idle verification) | No |
| Foreground awareness | Yes | Yes | No | No | No | No |
| Push-to-talk key-up | Yes | Yes | Yes | No | No | No |
| Click-through | Yes | Yes | No | No | No | No |
| Desktop stage | Yes | Yes | Limited (KWin or EWMH; emulated click-through) | Limited (KWin; emulated click-through) | Limited (KWin; emulated click-through) | No |
| Display hand-off | Yes | Yes | Yes | No | No | No |

The backend table records observed Linux statuses. `[~]` marks missing or
limited live proof. The six-column table above remains the canonical shared
contract; these rows split Linux by the backend selected at runtime.

| Signal | KWin Wayland | KWin XWayland | x11-ewmh | sway | Hyprland | GNOME | none |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `foregroundWindow` | live | live | live | unavailable (`linux-foreground-verifying`) [~] | unavailable (`linux-foreground-verifying`) [~] | unavailable (`gnome-needs-extension`) | unavailable (`linux-desktop-unsupported`) |
| `cursorScreenPoint` | live | live | live | unavailable (`sway-cursor-unreported`) | unavailable (`linux-cursor-verifying`) [~] | unavailable (`gnome-needs-extension`) | unavailable (`wayland-cursor-unreported`) |
| `windowOrigin` | live | live | live | live | unavailable (`linux-geometry-verifying`) [~] | unavailable (`gnome-needs-extension`) | unavailable (`wayland-window-origin-hidden`) |
| `displayOrigins` | live | live | live | live | degraded (`wayland-display-origin-unverified`) [~] | degraded (`wayland-display-origin-unverified`) | degraded (`wayland-display-origin-unverified`) |
| `systemIdleTime` | live after runtime verification | unavailable (`xwayland-idle-constant-zero`) | live | unavailable (`wayland-idle-unverified`) [~] | unavailable (`wayland-idle-unverified`) [~] | unavailable (`wayland-idle-unverified`) | unavailable (`wayland-idle-unverified`) |
| `screenLock` | degraded (`linux-lock-events-undocumented`) | degraded (`linux-lock-events-undocumented`) | degraded (`linux-lock-events-undocumented`) | degraded (`linux-lock-events-undocumented`) | degraded (`linux-lock-events-undocumented`) [~] | degraded (`linux-lock-events-undocumented`) | degraded (`linux-lock-events-undocumented`) |
| `globalKeyUp` | live when a shortcut is bound | unavailable (`wayland-no-global-input-hook`) [~] | live | unavailable (`wayland-no-global-input-hook`) | unavailable (`wayland-no-global-input-hook`) [~] | unavailable (`wayland-no-global-input-hook`) | unavailable (`wayland-no-global-input-hook`) |
| `clickThroughForward` | degraded (`linux-click-through-emulated`) | degraded (`linux-click-through-emulated`) | degraded (`linux-click-through-emulated`) | unavailable (`linux-no-click-through-forward`) | unavailable (`linux-no-click-through-forward`) [~] | unavailable (`linux-no-click-through-forward`) | unavailable (`linux-no-click-through-forward`) |
| `alwaysOnTop` | live (main stage, floating chat and desktop overlay) | live | live | unavailable (`wayland-no-z-order`) | unavailable (`wayland-no-z-order`) [~] | unavailable (`wayland-no-z-order`) | unavailable (`wayland-no-z-order`) |
| `systemAudioCapture` | degraded (`linux-capture-audio-unverified`) | degraded (`linux-capture-audio-unverified`) | degraded (`linux-capture-audio-unverified`) | degraded (`linux-capture-audio-unverified`) | degraded (`linux-capture-audio-unverified`) [~] | degraded (`linux-capture-audio-unverified`) | degraded (`linux-capture-audio-unverified`) |
| Desktop stage | Passes isolated smoke and host checks | Passes isolated smoke and host checks | Eligible; X11 smoke passed with SwiftShader | Classic window only | Classic window only; backend not live-tested [~] | Classic window only | Classic window only |

KWin native support was verified on the tested Plasma 6.8.2 host. The passing
host smoke covers foreground, cursor, geometry and keep-above. Idle becomes
live only after its runtime verifier passes. Lock and system audio remain
degraded in the QA session because it had no lock source and did not run
capture. On the tested KWin native Wayland session, the GlobalShortcuts portal
delivered push-to-talk key-up after a binding was accepted. The KWin
XWayland host report kept `globalKeyUp` unavailable, and no live XWayland
binding result was recorded. On X11, foreground, cursor and geometry were
verified with Openbox. The host report recorded emulated click-through, and
the X11 desktop-stage clean-start smoke passed with SwiftShader because Xvfb
has no GPU. Raw X11 pointerdown and five-second rest-timing receipts were not
retained, so those routing checks remain pending F3. Native X11 uses uiohook
for push-to-talk key-up.

Sway geometry verifies after the backend reports outputs. Its headless session
could not verify foreground because it has no seat input devices, and idle
remained unverified. Sway has no cursor or always-on-top source, so it uses the
classic window. Hyprland has fixture and registration coverage only; it was
not installed for a live run. Its cursor and geometry therefore remain
unverified. GNOME has no shipped Shell extension, and unsupported desktops
report explicit reasons rather than claiming a foreground sensor.

Display hand-off needs both `windowOrigin` and `cursorScreenPoint` to be live:
the stage window follows the character to another display only while the host
can vouch for where the window and the cursor are. The canonical XWayland and
native Wayland profiles withhold the cursor, so the row reads No there; a KWin
backend that reports both signals live at runtime qualifies. The rule is in
[the display hand-off ADR](2026-11-10-display-hand-off.md). No host has run a
crossing on two real displays yet.

The feature cells name the inputs the host can deliver to the performance
resolver. Watching requires a visible stage and a user who is not away; it can
be selected by a recent stage pointer move, idle time below 10 seconds, screen
change above 0.15, or system audio above 0.1. The pointer comes from the
Electron cursor path where `cursorScreenPoint` is live, or from page pointer
events on web. Desktop activity values are available only while their existing
capture runs: screen change comes from screen ambient-light capture, and
system audio comes from the active Live2D system-audio capture. Linux
system-audio delivery is marked degraded and unverified. These inputs are
independent of idle verification. Suspend and resume events come from
Electron's power monitor; lock events also feed away detection on Windows and
macOS. Linux lock events reach the resolver but are marked degraded.

Windows, macOS, and Linux X11 can additionally use verified idle time for
watching and away detection. XWayland cannot use idle time, while native
Wayland can use it only after the running sensor passes verification. Until
then, `idleSeconds: null` contributes neither watching nor away, but available
screen-change, audio, and suspend inputs still apply. Web has no desktop
snapshot or desktop signals; its page pointer can select watching, and it
cannot detect desktop absence.

The Windows and macOS sensor behavior remains the reference behavior. Linux
screen placement remains available under X11 and XWayland, where window
coordinates are reported. Linux has no forwarded click-through, so the desktop
stage launches only on KWin or an EWMH X11 session with Electron 43.7.6 or
later, and captures the pointer only while the bridge's emulated click-through
(`degraded(linux-click-through-emulated)`) resolves. The launch gate and the
fallback are described in `2026-11-09-linux-desktop-bridge.md`, Desktop stage.

Without click-through forwarding, a transparent window that must stay usable
also takes every click over its empty area. The voice inlay therefore hides
while it paints nothing on such hosts and appears without focus when speech or
a draft arrives; hosts with forwarding keep it shown. Without a host cursor,
Live2D gaze and touch attention read the canvas pointer, and the last sample
holds until the pointer leaves the canvas, so a resting hand does not read as a
cursor that went away. Both were found by real-pointer QA in the Linux QA
display on 2026-11-09.

## Consequences

Consumers can distinguish an unsupported signal from a runtime failure and
can explain the limitation in Settings. Platform capability checks have one
shared source, while ordinary OS-specific conventions such as key labels and
window-drag APIs remain local.

The host matrix describes the implemented contract, including the Presence
sensing page, its one-time notice, `pnpm qa:host smoke`, and the policy against
placing windows from an untrusted hidden origin.

The Linux backend sub-table records observed host-specific profiles. A live
status means its runtime proof passed in a QA session. `[~]` marks a missing
live proof; neither label extends to untested distributions or compositor
versions.

Todo 18 did not land an idle retune, so
`docs/ai/adr/2026-10-25-natural-idle-reshape-and-emotion-ducking.md` has no
amendment from this plan. Only its QA harness changes shipped: host-profile
captures record the resolver inputs, and a liveliness capture fails with
`away-active` when a scored sample reports away as active or unknown
(`packages/qa-tools/README.md`, host-profile T3 captures).

## Follow-ups

- Compositor-provided sensors qualify when their contracts are documented and
  ship inside the compositor or its IPC, including KWin scripting, sway IPC,
  and Hyprland IPC. Shell extensions the user must install, including GNOME
  Shell extensions, do not qualify.
  The Linux desktop facts contract now records the selected backend and
  process-local proofs for foreground, cursor, geometry, keep-above, lock,
  shortcut bindings, click-through toggling, and system audio. Static profiles
  in the matrix above stay unchanged until a running producer supplies those
  proofs. Pending verification does not trigger a presence limitation notice.
- Upgrade Electron when the fix for electron#52456 is available and can be
  adopted without changing the supported host contract.
- Run live smoke checks on Windows and macOS; those host checks have not been
  performed in this work.
- Track the todo 24 `pnpm verify` browser-batch import flake. Rerun affected
  suites directly when the batch reports dynamic-import failures.
