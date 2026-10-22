import type { ViteUserConfig } from 'vitest/config'

import type { CpuClass } from './classes'

import process from 'node:process'

import { acquire } from './acquire'

type TestConfig = NonNullable<ViteUserConfig['test']>

/** The grant chosen by this process's first wrapped config; later configs are projects and reuse it. */
let chosenGrant: number | undefined

function isWatchMode(config: ViteUserConfig): boolean {
  const watch = config.test?.watch
  if (typeof watch === 'boolean')
    return watch
  const args = process.argv.slice(2)
  if (!/vitest/i.test(process.argv[1] ?? ''))
    return false
  return !args.some(arg => arg === 'run' || arg === 'related' || arg === '--run' || arg === '--watch=false')
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
 * Only `maxWorkers` is touched. The first wrapped config in a process (the root) gets `maxWorkers`
 * when it has none; later configs are projects and are only clamped downward, because project limits
 * win over root limits and adding one would split Vitest's sequence groups.
 */
export function withCpuSlots(config: ViteUserConfig): () => Promise<ViteUserConfig> {
  return async () => {
    if (isWatchMode(config))
      return config
    const lease = await acquire({ class: detectClass(config), cwd: process.cwd(), command: `vitest ${process.argv.slice(2).join(' ')}`.trim() })
    if (lease.grant === null)
      return config
    const first = chosenGrant === undefined
    if (first) {
      const parent = lease.env.AIRI_CPU_CLASS
      const advertised = Number(process.env.AIRI_CPU_GRANT)
      // Gate and exclusive parents size their child runs explicitly, so their grant passes through.
      chosenGrant = lease.inherited && (parent === 'gate' || parent === 'exclusive') && Number.isSafeInteger(advertised) && advertised > 0
        ? advertised
        : lease.grant
    }
    return { ...config, test: clamp(config.test, chosenGrant!, first) }
  }
}
