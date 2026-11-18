/**
 * Turbo arguments that run the `test:run` script of every workspace package, each with its node and browser projects.
 *
 * Packages run one at a time, so each Vitest process may use the whole CPU lease it inherits. Three packages at once
 * cut the full suite from 11 to 6 minutes in one run (2026-11-18), but every process then needs a share of the lease
 * instead of the whole grant, and overlapping browser suites are unproven. Raise the concurrency only together with a
 * per-process worker share.
 *
 * A failed package does not stop the others, so one run reports every failure. Only packages that really ran print
 * their output; a cache hit prints one line.
 */
export const testRunTurboArgs = ['run', 'test:run', '--concurrency=1', '--continue=dependencies-successful', '--output-logs=new-only']

/** Packages that hold test files which `pnpm test:run` deliberately does not run, and why. */
export const testRunExclusions: Readonly<Record<string, string>> = {
  'apps/component-calling': 'Kept from upstream, which ships its one test file without a Vitest config, a vitest dependency, or a test script.',
}

export interface WorkspaceManifest {
  /** The package directory, relative to the repository root with `/`. */
  path: string
  scripts: Record<string, string>
}

/**
 * Finds the tests that no runner runs. A test file inside a workspace package needs that package to have a `test:run`
 * script, because Turbo runs nothing else. A test file outside every package needs to sit under `scripts/`, which the
 * root Vitest config covers.
 *
 * Returns:
 * - The package directories and root files that are neither run nor listed in `testRunExclusions`.
 */
export function testsWithoutRunner(testFiles: string[], packages: WorkspaceManifest[]): string[] {
  const byDepth = [...packages].sort((a, b) => b.path.length - a.path.length)
  const missing = new Set<string>()
  for (const file of testFiles) {
    const owner = byDepth.find(candidate => file.startsWith(`${candidate.path}/`))
    if (!owner) {
      if (!file.startsWith('scripts/'))
        missing.add(file)
    }
    else if (!owner.scripts['test:run'] && !(owner.path in testRunExclusions)) {
      missing.add(owner.path)
    }
  }
  return [...missing].sort()
}
