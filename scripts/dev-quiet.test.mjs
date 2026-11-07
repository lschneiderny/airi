import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { classifyDevLine, planDevLogPath } from './dev-launcher'

const rootDir = resolve('repo')

describe('quiet dev output', () => {
  it.each([
    ['  \u001B[32m\u279C\u001B[39m  Local:   \u001B[36mhttp://localhost:5173/\u001B[39m', 'http://localhost:5173/'],
    ['renderer dev server running at: http://localhost:5174/', 'http://localhost:5174/'],
    ['  Local: https://localhost:5199/', 'https://localhost:5199/'],
  ])('extracts the server URL from %j', (line, readyUrl) => {
    expect(classifyDevLine(line)).toEqual({ readyUrl })
  })

  it.each([
    'error during build:',
    '\u001B[31mError: listen EADDRINUSE\u001B[39m',
    '[vite] Internal server error: failed to resolve import',
    'TypeError: cannot read property',
    '\u2718 [ERROR] Could not resolve module',
    'Build failed with 1 error',
    '\u2009ELIFECYCLE\u2009 Command failed with exit code 1.',
  ])('retains an error line %j', (line) => {
    expect(classifyDevLine(line).error).toBeTypeOf('string')
  })

  it.each([
    'VITE v8.2.2 ready in 600 ms',
    '  Network: http://192.168.0.1:5173/',
    'renderer dev server running at:',
    'transforming (123) source.ts',
    '  press h + enter to show help',
    '/src/error-handler.ts updated',
    '0 errors found',
  ])('hides ordinary output %j', (line) => {
    expect(classifyDevLine(line)).toEqual({})
  })

  it('plans a filename safe on Windows under the repository root', () => {
    const path = planDevLogPath({
      rootDir,
      packageName: '@proj-airi/stage-web',
      scriptName: 'dev:https',
      timestamp: '2026-11-07T23:00:00.123Z',
    })
    expect(path).toBe(join(rootDir, '.temp/dev/proj-airi-stage-web-dev-https-2026-11-07T23-00-00.123Z.log'))
  })

  it('resolves an override from the repository root', () => {
    const override = resolve('custom.log')
    expect(planDevLogPath({ rootDir, override: 'logs/web.log' })).toBe(join(rootDir, 'logs/web.log'))
    expect(planDevLogPath({ rootDir, override })).toBe(override)
  })
})
