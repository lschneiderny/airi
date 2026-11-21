import process from 'node:process'

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readLastPass } from './verify-last-pass'

const exec = promisify(execFile)

describe('verify step execution', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'verify-runner-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    git('init', '--initial-branch=main')
    git('-c', 'user.name=Verify test', '-c', 'user.email=verify@example.invalid', '-c', 'commit.gpgSign=false', '-c', `core.hooksPath=${join(root, '.git/hooks')}`, 'commit', '--allow-empty', '-m', 'fixture')
    writeFileSync(join(root, '.gitignore'), 'node_modules/\nreceipts.jsonl\n')
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    writeFileSync(join(root, 'change.ts'), 'export const changed = true\n')
    mkdirSync(join(root, 'pkg'))
    writeFileSync(join(root, 'pkg/package.json'), '{"name":"pkg","scripts":{"test:run":"FIXTURE_FLAG=on vitest run --config vitest.config.ts"}}')
    writeFileSync(join(root, 'pkg/change.ts'), 'export const changed = true\n')
    const command = `
      import { appendFileSync } from 'node:fs'
      import { join, relative } from 'node:path'
      const fixtureRoot = ${JSON.stringify(root)}
      if (process.argv.includes('ls')) {
        console.log(JSON.stringify({ packages: { items: [{ name: 'pkg', path: 'pkg' }] } }))
        process.exit(0)
      }
      appendFileSync(join(fixtureRoot, 'receipts.jsonl'), JSON.stringify({
        command: process.argv.includes('build') ? 'build' : 'related',
        directory: relative(fixtureRoot, process.cwd()),
        config: process.argv.includes('--config') ? process.argv[process.argv.indexOf('--config') + 1] : null,
        flag: process.env.FIXTURE_FLAG ?? null,
      }) + '\\n')
      if (process.env.VERIFY_FIXTURE_ACTION === 'fail') {
        console.log('All tests passed')
        process.exit(1)
      }
      if (process.env.VERIFY_FIXTURE_ACTION === 'mutate') {
        appendFileSync('change.ts', '// changed during command\\n')
      }
    `
    for (const entry of ['turbo/bin/turbo', 'vitest/vitest.mjs']) {
      const path = join(root, 'node_modules', entry)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, command)
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    expect(existsSync(root)).toBe(false)
    console.info(`verify fixture cleanup: ${root} absent=true`)
  })

  function verifyFails(args: string[], action = '') {
    return verify(args, action).then(
      () => { throw new Error(`verify ${args.join(' ')} passed`) },
      (error: { code: number, stdout: string }) => error,
    )
  }

  function verify(args: string[], action = '') {
    return exec(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./verify.ts', import.meta.url)), ...args], {
      cwd: root,
      env: { ...process.env, VERIFY_FIXTURE_ACTION: action },
      timeout: 15_000,
    })
  }

  it('runs the build, the root related tests, and each package\'s related tests in order, in their own directories', async () => {
    await verify(['--only', 'test'])
    const receipts: { command: string, directory: string, config: string | null, flag: string | null }[] = JSON.parse(`[${readFileSync(join(root, 'receipts.jsonl'), 'utf8').trim().split('\n').join(',')}]`)
    expect(receipts).toEqual([
      { command: 'build', directory: '', config: null, flag: null },
      { command: 'related', directory: '', config: 'vitest.config.ts', flag: null },
      { command: 'related', directory: 'pkg', config: 'vitest.config.ts', flag: 'on' },
    ])
  }, 20_000)

  it('records a gate pass and includes an unverified commit in the next scope', async () => {
    await verify(['--gate', '--only', 'test'])
    const cache = join(root, '.git/airi-verify')
    const record = readLastPass(cache, 'main')
    expect(record?.steps.test).toBeDefined()
    writeFileSync(join(root, 'unverified.ts'), 'export const unchecked = true\n')
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgSign=false', '-c', `core.hooksPath=${join(root, '.git/hooks')}`, 'commit', '-m', 'unverified'], { cwd: root, stdio: 'pipe' })
    // Keep the merge base fixed while HEAD advances on the feature branch.
    execFileSync('git', ['branch', 'base', 'HEAD~1'], { cwd: root })
    const result = await verify(['--base', 'base', '--only', 'test', '--dry-run'])
    expect(result.stdout).toContain('scope: incremental')
    expect(result.stdout).toContain('M unverified.ts')
    expect(result.stdout).not.toContain('M change.ts')
    expect(readLastPass(cache, 'main')).toEqual(record)
  }, 20_000)

  it.each(['fail', 'mutate'])('never advances the record when a command does %s', async (action) => {
    await verify(['--gate', '--only', 'test'])
    const cache = join(root, '.git/airi-verify')
    const record = readLastPass(cache, 'main')
    writeFileSync(join(root, 'change.ts'), 'export const changed = false\n')
    if (action === 'fail')
      await expect(verify(['--only', 'test'], action)).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('All tests passed') })
    else
      expect((await verify(['--only', 'test'], action)).stdout).toContain('not recorded: files changed during the step')
    expect(readLastPass(cache, 'main')).toEqual(record)
  }, 20_000)

  it('runs lint first and stops on its failure, naming lint:fix when every problem is fixable', async () => {
    const lint = join(root, 'node_modules/@moeru/eslint-config/src/moeru-lint.js')
    mkdirSync(join(lint, '..'), { recursive: true })
    writeFileSync(lint, `console.log('\\u2716 2 problems (2 errors, 0 warnings)\\n  2 errors and 0 warnings potentially fixable with the --fix option.')\nprocess.exit(1)\n`)
    await expect(verify([])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringMatching(/hint: every lint problem above is auto-fixable: run pnpm lint:fix[\s\S]*typecheck skipped not run: lint failed[\s\S]*test\s+skipped not run: lint failed/),
    })
    expect(existsSync(join(root, 'receipts.jsonl'))).toBe(false)
  }, 20_000)

  it('prints only its own lines and a failing command\'s tail when output is not a terminal, and --wait replays them', async () => {
    const failure = await verifyFails(['--only', 'test'], 'fail')
    expect(failure.code).toBe(1)
    expect(failure.stdout).not.toMatch(/^\[test\] rebuild stale workspace packages$/m)
    expect(failure.stdout).toMatch(/\[test\] rebuild stale workspace packages exited 1:\nAll tests passed\n[\s\S]*verify summary[\s\S]*full log: /)
    const log = /full log: (.+)/.exec(failure.stdout)?.[1] ?? ''
    expect(readFileSync(log, 'utf8')).toContain('All tests passed')

    const replay = await verifyFails(['--wait', '--timeout', '0'])
    expect(replay.code).toBe(1)
    expect(replay.stdout).toContain(failure.stdout.trim())
  }, 20_000)

  it('exits 1 from --wait for a waited run that exited 2, so 2 stays a usage error', async () => {
    const broken = await verifyFails(['--base', 'no-such-ref'])
    expect(broken.code).toBe(2)

    const waited = await verifyFails(['--wait', '--timeout', '0'])
    expect(waited.code).toBe(1)
    expect(waited.stdout).toContain('Cannot find the merge base with no-such-ref')
  }, 20_000)

  it('runs in the background with --detach and hands the result to --wait', async () => {
    const started = await verify(['--only', 'test', '--detach'])
    const id = /verify run (\S+) started in the background/.exec(started.stdout)?.[1]
    expect(id).toBeDefined()
    const waited = await verify(['--wait', id!, '--timeout', '15'])
    expect(waited.stdout).toMatch(/verify summary\n {2}test {6}passed/)
  }, 20_000)

  it('runs the smoke at the gate when app runtime changed, and then lists no smoke follow-up', async () => {
    mkdirSync(join(root, 'apps/stage-tamagotchi/src'), { recursive: true })
    writeFileSync(join(root, 'apps/stage-tamagotchi/src/main.ts'), 'export const app = true\n')
    // Verify puts the root's node_modules/.bin first on PATH, so this stands in for pnpm.
    const pnpm = join(root, 'node_modules/.bin/pnpm')
    mkdirSync(join(pnpm, '..'), { recursive: true })
    writeFileSync(pnpm, `#!/bin/sh\necho "$*" >> ${JSON.stringify(join(root, 'pnpm-receipts.txt'))}\n`, { mode: 0o755 })
    const result = await verify(['--gate', '--only', 'test'])
    const calls = readFileSync(join(root, 'pnpm-receipts.txt'), 'utf8').trim().split('\n')
    expect(calls[0]).toMatch(/qa:smoke$/)
    expect(result.stdout).toMatch(/ {2}qa {8}passed .*qa:smoke/)
    expect(result.stdout).not.toContain('also needed')
  }, 20_000)

  it('uses branch coverage on detached HEAD without creating a last record', async () => {
    execFileSync('git', ['checkout', '--detach'], { cwd: root, stdio: 'pipe' })
    const result = await verify(['--only', 'test'])
    expect(result.stdout).toContain('scope: branch (detached HEAD)')
    expect(existsSync(join(root, '.git/airi-verify/last'))).toBe(false)
  }, 20_000)
})
