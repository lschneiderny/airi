import { describe, expect, it } from 'vitest'

import { readParameterDisplayNames } from './display-names'

describe('parameter display names', () => {
  it.each([undefined, null, [], {}, { Parameters: {} }, { Parameters: 'bad' }])('ignores malformed documents %j', (input) => {
    expect([...readParameterDisplayNames(input)]).toEqual([])
  })

  it('ignores malformed records without dropping valid string Id and Name pairs', () => {
    expect([...readParameterDisplayNames({
      Parameters: [null, 4, {}, { Id: 4, Name: 'eyes' }, { Id: 'x', Name: 4 }, { Id: 'x' }, { Name: 'eyes' }, { Id: 'Param82', Name: '口罩', GroupId: 'extra' }],
    })]).toEqual([['Param82', '口罩']])
  })
})
