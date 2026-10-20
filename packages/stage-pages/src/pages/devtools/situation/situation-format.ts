/** Formats a span such as `4s`, `3m 05s`, or `2h 10m`. Negative spans read as `0s`. */
export function formatSpan(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  if (totalSeconds < 60)
    return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60)
    return `${minutes}m ${String(totalSeconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** Formats how long ago `atMs` was relative to `nowMs`, or `-` when it is unknown. */
export function formatAgo(atMs: number | null | undefined, nowMs: number): string {
  if (atMs === null || atMs === undefined || !Number.isFinite(atMs))
    return '-'
  return `${formatSpan(nowMs - atMs)} ago`
}

/** Formats a timestamp as a local wall-clock time with seconds. */
export function formatClock(atMs: number): string {
  return new Date(atMs).toLocaleTimeString()
}
