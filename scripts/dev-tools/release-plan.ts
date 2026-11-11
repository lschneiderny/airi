/** One desktop platform the fork releases from: the machine that runs `pnpm release` builds for itself. */
export interface ReleaseTarget {
  /** Godot export preset name in `engines/stage-tamagotchi-godot/export_presets.cfg`. */
  godotPreset: string
  /** Directory under the engine's `out/` that electron-builder copies as `${os}`. */
  godotOutDir: string
  godotFile: string
  builderFlag: string
}

/** Windows is deferred, so it has no release target. */
export function releaseTarget(platform: NodeJS.Platform, arch: NodeJS.Architecture): ReleaseTarget | undefined {
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64'))
    return { godotPreset: `Linux ${arch}`, godotOutDir: 'linux', godotFile: 'godot-stage', builderFlag: '--linux' }
  if (platform === 'darwin')
    return { godotPreset: 'macOS', godotOutDir: 'mac', godotFile: 'godot-stage.app', builderFlag: '--mac' }
  return undefined
}

export interface ReleaseArgs {
  version: string
  dryRun: boolean
}

/** Calendar versions such as `2026.11.0`: year, month without a leading zero, and a release counter. */
export function isReleaseVersion(version: string): boolean {
  return /^20\d{2}\.(?:[1-9]|1[0-2])\.(?:0|[1-9]\d*)$/.test(version)
}

export function releaseTag(version: string): string {
  return `v${version}`
}

export function parseReleaseArgs(argv: string[]): ReleaseArgs | { error: string } {
  const dryRun = argv.includes('--dry-run')
  const positional = argv.filter(arg => arg !== '--dry-run' && arg !== '--')
  const unknown = positional.filter(arg => arg.startsWith('-'))
  if (unknown.length)
    return { error: `unknown option ${unknown.join(', ')}` }
  if (positional.length !== 1)
    return { error: 'expected exactly one version, for example `pnpm release 2026.11.0`' }
  const [version] = positional
  if (!isReleaseVersion(version))
    return { error: `${version} is not a release version; use <year>.<month>.<n>, for example 2026.11.0` }
  return { version, dryRun }
}

export interface GitState {
  branch: string
  /** Tracked files with changes; untracked files do not reach the build. */
  dirty: boolean
  head: string
  originHead: string
}

export function checkGitState(state: GitState): string[] {
  const errors: string[] = []
  if (state.branch !== 'main')
    errors.push(`release from main, not ${state.branch}`)
  if (state.dirty)
    errors.push('commit or stash tracked changes first')
  if (state.head !== state.originHead)
    errors.push('main must match origin/main; push or pull first')
  return errors
}

export interface ExistingRelease {
  isDraft: boolean
  targetCommitish: string
}

/**
 * The second platform adds its files to the draft the first one created, so both must build the same commit.
 * A published release is final.
 */
export function checkExistingRelease(existing: ExistingRelease | undefined, head: string): string | undefined {
  if (!existing)
    return undefined
  if (!existing.isDraft)
    return 'this release is already published; pick the next version'
  if (existing.targetCommitish !== head)
    return `the draft targets ${existing.targetCommitish}, but HEAD is ${head}; build every platform from the same commit`
  return undefined
}

/** Installers plus the `latest-*.yml` feeds and blockmaps that electron-updater reads. */
export function isReleaseArtifact(fileName: string): boolean {
  return /\.(?:deb|rpm|dmg|zip|blockmap)$/.test(fileName) || /^latest.*\.yml$/.test(fileName)
}
