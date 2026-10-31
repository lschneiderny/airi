export function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

export function lerp(a: number, b: number, weight: number) {
  return a + (b - a) * weight
}

export function lerpRecord<T extends Record<keyof T, number>>(a: T, b: T, weight: number): T {
  return Object.fromEntries(Object.keys(a).map(key => [key, lerp(a[key as keyof T], b[key as keyof T], weight)])) as T
}
