/**
 * Stage gates for the desktop stage: walking without foot skate, standing arms without kinematic penetration, and the
 * frame budget of the desktop stage against the classic window. The thresholds are the plan's acceptance criteria
 * (`.omo/plans/fullscreen-stage-locomotion.md`, todo 16, frame budget amended by todo 1 phase D); never relax one to
 * make a run pass, a failure is a finding.
 */

export const stageGateThresholds = {
  /** Largest per-frame horizontal world movement of a planted ankle, model units, exclusive. */
  walkSkateMax: 0.05,
  /** Largest foot IK error during the walk, model units, exclusive. */
  walkFeetErrorMax: 0.05,
  /** Deepest kinematic arm overlap allowed while standing, model units, inclusive. */
  armPenetrationMax: 0,
  /** A standing arm run must span at least this long. */
  armStandingMs: 30_000,
  /** Sum of the per-stage p95 of the AIRI pose and surface stages in each desktop run, inclusive. */
  p95StageMsMax: 4,
  /** Median desktop/window FPS ratio over the pairs, inclusive. */
  fpsRatioMin: 0.9,
  minPairs: 3,
  /** Mean synchronous hit-test readback per desktop run, inclusive. */
  readbackMeanMsMax: 1,
  /** Median over pairs of (desktop readback max - window readback max), inclusive. */
  readbackMaxDeltaMsMax: 1,
} as const

export type StageMode = 'window' | 'desktop'
export type StageGateId = 'stage-walk-skate' | 'stage-arm-penetration' | 'stage-frame-budget'
export const stageGateIds: readonly StageGateId[] = ['stage-walk-skate', 'stage-arm-penetration', 'stage-frame-budget']

/** One measured run: the K6 line `measure` writes as `result`. */
export interface StageFrameRun {
  mode: StageMode
  fps: number
  p95StageMs: number
  readbackMs: { max: number, mean: number, windows: number } | null
  frames: number
}

export type StageEvidence
  = | { kind: 'frame', source: string, pair: number | null, run: StageFrameRun }
    | { kind: 'walk', source: string, frames: { mode: string, skate: number, feetMaxError: number }[] }
    | { kind: 'arms', source: string, model: string, spanMs: number | null, penetration: { left: number, right: number }, clothContact: { left: number, right: number } | null }

export interface GateCheck {
  name: string
  pass: boolean
  detail: string
}

