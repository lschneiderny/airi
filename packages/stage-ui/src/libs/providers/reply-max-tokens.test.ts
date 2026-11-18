import { REASONING_REPLY_MAX_TOKENS, REPLY_MAX_TOKENS } from '@proj-airi/stage-shared/stage-contract'
import { describe, expect, it } from 'vitest'

import { replyMaxTokensFor } from './reply-max-tokens'

describe('replyMaxTokensFor', () => {
  it.each([
    ['reasoning turned off', { reasoning: 'disabled', deployment: 'cloud' }, REPLY_MAX_TOKENS],
    ['reasoning turned on', { reasoning: 'enabled', deployment: 'local' }, REASONING_REPLY_MAX_TOKENS],
    ['a cloud provider default, which may reason', { reasoning: undefined, deployment: 'cloud' }, REASONING_REPLY_MAX_TOKENS],
    ['a local provider default', { reasoning: undefined, deployment: 'local' }, REPLY_MAX_TOKENS],
    ['an endpoint of unknown deployment', { reasoning: undefined, deployment: undefined }, REPLY_MAX_TOKENS],
  ] as const)('caps %s', (_, input, cap) => {
    expect(replyMaxTokensFor(input)).toBe(cap)
  })
})
