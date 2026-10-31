import { ASCII_FACES } from '@proj-airi/stage-shared/conversation-register'
import { describe, expect, it } from 'vitest'

import { stripAsciiFaces } from './ascii-faces'

describe('stripAsciiFaces', () => {
  it('strips the canonical stage-shared face list', () => {
    expect(ASCII_FACES).toEqual([':3', '^^', '^_^', '>_<', '>.<', 'T_T', ';_;', ':)', ':(', ':D', ';)', ':P', 'xD', 'XD', 'o_o', 'O_O', '-_-', '^w^', '<3'])
  })

  it.each(ASCII_FACES.map(face => [face]))('strips the standalone face %s', (face) => {
    expect(stripAsciiFaces(`ok ${face} then`)).toBe('ok then')
    expect(stripAsciiFaces(`${face} ok`)).toBe('ok')
    expect(stripAsciiFaces(`ok ${face}`)).toBe('ok')
  })

  it.each([
    ['love you <3', 'love you'],
    ['hi :3!', 'hi !'],
    ['hi :3, ok', 'hi , ok'],
    ['a :3 :D b', 'a b'],
    ['^_^', ''],
    ['wait >.< what', 'wait what'],
  ])('strips faces from %j', (input, expected) => {
    expect(stripAsciiFaces(input)).toBe(expected)
  })

  it.each([
    '10:30',
    'C:D',
    'x^^y',
    'meet at 10:30 :3c',
    'a:3 b',
    ':3:3',
    'uwu owo',
    'see :p',
    'plain  text with  spaces ',
  ])('leaves %j untouched', (input) => {
    expect(stripAsciiFaces(input)).toBe(input)
  })
})
