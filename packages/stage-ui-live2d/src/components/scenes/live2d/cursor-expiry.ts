/** Idle time after which a non-Natural driver drops the last reported cursor. */
export const CURSOR_EXPIRY_MS = 1000

export interface CursorExpiry {
  /** Call when the host reports (or clears) a cursor. */
  onCursor: (driver: string, hasCursor: boolean) => void
  /** Call when the motion driver changes; `hasCursor` is whether a cursor is currently active. */
  onDriverChange: (previous: string, next: string, hasCursor: boolean) => void
  dispose: () => void
}

/**
 * Owns the cursor-expiry timer for Live2D.vue.
 *
 * Natural eases its own attention, so it never expires the cursor; every other driver
 * clears it `CURSOR_EXPIRY_MS` after the last cursor report.
 */
export function createCursorExpiry(clear: () => void): CursorExpiry {
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancel() {
    if (timer)
      clearTimeout(timer)
    timer = undefined
  }

  function arm() {
    cancel()
    timer = setTimeout(() => {
      timer = undefined
      clear()
    }, CURSOR_EXPIRY_MS)
  }

  return {
    onCursor(driver, hasCursor) {
      cancel()
      if (driver === 'natural' || !hasCursor)
        return
      arm()
    },
    onDriverChange(previous, next, hasCursor) {
      if (next === 'natural') {
        // Natural owns cursor recency, so a pending expiry must not clear its cursor.
        cancel()
        return
      }
      // Leaving Natural: its cursor has no timer, so start the window as if the cursor just moved.
      if (previous === 'natural' && hasCursor)
        arm()
    },
    dispose: cancel,
  }
}
