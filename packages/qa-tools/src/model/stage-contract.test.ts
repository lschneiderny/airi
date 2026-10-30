import { createHash } from 'node:crypto'

import messages from '@proj-airi/i18n/locales'

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
})
