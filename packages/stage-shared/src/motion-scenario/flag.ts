/**
 * True only when the renderer set the dev-only flag before mounting the stage.
 *
 * Kept apart from the bridge contracts: callers guard this check with `import.meta.env.DEV`, so in a
 * production build the import is unused and this module, unlike the contract module, drops out entirely.
 */
export function isMotionQaBridgeEnabled(): boolean {
  return (globalThis as { __airiMotionQaEnabled?: unknown }).__airiMotionQaEnabled === true
}
