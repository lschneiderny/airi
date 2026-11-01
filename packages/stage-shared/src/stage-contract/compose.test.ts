import type { PromptSegment } from './compose'

import { createHash } from 'node:crypto'

import messages from '@proj-airi/i18n/locales'

import { createFallbackOptions } from '@proj-airi/i18n'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'

import { composePrompt, PROMPT_SEGMENT_BUDGETS, PROMPT_TRUNCATION_MARKER } from './compose'
import { CODE_BLOCK_SYSTEM_PROMPT, composeSystemPrompt, MATH_SYNTAX_SYSTEM_PROMPT, renderStageContract } from './index'

const format = CODE_BLOCK_SYSTEM_PROMPT + MATH_SYNTAX_SYSTEM_PROMPT

function sha256(text: string) {
  return createHash('sha256').update(text).digest('hex')
}

describe('composePrompt', () => {
  it('orders segments by the fixed segment order, not by input order', () => {
    const composed = composePrompt([
      { id: 'spark', text: 'S' },
      { id: 'memory', text: ['m1', 'm2'] },
      { id: 'contract', text: 'C' },
      { id: 'card', text: 'K' },
      { id: 'voice', text: 'V' },
    ])

    expect(composed.prefix).toBe('K\n\nC')
    expect(composed.tail).toBe('m1\nm2\n\nV\n\nS')
    expect(composed.text).toBe('K\n\nC\n\nm1\nm2\n\nV\n\nS')
    expect(composed.report.map(entry => entry.id)).toEqual(['card', 'contract', 'memory', 'voice', 'spark'])
  })

  it('joins non-empty segments with two newlines and skips empty ones', () => {
    const composed = composePrompt([
      { id: 'card', text: 'K' },
      { id: 'contract', text: '' },
      { id: 'memory', text: [] },
      { id: 'toolset', text: 'T' },
      { id: 'account', text: '' },
      { id: 'plugin', text: 'P' },
    ])

    expect(composed.text).toBe('K\n\nT\n\nP')
    expect(composed.prefix).toBe('K')
    expect(composed.tail).toBe('T\n\nP')
  })

  it('returns only the prefix when there is no tail, and only the tail when there is no prefix', () => {
    expect(composePrompt([{ id: 'card', text: 'K' }]).text).toBe('K')
    expect(composePrompt([{ id: 'voice', text: 'V' }])).toMatchObject({ text: 'V', prefix: '', tail: 'V' })
  })

  it('reports size and estimated tokens per segment', () => {
    const composed = composePrompt([{ id: 'card', text: 'abcde' }, { id: 'voice', text: '' }])

    expect(composed.report).toEqual([
      { id: 'card', chars: 5, estimatedTokens: 2, dropped: 0, truncated: false, overBudget: false },
      { id: 'voice', chars: 0, estimatedTokens: 0, dropped: 0, truncated: false, overBudget: false },
    ])
  })

  describe('overflow policies', () => {
    it('warn keeps the text unchanged and flags the segment', () => {
      const card = 'k'.repeat(PROMPT_SEGMENT_BUDGETS.card.maxChars + 1)
      const composed = composePrompt([{ id: 'card', text: card }])

      expect(composed.text).toBe(card)
      expect(composed.report[0]).toEqual({ id: 'card', chars: card.length, estimatedTokens: Math.ceil(card.length / 4), dropped: 0, truncated: false, overBudget: true })
    })

    it('warn does not flag text at exactly the budget', () => {
      const toolset = 't'.repeat(PROMPT_SEGMENT_BUDGETS.toolset.maxChars)

      expect(composePrompt([{ id: 'toolset', text: toolset }]).report[0]).toMatchObject({ overBudget: false, truncated: false })
    })

    it('truncate cuts the text so that it and the marker fit inside the budget', () => {
      const { maxChars } = PROMPT_SEGMENT_BUDGETS.voice
      const voice = 'v'.repeat(maxChars + 50)
      const composed = composePrompt([{ id: 'voice', text: voice }])

      expect(composed.text).toHaveLength(maxChars)
      expect(composed.text).toBe(`${'v'.repeat(maxChars - PROMPT_TRUNCATION_MARKER.length)}${PROMPT_TRUNCATION_MARKER}`)
      expect(composed.report[0]).toEqual({ id: 'voice', chars: maxChars, estimatedTokens: Math.ceil(maxChars / 4), dropped: 0, truncated: true, overBudget: true })
    })

    it('truncate never splits a surrogate pair', () => {
      const { maxChars } = PROMPT_SEGMENT_BUDGETS.control
      const keep = maxChars - PROMPT_TRUNCATION_MARKER.length
      const control = `${'c'.repeat(keep - 1)}😀${'c'.repeat(100)}`
      const composed = composePrompt([{ id: 'control', text: control }])

      expect(composed.text).toBe(`${'c'.repeat(keep - 1)}${PROMPT_TRUNCATION_MARKER}`)
    })

    it('truncate leaves text within the budget untouched', () => {
      const plugin = 'p'.repeat(PROMPT_SEGMENT_BUDGETS.plugin.maxChars)

      expect(composePrompt([{ id: 'plugin', text: plugin }])).toMatchObject({ text: plugin, report: [{ truncated: false, overBudget: false }] })
    })

    it('drop-oldest drops entries from the front until the entry cap holds', () => {
      const { maxEntries } = PROMPT_SEGMENT_BUDGETS.stickers
      const stickers = Array.from({ length: maxEntries + 3 }, (_, index) => `s${index}`)
      const composed = composePrompt([{ id: 'stickers', header: 'Stickers:', text: stickers }])

      expect(composed.text).toBe(['Stickers:', ...stickers.slice(3)].join('\n'))
      expect(composed.report[0]).toMatchObject({ id: 'stickers', dropped: 3, truncated: false, overBudget: true })
    })

    it('drop-oldest drops entries from the front until the entries fit the char budget', () => {
      const { maxChars } = PROMPT_SEGMENT_BUDGETS.memory
      // Three entries of half the budget each: two joined exceed it by the newline, so only the newest stays.
      const entries = ['a', 'b', 'c'].map(letter => letter.repeat(maxChars / 2))
      const composed = composePrompt([{ id: 'memory', header: 'Memory index:', text: entries }])

      expect(composed.text).toBe(`Memory index:\n${entries[2]}`)
      expect(composed.report[0]).toMatchObject({ dropped: 2, overBudget: true, chars: composed.text.length })
    })

    it('drop-oldest keeps every entry within both caps', () => {
      const entries = Array.from({ length: PROMPT_SEGMENT_BUDGETS.memory.maxEntries }, (_, index) => `m${index}`)
      const composed = composePrompt([{ id: 'memory', text: entries }])

      expect(composed.text).toBe(entries.join('\n'))
      expect(composed.report[0]).toMatchObject({ dropped: 0, overBudget: false })
    })

    it('drop-oldest renders only the header when every entry is dropped', () => {
      const composed = composePrompt([{ id: 'memory', header: 'H', text: ['x'.repeat(PROMPT_SEGMENT_BUDGETS.memory.maxChars + 1)] }])

      expect(composed.text).toBe('H')
      expect(composed.report[0]).toMatchObject({ dropped: 1, overBudget: true })
    })

    it('fixed segments are never changed or flagged', () => {
      const unprompted = 'u'.repeat(20_000)

      expect(composePrompt([{ id: 'unprompted', text: unprompted }])).toMatchObject({ text: unprompted, report: [{ truncated: false, overBudget: false }] })
    })
  })

  it('throws on a duplicate segment', () => {
    expect(() => composePrompt([{ id: 'memory', text: ['a'] }, { id: 'memory', text: ['b'] }])).toThrow('Duplicate prompt segment "memory"')
  })

  it('throws on an unknown segment', () => {
    // @ts-expect-error The id is outside the segment order on purpose.
    const unknown: PromptSegment = { id: 'situation', text: 'x' }

    expect(() => composePrompt([unknown])).toThrow('Unknown prompt segment "situation"')
  })

  describe('prefix compatibility', () => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages, ...createFallbackOptions(() => {}) })
    const contract = renderStageContract(i18n.global.t)

    // SHA-256 of composeSystemPrompt before it was routed through composePrompt.
    const cases = [
      { card: 'You are AIRI, a cheerful virtual streamer.', contract, sha256: 'a4ddf4deab0e8ffb8df5cb43048d565667ade5da775f94f106eb4d3371d84cd9' },
      { card: 'You are AIRI, a cheerful virtual streamer.', contract: '', sha256: '6f0c62f5e551facf0378c2fa86889ce498c3ab6c64bcd3aa63348d0149f81853' },
      { card: '# Persona\n\nName: Mika\n\n- Speaks softly.\n- Loves rain.\n', contract, sha256: 'c1c576e02573844c4b3960bbf2a141c0bca59e7ffbc906b45a6963543b0f8264' },
      { card: '# Persona\n\nName: Mika\n\n- Speaks softly.\n- Loves rain.\n', contract: '', sha256: 'a2a0e1ebcff20d3142b0164c18e71c43128d492aa26caf316a8ee24b2f34acb3' },
      { card: '', contract, sha256: '933044fd601e77aa6b139829c672a6387be85d49eb342317926f747f6ff58f60' },
      { card: '', contract: '', sha256: 'b5179093bae74a7174e49ac33d62ad45b39b16deb7df5e446cd266ba5175874b' },
    ]

    it.each(cases)('keeps the pre-composer bytes for card $card.length chars, contract $contract.length chars', (fixture) => {
      expect(sha256(composeSystemPrompt(fixture.card, fixture.contract))).toBe(fixture.sha256)
      expect(sha256(composePrompt([
        { id: 'format', text: format },
        { id: 'card', text: fixture.card },
        { id: 'contract', text: fixture.contract },
      ]).prefix)).toBe(fixture.sha256)
    })

    it('keeps the prefix unchanged when tail segments are added', () => {
      const prefix = composeSystemPrompt('card', contract)
      const composed = composePrompt([
        { id: 'format', text: format },
        { id: 'card', text: 'card' },
        { id: 'contract', text: contract },
        { id: 'memory', text: ['m'] },
      ])

      expect(composed.prefix).toBe(prefix)
      expect(composed.text).toBe(`${prefix}\n\nm`)
    })
  })
})
