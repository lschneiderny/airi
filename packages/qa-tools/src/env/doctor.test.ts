import type { DoctorProbes, DoctorRow, WarmRunResult } from './doctor'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSystemProbes, runDoctor, runWarm } from './doctor'

const cubismPaths = [
  'apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js',
  'apps/stage-web/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js',
]

function healthyProbes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    nodeVersion: () => 'v26.7.3',
    readToolVersions: () => 'nodejs 26.7.0\npnpm   11.24.0\n',
    resolvePnpm: () => ({ version: '11.24.0', entry: '/pnpm/bin/pnpm.mjs' }),
    exists: () => true,
    packageManifests: () => [
      { dir: 'packages/i18n', exports: { '.': { types: './dist/index.d.mts', default: './dist/index.mjs' } } },
      { dir: 'packages/source-only', exports: { '.': './src/index.ts' } },
    ],
    newestMtime: dir => dir === 'packages/i18n/dist' ? 2000 : 1000,
    chromiumExecutable: () => '/ms-playwright/chromium/chrome',
    existsAbsolute: () => true,
    env: { AIRI_QA_RIG_FORBOOTH: '/rigs/forbooth', AIRI_QA_RIG_BEAR: '/rigs/bear' },
    listRig: () => ({ isDirectory: true, models: ['model/rig.model3.json'] }),
    listProcesses: async () => [{ pid: 7, commandLine: 'node vitest run' }],
    repoRoot: 'C:/repo',
    ...overrides,
  }
}

async function rowOf(id: string, probes: DoctorProbes): Promise<DoctorRow> {
  const row = (await runDoctor(probes)).find(candidate => candidate.id === id)
  if (!row)
    throw new Error(`no ${id} row`)
  return row
}

