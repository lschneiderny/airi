import type { GenericSchema, InferOutput } from 'valibot'

import type { PerformanceMode } from '../../performance-state'

import {
  array,
  boolean,
  check,
  finite,
  length,
  literal,
  maxValue,
  minLength,
  minValue,
  null_,
  nullable,
  number,
  object,
  optional,
  picklist,
  pipe,
  record,
  safeInteger,
  safeParse,
  string,
  tuple,
  tupleWithRest,
  union,
  variant,
} from 'valibot'

import { FRAME_BINS_V1, STAGE_BINS_V1 } from './bins'

/** The format version of every record kind except `segment-rollup`. Readers skip and count lines of any other version. */
export const PERF_RECORD_VERSION = 1
/**
 * The `segment-rollup` format version. Version 2 splits each cell into 5-minute buckets. `parsePerfLine` also reads
 * a version 1 row, as version 2 with each cell's totals in one bucket spanning the segment: `sessions.jsonl` is
 * append-only and never rewrites its old rows, so reading them is supported policy, not a temporary fallback.
 */
export const SEGMENT_ROLLUP_VERSION = 2

const epochMs = pipe(number(), safeInteger(), minValue(0))
const count = pipe(number(), safeInteger(), minValue(0))
const amount = pipe(number(), finite(), minValue(0))
const share = pipe(number(), finite(), minValue(0), maxValue(1))
/** Frame bin counts followed by the overflow bin; a wrong length would make `FixedHistogram.mergeFrom` throw. */
const frameHist = pipe(array(count), length(FRAME_BINS_V1.edges.length + 1))
const stageBinIndex = pipe(count, maxValue(STAGE_BINS_V1.edges.length))
const label = pipe(string(), minLength(1))
const scalar = union([string(), pipe(number(), finite()), boolean(), null_()])

export const USAGE_RENDERERS = ['live2d', 'mmd', 'vrm', 'spine', 'tachie', 'godot', 'none'] as const
export const USAGE_ACTIVITIES = ['idle', 'watching', 'listening', 'thinking', 'talking', 'unknown'] as const satisfies readonly (PerformanceMode | 'unknown')[]

// Fails typecheck with the missing mode named in the error when `PerformanceMode` gains a mode that the picklist above lacks.
type MissingActivities<Missing extends never = Exclude<PerformanceMode, (typeof USAGE_ACTIVITIES)[number]>> = Missing
export type UsageActivitiesCoverPerformanceModes = MissingActivities
export const USAGE_EVENT_NAMES = [
  'model-load',
  'feature-change',
  'visibility',
  'suspend',
  'resume',
  'renderer-reload',
  'recording-start',
  'recording-stop',
  'trace-start',
  'trace-stop',
  'rollup-missing',
  'incident-suppressed',
] as const
export const INCIDENT_TRIGGERS = ['frame-stall', 'memory-growth', 'pegged'] as const
/** Feature tags of a stage window, fixed so cells group the same way across sessions. */
export const USAGE_FEATURE_KEYS = ['speechMuted', 'mmdPhysics', 'naturalMotion', 'mmdRoam', 'wakeWord', 'hearing'] as const

const BUILD_MODES = ['dev', 'preview', 'packaged'] as const
const STAGE_HOSTS = ['window', 'desktop'] as const

const header = { v: literal(PERF_RECORD_VERSION), t: epochMs, sessionId: label }

const HostSchema = object({
  platform: label,
  arch: label,
  cpuModel: string(),
  cores: count,
  totalMemKb: count,
  gpu: nullable(string()),
})

/** A feature value is `null` when it does not apply to the current renderer. */
const FeaturesSchema = object({
  speechMuted: scalar,
  mmdPhysics: scalar,
  naturalMotion: scalar,
  mmdRoam: scalar,
  wakeWord: scalar,
  hearing: scalar,
}) satisfies GenericSchema<unknown, Record<(typeof USAGE_FEATURE_KEYS)[number], unknown>>

