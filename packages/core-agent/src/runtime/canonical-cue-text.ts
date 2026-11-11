import type { AssistantTurn } from '../messages/types'

import { useLlmmarkerParser } from './llm-marker-parser'
import { acceptsRecoveredCue, stripsRecoveredCue } from './recovered-cue'
import { createStreamingCategorizer } from './response-categoriser'

/**
 * Rewrites the near-miss cues of a finished assistant reply the way the chat runtime handled them while it streamed.
 *
 * Use when:
 * - A stored reply returns to the model as conversation history. A model imitates its own earlier turns, so a
 *   malformed marker in the history is written again in every later reply.
 *
 * Expects:
 * - `text` is the complete text of one model step, and `recoverCueNames` is the host's live list
 *   (`ChatOrchestratorStageConfig.recoverCueNames`).
 *
 * Returns:
 * - `text` itself, byte for byte, when the runtime recovered, stripped, or dropped nothing in it. A prompt prefix built
 *   from such replies therefore does not change.
 * - Otherwise the reply as the runtime accepted it. A recovered cue takes its canonical `<|NAME body|>` form.
 *   Near-miss markup that the runtime stripped is left out, as is a stray closer that the parser dropped at the end.
 *   Prose that only resembles a cue, such as "[Act 2]", and a near-miss cue inside a reasoning tag stay as written,
 *   because the runtime left them as text. In a rewritten reply, the escaped marker spelling becomes `<|` and `|>`,
 *   and an unfinished `<|` marker that ends the reply is dropped, as the parser does for speech.
 */
export async function canonicalCueText(text: string, recoverCueNames: readonly string[]): Promise<string> {
  if (!text || !recoverCueNames.length)
    return text

  let canonical = ''
  // The literal text so far. The categorizer reads it to tell a visible cue from one inside a reasoning tag.
  let literals = ''
  let rewritten = false
  // Categorizing parses the text as markup, so it starts only when a near-miss cue appears.
  let categorizer: ReturnType<typeof createStreamingCategorizer> | undefined
  const parser = useLlmmarkerParser({
    recoverCueNames,
    onLiteral: (literal) => {
      canonical += literal
      literals += literal
      categorizer?.consume(literal)
    },
    // These decisions mirror the recovered-cue branch of `onSpecial` in `./chat-orchestrator-runtime`.
    onSpecial: (special, recovery) => {
      if (recovery) {
        if (!categorizer) {
          categorizer = createStreamingCategorizer()
          categorizer.consume(literals)
        }
        if (!categorizer.filterToSpeech(recovery.raw, literals.length))
          return false
        if (!acceptsRecoveredCue(special, recovery.raw)) {
          if (!stripsRecoveredCue(special, recovery.raw))
            return false
          rewritten = true
          return
        }
        rewritten = true
      }
      canonical += special
    },
  })
  await parser.consume(text)
  await parser.end()
  // A dropped stray closer is not in `canonical`, because the parser never emits it.
  return rewritten || parser.stats.strayClosers > 0 ? canonical : text
}

/**
 * Applies {@link canonicalCueText} to every assistant text of a generated turn, in place.
 *
 * Use when:
 * - A copy of a stored generation transcript is about to become provider input. Pass a copy: the stored transcript
 *   stays the text the model wrote.
 *
 * Expects:
 * - The turn's portable round content and its native continuation hold the same reply text, so both are rewritten and
 *   either projection sends the same history.
 *
 * Returns:
 * - Nothing. Text that carries citations is left as written, because citation offsets index into it.
 */
export async function canonicalizeTurnCues(turn: AssistantTurn, recoverCueNames: readonly string[]): Promise<void> {
  for (const round of turn.rounds) {
    for (const part of round.content) {
      if (part.type === 'text' && !part.citations?.length)
        part.text = await canonicalCueText(part.text, recoverCueNames)
    }

    const continuation = round.continuation
    if (continuation?.protocol === 'chat-completions') {
      for (const message of continuation.data) {
        if (message.role !== 'assistant')
          continue
        if (typeof message.content === 'string') {
          message.content = await canonicalCueText(message.content, recoverCueNames)
          continue
        }
        for (const part of message.content ?? []) {
          if (part.type === 'text')
            part.text = await canonicalCueText(part.text, recoverCueNames)
        }
      }
    }
    else if (continuation?.protocol === 'responses') {
      for (const item of continuation.data) {
        if (item.type !== 'message' || item.role !== 'assistant')
          continue
        if (typeof item.content === 'string') {
          item.content = await canonicalCueText(item.content, recoverCueNames)
          continue
        }
        for (const part of item.content) {
          if (part.type === 'output_text' && !part.annotations?.length)
            part.text = await canonicalCueText(part.text, recoverCueNames)
        }
      }
    }
  }
}
