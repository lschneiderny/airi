/** Exit code when `--not-after` stopped the bench before a launch. 0, 1, 2, 3 and 130 are taken. */
export const BENCH_DEADLINE_EXIT = 4

/** Why the next launch must not start at `now`, or `null` while `notAfter` is unset or not yet past. */
export function pastNotAfter(notAfter: Date | null, now: Date): string | null {
  if (notAfter === null || now.getTime() <= notAfter.getTime())
    return null
  return `it is past --not-after ${notAfter.toISOString()}; no further launch starts, and the records already appended stay`
}
