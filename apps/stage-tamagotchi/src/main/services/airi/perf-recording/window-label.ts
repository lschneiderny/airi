export type PerfWindowLabel = 'stage-main' | 'stage' | 'chat' | 'settings' | 'devtools' | 'widgets' | 'other'

/** The windows whose renderer samples frames and answers rollup pulls: the classic main window and the desktop stage. */
export const STAGE_WINDOW_LABELS: ReadonlySet<PerfWindowLabel> = new Set(['stage-main', 'stage'])

/**
 * Names an app window by its renderer hash route, so records never carry its URL.
 *
 * Only the first route segment counts, and the query is ignored: `#/settings/system` is `settings`.
 * A URL without a hash route, such as a DevTools page, is `other`.
 */
export function windowLabelFromUrl(url: string): PerfWindowLabel {
  const hashIndex = url.indexOf('#')
  if (hashIndex === -1)
    return 'other'
  const route = url.slice(hashIndex + 1).split('?')[0]
  if (!route.startsWith('/'))
    return 'other'

  switch (route.slice(1).split('/')[0]) {
    case '':
      return 'stage-main'
    case 'stage':
      return 'stage'
    case 'chat':
    case 'chat-floating':
      return 'chat'
    case 'settings':
      return 'settings'
    case 'devtools':
      return 'devtools'
    case 'widgets':
      return 'widgets'
    default:
      return 'other'
  }
}
