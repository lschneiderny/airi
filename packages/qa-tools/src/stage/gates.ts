/**
 * Stage gates for the desktop stage: walking without foot skate, standing arms without kinematic penetration, the
 * frame budget of the desktop stage against the classic window, a gesture over a walk and a full-body pre-emption. The
 * thresholds are the plan's acceptance criteria (`.omo/plans/fullscreen-stage-locomotion.md`, todo 16, frame budget
 * amended by todo 1 phase D; `.omo/plans/mmd-actions-library.md`, todo 16, for the two action gates); never relax one
 * to make a run pass, a failure is a finding.
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
  /** Share of the gesture-walk samples in which the clip plays on the upper layer, inclusive. */
  gesturePresenceMin: 0.8,
  /** The walk span with the clip on the upper layer, whatever the record's own seconds field says, inclusive. */
  gestureWalkMinMs: 10_000,
  /** Time from `action.performing` clearing to the held goal being issued, inclusive. */
  goalResumeMaxMs: 3_000,
} as const

export type StageMode = 'window' | 'desktop'
export type StageGateId = 'stage-walk-skate' | 'stage-arm-penetration' | 'stage-frame-budget' | 'stage-gesture-walk' | 'stage-action-preempt'
export const stageGateIds: readonly StageGateId[] = ['stage-walk-skate', 'stage-arm-penetration', 'stage-frame-budget', 'stage-gesture-walk', 'stage-action-preempt']

export type StageScenario = 'gesture-walk' | 'action-preempt'

/**
 * Column order of a `measure --scenario` series, one row per diagnostics snapshot: `t` in ms since the playClip post
 * (negative during the walk lead-in), the `locomotion` fields `mode`, `enabled`, `skate`, `feet.maxError`, the
 * `action.performing` name, layer and phase (null when nothing performs), whether `director.pendingGoal` is set, and
 * `director.goalX` (the issued goal, null when none).
 */
export const stageScenarioColumns = ['t', 'mode', 'enabled', 'skate', 'feetMaxError', 'performingName', 'performingLayer', 'performingPhase', 'pendingGoal', 'goalX'] as const

export interface ScenarioSample {
  t: number
  mode: string
  enabled: boolean
  skate: number
  feetMaxError: number
  performing: { name: string, layer: string, phase: string } | null
  pendingGoal: boolean
  goalX: number | null
}

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
    | { kind: 'scenario', source: string, scenario: StageScenario, clip: string, seconds: number, stopAtMs: number | null, p95StageMs: number | null, valid: boolean, samples: ScenarioSample[] }

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

function readScenarioSample(source: string, row: unknown, index: number): ScenarioSample {
  const at = (name: typeof stageScenarioColumns[number]) => stageScenarioColumns.indexOf(name)
  const nullableString = (value: unknown) => value === null || typeof value === 'string'
  if (
    !Array.isArray(row) || row.length !== stageScenarioColumns.length
    || !isFiniteNumber(row[at('t')]) || typeof row[at('mode')] !== 'string' || typeof row[at('enabled')] !== 'boolean'
    || !isFiniteNumber(row[at('skate')]) || !isFiniteNumber(row[at('feetMaxError')])
    || !nullableString(row[at('performingName')]) || !nullableString(row[at('performingLayer')]) || !nullableString(row[at('performingPhase')])
    || typeof row[at('pendingGoal')] !== 'boolean' || (row[at('goalX')] !== null && !isFiniteNumber(row[at('goalX')]))
  ) {
    throw new Error(`${source}: series row ${index} is malformed`)
  }
  const name = row[at('performingName')] as string | null
  return {
    t: row[at('t')],
    mode: row[at('mode')],
    enabled: row[at('enabled')],
    skate: row[at('skate')],
    feetMaxError: row[at('feetMaxError')],
    performing: name === null ? null : { name, layer: String(row[at('performingLayer')]), phase: String(row[at('performingPhase')]) },
    pendingGoal: row[at('pendingGoal')],
    goalX: row[at('goalX')],
  }
}

/** A `measure --scenario` record (`kind: 'stage-scenario'`); its series columns must be `stageScenarioColumns`. */
function readScenario(source: string, json: Record<string, unknown>): StageEvidence {
  if (json.scenario !== 'gesture-walk' && json.scenario !== 'action-preempt')
    throw new Error(`${source}: scenario must be gesture-walk or action-preempt`)
  if (typeof json.clip !== 'string' || !isFiniteNumber(json.seconds) || typeof json.valid !== 'boolean')
    throw new Error(`${source}: a scenario record needs clip, seconds and valid`)
  const series = json.series
  if (!isRecord(series) || !Array.isArray(series.columns) || series.columns.join() !== stageScenarioColumns.join() || !Array.isArray(series.rows))
    throw new Error(`${source}: series needs the columns ${stageScenarioColumns.join(', ')}`)
  const measurement = json.measurement
  return {
    kind: 'scenario',
    source,
    scenario: json.scenario,
    clip: json.clip,
    seconds: json.seconds,
    stopAtMs: isFiniteNumber(json.stopAtMs) ? json.stopAtMs : null,
    p95StageMs: isRecord(measurement) && isFiniteNumber(measurement.p95StageMs) ? measurement.p95StageMs : null,
    valid: json.valid,
    samples: series.rows.map((row: unknown, index: number) => readScenarioSample(source, row, index)),
  }
}

