import buildTime from '~build/time'

import { abbreviatedSha, branch } from '~build/git'

import packageJSON from '../../package.json'

export function useBuildInfo() {
  const version = packageJSON.version ?? 'dev'

  return {
    version,
    commit: abbreviatedSha,
    branch,
    builtOn: buildTime.toISOString(),
  }
}
