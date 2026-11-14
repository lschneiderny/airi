import type { RollupFailedRecord, SegmentRollupRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfRetentionFs } from './retention-fs'

import { useLogg } from '@guiiai/logg'
import { parsePerfLine, PERF_RECORD_VERSION, SegmentRollupReducer } from '@proj-airi/stage-shared/perf/usage'

const log = useLogg('main/perf-retention').useGlobalConfig()

/** One closed raw segment, `raw/<sessionId>.<segment>.jsonl`. */
export interface RawSegment {
  readonly sessionId: string
  readonly segment: number
  readonly path: string
}

/**
 * Streams a closed segment through `SegmentRollupReducer` into its `sessions.jsonl` row. Malformed and unknown-version
 * lines are counted into `malformedLines`; a reducer exception becomes a `rollup-failed` row, so the segment is still
 * decided and becomes prunable. `followed` says a later segment of the session exists: then the session did not end
 * here, and `recovered` is false even without `recording-stop`. A read failure rejects and writes no row.
 */
export async function rollUpRawSegment(fs: PerfRetentionFs, segment: RawSegment, followed: boolean): Promise<SegmentRollupRecord | RollupFailedRecord> {
  const reducer = new SegmentRollupReducer(segment)
  let reducerError: unknown = null
  let malformedLines = 0
  let endedAt = 0
  let stopped = false
  for await (const line of fs.readLines(segment.path)) {
    if (!line.trim())
      continue
    const parsed = parsePerfLine(line)
    if (!parsed.ok) {
      malformedLines += 1
      continue
    }
    const { record } = parsed
    if (reducerError === null) {
      try {
        reducer.push(record)
      }
      catch (error) {
        reducerError = error
      }
    }
    if (record.sessionId !== segment.sessionId)
      continue
    endedAt = Math.max(endedAt, record.t)
    stopped ||= record.kind === 'event' && record.name === 'recording-stop'
  }
  const rawBytes = (await fs.stat(segment.path)).size
  if (reducerError === null) {
    try {
      return reducer.finish({ endedAt, recovered: !stopped && !followed, malformedLines, rawBytes })
    }
    catch (error) {
      reducerError = error
    }
  }
  log.withError(reducerError).warn(`Perf segment ${segment.path} could not be rolled up`)
  return { v: PERF_RECORD_VERSION, t: endedAt, sessionId: segment.sessionId, kind: 'rollup-failed', segment: segment.segment, reason: 'reducer-error' }
}
