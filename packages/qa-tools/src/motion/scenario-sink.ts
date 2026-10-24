import type { CatalogEntry, ExpressionPerformanceSettings, SlotCommand } from '@proj-airi/stage-shared/expression-performance'
import type { MotionScenario, MotionScenarioLevel } from '@proj-airi/stage-shared/motion-scenario'
import type { PerformanceMode, PerformanceState } from '@proj-airi/stage-shared/performance-state'
import type { SpeechEvent } from '@proj-airi/stage-ui-live2d/composables/live2d/expression/slots'
import type { Live2DNaturalMotionAttention } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion-adapter'
import type { naturalEmotions } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotions'
import type { NaturalEpisode } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/mood'
import type { PostureHome } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/posture'
import type { readLive2DRigProfile } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/rig-profile'
import type { NaturalTrace, NaturalTraceRecorder } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'
import type { StagePerformanceScene } from '@proj-airi/stage-ui/composables/performance/use-stage-performance-conductor'

import { normalizeActPayload, tokenAct } from '@proj-airi/pipelines-audio'
import { parseExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { createScenarioPlayer, MotionScenarioSchema } from '@proj-airi/stage-shared/motion-scenario'
import { EmotionHoldPerformer } from '@proj-airi/stage-ui-live2d/composables/live2d/expression/hold'
import { Live2DNaturalMotionAdapter } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion-adapter'
import { syllableFixture } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/speech-fixture'
import { StagePerformanceConductor } from '@proj-airi/stage-ui/composables/performance/use-stage-performance-conductor'
import { createPinia, setActivePinia } from 'pinia'
import { parse } from 'valibot'

/** A scenario longer than this many steps is rejected, so one run stays bounded. */
const maxSteps = 120 * 3600
/** Timers one step may fire; the conductor never chains more than a handful. */
const maxTimersPerStep = 1_000
/** The ACT parser the stage's streaming control runs; its `parse` is synchronous and has no side effects. */
const actParser = tokenAct()

type TimerHandle = ReturnType<typeof setTimeout>

/** What a QA level supplies to the shared scenario sink: the model, its recorder, and one frame of its pipeline. */
export interface ScenarioHost {
  /** The model the Natural adapter wraps; the adapter replaces its `updateFocus`. */
  model: ConstructorParameters<typeof Live2DNaturalMotionAdapter>[0]
  rigProfile: ReturnType<typeof readLive2DRigProfile>
  recorder: NaturalTraceRecorder
  /** Model id written into the trace meta, or `null` when the level has none. */
  modelId: string | null
  /** Executes the conductor's slot commands (expression files); a level without a rig leaves them undone. */
  applySlots: (commands: SlotCommand[], now: number) => void
  onSpeech: (event: SpeechEvent, turnId: string, now: number) => void
  setMuted: (muted: boolean) => void
  /** Runs one frame at `simTime` and samples the recorder: the part of the pipeline that differs per level. */
  frame: (adapter: Live2DNaturalMotionAdapter, simTime: number) => void
  dispose: () => void
}

export interface ScenarioHostContext {
  scenario: MotionScenario
  settings: ExpressionPerformanceSettings
  catalog: CatalogEntry[]
  home: PostureHome
}

export interface ScenarioSinkOptions {
  level: MotionScenarioLevel
  /** Simulation steps per second. */
  simHz: number
  catalog: CatalogEntry[]
  createHost: (context: ScenarioHostContext) => ScenarioHost
  /** Emotion table seam of the Natural controller, for scorer mutation runs. @default naturalEmotions */
  emotionTable?: typeof naturalEmotions
}

/** Simulated timers fire in due order, ties in arming order; canceled native handles only identify them. */
function createSimTimers(levelName: string) {
  let pending: { id: TimerHandle, due: number, callback: () => void }[] = []
  return {
    setTimeout(callback: () => void, ms: number, now: number) {
      const id = setTimeout(() => {}, 0)
      clearTimeout(id)
      const due = now + ms / 1000
      const at = pending.findIndex(timer => timer.due > due)
      pending.splice(at < 0 ? pending.length : at, 0, { id, due, callback })
      return id
    },
    clearTimeout(handle: TimerHandle) {
      pending = pending.filter(timer => timer.id !== handle)
    },
    /** Runs every timer due at or before `now`, including timers they arm. */
    fireDue(now: number) {
      for (let fired = 0; pending.length > 0 && pending[0].due <= now; fired++) {
        if (fired >= maxTimersPerStep)
          throw new Error(`[qa-tools] ${levelName} timers did not settle within one step`)
        pending.shift()!.callback()
      }
    },
  }
}

/**
 * Runs one motion scenario through the stage pipeline shared by T1 and T2: the performance conductor
 * (decider, hold lease), the hold performer, and the Natural controller behind its adapter, each fresh per call.
 * The level only supplies the model and one frame (`ScenarioHost`). Equal scenarios give byte-identical traces.
 *
 * The scenario is validated with the shared schema, so an unknown emotion or band, an unsorted timeline, or a
 * scenario without the level throws. A run that records no frame throws too, so an empty trace is never a pass.
 */
export function runScenarioSink(input: MotionScenario, options: ScenarioSinkOptions): NaturalTrace {
  const { level, simHz, catalog } = options
  const levelName = level.toUpperCase()
  const scenario = parse(MotionScenarioSchema, input)
  if (!scenario.levels.includes(level))
    throw new Error(`[qa-tools] Scenario ${scenario.id} does not include level ${level}`)
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
  const timers = createSimTimers(levelName)
  const holdPerformer = new EmotionHoldPerformer()
  holdPerformer.setSlotSettings(settings.slots)
  const pendingEmotions: NaturalEpisode[] = []
  const host = options.createHost({ scenario, settings, catalog, home })

  try {
    // The scene the stage's Model.vue exposes to the conductor.
    const scene: StagePerformanceScene = {
      setEmotion: (episode) => { pendingEmotions.push(episode) },
      applySlots: (commands, now) => host.applySlots(commands, now),
      applyHolds: (commands, now) => holdPerformer.applyHolds(commands, now),
      onSpeech: (event, turnId, now) => {
        holdPerformer.onSpeech(event, turnId, now)
        host.onSpeech(event, turnId, now)
      },
      setMuted: (muted) => {
        holdPerformer.setMuted(muted)
        host.setMuted(muted)
      },
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

    let performance: PerformanceState = { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }
    let energy = 0.5
    let cursor: { x: number, y: number } | null = null
    const cursorAttention = scenario.settings?.cursorAttention ?? true
    const speeches = new Map<string, { start: number, end: number, level: Float64Array }>()
    let speechEndedAt: number | null = null
    const emotionStrengths = {}
    const clipOwnedIds = new Set<string>()
    const pendingPokes: Live2DNaturalMotionAttention['pendingPokes'] = []

    const adapter = new Live2DNaturalMotionAdapter(host.model, host.rigProfile, () => ({
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
      cursorDismissed: !cursorAttention,
      pendingPokes,
      pet: null,
    }), undefined, undefined, { seed: scenario.seed, home, emotionTable: options.emotionTable })
    adapter.setPerformanceSettings(settings)

    const recorder = host.recorder
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
              // The stage's emotions queue (`useEmotionsMessageQueue`) runs this parser and normalizer inside
              // `dispatchWith` and delivers the emotion after an await. The sim step is synchronous, so it calls them directly.
              const token = actParser.match(event.marker) ? actParser.parse(event.marker) : undefined
              const emotion = token ? normalizeActPayload(token.payload).emotion : undefined
              if (!emotion)
                throw new Error(`[qa-tools] ACT marker has no recognized emotion: ${event.marker}`)
              conductor.emotion(emotion.name, emotion.intensity, 'act')
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
        host.frame(adapter, simTime)
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
      model: host.modelId,
      driver: 'natural',
      energy,
      home,
      adapter: { weightMean: diagnostics.weightMean, bodyWrites: diagnostics.bodyWrites, physicsOutputSkips: diagnostics.physicsOutputSkips },
      // Fixed so equal runs serialize to equal bytes.
      capturedAt: new Date(0).toISOString(),
      durationSeconds: recorder.elapsedSeconds,
    })
  }
  finally {
    host.dispose()
  }
}
