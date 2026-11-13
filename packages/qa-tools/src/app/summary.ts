import type { MotionQaEvent } from '@proj-airi/stage-shared/motion-scenario'

export type SendPath = 'composer' | 'chatSend'

/** A kind counts only after this message's cursor. Turn expectations require a completed assistant turn. */
export function matchExpectations(events: readonly MotionQaEvent[], expected: readonly MotionQaEvent['kind'][], sinceSeq: number): MotionQaEvent['kind'][] {
  return expected.filter(kind => !events.some(event => event.seq > sinceSeq && event.kind === kind && (kind !== 'turn' || event.payload.phase === 'end')))
}

/**
 * Whether a run that threw counts as failed. An interrupt is how a `--keep-open` run is meant to end, and by then every
 * expectation has been checked, so only that case is not a failure.
 */
export function runFailed(end: { keepingOpen: boolean, interrupted: boolean }): boolean {
  return !end.keepingOpen || !end.interrupted
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
  /** Renderer exceptions and console errors from every window. Reported, not gated; `qa:smoke` gates them. */
  pageErrors: number
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
    pageErrors: input.pageErrors,
  }
}
