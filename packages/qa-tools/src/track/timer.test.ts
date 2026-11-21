import type { TimerHost } from './timer'

import process from 'node:process'

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TrackUsageError } from './args'
import { installTimer, renderUnits, TIMER_UNIT, uninstallTimer, unitPath } from './timer'

const UNITS = { runner: '/srv/airi-wt/perf-track-runner', ref: 'origin/main', pnpm: '/opt/bin/pnpm', git: '/usr/bin/git', path: '/opt/bin:/usr/bin' }

describe('renderUnits', () => {
  it('fills every placeholder and keeps the timer and service contract', () => {
    const { service, timer } = renderUnits({ ...UNITS, ref: 'user/feat/example' })
    expect(`${service}${timer}`).not.toMatch(/@[A-Z]+@/)
    expect(timer).toContain('Persistent=true')
    expect(timer).toContain('OnCalendar=*-*-* 01:00:00')
    expect(timer).toContain('Unit=airi-perf-track.service')
    expect(timer).toContain('RandomizedDelaySec=10min')
    expect(timer).toContain('WantedBy=timers.target')
    expect(service).toContain('Type=oneshot')
    expect(service).toContain('ExecStartPre=/usr/bin/git -C /srv/airi-wt/perf-track-runner fetch --quiet origin')
    expect(service).toContain('ExecStartPre=/opt/bin/pnpm -C /srv/airi-wt/perf-track-runner install --frozen-lockfile')
    expect(service).toContain('ExecStopPost=/opt/bin/pnpm -C /srv/airi-wt/perf-track-runner qa:display down --name perf-track')
    expect(service).toContain('ExecStartPre=/usr/bin/git -C /srv/airi-wt/perf-track-runner checkout --quiet --detach user/feat/example')
    expect(service).toContain('Environment="PATH=/opt/bin:/usr/bin"')
    expect(service).toContain('TimeoutStartSec=6h')
    const execStart = service.split('\n').find(line => line.startsWith('ExecStart='))
    expect(execStart?.slice('ExecStart='.length)).toMatch(/^\/usr\/bin\/systemd-inhibit --what=sleep:idle --mode=block .* perf:track tick --trigger timer$/)
  })

  it('refuses an empty value as a usage error', () => {
    expect(() => renderUnits({ ...UNITS, ref: '' })).toThrow(TrackUsageError)
    expect(() => renderUnits({ ...UNITS, ref: '  ' })).toThrow(/ref/)
  })
})

describe('unitPath', () => {
  it('drops relative and node_modules/.bin entries that pnpm prepends for a script', () => {
    expect(unitPath('./node_modules/.bin:/srv/airi/node_modules/.bin:/opt/bin::/usr/bin')).toBe('/opt/bin:/usr/bin')
    expect(unitPath('/srv/airi/node_modules/.pnpm/node_modules/.bin:/usr/bin')).toBe('/usr/bin')
  })

  it('keeps an absolute .bin directory outside node_modules', () => {
    expect(unitPath('/opt/pnpm-home/.bin:/opt/mise/shims/.bin:/usr/bin')).toBe('/opt/pnpm-home/.bin:/opt/mise/shims/.bin:/usr/bin')
  })
})

