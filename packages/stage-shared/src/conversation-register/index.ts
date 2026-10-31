import { picklist, safeParse } from 'valibot'

export const CONVERSATION_REGISTERS = ['talking', 'texting'] as const
export type ConversationRegister = typeof CONVERSATION_REGISTERS[number]
export const ConversationRegisterSchema = picklist(CONVERSATION_REGISTERS)

/** Invalid persisted or external values use the default spoken register. */
export function parseConversationRegister(input: unknown): ConversationRegister {
  const result = safeParse(ConversationRegisterSchema, input)
  return result.success ? result.output : 'talking'
}

export const TEXTING_FLAVORS = ['plain', 'discord'] as const
export type TextingFlavor = typeof TEXTING_FLAVORS[number]

export const REGISTER_PROMPT_KEYS = {
  talking: 'base.prompt.register-talking',
  texting: 'base.prompt.register-texting',
} as const

export const TEXTING_FLAVOR_PROMPT_KEYS = {
  discord: 'base.prompt.register-texting-discord',
} as const

/**
 * Closed vocabulary shared by prompt rendering and speech sanitization. A texting reply may carry
 * these faces; they are shown in bubbles and never spoken.
 *
 * Pronounceable word faces such as `uwu` and `owo` are left out on purpose: speech reads them.
 * The list is case-sensitive: `xD` and `XD` are both listed, `:p` is not.
 */
export const ASCII_FACES = [':3', '^^', '^_^', '>_<', '>.<', 'T_T', ';_;', ':)', ':(', ':D', ';)', ':P', 'xD', 'XD', 'o_o', 'O_O', '-_-', '^w^', '<3'] as const

/** Renders a character-prompt section, separate from the versioned stage contract. */
export function renderRegisterSection(
  register: ConversationRegister,
  flavor: TextingFlavor,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  const text = t(REGISTER_PROMPT_KEYS[register])
  return register === 'texting' && flavor === 'discord'
    ? `${text}\n\n${t(TEXTING_FLAVOR_PROMPT_KEYS.discord, { faces: ASCII_FACES.join(' ') })}`
    : text
}
