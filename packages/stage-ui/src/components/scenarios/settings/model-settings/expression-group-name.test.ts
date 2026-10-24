import { describe, expect, it } from 'vitest'

import { groupDisplayName } from './expression-group-name'

describe('groupDisplayName', () => {
  it.each([
    { labels: ['Chat Icon 1', 'Chat Icon 2', 'Chat Icon 3', 'Chat Icon 4'], expected: 'Chat Icon' },
    { labels: ['Hold Bag 1', 'Hold Bag 2'], expected: 'Hold Bag' },
    { labels: ['Glasses 1', 'Glasses 12'], expected: 'Glasses' },
    { labels: ['Black braids', 'White hair braids', 'White hair', 'White ponytail'], expected: 'Black braids / White hair braids +2' },
    { labels: ['coat', 'hat'], expected: 'coat / hat' },
  ])('names $labels as $expected', ({ labels, expected }) => {
    expect(groupDisplayName(labels)).toBe(expected)
  })
})
