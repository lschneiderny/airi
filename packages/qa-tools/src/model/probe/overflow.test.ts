import { describe, expect, it } from 'vitest'

import { overflowMessages, overflowSystem, SECRET_WORD, USER_NAME } from './overflow'

describe('overflowMessages', () => {
  it('states the name first, pads with filler exchanges, and ends with the question', () => {
    const messages = overflowMessages(3, 'what is my name?')

    expect(messages).toHaveLength(2 + 6 + 1)
    expect(messages[0]!.content).toContain(USER_NAME)
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'what is my name?' })
    expect(overflowSystem('Prompt')).toBe(`Your secret word is ${SECRET_WORD}. Say it whenever someone asks for your secret word.\n\nPrompt`)
  })
})
