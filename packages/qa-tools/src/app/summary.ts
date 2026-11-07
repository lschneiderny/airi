import type { MotionQaEvent } from '@proj-airi/stage-shared/motion-scenario'

export type SendPath = 'composer' | 'chatSend'

/** A kind counts only after this message's cursor. Turn expectations require a completed assistant turn. */
export function matchExpectations(events: readonly MotionQaEvent[], expected: readonly MotionQaEvent['kind'][], sinceSeq: number): MotionQaEvent['kind'][] {
  return expected.filter(kind => !events.some(event => event.seq > sinceSeq && event.kind === kind && (kind !== 'turn' || event.payload.phase === 'end')))
}

export interface SummaryInput {
  runDir: string
  model: string
  sendPaths: readonly SendPath[]
  events: readonly MotionQaEvent[]
  missing: readonly string[]
  screenshot: string | null
  diagnostics: string
  durationMs: number
  failed: boolean
}

export function buildSummary(input: SummaryInput) {
  const paths = [...new Set(input.sendPaths)]
  const counts: Record<string, number> = {}
  for (const event of input.events)
    counts[event.kind] = (counts[event.kind] ?? 0) + 1
  return {
    ok: !input.failed && input.missing.length === 0,
    runDir: input.runDir,
    model: input.model,
    sendPath: paths.length > 1 ? 'mixed' : paths[0] ?? null,
    events: counts,
    missing: [...new Set(input.missing)],
    screenshot: input.screenshot,
    diagnostics: input.diagnostics,
    durationMs: input.durationMs,
  }
}
