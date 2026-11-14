import type { IdentityRecord, SessionStartRecord, UsageEventRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfIdentityValue } from './identity'

import { FRAME_BINS_V1, PERF_RECORD_VERSION, STAGE_BINS_V1 } from '@proj-airi/stage-shared/perf/usage'

export function sessionStartRecord(
  t: number,
  start: Omit<SessionStartRecord, 'v' | 't' | 'kind' | 'frameBins' | 'stageBins'>,
): SessionStartRecord {
  return { v: PERF_RECORD_VERSION, t, kind: 'session-start', ...start, frameBins: FRAME_BINS_V1.id, stageBins: STAGE_BINS_V1.id }
}

export function identityRecord(t: number, session: { sessionId: string, epoch: number, identity: PerfIdentityValue }): IdentityRecord {
  return { v: PERF_RECORD_VERSION, t, sessionId: session.sessionId, kind: 'identity', epoch: session.epoch, ...session.identity }
}

export function usageEvent(
  t: number,
  sessionId: string,
  event: Pick<UsageEventRecord, 'name' | 'detail' | 'window'>,
): UsageEventRecord {
  return { v: PERF_RECORD_VERSION, t, sessionId, kind: 'event', ...event }
}
