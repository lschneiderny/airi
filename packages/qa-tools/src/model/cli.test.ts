import { describe, expect, it, vi } from 'vitest'

import { modelUsage, runModelCli } from './cli'

function createIo() {
  const out: string[] = []
  const err: string[] = []
  const handlers = {
    prompt: vi.fn(async () => 0),
    score: vi.fn(async () => 0),
    importOllamaBench: vi.fn(async () => 0),
  }
  return {
    out,
    err,
    handlers,
    io: { handlers, stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) },
  }
}

describe('runModelCli', () => {
  it('prints usage on stdout and exits 0 for help', async () => {
    const { io, out, err } = createIo()

    await expect(runModelCli(['help'], '/repo', {}, io)).resolves.toBe(0)

    expect(out.join('')).toBe(modelUsage)
    expect(modelUsage.startsWith('Usage:')).toBe(true)
    expect(err).toEqual([])
  })

  it('exits 2 with usage on stderr for an unknown subcommand', async () => {
    const { io, out, err, handlers } = createIo()

    await expect(runModelCli(['bogus'], '/repo', {}, io)).resolves.toBe(2)

    expect(err.join('')).toContain('bogus')
    expect(err.join('')).toContain(modelUsage)
    expect(out).toEqual([])
    expect(handlers.prompt).not.toHaveBeenCalled()
  })

  it('exits 2 with usage on stderr when no subcommand is given', async () => {
    const { io, err } = createIo()

    await expect(runModelCli([], '/repo', {}, io)).resolves.toBe(2)

    expect(err.join('')).toContain(modelUsage)
  })

  it('exits 2 for flags unknown to the dispatcher before help', async () => {
    const { io, err } = createIo()

    await expect(runModelCli(['help', '--bogus'], '/repo', {}, io)).resolves.toBe(2)

    expect(err.join('')).toContain(modelUsage)
  })

  it.each([
    ['prompt', 'prompt'],
    ['score', 'score'],
    ['import-ollama-bench', 'importOllamaBench'],
  ] as const)('routes %s to its handler with the remaining arguments', async (command, key) => {
    const { io, handlers } = createIo()
    handlers[key].mockResolvedValueOnce(7)
    const env = { QA_RUN_DIR: 'x' }

    await expect(runModelCli([command, '--json', 'file.jsonl'], '/repo', env, io)).resolves.toBe(7)

    expect(handlers[key]).toHaveBeenCalledExactlyOnceWith(['--json', 'file.jsonl'], '/repo', env)
    for (const other of Object.keys(handlers) as (keyof typeof handlers)[]) {
      if (other !== key)
        expect(handlers[other]).not.toHaveBeenCalled()
    }
  })

  it('reports a thrown handler error on stderr and exits 1', async () => {
    const { io, err, handlers } = createIo()
    handlers.score.mockRejectedValueOnce(new Error('boom'))

    await expect(runModelCli(['score'], '/repo', {}, io)).resolves.toBe(1)

    expect(err.join('')).toContain('boom')
  })

  it('falls back to a fixed message when the thrown error has none', async () => {
    const { io, err, handlers } = createIo()
    handlers.prompt.mockRejectedValueOnce(Object.create(null))

    await expect(runModelCli(['prompt'], '/repo', {}, io)).resolves.toBe(1)

    expect(err.join('')).toContain('model command failed')
  })
})
