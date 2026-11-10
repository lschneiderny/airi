---
name: enforce-rules-for-vitest
description: Apply AIRI test-scope, regression, async, and runtime-boundary rules when changing or diagnosing tests.
---

# AIRI Tests

For check selection, see the [testing guide](../../../docs/ai/testing.md).

Do not add tests for pure prose or assertions that only restate setup and constants.

## Regression Coverage

- When practical, reproduce the reported failure before changing production code. Confirm it fails for the reported reason.
- If a tracker or report exists, retain a concise reference when it explains the regression.
- Test through supported public behavior. Do not export internals or add dependency wrappers solely for tests.
- Keep tests deterministic. Subscribe to the exact completion event before triggering asynchronous work, with a bounded timeout.
- Do not use fixed sleeps or polling delays. When time itself is the contract, use controlled time.

## Vue and Browser Behavior

- Assert props, emitted events, and visible results rather than private component state.
- Use real Pinia behavior when store integration is under test. Control its initial state.
- Mount lifecycle-dependent composables in a host component and unmount after the test.
- Await Vue updates and the actual async completion signal before assertions.
- For async setup, use Suspense. For Teleport, create and clean up the destination.
- Prefer browser mode for behavior that depends on real DOM or Web Platform APIs.
- Add interaction assertions rather than relying on snapshots alone.

## Visual Baselines

- Use visual baselines only for deterministic component states: no animation, timer, network, or random input. They add to interaction assertions; they do not replace them.
- Follow `packages/stage-ui/README.md#visual-baselines`. Name files `*.visual.browser.test.ts` and render through `renderVisualBaseline` from `packages/stage-ui/src/test/visual-baseline.ts`.
- Tolerance lives in `browser.expect.toMatchScreenshot` of the package Vitest config. Do not pass per-test comparator options.
- Update references with `--update` only for an intended visual change. Inspect every changed image and commit it with that change.
- Never commit references for a platform you did not run on. To add a platform, add it to `referencePlatforms` in the same commit as its reviewed references.

## Mocks and Runtime Boundaries

- In unit tests, mock external providers, Electron IPC, and services at their boundaries.
- Use the real Electron runtime when an integration test or live reproduction needs its lifecycle behavior.
- Stub unrelated child components or stores only when their behavior is outside the assertion.
- Do not replace the integration being tested with mocks that make its failure impossible.
- Keep external-service integration tests separate and controlled by explicit environment configuration.
- For Node global or built-in isolation, use a worker or minimal CLI reproduction instead of replacing global properties directly.
- Use a real browser when a platform mock prevents the test from exercising the reported failure.

## Import Integrity

Do not use mocks, hoisting, dynamic imports, casts, or alternate test-only paths to hide a production import failure.
Inspect package exports, declarations, import-time side effects, runtime mixing, and circular dependencies.
Keep consumers and tests on the same supported boundary.