/**
 * Reads one evidence JSON into gate inputs. Recognised shapes: a `measure` run (`result` with a mode and fps), a pairs
 * file (`runs`), a walk timeline (`perFrameSeries` at the top level or under `walk`), a per-model arm run (`perFrame`
 * with penL/penR), a multi-model arm summary (`models.<name>.penetration`) and a `measure --scenario` record
 * (`kind: 'stage-scenario'`). Throws for anything else.
 */
export function readStageEvidence(source: string, json: unknown): StageEvidence[] {
  if (!isRecord(json))
    throw new Error(`${source}: evidence must be a JSON object`)
  if (json.kind === 'stage-scenario')
    return [readScenario(source, json)]
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

type ScenarioEvidence = Extract<StageEvidence, { kind: 'scenario' }>

function scenarios(evidence: readonly StageEvidence[], scenario: StageScenario): ScenarioEvidence[] {
  return evidence.filter((entry): entry is ScenarioEvidence => entry.kind === 'scenario' && entry.scenario === scenario)
}

/** `#<row> (t <s> s)` for the first eight offending rows of a series; `rows` are indices into `samples`. */
function nameFrames(samples: readonly ScenarioSample[], rows: readonly number[]): string {
  const named = rows.slice(0, 8).map(row => `#${row} (t ${format(samples[row].t / 1000)} s)`).join(', ')
  return rows.length > 8 ? `${named}, ...` : named
}

function loadCheck(record: ScenarioEvidence): GateCheck {
  return { name: `${record.source} load`, pass: record.valid, detail: record.valid ? 'VALID' : 'INVALID-CONCURRENT-LOAD' }
}

/**
 * `stage-gesture-walk`: an upper clip looped over a walk. The window is every sample after the playClip post up to the
 * stopClip post. Each sample in mode `walking` with the clip on the upper layer adds the time since the previous sample
 * to the walk span, which must reach the larger of the record's scenario `seconds` and `gestureWalkMinMs` (10 s). Skate and
 * feet error are judged over the non-idle samples with the walk-skate limits, the gait must stay enabled on every
 * sample, and the clip must be on the upper layer in at least `gesturePresenceMin` of them.
 */
export function gateGestureWalk(evidence: readonly StageEvidence[]): GateResult {
  const limits = stageGateThresholds
  const checks: GateCheck[] = []
  for (const record of scenarios(evidence, 'gesture-walk')) {
    const { samples, clip, source } = record
    const window = samples.map((_, row) => row).filter(row => samples[row].t > 0 && (record.stopAtMs === null || samples[row].t <= record.stopAtMs))
    checks.push(loadCheck(record))
    if (window.length === 0) {
      checks.push({ name: `${source} window`, pass: false, detail: 'no sample after the playClip post' })
      continue
    }
    const onUpper = (sample: ScenarioSample) => sample.performing?.name === clip && sample.performing.layer === 'upper'
    const spanMs = window.reduce((sum, row) => row > 0 && samples[row].mode === 'walking' && onUpper(samples[row]) ? sum + samples[row].t - samples[row - 1].t : sum, 0)
    const requiredMs = Math.max(record.seconds * 1000, limits.gestureWalkMinMs)
    checks.push({
      name: `${source} walk span`,
      pass: spanMs >= requiredMs,
      detail: `${format(spanMs / 1000)} s walking with ${clip} on the upper layer (required ${format(requiredMs / 1000)} s: scenario span ${record.seconds} s, floor ${limits.gestureWalkMinMs / 1000} s)`,
    })
    const moving = window.filter(row => samples[row].mode !== 'idle')
    const skate = moving.length === 0 ? 0 : maxOf(moving.map(row => samples[row].skate))
    const error = moving.length === 0 ? 0 : maxOf(moving.map(row => samples[row].feetMaxError))
    checks.push({
      name: `${source} skate`,
      pass: moving.length > 0 && skate < limits.walkSkateMax,
      detail: `max locomotion.skate ${format(skate)} over ${moving.length} non-idle samples (limit < ${limits.walkSkateMax})`,
    })
    checks.push({
      name: `${source} feet`,
      pass: moving.length > 0 && error < limits.walkFeetErrorMax,
      detail: `max feet.maxError ${format(error)} (limit < ${limits.walkFeetErrorMax})`,
    })
    const gaitOff = window.filter(row => !samples[row].enabled)
    checks.push({
      name: `${source} gait enabled`,
      pass: gaitOff.length === 0,
      detail: gaitOff.length === 0
        ? `locomotion.enabled true on all ${window.length} samples`
        : `${gaitOff.length} of ${window.length} samples with locomotion.enabled false: ${nameFrames(samples, gaitOff)}`,
    })
    const present = window.filter(row => onUpper(samples[row])).length
    checks.push({
      name: `${source} presence`,
      pass: present / window.length >= limits.gesturePresenceMin,
      detail: `${clip} on the upper layer in ${present} of ${window.length} samples (${(100 * present / window.length).toFixed(2)} %, limit >= ${limits.gesturePresenceMin * 100} %)`,
    })
  }
  return verdictOf('stage-gesture-walk', checks)
}

/**
 * `stage-action-preempt`: a full clip played while a goal was pending. The director keeps the gait on while a full
 * performance is `settling` (it lets her stop walking first), so the gait and pending-goal checks read only the samples
 * in phase `playing`; settling samples are counted in the detail. After the performance clears, the held goal must be
 * issued (pending cleared, `director.goalX` set) within `goalResumeMaxMs`, and the stage p95 must stay in budget.
 */
export function gateActionPreempt(evidence: readonly StageEvidence[]): GateResult {
  const limits = stageGateThresholds
  const checks: GateCheck[] = []
  for (const record of scenarios(evidence, 'action-preempt')) {
    const { samples, clip, source } = record
    checks.push(loadCheck(record))
    const performingRows = samples.map((_, row) => row).filter(row => samples[row].performing?.name === clip)
    const playing = performingRows.filter(row => samples[row].performing!.phase === 'playing')
    const settling = performingRows.filter(row => samples[row].performing!.phase === 'settling').length
    const offLayer = performingRows.filter(row => samples[row].performing!.layer !== 'full')
    checks.push({
      name: `${source} performance`,
      pass: playing.length > 0 && offLayer.length === 0,
      detail: performingRows.length === 0
        ? `no sample performing ${clip} on the full layer`
        : offLayer.length > 0
          ? `${offLayer.length} samples perform ${clip} off the full layer: ${nameFrames(samples, offLayer)}`
          : `${performingRows.length} samples performing ${clip} on the full layer: ${playing.length} playing, ${settling} settling (settling keeps the gait on and is not gated)`,
    })
    const gaitOn = playing.filter(row => samples[row].enabled)
    checks.push({
      name: `${source} gait off while playing`,
      pass: playing.length > 0 && gaitOn.length === 0,
      detail: gaitOn.length === 0
        ? `locomotion.enabled false on all ${playing.length} playing samples`
        : `${gaitOn.length} of ${playing.length} playing samples with locomotion.enabled true: ${nameFrames(samples, gaitOn)}`,
    })
    const noGoal = playing.filter(row => !samples[row].pendingGoal)
    checks.push({
      name: `${source} pending goal`,
      pass: playing.length > 0 && noGoal.length === 0,
      detail: noGoal.length === 0
        ? `director.pendingGoal set on all ${playing.length} playing samples`
        : `${noGoal.length} of ${playing.length} playing samples without director.pendingGoal: ${nameFrames(samples, noGoal)}`,
    })
    const clearedAt = performingRows.length === 0 ? -1 : performingRows[performingRows.length - 1] + 1
    if (clearedAt < 0 || clearedAt >= samples.length) {
      checks.push({ name: `${source} goal resume`, pass: false, detail: performingRows.length === 0 ? 'no performance to resume after' : 'action.performing never cleared' })
    }
    else {
      const cleared = samples[clearedAt]
      const issued = samples.slice(clearedAt).find(sample => !sample.pendingGoal && sample.goalX !== null)
      const resumeMs = issued ? issued.t - cleared.t : null
      checks.push({
        name: `${source} goal resume`,
        pass: resumeMs !== null && resumeMs <= limits.goalResumeMaxMs,
        detail: resumeMs === null
          ? `no goal issued after action.performing cleared at t ${format(cleared.t / 1000)} s`
          : `goal issued ${format(resumeMs / 1000)} s after action.performing cleared (limit <= ${limits.goalResumeMaxMs / 1000} s)`,
      })
    }
    checks.push({
      name: `${source} p95-stage-ms`,
      pass: record.p95StageMs !== null && record.p95StageMs <= limits.p95StageMsMax,
      detail: record.p95StageMs === null ? 'no frame measurement recorded' : `p95 AIRI stages ${format(record.p95StageMs)} ms (limit <= ${limits.p95StageMsMax})`,
    })
  }
  return verdictOf('stage-action-preempt', checks)
}

export function runStageGates(evidence: readonly StageEvidence[]): GateResult[] {
  return [gateWalkSkate(evidence), gateArmPenetration(evidence), gateFrameBudget(evidence), gateGestureWalk(evidence), gateActionPreempt(evidence)]
}

export function formatGateResults(results: readonly GateResult[]): string {
  return results.flatMap(result => [
    `${result.id}: ${result.verdict}`,
    ...result.checks.map(check => `  [${check.pass ? 'PASS' : 'FAIL'}] ${check.name}: ${check.detail}`),
  ]).join('\n')
}
