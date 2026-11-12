import type { AppCategory } from '@proj-airi/stage-shared/situation'

/** Audio above this level counts as playing; the same level makes the character watch the desktop. */
const MUSIC_LEVEL = 0.1
/** Audio must play this long before she sways to it, so a notification sound or a short clip never starts her. */
const MUSIC_SETTLE_MS = 8_000
/** Apps whose sound is not something to sway to: a game's effects, and other people's voices. */
const QUIET_CATEGORIES: ReadonlySet<AppCategory> = new Set<AppCategory>(['game', 'call', 'chat'])

/** When the current stretch of audio began, or `null` while none plays. */
export interface MusicMemory {
  readonly sinceMs: number | null
}

export const initialMusicMemory: MusicMemory = Object.freeze({ sinceMs: null })

/**
 * Whether other applications are playing audio the character can sway to: system audio above the level for
 * {@link MUSIC_SETTLE_MS}, outside games, calls and chat apps, and while she is not speaking herself.
 *
 * Pure: time comes from `nowMs` and the stretch of audio lives in the returned memory. An unknown level (`null`, as on
 * web hosts) never counts as audio, and her own speech pauses the answer without ending the stretch.
 */
export function resolveMusic(input: { nowMs: number, systemAudioLevel: number | null, category: AppCategory | null, speaking: boolean }, memory: MusicMemory): { music: boolean, memory: MusicMemory } {
  const playing = input.systemAudioLevel !== null && Number.isFinite(input.systemAudioLevel) && input.systemAudioLevel > MUSIC_LEVEL
    && (input.category === null || !QUIET_CATEGORIES.has(input.category))
  if (!playing || !Number.isFinite(input.nowMs))
    return { music: false, memory: initialMusicMemory }
  const sinceMs = memory.sinceMs === null ? input.nowMs : Math.min(memory.sinceMs, input.nowMs)
  return { music: !input.speaking && input.nowMs - sinceMs >= MUSIC_SETTLE_MS, memory: { sinceMs } }
}
