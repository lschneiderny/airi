import type { CommitSource } from './affected'

import { describe, expect, it } from 'vitest'

import { decideAffected, manifestDiffers, runnerClosure, scanImports } from './affected'

const root = 'packages/qa/src/run.ts'

function commit(files: Record<string, string>): CommitSource {
  return { paths: new Set(Object.keys(files)), read: paths => new Map(paths.filter(path => path in files).map(path => [path, files[path]])) }
}

const base = {
  'packages/qa/package.json': JSON.stringify({ name: '@x/qa', scripts: { run: 'tsx run.ts' } }),
  [root]: [
    'import type { Shape } from \'./types\'',
    'import { pose } from \'@x/body/pose\'',
    'import {',
    '  helper,',
    '} from \'./helper\'',
    '// import { old } from \'./old\'',
    'export const run = (shape: Shape) => pose(helper(shape))',
  ].join('\n'),
  'packages/qa/src/types.ts': 'export interface Shape { size: number }',
  'packages/qa/src/helper.ts': 'import \'./side-effect.js\'\nexport const helper = <T>(value: T) => value',
  'packages/qa/src/side-effect.ts': 'globalThis.ready = true',
  'packages/qa/README.md': '# qa',
  'packages/body/package.json': JSON.stringify({ name: '@x/body', exports: { '.': './src/index.ts', './*': './src/*.ts' } }),
  'packages/body/src/pose.ts': 'export { joint as pose } from \'./joint\'',
  'packages/body/src/joint.ts': 'export const joint = (value: unknown) => value',
  'packages/body/src/unused.ts': 'export const unused = 1',
}

function answer(tipFiles: Record<string, string>, changed: string[], baseFiles: Record<string, string> = base) {
  const before = commit(baseFiles)
  const after = commit(tipFiles)
  return decideAffected({
    base: runnerClosure(before, [root]),
    tip: runnerClosure(after, [root]),
    changed,
    manifestChanged: path => manifestDiffers(before.read([path]).get(path), after.read([path]).get(path)),
  })
}

describe('runnerClosure', () => {
  it('follows relative, side-effect and workspace wildcard imports, and leaves out type-only and commented imports', () => {
    expect([...runnerClosure(commit(base), [root]).files].sort()).toEqual([
      'packages/body/src/joint.ts',
      'packages/body/src/pose.ts',
      'packages/qa/src/helper.ts',
      root,
      'packages/qa/src/side-effect.ts',
    ])
  })
})

describe('decideAffected', () => {
  it('answers affected for a change in a transitively imported workspace file', () => {
    const tip = { ...base, 'packages/body/src/joint.ts': 'export const joint = (value: unknown) => [value]' }
    expect(answer(tip, ['packages/body/src/joint.ts'])).toMatchObject({ verdict: 'affected', hits: ['packages/body/src/joint.ts'] })
  })

  it('answers not affected for files outside the closure and a scripts-only manifest change', () => {
    const tip = {
      ...base,
      'packages/qa/README.md': '# qa tools',
      'packages/body/src/unused.ts': 'export const unused = 2',
      'packages/qa/src/types.ts': 'export interface Shape { size: number, name: string }',
      'packages/qa/package.json': JSON.stringify({ name: '@x/qa', scripts: { run: 'tsx run.ts --fast' } }),
    }
    expect(answer(tip, ['packages/qa/README.md', 'packages/body/src/unused.ts', 'packages/qa/src/types.ts', 'packages/qa/package.json'])).toMatchObject({ verdict: 'not-affected' })
  })

  it('answers affected when a closure manifest changes its dependencies', () => {
    const tip = { ...base, 'packages/qa/package.json': JSON.stringify({ name: '@x/qa', dependencies: { three: '0.186.0' } }) }
    expect(answer(tip, ['packages/qa/package.json'])).toMatchObject({ verdict: 'affected' })
  })

  it('counts a file the tip no longer imports through the base closure', () => {
    const tip = { ...base, [root]: 'export const run = () => 1' }
    delete (tip as Record<string, string>)['packages/qa/src/helper.ts']
    const result = answer(tip, [root, 'packages/qa/src/helper.ts'])
    expect(result.verdict).toBe('affected')
    expect(result.hits).toContain('packages/qa/src/helper.ts')
  })

  const computed = { ...base, 'packages/qa/src/helper.ts': 'export const helper = (name: string) => import(name)' }
  const unresolvable = { ...base, 'packages/qa/src/side-effect.ts': 'import \'@x/body/missing/deep\'' }
  it.each([
    ['a computed import()', computed, computed, ['packages/qa/README.md']],
    ['an unresolvable workspace import', unresolvable, unresolvable, ['packages/qa/README.md']],
    ['a lockfile change', base, { ...base, 'pnpm-lock.yaml': 'lockfileVersion: 9' }, ['pnpm-lock.yaml']],
  ])('cannot tell with %s and no changed closure file', (_, baseFiles, tip, changed) => {
    const result = answer(tip, changed, baseFiles)
    expect(result.verdict).toBe('cannot-tell')
    expect(result.reasons.length).toBeGreaterThan(0)
  })
})

describe('scanImports', () => {
  it('reads literal dynamic imports and import.meta.url assets, and counts computed imports', () => {
    expect(scanImports('const a = await import(\'./a\')\nconst w = new URL(\'./ammo.wasm\', import.meta.url)\nawait import(`./$' + '{name}`)')).toEqual({
      specifiers: ['./a'],
      assets: ['./ammo.wasm'],
      dynamic: 1,
    })
  })
})
