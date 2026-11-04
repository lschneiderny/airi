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

  it('prints the actions section in plain mode without changing the contract hash', async () => {
    expect(await run(['--exposed-actions', 'wave:gesture,moonwalk:dance'])).toBe(0)

    const plain = buildSystemPrompt({ cardPrompt: '' })
    const prompt = buildSystemPrompt({ cardPrompt: '', exposedActions: [{ label: 'wave', kind: 'gesture' }, { label: 'moonwalk', kind: 'dance' }] })
    expect(stdout.join('')).toBe(prompt.text)
    expect(stdout.join('')).toContain('perform_action with one of moonwalk')
    expect(stderr.join('')).toContain(`contractSha256 ${plain.contract.sha256}`)
    expect(stderr.join('')).toContain(`promptSha256 ${prompt.sha256}`)
  })

  it('includes the section in --json output without --full and keeps contractSha256 identical', async () => {
    expect(await run(['--json'])).toBe(0)
    const without = JSON.parse(stdout.join(''))
    stdout = []
    expect(await run(['--json', '--exposed-actions', 'wave:gesture,moonwalk:dance'])).toBe(0)
    const withActions = JSON.parse(stdout.join(''))

    expect(withActions.contractSha256).toBe(without.contractSha256)
    expect(withActions.contractVersion).toBe(without.contractVersion)
    expect(withActions.text).toContain('Add "action" set to one of wave inside the ACT JSON')
    expect(without.text).not.toContain('perform_action')
    // The prompt hash covers the composed text, so it changes with the section; only the contract hash is stable.
    expect(withActions.promptSha256).not.toBe(without.promptSha256)
    expect(stderr).toEqual([])
  })

  it.each(['wave', 'wave:jig', 'wave:gesture,,nod:gesture', 'Wave!:gesture', ''])('rejects the malformed --exposed-actions %j with exit 2 and no stdout', async (value) => {
    expect(await run(['--exposed-actions', value])).toBe(2)
    expect(stdout).toEqual([])
    expect(stderr.join('')).toContain('qa-tools model prompt: invalid --exposed-actions')
  })
})
