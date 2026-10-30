/** Normalize a seed to the complete uint32 checkpoint used by Mulberry32. */
export function seedRng(seed: number): number {
  return seed >>> 0
}

/** Advance a checkpoint once, returning a ticket in [0, 1) and the next checkpoint. */
export function nextRandom(state: number): readonly [value: number, next: number] {
  const next = (state + 0x6D2B79F5) >>> 0
  let bits = Math.imul(next ^ (next >>> 15), next | 1)
  bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61)
  return [((bits ^ (bits >>> 14)) >>> 0) / 4294967296, next]
}
