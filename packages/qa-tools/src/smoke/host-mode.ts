import { stripVTControlCharacters } from 'node:util'

export type SmokeHostMode = 'window' | 'desktop'

const hostModeLine = /Building the (desktop stage|classic window) host/

/**
 * Checks that the app ran the expected host: the main process logged that host mode, and the attached windows match
 * it. The classic window host has a `#/` stage window and never a `#/stage` window; the desktop stage host has a
 * `#/stage` window. `targets` are the `targetLabel` values of every window the error collector attached to during the
 * run. Returns the failure, or `undefined` when the run matches.
 */
export function checkHostMode(expected: SmokeHostMode, appLog: string, targets: readonly string[]): string | undefined {
  const logged = hostModeLine.exec(stripVTControlCharacters(appLog))?.[1]
  if (!logged)
    return 'the app never logged which stage host it built'
  const expectedName = expected === 'desktop' ? 'desktop stage' : 'classic window'
  if (logged !== expectedName)
    return `expected the ${expectedName} host, the app built the ${logged} host`
  if (expected === 'window' && targets.includes('#/stage'))
    return 'expected the classic window host, but a #/stage window existed'
  if (expected === 'window' && !targets.includes('#/'))
    return 'expected the classic window host, but no #/ window was attached'
  if (expected === 'desktop' && !targets.includes('#/stage'))
    return 'expected the desktop stage host, but no #/stage window was attached'
  return undefined
}
