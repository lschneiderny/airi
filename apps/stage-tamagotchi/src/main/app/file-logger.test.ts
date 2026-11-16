import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOG_RETENTION_MS, pruneExpiredLogs } from './file-logger'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

describe('pruneExpiredLogs', () => {
  const nowMs = Date.UTC(2026, 10, 15)
  let logsDir: string

  async function writeAged(name: string, ageMs: number) {
    const path = join(logsDir, name)
    await writeFile(path, 'log')
    const writtenAt = new Date(nowMs - ageMs)
    await utimes(path, writtenAt, writtenAt)
  }

  beforeEach(async () => {
    logsDir = await mkdtemp(join(tmpdir(), 'airi-logs-'))
  })

  afterEach(async () => {
    await rm(logsDir, { recursive: true, force: true })
  })

  it('removes session logs past the retention and keeps recent ones and files it does not own', async () => {
    await writeAged('airi-tamagotchi-1.log', LOG_RETENTION_MS + 60_000)
    await writeAged('airi-tamagotchi-2.log', LOG_RETENTION_MS - 60_000)
    await writeAged('notes.txt', LOG_RETENTION_MS + 60_000)

    await pruneExpiredLogs(logsDir, nowMs)

    expect((await readdir(logsDir)).sort()).toEqual(['airi-tamagotchi-2.log', 'notes.txt'])
  })
})
