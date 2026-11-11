import type { Episode, Segment, Span } from './types'

import { HZ } from './math'

export function runs(mask: readonly boolean[]): Span[] {
  const spans: Span[] = []
  let start = -1
  for (let i = 0; i <= mask.length; i++) {
    if (mask[i] && start < 0)
      start = i
    if (!mask[i] && start >= 0) {
      spans.push({ start, end: i })
      start = -1
    }
  }
  return spans
}

/** Section 10.2: centre k windows in each eligible span, hop W/2. */
export function placeWindows(spans: readonly Span[], seconds: number): Span[] {
  const width = Math.round(seconds * HZ)
  const hop = width / 2
  return spans.flatMap(({ start, end }) => {
    const count = 1 + Math.floor((end - start - width) / hop)
    const first = start + Math.round((end - start - (width + (count - 1) * hop)) / 2)
    return Array.from({ length: Math.max(0, count) }, (_, i) => ({ start: first + i * hop, end: first + i * hop + width }))
  })
}

/** P14: hysteresis; sub-150 ms runs merge, interior runs into their equal-state neighbours. */
export function segment(speed: readonly number[], moveSpeed: number): Segment[] {
  let moving = false
  const mask = speed.map((s) => {
    if (s > 1.5 * moveSpeed)
      moving = true
    if (s < 0.75 * moveSpeed)
      moving = false
    return moving
  })
  const result: { start: number, end: number, moving: boolean }[] = []
  for (let i = 0; i < mask.length; i++) {
    const last = result[result.length - 1]
    if (last && last.moving === mask[i])
      last.end++
    else result.push({ start: i, end: i + 1, moving: mask[i] })
  }
  while (result.length > 1) {
    const i = result.findIndex(s => s.end - s.start < 0.15 * HZ)
    if (i < 0)
      break
    if (i === 0) {
      result[1].start = result[0].start
      result.splice(0, 1)
    }
    else if (i === result.length - 1) {
      result[i - 1].end = result[i].end
      result.splice(i, 1)
    }
    else {
      result[i - 1].end = result[i + 1].end
      result.splice(i, 2)
    }
  }
  return result
}

export function peaks(x: readonly number[], threshold: number): number[] {
  const result: number[] = []
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i] >= threshold && x[i] > x[i - 1] && x[i] >= x[i + 1])
      result.push(i)
  }
  return result
}

/** P15: last sample below 10% before peak (<=1 s); first after (<=3 s). */
export function episode(speed: readonly number[], peak: number): Episode {
  let start = Math.max(0, peak - HZ)
  let end = Math.min(speed.length, peak + 3 * HZ + 1)
  for (let i = peak - 1; i >= start; i--) {
    if (speed[i] < 0.1 * speed[peak]) {
      start = i
      break
    }
  }
  for (let i = peak + 1; i < end; i++) {
    if (speed[i] < 0.1 * speed[peak]) {
      end = i + 1
      break
    }
  }
  return { start, end, peak }
}

/** S1 / S4: every qualifying local maximum has P15 bounds; order is chronological. */
export function episodes(speed: readonly number[], threshold: number): Episode[] {
  return peaks(speed, threshold).map(p => episode(speed, p))
}
