import { createHash } from 'node:crypto'

import messages from '@proj-airi/i18n/locales'

import { createFallbackOptions } from '@proj-airi/i18n'
import { composeSystemPrompt, renderStageContract } from '@proj-airi/stage-shared/stage-contract'
import { createI18n } from 'vue-i18n'

/** Renders the app's contract from installed locale messages, collecting missing-English warnings. */
export function buildStageContract(locale = 'en') {
  const warnings: string[] = []
  const i18n = createI18n({
    legacy: false,
    locale,
    messages,
    // Keep development-only HTML diagnostics out of the CLI's output streams.
    warnHtmlMessage: false,
    ...createFallbackOptions(message => warnings.push(message)),
  })
  const text = renderStageContract(i18n.global.t)
  const sha256 = createHash('sha256').update(text).digest('hex')
  const exampleLines = text.split('\n').flatMap((line) => {
    const match = /^<\|ACT[^|]*\|>(.+)$/.exec(line)
    return match ? [match[1].trim()] : []
  }).filter(Boolean)

  return { text, sha256, version: sha256.slice(0, 12), warnings, exampleLines }
}

/** Composes formatting rules, untrusted card text, and the canonical stage contract without interpreting the card. */
export function buildSystemPrompt({ locale, cardPrompt }: { locale?: string, cardPrompt: string }) {
  const contract = buildStageContract(locale)
  const text = composeSystemPrompt(cardPrompt, contract.text)
  const sha256 = createHash('sha256').update(text).digest('hex')
  return { text, sha256, contract }
}
