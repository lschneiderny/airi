import type { BenchRunRecord } from '@proj-airi/stage-shared/perf/usage'

import type { HostLoad } from '../host-quiet/wait'
import type { FindingOpenEvent, TrackEvent } from './findings'
import type { TickOptions, TrackHost } from './run'

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { TZDate } from '@date-fns/tz'
import { addMinutes } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { appendBenchLine } from '../bench/history'
import { formatHostLoad } from '../host-quiet/wait'
import { appendTrackEvent, findingId } from './findings'
import { runTick } from './run'

const ZONE = 'Europe/Berlin'
const MAIN = '1'.repeat(40)
const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)
const OLD_HEAD = 'c'.repeat(40)
const SHARED = 'd'.repeat(40)
const PR_HEAD = 'e'.repeat(40)
const CUBISM = 'apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js'
const calm: HostLoad = { load1: 0.5, cores: 16, externalCpuPct: 2, psiCpuSomeAvg10: 0 }
const busy: HostLoad = { load1: 14, cores: 16, externalCpuPct: 60, psiCpuSomeAvg10: 30 }

interface BenchCall {
  readonly seq: number
  readonly sha: string
  readonly scenario: string
  readonly runs: number
  readonly out: string
  readonly notAfter: string | null
}

/** What a fake bench does: its exit code, and the p95 and validity of the runs it records. */
interface BenchBehavior {
  readonly exit?: number
  /** The spawn itself fails, as when `pnpm` cannot start. */
  readonly reject?: boolean
  readonly p95?: number
  readonly valid?: readonly boolean[]
  readonly sha?: string
  readonly dirty?: boolean
  /** Moves the fake clock to this time when the bench ends. */
  readonly endAt?: number
}

function at(hours: number, minutes = 0): number {
  return new TZDate(2026, 10, 21, hours, minutes, 0, ZONE).getTime()
}

function record(sha: string, scenario: string, run: number, t: number, p95: number, valid: boolean, dirty: boolean): BenchRunRecord {
  return {
    v: 1,
    kind: 'bench-run',
    t,
    sessionId: `bench-${t}-${run}`,
    matrix: 'bench-v1',
    scenario,
    scenarioVersion: 1,
    run,
    sha,
    dirty,
    diffHash: null,
    modelFingerprint: 'model-fixture',
    buildMode: 'dev',
    electronVersion: '43',
    host: { platform: 'linux', arch: 'x64', cpuModel: 'fixture-cpu', cores: 16, totalMemKb: 1000, gpu: null },
    valid,
    ...(valid ? {} : { invalidReason: 'fixture-invalid' }),
    metrics: {
      fps: 60,
      p50FrameMs: 16,
      p95FrameMsApprox: p95,
      share21: 0,
      share36: 0,
      share100: 0,
      stageWindowCpuPct: 40,
      stageWindowCpuMsPerFrame: 4,
      gpuCpuPct: 10,
      browserCpuPct: 5,
      stageWindowWorkingSetKb: 300_000,
      stageSumMeanMs: null,
      recorderMs: 1,
    },
  }
}

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qa-track-run-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/**
 * A replayable host: git answers from a table, `gh` from `prs`, and each `qa:bench` appends the records its
 * behavior names to `bench.jsonl` and moves the clock ten minutes, as a real bench would.
 */
