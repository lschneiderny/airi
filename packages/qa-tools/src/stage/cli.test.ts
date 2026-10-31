import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runStageCli } from './cli'

const context = { repoRoot: join(import.meta.dirname, '../../../..'), cwd: join(import.meta.dirname, '../../fixtures/stage'), selfPids: [] }

function captureOutput() {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  return {
    stdout: () => info.mock.calls.map(call => call.join(' ')).join('\n'),
    stderr: () => error.mock.calls.map(call => call.join(' ')).join('\n'),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('qa:stage gate', () => {
  it('prints one verdict per gate and exits 1 when the arm gate fails', async () => {
    const output = captureOutput()

    const code = await runStageCli(['gate', 'task-11-penetration.json', 'task-10-chisa.json'], context)

    expect(code).toBe(1)
    expect(output.stdout()).toMatch(/^stage-walk-skate: PASS$/m)
    expect(output.stdout()).toMatch(/^stage-arm-penetration: FAIL$/m)
    expect(output.stdout()).toMatch(/^stage-frame-budget: NO INPUT$/m)
  })

  it('exits 0 when every gate with input passes', async () => {
    captureOutput()

    expect(await runStageCli(['gate', 'task-11-chisa.json'], context)).toBe(0)
  })

  it('exits 2 for missing, unreadable or unrecognised evidence', async () => {
    const output = captureOutput()

    expect(await runStageCli(['gate'], context)).toBe(2)
    expect(await runStageCli(['gate', 'missing.json'], context)).toBe(2)
    expect(output.stderr()).toContain('missing.json: ENOENT')
  })
})

describe('qa:stage measure arguments', () => {
  it.each([
    [['measure', '--mode', 'desktop', '--port', '9222'], '--out is required'],
    [['measure', '--mode', 'stage', '--port', '9222', '--out', 'x.json'], '--mode must be window or desktop, got stage'],
    [['measure', '--mode', 'desktop', '--out', 'x.json'], '--port <cdp port> is required without --pairs'],
    [['measure', '--pairs', '3', '--out', 'x.json'], '--pairs needs --profile'],
    [['measure', '--pairs', '3', '--mode', 'desktop', '--profile', 'p', '--out', 'x.json'], 'drop --mode and --port'],
    [['measure', '--mode', 'desktop', '--port', '9222', '--seconds', '0', '--out', 'x.json'], '--seconds must be a positive integer, got 0'],
    [['measure', '--bogus'], 'Unknown option'],
    [['launch'], 'unknown command launch'],
  ])('refuses %j before touching the app', async (argv, message) => {
    const output = captureOutput()

    expect(await runStageCli(argv, context)).toBe(2)
    expect(output.stderr()).toContain(message)
  })
})
