import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { compileCacheEnv } from './compile-cache'

describe('compileCacheEnv', () => {
  it('points an unset cache at the checkout node_modules', () => {
    expect(compileCacheEnv({ PATH: '/bin' }, join('repo'))).toEqual({ NODE_COMPILE_CACHE: join('repo', 'node_modules', '.cache', 'node-compile-cache') })
  })

  it('keeps a value the user set, including an empty one and a Windows spelling', () => {
    expect(compileCacheEnv({ NODE_COMPILE_CACHE: '/tmp/node-compile-cache' }, 'repo')).toEqual({})
    expect(compileCacheEnv({ NODE_COMPILE_CACHE: '' }, 'repo')).toEqual({})
    expect(compileCacheEnv({ Node_Compile_Cache: 'D:\\cache' }, 'repo')).toEqual({})
  })
})