export interface GateResult {
  id: StageGateId
  verdict: 'PASS' | 'FAIL' | 'NO INPUT'
  checks: GateCheck[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function numberArray(value: unknown): number[] | null {
  return Array.isArray(value) && value.every(isFiniteNumber) ? value : null
}

// Todo 1 measured before the host modes had their product names: its spike was the desktop stage and its classic the
// window. Those evidence files stay the reference measurements, so both vocabularies are supported input.
const modeNames: Record<string, StageMode> = { window: 'window', desktop: 'desktop', classic: 'window', spike: 'desktop' }

function readFrameRun(value: unknown): StageFrameRun | null {
  if (!isRecord(value) || typeof value.mode !== 'string' || !(value.mode in modeNames))
    return null
  if (!isFiniteNumber(value.fps) || !isFiniteNumber(value.p95StageMs) || !isFiniteNumber(value.frames))
    return null
  const readback = value.readbackMs
  let readbackMs: StageFrameRun['readbackMs'] = null
  if (isRecord(readback)) {
    if (!isFiniteNumber(readback.max) || !isFiniteNumber(readback.mean) || !isFiniteNumber(readback.windows))
      return null
    readbackMs = { max: readback.max, mean: readback.mean, windows: readback.windows }
  }
  else if (readback !== null) {
    return null
  }
  return { mode: modeNames[value.mode], fps: value.fps, p95StageMs: value.p95StageMs, readbackMs, frames: value.frames }
}

function readWalk(source: string, value: unknown): StageEvidence | null {
  if (!isRecord(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows))
    return null
  const columns: unknown[] = value.columns
  const column = (name: string) => columns.indexOf(name)
  const [modeAt, skateAt, errorAt] = [column('mode'), column('skate'), column('feetMaxError')]
  if (modeAt < 0 || skateAt < 0 || errorAt < 0)
    throw new Error(`${source}: perFrameSeries needs the columns mode, skate and feetMaxError`)
  const frames = value.rows.map((row: unknown, index: number) => {
    if (!Array.isArray(row) || typeof row[modeAt] !== 'string' || !isFiniteNumber(row[skateAt]) || !isFiniteNumber(row[errorAt]))
      throw new Error(`${source}: perFrameSeries row ${index} is malformed`)
    return { mode: row[modeAt] as string, skate: row[skateAt] as number, feetMaxError: row[errorAt] as number }
  })
  return { kind: 'walk', source, frames }
}

function maxPair(value: unknown): { left: number, right: number } | null {
  if (!isRecord(value))
    return null
  const side = (entry: unknown) => isFiniteNumber(entry) ? entry : isRecord(entry) && isFiniteNumber(entry.max) ? entry.max : null
  const left = side(value.left)
  const right = side(value.right)
  return left === null || right === null ? null : { left, right }
}

function maxOf(values: readonly number[]): number {
  return values.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY)
}

/** Per-model arm summary from a `perFrame` column record (`t_ms`, `penL`, `penR`, optional `clothL`/`clothR`). */
function readArmSeries(source: string, json: Record<string, unknown>, perFrame: Record<string, unknown>): StageEvidence {
  const times = numberArray(perFrame.t_ms)
  const left = numberArray(perFrame.penL)
  const right = numberArray(perFrame.penR)
  if (!times || !left || !right || left.length !== times.length || right.length !== times.length || times.length === 0)
    throw new Error(`${source}: perFrame needs equal-length numeric t_ms, penL and penR`)
  const clothLeft = numberArray(perFrame.clothL)
  const clothRight = numberArray(perFrame.clothR)
  const fromLoad = isRecord(json.fromLoad) ? maxPair(json.fromLoad.clothContact) : null
  return {
    kind: 'arms',
    source,
    model: typeof json.model === 'string' ? json.model : source,
    spanMs: times[times.length - 1] - times[0],
    penetration: { left: maxOf(left), right: maxOf(right) },
    clothContact: clothLeft && clothRight ? { left: maxOf(clothLeft), right: maxOf(clothRight) } : fromLoad,
  }
}

/**
 * Reads one evidence JSON into gate inputs. Recognised shapes: a `measure` run (`result` with a mode and fps), a pairs
 * file (`runs`), a walk timeline (`perFrameSeries` at the top level or under `walk`), a per-model arm run (`perFrame`
 * with penL/penR) and a multi-model arm summary (`models.<name>.penetration`). Throws for anything else.
 */
export function readStageEvidence(source: string, json: unknown): StageEvidence[] {
  if (!isRecord(json))
    throw new Error(`${source}: evidence must be a JSON object`)
  const found: StageEvidence[] = []

  if (Array.isArray(json.runs)) {
    json.runs.forEach((entry, index) => {
      const nested = readStageEvidence(`${source}#runs[${index}]`, entry)
      if (nested.length === 0)
        throw new Error(`${source}: runs[${index}] is not a measured run`)
      found.push(...nested)
    })
  }
  if ('result' in json) {
    const run = readFrameRun(json.result)
    if (!run)
      throw new Error(`${source}: result is not a measured run (mode, fps, p95StageMs, readbackMs, frames)`)
    found.push({ kind: 'frame', source, pair: isFiniteNumber(json.n) ? json.n : null, run })
  }

  const series = json.perFrameSeries ?? (isRecord(json.walk) ? json.walk.perFrameSeries : undefined)
  if (series !== undefined) {
    const walk = readWalk(source, series)
    if (!walk)
      throw new Error(`${source}: perFrameSeries needs columns and rows`)
    found.push(walk)
  }

  if (isRecord(json.perFrame) && 'penL' in json.perFrame)
    found.push(readArmSeries(source, json, json.perFrame))
  if (isRecord(json.models)) {
    for (const [model, entry] of Object.entries(json.models)) {
      const penetration = isRecord(entry) ? maxPair(entry.penetration) : null
      if (!isRecord(entry) || !penetration)
        throw new Error(`${source}: models.${model} has no penetration.left/right`)
      found.push({
        kind: 'arms',
        source: `${source}#${model}`,
        model,
        spanMs: isFiniteNumber(entry.spanMs) ? entry.spanMs : null,
        penetration,
        clothContact: maxPair(entry.clothContact),
      })
    }
  }

  if (found.length === 0)
    throw new Error(`${source}: no stage gate input (measured run, walk perFrameSeries, arm perFrame or models)`)
  return found
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const format = (value: number) => Number(value.toPrecision(4)).toString()

function verdictOf(id: StageGateId, checks: GateCheck[]): GateResult {
  if (checks.length === 0)
    return { id, verdict: 'NO INPUT', checks }
  return { id, verdict: checks.every(check => check.pass) ? 'PASS' : 'FAIL', checks }
}

/** `stage-walk-skate`: every walk timeline, judged over its non-idle frames, must include walking and stay below both limits. */
export function gateWalkSkate(evidence: readonly StageEvidence[]): GateResult {
  const checks: GateCheck[] = []
  for (const walk of evidence) {
    if (walk.kind !== 'walk')
      continue
    const moving = walk.frames.filter(frame => frame.mode !== 'idle')
    if (!moving.some(frame => frame.mode === 'walking')) {
      checks.push({ name: `${walk.source} walk`, pass: false, detail: 'no frame in mode walking' })
      continue
    }
    const skate = maxOf(moving.map(frame => frame.skate))
    const error = maxOf(moving.map(frame => frame.feetMaxError))
    checks.push({
      name: `${walk.source} skate`,
      pass: skate < stageGateThresholds.walkSkateMax,
      detail: `max locomotion.skate ${format(skate)} over ${moving.length} frames (limit < ${stageGateThresholds.walkSkateMax})`,
    })
    checks.push({
      name: `${walk.source} feet`,
      pass: error < stageGateThresholds.walkFeetErrorMax,
      detail: `max feet.maxError ${format(error)} (limit < ${stageGateThresholds.walkFeetErrorMax})`,
    })
  }
  return verdictOf('stage-walk-skate', checks)
}

/** `stage-arm-penetration`: kinematic penetration max 0 over a standing run of at least 30 s, per model. `clothContact` is reported, never gated. */
export function gateArmPenetration(evidence: readonly StageEvidence[]): GateResult {
  const checks: GateCheck[] = []
  for (const arms of evidence) {
    if (arms.kind !== 'arms')
      continue
    const deepest = arms.penetration.left >= arms.penetration.right ? 'left' : 'right'
    const depth = arms.penetration[deepest]
    const cloth = arms.clothContact ? `; clothContact max L ${format(arms.clothContact.left)} R ${format(arms.clothContact.right)} (information only)` : ''
    checks.push({
      name: `${arms.model} penetration`,
      pass: depth <= stageGateThresholds.armPenetrationMax,
      detail: `max arms.penetration ${format(depth)} (${deepest}) model units (limit ${stageGateThresholds.armPenetrationMax})${cloth}`,
    })
    const span = arms.spanMs
    checks.push({
      name: `${arms.model} standing span`,
      pass: span !== null && span >= stageGateThresholds.armStandingMs,
      detail: span === null ? 'no time span recorded' : `${format(span / 1000)} s (needs >= ${stageGateThresholds.armStandingMs / 1000} s)`,
    })
  }
  return verdictOf('stage-arm-penetration', checks)
}

/**
 * Pairs window and desktop runs by their pair index `n`. When any run lacks one, runs pair in the order given, so a
 * caller passes alternating files in run order.
 */
function pairRuns(evidence: readonly StageEvidence[]): { pairs: { label: string, window: StageFrameRun, desktop: StageFrameRun }[], problem: string | null } {
  const frames = evidence.filter((entry): entry is Extract<StageEvidence, { kind: 'frame' }> => entry.kind === 'frame')
  const windows = frames.filter(entry => entry.run.mode === 'window')
  const desktops = frames.filter(entry => entry.run.mode === 'desktop')
  if (windows.length !== desktops.length)
    return { pairs: [], problem: `${windows.length} window and ${desktops.length} desktop runs do not pair` }
  if (frames.every(entry => entry.pair !== null)) {
    const pairs = []
    for (const desktop of desktops) {
      const partners = windows.filter(window => window.pair === desktop.pair)
      if (partners.length !== 1)
        return { pairs: [], problem: `pair ${desktop.pair} has ${partners.length} window runs` }
      pairs.push({ label: `pair ${desktop.pair}`, window: partners[0].run, desktop: desktop.run })
    }
    return { pairs, problem: null }
  }
  return { pairs: desktops.map((desktop, index) => ({ label: `pair ${index + 1}`, window: windows[index].run, desktop: desktop.run })), problem: null }
}

/** `stage-frame-budget`: the amended todo 1 criteria over at least three alternating window/desktop pairs. */
export function gateFrameBudget(evidence: readonly StageEvidence[]): GateResult {
  if (!evidence.some(entry => entry.kind === 'frame'))
    return verdictOf('stage-frame-budget', [])
  const limits = stageGateThresholds
  const { pairs, problem } = pairRuns(evidence)
  const checks: GateCheck[] = [{
    name: 'pairs',
    pass: problem === null && pairs.length >= limits.minPairs,
    detail: problem ?? `${pairs.length} window/desktop pairs (needs >= ${limits.minPairs})`,
  }]
  if (pairs.length === 0)
    return verdictOf('stage-frame-budget', checks)

  const p95 = pairs.map(pair => pair.desktop.p95StageMs)
  checks.push({
    name: 'p95-stage-ms',
    pass: p95.every(value => value <= limits.p95StageMsMax),
    detail: `desktop p95 AIRI stages ${p95.map(format).join(', ')} ms (limit <= ${limits.p95StageMsMax})`,
  })

  const ratios = pairs.map(pair => pair.desktop.fps / pair.window.fps)
  checks.push({
    name: 'fps-ratio',
    pass: median(ratios) >= limits.fpsRatioMin,
    detail: `median desktop/window FPS ${format(median(ratios))} (pairs ${ratios.map(format).join(', ')}; limit >= ${limits.fpsRatioMin})`,
  })

  const missing = pairs.filter(pair => !pair.desktop.readbackMs || !pair.window.readbackMs).map(pair => pair.label)
  if (missing.length > 0) {
    checks.push({ name: 'readback', pass: false, detail: `no hit-test readback windows in ${missing.join(', ')}; move the cursor over her while measuring` })
    return verdictOf('stage-frame-budget', checks)
  }
  const means = pairs.map(pair => pair.desktop.readbackMs!.mean)
  checks.push({
    name: 'readback-mean',
    pass: means.every(value => value <= limits.readbackMeanMsMax),
    detail: `desktop readback mean ${means.map(format).join(', ')} ms (limit <= ${limits.readbackMeanMsMax})`,
  })
  const deltas = pairs.map(pair => pair.desktop.readbackMs!.max - pair.window.readbackMs!.max)
  checks.push({
    name: 'readback-max-delta',
    pass: median(deltas) <= limits.readbackMaxDeltaMsMax,
    detail: `median (desktop max - window max) ${format(median(deltas))} ms (pairs ${deltas.map(format).join(', ')}; limit <= ${limits.readbackMaxDeltaMsMax})`,
  })
  return verdictOf('stage-frame-budget', checks)
}

export function runStageGates(evidence: readonly StageEvidence[]): GateResult[] {
  return [gateWalkSkate(evidence), gateArmPenetration(evidence), gateFrameBudget(evidence)]
}

export function formatGateResults(results: readonly GateResult[]): string {
  return results.flatMap(result => [
    `${result.id}: ${result.verdict}`,
    ...result.checks.map(check => `  [${check.pass ? 'PASS' : 'FAIL'}] ${check.name}: ${check.detail}`),
  ]).join('\n')
}