describe('install-timer and uninstall-timer', () => {
  let root: string
  let main: string
  let configHome: string
  let binDir: string
  let gitCalls: string[][]
  let systemctlCalls: string[][]
  let printed: string[]
  const runner = () => join(root, 'repo-wt', 'perf-track-runner')
  const unitDir = () => join(configHome, 'systemd', 'user')

  function host(onSystemctl: (args: readonly string[]) => void = () => {}): TimerHost {
    return {
      git: (args) => {
        gitCalls.push([...args])
        if (args.includes('--git-common-dir'))
          return `${join(main, '.git')}\n`
        if (args.includes('add'))
          mkdirSync(runner(), { recursive: true })
        return ''
      },
      systemctl: (args) => {
        systemctlCalls.push([...args])
        onSystemctl(args)
        return args[1] === 'list-timers' ? 'NEXT 01:04 airi-perf-track.timer\n' : ''
      },
      configHome,
      pathEnv: `./node_modules/.bin:${binDir}`,
      print: text => printed.push(text),
    }
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'airi-track-timer-'))
    main = join(root, 'repo')
    configHome = join(root, 'config')
    binDir = join(root, 'bin')
    mkdirSync(binDir)
    for (const name of ['git', 'pnpm']) {
      writeFileSync(join(binDir, name), '')
      chmodSync(join(binDir, name), 0o755)
    }
    gitCalls = []
    systemctlCalls = []
    printed = []
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const unitModes = () => ['airi-perf-track.service', 'airi-perf-track.timer'].map(file => statSync(join(unitDir(), file)).mode & 0o777)

  it('creates and locks a missing runner, writes both units, then reloads and enables in order', () => {
    const umask = process.umask(0o077)
    try {
      installTimer(host(), { ref: null })
    }
    finally {
      process.umask(umask)
    }

    expect(gitCalls).toEqual([
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      ['-C', main, 'rev-parse', '--verify', '--quiet', 'origin/main^{commit}'],
      ['-C', main, 'worktree', 'add', '--detach', runner(), 'origin/main'],
      ['-C', main, 'worktree', 'lock', '--reason', 'perf tracker', runner()],
    ])
    expect(unitModes()).toEqual([0o644, 0o644])
    const service = readFileSync(join(unitDir(), 'airi-perf-track.service'), 'utf8')
    expect(service).toContain(`WorkingDirectory=${runner()}`)
    expect(service).toContain(`${join(binDir, 'pnpm')} -C ${runner()} perf:track tick --trigger timer`)
    expect(service).toContain(`Environment="PATH=${binDir}"`)
    expect(systemctlCalls).toEqual([
      ['--user', 'daemon-reload'],
      ['--user', 'enable', '--now', TIMER_UNIT],
      ['--user', 'list-timers', TIMER_UNIT],
    ])
    expect(printed.join('\n')).toContain('NEXT 01:04')
  })

  it('resets units left at 0600 to 0644 on reinstall', () => {
    installTimer(host(), { ref: null })
    for (const file of ['airi-perf-track.service', 'airi-perf-track.timer'])
      chmodSync(join(unitDir(), file), 0o600)

    installTimer(host(), { ref: null })

    expect(unitModes()).toEqual([0o644, 0o644])
  })

  it('resolves git and pnpm from an absolute .bin directory outside node_modules', () => {
    const dotBin = join(root, '.bin')
    mkdirSync(dotBin)
    for (const name of ['git', 'pnpm']) {
      writeFileSync(join(dotBin, name), '')
      chmodSync(join(dotBin, name), 0o755)
    }
    installTimer({ ...host(), pathEnv: dotBin }, { ref: null })

    const service = readFileSync(join(unitDir(), 'airi-perf-track.service'), 'utf8')
    expect(service).toContain(`ExecStartPre=${join(dotBin, 'git')} -C ${runner()} fetch --quiet origin`)
    expect(service).toContain(`Environment="PATH=${dotBin}"`)
  })

  it('reuses an existing runner without adding or locking it again', () => {
    mkdirSync(runner(), { recursive: true })
    installTimer(host(), { ref: 'origin/user/feat/example' })

    expect(gitCalls.filter(args => args.includes('worktree'))).toEqual([])
    expect(readFileSync(join(unitDir(), 'airi-perf-track.service'), 'utf8')).toContain('checkout --quiet --detach origin/user/feat/example')
  })

  it('refuses a ref that names no commit before touching anything', () => {
    const refusing: TimerHost = { ...host(), git: (args) => {
      if (args.includes('--verify'))
        throw new Error('exit 1')
      return `${join(main, '.git')}\n`
    } }
    expect(() => installTimer(refusing, { ref: 'no-such-ref' })).toThrow(TrackUsageError)
    expect(existsSync(unitDir())).toBe(false)
    expect(systemctlCalls).toEqual([])
  })

  it('fails when git or pnpm is not on PATH', () => {
    rmSync(join(binDir, 'pnpm'))
    expect(() => installTimer(host(), { ref: null })).toThrow(/pnpm/)
    expect(systemctlCalls).toEqual([])
  })

  it('disables before removing both units, reloads, and leaves the worktrees with their removal command', () => {
    installTimer(host(), { ref: null })
    systemctlCalls = []
    printed = []
    const presentAtDisable: boolean[] = []

    uninstallTimer(host((args) => {
      if (args[1] === 'disable')
        presentAtDisable.push(existsSync(join(unitDir(), 'airi-perf-track.timer')))
    }))

    expect(systemctlCalls).toEqual([
      ['--user', 'disable', '--now', TIMER_UNIT],
      ['--user', 'daemon-reload'],
    ])
    expect(presentAtDisable).toEqual([true])
    expect(existsSync(join(unitDir(), 'airi-perf-track.service'))).toBe(false)
    expect(existsSync(join(unitDir(), 'airi-perf-track.timer'))).toBe(false)
    expect(existsSync(runner())).toBe(true)
    const output = printed.join('\n')
    expect(output).toContain(runner())
    expect(output).toContain(`git -C ${main} worktree unlock ${runner()} && git -C ${main} worktree remove ${runner()}`)
  })

  it('skips disabling when no timer is installed', () => {
    uninstallTimer(host())
    expect(systemctlCalls).toEqual([['--user', 'daemon-reload']])
  })
})
