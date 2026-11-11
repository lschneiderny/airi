import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { MotionBandsFile, MotionVerdict } from '../gate/types'
import type { DecodedMotionTrace } from '../read-trace'

import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { judgeTrace, refusedVerdict, verdictExitCode } from '../gate/judge'
import { loadBands, sha256 } from '../gate/load'
import { checkTrace, GateRefusal } from '../gate/refusals'
import { emotionMetrics, emotionTrials, prepareTrace } from '../metrics'
import { MotionTraceRefusal, parseTrace } from '../read-trace'

export async function gateMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  if (!args.length || args.some(arg => arg.startsWith('-'))) {
    console.error('Usage: qa:motion3d gate <run directory>...')
    return 2
  }
  if (context.signal.aborted)
    return 130
  let bands: MotionBandsFile | null = null
  let bandsRefusal: GateRefusal | null = null
  try {
    bands = await loadBands(context.repoRoot)
  }
  catch (error) {
    if (!(error instanceof GateRefusal))
      throw error
    bandsRefusal = error
  }
  const entries: { dir: string, path: string, input?: DecodedMotionTrace, sha256?: string, refusal?: GateRefusal | MotionTraceRefusal }[] = []
  for (const dir of [...new Set(args.map(arg => resolve(context.cwd, arg)))]) {
    if (context.signal.aborted)
      return 130
    const path = join(dir, 'trace.json')
    try {
      let bytes: Uint8Array
      let json: unknown
      try {
        bytes = await readFile(path)
        json = JSON.parse(new TextDecoder().decode(bytes))
      }
      catch (error) {
        if (error instanceof Error)
          throw new MotionTraceRefusal('trace-unreadable', error.message)
        throw error
      }
      const input = parseTrace(json)
      if (!bands)
        throw bandsRefusal ?? new GateRefusal('bands-hash-mismatch', 'Bands are unavailable')
      checkTrace(input, bands)
      entries.push({ dir, path, input, sha256: sha256(bytes) })
    }
    catch (error) {
      if (!(error instanceof MotionTraceRefusal) && !(error instanceof GateRefusal))
        throw error
      entries.push({ dir, path, refusal: error })
    }
  }
  const emotions = entries.filter(e => e.input?.trace.source.scenario.class === 'emotion')
  const pooled = {
    measurements: emotionMetrics(emotions.flatMap(e => e.input ? emotionTrials(prepareTrace(e.input)) : [])),
    from: emotions.map(e => e.dir),
  }
  const verdicts: MotionVerdict[] = []
  for (const entry of entries) {
    if (context.signal.aborted)
      return 130
    const verdict = entry.input && !entry.refusal && bands
      ? judgeTrace(entry.input, bands, { path: entry.path, sha256: entry.sha256 ?? '' }, entry.input.trace.source.scenario.class === 'emotion' ? pooled : undefined)
      : refusedVerdict(entry.path, entry.refusal ?? { name: 'trace-unreadable', detail: 'No trace' })
    verdicts.push(verdict)
    console.info(`mmd-motion-quality v${verdict.gate.version} ${entry.dir}: ${verdict.verdict}`)
    if (verdict.refusal)
      console.info(`  ${verdict.refusal.name}: ${verdict.refusal.detail}`)
    try {
      await writeFile(join(entry.dir, 'gate.json'), `${JSON.stringify(verdict, null, 2)}\n`)
    }
    catch (error) {
      if (!(error instanceof Error))
        throw error
      console.error(`qa:motion3d gate: cannot write ${entry.dir}/gate.json: ${error.message}`)
      return 2
    }
    for (const m of verdict.metrics)
      console.info(`  ${m.id} ${m.status} ${m.value ?? 'undefined'} ${m.unit} ${m.band ? `[${m.band.lo ?? '-inf'}, ${m.band.hi ?? 'inf'}] ${m.band.transform} ${m.basis}` : ''} ${m.detail}`)
  }
  return verdictExitCode(verdicts)
}