function fakeHost(options: {
  start: number
  bench?: (call: BenchCall) => BenchBehavior
  host?: HostLoad
  prs?: readonly { number: number, headRefOid: string, baseRefName: string, updatedAt: string }[] | Error
  dirtyStatus?: string
  revList?: Readonly<Record<string, readonly string[]>>
  pidAlive?: boolean
  /** Answers a git call first; `undefined` falls through to the table. */
  git?: (args: readonly string[]) => string | undefined
  /** Moves the clock to the returned time after a spawn ends. */
  afterSpawn?: (args: readonly string[]) => number | undefined
}) {
  const main = join(root, 'repo')
  const stateDir = join(root, 'state')
  const wt = join(root, 'repo-wt', 'perf-track')
  mkdirSync(main, { recursive: true })
  writeFileSync(join(main, '.env.qa'), 'AIRI_QA_MMD_MODEL="/home/user/models/fixture.pmx"\nAIRI_QA_RIG_FORBOOTH="/home/user/rigs/forbooth"\n')
  let clock = options.start
  let wtSha: string | null = null
  const spawns: { command: string, args: readonly string[], cwd: string, env: Readonly<Record<string, string | undefined>> }[] = []
  const benches: BenchCall[] = []
  const notifications: string[] = []
  const printed: string[] = []
  const gitCalls: string[][] = []
  const refs: Record<string, string> = { 'origin/main': MAIN, 'base-ref': BASE, 'head-ref': HEAD }

  const git: TrackHost['git'] = async (cwd, args) => {
    gitCalls.push([cwd, ...args])
    const answer = options.git?.(args)
    if (answer !== undefined)
      return answer
    const [command, ...rest] = args
    switch (command) {
      case 'rev-parse':
        if (rest.includes('--git-common-dir'))
          return `${join(main, '.git')}\n`
        return `${refs[rest.at(-1)?.replace('^{commit}', '') ?? ''] ?? rest.at(-1)?.replace('^{commit}', '')}\n`
      case 'worktree':
        if (rest[0] === 'add') {
          mkdirSync(wt, { recursive: true })
          writeFileSync(join(wt, '.git'), 'gitdir: fixture\n')
        }
        return ''
      case 'checkout':
        wtSha = rest.at(-1) ?? null
        return ''
      case 'status':
        return options.dirtyStatus ?? ''
      case 'merge-base':
        return `${BASE}\n`
      case 'diff':
        return 'packages/stage-ui-live2d/src/model.ts\n'
      case 'rev-list': {
        if (rest[0] === '--count')
          return '2\n'
        return `${(options.revList?.[rest[0]] ?? []).join('\n')}\n`
      }
      case 'log':
        if (rest[0] === '--reverse')
          return ''
        return `${HEAD} feat: heavier body\n`
      case 'diff-tree':
        return 'packages/stage-ui-mmd/src/body.ts\n'
      default:
        return ''
    }
  }

  const host: TrackHost = {
    toolRoot: join(root, 'tool'),
    stateDir,
    env: { AIRI_PERF_BENCH_DIR: stateDir },
    timeZone: ZONE,
    pid: 1000,
    signal: new AbortController().signal,
    git,
    gh: async () => {
      if (options.prs instanceof Error)
        throw options.prs
      return JSON.stringify(options.prs ?? [])
    },
    spawn: async (command, args, spawnOptions) => {
      spawns.push({ command, args, ...spawnOptions })
      // pnpm exits 1 when its TMPDIR does not exist.
      if (!existsSync(spawnOptions.env.TMPDIR ?? ''))
        return 1
      if (args.includes('qa:setup')) {
        mkdirSync(dirname(join(wt, CUBISM)), { recursive: true })
        writeFileSync(join(wt, CUBISM), '')
      }
      if (!args.includes('qa:bench')) {
        clock = options.afterSpawn?.(args) ?? clock
        return 0
      }
      const flag = (name: string) => {
        const index = args.indexOf(name)
        return index === -1 ? null : args[index + 1] ?? null
      }
      const call: BenchCall = {
        seq: benches.length + 1,
        sha: wtSha ?? 'none',
        scenario: flag('--scenario') ?? '',
        runs: Number(flag('--runs')),
        out: flag('--out') ?? '',
        notAfter: flag('--not-after'),
      }
      benches.push(call)
      const behavior = options.bench?.(call) ?? {}
      if (behavior.reject)
        throw new Error('spawn pnpm ENOENT')
      const valid = behavior.valid ?? Array.from<boolean>({ length: call.runs }).fill(true)
      if (behavior.exit === undefined || behavior.exit === 0 || behavior.exit === 4) {
        valid.forEach((isValid, index) => {
          clock += 1000
          appendBenchLine(join(stateDir, 'bench.jsonl'), JSON.stringify(record(behavior.sha ?? call.sha, call.scenario, index + 1, clock, behavior.p95 ?? 16, isValid, behavior.dirty ?? false)))
        })
      }
      clock = behavior.endAt ?? addMinutes(clock, 10).getTime()
      return behavior.exit ?? 0
    },
    sampleHost: async () => options.host ?? calm,
    notify: async (title, body) => {
      notifications.push(`${title}: ${body}`)
    },
    now: () => clock,
    pidAlive: () => options.pidAlive ?? false,
    print: line => printed.push(line),
    log: () => {},
  }

  const trackPath = join(stateDir, 'track.jsonl')
  const events = (): TrackEvent[] => existsSync(trackPath)
    ? readFileSync(trackPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as TrackEvent)
    : []
  /** `event`, plus a subject's `outcome:reason`, so a sequence reads as one array. */
  const sequence = () => events().map(event => event.event === 'subject' ? `subject:${event.outcome}${event.reason ? `:${event.reason}` : ''}` : event.event)
  const displayCalls = () => spawns.filter(call => call.args[0] === 'qa:display').map(call => call.args.includes('qa:bench') ? 'bench' : call.args[1])
  return { host, main, wt, stateDir, trackPath, spawns, benches, notifications, printed, gitCalls, events, sequence, displayCalls }
}

