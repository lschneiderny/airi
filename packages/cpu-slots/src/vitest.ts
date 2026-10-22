import type { Plugin, ViteUserConfig } from 'vitest/config'

import type { CpuClass } from './classes'

import process from 'node:process'

import { acquire, processState } from './acquire'
import { parseBudget } from './budget'
import { classes } from './classes'
import { assertFreshBuild } from './stale-build'

type TestConfig = NonNullable<ViteUserConfig['test']>

/**
 * An explicit watch request takes no lease, since the session would hold it until the user quits.
 * Vitest decides its default (watch in a TTY outside agents and CI) after config loading, so the plugin
 * below hands the lease back then.
 */
function requestsWatch(): boolean {
  const args = process.argv.slice(2)
  return /vitest/i.test(process.argv[1] ?? '') && args.some(arg => arg === 'watch' || arg === '--watch' || arg === '--watch=true')
}

type Project = NonNullable<TestConfig['projects']>[number]
type InlineProject = Exclude<Project, string | Promise<unknown> | ((...args: never[]) => unknown)>

function isInline(project: Project): project is InlineProject {
  return typeof project === 'object' && project !== null && !(project instanceof Promise)
}

function detectClass(config: ViteUserConfig): CpuClass {
  const browser = config.test?.browser?.enabled === true
    || (config.test?.projects ?? []).some(project => isInline(project) && project.test?.browser?.enabled === true)
  return browser ? 'browser' : 'test'
}

function clamp(test: TestConfig | undefined, grant: number, add: boolean): TestConfig {
  const next: TestConfig = { ...test }
  if (typeof next.maxWorkers === 'number')
    next.maxWorkers = Math.min(next.maxWorkers, grant)
  else if (add && next.maxWorkers === undefined)
    next.maxWorkers = grant
  if (next.projects) {
    next.projects = next.projects.map((project) => {
      if (!isInline(project) || typeof project.test?.maxWorkers !== 'number')
        return project
      return { ...project, test: { ...project.test, maxWorkers: Math.min(project.test.maxWorkers, grant) } }
    })
  }
  return next
}

/**
 * Caps Vitest workers to the CPU slot grant.
 *
 * Only `maxWorkers` is touched (plus one plugin that releases the lease in watch mode). The first wrapped config in a process (the root) gets `maxWorkers`
 * when it has none; later configs are projects and are only clamped downward, because project limits
 * win over root limits and adding one would split Vitest's sequence groups.
 */
export function withCpuSlots(config: ViteUserConfig): () => Promise<ViteUserConfig> {
  return async () => {
    assertFreshBuild()
    const state = processState()
    const first = state.vitestGrant === undefined
    if (requestsWatch()) {
      if (process.env.CI || process.env.AIRI_CPU_SLOTS === 'off')
        return config
      // Without a lease, the grant a free store would give this class caps the workers.
      state.vitestGrant ??= Math.min(classes[detectClass(config)].max, parseBudget())
      return { ...config, test: clamp(config.test, state.vitestGrant, first) }
    }
    const lease = await acquire({ class: detectClass(config), cwd: process.cwd(), command: `vitest ${process.argv.slice(2).join(' ')}`.trim() })
    if (lease.grant === null)
      return config
    // Every bundled copy of this module shares the process state, so one process makes one choice.
    if (state.vitestGrant === undefined) {
      const parent = lease.env.AIRI_CPU_CLASS
      const advertised = Number(process.env.AIRI_CPU_GRANT)
      // Gate and exclusive parents size their child runs explicitly, so their grant passes through.
      state.vitestGrant = lease.inherited && (parent === 'gate' || parent === 'exclusive') && Number.isSafeInteger(advertised) && advertised > 0
        ? advertised
        : lease.grant
    }
    const releaseInWatchMode: Plugin = {
      name: 'cpu-slots:release-in-watch-mode',
      configureVitest({ vitest }) {
        // A watch session lives until the user quits, so it must not hold a lease that long.
        if (vitest.config.watch)
          lease.release()
      },
    }
    return { ...config, plugins: [...(config.plugins ?? []), releaseInWatchMode], test: clamp(config.test, state.vitestGrant, first) }
  }
}
