import { ASCII_FACES } from '@proj-airi/stage-shared/conversation-register'

// Longest first so `^_^` is not read as a shorter face.
const asciiFacePattern = new RegExp(
  `(^|\\s)(?:${[...ASCII_FACES]
    .sort((a, b) => b.length - a.length)
    .map(face => face.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(?=$|\\s|[.,!?])`,
  'g',
)

/**
 * Removes standalone ASCII faces from text that is about to be spoken.
 *
 * Use when:
 * - Preparing an assembled TTS segment. Never call it on a streamed delta: a face can arrive split
 *   across deltas (`:` then `3`).
 *
 * Expects:
 * - A face stands alone: at the start or after whitespace, and before the end, whitespace, or one of `.,!?`
 *
 * Returns:
 * - The text without faces, with doubled spaces collapsed and the ends trimmed; text without a face is
 *   returned unchanged, so `10:30`, `C:D`, and `x^^y` stay as written
 *
 * @example
 * stripAsciiFaces('love you <3') // 'love you'
 */
export function stripAsciiFaces(text: string): string {
  const stripped = text.replace(asciiFacePattern, '$1')
  if (stripped === text)
    return text

  return stripped.replace(/ {2,}/g, ' ').trim()
}
