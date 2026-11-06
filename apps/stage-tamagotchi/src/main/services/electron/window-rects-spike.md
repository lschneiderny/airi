# Window-rect sensor spike: measurements

`window-rects-spike.ts` is an env-gated measurement spike, not the product sensor. It runs only on Windows with `AIRI_WINDOW_SENSOR_SPIKE=1`. This file records what the 2026-11-04 measurement found, so the M4 sensor design starts from data.

## Setup

- Plain Node with koffi, walking the windows in a `worker_threads` worker.
- `EnumWindows`, filtered to windows that are visible, not cloaked, not minimized, and have a non-empty rectangle.
- Rectangles from the DWM extended frame bounds (`DWMWA_EXTENDED_FRAME_BOUNDS`).
- Sampled at 4 Hz.

## Results

| Measure | Value |
| --- | --- |
| Top-level windows walked | about 400 |
| Windows kept after the filter | 6 to 17 |
| Sample time, p50 | about 0.75 ms |
| Sample time, p95 | about 1.8 ms |
| Sample time, max | 3.4 to 4.4 ms |
| Worker CPU | under 0.5% of one core |
| Main-thread event-loop delay, p99 | about 16.7 ms, equal to the baseline without the worker |
| DWM frame-bound failures | 0 |

## Conclusions

- A 4 Hz worker poll leaves the main thread unaffected and costs almost nothing, so the sensor can poll.
- Freshness is bounded by the sampling period, about 250 ms.
- The rectangles are physical pixels. Convert them to DIP (`screen.screenToDipRect`) before comparing them with Electron bounds.
- `SetWinEventHook` would push changes instead of polling, but it needs a message pump on the hooking thread. A worker has none, so polling stays.
