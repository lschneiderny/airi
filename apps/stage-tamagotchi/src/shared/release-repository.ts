/**
 * GitHub repository that publishes the fork's desktop releases.
 *
 * electron-builder writes its update metadata for this repository, and the
 * packaged app's updater reads releases from it.
 */
export const releaseRepository = {
  owner: 'lschneiderny',
  repo: 'airi',
} as const
