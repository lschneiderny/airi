import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findBundleLeaks, scanBundle } from './check'

describe('findBundleLeaks', () => {
  it('reports every marker occurrence with its offset', () => {
    const text = 'a="eventa:invoke:motion-qa:state";globalThis.__airiMotionQa={};x.installMotionQaDispatcher()'
    expect(findBundleLeaks('chunk.js', text).map(leak => [leak.marker, leak.offset])).toEqual([
      ['__airiMotionQa', text.indexOf('__airiMotionQa')],
      ['motion-qa:', text.indexOf('motion-qa:')],
      ['installMotionQaDispatcher', text.indexOf('installMotionQaDispatcher')],
    ])
  })

  it('accepts text without markers', () => {
    expect(findBundleLeaks('chunk.js', 'const motionQa = 1; // motion qa')).toEqual([])
  })
})

describe('scanBundle', () => {
  it('finds the marker in the leaking fixture', async () => {
    const result = await scanBundle(resolve(import.meta.dirname, '../../fixtures/prod-bundle-leak'))
    expect(result.files).toBe(1)
    expect(result.leaks.map(leak => leak.marker)).toEqual(['motion-qa:'])
  })
})
