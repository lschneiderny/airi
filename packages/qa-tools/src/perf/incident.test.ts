import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { listIncidents, readIncident } from './incident'

const fixtures = resolve(import.meta.dirname, '../../fixtures/perf')
const hostA = resolve(fixtures, 'host-a')
const hostB = resolve(fixtures, 'host-b')
const incidentId = '2026-11-14T08-01-42-000Z-stall1'

describe('perf incidents', () => {
  let scratch: string | undefined

  afterEach(async () => {
    if (scratch !== undefined)
      await rm(scratch, { recursive: true, force: true })
    scratch = undefined
  })

  it('lists incident files across dirs', async () => {
    const { incidents, files } = await listIncidents([hostA, hostB])

    expect(incidents).toEqual([expect.objectContaining({ id: incidentId, sessionId: '2026-11-14T08-00-00-000Z-z1y2bb', trigger: 'frame-stall', window: 'stage-main', ringMissing: false, recentLines: 6, path: resolve(hostA, 'incidents', `${incidentId}.json`) })])
    expect(files).toEqual([])
  })

  it('reads one incident by id and returns null for an unknown id', async () => {
    const found = await readIncident([hostB, hostA], incidentId)

    expect(found?.file.incident).toMatchObject({ id: incidentId, peak: { frameMaxMs: 712 } })
    expect(found?.file.recent).toHaveLength(6)
    expect(await readIncident([hostA, hostB], 'nope')).toBeNull()
  })

  it('counts an incident file that fails the schema instead of throwing', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'perf-incidents-'))
    await mkdir(join(scratch, 'incidents'))
    await writeFile(join(scratch, 'incidents', 'broken.json'), '{"incident":{"v":2}}')

    expect(await listIncidents([scratch])).toEqual({ incidents: [], files: [{ path: join(scratch, 'incidents', 'broken.json'), malformed: 1, unknownVersion: 0 }] })
    expect(await readIncident([scratch], 'broken')).toBeNull()
  })
})
