import { createHash } from 'node:crypto'

import messages from '@proj-airi/i18n/locales'

import { createFallbackOptions } from '@proj-airi/i18n'
import { safeParse } from 'valibot'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'

import { composeSystemPrompt, renderStageContract, STAGE_CONTRACT_EN_SHA256 } from '../stage-contract'
import { ASCII_FACES, ConversationRegisterSchema, parseConversationRegister, renderRegisterSection } from './index'

describe('conversation register', () => {
  it.each(['talking', 'texting'])('accepts the register %s', (input) => {
    expect(safeParse(ConversationRegisterSchema, input).success).toBe(true)
    expect(parseConversationRegister(input)).toBe(input)
  })

  it.each(['TALKING', 'TEXTING', ' texting ', '', 5, null, undefined, {}, [], true].map(input => ({ input })))('defaults malformed input $input to talking', ({ input }) => {
    expect(safeParse(ConversationRegisterSchema, input).success).toBe(false)
    expect(parseConversationRegister(input)).toBe('talking')
  })

  it.each(['plain', 'discord'] as const)('ignores the %s texting flavor while talking', (flavor) => {
    const t = vi.fn((key: string) => key)

    expect(renderRegisterSection('talking', flavor, t)).toBe('base.prompt.register-talking')
    expect(t.mock.calls).toEqual([['base.prompt.register-talking']])
  })

  it('renders plain texting without a flavor section', () => {
    const t = vi.fn((key: string) => key)

    expect(renderRegisterSection('texting', 'plain', t)).toBe('base.prompt.register-texting')
    expect(t.mock.calls).toEqual([['base.prompt.register-texting']])
  })

  it('appends the Discord flavor with the canonical faces as a named parameter', () => {
    const t = vi.fn((key: string, params?: Record<string, string>) => params ? `${key}: ${params.faces}` : key)

    expect(renderRegisterSection('texting', 'discord', t)).toBe(`base.prompt.register-texting\n\nbase.prompt.register-texting-discord: ${ASCII_FACES.join(' ')}`)
    expect(t.mock.calls).toEqual([
      ['base.prompt.register-texting'],
      ['base.prompt.register-texting-discord', { faces: ASCII_FACES.join(' ') }],
    ])
  })

  it('keeps the same contract hash when composed with either register and either texting flavor', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'en',
      messages,
      ...createFallbackOptions(() => {}),
    })
    const t = (key: string, params?: Record<string, string>) => i18n.global.t(key, params ?? {})
    const sections = [
      renderRegisterSection('talking', 'plain', t),
      renderRegisterSection('talking', 'discord', t),
      renderRegisterSection('texting', 'plain', t),
      renderRegisterSection('texting', 'discord', t),
    ]

    expect(new Set(sections).size).toBe(3)
    expect(sections[2]).toContain('<|BREAK|>')
    expect(sections[3]).toContain(ASCII_FACES.join(' '))
    for (const section of sections) {
      const characterPrompt = `card\n\n${section}`
      const prompt = composeSystemPrompt(characterPrompt, renderStageContract(t))
      const contract = prompt.slice(composeSystemPrompt(characterPrompt, '').length + 2)

      expect(createHash('sha256').update(contract).digest('hex')).toBe(STAGE_CONTRACT_EN_SHA256)
    }
  })
})