function manual(overrides: Partial<TickOptions> = {}): TickOptions {
  return {
    manual: { subject: 'head-ref', baseline: 'base-ref' },
    scenario: 'mmd-idle',
    runs: 3,
    deadline: null,
    planOnly: false,
    trigger: 'manual',
    ...overrides,
  }
}

function nightly(overrides: Partial<TickOptions> = {}): TickOptions {
  return {
    manual: null,
    scenario: null,
    runs: 5,
    deadline: null,
    planOnly: false,
    trigger: 'timer',
    ...overrides,
  }
}

/** Appends an open p95 finding for mmd-idle over `baseline..subject`, as an earlier tick would have. */
function seedFinding(trackPath: string, baseline: FindingOpenEvent['baseline'], subject: FindingOpenEvent['subject']) {
  const open = { scenario: 'mmd-idle', metric: 'p95FrameMsApprox', baseline, subject } as const
  appendTrackEvent(trackPath, {
    v: 1,
    t: at(0),
    event: 'finding-open',
    id: findingId(open),
    tickId: 'earlier',
    ...open,
    medianA: 16,
    medianB: 20,
    difference: 4,
    practicalFloor: 1,
    sigma: null,
    lowConfidence: true,
    topStages: [],
    noStageMoved: true,
    rangeCommits: 1,
    renderLoopCommits: [],
    reproduce: 'fixture',
    closeCheck: 'fixture',
  })
  return open
}

/** `git merge-base --is-ancestor` exits 1 for "not an ancestor". */
function notAncestor(): never {
  throw Object.assign(new Error('not an ancestor'), { code: 1 })
}

const regressing = (call: BenchCall): BenchBehavior => ({ p95: call.sha === HEAD ? 20 : 16 })

