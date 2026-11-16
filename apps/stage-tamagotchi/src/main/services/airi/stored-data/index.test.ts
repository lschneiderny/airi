import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deleteActivityFiles } from './index'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

describe('deleteActivityFiles', () => {
  let userData: string

  beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), 'airi-stored-data-'))
  })

  afterEach(async () => {
    await rm(userData, { recursive: true, force: true })
  })

  it('removes earlier logs and IO traces, and keeps the open log and the settings files', async () => {
    const openLog = join(userData, 'logs', 'airi-tamagotchi-2.log')
    await mkdir(join(userData, 'logs'))
    await mkdir(join(userData, 'io-traces'))
    await writeFile(join(userData, 'logs', 'airi-tamagotchi-1.log'), 'earlier session')
    await writeFile(openLog, 'this session')
    await writeFile(join(userData, 'io-traces', '2026-11-15.jsonl'), '{}')
    await writeFile(join(userData, 'window-state.json'), '{}')

    await deleteActivityFiles(userData, openLog)

    expect(await readdir(join(userData, 'logs'))).toEqual(['airi-tamagotchi-2.log'])
    expect(await readdir(join(userData, 'io-traces'))).toEqual([])
    expect((await readdir(userData)).sort()).toEqual(['io-traces', 'logs', 'window-state.json'])
  })

  it('creates no directory on a profile that never wrote any of them, so each writer sets its own mode', async () => {
    await deleteActivityFiles(userData, null)

    expect(await readdir(userData)).toEqual([])
  })
})
