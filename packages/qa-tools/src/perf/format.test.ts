import { describe, expect, it } from 'vitest'

import { formatShaLabel } from './format'

describe('formatShaLabel', () => {
  it.each([
    [{ shortSha: '3f1c2b9', dirty: true, epochs: 2 }, '3f1c2b9*~2'],
    [{ shortSha: '3f1c2b9', dirty: false, epochs: 1 }, '3f1c2b9'],
    [{ shortSha: '3f1c2b9', dirty: null, epochs: 3 }, '3f1c2b9~3'],
    [{ shortSha: null, dirty: null, epochs: 0 }, '-'],
  ] as const)('labels %j as %s', (identity, expected) => {
    expect(formatShaLabel(identity)).toBe(expected)
  })
})
