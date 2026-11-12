import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { MotionBandsFile, MotionVerdict } from '../gate/types'
import type { MetricResult } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'

import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { judgeTrace, refusedVerdict, verdictExitCode } from '../gate/judge'
import { loadBands, sha256 } from '../gate/load'
import { checkTrace, GateRefusal } from '../gate/refusals'
import { emotionMetrics, emotionTrials, prepareTrace } from '../metrics'
import { MotionTraceRefusal, parseTrace } from '../read-trace'

/**
 * Frame-content identity: the frame's raw float32 rotations for every bone. Each
 * quaternion is sign-normalised and -0 becomes 0, because q and -q are one measured pose.
 */
function frameKey(rot: Float32Array, frame: number, bones: number): string {
  const values = rot.slice(frame * bones * 4, (frame + 1) * bones * 4)
  for (let i = 0; i < values.length; i += 4) {
    const lead = values[i + 3] || values[i] || values[i + 1] || values[i + 2]
    for (let k = i; k < i + 4; k++)
      values[k] = (lead < 0 ? -values[k] : values[k]) + 0
  }
  return sha256(new Uint8Array(values.buffer))
}

export async function gateMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  const directories: string[] = []
  const required: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--require' && args[i + 1] && !args[i + 1].startsWith('-')) {
      required.push(...args[++i].split(',').map(id => id.trim()))
    }
    else if (arg.startsWith('-')) {
      console.error('Usage: qa:motion3d gate <run directory>... [--require <metric id>[,<metric id>...]]')
      return 2
    }
    else {
      directories.push(arg)
    }
  }
  if (!directories.length || required.some(id => !id)) {
    console.error('Usage: qa:motion3d gate <run directory>... [--require <metric id>[,<metric id>...]]')
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
  const requirements = [...new Set(required)]
  if (bands) {
    const known = new Set(Object.values(bands.classes).flatMap(c => Object.keys(c.metrics)))
    const unknown = requirements.filter(id => !known.has(id))
    if (unknown.length) {
      console.error(`qa:motion3d gate: unknown required metric ids: ${unknown.join(', ')}`)
      return 2
    }
  }
  const entries: { dir: string, path: string, input?: DecodedMotionTrace, sha256?: string, fingerprint?: string, refusal?: GateRefusal | MotionTraceRefusal }[] = []
  for (const dir of directories.map(arg => resolve(context.cwd, arg))) {
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
  let pooled: { measurements: readonly MetricResult[], from: NonNullable<MotionVerdict['pooledFrom']> } | undefined
  try {
    const digests = new Set<string>()
    const fingerprints = new Set<string>()
    const cohort = emotions[0]?.input?.trace
    const rigs = emotions.flatMap(entry => entry.input ? [entry.input.trace.rig] : [])
    if (new Set(rigs.flatMap(rig => rig.assetSha256 === null ? [] : [rig.assetSha256])).size > 1)
      throw new GateRefusal('pool-mismatch', 'Emotion traces have different non-null rig.assetSha256 values')
    if (new Set(rigs.map(rig => JSON.stringify([rig.bones, rig.parents, rig.restOffsets, rig.legLength]))).size > 1)
      throw new GateRefusal('pool-mismatch', 'Emotion traces must share bones, parents, restOffsets and legLength')
    for (const entry of emotions) {
      if (entry.sha256 && digests.has(entry.sha256))
        throw new GateRefusal('pool-duplicate', `Repeated trace digest ${entry.sha256}`)
      if (entry.sha256)
        digests.add(entry.sha256)
      const trace = entry.input?.trace
      if (trace) {
        // Annotation ids, seed keys and provenance labels cannot create a new observation.
        entry.fingerprint = sha256(JSON.stringify({
          rot: trace.rot,
          root: trace.root,
          channels: trace.channels,
          frames: trace.frames,
          bones: trace.rig.bones,
          parents: trace.rig.parents,
        }))
        if (fingerprints.has(entry.fingerprint))
          throw new GateRefusal('pool-duplicate', `Repeated measurement fingerprint ${entry.fingerprint}`)
        fingerprints.add(entry.fingerprint)
      }
      if (trace && cohort && (trace.source.level !== cohort.source.level || trace.source.gitSha !== cohort.source.gitSha)) {
        throw new GateRefusal('pool-mismatch', 'Emotion traces must share source.level and source.gitSha')
      }
    }
    const seen = new Set<string>()
    // Replication is counted per observation, so reuse is identified per measured frame:
    // no frame content may belong to two observations, across traces or within one.
    const owners = new Map<string, { readonly trial: string, readonly dir: string, readonly observation: number }>()
    let observation = 0
    const trials = emotions.flatMap((entry) => {
      const input = entry.input
      if (!input)
        return []
      const extracted = emotionTrials(prepareTrace(input))
      for (const trial of extracted) {
        if (trial.trialId !== undefined) {
          if (seen.has(trial.trialId))
            throw new GateRefusal('pool-duplicate', `Repeated emotion trial id ${trial.trialId}`)
          seen.add(trial.trialId)
        }
        const name = trial.trialId ?? `t=${trial.t}`
        observation++
        for (const frame of trial.frames) {
          const key = frameKey(input.rot, frame, input.trace.rig.bones.length)
          const owner = owners.get(key)
          if (!owner)
            owners.set(key, { trial: name, dir: entry.dir, observation })
          else if (owner.observation !== observation)
            throw new GateRefusal('pool-duplicate', `Trials ${owner.trial} (${owner.dir}) and ${name} (${entry.dir}) share a measured frame`)
        }
      }
      return extracted
    })
    if (emotions.length) {
      const trialCounts = Object.fromEntries([...new Set(trials.map(trial => trial.condition))]
        .map(condition => [condition, trials.filter(trial => trial.condition === condition).length]))
      pooled = {
        measurements: emotionMetrics(trials),
        from: { traces: emotions.map(entry => ({ directory: entry.dir, sha256: entry.sha256 ?? '', fingerprint: entry.fingerprint ?? '' })), trialCounts },
      }
    }
  }
  catch (error) {
    if (!(error instanceof MotionTraceRefusal) && !(error instanceof GateRefusal))
      throw error
    for (const entry of emotions)
      entry.refusal = error
  }
  const verdicts: MotionVerdict[] = []
  for (const entry of entries) {
    if (context.signal.aborted)
      return 130
    let verdict: MotionVerdict
    try {
      verdict = entry.input && !entry.refusal && bands
        ? judgeTrace(entry.input, bands, { path: entry.path, sha256: entry.sha256 ?? '' }, entry.input.trace.source.scenario.class === 'emotion' ? pooled : undefined)
        : refusedVerdict(entry.path, entry.refusal ?? { name: 'trace-unreadable', detail: 'No trace' })
    }
    catch (error) {
      if (!(error instanceof MotionTraceRefusal) && !(error instanceof GateRefusal))
        throw error
      verdict = refusedVerdict(entry.path, error)
    }
    if (requirements.length) {
      const passed = requirements.every(id => verdict.metrics.some(metric => metric.id === id && metric.status === 'PASS'))
      verdict = { ...verdict, requirements: { metrics: requirements, passed } }
    }
    verdicts.push(verdict)
    context.verdicts?.gate(entry.dir, verdict, entry.input?.trace ?? null)
    console.info(`mmd-motion-quality v${verdict.gate.version} ${entry.dir}: ${verdict.verdict}`)
    if (verdict.refusal)
      console.info(`  ${verdict.refusal.name}: ${verdict.refusal.detail}`)
    if (verdict.requirements)
      console.info(`  required ${verdict.requirements.passed ? 'PASS' : 'FAIL'}: ${requirements.join(', ')}`)
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
  return verdicts.some(verdict => verdict.requirements?.passed === false) ? 1 : verdictExitCode(verdicts)
}
