/// <reference types="node" />
import type { LivelinessTrace, MetricReference, ParameterRanges } from '../src/composables/live2d/natural-motion/liveliness'

import process from 'node:process'

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { errorMessageFrom } from '@moeru/std'

import { scoreLiveliness } from '../src/composables/live2d/natural-motion/liveliness'

function literal(value: unknown, indent = 0): string {
  if (value === null || typeof value !== 'object')
    return typeof value === 'string' ? `'${value}'` : String(value)
  if (Array.isArray(value))
    return `[${value.map(v => literal(v)).join(', ')}]`
  const spaces = ' '.repeat(indent)
  const quoted = Object.keys(value).some(key => !/^\w+$/.test(key))
  return `{\n${Object.entries(value).map(([key, v]) => `${spaces}  ${quoted ? `'${key}'` : key}: ${literal(v, indent + 2)},`).join('\n')}\n${spaces}}`
}

try {
  const paths = process.argv.slice(2)
  if (!paths.length)
    throw new Error('Usage: extract-natural-reference.ts <trace.json> ...')
  const inputs = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8')) as LivelinessTrace & { sessionId: string, ranges: ParameterRanges }))
  const sessions = Object.fromEntries(inputs.map(input => [input.sessionId, Object.fromEntries(Object.entries(scoreLiveliness(input, input.ranges, { mode: 'reference' }).metrics).map(([id, metric]) => [id, metric.value]))]))
  const first = sessions[inputs[0].sessionId]
  const bands: Record<string, MetricReference> = {}
  const notes: string[] = []
  const initial: Record<string, [number, number]> = {
    still05: [0.02, 0.10],
    still2: [0.22, 0.43],
    top10PathShare: [0.35, 0.52],
    eyeHeadCorrelation: [-0.95, -0.65],
    loopPeak: [0, 0.299999],
    meanAngleY: [-20.4, -12.4],
    minuteAngleYRange: [8, 22],
    angleXp5: [-24.1, -16.1],
    angleXp95: [4.8, 12.8],
    nearLimitOccupancy: [0, 0.01],
  }
  for (const [id, value] of Object.entries(first)) {
    const provisional = ['velocityAcfCrossing', 'blinkRate', 'blinkCv', 'jitter'].includes(id)
    let band: [number, number] | null = initial[id] ?? null
    if (value !== null && (provisional || (id.startsWith('sd:') && !/Eye[LR]Open|BodyAngle/.test(id))))
      band = [value * (provisional ? 0.6 : 0.7), value * (provisional ? 1.6 : 1.4)]
    if (band) {
      const original = [...band]
      for (const session of Object.values(sessions)) {
        const measured = session[id]
        if (measured !== null && id !== 'nearLimitOccupancy' && id !== 'loopPeak') {
          band[0] = Math.min(band[0], measured)
          band[1] = Math.max(band[1], measured)
        }
      }
      if (original[0] !== band[0] || original[1] !== band[1])
        notes.push(`// ${id}: widened ${JSON.stringify(original)} to ${JSON.stringify(band)} to include both recorded sessions.`)
    }
    bands[id] = { band, provisional }
  }
  const result = {
    ranges: inputs[0].ranges,
    sessions,
    bands,
    talking: {
      speedRatio: { band: [1.15, 1.7], provisional: true },
      onsetEnrichment: { band: [1.2, 100], provisional: true },
    },
  }
  const text = `import type { MetricReference, ParameterRanges } from './liveliness'

// Recorder: shuka-vts-recorder riggold.v2.
// Sessions: session-20260515T134050 (18m50s), session-20260515T140122 (2h23m).

// Exclude tracking failures and >=5 s all-head near-neutral bouts (<0.01), with 1 s margins.
// Source gaps >200 ms split spans. Resample each valid span to 30 Hz;
// speed = Euclidean head delta / elapsed seconds, in manifest model units.
// Extraction date: ${new Date().toISOString().slice(0, 10)}.

// Eyelid and body SD are report-only (VTS eyelids extend to 1.9; body is head-derived).
// Talking: no reference talking segment; relative criteria only.
// Hard-failure thresholds are never widened, even when a recording exceeds them.

// VTS API head values can exceed manifest ranges (approximately +/-45 versus +/-30).
// Session occupancy remains measured; reference mode reports clipping as a warning.
// Generated output retains the 1% clipping hard limit and its gate band.

${notes.join('\n\n')}
export const referenceStats: {
  ranges: ParameterRanges
  sessions: Record<string, Record<string, number | null>>
  bands: Record<string, MetricReference>
  talking: Record<string, MetricReference>
} = ${literal(result)}
`
  await writeFile(fileURLToPath(new URL('../src/composables/live2d/natural-motion/reference-stats.ts', import.meta.url)), text)
  process.stdout.write(`${JSON.stringify({ sessions: Object.keys(sessions), widenings: notes }, null, 2)}\n`)
}
catch (error) {
  console.error(`Cannot extract reference: ${errorMessageFrom(error) ?? 'Unknown error'}`)
  process.exitCode = 1
}
