import process from 'node:process'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runPromptCli } from './prompt'
import { buildSystemPrompt } from './stage-contract'

const fixturePath = 'fixtures/model/full-prompt.json'
const repoRoot = join(import.meta.dirname, '..', '..')

describe('runPromptCli --full', () => {
  let dir: string
  let stdout: string[]
  let stderr: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-model-full-prompt-'))
    stdout = []
    stderr = []
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function run(argv: string[], root = repoRoot) {
    return runPromptCli(argv, root, process.env, {
      stdout: text => stdout.push(text),
      stderr: text => stderr.push(text),
    })
  }

  it('composes the fixture the way the chat prompt assembler builds its segments', async () => {
    expect(await run(['--full', fixturePath])).toBe(0)

    const prefix = buildSystemPrompt({ cardPrompt: '' })
    const expected = buildSystemPrompt({
      cardPrompt: '',
      segments: [
        { id: 'memory', header: 'Long-term memory. You keep it yourself. Each index line gives the id of one remembered fact.\nMemory index:', text: ['(general) m1: The owner prefers short replies.', 'p2: The owner has a cat named Mochi.'] },
        { id: 'toolset', text: 'You can call the tools listed for this turn.' },
        { id: 'account', text: 'The signed-in owner is Fixture Owner.' },
        { id: 'stickers', header: 'You can send one optional sticker per reply with a marker from this catalog.', text: ['<|STICKER wave|>: A friendly wave', '<|STICKER cheer|>: Celebrating'] },
      ],
    })
    expect(stdout.join('')).toBe(expected.text)
    // Production joins the non-empty segments by a blank line after the cacheable prefix.
    expect(stdout.join('')).toBe([
      prefix.text,
      [
        'Long-term memory. You keep it yourself. Each index line gives the id of one remembered fact.',
        'Memory index:',
        '(general) m1: The owner prefers short replies.',
        'p2: The owner has a cat named Mochi.',
      ].join('\n'),
      'You can call the tools listed for this turn.',
      'The signed-in owner is Fixture Owner.',
      [
        'You can send one optional sticker per reply with a marker from this catalog.',
        '<|STICKER wave|>: A friendly wave',
        '<|STICKER cheer|>: Celebrating',
      ].join('\n'),
    ].join('\n\n'))
  })

  it('returns 2 with a clear message for a missing fixture', async () => {
    expect(await run(['--full', 'does-not-exist.json'])).toBe(2)
    expect(stdout).toEqual([])
    expect(stderr.join('')).toContain('fixture file not found: does-not-exist.json')
  })

  it('returns 2 for a fixture with an unknown key', async () => {
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ memoryy: { entries: [] } }))
    expect(await run(['--full', 'bad.json'], dir)).toBe(2)
    expect(stdout).toEqual([])
    expect(stderr.join('')).toContain('invalid --full fixture bad.json')
  })
})

describe('buildSystemPrompt segments', () => {
  it('keeps the prefix-only bytes without segments and with empty segments', () => {
    const prefix = buildSystemPrompt({ cardPrompt: 'card' })
    expect(buildSystemPrompt({ cardPrompt: 'card', segments: [{ id: 'memory', text: [] }, { id: 'toolset', text: '' }] }).sha256).toBe(prefix.sha256)
  })
})