describe('runTick', () => {
  it('records outside-window and benches nothing for a timer tick at midday', async () => {
    const fake = fakeHost({ start: at(12) })

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:skipped:outside-window', 'tick-end'])
    expect(fake.spawns).toEqual([])
    expect(fake.gitCalls.some(call => call.includes('fetch'))).toBe(false)
  })

  it('exits 0 without writing when another live tick holds the lock', async () => {
    const fake = fakeHost({ start: at(2), pidAlive: true })
    mkdirSync(fake.stateDir, { recursive: true })
    writeFileSync(join(fake.stateDir, 'track.lock'), '4242\n')

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.printed).toEqual(['already running'])
    expect(fake.events()).toEqual([])
    expect(readFileSync(join(fake.stateDir, 'track.lock'), 'utf8')).toBe('4242\n')
  })

  it('removes a stale lock whose pid is dead, runs, and releases its own lock', async () => {
    const fake = fakeHost({ start: at(12), pidAlive: false })
    mkdirSync(fake.stateDir, { recursive: true })
    writeFileSync(join(fake.stateDir, 'track.lock'), '4242\n')

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:skipped:outside-window', 'tick-end'])
    expect(existsSync(join(fake.stateDir, 'track.lock'))).toBe(false)
  })

  it('records host-busy with the load and benches nothing', async () => {
    const fake = fakeHost({ start: at(2), host: busy })

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', `subject:skipped:host-busy: ${formatHostLoad(busy)}`, 'tick-end'])
    expect(fake.spawns).toEqual([])
  })

  it('falls back to the main tip when gh fails', async () => {
    const fake = fakeHost({ start: at(1), prs: new Error('gh: not logged in') })

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'discovery', 'subject:benched', 'tick-end'])
    expect(fake.events()[1]).toMatchObject({ event: 'discovery', mainTip: MAIN, prs: null, ghError: 'gh: not logged in' })
    expect(fake.benches.map(call => `${call.sha.slice(0, 1)}:${call.scenario}`)).toEqual(['1:mmd-idle', '1:mmd-talk', '1:live2d-idle'])
    const fetched = fake.gitCalls.findIndex(call => call.slice(1).join(' ') === 'fetch --quiet origin')
    const resolved = fake.gitCalls.findIndex(call => call.includes('origin/main^{commit}'))
    expect(fetched).toBeGreaterThan(-1)
    expect(fetched).toBeLessThan(resolved)
  })

  it('records subject-dirty and benches nothing when the app worktree has tracked changes', async () => {
    const fake = fakeHost({ start: at(14), dirtyStatus: ' M package.json\n' })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:broken:subject-dirty', 'tick-end'])
    expect(fake.benches).toEqual([])
  })

  it('records sha-mismatch when the bench wrote a record for another commit', async () => {
    const fake = fakeHost({ start: at(14), bench: () => ({ sha: OLD_HEAD }) })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:broken:sha-mismatch', 'tick-end'])
  })

  it('records subject-dirty when the bench wrote a dirty record', async () => {
    const fake = fakeHost({ start: at(14), bench: () => ({ dirty: true }) })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:broken:subject-dirty', 'tick-end'])
  })

  it('continues after bench exit 1, stops launching after exit 3, and downs the display after every bench', async () => {
    const prs = [
      { number: 7, headRefOid: PR_HEAD, baseRefName: 'main', updatedAt: '2026-11-20T10:00:00Z' },
      { number: 8, headRefOid: HEAD, baseRefName: 'main', updatedAt: '2026-11-20T11:00:00Z' },
    ]
    const fake = fakeHost({ start: at(1), prs, bench: call => ({ exit: call.seq === 1 ? 1 : 3 }) })

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'discovery', 'subject:broken:bench-exit-1', 'subject:deferred:host-busy', 'subject:deferred:host-busy', 'tick-end'])
    expect(fake.benches).toHaveLength(2)
    expect(fake.displayCalls()).toEqual(['bench', 'down', 'bench', 'down'])
  })

  it('opens exactly one finding for a confirmed regression and notifies once', async () => {
    const fake = fakeHost({ start: at(14), bench: regressing })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:benched', 'finding-open', 'tick-end'])
    const finding = fake.events().find(event => event.event === 'finding-open')
    expect(finding).toMatchObject({
      id: `mmd-idle:p95FrameMsApprox:${BASE.slice(0, 7)}..${HEAD.slice(0, 7)}`,
      subject: { kind: 'manual', sha: HEAD },
      baseline: { kind: 'manual', sha: BASE },
      rangeCommits: 2,
      renderLoopCommits: [{ sha: HEAD, subject: 'feat: heavier body' }],
    })
    // Two initial sides, then the A, B, B, A confirmation.
    expect(fake.benches.map(call => call.sha)).toEqual([BASE, HEAD, BASE, HEAD, HEAD, BASE])
    expect(new Set(fake.benches.map(call => call.out)).size).toBe(6)
    expect(fake.displayCalls()).toEqual(Array.from({ length: 6 }, () => ['bench', 'down']).flat())
    expect(fake.notifications).toEqual([`AIRI perf: 1 new finding(s): ${finding?.event === 'finding-open' ? finding.id : ''}. Run pnpm perf status`])
  })

  it('opens the finding but does not notify when AIRI_PERF_TRACK_NOTIFY is 0', async () => {
    const fake = fakeHost({ start: at(14), bench: regressing })

    expect(await runTick({ ...fake.host, env: { ...fake.host.env, AIRI_PERF_TRACK_NOTIFY: '0' } }, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:benched', 'finding-open', 'tick-end'])
    expect(fake.notifications).toEqual([])
  })

  it('opens no finding and does not notify when the confirmation clears the candidate', async () => {
    const fake = fakeHost({ start: at(14), bench: call => ({ p95: call.sha === HEAD && call.seq === 2 ? 20 : 16 }) })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:benched', 'tick-end'])
    expect(fake.benches).toHaveLength(6)
    expect(fake.notifications).toEqual([])
  })

  it('appends observed-again instead of a duplicate finding when an open finding overlaps the range', async () => {
    const fake = fakeHost({
      start: at(14),
      bench: regressing,
      revList: { [`${BASE}..${OLD_HEAD}`]: [SHARED], [`${BASE}..${HEAD}`]: [HEAD, SHARED] },
    })
    const open = seedFinding(fake.trackPath, { kind: 'manual', sha: BASE }, { kind: 'manual', sha: OLD_HEAD })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['finding-open', 'tick-start', 'subject:benched', 'observed-again', 'tick-end'])
    expect(fake.events().at(-2)).toMatchObject({ event: 'observed-again', id: findingId(open), baselineSha: BASE })
    expect(fake.notifications).toEqual([])
  })

  it('records a subject that does not fit before the deadline as deferred', async () => {
    const fake = fakeHost({ start: at(6, 20) })

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'discovery', 'subject:deferred:capacity', 'tick-end'])
    expect(fake.benches).toEqual([])
  })

  it('benches both sides of a manual pair at 14:00 with no deadline', async () => {
    const fake = fakeHost({ start: at(14) })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:benched', 'tick-end'])
    expect(fake.benches.map(call => call.sha)).toEqual([BASE, HEAD])
    expect(fake.benches.map(call => call.notAfter)).toEqual([null, null])
  })

  it('defers the remaining steps once the clock passes the default 06:30 deadline, and passes it to the bench', async () => {
    const fake = fakeHost({ start: at(1), bench: () => ({ endAt: at(6, 31) }) })

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'discovery', 'subject:deferred:deadline', 'tick-end'])
    expect(fake.benches.map(call => call.notAfter)).toEqual(['2026-11-21T06:30:00+01:00'])
  })

  it('defers the confirmation steps when the deadline passes before them', async () => {
    const fake = fakeHost({ start: at(1), bench: call => ({ ...regressing(call), endAt: call.seq === 2 ? at(6, 31) : undefined }) })

    expect(await runTick(fake.host, manual({ deadline: '06:30', trigger: 'timer' }))).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:deferred:deadline', 'tick-end'])
    expect(fake.benches).toHaveLength(2)
    // The confirmation's first side is never even checked out.
    expect(fake.gitCalls.filter(call => call[1] === 'checkout').map(call => call.at(-1))).toEqual([BASE, HEAD])
    expect(fake.notifications).toEqual([])
  })

  it('stops launching after a bench exits 4 at the deadline', async () => {
    const prs = [{ number: 8, headRefOid: HEAD, baseRefName: 'main', updatedAt: '2026-11-20T11:00:00Z' }]
    const fake = fakeHost({ start: at(1), prs, bench: () => ({ exit: 4 }) })

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'discovery', 'subject:deferred:deadline', 'subject:deferred:deadline', 'tick-end'])
    expect(fake.benches).toHaveLength(1)
    expect(fake.displayCalls()).toEqual(['bench', 'down'])
  })

  it('gives a rebench of the same sha and scenario its own --out directory', async () => {
    const fake = fakeHost({ start: at(14), bench: call => ({ valid: call.seq === 2 ? [true, false, false] : [true, true, true] }) })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:benched', 'tick-end'])
    expect(fake.benches.map(call => call.sha)).toEqual([BASE, HEAD, BASE, HEAD])
    expect(new Set(fake.benches.map(call => call.out)).size).toBe(4)
    expect(fake.benches.map(call => call.out.split('/').at(-1))).toEqual([
      `001-${BASE.slice(0, 7)}-mmd-idle`,
      `002-${HEAD.slice(0, 7)}-mmd-idle`,
      `003-${BASE.slice(0, 7)}-mmd-idle`,
      `004-${HEAD.slice(0, 7)}-mmd-idle`,
    ])
  })

  it('stops the tick with 130 on an interrupted bench, still downing the display and releasing the lock', async () => {
    const fake = fakeHost({ start: at(14), bench: () => ({ exit: 130 }) })

    expect(await runTick(fake.host, manual())).toBe(130)
    expect(fake.sequence()).toEqual(['tick-start', 'tick-end'])
    expect(fake.events().at(-1)).toMatchObject({ event: 'tick-end', exitCode: 130 })
    expect(fake.displayCalls()).toEqual(['bench', 'down'])
    expect(existsSync(join(fake.stateDir, 'track.lock'))).toBe(false)
  })

  it('fails the tick with 1 when the bench cannot be spawned, still downing the display', async () => {
    const fake = fakeHost({ start: at(14), bench: () => ({ reject: true }) })

    expect(await runTick(fake.host, manual())).toBe(1)
    expect(fake.sequence()).toEqual(['tick-start', 'tick-end'])
    expect(fake.displayCalls()).toEqual(['bench', 'down'])
    expect(existsSync(join(fake.stateDir, 'track.lock'))).toBe(false)
  })

  it('prepares the app worktree beside the main checkout, locked, with the main checkout\'s model paths', async () => {
    const fake = fakeHost({ start: at(14) })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.gitCalls).toContainEqual([fake.main, 'worktree', 'add', '--detach', fake.wt, 'origin/main'])
    expect(fake.gitCalls).toContainEqual([fake.main, 'worktree', 'lock', '--reason', 'perf tracker', fake.wt])
    expect(readFileSync(join(fake.wt, '.env.qa'), 'utf8')).toBe('AIRI_QA_MMD_MODEL="/home/user/models/fixture.pmx"\nAIRI_QA_RIG_FORBOOTH="/home/user/rigs/forbooth"\n')
    const bench = fake.spawns.find(call => call.args.includes('qa:bench'))
    expect(bench).toMatchObject({ command: 'pnpm', cwd: fake.host.toolRoot, env: { TMPDIR: join(fake.stateDir, 'tmp'), AIRI_PERF_BENCH_DIR: fake.stateDir } })
    expect(bench?.args.slice(0, 6)).toEqual(['qa:display', 'run', '--name', 'perf-track', '--', 'pnpm'])
    // git clean removes every ignored dist, and an install that finds node_modules current skips postinstall.
    expect(fake.spawns.slice(0, 2).map(call => call.args)).toEqual([['-C', fake.wt, 'install', '--frozen-lockfile'], ['-C', fake.wt, 'run', 'build:packages']])
    expect(fake.gitCalls).toContainEqual([fake.wt, 'clean', '-fdxq', '-e', '.env.qa', '-e', 'node_modules', '-e', '/apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3/'])
    expect(fake.spawns.filter(call => call.args.includes('qa:setup'))).toMatchObject([{ args: ['qa:setup', 'cubism'], cwd: fake.wt }])
  })

  it('reuses the app worktree and its Cubism download on the next tick', async () => {
    const fake = fakeHost({ start: at(14) })

    expect(await runTick(fake.host, manual())).toBe(0)
    // A new baseline, so the second tick prepares the worktree again.
    expect(await runTick(fake.host, manual({ manual: { subject: 'head-ref', baseline: OLD_HEAD } }))).toBe(0)
    expect(fake.benches.map(call => call.sha)).toEqual([BASE, HEAD, OLD_HEAD])
    expect(fake.gitCalls.filter(call => call[1] === 'worktree' && call[2] === 'add')).toHaveLength(1)
    expect(fake.spawns.filter(call => call.args.includes('qa:setup'))).toHaveLength(1)
  })

  it('keeps only the last seven run directories and empties its temp directory', async () => {
    const fake = fakeHost({ start: at(14) })
    for (let day = 1; day <= 8; day++)
      mkdirSync(join(fake.stateDir, 'runs', `202611${String(day).padStart(2, '0')}-010000`), { recursive: true })
    mkdirSync(join(fake.stateDir, 'tmp'), { recursive: true })
    writeFileSync(join(fake.stateDir, 'tmp', 'scratch'), '')

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(readdirSync(join(fake.stateDir, 'runs'))).toHaveLength(7)
    expect(readdirSync(join(fake.stateDir, 'runs'))).not.toContain('20261101-010000')
    expect(readdirSync(join(fake.stateDir, 'tmp'))).toEqual([])
  })
  it('starts no bench once the Cubism setup crosses the deadline', async () => {
    const fake = fakeHost({ start: at(1), afterSpawn: args => args.includes('qa:setup') ? at(6, 31) : undefined })

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'discovery', 'subject:deferred:deadline', 'tick-end'])
    expect(fake.spawns.map(call => call.args.at(-1))).toEqual(['--frozen-lockfile', 'build:packages', 'cubism'])
  })

  it('starts nothing once install crosses the deadline, preparation steps included', async () => {
    const fake = fakeHost({ start: at(1), afterSpawn: args => args.includes('install') ? at(6, 31) : undefined })

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'discovery', 'subject:deferred:deadline', 'tick-end'])
    expect(fake.spawns.map(call => call.args)).toEqual([['-C', fake.wt, 'install', '--frozen-lockfile']])
  })

  it('closes a finding as accepted by an entry only the subject\'s history has, and rebenches the introducing commit', async () => {
    const path = 'packages/qa-tools/perf/accepted-costs.json'
    const accepted = JSON.stringify({ entries: [{ id: 'heavier-body', scenario: 'mmd-idle', metric: 'p95FrameMsApprox', reason: 'Intentional frame work.', accepted: '2026-11-21' }] })
    const fake = fakeHost({
      start: at(14),
      git: (args) => {
        if (args[0] === 'ls-tree')
          return args.includes(HEAD) ? `${path}\n` : ''
        if (args[0] === 'show' && args[1] === `${HEAD}:${path}`)
          return accepted
        if (args[0] === 'log' && args[1] === '--reverse')
          return args[4] === HEAD ? `${HEAD}\n` : ''
        if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
          const [a, b] = args.slice(2)
          return a === b || a === BASE || (a === OLD_HEAD && b === HEAD) ? '' : notAncestor()
        }
        return undefined
      },
    })
    const open = seedFinding(fake.trackPath, { kind: 'manual', sha: BASE }, { kind: 'manual', sha: OLD_HEAD })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['finding-open', 'tick-start', 'subject:benched', 'finding-close', 'tick-end'])
    expect(fake.events().at(-2)).toMatchObject({ event: 'finding-close', id: findingId(open), resolution: 'accepted', at: HEAD, by: 'tracker' })
    expect(fake.benches.map(call => call.sha)).toEqual([BASE, HEAD, HEAD])
  })

  it('closes a main finding as fixed when the next main tip is within noise of its baseline', async () => {
    const PREVIOUS = 'f'.repeat(40)
    const fake = fakeHost({ start: at(1) })
    appendTrackEvent(fake.trackPath, { v: 1, t: at(0), event: 'subject', tickId: 'earlier', subject: { kind: 'main', sha: PREVIOUS }, baseline: null, scenarios: [], outcome: 'benched' })
    const open = seedFinding(fake.trackPath, { kind: 'previous', sha: PREVIOUS }, { kind: 'main', sha: OLD_HEAD })
    for (const scenario of ['mmd-idle', 'mmd-talk', 'live2d-idle']) {
      for (let run = 1; run <= 5; run++)
        appendBenchLine(join(fake.stateDir, 'bench.jsonl'), JSON.stringify(record(PREVIOUS, scenario, run, at(0) + run, 16, true, false)))
    }

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['subject:benched', 'finding-open', 'tick-start', 'discovery', 'subject:benched', 'finding-close', 'tick-end'])
    expect(fake.events().at(-2)).toMatchObject({ event: 'finding-close', id: findingId(open), resolution: 'fixed', at: MAIN })
  })

  it('records a baseline reset and compares only current-environment runs after the host changed', async () => {
    const fake = fakeHost({ start: at(14) })
    for (let run = 1; run <= 3; run++) {
      const old = record(BASE, 'mmd-idle', run, at(0) + run, 30, true, false)
      appendBenchLine(join(fake.stateDir, 'bench.jsonl'), JSON.stringify({ ...old, host: { ...old.host, cpuModel: 'older-cpu' } }))
    }
    appendBenchLine(join(fake.stateDir, 'bench.jsonl'), JSON.stringify(record(OLD_HEAD, 'mmd-idle', 1, at(1), 16, true, false)))

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:benched', 'baseline-reset', 'tick-end'])
    expect(fake.events().at(-2)).toMatchObject({ event: 'baseline-reset', kind: 'environment', baselineSha: BASE, scenario: 'mmd-idle' })
  })

  it('records subject-unsupported for bench exit 2 and benches the next subject with its merge-base baseline', async () => {
    const prs = [{ number: 8, headRefOid: HEAD, baseRefName: 'main', updatedAt: '2026-11-20T11:00:00Z' }]
    const fake = fakeHost({ start: at(1), prs, bench: call => ({ exit: call.seq === 1 ? 2 : 0 }) })

    expect(await runTick(fake.host, nightly())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'discovery', 'subject:skipped:subject-unsupported', 'subject:benched', 'tick-end'])
    expect(fake.events()[1]).toMatchObject({ event: 'discovery', prs: [{ number: 8, head: HEAD, baselineSha: BASE, baseRef: 'main' }] })
    expect(fake.benches.map(call => `${call.sha.slice(0, 1)}:${call.scenario}`)).toEqual(['1:mmd-idle', 'a:live2d-idle', 'b:live2d-idle'])
  })

  it('appends observed-again when an open finding\'s commits landed in the range under new shas', async () => {
    const fake = fakeHost({
      start: at(14),
      bench: regressing,
      git: (args) => {
        if (args[0] !== 'cherry')
          return undefined
        return args[1] === HEAD ? `- ${SHARED}\n` : `+ ${SHARED}\n`
      },
    })
    const open = seedFinding(fake.trackPath, { kind: 'manual', sha: BASE }, { kind: 'manual', sha: OLD_HEAD })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['finding-open', 'tick-start', 'subject:benched', 'observed-again', 'tick-end'])
    expect(fake.events().at(-2)).toMatchObject({ event: 'observed-again', id: findingId(open) })
  })

  it('confirms only on fresh runs: a regression the initial pass alone carries opens nothing', async () => {
    // The initial HEAD pass and the first confirmation pass regress; the second does not. Together the fresh B runs
    // fall short of the agreement rule, while adding the initial runs would confirm.
    const fake = fakeHost({ start: at(14), bench: call => ({ p95: call.sha !== HEAD ? 16 : call.seq === 5 ? 16.4 : 20 }) })

    expect(await runTick(fake.host, manual())).toBe(0)
    expect(fake.sequence()).toEqual(['tick-start', 'subject:benched', 'tick-end'])
    expect(fake.benches).toHaveLength(6)
  })
})
