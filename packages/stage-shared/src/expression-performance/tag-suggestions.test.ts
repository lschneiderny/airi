import type { CatalogEntry } from './catalog'

import { describe, expect, it } from 'vitest'

import { buildTagSuggestionPrompt, parseTagSuggestions, tagSuggestionEntries, tagSuggestionPatch } from './tag-suggestions'

const entry = (id: string, patch: Partial<CatalogEntry> = {}): CatalogEntry => ({ id, label: id, kind: 'prop', group: null, confirmed: true, exposedToLlm: false, mappings: [], fileName: `${id}.exp3.json`, parameterIds: [], ...patch })

const catalog = [
  entry('bread', { label: '面包', parameterIds: ['ParamBread'] }),
  entry('wink', { kind: 'face' }),
  entry('coat', { kind: 'outfit' }),
  entry('watermark', { kind: 'system' }),
  entry('zzz', { kind: 'effect' }),
  entry('game', { idleUse: 'activity' }),
  entry('reversed', { inverted: true }),
]
const reply = (entries: unknown[]) => JSON.stringify({ entries })

describe('tag suggestion prompt', () => {
  it('asks about faces, effects and props only, numbered from 1, and sends labels, kinds, files and parameters', () => {
    expect(tagSuggestionEntries(catalog).map(candidate => candidate.id)).toEqual(['bread', 'wink', 'zzz', 'game'])
    const { system, user } = buildTagSuggestionPrompt(catalog)
    const lines = user.split('\n').map(line => JSON.parse(line))
    expect(lines).toEqual([
      { n: 1, label: '面包', kind: 'prop', file: 'bread.exp3.json', parameters: ['ParamBread'] },
      { n: 2, label: 'wink', kind: 'face', file: 'wink.exp3.json', parameters: [] },
      { n: 3, label: 'zzz', kind: 'effect', file: 'zzz.exp3.json', parameters: [] },
      { n: 4, label: 'game', kind: 'prop', file: 'game.exp3.json', parameters: [] },
    ])
    expect(system).toContain('morning:')
    expect(system).toContain('check-in:')
    expect(user).not.toContain('coat')
    expect(user).not.toContain('watermark')
  })
})

describe('parseTagSuggestions', () => {
  it('reads a fenced reply into suggestions with the fixed tags only', () => {
    const suggestions = parseTagSuggestions(`\`\`\`json\n${reply([
      { n: 1, pastime: true, occasions: ['morning', 'brunch'], moments: [], reason: 'a slice of bread' },
      { n: 2, moments: ['check-in', 'dancing'], reason: 'a wink' },
      { n: 3, sleep: true, occasions: ['late-night'] },
    ])}\n\`\`\``, catalog)
    expect(suggestions).toEqual([
      { id: 'bread', label: '面包', idleUse: 'activity', occasions: ['morning'], moments: [], reason: 'a slice of bread', replaces: false },
      { id: 'wink', label: 'wink', idleUse: 'never', occasions: [], moments: ['check-in'], reason: 'a wink', replaces: false },
      // Occasions belong to a pastime, so a sleep entry keeps none.
      { id: 'zzz', label: 'zzz', idleUse: 'sleep', occasions: [], moments: [], reason: '', replaces: false },
    ])
    expect(tagSuggestionPatch(suggestions[0])).toEqual({ idleUse: 'activity', occasions: ['morning'], moments: [] })
  })

  it('drops what the model may not decide', () => {
    expect(parseTagSuggestions(reply([
      // No such entry: 5 would be the reversed switch, which was never offered.
      { n: 5, pastime: true },
      { n: 0, pastime: true },
      { n: 1.5, pastime: true },
      // A face is not something she picks up.
      { n: 2, pastime: true, occasions: ['morning'] },
      // Nothing tagged, and what the entry already has.
      { n: 3, pastime: false, moments: [] },
      { n: 4, pastime: true },
      // A second answer for the same entry.
      { n: 1, pastime: true },
      { n: 1, sleep: true },
    ]), catalog)).toEqual([
      { id: 'bread', label: '面包', idleUse: 'activity', occasions: [], moments: [], reason: '', replaces: false },
    ])
  })

  it('marks a suggestion that would replace a choice the user made', () => {
    const [suggestion] = parseTagSuggestions(reply([{ n: 4, pastime: true, occasions: ['gaming'] }]), catalog)
    expect(suggestion).toMatchObject({ id: 'game', occasions: ['gaming'], replaces: true })
  })

  it('throws on a reply that is not the JSON shape', () => {
    expect(() => parseTagSuggestions('I think the bread suits the morning.', catalog)).toThrow()
    expect(() => parseTagSuggestions('{"entries":"none"}', catalog)).toThrow()
  })
})
