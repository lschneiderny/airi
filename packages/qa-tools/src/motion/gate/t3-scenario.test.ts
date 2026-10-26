import type { MotionScenario, ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'

import type { T3SessionHeader } from './t3-scenario'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { hashSeed, naturalEmotionLifetime } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import { emotionGate, naturalEmotionT3Gate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import { describe, expect, it } from 'vitest'

import { t3ScreenAwareness } from '../../t3/run-t3'
import { buildT3EmotionPlan, buildT3IdleScenario, t3PlanFromScenarios, t3PulseOrder, t3SessionHeaderMismatch, t3TraceMismatch } from './t3-scenario'

const settings = defaultExpressionPerformanceSettings

describe('buildT3EmotionPlan', () => {
  const plan = buildT3EmotionPlan(naturalEmotionT3Gate, emotionGate, settings)
  const pulses = plan.sessions.flatMap(session => session.pulses)

  it('pulses every cell trialsPerCell times with unique trial ids', () => {
    for (const cell of naturalEmotionT3Gate.cells)
      expect(pulses.filter(pulse => pulse.emotion === cell.emotion && pulse.band === cell.band)).toHaveLength(naturalEmotionT3Gate.trialsPerCell)
    expect(new Set(pulses.map(pulse => pulse.trialId)).size).toBe(pulses.length)
  })

  it('fits every session in one capture, with equal durations, and has enough placebo windows', () => {
    expect(plan.sessions.length).toBeGreaterThanOrEqual(naturalEmotionT3Gate.minSessions)
    for (const session of plan.sessions)
      expect(session.scenario.durationSeconds).toBeLessThanOrEqual(naturalEmotionT3Gate.maxSessionSeconds)
    expect(new Set(plan.sessions.map(session => session.scenario.durationSeconds)).size).toBe(1)
    expect(plan.placebos).toBeGreaterThanOrEqual(naturalEmotionT3Gate.minPlacebos)
  })

  it('spaces pulses by at least the lifetime plus the margin, and keeps each placebo window between lifetime and next pulse', () => {
    for (const session of plan.sessions) {
      for (const [index, pulse] of session.pulses.entries()) {
        const lifetime = naturalEmotionLifetime(settings, pulse.band)
        expect(pulse.spacing).toBeGreaterThanOrEqual(Math.max(naturalEmotionT3Gate.minSpacingSeconds, lifetime + naturalEmotionT3Gate.lifetimeMarginSeconds))
        expect(pulse.placeboAt + emotionGate.windows.baseline[0]).toBeGreaterThanOrEqual(pulse.at + lifetime)
        const next = session.pulses[index + 1]?.at ?? session.scenario.durationSeconds
        expect(pulse.placeboAt + emotionGate.windows.face[1]).toBeLessThan(next)
      }
    }
  })

  it('never repeats a cell back to back', () => {
    for (const session of plan.sessions) {
      session.pulses.slice(1).forEach((pulse, index) => {
        const previous = session.pulses[index]
        expect(`${pulse.emotion}-${pulse.band}`).not.toBe(`${previous.emotion}-${previous.band}`)
      })
    }
  })

  it('is deterministic for a seed and changes with it', () => {
    expect(buildT3EmotionPlan(naturalEmotionT3Gate, emotionGate, settings)).toEqual(plan)
    expect(t3PulseOrder(naturalEmotionT3Gate, 7)).toEqual(t3PulseOrder(naturalEmotionT3Gate, 7))
    expect(t3PulseOrder(naturalEmotionT3Gate, 7)).not.toEqual(t3PulseOrder(naturalEmotionT3Gate, 8))
  })
})

describe('t3PlanFromScenarios', () => {
  // The archived run was planned by naturalEmotionT3Gate v1, whose pulse order comes from this seed.
  const archivedSeed = hashSeed('natural-emotion-t3@1:order')
  const archive = () => buildT3EmotionPlan(naturalEmotionT3Gate, emotionGate, settings, archivedSeed).sessions.map(session => structuredClone(session.scenario))
  const validate = (scenarios: MotionScenario[]) => t3PlanFromScenarios(naturalEmotionT3Gate, emotionGate, settings, scenarios)
  const refuses = (invariant: string, mutate: (scenarios: MotionScenario[]) => MotionScenario[] | void) => {
    const scenarios = archive()
    const mutated = mutate(scenarios) ?? scenarios
    expect(() => validate(mutated)).toThrow(`archive invariant "${invariant}"`)
  }
  const emotions = (scenario: MotionScenario) => scenario.events.filter(event => event.kind === 'emotion')
  /** Rewrites pulse ids the way the planner numbers them, so a cell edit tests its own invariant and not the id format. */
  const renumber = (scenarios: MotionScenario[]) => {
    const counters = new Map<string, number>()
    for (const event of scenarios.flatMap(emotions)) {
      const key = `${event.emotion}-${event.band}`
      counters.set(key, (counters.get(key) ?? 0) + 1)
      event.trialId = `${key}-t3-${counters.get(key)}`
    }
  }

  it('accepts the archived run\'s layout and reads back its pulses and placebos', () => {
    const plan = buildT3EmotionPlan(naturalEmotionT3Gate, emotionGate, settings, archivedSeed)
    const read = validate(archive())
    // Spacing is read up to the next pulse, so only a padded session's last pulse reads longer than planned.
    expect(read.sessions.map(session => session.pulses.map(pulse => [pulse.trialId, pulse.at, pulse.placeboAt]))).toEqual(plan.sessions.map(session => session.pulses.map(pulse => [pulse.trialId, pulse.at, pulse.placeboAt])))
    expect(read.placebos).toBe(52)
  })

  it('refuses the reviewer\'s placebo moved from 54 s into the 44 s pulse window', () => refuses('placebo-window', ([first]) => {
    const placebo = first.events.find(event => event.kind === 'placebo' && event.at === 54)!
    expect(emotions(first)[0].at).toBe(44)
    placebo.at = 44.1
  }))
  it('refuses the reviewer\'s duplicated emotion trialId', () => refuses('unique-ids', ([first]) => {
    emotions(first)[1].trialId = emotions(first)[0].trialId
  }))
  it('refuses a duplicated placebo id', () => refuses('unique-ids', ([first]) => {
    const placebos = first.events.filter(event => event.kind === 'placebo')
    placebos[1].trialId = placebos[0].trialId
  }))
  it('refuses a placebo window that runs into the next pulse', () => refuses('placebo-window', ([first]) => {
    first.events.find(event => event.kind === 'placebo' && event.at === 54)!.at = 55
  }))
  it('refuses times that do not strictly increase', () => refuses('monotonic-times', ([first]) => {
    first.events[1].at = first.events[0].at
  }))
  it('refuses a scenario that is not the planner\'s session', () => refuses('scenario-identity', ([, second]) => {
    second.settings = { ...second.settings, heldEmotions: false }
  }))
  it('refuses an event kind the planner never writes', () => refuses('event-kinds', ([first]) => {
    first.events.splice(1, 0, { kind: 'marker', at: 21, label: 'extra' })
  }))
  it('refuses a pulse outside the gate\'s cells', () => refuses('cell-membership', ([first]) => {
    Object.assign(emotions(first)[0], { emotion: 'happy' })
  }))
  it('refuses a pulse id out of the planner\'s numbering', () => refuses('trial-id-format', ([first]) => {
    emotions(first)[0].trialId = 'love-clear-t3-99'
  }))
  it('refuses fewer sessions than the gate needs', () => refuses('session-count', (scenarios) => {
    const kept = scenarios.slice(0, 2)
    kept.forEach((scenario, index) => {
      scenario.id = `t3-emotion-transfer-${index + 1}-of-2`
    })
    return kept
  }))
  it('refuses sessions of different durations', () => refuses('session-duration', ([, second]) => {
    second.durationSeconds += 10
  }))
  it('refuses sessions longer than one capture', () => refuses('session-duration', (scenarios) => {
    for (const scenario of scenarios)
      scenario.durationSeconds = 600
  }))
  it('refuses an event inside the warm-up', () => refuses('warm-up', ([first]) => {
    first.events[0].at = 10
  }))
  it('refuses a pulse closer to the next than the planner spacing', () => refuses('pulse-spacing', ([first]) => {
    emotions(first)[1].at -= 1
  }))
  it('refuses a cell with the wrong pulse count', () => refuses('cell-count', (scenarios) => {
    const pulse = scenarios.flatMap(emotions).find(event => event.emotion === 'angry' && event.band === 'strong')!
    Object.assign(pulse, { emotion: 'sleepy' })
    renumber(scenarios)
  }))
  it('refuses the same cell twice in a row', () => refuses('back-to-back', (scenarios) => {
    // Swap one pulse's cell with a same-band pulse elsewhere so counts and spacing stay valid.
    const pulses = emotions(scenarios[0])
    const index = pulses.findIndex((pulse, at) => at > 0 && pulse.band === pulses[at - 1].band && pulse.emotion !== pulses[at - 1].emotion)
    const target = pulses[index]
    const donor = scenarios.flatMap(emotions).find(event => event !== pulses[index - 1] && event.emotion === pulses[index - 1].emotion && event.band === pulses[index - 1].band)!
    const [moved, kept] = [target.emotion, pulses[index - 1].emotion]
    Object.assign(target, { emotion: kept })
    Object.assign(donor, { emotion: moved })
    renumber(scenarios)
  }))
  it('refuses a pulse gap without its placebo', () => refuses('placebo-per-pulse', ([first]) => {
    first.events.splice(first.events.findIndex(event => event.kind === 'placebo' && event.at === 54), 1)
  }))
  it('refuses overlapping placebo windows', () => refuses('placebo-overlap', ([first]) => {
    first.events[1].at = 23
  }))
  it('refuses screenshots the planner does not take', () => refuses('screenshots', ([first]) => {
    first.screenshotsAt = first.screenshotsAt!.map((at, index) => index === 0 ? at + 1 : at)
  }))
  it('refuses fewer placebo windows than the gate needs', () => refuses('placebo-total', (scenarios) => {
    for (const scenario of scenarios)
      scenario.events = scenario.events.filter(event => event.kind !== 'placebo' || !event.trialId?.includes('-lead-'))
  }))
})

describe('t3TraceMismatch', () => {
  const archived = () => buildT3EmotionPlan(naturalEmotionT3Gate, emotionGate, settings, hashSeed('natural-emotion-t3@1:order')).sessions[0].scenario
  /** The trace's stamped scenario events: the scenario's own events, with one changed by `tamper`. */
  const stamped = (tamper: (events: ScenarioEvent[]) => void) => {
    const events = structuredClone(archived().events)
    tamper(events)
    return events
  }
  const love = (events: ScenarioEvent[]) => events.find(event => event.kind === 'emotion' && event.trialId === 'love-clear-t3-1')!

  it('accepts a trace that stamped exactly its scenario', () => {
    expect(t3TraceMismatch(archived(), archived().events)).toBeNull()
  })
  it.each([
    ['emotion', 'the reviewer\'s love-clear-t3-1 relabelled from love to sad', (events: ScenarioEvent[]) => { Object.assign(love(events), { emotion: 'sad' }) }],
    ['band', 'a pulse relabelled to another band', (events: ScenarioEvent[]) => { Object.assign(love(events), { band: 'strong' }) }],
    ['trialId', 'a pulse given another trial id', (events: ScenarioEvent[]) => { Object.assign(love(events), { trialId: 'love-clear-t3-2' }) }],
    ['kind', 'a pulse stamped as another kind', (events: ScenarioEvent[]) => { Object.assign(love(events), { kind: 'act' }) }],
    ['at', 'a pulse stamped at another scheduled time', (events: ScenarioEvent[]) => { Object.assign(love(events), { at: 45 }) }],
    ['source', 'a pulse stamped from another source', (events: ScenarioEvent[]) => { Object.assign(love(events), { source: 'act' }) }],
    ['trialId', 'a placebo given another id', (events: ScenarioEvent[]) => { Object.assign(events.find(event => event.kind === 'placebo')!, { trialId: 'other-placebo' }) }],
    ['strength', 'a field the scenario event does not have', (events: ScenarioEvent[]) => { Object.assign(love(events), { strength: 2 }) }],
    ['count', 'a stamped event missing', (events: ScenarioEvent[]) => { events.splice(3, 1) }],
  ])('names field "%s": %s', (field, _, tamper) => {
    expect(t3TraceMismatch(archived(), stamped(tamper))).toContain(`field "${field}"`)
  })
})

describe('t3SessionHeaderMismatch', () => {
  const scenario = buildT3EmotionPlan(naturalEmotionT3Gate, emotionGate, settings, hashSeed('natural-emotion-t3@1:order')).sessions[0].scenario
  const capture = scenario.durationSeconds + 1
  const rig = { model3: '/ForBOOTH/ForBOOTH.model3.json', files: 103, bytes: 154854967 }
  const header = (): T3SessionHeader => ({
    sessionScenario: structuredClone(scenario),
    manifest: { label: `t3-${scenario.id}`, gitSha: 'b18f0044e' },
    trace: { version: 2, meta: { driver: 'natural', durationSeconds: capture, model: 'display-model-1' } },
    bridge: { rig: { name: 'forbooth', ...rig }, configured: { modelId: 'display-model-1', driver: 'natural', cursorAttention: false, expressionEnabled: true, screenAwareness: false, heldEmotions: true }, capture: { durationSeconds: capture } },
  })
  const check = (value: T3SessionHeader) => t3SessionHeaderMismatch(scenario, value, { gitSha: 'b18f0044e', rigName: 'forbooth', rig })

  it('accepts the session that ran the archived scenario', () => {
    expect(check(header())).toBeNull()
  })
  it.each([
    ['scenario.json', (value: T3SessionHeader) => { (value.sessionScenario as { seed: number }).seed = 9 }],
    ['run.label', (value: T3SessionHeader) => { value.manifest.label = 't3-t3-emotion-transfer-2-of-3' }],
    ['run.gitSha', (value: T3SessionHeader) => { value.manifest.gitSha = 'ca3d1a550' }],
    ['trace.version', (value: T3SessionHeader) => { value.trace.version = 1 }],
    ['trace.meta.driver', (value: T3SessionHeader) => { value.trace.meta!.driver = 'universal' }],
    ['trace.meta.durationSeconds', (value: T3SessionHeader) => { value.trace.meta!.durationSeconds = capture - 60 }],
    ['bridge.capture.durationSeconds', (value: T3SessionHeader) => { value.bridge.capture!.durationSeconds = capture - 60 }],
    ['bridge.rig.name', (value: T3SessionHeader) => { value.bridge.rig!.name = 'bear' }],
    ['bridge.rig.model3', (value: T3SessionHeader) => { value.bridge.rig!.model3 = '/Bear/bear.model3.json' }],
    ['bridge.rig.files', (value: T3SessionHeader) => { value.bridge.rig!.files = 102 }],
    ['bridge.rig.bytes', (value: T3SessionHeader) => { value.bridge.rig!.bytes = 1 }],
    ['bridge.configured.driver', (value: T3SessionHeader) => { value.bridge.configured!.driver = 'universal' }],
    ['bridge.configured.cursorAttention', (value: T3SessionHeader) => { value.bridge.configured!.cursorAttention = true }],
    ['bridge.configured.expressionEnabled', (value: T3SessionHeader) => { value.bridge.configured!.expressionEnabled = false }],
    ['bridge.configured.screenAwareness', (value: T3SessionHeader) => { value.bridge.configured!.screenAwareness = true }],
    // A header without the field is refused too: the persisted setting defaults to on, so only an explicit `false` proves it was off.
    ['bridge.configured.screenAwareness', (value: T3SessionHeader) => { delete value.bridge.configured!.screenAwareness }],
    ['bridge.configured.heldEmotions', (value: T3SessionHeader) => { value.bridge.configured!.heldEmotions = false }],
    ['bridge.configured.modelId', (value: T3SessionHeader) => { value.bridge.configured!.modelId = 'display-model-2' }],
  ])('names header "%s"', (field, tamper) => {
    const value = header()
    tamper(value)
    expect(check(value)).toContain(`header "${field}"`)
  })
})

describe('t3 gate scenarios', () => {
  it('configure screen-aware attention off, because they have no placement or chat events', () => {
    const scenarios = [...buildT3EmotionPlan(naturalEmotionT3Gate, emotionGate, settings).sessions.map(session => session.scenario), buildT3IdleScenario(1, 599)]
    expect(scenarios.map(scenario => t3ScreenAwareness(scenario))).toEqual(scenarios.map(() => false))
  })
})

describe('buildT3IdleScenario', () => {
  it('builds a T3 idle scenario with minute markers and no inputs', () => {
    const scenario = buildT3IdleScenario(2, 599)
    expect(scenario.durationSeconds).toBe(599)
    expect(scenario.levels).toContain('t3')
    expect(scenario.events.every(event => event.kind === 'marker')).toBe(true)
    expect(scenario.events.map(event => event.at)).toEqual([60, 120, 180, 240, 300, 360, 420, 480, 540])
    expect(scenario.settings?.cursorAttention).toBe(false)
  })
})