describe('runDoctor', () => {
  it('reports every check in order and all ok for a healthy checkout', async () => {
    const rows = await runDoctor(healthyProbes())

    expect(rows.map(row => row.id)).toEqual(['node-version', 'pnpm', 'install', 'built-packages', 'cubism-core', 'playwright', 'rigs', 'stray-electron'])
    expect(rows.map(row => row.status)).toEqual(Array.from({ length: 8 }).fill('ok'))
  })

  it('node-version fails on a major.minor mismatch or a missing pin', async () => {
    expect((await rowOf('node-version', healthyProbes({ nodeVersion: () => 'v26.6.0' }))).status).toBe('fail')
    expect((await rowOf('node-version', healthyProbes({ readToolVersions: () => undefined }))).status).toBe('fail')
    expect((await rowOf('node-version', healthyProbes({ readToolVersions: () => 'pnpm 11.24.0\n' }))).status).toBe('fail')
  })

  it('pnpm fails with the resolver message when resolution throws', async () => {
    const row = await rowOf('pnpm', healthyProbes({ resolvePnpm: () => {
      throw new Error('Expected entry: /missing/pnpm.mjs')
    } }))

    expect(row).toMatchObject({ status: 'fail', detail: 'Expected entry: /missing/pnpm.mjs' })
  })

  it('install fails with the frozen-lockfile fix when .modules.yaml is missing', async () => {
    const row = await rowOf('install', healthyProbes({ exists: path => path !== 'node_modules/.modules.yaml' }))

    expect(row).toMatchObject({ status: 'fail', fix: 'pnpm install --frozen-lockfile' })
  })

  it('built-packages fails on a missing dist export and names the file', async () => {
    const row = await rowOf('built-packages', healthyProbes({ exists: path => path !== 'packages/i18n/dist/index.mjs' }))

    expect(row.status).toBe('fail')
    expect(row.detail).toContain('packages/i18n/dist/index.mjs')
    expect(row.fix).toBe('pnpm run build:packages')
  })

  it('built-packages checks the directory of a subpath pattern export', async () => {
    const manifests = () => [{ dir: 'packages/font', exports: { './files/*': './dist/files/*', './files/*.ttf': './dist/files/*.ttf' } }]
    const present = await rowOf('built-packages', healthyProbes({ packageManifests: manifests, exists: path => path === 'packages/font/dist/files' }))
    const absent = await rowOf('built-packages', healthyProbes({ packageManifests: manifests, exists: path => path !== 'packages/font/dist/files' }))

    expect(present.status).toBe('ok')
    expect(absent).toMatchObject({ status: 'fail', detail: 'missing dist files: packages/font/dist/files' })
  })

  it('built-packages ignores types-only conditions', async () => {
    const row = await rowOf('built-packages', healthyProbes({ exists: path => path !== 'packages/i18n/dist/index.d.mts' }))

    expect(row.status).toBe('ok')
  })

  it('built-packages ignores exports that do not point into ./dist/', async () => {
    const row = await rowOf('built-packages', healthyProbes({ exists: path => !path.startsWith('packages/source-only') }))

    expect(row.status).toBe('ok')
  })

  it('built-packages fails when i18n dist is older than the English yaml or missing', async () => {
    const stale = await rowOf('built-packages', healthyProbes({ newestMtime: dir => dir === 'packages/i18n/dist' ? 1000 : 2000 }))
    const missing = await rowOf('built-packages', healthyProbes({ newestMtime: dir => dir === 'packages/i18n/dist' ? undefined : 2000 }))

    expect(stale).toMatchObject({ status: 'fail', fix: 'pnpm -F @proj-airi/i18n build' })
    expect(missing.status).toBe('fail')
  })

  it('cubism-core fails per missing copy and names the downloading plugin', async () => {
    for (const absent of cubismPaths) {
      const row = await rowOf('cubism-core', healthyProbes({ exists: path => path !== absent }))

      expect(row.status).toBe('fail')
      expect(row.detail).toContain(absent)
      expect(row.fix).toContain('DownloadLive2DSDK')
      const app = absent.split('/')[1]
      const otherApp = app === 'stage-web' ? 'stage-tamagotchi' : 'stage-web'
      expect(row.fix).toContain(`pnpm -F @proj-airi/${app} dev`)
      expect(row.fix).not.toContain(`pnpm -F @proj-airi/${otherApp} dev`)
    }
  })

  it('playwright warns when Chromium is missing or playwright-core is unresolvable', async () => {
    const missing = await rowOf('playwright', healthyProbes({ existsAbsolute: () => false }))
    const unresolved = await rowOf('playwright', healthyProbes({ chromiumExecutable: () => undefined }))

    expect(missing).toMatchObject({ status: 'warn', fix: 'pnpm exec playwright install chromium' })
    expect(unresolved.status).toBe('warn')
  })

  it('rigs warns when unset and fails naming the path when set but invalid', async () => {
    const unset = await rowOf('rigs', healthyProbes({ env: {} }))
    const notDir = await rowOf('rigs', healthyProbes({ env: { AIRI_QA_RIG_FORBOOTH: 'C:/nonexistent' }, listRig: () => ({ isDirectory: false, models: [] }) }))
    const noModel = await rowOf('rigs', healthyProbes({ listRig: () => ({ isDirectory: true, models: [] }) }))

    expect(unset.status).toBe('warn')
    expect(notDir.status).toBe('fail')
    expect(notDir.detail).toContain('C:/nonexistent')
    expect(noModel.status).toBe('fail')
  })

  it('stray-electron warns with the PIDs of this worktree\'s stage-tamagotchi electron processes only', async () => {
    const row = await rowOf('stray-electron', healthyProbes({ listProcesses: async () => [
      { pid: 41, commandLine: 'C:\\repo\\apps\\stage-tamagotchi\\node_modules\\Electron\\dist\\electron.exe .' },
      { pid: 42, commandLine: 'node electron-vite dev' },
      { pid: 43, commandLine: 'node apps/stage-tamagotchi/scripts/build.js' },
      { pid: 44, commandLine: 'C:\\repo-other\\apps\\stage-tamagotchi\\node_modules\\Electron\\dist\\electron.exe .' },
    ] }))

    expect(row.status).toBe('warn')
    expect(row.detail).toContain('41')
    expect(row.detail).not.toMatch(/42|43|44/)
  })

  it('stray-electron is ok when only other worktrees run stage-tamagotchi electron', async () => {
    const row = await rowOf('stray-electron', healthyProbes({ listProcesses: async () => [
      { pid: 44, commandLine: 'C:\\repo-other\\apps\\stage-tamagotchi\\node_modules\\Electron\\dist\\electron.exe .' },
    ] }))

    expect(row.status).toBe('ok')
  })

  it('turns a throwing probe into a fail row and still runs later checks', async () => {
    const rows = await runDoctor(healthyProbes({ packageManifests: () => {
      throw new Error('EACCES packages')
    } }))

    expect(rows.find(row => row.id === 'built-packages')).toMatchObject({ status: 'fail', detail: 'probe threw: EACCES packages' })
    expect(rows).toHaveLength(8)
  })

  describe('with a hung probe', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('reports the hung check as fail after the bound instead of hanging', async () => {
      const result = runDoctor(healthyProbes({ listProcesses: () => new Promise(() => {}) }), { timeoutMs: 500 })
      await vi.advanceTimersByTimeAsync(500)
      const rows = await result

      expect(rows.find(row => row.id === 'stray-electron')).toMatchObject({ status: 'fail', detail: 'probe did not finish within 500 ms' })
    })
  })
})

