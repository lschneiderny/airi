import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { runMotion3d } from '../cli/run'
import { parseRunArguments } from './arguments'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'motion3d-arguments-'))
  directories.push(cwd)
  writeFileSync(join(cwd, 'model.pmx'), 'external model bytes')
  return { cwd, repoRoot: cwd, signal: new AbortController().signal }
}

it('resolves paths against the caller and applies scenario defaults', () => {
  const context = fixture()
  const options = parseRunArguments(['--model', 'model.pmx', '--scenario', 'idle', '--seed', '2', '--out', 'capture', '--verify-determinism'], context.cwd)
  expect(options.model).toBe(join(context.cwd, 'model.pmx'))
  expect(options.out).toBe(join(context.cwd, 'capture'))
  expect([options.seed, options.seconds, options.warmupSeconds, options.verifyDeterminism]).toEqual([2, 60, 10, true])
})

it.each([
  ['missing model', ['--scenario', 'idle', '--out', 'capture']],
  ['unreadable model', ['--model', 'missing.pmx', '--scenario', 'idle', '--out', 'capture']],
  ['unknown scenario', ['--model', 'model.pmx', '--scenario', 'missing', '--out', 'capture']],
  ['existing output', ['--model', 'model.pmx', '--scenario', 'idle', '--out', '.']],
  ['duration over cap', ['--model', 'model.pmx', '--scenario', 'idle', '--seconds', '121', '--out', 'capture']],
  ['invalid seed', ['--model', 'model.pmx', '--scenario', 'idle', '--seed', 'NaN', '--out', 'capture']],
])('refuses %s with exit 2 before a run starts', async (_, args) => {
  expect(await runMotion3d(args, fixture())).toBe(2)
})
