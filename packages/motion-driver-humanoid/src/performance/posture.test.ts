import type { BodyPerformanceInput } from './contracts'

import { describe, expect, it } from 'vitest'

import { BodyBreath } from './breath'
import { BODY_CHANNELS, channelIndex, DEG } from './channels'
import { createBodyPerformer } from './index'
import { channelTrace, fixtureRigs, idleInput, lagOf, peakSpeed, quietInput } from './performance.test-fixtures'
import { BodyPosture } from './posture'

const traits = fixtureRigs[0].traits
const c = channelIndex

describe('posture performance', () => {
  it('lets the idle head wander a few degrees, and holds it steadier on a sustained target', () => {
    const wander = (kind: 'free' | 'sustained') => {
      const performer = createBodyPerformer({ traits, seed: 1 })
      const trace = channelTrace(performer, 120, t => ({ ...idleInput(t), gaze: { ...idleInput(t).gaze, kind } }))
      const yaw = trace[c('neckYaw')].map((v, i) => (v + trace[c('headYaw')][i]) * 180 / Math.PI).slice(1200)
      const mean = yaw.reduce((s, v) => s + v, 0) / yaw.length
      return Math.sqrt(yaw.reduce((s, v) => s + (v - mean) ** 2, 0) / yaw.length)
    }
    const free = wander('free')
    expect(free).toBeGreaterThan(1.5)
    expect(free).toBeLessThan(6)
    expect(wander('sustained')).toBeLessThan(0.5 * free)
  })

  it('steadies the head against a weight shift: about 0.4 of the trunk roll and 0.5 of its yaw remain at the head', () => {
    const performer = createBodyPerformer({ traits, seed: 1 })
    const trace = channelTrace(performer, 6, t => ({ ...quietInput(t), posture: { amplitude: 0, shiftRate: 0, support: t < 0.5 ? 0 : 1 } }))
    const end = (name: Parameters<typeof c>[0]) => trace[c(name)].at(-1) ?? 0
    const trunkRoll = end('lowerRoll') + end('midRoll') + end('upperRoll')
    const trunkYaw = end('lowerYaw') + end('midYaw') + end('upperYaw')
    expect((trunkRoll + end('neckRoll') + end('headRoll')) / trunkRoll).toBeCloseTo(0.4, 1)
    expect((trunkYaw + end('neckYaw') + end('headYaw')) / trunkYaw).toBeCloseTo(0.5, 1)
  })

  it('steadies the head against breathing: about 0.4 of the trunk pitch remains at the head', () => {
    const performer = createBodyPerformer({ traits, seed: 1 })
    const trace = channelTrace(performer, 12, t => ({ ...quietInput(t), breath: { ...quietInput(t).breath, scale: 1 } }))
    const trunk = trace[c('lowerPitch')].map((v, i) => v + trace[c('midPitch')][i] + trace[c('upperPitch')][i])
    const head = trunk.map((v, i) => v + trace[c('neckPitch')][i] + trace[c('headPitch')][i])
    const range = (values: number[]) => Math.max(...values.slice(600)) - Math.min(...values.slice(600))
    expect(range(head) / range(trunk)).toBeGreaterThan(0.3)
    expect(range(head) / range(trunk)).toBeLessThan(0.5)
  })

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

  it('moves the trunk\'s share of the head intent without a step when the gaze kind changes', () => {
    const share = { free: 1, sustained: 0.6 }
    for (const [from, to] of [['free', 'sustained'], ['sustained', 'free']] as const) {
      const performer = createBodyPerformer({ traits, seed: 1 })
      const trace = channelTrace(performer, 6, (t) => {
        const input = quietInput(t)
        return { ...input, head: { ...input.head, slow: { ...input.head.slow, yaw: 9 * DEG } }, gaze: { ...input.gaze, kind: t < 3 ? from : to } }
      })
      const trunk = trace[c('lowerYaw')].map((v, i) => v + trace[c('midYaw')][i] + trace[c('upperYaw')][i])
      const steps = trunk.slice(359).map((v, i, values) => i === 0 ? 0 : Math.abs(v - values[i - 1]))
      expect(Math.max(...steps.slice(0, 4)), `${from} to ${to} starts from rest`).toBeLessThan(0.01 * DEG)
      expect(Math.max(...steps), `${from} to ${to}`).toBeLessThan(0.05 * DEG)
      expect((trunk.at(-1) ?? 0) / trunk[359]).toBeCloseTo(share[to] / share[from], 2)
    }
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

describe('posture and breath hooks for the performance layers', () => {
  type Hooks = Partial<Pick<BodyPosture, 'suppressHeadCue' | 'tempo' | 'amplitude'>>
  const run = (hooks: Hooks, seconds: number, script: (t: number) => BodyPerformanceInput = idleInput) => {
    const posture = Object.assign(new BodyPosture(traits, 1), hooks)
    const trace: { channels: Float64Array, target: number }[] = []
    for (let tick = 0; tick < seconds * 120; tick++) {
      const out = new Float64Array(BODY_CHANNELS.length)
      posture.step(script(tick / 120), out)
      trace.push({ channels: out, target: posture.target })
    }
    return trace
  }

  it('drops Natural\'s head cue from the accent while the cue layer plays the cue, and keeps the other accents', () => {
    const cue = (t: number) => {
      const input = idleInput(t)
      return { ...input, head: { ...input.head, terms: { ...input.head.terms, cue: { yaw: 0, pitch: 0.1, roll: 0 }, emphasis: { yaw: 0.02, pitch: 0, roll: 0 } } } }
    }
    const noCue = (t: number) => {
      const input = cue(t)
      return { ...input, head: { ...input.head, terms: { ...input.head.terms, cue: { yaw: 0, pitch: 0, roll: 0 } } } }
    }
    const suppressed = run({ suppressHeadCue: true }, 2, cue)
    expect(suppressed.map(f => [...f.channels])).toEqual(run({}, 2, noCue).map(f => [...f.channels]))
    expect(run({}, 2, cue).at(-1)?.channels[c('headPitch')]).toBeGreaterThan((suppressed.at(-1)?.channels[c('headPitch')] ?? 0) + 2 * DEG)
  })

  it('scales sway by the emotion amplitude and the shift rate by its tempo, and is exact at 1', () => {
    const neutral = run({ tempo: 1, amplitude: 1 }, 30)
    expect(neutral.map(f => [...f.channels])).toEqual(run({}, 30).map(f => [...f.channels]))
    const half = run({ amplitude: 0.5 }, 30)
    const sway = (trace: typeof neutral) => Math.max(...trace.map(f => Math.abs(f.channels[c('lowerYaw')])))
    expect(sway(half) / sway(neutral)).toBeCloseTo(0.5, 6)
    const firstShift = (trace: typeof neutral) => trace.findIndex(f => f.target !== trace[0].target)
    expect(firstShift(run({ tempo: 2 }, 30)) / firstShift(neutral)).toBeCloseTo(0.5, 1)
  })

  it('scales the breath by the emotion\'s depth and sighs one inhale 1.4 times a phrase inhale', () => {
    const breathe = (depth: number, sigh: boolean) => {
      const breath = new BodyBreath()
      breath.depth = depth
      return Array.from({ length: 360 }, (_, tick) => {
        if (sigh && tick === 12)
          breath.sigh()
        const out = new Float64Array(BODY_CHANNELS.length)
        breath.step({ ...quietInput(), breath: { phase: 0, period: 4, scale: 1 } }, out)
        return out[c('lowerPitch')]
      })
    }
    const base = breathe(1, false)
    breathe(0.5, false).forEach((v, i) => expect(v).toBeCloseTo(0.5 * base[i], 12))
    const sighed = breathe(1, true)
    const extension = Math.max(...sighed.map((v, i) => base[i] - v))
    expect(extension / (0.6 * DEG)).toBeCloseTo(1.4 * 0.7, 2)
    expect(Math.abs(sighed[359] - base[359])).toBeLessThan(0.5 * extension)
  })
})
