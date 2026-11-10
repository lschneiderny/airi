import { describe, expect, it } from 'vitest'

import { selectBrowserTestProjects } from './verify-plan'

describe('selectBrowserTestProjects', () => {
  it('selects affected browser projects once, including provider inference', () => {
    expect(selectBrowserTestProjects([
      'packages/stage-ui',
      'apps/stage-tamagotchi',
      'packages/provider-inference',
      'packages/stage-ui',
      'packages/core-agent',
    ])).toEqual(['stage-tamagotchi:browser', 'stage-ui:browser', 'provider-inference:browser'])
  })

  it.each([
    { paths: [] },
    { paths: ['scripts/dev-tools'] },
    { paths: ['packages/stage-ui-three-extra', 'packages/stage'] },
  ])('starts no browser for unaffected packages: $paths', ({ paths }) => {
    expect(selectBrowserTestProjects(paths)).toEqual([])
  })

  it('includes the single-suite stage-pages config without a package project filter', () => {
    expect(selectBrowserTestProjects(['packages/stage-pages'])).toEqual(['stage-pages:browser'])
  })
})
