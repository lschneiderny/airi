# macOS foreground sensor

Date: 2026-10-25
Status: accepted

## Context

Situational presence previously had a foreground sampler only on Windows. The
macOS Electron host now reports the front application, whether a window covers
an active display, and, when Accessibility is already trusted, the focused
window title. The sample crosses the existing Eventa invoke and is consumed by
the same situation adapter and opportunity gate as Windows samples.

The implementation uses the existing native FFI dependency to call macOS
system frameworks from the Electron main process. It adds no helper binary or
native build step. The sampler does not read screen contents and does not ask
macOS to show an Accessibility permission prompt.

## Decision

The sample reports a host-neutral `busy` value rather than exposing Windows'
shell notification-state enum over IPC. Each platform maps its own states
before the sample crosses the Eventa boundary. This keeps the consumer
independent of operating-system constants.

One shared `withoutAppExtension` helper strips `.exe` on every host and strips
`.app` only when the forwarded Electron `window.platform` is `darwin`.
MacOS-only category rows are keyed by bundle file name. The same forwarded
platform metadata lets app-id, label, category, quiet-pattern and default-list
handling use those bundle names on macOS. Non-Electron hosts keep `.exe`-only
normalization, so Windows app ids, labels, categories, quiet-pattern matching
and default lists keep their previous behavior. On macOS, a label keeps the
bundle name's own casing, so `zoom.us.app` is labelled `zoom.us`; Windows file
names are still title-cased.

The macOS sampler identifies the front app through `NSWorkspace`. It uses
`CGWindowListCopyWindowInfo` geometry as the full-screen signal, comparing
visible application windows with active display bounds. Geometry needs no
Accessibility permission. The sampler does not read `AXFullScreen`: the
attribute was never read successfully from a real app window while trusted, so
its availability is unverified.

The focused window title is read through the Accessibility API only when
`AXIsProcessTrusted` reports existing trust. If trust is absent, the sample
still reports the app name with an empty title. The sampler does not call a
prompting trust API. Accessibility permission already granted to the launching
app for push-to-talk also permits title reading; there is no separate consent
screen. All Accessibility calls in one sample share a 250 ms budget, and a
timeout backs that app off from title reads for 10 seconds.

The sensor does not read microphone-in-use status. The available CoreAudio
device flag cannot distinguish AIRI's own capture from another application's
capture, so using it to suppress speech could hold the gate permanently. Focus
status is also deferred: `INFocusStatusCenter` requires authorization this app
does not have. The sampler makes no claim to detect Focus or Do Not Disturb.

## Consequences

Windows behavior is proven only by mocked tests and a differential comparison
of the shared identity, category, quiet-pattern and default-list helpers
against the previous implementation, which found no mismatches. No Windows
runtime was available, so the real Win32 binding suite did not run.

The macOS work was exercised on one arm64 Mac (macOS 14.6.1, one 1680 by 1050
point display, no notch). Intel Macs and notched displays were not tested.

Live checks in the running app showed Safari as `Safari (browser)` with
`busy: accepts` and a non-blocking gate decision, the trusted title path
reading the focused page title, a kiosk Firefox window turning `busy` to
`fullscreen`, AIRI's own Electron windows marked `ownProcess`, and the gate
holding with `stale-signal` once sharing was turned off. The final source was
re-checked for app identity, `busy: accepts` and macOS defaults; the
full-screen, own-process and sharing-off checks ran on an earlier revision of
the sampler. Focusing the Godot stage sidecar was not exercised on macOS.

The sampler runs on the Electron main thread. With trust granted, 50 reads
measured p50 1.0 ms, p95 3.2 ms and a 59 ms maximum, and a 33-minute run at
1 Hz measured p50 4.0 ms, p95 4.4 ms and a 97 ms maximum. A sample taken while
the front app was frozen finished in 255 ms. A frozen front app therefore
costs about a quarter-second main-thread stall every 10 seconds while it stays
in front.

Memory evidence is partial:

- 2,000 native samples grew RSS by 11.8 MB.
- The 33-minute, 2,000-sample 1 Hz run grew RSS by 11.0 MB, or 11.7 MB after
  GC, below the 20 MiB target.
- Accelerated diagnostics of 60,000 calls levelled off after warm-up, with
  residual growth below the 512 KiB measurement resolution per 2,000 calls.
- In those same diagnostics, 20 individual 2,000-call batches in the cold and
  early-warm phases exceeded 20 MiB, peaking at 44.1 MB. The two spikes
  analyzed in detail were mostly V8 heap growth; the rest is not attributed.
  Two earlier
  in-process RPC runs also exceeded 20 MiB, at 31.6 MB and 25.3 MB.

All memory runs used plain Node or Vitest rather than Electron's renderer and
main IPC, and none ran for hours of elapsed time. The 20 MiB per-batch target
is not met in cold runs, and the absence of a long-running leak is supported
only at the measurement resolution above. The opt-in
`foreground-window.memory.darwin.test.ts` reruns the 2,000-sample batch check.
The cadence and accelerated measurement scripts are not kept in the repository.

On a notched display, native full screen may stop below the camera band, so the
geometry check may miss it and the sample may report `accepts`. This applies
regardless of Accessibility trust, because there is no Accessibility-based
full-screen fallback. The behavior is documented, not measured on a notched
Mac.
