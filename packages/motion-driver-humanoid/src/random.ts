/** Uniform source in [0, 1). */
export type RandomStream = () => number

/** Deterministic Mulberry32 stream; equal seeds replay equal sequences. */
export function createRandomStream(seed: number): RandomStream {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32
  }
}
