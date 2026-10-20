import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execPath } from 'node:process'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readPinnedPnpmVersion, resolvePnpm, resolveVitestEntry } from './pnpm'

let root: string

function writeRoot(packageManager?: string) {
  writeFileSync(join(root, 'package.json'), JSON.stringify(packageManager === undefined ? { name: 'root' } : { name: 'root', packageManager }))
}

function installPnpm(home: string, version: string, dirName = version) {
  const entry = join(home, '.tools', 'pnpm', dirName, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  mkdirSync(join(entry, '..'), { recursive: true })
  writeFileSync(entry, '')
  return entry
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qa-tools-pnpm-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readPinnedPnpmVersion', () => {
  it('parses the version from packageManager, ignoring a hash suffix', () => {
    writeRoot('pnpm@11.24.0')
    expect(readPinnedPnpmVersion(root)).toBe('11.24.0')
    writeRoot('pnpm@11.24.0+sha512.abc')
    expect(readPinnedPnpmVersion(root)).toBe('11.24.0')
  })

  it.each([undefined, 'pnpm', 'pnpm@', 'yarn@4.1.0', 'garbage string'])('throws a clear error for packageManager %s', (value) => {
    writeRoot(value)
    expect(() => readPinnedPnpmVersion(root)).toThrow(/packageManager/)
  })
})

describe('resolvePnpm', () => {
  it('resolves the entry from a PNPM_HOME layout and returns the current node', () => {
    writeRoot('pnpm@11.24.0')
    const home = join(root, 'home')
    const entry = installPnpm(home, '11.24.0')

    expect(resolvePnpm({ repoRoot: root, env: { PNPM_HOME: home } })).toEqual({ version: '11.24.0', node: execPath, entry })
  })

  it('ignores _tmp_ sibling directories', () => {
    writeRoot('pnpm@11.24.0')
    const home = join(root, 'home')
    installPnpm(home, '11.24.0', '11.24.0_tmp_34256')

    expect(() => resolvePnpm({ repoRoot: root, env: { PNPM_HOME: home } })).toThrow(/Expected entry/)
  })

  it('throws an error that contains the expected path when the version is missing', () => {
    writeRoot('pnpm@11.24.0')
    const home = join(root, 'empty')
    mkdirSync(home)

    expect(() => resolvePnpm({ repoRoot: root, env: { PNPM_HOME: home } }))
      .toThrow(join(home, '.tools', 'pnpm', '11.24.0', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'))
  })

  it('falls back to npm_execpath only for a JS file of the same version', () => {
    writeRoot('pnpm@11.24.0')
    const home = join(root, 'empty')
    mkdirSync(home)
    const make = (dir: string, version: string) => {
      const pkgDir = join(root, dir, 'node_modules', 'pnpm')
      mkdirSync(join(pkgDir, 'bin'), { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'pnpm', version }))
      const entry = join(pkgDir, 'bin', 'pnpm.mjs')
      writeFileSync(entry, '')
      return entry
    }
    const same = make('same', '11.24.0')
    const other = make('other', '10.0.0')

    expect(resolvePnpm({ repoRoot: root, env: { PNPM_HOME: home, npm_execpath: same } }).entry).toBe(same)
    expect(() => resolvePnpm({ repoRoot: root, env: { PNPM_HOME: home, npm_execpath: other } })).toThrow(/Expected entry/)
  })
})

describe('resolveVitestEntry', () => {
  it('points at an existing Vitest CLI file', async () => {
    const { existsSync } = await import('node:fs')
    const entry = resolveVitestEntry()
    expect(entry).toMatch(/vitest\.mjs$/)
    expect(existsSync(entry)).toBe(true)
  })
})
