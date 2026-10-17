/** Uniform source in [0, 1). Layers receive their own stream and never call `Math.random`. */
export type RandomStream = () => number

/** Deterministic Mulberry32 stream; equal seeds replay equal sequences. */
export function createRandomStream(seed: number): RandomStream {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

/**
 * Derives the seed of one layer stream, so layers stay statistically independent
 * and adding draws to one layer never shifts another layer's sequence.
 */
export function deriveSeed(seed: number, layer: number) {
  // SplitMix32-style finalizer over (seed, layer).
  let h = (seed ^ Math.imul(layer + 1, 0x9E3779B9)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B)
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35)
  return (h ^ (h >>> 16)) >>> 0
}

/** Standard normal draw (Box-Muller, two uniforms per call). */
export function gaussian(random: RandomStream) {
  const u = 1 - random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random())
}

/** Lognormal draw rejected outside [min, max]; clamps after 64 rejections so a bad range cannot hang. */
export function truncatedLognormal(random: RandomStream, median: number, logSd: number, min: number, max: number) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const value = median * Math.exp(logSd * gaussian(random))
    if (value >= min && value <= max)
      return value
  }
  return Math.min(max, Math.max(min, median))
}

/** Uniformly distributed direction on the unit sphere. */
export function unitVector3(random: RandomStream): [number, number, number] {
  for (;;) {
    const v: [number, number, number] = [gaussian(random), gaussian(random), gaussian(random)]
    const length = Math.hypot(...v)
    if (length > 1e-9)
      return [v[0] / length, v[1] / length, v[2] / length]
  }
}
