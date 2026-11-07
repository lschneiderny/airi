import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadQaEnv } from './load'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qa-env-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('loadQaEnv', () => {
  it('silently ignores a missing file', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(loadQaEnv(root, {})).toEqual({ file: join(root, '.env.qa'), loaded: [] })
    expect(warn).not.toHaveBeenCalled()
  })

  it('parses quoted values and preserves shell variables including empty strings', () => {
    writeFileSync(join(root, '.env.qa'), '# local rigs\nAIRI_QA_RIG_FORBOOTH="/rig with spaces"\nAIRI_QA_RIG_BEAR=file\nAIRI_QA_CUBISM_CORE=file-core\n')
    const env = { AIRI_QA_RIG_BEAR: '/shell', AIRI_QA_CUBISM_CORE: '' }

    const result = loadQaEnv(root, env)

    expect(env).toEqual({ AIRI_QA_RIG_FORBOOTH: '/rig with spaces', AIRI_QA_RIG_BEAR: '/shell', AIRI_QA_CUBISM_CORE: '' })
    expect(result.loaded).toEqual(['AIRI_QA_RIG_FORBOOTH'])
  })

  it('warns and ignores keys outside AIRI_QA_', () => {
    writeFileSync(join(root, '.env.qa'), 'NODE_OPTIONS=bad\nAIRI_QA_RIG_FORBOOTH=/rig\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = {}

    loadQaEnv(root, env)

    expect(env).toEqual({ AIRI_QA_RIG_FORBOOTH: '/rig' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NODE_OPTIONS'))
  })

  it('accepts CRLF, export syntax, empty values, comments and quoted multiline values', () => {
    writeFileSync(join(root, '.env.qa'), '# windows\r\nexport AIRI_QA_RIG_FORBOOTH="C:/rig #1" # local\r\nAIRI_QA_EMPTY=\r\nAIRI_QA_NOTES="first\r\nsecond"\r\n')
    const env = {}

    loadQaEnv(root, env)

    expect(env).toEqual({ AIRI_QA_RIG_FORBOOTH: 'C:/rig #1', AIRI_QA_EMPTY: '', AIRI_QA_NOTES: 'first\nsecond' })
  })

  it.each(['not an assignment', 'AIRI_QA_RIG_FORBOOTH="unterminated', 'AIRI_QA_RIG_FORBOOTH="rig" trailing'])('warns without applying malformed input %j', (input) => {
    writeFileSync(join(root, '.env.qa'), input)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = {}

    expect(loadQaEnv(root, env).loaded).toEqual([])
    expect(env).toEqual({})
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('malformed'))
  })
})
