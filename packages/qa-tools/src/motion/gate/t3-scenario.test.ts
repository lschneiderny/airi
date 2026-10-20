import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { naturalEmotionLifetime } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import { emotionGate, naturalEmotionT3Gate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import { describe, expect, it } from 'vitest'

import { buildT3EmotionPlan, buildT3IdleScenario, t3PlanFromScenarios, t3PulseOrder } from './t3-scenario'

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
  it('reads back the pulses and placebo counts of archived scenarios, and refuses an archive that breaks the layout', () => {
    const plan = buildT3EmotionPlan(naturalEmotionT3Gate, emotionGate, settings, 41)
    const read = t3PlanFromScenarios(naturalEmotionT3Gate, emotionGate, settings, plan.sessions.map(session => session.scenario))
    // Spacing is read up to the next pulse, so only a padded session's last pulse reads longer than planned.
    expect(read.sessions.map(session => session.pulses.map(pulse => [pulse.trialId, pulse.at, pulse.placeboAt]))).toEqual(plan.sessions.map(session => session.pulses.map(pulse => [pulse.trialId, pulse.at, pulse.placeboAt])))
    expect(read.placebos).toBe(plan.placebos)

    const [first, ...rest] = plan.sessions.map(session => session.scenario)
    // Pull the second pulse 8 s toward the first: closer than the spacing rule allows.
    const secondPulse = first.events.filter(event => event.kind === 'emotion')[1]
    const moved = { ...first, events: first.events.map(event => event === secondPulse ? { ...event, at: event.at - 8 } : event).sort((a, b) => a.at - b.at) }
    expect(() => t3PlanFromScenarios(naturalEmotionT3Gate, emotionGate, settings, [moved, ...rest])).toThrow('below')
    expect(() => t3PlanFromScenarios(naturalEmotionT3Gate, emotionGate, settings, rest)).toThrow('pulses')
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
