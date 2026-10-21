import { createMotionQaDispatcher } from '@proj-airi/stage-shared/motion-scenario'

/**
 * Installs `globalThis.__airiMotionQa`, the entry point remote-debug clients call through CDP `Runtime.evaluate`.
 *
 * Use when:
 * - `main.ts` found the dev-only bridge flag; it imports this module lazily, so production bundles never contain it
 *
 * Returns:
 * - Nothing. `dispatch(json)` resolves to a JSON reply `{ ok: true, result } | { ok: false, error }` and never rejects.
 */
export function installMotionQaDispatcher() {
  Object.assign(globalThis, { __airiMotionQa: { dispatch: createMotionQaDispatcher() } })
}