/** Per-stage timings keyed by stage id; `hist` is sparse `[binIndex, count]` pairs over the session's stage bins. */
const StagesSchema = record(string(), object({
  n: count,
  sumMs: amount,
  maxMs: amount,
  hist: array(tuple([stageBinIndex, count])),
}))

const QuartilesSchema = object({ q1: pipe(number(), finite()), median: pipe(number(), finite()), q3: pipe(number(), finite()) })

/** A path relative to the perf data directory; absolute paths and parent segments would leak or escape it. */
const relativePerfPath = pipe(
  label,
  check(path => !/^(?:[/\\]|[a-z]:)/i.test(path) && !path.split(/[/\\]/).includes('..'), 'Expected a path inside the perf directory'),
)

const SessionStartSchema = object({
  ...header,
  kind: literal('session-start'),
  segment: count,
  host: HostSchema,
  buildMode: picklist(BUILD_MODES),
  appVersion: string(),
  electronVersion: string(),
  chromeVersion: string(),
  frameBins: label,
  stageBins: label,
  startedBy: picklist(['toggle', 'env', 'default']),
})

/** Written at session start and whenever the running code's identity changes; `epoch` counts the changes. */
const IdentitySchema = object({
  ...header,
  kind: literal('identity'),
  epoch: count,
  sha: label,
  shortSha: label,
  branch: nullable(string()),
  dirty: nullable(boolean()),
  diffHash: nullable(string()),
  source: picklist(['runtime-git', 'build-info']),
})

const SampleSchema = object({
  ...header,
  kind: literal('sample'),
  epoch: count,
  intervalMs: amount,
  processes: array(object({
    pid: count,
    creationTime: pipe(number(), finite()),
    role: label,
    label: string(),
    cpuPctOfCore: nullable(amount),
    workingSetKb: amount,
    peakWorkingSetKb: amount,
  })),
  machine: object({
    load1: amount,
    cores: count,
    externalCpuPct: amount,
    psiCpuSomeAvg10: nullable(amount),
  }),
  hostContended: boolean(),
  chromiumTrace: boolean(),
  recorderMs: amount,
  bytesWritten: count,
})

const WindowRollupSchema = object({
  ...header,
  kind: literal('window-rollup'),
  epoch: count,
  window: label,
  visible: boolean(),
  paused: boolean(),
  tags: object({
    renderer: picklist(USAGE_RENDERERS),
    modelId: nullable(string()),
    modelName: nullable(string()),
    features: FeaturesSchema,
    featureHash: string(),
    activity: picklist(USAGE_ACTIVITIES),
    chatGenerating: boolean(),
    stageHost: picklist(STAGE_HOSTS),
    devtoolsOpen: boolean(),
    display: object({ width: count, height: count, scale: amount, refreshHz: amount }),
    diagnosticsTracing: boolean(),
  }),
  frames: count,
  frameHist,
  frameSumMs: amount,
  frameMaxMs: amount,
  longTasks: object({ count, maxMs: amount, sumMs: amount }),
  stages: nullable(StagesSchema),
  recorderUs: amount,
})

const EventSchema = object({
  ...header,
  kind: literal('event'),
  name: picklist(USAGE_EVENT_NAMES),
  window: optional(label),
  detail: record(string(), scalar),
})

const IncidentSchema = object({
  ...header,
  kind: literal('incident'),
  id: label,
  trigger: picklist(INCIDENT_TRIGGERS),
  window: optional(label),
  pid: optional(count),
  peak: record(string(), pipe(number(), finite())),
  hostContended: boolean(),
  file: relativePerfPath,
})

/** The fields that group a segment's stage-window rollups into one cell. */
const cellKey = {
  epoch: count,
  sha: label,
  dirty: nullable(boolean()),
  diffHash: nullable(string()),
  window: label,
  renderer: picklist(USAGE_RENDERERS),
  modelId: nullable(string()),
  featureHash: string(),
  features: FeaturesSchema,
  activity: picklist(USAGE_ACTIVITIES),
  hostContended: boolean(),
  stageHost: picklist(STAGE_HOSTS),
  devtoolsOpen: boolean(),
  refreshHz: amount,
}

