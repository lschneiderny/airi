import { describe, expect, it } from 'vitest'

import { tokenDelay } from './delay'

describe('tokenDelay', () => {
  const parser = tokenDelay()

  it.each([
    ['<|DELAY 1|>', 1],
    ['<|DELAY 0.5|>', 0.5],
    ['<|DELAY 5|>', 5],
  ])('reads %s as %s seconds', (special, seconds) => {
    expect(parser.parse(special)).toEqual({ type: 'delay', seconds })
  })

  it.each(['<|DELAY 5.1|>', '<|DELAY 30|>', '<|DELAY 3600|>'])('clamps %s to 5 seconds', (special) => {
    expect(parser.parse(special)).toEqual({ type: 'delay', seconds: 5 })
  })

  it.each(['<|DELAY 0|>', '<|DELAY -1|>', '<|DELAY soon|>', '<|DELAY 1s|>'])('rejects %s', (special) => {
    expect(parser.parse(special)).toBeUndefined()
  })
})
