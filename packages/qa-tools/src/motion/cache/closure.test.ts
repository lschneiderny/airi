import process from 'node:process'

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { captureClosure, normalizeModuleId } from './closure'

let sandbox: string
let root: string
let source: string

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'qa-closure-'))
  root = join(sandbox, 'repo')
  source = join(root, 'packages', 'workspace', 'space name.ts')
  mkdirSync(join(root, 'packages', 'workspace'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'vendor'), { recursive: true })
  mkdirSync(join(sandbox, 'repo-other'), { recursive: true })
  writeFileSync(source, 'export const value = 1\r\n')
  writeFileSync(join(root, 'node_modules', 'vendor', 'index.js'), 'export {}')
  writeFileSync(join(sandbox, 'repo-other', 'outside.ts'), 'export {}')
  symlinkSync(join(root, 'packages', 'workspace'), join(root, 'node_modules', 'workspace'), process.platform === 'win32' ? 'junction' : 'dir')
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('normalizeModuleId', () => {
  it('keeps a workspace symlink after resolving it out of node_modules', () => {
    expect(normalizeModuleId(join(root, 'node_modules', 'workspace', 'space name.ts'), root)).toBe('packages/workspace/space name.ts')
  })

  it('excludes a real dependency and a path outside the repository', () => {
    expect(normalizeModuleId(join(root, 'node_modules', 'vendor', 'index.js'), root)).toBeUndefined()
    expect(normalizeModuleId(join(sandbox, 'repo-other', 'outside.ts'), root)).toBeUndefined()
    expect(normalizeModuleId(root, root)).toBeUndefined()
  })

  it.each(['\0virtual:gate', '/@id/virtual:gate', '/@id/__x00__gate', 'node:fs', 'virtual:gate'])('excludes non-file module id %j', (id) => {
    expect(normalizeModuleId(id, root)).toBeUndefined()
  })

  it('strips transform queries, decodes Vite filesystem ids, and handles file URLs', () => {
    const expected = 'packages/workspace/space name.ts'
    expect(normalizeModuleId(`${source}?v=123`, root)).toBe(expected)
    expect(normalizeModuleId(`/@fs/${source.replaceAll('\\', '/').replaceAll(' ', '%20')}?import`, root)).toBe(expected)
    expect(normalizeModuleId(`${pathToFileURL(source).href}?tsx=123`, root)).toBe(expected)
  })

  it.runIf(process.platform === 'win32')('canonicalizes drive letters and backslashes', () => {
    expect(normalizeModuleId(source.replace(/^[a-z]:/i, drive => drive.toLowerCase()), root.replace(/^[a-z]:/i, drive => drive.toUpperCase()))).toBe('packages/workspace/space name.ts')
  })

  it('excludes filesystem ids with no file', () => {
    expect(normalizeModuleId(join(root, 'missing.ts'), root)).toBeUndefined()
  })
})

describe('captureClosure', () => {
  it('deduplicates aliases and sorts identities independently of import order', () => {
    const other = join(root, 'packages', 'workspace', 'a.ts')
    writeFileSync(other, 'export {}')
    const ids = [source, `${source}?v=123`, other, join(root, 'node_modules', 'workspace', 'space name.ts')]

    const closure = captureClosure(ids, root)

    expect(closure.map(entry => entry.repoPath)).toEqual(['packages/workspace/a.ts', 'packages/workspace/space name.ts'])
    expect(captureClosure(ids.toReversed(), root)).toEqual(closure)
    expect(closure[1].sha256).toBe(createHash('sha256').update('export const value = 1\r\n').digest('hex'))
  })

  it('hashes current raw bytes instead of reusing a previous capture', () => {
    const before = captureClosure([source], root)

    writeFileSync(source, 'export const value = 1\n')

    const after = captureClosure([source], root)
    expect(after[0].repoPath).toBe(before[0].repoPath)
    expect(after[0].sha256).not.toBe(before[0].sha256)
  })
})
