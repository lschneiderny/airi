/** The one member of a `BrowserWindow` that the close scope uses, so a test double can stay small. */
interface ClosableWindow {
  once: (event: 'closed', listener: () => void) => unknown
}

const scopes = new WeakMap<ClosableWindow, Array<() => void>>()

/**
 * Runs `callback` once when `window` has closed, and returns the function that cancels it.
 *
 * Use it instead of `window.on('closed', ...)` and `window.once('closed', ...)` in the main process. Each window
 * service cleans up when its window closes. With one listener per service, a window passed Node's default limit of
 * 10 listeners per event. All callbacks of a window share one real `closed` listener here.
 *
 * Callbacks run in the order of their registration. A callback that throws does not stop the callbacks after it:
 * they all run, and then the error is thrown again. Several errors are thrown as one `AggregateError`.
 *
 * As with the Electron event, the window is already destroyed when the callbacks run, and a callback registered
 * after the window closed never runs.
 */
export function onWindowClosed(window: ClosableWindow, callback: () => void): () => void {
  let callbacks = scopes.get(window)
  if (!callbacks) {
    const created: Array<() => void> = []
    callbacks = created
    scopes.set(window, created)
    window.once('closed', () => {
      scopes.delete(window)
      runAll(created)
    })
  }

  // One entry per registration: a function that is registered twice runs twice, and each cancel removes one entry.
  const entry = () => callback()
  const registered = callbacks
  registered.push(entry)
  return () => {
    const index = registered.indexOf(entry)
    if (index !== -1)
      registered.splice(index, 1)
  }
}

function runAll(callbacks: Array<() => void>): void {
  const errors: unknown[] = []
  // A callback can cancel another one while they run. As with an event emitter, this run still calls it.
  for (const callback of callbacks.slice()) {
    try {
      callback()
    }
    catch (error) {
      errors.push(error)
    }
  }

  if (errors.length === 1)
    throw errors[0]
  if (errors.length > 1)
    throw new AggregateError(errors, 'Several window close callbacks failed')
}
