import { describe, expect, it } from 'vitest'

import { containsForbiddenText, sanitizeModelName } from './privacy'

describe('sanitizeModelName', () => {
  it.each([
    ['/opt/a/b/Chisa v1.pmx', 'Chisa v1'],
    ['C:\\Users\\me\\Models\\Hiyori.zip', 'Hiyori'],
    ['Hiyori', 'Hiyori'],
    ['models/archive.tar.gz', 'archive.tar'],
    ['/opt/models/', ''],
  ])('reduces %j to %j', (name, expected) => {
    expect(sanitizeModelName(name)).toBe(expected)
  })

  it('caps the name at 80 characters', () => {
    expect(sanitizeModelName(`/m/${'x'.repeat(200)}.vrm`)).toBe('x'.repeat(80))
  })
})

describe('containsForbiddenText', () => {
  it.each([
    ['an absolute path', '{"modelName":"/home/user/models/a.pmx"}'],
    ['a Windows path', '{"file":"C:\\\\Users\\\\me\\\\a.pmx"}'],
    ['a URL', '{"detail":{"source":"https://example.com/a"}}'],
    ['an API key', '{"detail":{"key":"sk-abcdef1234567890"}}'],
  ])('flags %s', (_name, line) => {
    expect(containsForbiddenText(line)).toBe(true)
  })

  it.each([
    ['a sample line', '{"v":1,"kind":"sample","role":"window:stage","label":"stage","ratio":"1/2"}'],
    ['a relative incident file', '{"file":"incidents/inc-1.json"}'],
    ['a task-like id', '{"id":"task-12345678"}'],
  ])('allows %s', (_name, line) => {
    expect(containsForbiddenText(line)).toBe(false)
  })
})
