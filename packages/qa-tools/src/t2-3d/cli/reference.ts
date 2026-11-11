import type { Motion3dCliContext } from '../../../bin/motion3d'

import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { sha256 } from '../gate/load'
import { buildReference } from '../gate/reference'
import { readManifest } from '../reference/manifest'

export async function referenceMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  if (args.length !== 4 || args[0] !== '--from' || args[2] !== '--out' || !args[1] || !args[3]) {
    console.error('Usage: qa:motion3d reference --from <reference directory> --out <bands.json>')
    return 2
  }
  const directory = resolve(context.cwd, args[1])
  const out = resolve(context.cwd, args[3])
  try {
    const manifest = await readManifest(join(directory, 'clips.json'))
    const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: context.repoRoot, signal: context.signal })
    const bands = await buildReference({ directory, manifest, gitSha: stdout.trim(), signal: context.signal })
    const failed = Object.entries(bands.classes).flatMap(([scenario, c]) => c.holdout.filter(h => h.verdict === 'FAIL').map(h => ({ class: scenario, ...h })))
    const bytes = `${JSON.stringify(bands, null, 2)}\n`
    const path = failed.length ? `${out}.rejected.json` : out
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes, { flag: 'wx' })
    console.info(`BANDS ${path} sha256=${sha256(bytes)}`)
    for (const [scenario, c] of Object.entries(bands.classes)) {
      for (const h of c.holdout) {
        console.info(`HOLDOUT ${scenario} ${h.clipSha256 ?? `${h.metric}/group-${h.group}`} ${h.verdict} value=${h.value ?? 'clip'} failed=${h.failed.join(',') || '-'}`)
        for (const id of h.failed) {
          const band = c.metrics[id]
          console.info(`  FAIL ${id} value=${h.values?.[id] ?? h.value ?? 'undefined'} band=[${band?.lo ?? '-inf'},${band?.hi ?? 'inf'}] transform=${band?.transform ?? 'none'}`)
        }
      }
    }
    return failed.length ? 1 : 0
  }
  catch (error) {
    if (context.signal.aborted)
      return 130
    if (error instanceof Error) {
      console.error(`qa:motion3d reference: ${error.message}`)
      return 2
    }
    throw error
  }
}