/** What a cell's included windows add up to. */
const cellTotals = {
  windows: count,
  frames: count,
  frameHist,
  /** Quartiles over the windows of each window's headline value; CPU and memory are `null` without a joined sample. */
  quartiles: object({
    p50FrameMs: QuartilesSchema,
    share21: QuartilesSchema,
    share36: QuartilesSchema,
    share100: QuartilesSchema,
    cpuPct: nullable(QuartilesSchema),
    workingSetKb: nullable(QuartilesSchema),
  }),
  stages: nullable(StagesSchema),
  incidents: count,
}

/**
 * The windows of a cell that end in one wall-clock 5-minute span (`SEGMENT_BUCKET_MS`). Every window covers
 * `(start, end]`, and the bucket's `(startMs, endMs]` covers all of its windows, so a window that spans a bucket
 * boundary stretches its bucket's start back before that boundary.
 */
const SegmentBucketSchema = object({ startMs: epochMs, endMs: epochMs, ...cellTotals })

/** One group of comparable stage-window rollups in a segment, with its windows in time order of their buckets. */
const SegmentCellSchema = object({ ...cellKey, buckets: tupleWithRest([SegmentBucketSchema], SegmentBucketSchema) })

const segmentRollupFields = {
  t: epochMs,
  sessionId: label,
  kind: literal('segment-rollup'),
  segment: count,
  startedAt: epochMs,
  endedAt: epochMs,
  recovered: boolean(),
  malformedLines: count,
  excludedWindows: count,
  recorderMs: amount,
  rawBytes: count,
  host: HostSchema,
  buildMode: picklist(BUILD_MODES),
}

/** Written only to `sessions.jsonl`. */
const SegmentRollupSchema = object({ v: literal(SEGMENT_ROLLUP_VERSION), ...segmentRollupFields, cells: array(SegmentCellSchema) })

/** A version 1 row, whose cells carry their totals over the whole segment and no buckets. */
const SegmentRollupV1Schema = object({ v: literal(1), ...segmentRollupFields, cells: array(object({ ...cellKey, ...cellTotals })) })

/** Written only to `sessions.jsonl`. */
const RollupFailedSchema = object({
  ...header,
  kind: literal('rollup-failed'),
  segment: count,
  reason: string(),
})

/** Written only to `bench.jsonl`. */
const BenchRunSchema = object({
  ...header,
  kind: literal('bench-run'),
  matrix: label,
  scenario: label,
  scenarioVersion: count,
  run: count,
  sha: label,
  dirty: boolean(),
  diffHash: nullable(string()),
  modelFingerprint: label,
  host: HostSchema,
  buildMode: picklist(BUILD_MODES),
  electronVersion: string(),
  valid: boolean(),
  invalidReason: optional(string()),
  metrics: object({
    fps: amount,
    p50FrameMs: amount,
    p95FrameMsApprox: amount,
    share21: share,
    share36: share,
    share100: share,
    stageWindowCpuPct: amount,
    /** Stage-window CPU per rendered frame; CPU tracks the frame rate, so this separates cheaper frames from fewer. */
    stageWindowCpuMsPerFrame: amount,
    gpuCpuPct: amount,
    browserCpuPct: amount,
    stageWindowWorkingSetKb: amount,
    stageSumMeanMs: nullable(amount),
    recorderMs: amount,
  }),
  /**
   * Per-stage cost keyed by stage id: `msPerFrame` over the same frame count as `stageSumMeanMs`, so the stages add up
   * to it, the approximate 95th-percentile duration of one call, and the call count `n`. A run whose renderer times no
   * stages has none. Records written before per-stage recording also have none: `bench.jsonl` is append-only, so
   * readers treat an absent `stages` as "not recorded" as supported policy, not as a temporary fallback.
   */
  stages: optional(record(label, object({ msPerFrame: amount, p95MsApprox: amount, n: count }))),
})

