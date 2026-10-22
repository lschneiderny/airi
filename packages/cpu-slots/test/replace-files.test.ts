import type { ReplaceFs } from '../tsdown.config'

import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as fs from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { removeStaleStaging, replaceFiles } from '../tsdown.config'

const roots: string[] = []

function dirs(): { staging: string, dist: string } {
  const root = fs.mkdtempSync(join(tmpdir(), 'cpu-slots-replace-'))
  roots.push(root)
  const staging = join(root, 'staging')
  const dist = join(root, 'dist')
  fs.mkdirSync(staging)
  fs.mkdirSync(dist)
  return { staging, dist }
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true })
})

describe('replaceFiles', () => {
  it('renames new files over existing ones, then removes files the build no longer emits', async () => {
    const { staging, dist } = dirs()
    fs.writeFileSync(join(dist, 'vitest.mjs'), 'old')
    fs.writeFileSync(join(dist, 'gone.mjs'), 'old')
    fs.writeFileSync(join(staging, 'vitest.mjs'), 'new')
    fs.writeFileSync(join(staging, 'vitest.d.mts'), 'types')
    const calls: string[] = []
    const recording: ReplaceFs = {
      ...fs,
      renameSync: (from, to) => {
        calls.push(`rename ${String(to)}`)
        fs.renameSync(from, to)
      },
      rmSync: (path, options) => {
        calls.push(`rm ${String(path)}`)
        fs.rmSync(path, options)
      },
    }

    await replaceFiles(staging, dist, { fs: recording })

    expect(fs.readFileSync(join(dist, 'vitest.mjs'), 'utf8')).toBe('new')
    expect(fs.readFileSync(join(dist, 'vitest.d.mts'), 'utf8')).toBe('types')
    expect(fs.readdirSync(dist).sort()).toEqual(['vitest.d.mts', 'vitest.mjs'])
    expect(fs.existsSync(staging)).toBe(false)
    expect(calls.findIndex(call => call === `rm ${join(dist, 'gone.mjs')}`))
      .toBeGreaterThan(calls.findLastIndex(call => call.startsWith('rename ')))
  })

  it('leaves a target with identical bytes untouched', async () => {
    const { staging, dist } = dirs()
    fs.writeFileSync(join(dist, 'vitest.mjs'), 'same')
    const before = fs.statSync(join(dist, 'vitest.mjs')).mtimeMs
    fs.writeFileSync(join(staging, 'vitest.mjs'), 'same')
    let renames = 0

    await replaceFiles(staging, dist, {
      fs: {
        ...fs,
        renameSync: () => {
          renames++
        },
      },
    })

    expect(renames).toBe(0)
    expect(fs.statSync(join(dist, 'vitest.mjs')).mtimeMs).toBe(before)
    expect(fs.existsSync(staging)).toBe(false)
  })

  it('retries a rename that fails with EPERM while a reader holds the target', async () => {
    const { staging, dist } = dirs()
    fs.writeFileSync(join(dist, 'vitest.mjs'), 'old')
    fs.writeFileSync(join(staging, 'vitest.mjs'), 'new')
    let failures = 2
    const delays: number[] = []

    await replaceFiles(staging, dist, {
      fs: {
        ...fs,
        renameSync: (from, to) => {
          if (failures-- > 0)
            throw errno('EPERM')
          fs.renameSync(from, to)
        },
      },
      delay: async (ms) => { delays.push(ms) },
    })

    expect(delays).toHaveLength(2)
    expect(fs.readFileSync(join(dist, 'vitest.mjs'), 'utf8')).toBe('new')
  })

  it('keeps the old file and rethrows once the retries run out', async () => {
    const { staging, dist } = dirs()
    fs.writeFileSync(join(dist, 'vitest.mjs'), 'old')
    fs.writeFileSync(join(staging, 'vitest.mjs'), 'new')
    const options = {
      fs: { ...fs, renameSync: () => { throw errno('EBUSY') } },
      delay: async () => {},
      attempts: 3,
    }

    await expect(replaceFiles(staging, dist, options)).rejects.toMatchObject({ code: 'EBUSY' })
    expect(fs.readFileSync(join(dist, 'vitest.mjs'), 'utf8')).toBe('old')
  })

  it('does not retry an error that waiting cannot fix', async () => {
    const { staging, dist } = dirs()
    fs.writeFileSync(join(staging, 'vitest.mjs'), 'new')
    const delays: number[] = []
    const options = {
      fs: { ...fs, renameSync: () => { throw errno('ENOSPC') } },
      delay: async (ms: number) => { delays.push(ms) },
    }

    await expect(replaceFiles(staging, dist, options)).rejects.toMatchObject({ code: 'ENOSPC' })
    expect(delays).toEqual([])
  })

  it('refuses an empty staging directory instead of emptying dist', async () => {
    const { staging, dist } = dirs()
    fs.writeFileSync(join(dist, 'vitest.mjs'), 'old')

    await expect(replaceFiles(staging, dist)).rejects.toThrow(staging)
    expect(fs.readFileSync(join(dist, 'vitest.mjs'), 'utf8')).toBe('old')
  })
})

describe('removeStaleStaging', () => {
  it('f30 removes the staging directories of dead build processes and keeps live ones and other entries', () => {
    const { staging: cache } = dirs()
    for (const name of ['dist-111', 'dist-222', `dist-${process.pid}`, 'other', 'dist-abc'])
      fs.mkdirSync(join(cache, name))
    fs.writeFileSync(join(cache, 'dist-111', 'vitest.mjs'), 'half-written')

    expect(removeStaleStaging(cache, { alive: pid => pid === 222 })).toEqual(['dist-111'])
    expect(fs.readdirSync(cache).sort()).toEqual(['dist-222', `dist-${process.pid}`, 'dist-abc', 'other'].sort())
  })

  it('f30 does nothing when the cache directory does not exist', () => {
    const { staging } = dirs()
    expect(removeStaleStaging(join(staging, 'absent'), { alive: () => false })).toEqual([])
  })
})
