import process from 'node:process'

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { clearanceMotion3d } from './clearance'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

vi.mock(import('../../evidence/run'), () => ({
  readGitStateFromRepo: () => ({ gitSha: 'test', dirty: false }),
}))

const directories: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(spawn).mockReset()
  directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true }))
})

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'motion3d-clearance-'))
  directories.push(cwd)
  writeFileSync(join(cwd, 'rig.pmx'), 'external model bytes')
  const args = ['--models', '.', '--out', 'capture', '--scenarios', 'idle-drive', '--parallel', '1']
  const controller = new AbortController()
  return {
    args,
    context: { cwd, repoRoot: cwd, signal: controller.signal },
    controller,
    result: join(cwd, 'capture', 'clearance.json'),
  }
}

it.each([
  { outcome: 'missing measure', measured: false, bound: [], expected: 1 },
  { outcome: 'pierced share above the bound', measured: true, bound: ['--fail-above', '0.05'], expected: 1 },
  { outcome: 'ticks without a clear arm pose', measured: true, bound: [], expected: 0 },
])('exits $expected for $outcome', async ({ measured, bound, expected }) => {
  const { args, context, result } = fixture()
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  vi.mocked(spawn).mockImplementationOnce(() => {
    if (measured) {
      const run = join(context.cwd, 'capture', 'runs', 'rig--idle-drive')
      mkdirSync(run, { recursive: true })
      writeFileSync(join(run, 'summary.json'), JSON.stringify({
        provenance: {},
        collisions: { count: 23 },
        clearance: {
          piercedShare: 0.5,
          depth: { deepShare: 0.1 },
          episodes: { count: 2, longestSeconds: 0.5 },
          upperArmDeg: { mean: 20 },
          cloth: { reversalMean: 0 },
          topMaterials: [],
        },
      }))
    }
    return actual.spawn(process.execPath, ['-e', 'process.exitCode = 1'])
  })

  expect(await clearanceMotion3d([...args, ...bound], context)).toBe(expected)
  expect(JSON.parse(readFileSync(result, 'utf8')).rows).toMatchObject([{
    label: 'rig',
    scenario: 'idle-drive',
    exitCode: 1,
    ...(measured
      ? { noClearPoseTicks: 23, clearance: { piercedShare: 0.5 } }
      : { noClearPoseTicks: null, clearance: null, error: 'the run wrote no summary' }),
  }])
})

it('refuses a clip that claims an arm before starting a child or writing results', async () => {
  const { args, context, result } = fixture()
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect(await clearanceMotion3d([...args, '--scenarios', 'gesture-under-clip'], context)).toBe(2)
  expect(error).toHaveBeenCalledWith(expect.stringContaining('a clip claims an arm'))
  expect(spawn).not.toHaveBeenCalled()
  expect(existsSync(result)).toBe(false)
})

it('exits 130 and leaves no results when the sweep is interrupted', async () => {
  const { args, context, controller, result } = fixture()
  controller.abort()
  expect(await clearanceMotion3d(args, context)).toBe(130)
  expect(spawn).not.toHaveBeenCalled()
  expect(existsSync(result)).toBe(false)
})
