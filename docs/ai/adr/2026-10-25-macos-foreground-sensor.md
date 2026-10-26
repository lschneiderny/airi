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
normalization. Task 11's differential against base `851111d69` found zero
mismatches in 12,600 identity, label and category comparisons and 67,320
quiet-pattern comparisons. Windows app ids, labels, categories,
quiet-pattern matching and default lists therefore retain the baseline
behavior; no Windows runtime was available to test.

The macOS sampler identifies the front app through `NSWorkspace`. It uses
`CGWindowListCopyWindowInfo` geometry as the primary full-screen signal,
comparing visible, opaque application windows with active display bounds.
Geometry needs no Accessibility permission. `AXFullScreen` was probed on a real
app window only once, while untrusted (task 5, the owned Firefox kiosk window:
`-25211` at the focused-window stage). The trusted binding-suite probes
targeted the test's own windowless process and stopped at the focused-window
stage with `-25208`. No trusted probe of a real app window was run, so the
attribute's availability remains unverified and the sampler does not use it.

The focused window title is read through the Accessibility API only when
`AXIsProcessTrusted` reports existing trust. If trust is absent, the sample
still reports the app name with an empty title. The sampler does not call a
prompting trust API. Accessibility permission already granted to the launching
app for push-to-talk also permits title reading; there is no separate consent
screen.

The sensor does not read microphone-in-use status. The available CoreAudio
device flag cannot distinguish AIRI's own capture from another application's
capture, so using it to suppress speech could hold the gate permanently. Focus
status is also deferred: `INFocusStatusCenter` requires authorization this app
does not have. The sampler makes no claim to detect Focus or Do Not Disturb.

## Consequences

The Windows contract uses the host-neutral busy field. Mocked Windows behavior
cases passed in Task 12's foreground suite (132 passed and 5 skipped overall).
Task 11's identity suite passed 162 tests and its situation store/sensor suite
passed 101 tests. The Windows real-binding suite was platform-skipped on this
Mac; no Windows runtime test was performed here.

Task 5's native binding probe and task 7's geometry tests ran on a Mac14,7 with
macOS 14.6.1, arm64, one 1680 by 1050 point display, and no notch. The measured
visible Firefox row matched that display's bounds, supporting geometry-first
detection on this setup. Darwin x64 was never exercised; all spikes and tests
ran on arm64. Full-screen behavior on a notched display remains untested.

Accessibility trust was false during the initial binding and geometry probes.
For task 9, trust was later confirmed as 1 in both the worker and a child
process. With trust enabled, the focused-title path matched the controlled
Safari page title, but no title content was retained in the evidence. A frozen
TextEdit sample took 254.937333 ms and passed the 150 to 400 ms assertion. In
50 trusted service reads, p50 was 1.007750 ms, p95 was 3.249584 ms, and the
maximum was 58.562500 ms. These percentiles are measurements, not pass/fail
thresholds. A separate run of 2,000 native samples increased RSS by 11,763,712
bytes, below the 20 MiB test limit.

That native-only RSS result does not establish the same bound for combined
in-process RPC load. Two earlier 2,000-read client/server RPC test runs grew
RSS by 31,604,736 and 25,346,048 bytes, both above 20 MiB, and failed the
assertion. Those failures remain part of the evidence; the native-only pass
does not erase them or prove an end-to-end leak-free guarantee.

Task 12's matched-control memory work consisted of diagnostic probes, not
passing tests: each process exited 1 because cold epochs failed retained
thresholds, and only third-epoch fits are cited. The accelerated active and
null-sampler comparisons and the Vitest memory probes ran in plain Node/Vitest,
with Electron app metrics stubbed and the Eventa client and server in one
process; they are not Electron renderer/main IPC measurements. In epoch 3,
matched residuals were 585.14 bytes per 2,000-call batch for the VM pair,
244,394.67 bytes for the compact pair, and 359,082.67 bytes for the
supplementary repeat, all below the 512 KiB per-batch resolution. The reported
live-allocation total moved from 5,761K to 5,763K over the final 20,000 calls.
This supports a warm plateau at the test's measurement resolution, not an
elapsed-hours soak: 60,000 accelerated calls equal 16.7 hours of call count at
1 Hz, but did not run for 16.7 elapsed hours.

The 20 MiB per-batch bound remains unmet on the service path (cold and
early-warm epochs) and was also exceeded by two native-path epoch-2 batches;
the matched-control third-epoch fits remain below resolution. Across all Task
12 raw runs, 20 batches exceeded 20 MiB (18 service, 2 native). The global
maximum was 44,138,496 bytes (service PID 10244, epoch 2 batch 4, raw row 305).