export const PerfRecordSchema = variant('kind', [
  SessionStartSchema,
  IdentitySchema,
  SampleSchema,
  WindowRollupSchema,
  EventSchema,
  IncidentSchema,
  SegmentRollupSchema,
  RollupFailedSchema,
  BenchRunSchema,
])

export type PerfRecord = InferOutput<typeof PerfRecordSchema>
export type PerfRecordKind = PerfRecord['kind']
export type SessionStartRecord = InferOutput<typeof SessionStartSchema>
export type IdentityRecord = InferOutput<typeof IdentitySchema>
export type SampleRecord = InferOutput<typeof SampleSchema>
export type WindowRollupRecord = InferOutput<typeof WindowRollupSchema>
export type UsageEventRecord = InferOutput<typeof EventSchema>
export type IncidentRecord = InferOutput<typeof IncidentSchema>
export type SegmentCell = InferOutput<typeof SegmentCellSchema>
export type SegmentBucket = InferOutput<typeof SegmentBucketSchema>
/** The fields that group windows into one cell. */
export type SegmentCellKey = Omit<SegmentCell, 'buckets'>
/** What a cell's windows add up to, over one bucket or several (`bucketTotals`). */
export type SegmentCellTotals = Omit<SegmentBucket, 'startMs' | 'endMs'>
export type SegmentRollupRecord = InferOutput<typeof SegmentRollupSchema>
export type RollupFailedRecord = InferOutput<typeof RollupFailedSchema>
export type BenchRunRecord = InferOutput<typeof BenchRunSchema>
export type UsageHost = InferOutput<typeof HostSchema>
export type UsageFeatures = InferOutput<typeof FeaturesSchema>

export type PerfLineParseResult
  = | { ok: true, record: PerfRecord }
    | { ok: false, reason: 'json' | 'schema' | 'version' }

function liftSegmentRollupV1(row: InferOutput<typeof SegmentRollupV1Schema>): SegmentRollupRecord {
  return {
    ...row,
    v: SEGMENT_ROLLUP_VERSION,
    cells: row.cells.map(({ windows, frames, frameHist, quartiles, stages, incidents, ...key }) => ({
      ...key,
      buckets: [{ startMs: row.startedAt, endMs: row.endedAt, windows, frames, frameHist, quartiles, stages, incidents }],
    })),
  }
}

/**
 * Parses one JSONL line. It never throws: unparseable JSON is `json`, a `v` other than its kind's version
 * ({@link SEGMENT_ROLLUP_VERSION} for `segment-rollup`, {@link PERF_RECORD_VERSION} otherwise) is `version`
 * (skipped, never migrated), and anything else invalid is `schema`. A version 1 `segment-rollup` row is read as
 * version 2, each cell one bucket spanning the segment.
 */
export function parsePerfLine(line: string): PerfLineParseResult {
  let value: unknown
  try {
    value = JSON.parse(line)
  }
  catch (error) {
    if (error instanceof SyntaxError)
      return { ok: false, reason: 'json' }
    throw error
  }
  if (typeof value === 'object' && value !== null && 'v' in value) {
    const isSegmentRollup = 'kind' in value && value.kind === 'segment-rollup'
    if (isSegmentRollup && value.v === 1) {
      const legacy = safeParse(SegmentRollupV1Schema, value)
      return legacy.success ? { ok: true, record: liftSegmentRollupV1(legacy.output) } : { ok: false, reason: 'schema' }
    }
    if (value.v !== (isSegmentRollup ? SEGMENT_ROLLUP_VERSION : PERF_RECORD_VERSION))
      return { ok: false, reason: 'version' }
  }
  const result = safeParse(PerfRecordSchema, value)
  return result.success ? { ok: true, record: result.output } : { ok: false, reason: 'schema' }
}
