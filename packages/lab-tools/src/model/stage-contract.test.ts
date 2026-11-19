import { createHash } from 'node:crypto'

import messages from '@proj-airi/i18n/locales'

import { ASCII_FACES } from '@proj-airi/stage-shared/conversation-register'
import { composeSystemPrompt, STAGE_CONTRACT_EN_SHA256 } from '@proj-airi/stage-shared/stage-contract'
import { describe, expect, it } from 'vitest'

import { buildStageContract, buildSystemPrompt, extractExampleLines } from './stage-contract'

function englishPrompt() {
  const prompt = messages.en.base.prompt
  if (typeof prompt !== 'object' || prompt === null
    || !('emoji' in prompt) || typeof prompt.emoji !== 'string'
    || !('emotion' in prompt) || typeof prompt.emotion !== 'string') {
    throw new Error('English prompt messages are missing')
  }
  return prompt
}

describe('buildStageContract', () => {
  it('renders the canonical English contract from the installed locale messages', () => {
    const contract = buildStageContract()

    expect(contract.sha256).toBe(STAGE_CONTRACT_EN_SHA256)
    expect(contract.sha256).toBe(createHash('sha256').update(contract.text).digest('hex'))
    expect(contract.version).toBe(contract.sha256.slice(0, 12))
    expect(contract.text).toContain('<|ACT happy|>')
    expect(contract.text).toContain('- sleepy (Emotion for feeling Sleepy)')
    expect(contract.exampleLines).toEqual([])
    expect(contract.warnings).toEqual([])
  })

  it('quietly falls back to English for an unknown locale', () => {
    const contract = buildStageContract('xx')

    expect(contract.text).toBe(buildStageContract('en').text)
    expect(contract.warnings).toEqual([])
  })

  it('uses the translated contract for a supported locale', () => {
    const contract = buildStageContract('th')

    expect(contract.sha256).not.toBe(STAGE_CONTRACT_EN_SHA256)
    expect(contract.text).toContain('- sleepy (Emotion for feeling Sleepy)')
    expect(contract.warnings).toEqual([])
  })

  it('collects warnings when even English lacks a contract key', () => {
    const prompt = englishPrompt()
    const original = prompt.emoji
    try {
      Reflect.deleteProperty(prompt, 'emoji')

      expect(buildStageContract('xx').warnings).toEqual([
        '[i18n] English has no message for \'base.prompt.emoji\'. Add it to the English locale files.',
      ])
    }
    finally {
      prompt.emoji = original
    }
  })

  it('extracts spoken examples from cue-leading contract lines', () => {
    const prompt = englishPrompt()
    const original = prompt.emotion
    try {
      prompt.emotion = `${original}\n<{'|'}ACT happy{'|'}> Hello there.\n<{'|'}ACT sad{'|'}>   Oh no.\n<{'|'}ACT think{'|'}>`

      const contract = buildStageContract()
      expect(contract.exampleLines).toEqual(['Hello there.', 'Oh no.'])
      expect(contract.sha256).not.toBe(STAGE_CONTRACT_EN_SHA256)
    }
    finally {
      prompt.emotion = original
    }
  })
})

describe('extractExampleLines', () => {
  const lines = ['<|ACT happy|> Oh, hi! I missed you.', '<|ACT happy strong|> Wait, really?', '<|ACT:{"emotion":{"name":"happy","intensity":1}}|>']

  it('reads spoken examples from CRLF and LF text alike', () => {
    expect(extractExampleLines(lines.join('\r\n'))).toEqual(['Oh, hi! I missed you.', 'Wait, really?'])
    expect(extractExampleLines(lines.join('\n'))).toEqual(['Oh, hi! I missed you.', 'Wait, really?'])
    expect(extractExampleLines(`${lines.join('\r\n')}\r\n`)).toEqual(['Oh, hi! I missed you.', 'Wait, really?'])
    expect(extractExampleLines([lines[0], lines[1]].join('\r\n').replace('\r\n', '\n'))).toEqual(['Oh, hi! I missed you.', 'Wait, really?'])
  })

  it('returns nothing for empty text and keeps the committed contract free of examples', () => {
    expect(extractExampleLines('')).toEqual([])
    expect(extractExampleLines(buildStageContract().text.replace(/\n/g, '\r\n'))).toEqual([])
    expect(buildStageContract().exampleLines).toEqual([])
  })
})

