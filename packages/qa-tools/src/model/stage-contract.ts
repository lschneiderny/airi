import type { ConversationRegister, TextingFlavor } from '@proj-airi/stage-shared/conversation-register'

import { createHash } from 'node:crypto'

import messages from '@proj-airi/i18n/locales'

import { createFallbackOptions } from '@proj-airi/i18n'
import { renderRegisterSection } from '@proj-airi/stage-shared/conversation-register'
import { composeSystemPrompt, renderStageContract } from '@proj-airi/stage-shared/stage-contract'
import { createI18n } from 'vue-i18n'

/** Extracts spoken examples using the same rule as the rendered contract. */
export function extractExampleLines(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = /^<\|ACT[^|]*\|>(.+)$/.exec(line)
    return match ? [match[1].trim()] : []
  }).filter(Boolean)
}

function createPromptI18n(locale: string, warnings: string[]) {
  return createI18n({
    legacy: false,
    locale,
    messages,
    // Keep development-only HTML diagnostics out of the CLI's output streams.
    warnHtmlMessage: false,
    ...createFallbackOptions(message => warnings.push(message)),
  })
}

/** Renders the app's contract from installed locale messages, collecting missing-English warnings. */
export function buildStageContract(locale = 'en') {
  const warnings: string[] = []
  const i18n = createPromptI18n(locale, warnings)
  const text = renderStageContract(i18n.global.t)
  const sha256 = createHash('sha256').update(text).digest('hex')
  const exampleLines = extractExampleLines(text)

  return { text, sha256, version: sha256.slice(0, 12), warnings, exampleLines }
}

/**
 * Composes formatting rules, untrusted card text, and the canonical stage contract without interpreting the card.
 * With a `register`, the register section follows the card and precedes the contract, as the app's session prompt
 * places it; the contract, and so `contract.sha256`, does not depend on the register. Without one, no section is added.
 */
export function buildSystemPrompt({ locale = 'en', cardPrompt, register, textingFlavor = 'plain' }: {
  locale?: string
  cardPrompt: string
  register?: ConversationRegister
  textingFlavor?: TextingFlavor
}) {
  const contract = buildStageContract(locale)
  let characterPrompt = cardPrompt
  if (register !== undefined) {
    const { global } = createPromptI18n(locale, contract.warnings)
    const section = renderRegisterSection(register, textingFlavor, (key, params) => params ? global.t(key, params) : global.t(key))
    characterPrompt = [cardPrompt, section].filter(Boolean).join('\n\n')
  }
  const text = composeSystemPrompt(characterPrompt, contract.text)
  const sha256 = createHash('sha256').update(text).digest('hex')
  return { text, sha256, contract }
}
