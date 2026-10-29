import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runPromptCli } from './prompt'
import { buildSystemPrompt } from './stage-contract'

describe('runPromptCli', () => {
  let dir: string
  const cardPrompt = '<|ACT happy|>\n$(echo hi)\nKeep these bytes.\n'
  let stdout: string[]
  let stderr: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-model-prompt-'))
    writeFileSync(join(dir, 'card.txt'), cardPrompt)
    stdout = []
    stderr = []
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function run(argv: string[]) {
    return runPromptCli(argv, dir, {}, {
      stdout: text => stdout.push(text),
      stderr: text => stderr.push(text),
    })
  }

  it('writes only the exact prompt bytes to stdout and three metadata lines to stderr', async () => {
    expect(await run(['--locale', 'en', '--card', 'card.txt'])).toBe(0)

    const prompt = buildSystemPrompt({ locale: 'en', cardPrompt })
    expect(stdout.join('')).toBe(prompt.text)
    expect(stdout.join('')).toContain(cardPrompt)
    expect(stderr.join('')).toBe([
      `promptSha256 ${createHash('sha256').update(stdout.join('')).digest('hex')}`,
      `contractSha256 ${createHash('sha256').update(prompt.contract.text).digest('hex')}`,
      `contractVersion ${prompt.contract.version}`,
      '',
    ].join('\n'))
  })

  it('writes exactly one JSON object with four fields and no stderr', async () => {
    expect(await run(['--card', join(dir, 'card.txt'), '--json'])).toBe(0)

    const prompt = buildSystemPrompt({ cardPrompt })
    expect(JSON.parse(stdout.join(''))).toEqual({
      promptSha256: prompt.sha256,
      contractSha256: prompt.contract.sha256,
      contractVersion: prompt.contract.version,
      text: prompt.text,
    })
    expect(stderr).toEqual([])
  })

  it('defaults to English and an empty card', async () => {
    expect(await run([])).toBe(0)
    expect(stdout.join('')).toBe(buildSystemPrompt({ cardPrompt: '' }).text)
  })

  it('returns 2 with no stdout for a missing card file', async () => {
    expect(await run(['--card', 'does-not-exist.txt'])).toBe(2)
    expect(stdout).toEqual([])
    expect(stderr.join('')).toContain('does-not-exist.txt')
  })

  it.each([
    ['--bogus'],
    ['--card'],
    ['--locale'],
    ['unexpected'],
    ['--json=true'],
  ])('returns 2 for invalid arguments %j', async (...argv) => {
    expect(await run(argv)).toBe(2)
    expect(stdout).toEqual([])
    expect(stderr.join('')).not.toBe('')
  })
})