describe('runWarm', () => {
  function runs(...results: WarmRunResult[]) {
    return vi.fn(async () => {
      const next = results.shift()
      if (!next)
        throw new Error('unexpected extra warm run')
      return next
    })
  }

  it('reports warm: ok when the first run passes', async () => {
    const run = runs({ exitCode: 0, output: '' })

    expect(await runWarm(run)).toMatchObject({ id: 'warm', status: 'ok', detail: 'warm: ok' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('reruns once after the optimizer reload and reports warm: ok after reload', async () => {
    const run = runs({ exitCode: 1, output: '[vite] optimized dependencies changed. reloading' }, { exitCode: 0, output: '' })

    expect(await runWarm(run)).toMatchObject({ status: 'ok', detail: 'warm: ok after reload' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('reports any other failure verbatim without a rerun', async () => {
    const run = runs({ exitCode: 1, output: 'AssertionError: expected 1 to be 2\n' })

    expect(await runWarm(run)).toMatchObject({ status: 'fail', detail: 'AssertionError: expected 1 to be 2' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('reports the second failure verbatim when the rerun also fails', async () => {
    const run = runs({ exitCode: 1, output: 'optimized dependencies changed' }, { exitCode: 1, output: 'TypeError: boom' })

    expect(await runWarm(run)).toMatchObject({ status: 'fail', detail: 'TypeError: boom' })
  })
})

describe('createSystemProbes', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'qa-tools-doctor-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('lists *.model3.json rig files at depth <= 2 only', () => {
    mkdirSync(join(root, 'rig', 'a', 'b', 'c'), { recursive: true })
    writeFileSync(join(root, 'rig', 'top.model3.json'), '')
    writeFileSync(join(root, 'rig', 'a', 'b', 'two.model3.json'), '')
    writeFileSync(join(root, 'rig', 'a', 'b', 'c', 'deep.model3.json'), '')

    const probes = createSystemProbes(root, {})

    expect(probes.listRig(join(root, 'rig')).models.sort()).toEqual(['a/b/two.model3.json', 'top.model3.json'])
    expect(probes.listRig(join(root, 'missing'))).toEqual({ isDirectory: false, models: [] })
  })

  it('reads dist exports from packages/*/package.json and newest mtimes by suffix', () => {
    mkdirSync(join(root, 'packages', 'demo', 'src'), { recursive: true })
    writeFileSync(join(root, 'packages', 'demo', 'package.json'), JSON.stringify({ exports: { '.': './dist/index.mjs' } }))
    writeFileSync(join(root, 'packages', 'demo', 'src', 'a.yaml'), '')

    const probes = createSystemProbes(root, {})

    expect(probes.packageManifests()).toEqual([{ dir: 'packages/demo', exports: { '.': './dist/index.mjs' } }])
    expect(probes.newestMtime('packages/demo/src', '.yaml')).toBeTypeOf('number')
    expect(probes.newestMtime('packages/demo/src', '.json')).toBeUndefined()
    expect(probes.newestMtime('packages/demo/dist', '')).toBeUndefined()
  })
})
