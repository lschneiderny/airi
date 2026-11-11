/** Layer fade durations in seconds. A full or dance layer eases out over its own fade-in time. */
export const LAYER_FADE_SECONDS = { upperIn: 0.25, upperOut: 0.3, fullIn: 0.4, danceIn: 0.6 } as const

export interface LayerFade {
  readonly from: number
  readonly to: number
  elapsed: number
  readonly duration: number
}

/**
 * Advances a layer fade by `delta` seconds. The weight follows a smoothstep from `from` to `to`, not three's linear
 * `fadeIn`, so a clip that claims a joint starts and ends its takeover with zero weight velocity.
 */
export function stepLayerFade(fade: LayerFade, delta: number): { amount: number, done: boolean } {
  fade.elapsed += delta
  const progress = fade.duration > 0 ? Math.min(1, fade.elapsed / fade.duration) : 1
  return { amount: fade.from + (fade.to - fade.from) * progress * progress * (3 - 2 * progress), done: progress >= 1 }
}
