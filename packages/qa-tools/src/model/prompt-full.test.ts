import process from 'node:process'

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runPromptCli } from './prompt'
import { buildSystemPrompt } from './stage-contract'

const fixturePath = 'fixtures/model/full-prompt.json'
const qaToolsRoot = join(import.meta.dirname, '..', '..')

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

  function run(argv: string[], root = qaToolsRoot) {
    return runPromptCli(argv, root, process.env, {
      stdout: text => stdout.push(text),
      stderr: text => stderr.push(text),
    })
  }

  it('prints the prefix, then the fixture tail segments joined by a blank line', async () => {
    expect(await run(['--full', fixturePath])).toBe(0)

    interface Fixture {
      memory: { header: string, entries: string[] }
      toolset: string
      account: string
      stickers: { header: string, entries: { id: string, description: string }[] }
    }
    const fixture: Fixture = JSON.parse(readFileSync(join(qaToolsRoot, fixturePath), 'utf8'))
    expect(stdout.join('')).toBe([
      buildSystemPrompt({ cardPrompt: '' }).text,
      [fixture.memory.header, ...fixture.memory.entries].join('\n'),
      fixture.toolset,
      fixture.account,
      [fixture.stickers.header, ...fixture.stickers.entries.map(sticker => `<|STICKER ${sticker.id}|>: ${sticker.description}`)].join('\n'),
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