describe('buildSystemPrompt', () => {
  it('composes the card verbatim with the shared formatting rules and contract', () => {
    const cardPrompt = '<|ACT happy|>\n$(echo hi)'
    const prompt = buildSystemPrompt({ locale: 'en', cardPrompt })

    expect(prompt.text).toBe(composeSystemPrompt(cardPrompt, prompt.contract.text))
    expect(prompt.sha256).toBe(createHash('sha256').update(prompt.text).digest('hex'))
    expect(prompt.contract.sha256).toBe(STAGE_CONTRACT_EN_SHA256)
  })

  it('inserts the register section between the card and an unchanged contract', () => {
    const cardPrompt = 'You are Alice.'
    const talking = buildSystemPrompt({ cardPrompt, register: 'talking' })
    const texting = buildSystemPrompt({ cardPrompt, register: 'texting' })
    const discord = buildSystemPrompt({ cardPrompt, register: 'texting', textingFlavor: 'discord' })
    const sectionOf = (text: string, contract: string) => {
      const head = composeSystemPrompt(`${cardPrompt}\n\n`, '')
      expect(text.startsWith(head)).toBe(true)
      expect(text.endsWith(`\n\n${contract}`)).toBe(true)
      return text.slice(head.length, -contract.length - 2)
    }

    expect(sectionOf(talking.text, talking.contract.text)).not.toMatch(/^$|<\|BREAK\|>/)
    expect(sectionOf(texting.text, texting.contract.text)).toContain('<|BREAK|>')
    expect(sectionOf(discord.text, discord.contract.text)).toContain(ASCII_FACES.join(' '))
    expect(discord.text.indexOf(ASCII_FACES.join(' '))).toBeLessThan(discord.text.indexOf(discord.contract.text))
    for (const prompt of [talking, texting, discord]) {
      expect(prompt.contract.sha256).toBe(STAGE_CONTRACT_EN_SHA256)
      expect(prompt.contract.warnings).toEqual([])
    }
    expect(new Set([talking.sha256, texting.sha256, discord.sha256, buildSystemPrompt({ cardPrompt }).sha256]).size).toBe(4)
  })
})

describe('buildSystemPrompt exposedActions', () => {
  const exposedActions = [{ label: 'wave', kind: 'gesture' }, { label: 'moonwalk', kind: 'dance' }] as const
  const section = 'Add "action" set to one of wave inside the ACT JSON for a short gesture while you speak.\nCall perform_action with one of moonwalk for a full-body action; it may be refused while she is busy.'

  it('keeps the contract hash and the prefix equal with and without actions', () => {
    const plain = buildSystemPrompt({ cardPrompt: 'Card.' })
    const withActions = buildSystemPrompt({ cardPrompt: 'Card.', exposedActions })

    expect(withActions.contract.sha256).toBe(STAGE_CONTRACT_EN_SHA256)
    expect(withActions.contract.sha256).toBe(plain.contract.sha256)
    expect(withActions.text.startsWith(plain.text)).toBe(true)
    expect(withActions.text).toBe(`${plain.text}\n\n${section}`)
  })

  it('places the actions section after the contract and before the other tail segments', () => {
    const prompt = buildSystemPrompt({ cardPrompt: '', exposedActions, segments: [{ id: 'toolset', text: 'Tools.' }, { id: 'memory', text: ['- m1: fact.'] }] })

    expect(prompt.report.map(entry => entry.id)).toEqual(['format', 'card', 'register', 'contract', 'actions', 'memory', 'toolset'])
    expect(prompt.text.indexOf(section)).toBeGreaterThan(prompt.text.indexOf(prompt.contract.text))
    expect(prompt.text.indexOf(section)).toBeLessThan(prompt.text.indexOf('- m1: fact.'))
  })

  it('adds no section for an empty list', () => {
    expect(buildSystemPrompt({ cardPrompt: '', exposedActions: [] }).text).toBe(buildSystemPrompt({ cardPrompt: '' }).text)
  })
})
