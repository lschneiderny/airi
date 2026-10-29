import type { PerformanceEmotion } from '../expression-performance/types'

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

export const STAGE_CONTRACT_KEYS = { emotion: 'base.prompt.emotion', emoji: 'base.prompt.emoji' } as const

/** Renders the stable stage cue rules without reading locale or application state. */
export function renderStageContract(t: (key: string) => string): string {
  const lines = stageContractEmotions.map(({ value, promptName }) => `- ${value} (Emotion for feeling ${promptName})`).join('\n')
  return [t(STAGE_CONTRACT_KEYS.emotion), lines, t(STAGE_CONTRACT_KEYS.emoji)].join('\n\n')
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
  const prompt = CODE_BLOCK_SYSTEM_PROMPT + MATH_SYNTAX_SYSTEM_PROMPT + characterPrompt
  return contract ? `${prompt}\n\n${contract}` : prompt
}

/** Update in the same contract-version commit whenever the English rendering changes. */
export const STAGE_CONTRACT_EN_SHA256 = 'f979e6969867590d47465f8db19b1cd38e97774d85dce3124369abb744a7de5a'
