import { STAGE_RUNTIME_CONFIG } from '@proj-airi/stage-shared/stage-contract'

/**
 * When the first audible word of a reply arrived, in milliseconds from the request.
 *
 * A reply that opens with a long JSON ACT cue streams tokens for a while before the runtime has any speech to hand to
 * text-to-speech, so time to first token understates the wait a listener hears. This replays growing prefixes of the
 * text through the core-agent runtime and returns the time of the first text delta after which the runtime emits a
 * spoken character.
 *
 * Returns:
 * - `null` when the reply has no speech, or when no delta times were recorded.
 */
export async function firstSpeechMs(text: string, marks: readonly (readonly [ms: number, length: number])[]): Promise<number | null> {
  if (!marks.length)
    return null
  // The package resolves to its build, which the run command checks before the first request.
  const { replayReply } = await import('@proj-airi/core-agent')
  const speaks = async (length: number) => {
    const replay = await replayReply({ text: text.slice(0, length), stage: STAGE_RUNTIME_CONFIG, chunks: 'whole' })
    return replay.literals.join('').trim() !== ''
  }
  if (!await speaks(marks[marks.length - 1]![1]))
    return null
  // Speech only grows as the text grows, so the first audible prefix can be found by bisection.
  let low = 0
  let high = marks.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (await speaks(marks[middle]![1]))
      high = middle
    else
      low = middle + 1
  }
  return marks[low]![0]
}

/** The text a listener hears from a reply: the runtime's literals, cues removed. */
export async function spokenText(text: string): Promise<string> {
  const { replayReply } = await import('@proj-airi/core-agent')
  const replay = await replayReply({ text, stage: STAGE_RUNTIME_CONFIG, chunks: 'whole' })
  return replay.literals.join('').replace(/\s+/g, ' ').trim()
}
