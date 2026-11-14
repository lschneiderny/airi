import type { IncidentRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfFileCounts } from './read'

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PerfRecordSchema } from '@proj-airi/stage-shared/perf/usage'
import { array, boolean, object, safeParse, string, unknown } from 'valibot'

/** `incidents/<id>.json` as the recorder writes it; the frame ring stays opaque to the CLI. */
const IncidentFileSchema = object({
  incident: PerfRecordSchema,
  recent: array(string()),
  frameRing: unknown(),
  ringMissing: boolean(),
})

export interface IncidentFile {
  readonly incident: IncidentRecord
  /** The raw JSONL lines of the ticks before the incident. */
  readonly recent: readonly string[]
  readonly frameRing: unknown
  readonly ringMissing: boolean
}

export interface IncidentEntry {
  readonly id: string
  readonly sessionId: string
  readonly t: number
  readonly trigger: IncidentRecord['trigger']
  readonly window: string | null
  readonly pid: number | null
  readonly hostContended: boolean
  readonly ringMissing: boolean
  readonly recentLines: number
  readonly path: string
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

/** Returns `null` for a missing file or one that fails the schema, whatever its record version. */
async function readIncidentFile(path: string): Promise<IncidentFile | null> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(path, 'utf8'))
  }
  catch (error) {
    if (isMissing(error) || error instanceof SyntaxError)
      return null
    throw error
  }
  const parsed = safeParse(IncidentFileSchema, value)
  if (!parsed.success)
    return null
  const { incident, recent, frameRing, ringMissing } = parsed.output
  return incident.kind === 'incident' ? { incident, recent, frameRing, ringMissing } : null
}

/** Lists incident files of every directory, oldest first; files that fail the schema are counted in `files`. */
export async function listIncidents(dirs: readonly string[]): Promise<{ incidents: IncidentEntry[], files: PerfFileCounts[] }> {
  const incidents: IncidentEntry[] = []
  const files: PerfFileCounts[] = []
  for (const dir of dirs) {
    const incidentDir = join(dir, 'incidents')
    let names: string[]
    try {
      names = await readdir(incidentDir)
    }
    catch (error) {
      if (isMissing(error))
        continue
      throw error
    }
    for (const name of names.filter(name => name.endsWith('.json')).toSorted()) {
      const path = join(incidentDir, name)
      const file = await readIncidentFile(path)
      if (file === null) {
        files.push({ path, malformed: 1, unknownVersion: 0 })
        continue
      }
      const { incident } = file
      incidents.push({
        id: incident.id,
        sessionId: incident.sessionId,
        t: incident.t,
        trigger: incident.trigger,
        window: incident.window ?? null,
        pid: incident.pid ?? null,
        hostContended: incident.hostContended,
        ringMissing: file.ringMissing,
        recentLines: file.recent.length,
        path,
      })
    }
  }
  return { incidents: incidents.toSorted((left, right) => left.t - right.t), files }
}

/** Finds `incidents/<id>.json` in the first directory that holds a valid one; `id` must already be a plain file name. */
export async function readIncident(dirs: readonly string[], id: string): Promise<{ path: string, file: IncidentFile } | null> {
  for (const dir of dirs) {
    const path = join(dir, 'incidents', `${id}.json`)
    const file = await readIncidentFile(path)
    if (file !== null)
      return { path, file }
  }
  return null
}
