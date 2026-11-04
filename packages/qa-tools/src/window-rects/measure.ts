import type { WindowRectsSummary } from './summary'

import process from 'node:process'

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { CdpClient, fetchJson } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import * as v from 'valibot'

import { summarizeWindowRectsRun, windowRectsRunSchema } from './summary'

/**
 * The todo 6 window-rect measurement (`.omo/plans/mmd-actions-library.md`). It attaches to the stage-tamagotchi
 * MAIN process inspector and drives `globalThis.__airiWindowRectsSpike`, which the env-gated spike in
 * `apps/stage-tamagotchi/src/main/services/electron/window-rects-spike.ts` installs; every timing runs in the main
 * process, so the event-loop delay it reports is the main thread's. Windows only.
 */
const usage = `Usage (relative output paths resolve against the repository root, whatever the working directory; the app must run with AIRI_WINDOW_SENSOR_SPIKE=1 and --inspect):
  pnpm -F @proj-airi/qa-tools exec tsx src/window-rects/measure.ts matrix --setup <a|b|c> [--modes main,async,worker]
      [--back-to-back 1000] [--paced 1200] [--hz 4] [--baseline-seconds 60] [--timeout-ms 250]
      [--out-dir packages/qa-tools/fixtures/window-rects] [--raw-dir .omo/evidence/mmd-actions-library] [--port 9229]
  ... measure.ts dip [--mode worker] --out <json> [--port 9229]
  ... measure.ts memory [--mode worker] [--minutes 30] [--hz 4] [--every-seconds 30] --out <json> [--port 9229]
  Add --print-paths to any command to print the resolved output paths and exit without connecting.`

/** Repository root, found from this file's location (`packages/qa-tools/src/window-rects`), never from the working directory. */
export const windowRectsRepoRoot = resolve(import.meta.dirname, '..', '..', '..', '..')

/** Resolves the output locations; relative values are taken from `root`, not from the process working directory. */
export function resolveWindowRectsPaths(root: string, values: { 'out-dir'?: string, 'raw-dir'?: string, 'out'?: string }) {
  return {
    outDir: resolve(root, values['out-dir'] ?? 'packages/qa-tools/fixtures/window-rects'),
    rawDir: resolve(root, values['raw-dir'] ?? '.omo/evidence/mmd-actions-library'),
    out: values.out === undefined ? undefined : resolve(root, values.out),
  }
}

class UsageError extends Error {}

const modes = ['main', 'async', 'worker'] as const
type Mode = typeof modes[number]

function positive(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined)
    return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new UsageError(`--${name} must be a positive number, got ${value}`)
  return parsed
}

function readMode(value: string | undefined): Mode {
  const mode = value ?? 'worker'
  if (!modes.includes(mode as Mode))
    throw new UsageError(`unknown mode ${mode}; expected ${modes.join(', ')}`)
  return mode as Mode
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`)
}

async function connectMainProcess(port: number): Promise<CdpClient> {
  // The Node inspector lists the main process as its only target.
  const targets = await fetchJson<{ webSocketDebuggerUrl?: string }[]>(`http://127.0.0.1:${port}/json/list`)
  const url = targets.find(target => target.webSocketDebuggerUrl)?.webSocketDebuggerUrl
  if (!url)
    throw new Error(`no inspector target on port ${port}; start the app with --inspect=${port}`)
  const client = await CdpClient.connect(url)
  const installed = await client.evaluate<string>('typeof globalThis.__airiWindowRectsSpike')
  if (installed !== 'object') {
    client.close()
    throw new Error('globalThis.__airiWindowRectsSpike is missing; start the app on Windows with AIRI_WINDOW_SENSOR_SPIKE=1')
  }
  return client
}

const call = (method: string, options: Record<string, unknown>) => `globalThis.__airiWindowRectsSpike.${method}(${JSON.stringify(options)})`

