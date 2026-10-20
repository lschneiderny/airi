import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'
import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'
import type { PerformanceMode, PerformanceState } from '@proj-airi/stage-shared/performance-state'
import type { Live2DNaturalMotionAttention } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion-adapter'
import type { NaturalEpisode } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/mood'
import type { NaturalTrace } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'
import type { StagePerformanceScene } from '@proj-airi/stage-ui/composables/performance/use-stage-performance-conductor'

import { parseExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { createScenarioPlayer, MotionScenarioSchema } from '@proj-airi/stage-shared/motion-scenario'
import { EmotionHoldPerformer } from '@proj-airi/stage-ui-live2d/composables/live2d/expression/hold'
import { Live2DNaturalMotionAdapter } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion-adapter'
import { referenceStats } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/reference-stats'
import { readLive2DRigProfile } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/rig-profile'
import { syllableFixture } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/speech-fixture'
import { naturalTraceParameterIds, NaturalTraceRecorder } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'
import { StagePerformanceConductor } from '@proj-airi/stage-ui/composables/performance/use-stage-performance-conductor'
import { useEmotionsMessageQueue } from '@proj-airi/stage-ui/composables/queues'
import { createPinia, setActivePinia } from 'pinia'
import { parse } from 'valibot'

export interface RunT1Options {
  /** Simulation steps per second. @default 120 */
  simHz?: number
  /** Samples kept per second; the trace recorder keeps a 30 Hz grid, so only 30 is supported. @default 30 */
  sampleHz?: number
  /** Expression catalog the conductor and the `expression` events resolve against. @default [] */
  catalog?: CatalogEntry[]
}

/** A scenario longer than this many steps is rejected, so one run stays bounded. */
const maxSteps = 120 * 3600
/** Timers one step may fire; the conductor never chains more than a handful. */
const maxTimersPerStep = 1_000

/** Ranges for ids that the reference statistics lack; the stage reads the real rig's table for these. */
const fallbackRanges: Record<string, { min: number, max: number, default: number }> = {
  ParamEyeLSmile: { min: 0, max: 1, default: 0 },
  ParamEyeRSmile: { min: 0, max: 1, default: 0 },
  ParamBrowLAngle: { min: -1, max: 1, default: 0 },
  ParamBrowRAngle: { min: -1, max: 1, default: 0 },
  ParamBrowRY: { min: -1, max: 1, default: 0 },
  ParamCheek: { min: 0, max: 1, default: 0 },
}

type TimerHandle = ReturnType<typeof setTimeout>
type ActParserQueue = Parameters<typeof useEmotionsMessageQueue>[0]

/** Fake timers: callbacks run in due order, ties in arming order, when the sim loop reaches their time. */
function createSimTimers() {
  let seq = 0
  let pending: { id: number, due: number, callback: () => void }[] = []
  return {
    setTimeout(callback: () => void, ms: number, now: number) {
      const id = ++seq
      const due = now + ms / 1000
      const at = pending.findIndex(timer => timer.due > due)
      pending.splice(at < 0 ? pending.length : at, 0, { id, due, callback })
      return id as unknown as TimerHandle
    },
    clearTimeout(handle: TimerHandle) {
      pending = pending.filter(timer => timer.id !== handle as unknown as number)
    },
    /** Runs every timer due at or before `now`, including timers they arm. */
    fireDue(now: number) {
      for (let fired = 0; pending.length > 0 && pending[0].due <= now; fired++) {
        if (fired >= maxTimersPerStep)
          throw new Error('[qa-tools] T1 timers did not settle within one step')
        pending.shift()!.callback()
      }
    },
  }
}

/** The Cubism parameter table the stub model exposes: every Natural trace id, with the rig's reference ranges. */
function buildParameterTable() {
  const ids = [...naturalTraceParameterIds] as string[]
  const ranges = ids.map((id) => {
    const range = referenceStats.ranges[id] ?? fallbackRanges[id]
    if (!range)
      throw new Error(`[qa-tools] No T1 range for parameter ${id}`)
    return range
  })
  const minimumValues = ranges.map(range => range.min)
  const maximumValues = ranges.map(range => range.max)
  const defaultValues = ranges.map(range => range.default)
  // The post-motion base the SDK restores every frame: defaults, with open lids.
  const base = Float32Array.from(ids.map((id, index) => /^ParamEye[LR]Open$/.test(id) ? Math.min(maximumValues[index], Math.max(minimumValues[index], 1)) : defaultValues[index]))
  return { ids, minimumValues, maximumValues, defaultValues, base }
}

/**
 * Runs one motion scenario through the real stage pipeline without a renderer: the performance conductor
 * (decider, hold lease), the hold performer, and the Natural controller behind its adapter, each fresh per call.
 * The trace is deterministic: equal scenarios and options give byte-identical JSON.
 *
 * The scenario is validated with the shared schema, so an unknown emotion or band, an unsorted timeline, or a
 * scenario without level `t1` throws. A run that records no frame throws too, so an empty trace is never a pass.
 *
 * Slot commands (expression files) are decided but not applied, because T1 has no rig to show them; the trace
 * records what Natural performed.
 */
export function runT1(input: MotionScenario, options: RunT1Options = {}): NaturalTrace {
  const { simHz = 120, sampleHz = 30, catalog = [] } = options
  if (sampleHz !== 30)
    throw new Error(`[qa-tools] T1 samples at 30 Hz only, got ${sampleHz}`)
  if (!Number.isInteger(simHz) || simHz < sampleHz)
    throw new Error(`[qa-tools] simHz must be an integer of at least ${sampleHz}, got ${simHz}`)
  const scenario = parse(MotionScenarioSchema, input)
  if (!scenario.levels.includes('t1'))
    throw new Error(`[qa-tools] Scenario ${scenario.id} does not include level t1`)
  const steps = Math.round(scenario.durationSeconds * simHz)
  if (steps > maxSteps)
    throw new Error(`[qa-tools] Scenario ${scenario.id} needs ${steps} steps, above the limit ${maxSteps}`)

  const heldEmotions = scenario.settings?.heldEmotions ?? true
  const parsedSettings = parseExpressionPerformanceSettings({ ...(scenario.settings?.performance as object | undefined), heldEmotions })
  if (!parsedSettings.success)
    throw new Error(`[qa-tools] Scenario ${scenario.id} has invalid performance settings: ${parsedSettings.issues.map(issue => issue.message).join('; ')}`)
  const settings = parsedSettings.value
  const home = scenario.home ?? 'desk'

  let simTime = 0
  const timers = createSimTimers()
  const holdPerformer = new EmotionHoldPerformer()
  const pendingEmotions: NaturalEpisode[] = []

  // The scene the stage's Model.vue exposes to the conductor.
  const scene: StagePerformanceScene = {
    setEmotion: (episode) => { pendingEmotions.push(episode) },
    applySlots: () => {},
    applyHolds: (commands, now) => holdPerformer.applyHolds(commands, now),
    onSpeech: (event, turnId, now) => holdPerformer.onSpeech(event, turnId, now),
    setMuted: muted => holdPerformer.setMuted(muted),
  }
  setActivePinia(createPinia())
  const conductor = new StagePerformanceConductor({
    scene: () => scene,
    driver: () => 'natural',
    playMotion: () => {},
    settings: () => settings,
    catalog: () => catalog,
    seed: scenario.seed,
    clock: () => simTime,
    timers: {
      setTimeout: (callback, ms) => timers.setTimeout(callback, ms, simTime),
      clearTimeout: handle => timers.clearTimeout(handle),
    },
  })

  const table = buildParameterTable()
  const values = Float32Array.from(table.base)
  const model = {
    coreModel: {
      getParameterValueByIndex: (index: number) => values[index],
      setParameterValueByIndex: (index: number, value: number) => { values[index] = value },
    },
    updateFocus: () => {},
  }
  const rigProfile = readLive2DRigProfile(table, undefined)

  let performance: PerformanceState = { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }
  let energy = 0.5
  let cursor: { x: number, y: number } | null = null
  const cursorAttention = scenario.settings?.cursorAttention ?? true
  const speeches = new Map<string, { start: number, end: number, level: Float64Array }>()
  let speechEndedAt: number | null = null
  const emotionStrengths = {}
  const clipOwnedIds = new Set<string>()
  const pendingPokes: Live2DNaturalMotionAttention['pendingPokes'] = []

  const adapter = new Live2DNaturalMotionAdapter(model, rigProfile, () => ({
    driver: 'natural',
    manualActive: false,
    springActive: false,
    exclusive: false,
    performance,
    energy,
    voice: { speaking: speeches.size > 0, level: speechLevel(), speechEndedAtSeconds: speechEndedAt },
    autoBlink: true,
    manualBreathActive: false,
    clipOwnedIds,
    pendingEmotions,
    heldEmotion: holdPerformer.current(simTime),
    emotionStrengths,
    cursor: cursorAttention ? cursor : null,
    pendingPokes,
    pet: null,
  }), undefined, undefined, { seed: scenario.seed, home })
  adapter.setPerformanceSettings(settings)

  const recorder = new NaturalTraceRecorder({ ids: table.ids, minimumValues: table.minimumValues, maximumValues: table.maximumValues, defaultValues: table.defaultValues })
  adapter.natural.setObserver(event => recorder.mark(event.at, 'natural', event))

  function speechLevel() {
    let level = 0
    for (const speech of speeches.values())
      level = Math.max(level, speech.level[Math.min(speech.level.length - 1, Math.round((simTime - speech.start) * simHz))] ?? 0)
    return level
  }

  const slotOf = (id: string) => {
    const kind = catalog.find(entry => entry.id === id)?.kind
    return kind === 'face' || kind === 'effect' || kind === 'prop' ? kind : undefined
  }

  const player = createScenarioPlayer(scenario)
  try {
    for (let step = 0; step <= steps; step++) {
      const previous = simTime
      simTime = step / simHz
      timers.fireDue(simTime)
      for (const [turnId, speech] of speeches) {
        if (simTime < speech.end)
          continue
        speeches.delete(turnId)
        speechEndedAt = simTime
        conductor.clipEnd(turnId, `${turnId}-clip`, 'ended')
        conductor.turnEnd(turnId)
      }
      for (const event of player.eventsBetween(step === 0 ? Number.NEGATIVE_INFINITY : previous, simTime)) {
        recorder.mark(simTime, 'scenario', event)
        switch (event.kind) {
          case 'emotion':
            conductor.emotion(event.emotion, settings.intensity[event.band], event.source)
            break
          case 'act': {
            // The stage's own ACT parser; it enqueues synchronously for a marker without awaits.
            const parsed: { name: string, intensity: number }[] = []
            useEmotionsMessageQueue({ enqueue: (payload: { name: string, intensity: number }) => parsed.push(payload) } as unknown as ActParserQueue).enqueue(event.marker)
            if (parsed.length === 0)
              throw new Error(`[qa-tools] ACT marker has no recognized emotion: ${event.marker}`)
            conductor.emotion(parsed[0].name, parsed[0].intensity, 'act')
            break
          }
          case 'mode':
            performance = { ...performance, mode: event.mode satisfies PerformanceMode }
            energy = event.energy ?? energy
            break
          case 'speech': {
            speeches.set(event.turnId, { start: simTime, end: simTime + event.seconds, level: syllableFixture(event.seconds, event.envelopeSeed, simHz).level })
            conductor.clipStart(event.turnId, `${event.turnId}-clip`, true)
            break
          }
          case 'cursor':
            cursor = event.clear ? null : { x: event.x!, y: event.y! }
            break
          case 'expression':
            if (event.on) {
              if (!conductor.expression(event.expressionId, undefined, 'act'))
                throw new Error(`[qa-tools] Expression ${event.expressionId} is not an exposed catalog entry`)
            }
            else if (catalog.some(entry => entry.id === event.expressionId)) {
              conductor.clearExpression(slotOf(event.expressionId), 'act')
            }
            else {
              throw new Error(`[qa-tools] Expression ${event.expressionId} is not in the catalog`)
            }
            break
          case 'placebo':
          case 'noop':
          case 'marker':
            break
        }
      }
      conductor.sampleVoiceLevel(speechLevel())
      // The SDK restores the post-motion values before each late composition.
      values.set(table.base)
      adapter.frame(simTime)
      model.updateFocus()
      recorder.sample(simTime, index => values[index])
    }
  }
  finally {
    conductor.dispose()
    adapter.dispose()
  }

  if (recorder.frames === 0)
    throw new Error(`[qa-tools] Scenario ${scenario.id} recorded no frames`)
  const diagnostics = adapter.diagnostics
  return recorder.build({
    model: null,
    driver: 'natural',
    energy,
    home,
    adapter: { weightMean: diagnostics.weightMean, bodyWrites: diagnostics.bodyWrites, physicsOutputSkips: diagnostics.physicsOutputSkips },
    // Fixed so equal runs serialize to equal bytes.
    capturedAt: new Date(0).toISOString(),
    durationSeconds: recorder.elapsedSeconds,
  })
}
