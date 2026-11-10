import process from 'node:process'

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { readStatus } from '@proj-airi/cpu-slots'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readLastPass } from './verify-cache'

const exec = promisify(execFile)

describe('verify step execution', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'verify-runner-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
    git('init', '--initial-branch=main')
    git('-c', 'user.name=Verify test', '-c', 'user.email=verify@example.invalid', '-c', 'commit.gpgSign=false', '-c', `core.hooksPath=${join(root, '.git/hooks')}`, 'commit', '--allow-empty', '-m', 'fixture')
    writeFileSync(join(root, '.gitignore'), 'node_modules/\nslots/\nreceipts.jsonl\n')
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    writeFileSync(join(root, 'change.ts'), 'export const changed = true\n')
    const command = `
      import { appendFileSync, readFileSync } from 'node:fs'
      import { join } from 'node:path'
      if (process.argv.includes('ls')) {
        console.log(JSON.stringify({ packages: { items: [] } }))
        process.exit(0)
      }
      const id = process.env.AIRI_CPU_LEASE
      const lease = JSON.parse(readFileSync(join(process.env.AIRI_CPU_SLOTS_DIR, 'leases', id + '.json'), 'utf8'))
      appendFileSync('receipts.jsonl', JSON.stringify({
        command: process.argv.includes('build') ? 'build' : 'related',
        leaseId: lease.id,
        class: lease.class,
        slots: lease.slots,
        grant: Number(process.env.AIRI_CPU_GRANT),
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

  function verify(args: string[], action = '') {
    return exec(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./verify.ts', import.meta.url)), ...args], {
      cwd: root,
      env: { ...process.env, CI: '', AIRI_CPU_SLOTS: '', AIRI_CPU_SLOTS_DIR: join(root, 'slots'), AIRI_CPU_BUDGET: '12', AIRI_CPU_LEASE: '', AIRI_CPU_GRANT: '', AIRI_CPU_CLASS: '', VERIFY_FIXTURE_ACTION: action },
      timeout: 15_000,
    })
  }

  it('holds one real lease across the build and related-test commands, then releases it', async () => {
    const store = join(root, 'slots')
    await exec(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./verify.ts', import.meta.url)), '--only', 'test', '--force'], {
      cwd: root,
      env: { ...process.env, CI: '', AIRI_CPU_SLOTS: '', AIRI_CPU_SLOTS_DIR: store, AIRI_CPU_BUDGET: '12', AIRI_CPU_LEASE: '', AIRI_CPU_GRANT: '', AIRI_CPU_CLASS: '' },
      timeout: 15_000,
    })
    const receipts: { command: string, leaseId: string, class: string, slots: number, grant: number }[] = JSON.parse(`[${readFileSync(join(root, 'receipts.jsonl'), 'utf8').trim().split('\n').join(',')}]`)
    expect(receipts.map(receipt => receipt.command)).toEqual(['build', 'related'])
    expect(new Set(receipts.map(receipt => receipt.leaseId)).size).toBe(1)
    expect(receipts.map(({ class: cpuClass, slots, grant }) => ({ cpuClass, slots, grant }))).toEqual([
      { cpuClass: 'test', slots: 6, grant: 6 },
      { cpuClass: 'test', slots: 6, grant: 6 },
    ])
    expect(readStatus({ root: store })).toMatchObject({ held: 0, leases: [], queue: [] })
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

  it('restores a missing last record from a cached pass without running commands', async () => {
    await verify(['--gate', '--only', 'test'])
    const cache = join(root, '.git/airi-verify')
    const record = readLastPass(cache, 'main')
    const receipts = readFileSync(join(root, 'receipts.jsonl'), 'utf8')
    rmSync(join(cache, 'last/main.json'))
    const result = await verify(['--gate', '--only', 'test'])
    expect(result.stdout).toMatch(/test\s+cached/)
    expect(readLastPass(cache, 'main')?.steps.test?.tree).toBe(record?.steps.test?.tree)
    expect(readFileSync(join(root, 'receipts.jsonl'), 'utf8')).toBe(receipts)
  }, 20_000)

  it.each(['fail', 'mutate'])('never advances the record when a command does %s', async (action) => {
    await verify(['--gate', '--only', 'test'])
    const cache = join(root, '.git/airi-verify')
    const record = readLastPass(cache, 'main')
    writeFileSync(join(root, 'change.ts'), 'export const changed = false\n')
    if (action === 'fail')
      await expect(verify(['--only', 'test'], action)).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('All tests passed') })
    else
      expect((await verify(['--only', 'test'], action)).stdout).toContain('not cached: files changed during the step')
    expect(readLastPass(cache, 'main')).toEqual(record)
    expect(readStatus({ root: join(root, 'slots') })).toMatchObject({ held: 0, leases: [], queue: [] })
  }, 20_000)

  it('uses branch coverage on detached HEAD without creating a last record', async () => {
    execFileSync('git', ['checkout', '--detach'], { cwd: root, stdio: 'pipe' })
    const result = await verify(['--only', 'test'])
    expect(result.stdout).toContain('scope: branch (detached HEAD)')
    expect(existsSync(join(root, '.git/airi-verify/last'))).toBe(false)
  }, 20_000)
})