async function runMatrix(client: CdpClient, values: Record<string, string | undefined>, root: string, log: (line: string) => void) {
  const setup = values.setup
  if (setup !== 'a' && setup !== 'b' && setup !== 'c')
    throw new UsageError('--setup must be a (light, ~20 windows), b (heavy, 60+) or c (mixed DPI)')
  const selected = (values.modes ?? modes.join(',')).split(',').map(mode => readMode(mode.trim()))
  const options = {
    backToBack: positive('back-to-back', values['back-to-back'], 1000),
    paced: positive('paced', values.paced, 1200),
    hz: positive('hz', values.hz, 4),
    baselineMs: positive('baseline-seconds', values['baseline-seconds'], 60) * 1000,
    timeoutMs: positive('timeout-ms', values['timeout-ms'], 250),
  }
  const { outDir, rawDir } = resolveWindowRectsPaths(root, values)
  // Back-to-back samples can each take up to the timeout; the paced phase and the baseline are wall time.
  const budgetMs = options.backToBack * options.timeoutMs + options.paced * 1000 / options.hz + options.baselineMs + 60_000

  const summaries: WindowRectsSummary[] = []
  for (const mode of selected) {
    log(`window-rects: measuring ${mode} on setup ${setup} (up to ${Math.round(budgetMs / 60_000)} min)`)
    const run = v.parse(windowRectsRunSchema, await client.evaluate(call('measure', { mode, ...options }), budgetMs))
    writeJson(join(rawDir, `task-6-raw-${mode}-${setup}.json`), run)
    const summary = summarizeWindowRectsRun(run, setup)
    writeJson(join(outDir, `task-6-${mode}-${setup}.json`), summary)
    if (run.error)
      log(`window-rects: ${mode} reported an error: ${run.error}`)
    log(JSON.stringify(summary))
    summaries.push(summary)
  }
  return summaries
}

/** Entry point; exit codes 0 done, 1 a run broke, 2 usage error. */
export async function runWindowRectsCli(argv: readonly string[], root: string = windowRectsRepoRoot): Promise<number> {
  const [command, ...rest] = argv
  const log = (line: string) => console.error(line)
  let client: CdpClient | undefined
  try {
    const { values: parsed } = parseArgs({
      args: [...rest],
      options: {
        'port': { type: 'string' },
        'setup': { type: 'string' },
        'modes': { type: 'string' },
        'mode': { type: 'string' },
        'back-to-back': { type: 'string' },
        'paced': { type: 'string' },
        'hz': { type: 'string' },
        'baseline-seconds': { type: 'string' },
        'timeout-ms': { type: 'string' },
        'out-dir': { type: 'string' },
        'raw-dir': { type: 'string' },
        'out': { type: 'string' },
        'print-paths': { type: 'boolean' },
        'minutes': { type: 'string' },
        'every-seconds': { type: 'string' },
      },
      strict: true,
    })
    const { 'print-paths': printPaths, ...values } = parsed
    if (command !== 'matrix' && command !== 'dip' && command !== 'memory')
      throw new UsageError(command ? `unknown command ${command}` : 'missing command')
    if (command !== 'matrix' && !values.out)
      throw new UsageError(`${command} needs --out <json>`)

    if (printPaths) {
      process.stdout.write(`${JSON.stringify(resolveWindowRectsPaths(root, values))}\n`)
      return 0
    }

    client = await connectMainProcess(positive('port', values.port, 9229))
    if (command === 'matrix') {
      await runMatrix(client, values, root, log)
      return 0
    }

    const mode = readMode(values.mode)
    const out = resolveWindowRectsPaths(root, values).out ?? ''
    if (command === 'dip') {
      writeJson(out, { mode, rows: await client.evaluate(call('dipProbe', { mode }), 120_000) })
      log(`window-rects: wrote the DIP probe to ${out}`)
      return 0
    }

    const durationMs = positive('minutes', values.minutes, 30) * 60_000
    const points = await client.evaluate<{ tMs: number, rss: number }[]>(call('memory', {
      mode,
      durationMs,
      hz: positive('hz', values.hz, 4),
      everyMs: positive('every-seconds', values['every-seconds'], 30) * 1000,
    }), durationMs + 120_000)
    // The plan's memory gate reads RSS growth over the last 20 minutes of the run.
    const windowStart = (points.at(-1)?.tMs ?? 0) - 20 * 60_000
    const last20 = points.filter(point => point.tMs >= windowStart)
    const rssGrowthBytes = last20.length > 1 ? last20[last20.length - 1].rss - last20[0].rss : 0
    writeJson(out, { mode, durationMs, rssGrowthLast20MinBytes: rssGrowthBytes, points })
    log(`window-rects: RSS growth over the last 20 minutes ${(rssGrowthBytes / 1024 / 1024).toFixed(2)} MB; wrote ${out}`)
    return 0
  }
  catch (error) {
    const isUsage = error instanceof UsageError || (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'))
    console.error(`window-rects: ${errorMessageFrom(error) ?? 'unknown error'}${isUsage ? `\n${usage}` : ''}`)
    return isUsage ? 2 : 1
  }
  finally {
    client?.close()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  // `pnpm exec` runs in the package directory and does not set INIT_CWD, so paths never use the cwd.
  void runWindowRectsCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
