import type { SituationState } from './types'

/**
 * A title shorter than this is not matched, so a title such as "Mail" cannot block ordinary sentences.
 *
 * Tuning: lower it only with a rule that keeps common words from matching.
 */
export const HELD_TITLE_MIN_CHARS = 8

/** Lower case with every run of whitespace as one space, so a wrapped or re-cased title still matches. */
function comparable(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * The window and page titles a situation holds: the foreground window's title and the title of each context that
 * carries one (the web extension's page and video titles). The list is empty while the user shares no titles, because
 * the host then sends none and `forgetSource` drops the web extension's contexts.
 *
 * Use when:
 * - Text is about to be stored (memory, threads, relationship events, MOOD cue reasons) and must not repeat a title
 */
export function heldTitles(state: SituationState): string[] {
  const titles = Object.values(state.contexts).map(context => context.title)
  return [state.activity?.title ?? null, ...titles].filter(title => title !== null)
}

/**
 * Whether `text` contains one of `titles` whole. Matching ignores case and whitespace differences. A title shorter
 * than {@link HELD_TITLE_MIN_CHARS} never matches.
 */
export function repeatsHeldTitle(text: string, titles: readonly string[]): boolean {
  const haystack = comparable(text)
  return titles.some((title) => {
    const needle = comparable(title)
    return needle.length >= HELD_TITLE_MIN_CHARS && haystack.includes(needle)
  })
}
