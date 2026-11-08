/** Expected cancellation when a user closes a window before its creation finishes. */
export class WindowClosedDuringCreationError extends Error {
  constructor() {
    super('Window closed during creation')
    this.name = 'WindowClosedDuringCreationError'
  }
}

/** Open commands have no window to show after cancellation; other failures must still reach the caller. */
export function ignoreWindowClosedDuringCreation(error: unknown): undefined {
  if (!(error instanceof WindowClosedDuringCreationError))
    throw error
}
