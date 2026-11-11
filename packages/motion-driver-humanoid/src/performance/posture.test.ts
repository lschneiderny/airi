import { describe, expect, it } from 'vitest'

import { channelIndex } from './channels'
import { createBodyPerformer } from './index'
import { channelTrace, fixtureRigs, idleInput, lagOf, peakSpeed, quietInput } from './performance.test-fixtures'

const traits = fixtureRigs[0].traits
const c = channelIndex

describe('posture performance', () => {
  it('settles a head posture shift like a head on a relaxed neck, in 0.8 to 1.5 s with a light follow-through', () => {
    const performer = createBodyPerformer({ traits, seed: 1 })
    const trace = channelTrace(performer, 4, (t) => {
      const input = quietInput(t)
      return { ...input, head: { ...input.head, attitude: { yaw: 0, pitch: t < 0.5 ? 0 : 0.05, roll: 0 } } }
    })
    const head = trace[c('neckPitch')].map((v, i) => v + trace[c('headPitch')][i])
    const final = head.at(-1) ?? 0
    const settled = head.findLastIndex(v => Math.abs(v - final) > 0.02 * final) + 1
    const settleSeconds = (settled - 0.5 * 120) / 120
    expect(settleSeconds).toBeGreaterThanOrEqual(0.8)
    expect(settleSeconds).toBeLessThanOrEqual(1.5)
    const overshoot = (Math.max(...head) - final) / final
    expect(overshoot).toBeGreaterThan(0.02)
    expect(overshoot).toBeLessThan(0.1)
  })

  it('starts a head attitude turn in the neck and lets the head follow with its own response', () => {
    const performer = createBodyPerformer({ traits, seed: 1 })
    const trace = channelTrace(performer, 3, (t) => {
      const input = quietInput(t)
      return { ...input, head: { ...input.head, attitude: { yaw: 0, pitch: t < 0.5 ? 0 : 0.2, roll: 0 } } }
    })
    const neck = trace[c('neckPitch')]
    const head = trace[c('headPitch')]
    const halfway = (values: number[]) => values.findIndex(v => v >= 0.5 * (values.at(-1) ?? 0))
    expect(halfway(neck)).toBeLessThan(halfway(head))
    expect((neck.at(-1) ?? 0) / ((neck.at(-1) ?? 0) + (head.at(-1) ?? 0))).toBeCloseTo(0.35, 2)
  })

  it('moves the pelvis toward the foot named by support after anticipating and settling', () => {
    for (const support of [-1, 1]) {
      const performer = createBodyPerformer({ traits, seed: 1 })
      const trace = channelTrace(performer, 6, t => ({
        ...quietInput(t),
        posture: { amplitude: 0, shiftRate: 0, support: t < 0.5 ? 0 : support },
      }))[c('pelvisX')]
      const settled = trace.at(-1) ?? 0
      expect(settled * support).toBeLessThan(0)
      expect(trace.slice(60, 80).some(x => x * support > 0)).toBe(true)
      expect(Math.max(...trace.map(x => x / settled))).toBeGreaterThan(1)
      expect(Math.abs(trace[trace.length - 120] - settled)).toBeLessThan(Math.abs(settled) / 100)
    }
  })

  it('transfers weight from pelvis through successive torso links with positive lag', () => {
    const performer = createBodyPerformer({ traits, seed: 1 })
    const trace = channelTrace(performer, 5, t => ({
      ...quietInput(t),
      posture: { amplitude: 0, shiftRate: 0, support: t < 0.5 ? 0 : 0.8 },
    }))
    const channels = [trace[c('pelvisX')].map(x => -x), trace[c('lowerRoll')], trace[c('midRoll')], trace[c('upperRoll')]]
    for (let i = 1; i < channels.length; i++) {
      expect(peakSpeed(channels[i])).toBeGreaterThan(peakSpeed(channels[i - 1]))
      expect(lagOf(channels[i - 1], channels[i])).toBeGreaterThan(0)
    }
  })

  it('moves each elbow after its upper arm when the weight shifts', () => {
    for (const support of [-1, 1]) {
      const performer = createBodyPerformer({ traits, seed: 1 })
      const trace = channelTrace(performer, 5, t => ({
        ...quietInput(t),
        posture: { amplitude: 0, shiftRate: 0, support: t < 0.5 ? 0 : support },
      }))
      for (const side of ['left', 'right'] as const)
        expect(peakSpeed(trace[c(`${side}Elbow`)]), `${side} support ${support}`).toBeGreaterThan(peakSpeed(trace[c(`${side}Abduct`)]))
    }
  })

  it('rolls the hips with the lateral sway between weight transfers', () => {
    const performer = createBodyPerformer({ traits, seed: 1 })
    const trace = channelTrace(performer, 60, t => ({ ...quietInput(t), posture: { amplitude: 1, shiftRate: 0, support: 0 } }))
    const pelvis = trace[c('pelvisX')]
    const roll = trace[c('hipsRoll')]
    expect(Math.max(...roll) - Math.min(...roll)).toBeGreaterThan(0.1 * Math.PI / 180)
    // Pelvis toward +X (the left foot) loads the left leg, so the free right hip drops: positive roll.
    expect(lagOf(pelvis, roll)).toBeGreaterThan(0)
  })

  it('has aperiodic sway and moving holds over two minutes', () => {
    const trace = channelTrace(createBodyPerformer({ traits, seed: 1 }), 120, idleInput)
    const sway = trace[c('pelvisZ')]
    const mean = sway.reduce((a, b) => a + b, 0) / sway.length
    const variance = sway.reduce((a, b) => a + (b - mean) ** 2, 0) / sway.length
    expect(variance).toBeGreaterThan(1e-9)
    let maxPeak = -1
    for (let lag = 240; lag <= 3600; lag += 12) {
      let sum = 0
      for (let i = lag; i < sway.length; i++)
        sum += (sway[i] - mean) * (sway[i - lag] - mean)
      maxPeak = Math.max(maxPeak, sum / ((sway.length - lag) * variance))
    }
    expect(maxPeak).toBeLessThan(0.85)
    const x = trace[c('pelvisX')]
    const speed = x.slice(1).map((v, i) => Math.hypot(v - x[i], sway[i + 1] - sway[i]))
    const sorted = [...speed].sort((a, b) => a - b)
    const threshold = sorted[Math.floor(sorted.length * 0.95)] / 10
    const holds = speed.filter(v => v < threshold).length / speed.length
    expect(holds).toBeGreaterThan(0.05)
    expect(holds).toBeLessThan(0.8)
  })

  it('breath travels from the torso through both clavicles and arms', () => {
    const performer = createBodyPerformer({ traits, seed: 1 })
    const trace = channelTrace(performer, 16, t => ({ ...quietInput(t), breath: idleInput(t).breath }))
    for (const name of ['lowerPitch', 'midPitch', 'upperPitch', 'leftClavElev', 'rightClavElev', 'leftAbduct', 'rightAbduct'] as const) {
      const values = trace[c(name)].slice(960)
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.0001)
    }
    expect(lagOf(trace[c('lowerPitch')], trace[c('upperPitch')])).toBeGreaterThan(0)
  })

  it('speech suppresses periodic breath, raises the chest, and inhales once per pause', () => {
    function run(speaking: boolean) {
      const performer = createBodyPerformer({ traits, seed: 1 })
      const trace = channelTrace(performer, 20, (t) => {
        const input = quietInput(t)
        return { ...input, breath: idleInput(t).breath, voice: { ...input.voice, speaking, slow: 0.6 } }
      })
      return trace[c('midPitch')].slice(16 * 120)
    }
    const idle = run(false)
    const speech = run(true)
    const range = (x: number[]) => Math.max(...x) - Math.min(...x)
    expect(range(speech)).toBeLessThan(range(idle))
    expect(speech.reduce((a, b) => a + b, 0)).toBeLessThan(idle.reduce((a, b) => a + b, 0))
    const performer = createBodyPerformer({ traits, seed: 1 })
    let inhales = 0
    for (let i = 0; i < 1200; i++) {
      const input = quietInput(i / 120)
      const slow = i < 360 || i >= 840 ? 0.7 : 0
      inhales = performer.step({ ...input, voice: { ...input.voice, speaking: true, slow } }).diagnostics.inhales
    }
    expect(inhales).toBe(2)
  })

  it('resting arms differ and a torso yaw impulse produces a decaying pendulum', () => {
    const performer = createBodyPerformer({ traits, seed: 7 })
    const rest = performer.restChannels()
    expect(rest[c('leftFlex')]).not.toBe(rest[c('rightFlex')])
    const baseline = createBodyPerformer({ traits, seed: 7 })
    const signal: number[] = []
    for (let i = 0; i < 1200; i++) {
      const input = quietInput(i / 120)
      const channels = new Float32Array(rest.length)
      channels[c('upperYaw')] = i >= 120 && i < 150 ? 0.25 : 0
      const frame = performer.step({ ...input, gait: { mode: 'idle', weight: 1, support: 0, channels } })
      const reference = baseline.step(input)
      signal.push(frame.channels[c('leftFlex')] - reference.channels[c('leftFlex')])
    }
    const tail = signal.slice(160, 600)
    expect(Math.max(...tail)).toBeGreaterThan(0.001)
    expect(Math.min(...tail)).toBeLessThan(-0.001)
    const energy = (a: number[]) => a.reduce((sum, v) => sum + v * v, 0)
    expect(energy(signal.slice(600, 840))).toBeLessThan(energy(signal.slice(180, 420)) / 10)
  })
})
