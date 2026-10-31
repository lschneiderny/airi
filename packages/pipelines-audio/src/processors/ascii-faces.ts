/**
 * ASCII faces a texting reply may carry. They are shown in bubbles and never spoken.
 *
 * Pronounceable word faces such as `uwu` and `owo` are left out on purpose: speech reads them.
 * The list is case-sensitive: `xD` and `XD` are both listed, `:p` is not.
 */
export const ASCII_FACES = [
  ':3',
  '^^',
  '^_^',
  '>_<',
  '>.<',
  'T_T',
  ';_;',
  ':)',
  ':(',
  ':D',
  ';)',
  ':P',
  'xD',
  'XD',
  'o_o',
  'O_O',
  '-_-',
  '^w^',
  '<3',
] as const

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