The three over-bound batches in the final VM active service run (PID 16785)
were:

- Epoch 1, batch 1: raw RSS growth of 23,068,672 bytes.
- Epoch 1, batch 6: raw RSS growth of 38,453,248 bytes, including 33,554,432
  bytes of V8 physical growth. The remaining 4,898,816 bytes are not all
  proven to be V8 growth or retained native references.
- Epoch 2, batch 4 (calls 26,001 to 28,000): raw RSS growth of 43,319,296
  bytes, including 33,554,432 bytes of V8 physical growth as `new_space`
  doubled from 67,108,864 to 100,663,296 bytes. The remaining 9,764,864 bytes
  are not attributed by the current evidence.

The two native-path epoch-2 batch 10 failures were 25,804,800 bytes (PID
10201) and 23,789,568 bytes (PID 10658). These RSS spikes remain failures, not
evidence of a passing 20 MiB bound.

All 20 over-bound batches remain failures. Three production-rate 1 Hz
cadence attempts also failed to provide valid cadence proof:

- The locked-GUI attempt returned 326 non-null samples among 1,441 calls. Its
  partial RSS rose by 6,324,224 bytes at 1,200 logged calls and by 6,455,296
  bytes at the final 1,400-call checkpoint; these values are not evaluated as
  a pass or a bound.
- Path A (bash_124, Node 29226) returned 271 non-null samples and exited 1.
- Path B (bash54, Node 29234) returned 125 non-null samples and exited 1.

Paths A and B overlapped each other and a verifier, so both are
invalid-concurrent-load attempts, not independent cadence measurements.

A separate supplementary 1 Hz Node real-service run completed 2,000 of 2,000
non-null samples over 2,003,180 ms (about 33 minutes), with Accessibility trust
1, an unlocked console throughout, and no skipped ticks. Raw/peak RSS growth
was 11,026,432 bytes and post-GC growth was 11,665,408 bytes, both below the
unchanged 20,971,520-byte bound. Service latency (2,000 calls) had p50/p95/max
of 4.05/4.45/96.69 ms; start-to-start intervals (1,999 intervals) had
p50/p95/max of 1,001.6/1,002.8/1,011.1 ms. Cleanup completed at 02:04:05Z and
the cadence probe source hash was unchanged before and after. This direct Node
service run is not an Electron renderer/main IPC benchmark or an elapsed-hours
soak; it is separate from the 60,000-call accelerated plateau and the historical
cold-bound failures.

Task 9/F3 live Situation checks ran on source predating the F2 fixes and Task
11's renderer identity change. They showed Safari with `busy: accepts`, a
controlled-page title match stored only as a boolean, a fresh Safari preview,
Firefox with `busy: fullscreen`, the sharing-off `stale-signal` hold, and an
`Electron.app` sample marked `ownProcess: true`. These are pre-Task-11 live
observations, not proof of final-tree macOS identity or defaults.

Task 13's final-tree run, with scoped product-source hash
`35e9df9ef5967518264493d8b725495649d7c02d15843965bb7b5ca2614a4236`, verified
both the stage and settings renderers reported `window.platform: darwin` and
the Electron marker. It observed the Activity label `Safari (browser)`,
`busy: accepts`, a non-hard gate decision, a fresh preview, and stored settings
preserved byte-for-byte. It did not repeat Firefox full-screen, sharing-off
`stale-signal`, or live own-process exclusion on the final tree. Task 13 used
Live2D; no Godot sidecar focus result is claimed. Screenshots masked titles
and no window-title content was retained.

Task 9's foreground suite passed 129 tests with 4 skips (133 total), including
the platform-skipped Windows real-binding suite; its opt-in frozen scenario
passed separately. A later Task 12 foreground suite recorded 132 passed and
5 skipped (137 total). These are separate runs; 129/4 is not the final suite
count. The coordinated full-branch `pnpm verify --base 851111d69` exited 0 on
source hash `9e1103e2d2950f1cf0c2127322bf377484976c8e`: typecheck passed in
22.3 s, lint passed in 3.9 s over 32 changed files, and related test groups of
464, 107, 410, and 28 passed. Later documentation-only verifies are separate
receipts. Darwin x64 was not exercised. Full-screen
behavior on a notched display remains untested. `AXFullScreen` remains
unverified; the trusted task 9 checks verified title reading, not that
attribute.

On a notched display, native full screen may stop below the camera band, so the
geometry check may miss it and the sample may report `accepts`. This limitation
applies regardless of Accessibility trust: the sampler does not read
`AXFullScreen` and has no Accessibility-based full-screen fallback. The behavior
is documented, not measured on a notched Mac.
