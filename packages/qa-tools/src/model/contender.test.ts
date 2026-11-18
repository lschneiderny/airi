import { describe, expect, it } from 'vitest'

import { contenderName } from './contender'

describe('contenderName', () => {
  it.each([
    ['seed-1-nothink', 'model-a · nothink'],
    ['temp-0.3-seed-2-nothink', 'model-a · temp-0.3-nothink'],
    ['seed-3', 'model-a · default'],
    ['seed-1+canonical-history', 'model-a · default+canonical-history'],
    ['seed-2-nothink+app-tools', 'model-a · nothink+app-tools'],
    ['default-nothink', 'model-a · default-nothink'],
    ['default-nothink@intimate', 'model-a · default-nothink'],
    ['seed-1+reasoning-none@close', 'model-a · default+reasoning-none'],
    ['quiet@home', 'model-a · quiet@home'],
  ])('pools config %s into %s', (config, expected) => {
    expect(contenderName('model-a', config)).toBe(expected)
  })
})
