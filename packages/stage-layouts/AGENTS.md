# Stage Layouts Guide

## CONVENTIONS

- Import explicit manifest subpaths. The root entry only emits a warning.
- The warning suggests `/pages`, but the manifest does not export that subpath.
- `AdaptiveInput` batches measurements with animation frames and owns listeners through an AbortController.
- Keep reference viewport height stable during focus. Dispose the controller when its region is released.
- Floating keyboards shift only horizontally intersecting regions.
- Background transitions preserve mounted slots and manage uploaded Blob URLs.
- Chat submit modes account for IME, pending voice, and recording state.
- Visible-session replacement and stopping the latest response are separate decisions.

## ANTI-PATTERNS

- Do not remove Safari viewport workarounds without satisfying their documented removal conditions.
- Do not let analytics prevent mute when an auxiliary renderer loses its output host.
- Do not change theme tabs to unequal widths while the indicator uses equal shares.
- Do not leave object URLs or browser style changes owned by an unmounted layout.

## CHECKS

- The test configuration uses jsdom and resolves `~build/*` through `unplugin-info/vite`.
