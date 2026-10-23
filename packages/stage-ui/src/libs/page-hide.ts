/**
 * The page-hide work of one window, in the order it runs:
 *
 * 1. `release-host`: a cross-window host leaves, for example the voice output host. Other windows learn at once that
 *    it is gone, and the requests it still holds end unanswered instead of failed.
 * 2. `dispose-runtime`: the synchronization runtime closes, so this window answers no synced call after this point.
 */
export type PageHideStage = 'release-host' | 'dispose-runtime'

const STAGES: readonly PageHideStage[] = ['release-host', 'dispose-runtime']

const callbacks: Record<PageHideStage, Set<() => void>> = {
  'release-host': new Set(),
  'dispose-runtime': new Set(),
}

let listening = false

function runStages() {
  for (const stage of STAGES) {
    const due = [...callbacks[stage]]
    callbacks[stage].clear()
    for (const callback of due) {
      // One failing participant must not keep the later stages from running.
      try {
        callback()
      }
      catch (error) {
        reportError(error)
      }
    }
  }
}

/**
 * Runs `callback` once when the page hides, for example on a reload or when its window closes, in the order of
 * {@link PageHideStage}. Returns a function that cancels it.
 *
 * Every stage runs inside one `pagehide` listener call. A browser runs a microtask checkpoint after each listener, so
 * with one listener per participant, the promise reactions that a released host starts would run before the runtime
 * closed. In one call, no promise reaction runs until every stage has finished, so the closed runtime cannot answer a
 * caller with a failure that the host release caused. The caller's call stays pending, and tab-election delivers it
 * again to the next leader.
 *
 * Use when:
 * - Page-hide work must run before or after another participant's, for example a host release before the synced
 *   runtime closes.
 */
export function onPageHide(stage: PageHideStage, callback: () => void): () => void {
  if (!listening) {
    window.addEventListener('pagehide', runStages)
    listening = true
  }
  callbacks[stage].add(callback)
  return () => callbacks[stage].delete(callback)
}
