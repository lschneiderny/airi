import { describe, expect, it } from 'vitest'

import { parseExp3Expression } from './exp3'

describe('parseExp3Expression', () => {
  it.each([
    { Parameters: [{ Id: 'ParamX', Value: 'bad' }] },
    { Parameters: [{ Id: 'ParamX', Value: Number.NaN }] },
    { Parameters: [{ Id: '', Value: 1 }] },
    { Parameters: null },
    null,
  ])('rejects values that cannot reach the core model safely: %j', (input) => {
    expect(() => parseExp3Expression(input)).toThrow()
  })

  it('keeps blends and drops invalid fades so the composer default applies', () => {
    expect(parseExp3Expression({ FadeInTime: 'slow', FadeOutTime: 0.5, Parameters: [{ Id: 'ParamX', Value: 1, Blend: 'Multiply' }] })).toEqual({
      FadeInTime: undefined,
      FadeOutTime: 0.5,
      Parameters: [{ Id: 'ParamX', Value: 1, Blend: 'Multiply' }],
    })
  })
})
