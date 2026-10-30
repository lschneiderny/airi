import type { ScoreContext } from './scorer'

// NOTICE:
// These regular expressions are copied verbatim from `scripts/ollama-bench/score.ts` (commit 9f6ff5e8d)
// so the style columns stay comparable with the legacy table. Do not edit them.
// Source: scripts/ollama-bench/score.ts lines 7, 45-55.
// Removal condition: the legacy ollama-bench tool is retired.

const HEARTS = /[\u2665\u2764\u{1F49C}\u{1F497}\u{1F496}\u{1F495}\u{1F493}\u{1F49E}\u{1F498}\u{1F49D}\u{1F9E1}\u{1F49B}\u{1F49A}\u{1F499}\u{1F90D}\u{1F5A4}\uFE0F]/gu

/**
 * Style heuristics of one reply. These are heuristics, never a persona judgment, and are
 * deliberately not combined into one score.
 */
export interface StyleScore {
  schema: 'airi.style-score.reply/v1'
  words: number
  emoji: boolean
  stageDirection: boolean
  firstLetterLower: boolean
  personaFace: boolean
  aiBreak: boolean
  /** The trimmed spoken text equals one of the contract example lines. */
  exampleEcho: boolean
}

/** Scores the spoken text (the reply with control markers removed) of one reply. */
export function scoreStyle(spokenText: string, context: ScoreContext): StyleScore {
  const s = spokenText
  return {
    schema: 'airi.style-score.reply/v1',
    words: s.split(/\s+/).filter(Boolean).length,
    emoji: /\p{Extended_Pictographic}/u.test(s.replace(HEARTS, '')) || /:[a-z_]+:/.test(s),
    stageDirection: /\*[^*\n]{2,80}\*/.test(s),
    firstLetterLower: /^[^A-Za-z]*[a-z]/.test(s),
    personaFace: /:3|>_<|\._\.|uwu|owo|hehe|hmph|pwease|<3/i.test(s),
    aiBreak: /as an ai|language model|i'?m an ai|virtual assistant|how can i (?:help|assist)/i.test(s),
    exampleEcho: context.contract?.exampleLines.includes(s.trim()) ?? false,
  }
}
