/** Longest context text, in code points, that one source keeps. The rendered bullet is shorter still. */
const CONTEXT_TEXT_MAX_CHARS = 400

/** A bracketed `[Situation ...]` header inside source text, which would imitate the block's own header. */
const SITUATION_HEADER_PATTERN = /\[(situation\b[^\]]*)\]/gi

/**
 * Prepares untrusted source text for the situation: trims it, caps it at 400 code points, and neutralizes marker
 * delimiters (`<|`, `|>`) and `[Situation ...]` headers. The model must never see cue syntax inside its situation
 * block, where it could copy it into a spoken reply, nor a second block header.
 *
 * It lives apart from the sensors, which import the situation store, so the store's own collaborators (the thread
 * extractor) can use it without an import cycle.
 */
export function situationContextText(text: string): string {
  const capped = Array.from(text.trim()).slice(0, CONTEXT_TEXT_MAX_CHARS).join('')
  return capped.replaceAll('<|', '(').replaceAll('|>', ')').replace(SITUATION_HEADER_PATTERN, '($1)')
}
