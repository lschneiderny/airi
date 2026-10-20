import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { argv, exit, stderr, stdout } from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { buildEmotionTrial } from '@proj-airi/stage-shared/motion-scenario'

import { T2SetupError } from '../src/t2/errors'
import { loadT2Runtime, runT2 } from '../src/t2/runner'

const usage = `Usage: tsx bin/t2-probe.ts [--emotion angry] [--band strong] [--seed 1] [--identity]

Runs one 10 s emotion trial on the local ForBOOTH rig (AIRI_QA_RIG_FORBOOTH, AIRI_QA_CUBISM_CORE) and prints
a JSON summary: the trace sha256, the speed multiple, and with --identity the parameter difference between a run
with and a run without mesh deformation. Exits 2 when the rig or the core is missing or empty.
`

const catalog = JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/forbooth-catalog.json'), 'utf8')) as CatalogEntry[]

async function main() {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      emotion: { type: 'string', default: 'angry' },
      band: { type: 'string', default: 'strong' },
      seed: { type: 'string', default: '1' },
      identity: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    stdout.write(usage)
    return
  }
  const runtime = await loadT2Runtime()
  const scenario = buildEmotionTrial({ emotion: values.emotion as 'angry', band: values.band as 'strong', variant: 'full', seed: Number(values.seed), warmup: 4, hold: 2, post: 4 })
  const sha = (trace: unknown) => createHash('sha256').update(JSON.stringify(trace)).digest('hex')

  const started = performance.now()
  const first = runT2(scenario, runtime, { catalog })
  const wallSeconds = (performance.now() - started) / 1000
  const second = runT2(scenario, runtime, { catalog })
  const summary: Record<string, unknown> = {
    scenario: scenario.id,
    durationSeconds: scenario.durationSeconds,
    core: runtime.core,
    sha256: [sha(first), sha(second)],
    identical: sha(first) === sha(second),
    samples: first.t.length,
    movingChannels: Object.values(first.channels).filter(channel => Math.max(...channel) - Math.min(...channel) > 0).length,
    channels: Object.keys(first.channels).length,
    wallSeconds,
    speedMultiple: scenario.durationSeconds / wallSeconds,
  }
  if (values.identity) {
    const capture = (deform: boolean) => {
      const frames: Float32Array[] = []
      const trace = runT2(scenario, runtime, {
        catalog,
        deform,
        observe: (parameters) => {
          frames.push(Float32Array.from(parameters))
        },
      })
      return { frames, trace }
    }
    const tStart = performance.now()
    const without = capture(false)
    const withoutSeconds = (performance.now() - tStart) / 1000
    const t1 = performance.now()
    const withDeform = capture(true)
    const withSeconds = (performance.now() - t1) / 1000
    let maxAbs = 0
    let compared = 0
    for (let frame = 0; frame < without.frames.length; frame++) {
      for (let index = 0; index < without.frames[frame].length; index++) {
        maxAbs = Math.max(maxAbs, Math.abs(without.frames[frame][index] - withDeform.frames[frame][index]))
        compared++
      }
    }
    summary.identity = {
      frames: without.frames.length,
      parametersPerFrame: without.frames[0].length,
      valuesCompared: compared,
      framesWithDeform: withDeform.frames.length,
      maxAbsDiff: maxAbs,
      traceBytesEqual: sha(without.trace) === sha(withDeform.trace),
      withoutDeformSpeedMultiple: scenario.durationSeconds / withoutSeconds,
      withDeformSpeedMultiple: scenario.durationSeconds / withSeconds,
    }
  }
  stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error: unknown) => {
  stderr.write(`${errorMessageFrom(error) ?? 'T2 probe failed'}\n`)
  exit(error instanceof T2SetupError ? error.exitCode : 1)
})
