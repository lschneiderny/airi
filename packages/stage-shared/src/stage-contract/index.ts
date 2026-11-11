import type { PerformanceEmotion } from '../expression-performance/types'

import { composePrompt } from './compose'

export * from './compose'

export const stageContractEmotions: readonly { value: PerformanceEmotion, promptName: string }[] = [
  { value: 'happy', promptName: 'Happy' },
  { value: 'sad', promptName: 'Sad' },
  { value: 'angry', promptName: 'Angry' },
  { value: 'think', promptName: 'Think' },
  { value: 'surprised', promptName: 'Surprise' },
  { value: 'awkward', promptName: 'Awkward' },
  { value: 'question', promptName: 'Question' },
  { value: 'curious', promptName: 'Curious' },
  { value: 'neutral', promptName: 'Idle' },
  { value: 'love', promptName: 'Love' },
  { value: 'flustered', promptName: 'Flustered' },
  { value: 'sleepy', promptName: 'Sleepy' },
]

/**
 * Marker vocabulary of the stage that the chat runtime enforces. `declineMarker` lets the model decline an unprompted
 * turn; `recoverCueNames` are the markers whose near-miss spellings, such as `[ACT happy]` or `|<SILENT|>`, become
 * real markers. The decline marker is one of them: left as text, `<SILENT|>` reads as a tag that hides the speech after it.
 */
export const STAGE_RUNTIME_CONFIG = { declineMarker: '<|SILENT|>', recoverCueNames: ['ACT', 'DELAY', 'SILENT'] } as const

export const STAGE_CONTRACT_KEYS = { emotion: 'base.prompt.emotion', mood: 'base.prompt.mood', emoji: 'base.prompt.emoji', response: 'base.prompt.response' } as const

/**
 * Output token cap of one model request on a chat turn. It backs the reply-shape rules of the contract: a reply
 * that obeys them stays far below it, so it binds only when the model ignores them. Providers decide whether
 * reasoning tokens count toward it; a thinking model that counts them can hit the cap before it speaks.
 */
export const REPLY_MAX_TOKENS = 320

/** Renders the register-neutral stage rules (cues, emotion list, MOOD cue, emoji restriction, reply shape) without reading locale or application state. */
export function renderStageContract(t: (key: string) => string): string {
  const lines = stageContractEmotions.map(({ value, promptName }) => `- ${value} (Emotion for feeling ${promptName})`).join('\n')
  return [t(STAGE_CONTRACT_KEYS.emotion), lines, t(STAGE_CONTRACT_KEYS.mood), t(STAGE_CONTRACT_KEYS.emoji), t(STAGE_CONTRACT_KEYS.response)].join('\n\n')
}

export const CODE_BLOCK_SYSTEM_PROMPT = '- For any programming code block, always specify the programming language that supported on @shikijs/rehype on the rendered markdown, eg. ```python ... ```\n'
export const MATH_SYNTAX_SYSTEM_PROMPT = `${[
  '- Use $$...$$ for inline math.',
  '- Use a separate multiline $$ block for each display equation.',
  '- Use a latex fence for a list of independent one-line equations.',
  '- Use a math fence for one multiline equation or LaTeX environment.',
  '- Do not use single dollar signs as math delimiters.',
].join('\n')}\n`

/** Keeps formatting rules before the character prompt and a non-empty contract at the end. */
export function composeSystemPrompt(characterPrompt: string, contract: string): string {
  return composePrompt([
    { id: 'format', text: CODE_BLOCK_SYSTEM_PROMPT + MATH_SYNTAX_SYSTEM_PROMPT },
    { id: 'card', text: characterPrompt },
    { id: 'contract', text: contract },
  ]).prefix
}

/** Update in the same contract-version commit whenever the English rendering changes. */
export const STAGE_CONTRACT_EN_SHA256 = '0922aabf01ac0e51c1acfaa28e3a378af7bbb6d88049dc31bdeef8fa13dc23a7'
