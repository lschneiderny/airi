import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { Live2DMotionDriver } from './live2d'
import type { Live2DNaturalMotionAttention } from './natural-motion-adapter'
import type { Live2DRigProfile, PhysicsRigLike } from './natural-motion/rig-profile'

import { describe, expect, it, vi } from 'vitest'

import { Emotion } from '../../constants/emotions'
import { Live2DNaturalMotion } from './natural-motion'
import { Live2DNaturalMotionAdapter } from './natural-motion-adapter'
import { mapCursor } from './natural-motion/cursor-attention'
import { readLive2DRigProfile } from './natural-motion/rig-profile'

// Posture fixture ranges: neutral 2, minimum -8, maximum 22.
const command = (normalized: number) => 2 + normalized * (normalized >= 0 ? 20 : 10)
const posture = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamEyeBallX', 'ParamEyeBallY']
// Face fixture ranges as [default, minimum, maximum], shaped like common Cubism rigs.
const face: Record<string, [number, number, number]> = {
  ParamMouthOpenY: [0, 0, 1],
  ParamEyeLOpen: [1, 0, 1],
  ParamEyeROpen: [1, 0, 1],
  ParamBrowLY: [0, -1, 1],
  ParamBrowRY: [0, -1, 1],
  ParamEyeLSmile: [0, 0, 1],
  ParamMouthForm: [-0.5, -1, 1],
  ParamBreath: [0, 0, 1],
  PhysicsOutput: [2, -8, 22],
}

/** Controller output at an adapter active time, seeded like the fixture adapter (`random` = 0.8). */
function natural(activeSeconds: number, cursor: { x: number, y: number } | null = null) {
  return stream(cursor).advance(activeSeconds)
}

/** A reference controller advanced in lockstep with a fixture adapter from active time 0. */
function stream(cursor: { x: number, y: number } | null = null) {
  const motion = new Live2DNaturalMotion({ random: () => 0.8 })
  motion.advance(0)
  motion.setCursor(cursor, 0)
  return motion
}

/** Asserts full Natural ownership of the eight posture channels; eyes follow the controller's compensated eye command. */
function expectNatural(commanded: number[], { pose }: ReturnType<typeof natural>) {
  const expected = [pose.headX, pose.headY, pose.headZ, pose.bodyX, pose.bodyY, pose.bodyZ, pose.eyeX, pose.eyeY]
  expected.forEach((value, index) => expect(commanded[index]).toBeCloseTo(command(value ?? 0), 6))
}

/** One physics setting per `[input, output]` link, in the parsed Cubism shape. */
function physicsRig(links: [string, string][]): PhysicsRigLike {
  return {
    settings: links.map((_, index) => ({ baseInputIndex: index, inputCount: 1, baseOutputIndex: index, outputCount: 1 })),
    inputs: links.map(([source]) => ({ source: { id: source } })),
    outputs: links.map(([, destination]) => ({ destination: { id: destination } })),
  }
}

function fixture({ omit = '', fixed = '', physics, profile: editProfile, restore = true, blush }: {
  omit?: string
  fixed?: string
  physics?: PhysicsRigLike
  profile?: (profile: Live2DRigProfile) => Live2DRigProfile
  /** `false` drops the SDK `loadParameters()` restore, so writes would persist across frames. */
  restore?: boolean
  blush?: { id: string, name: string }
} = {}) {
  const ids = [...posture, ...Object.keys(face), ...blush ? [blush.id] : []].filter(id => id !== omit)
  const range = (id: string) => id === blush?.id ? [0, 0, 1] : face[id] ?? [2, -8, 22]
  const parameters = {
    ids,
    defaultValues: new Float32Array(ids.map(id => range(id)[0])),
    minimumValues: new Float32Array(ids.map(id => id === fixed ? range(id)[0] : range(id)[1])),
    maximumValues: new Float32Array(ids.map(id => id === fixed ? range(id)[0] : range(id)[2])),
  }
  let values = [...parameters.defaultValues]
  const state = {
    driver: 'universal' as Live2DMotionDriver,
    get eligible() { return this.driver === 'natural' },
    set eligible(value: boolean) { this.driver = value ? 'natural' : 'universal' },
    manualActive: false,
    springActive: false,
    exclusive: false,
    performance: { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' } as PerformanceState,
    energy: 0.5,
    voice: { speaking: false, level: 0, speechEndedAtSeconds: null as number | null },
    autoBlink: true,
    manualBreathActive: false,
    clipOwnedIds: new Set<string>() as ReadonlySet<string>,
    pendingEmotions: [] as Live2DNaturalMotionAttention['pendingEmotions'],
    heldEmotion: null as Live2DNaturalMotionAttention['heldEmotion'],
    emotionStrengths: {} as Live2DNaturalMotionAttention['emotionStrengths'],
    cursor: null as { x: number, y: number } | null,
    cursorDismissed: false,
    pendingPokes: [] as Live2DNaturalMotionAttention['pendingPokes'],
    pet: null as { x: number, y: number } | null,
  }
  /** Values the motion update writes every frame, by parameter id. */
  const motion: Record<string, number> = {}
  const visibility = new class extends EventTarget {
    hidden = false
  }()
  let physicsPasses = 0
  let written = new Set<string>()
  const normalInputs: number[] = []
  const syntheticFocusValues = new Map<string, number>()
  const model = {
    coreModel: {
      getParameterValueByIndex: (index: number) => values[index],
      setParameterValueByIndex: (index: number, value: number) => {
        written.add(ids[index])
        values[index] = value
      },
    },
    updateFocus() {
      expect(this).toBe(model)
      for (const id of ['ParamAngleX', 'ParamEyeBallX']) {
        const index = ids.indexOf(id)
        if (index >= 0)
          values[index] += 3
        else
          syntheticFocusValues.set(id, (syntheticFocusValues.get(id) ?? 0) + 3)
      }
    },
  }
  const original = model.updateFocus
  let profile = readLive2DRigProfile(parameters, physics, blush ? { Parameters: [{ Id: blush.id, Name: blush.name }] } : undefined)
  if (editProfile)
    profile = editProfile(profile)
  const adapter = new Live2DNaturalMotionAdapter(model, profile, () => state, visibility, () => 0.8)
  /**
   * Emulates `Cubism4InternalModel.update`: motion update (AIRI final plugins, including
   * `adapter.frame`), `saveParameters`, expression, SDK blink, `updateFocus` (Natural),
   * breath, physics, pose, `beforeModelUpdate`, `model.update`, `loadParameters`.
   * Source: node_modules/pixi-live2d-display/dist/cubism4.es.js.
   */
  function frame(time: number, bear = false) {
    normalInputs.push(values[0])
    values[0] = 6 // beat/manual/clip command, not the previous Natural output
    for (const [id, value] of Object.entries(motion))
      values[ids.indexOf(id)] = value
    adapter.frame(time)
    const saved = [...values]
    written = new Set()
    model.updateFocus()
    const commanded = [...values]
    physicsPasses++
    const body = ids.indexOf('ParamBodyAngleX')
    if (bear && body >= 0)
      values[body] = values[0] * 0.5
    values[ids.indexOf('PhysicsOutput')] = values[0] * 0.25
    const rendered = [...values]
    if (restore)
      values = saved
    return { base: saved, commanded, rendered, written }
  }
  const at = (id: string) => ids.indexOf(id)
  return { ids, at, state, motion, visibility, model, original, adapter, frame, normalInputs, syntheticFocusValues, passes: () => physicsPasses }
}

describe('natural motion adapter', () => {
  it('raises the CDI-resolved blush parameter while petting', () => {
    const f = fixture({ blush: { id: 'CustomBlush', name: 'Blush' } })
    f.state.eligible = true
    f.frame(0)
    expect(f.frame(1).rendered[f.at('CustomBlush')]).toBe(0)
    f.state.pet = { x: 0, y: 0 }
    f.frame(1.01)
    expect(f.frame(3).rendered[f.at('CustomBlush')]).toBeGreaterThan(0)
    f.adapter.dispose()
  })

  it('composes natural input before one physics pass', () => {
    const f = fixture()
    f.state.eligible = true
    f.frame(0)
    const first = f.frame(0.45, true)
    const second = f.frame(0.46, true)
    expectNatural(first.commanded, natural(0.45))
    expectNatural(second.commanded, natural(0.46))
    expect(first.rendered[f.at('ParamBodyAngleX')]).toBe(first.commanded[0] * 0.5)
    expect(first.rendered[f.at('PhysicsOutput')]).toBe(first.commanded[0] * 0.25)
    expect(first.written.has('PhysicsOutput')).toBe(false)
    expect(f.normalInputs).toEqual([2, 6, 6])
    expect(f.passes()).toBe(3)
    f.adapter.dispose()
    expect(f.model.updateFocus).toBe(f.original)
  })

  it('preserves exact legacy output at zero and blends partial ownership', () => {
    const f = fixture()
    expect(f.frame(0).commanded[0]).toBe(9)
    f.state.eligible = true
    expect(f.frame(1).commanded[0]).toBe(9)
    // Half-way through the 0.45 s blend-in, after 0.225 active seconds.
    const half = (9 + command(natural(0.225).pose.headX)) / 2
    expect(f.frame(1.225).commanded[0]).toBeCloseTo(half, 6)
    f.state.eligible = false
    const start = f.frame(1.225).commanded[0]
    expect(start).toBeCloseTo(half, 6)
    expect(f.frame(1.425).commanded[0]).toBe(9)
    expect(f.frame(2).commanded[6]).toBe(5)
    f.adapter.dispose()
  })

  it('blends partial eyes from the compensated controller eye command', () => {
    const f = fixture()
    f.state.eligible = true
    f.state.cursor = { x: -1, y: 0 }
    f.frame(0)
    const result = f.frame(0.225).commanded
    const { pose } = natural(0.225, { x: -1, y: 0 })
    expect(result[0]).toBeCloseTo((9 + command(pose.headX)) / 2, 6)
    expect(result[6]).toBeCloseTo((5 + command(pose.eyeX)) / 2, 6)
    f.adapter.dispose()
  })

  it('drives ParamEyeBallX from pose.eyeX, not from fixation minus head', () => {
    const f = fixture()
    f.state.eligible = true
    f.state.cursor = { x: 1, y: -1 }
    f.frame(0)
    const reference = stream({ x: 1, y: -1 })
    let headDiffers = false
    for (let index = 1; index <= 300; index++) {
      const time = 0.45 + index / 60
      const { commanded } = f.frame(time)
      const { pose, fixation } = reference.advance(time)
      expect(commanded[f.at('ParamEyeBallX')]).toBeCloseTo(command(pose.eyeX), 6)
      expect(commanded[f.at('ParamEyeBallY')]).toBeCloseTo(command(pose.eyeY), 6)
      headDiffers ||= Math.abs(pose.eyeX - Math.max(-0.95, Math.min(0.95, fixation.x - pose.headX))) > 1e-3
    }
    // The v1 path would differ: the facade compensates only part of the head turn.
    expect(headDiffers).toBe(true)
    f.adapter.dispose()
  })

  it('releases ownership across interruption and model replacement', () => {
    const f = fixture()
    f.state.eligible = true
    f.frame(0)
    f.frame(0.2)
    for (let index = 1; index <= 20; index++) {
      const time = 0.2 + index * 0.01
      const before = f.frame(time).commanded
      f.state.eligible = !f.state.eligible
      const after = f.frame(time).commanded
      after.slice(0, posture.length).forEach((value, axis) => expect(value).toBeCloseTo(before[axis], 10))
    }
    f.state.eligible = false
    f.frame(0.4)
    expect(f.frame(0.6).commanded[0]).toBe(9)
    f.adapter.dispose()
    f.adapter.dispose()
    expect(f.model.updateFocus).toBe(f.original)
    const replacement = fixture()
    expect(replacement.frame(100).commanded[0]).toBe(9)
    replacement.adapter.dispose()
  })

  it('pauses active time for renderer pause and hidden visibility', () => {
    const f = fixture()
    f.state.eligible = true
    f.state.cursor = { x: 1, y: -1 }
    f.frame(0)
    const before = f.frame(0.6).commanded
    f.adapter.setPaused(true)
    f.adapter.setPaused(false)
    expect(f.frame(100).commanded).toEqual(before)
    f.visibility.hidden = true
    f.visibility.dispatchEvent(new Event('visibilitychange'))
    f.visibility.hidden = false
    f.visibility.dispatchEvent(new Event('visibilitychange'))
    expect(f.frame(200).commanded).toEqual(before)
    f.adapter.dispose()
    // Disposed visibility changes cannot leave a wrapper on the old model.
    f.visibility.dispatchEvent(new Event('visibilitychange'))
    expect(f.model.updateFocus).toBe(f.original)
  })

  it('preserves cursor distance, reversal, expiry, and asymmetric bounds', () => {
    const center = fixture()
    const near = fixture()
    const far = fixture()
    for (const f of [center, near, far]) {
      f.state.eligible = true
      f.frame(0)
    }
    center.state.cursor = { x: 0, y: 0 }
    near.state.cursor = { x: 0.25, y: 0 }
    far.state.cursor = { x: 1, y: 0 }
    for (const f of [center, near, far])
      f.frame(0)
    const normalize = (value: number) => (value - 2) / (value >= 2 ? 20 : 10)
    const c = center.frame(1).commanded
    expect(c[0]).toBeCloseTo(command(natural(1, { x: 0, y: 0 }).pose.headX), 6)
    const n = near.frame(1).commanded
    const full = far.frame(1).commanded
    // Equal seeds share autonomous motion, so the cursor bias is the only difference.
    const ratio = mapCursor({ x: 0.25, y: 0 }).head.x / mapCursor({ x: 1, y: 0 }).head.x
    expect(normalize(n[0]) - normalize(c[0])).toBeCloseTo((normalize(full[0]) - normalize(c[0])) * ratio)
    far.state.cursor = { x: -1, y: 1 }
    expect(far.frame(1).commanded).toEqual(full)
    for (let index = 1; index <= 100; index++) {
      const result = far.frame(1 + index / 60).commanded
      result.slice(0, 8).forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(-8)
        expect(value).toBeLessThanOrEqual(22)
      })
      expect(result[6]).toBeGreaterThanOrEqual(-7.5)
      expect(result[6]).toBeLessThanOrEqual(21)
    }
    far.state.cursor = null
    const expiry = far.frame(3).commanded
    expect(far.frame(3.01).commanded[0]).not.toBe(2)
    expect(expiry.every(Number.isFinite)).toBe(true)
    for (const f of [center, near, far])
      f.adapter.dispose()
  })

  it('skips missing IDs and zero width ranges without synthetic indices', () => {
    const f = fixture({ omit: 'ParamAngleY', fixed: 'ParamBodyAngleZ' })
    f.state.eligible = true
    f.state.cursor = { x: -1, y: -1 }
    f.frame(0)
    const { commanded, written } = f.frame(1)
    expect(f.ids).not.toContain('ParamAngleY')
    expect(commanded[f.at('ParamBodyAngleZ')]).toBe(2)
    expect(written.has('ParamBodyAngleZ')).toBe(false)
    expect(commanded.every(Number.isFinite)).toBe(true)
    expect(commanded[0]).toBeLessThan(2)
    f.adapter.dispose()
  })

  it('leaves missing SDK focus parameters untouched at full Natural ownership', () => {
    const f = fixture({ omit: 'ParamAngleX' })
    f.state.eligible = true
    f.frame(0)
    expect(f.syntheticFocusValues.get('ParamAngleX')).toBe(3)
    f.frame(0.45)
    expect(f.syntheticFocusValues.get('ParamAngleX')).toBe(3)
    f.adapter.dispose()
  })

  it('preserves manual release and rapid mode transitions', () => {
    const f = fixture()
    f.state.eligible = true
    f.frame(0)
    f.frame(0.45)
    f.state.manualActive = true
    f.frame(0.5)
    const manual = f.frame(0.7)
    expect(manual.commanded[0]).toBe(9)
    // Manual control releases posture only; blink and breath keep running.
    expect(manual.written.has('ParamAngleX')).toBe(false)
    expect(manual.written.has('ParamEyeLOpen')).toBe(true)
    expect(manual.written.has('ParamBreath')).toBe(true)
    f.state.manualActive = false
    f.state.springActive = true
    expect(f.frame(1).commanded[0]).toBe(9)
    f.state.springActive = false
    f.state.exclusive = true
    const exclusive = f.frame(2)
    expect(exclusive.commanded[0]).toBe(9)
    expect(f.frame(2.5).written.size).toBe(0)
    f.state.exclusive = false
    f.state.driver = 'magic'
    expect(f.frame(3).commanded[0]).toBe(9)
    expect(f.frame(3.5).written.size).toBe(0)
    f.state.driver = 'natural'
    f.frame(4)
    // The controller ran through manual and spring control and froze from 2 s (exclusive) to 4 s.
    expect(f.frame(4.45).commanded[0]).toBeCloseTo(command(natural(2.45).pose.headX), 6)
    f.adapter.dispose()
  })

  it('(a) never writes physics-derived body axes on a Bear-like rig', () => {
    const bear = fixture({ physics: physicsRig([['ParamAngleX', 'ParamBodyAngleX']]) })
    const all = fixture({ physics: physicsRig([['ParamAngleX', 'ParamBodyAngleX'], ['ParamAngleY', 'ParamBodyAngleY'], ['ParamAngleZ', 'ParamBodyAngleZ']]) })
    // Null axes are skipped even when the profile does not list them as physics outputs.
    const nullOnly = fixture({
      physics: physicsRig([['ParamAngleX', 'ParamBodyAngleX'], ['ParamAngleY', 'ParamBodyAngleY'], ['ParamAngleZ', 'ParamBodyAngleZ']]),
      profile: profile => ({ ...profile, physicsOutputs: new Set() }),
    })
    for (const f of [bear, all, nullOnly]) {
      f.state.eligible = true
      f.frame(0)
    }
    for (let index = 1; index <= 120; index++) {
      const time = index / 60
      const b = bear.frame(time, true)
      expect(b.written.has('ParamBodyAngleX')).toBe(false)
      expect(b.written.has('ParamBodyAngleY')).toBe(true)
      expect(b.written.has('ParamBodyAngleZ')).toBe(true)
      expect(b.written.has('ParamAngleX')).toBe(true)
      for (const f of [all, nullOnly]) {
        const { written } = f.frame(time, true)
        for (const id of ['ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ'])
          expect(written.has(id)).toBe(false)
        expect(written.has('ParamAngleY')).toBe(true)
      }
    }
    for (const f of [bear, all, nullOnly])
      f.adapter.dispose()
  })

  it('counts body writes and physics skips for the lab trace metadata', () => {
    const bear = fixture({ physics: physicsRig([['ParamAngleX', 'ParamBodyAngleX'], ['ParamAngleY', 'ParamBodyAngleY'], ['ParamAngleZ', 'ParamBodyAngleZ']]) })
    const free = fixture()
    for (const f of [bear, free]) {
      f.state.eligible = true
      f.frame(0)
      f.adapter.resetDiagnostics()
      for (let index = 1; index <= 60; index++)
        f.frame(1 + index / 60, true)
    }
    expect(bear.adapter.diagnostics.frames).toBe(60)
    expect(bear.adapter.diagnostics.bodyWrites).toBe(0)
    // Three body axes per composition are left to physics.
    expect(bear.adapter.diagnostics.physicsOutputSkips).toBe(180)
    expect(bear.adapter.diagnostics.weightMean).toBe(1)
    expect(bear.adapter.diagnostics.home).toBe('product')
    expect(free.adapter.diagnostics.bodyWrites).toBe(180)
    expect(free.adapter.diagnostics.physicsOutputSkips).toBe(0)
    free.adapter.resetDiagnostics()
    expect(free.adapter.diagnostics).toEqual({ home: 'product', frames: 0, weightMean: 0, bodyWrites: 0, physicsOutputSkips: 0 })
    for (const f of [bear, free])
      f.adapter.dispose()
  })

  it('(b) never writes a brow that is a physics output', () => {
    const f = fixture({ physics: physicsRig([['ParamAngleX', 'ParamBrowLY']]) })
    f.state.eligible = true
    f.frame(0)
    for (let index = 1; index <= 120; index++) {
      const { written } = f.frame(index / 60)
      expect(written.has('ParamBrowLY')).toBe(false)
      expect(written.has('ParamBrowRY')).toBe(true)
    }
    f.adapter.dispose()
  })

  it('(c) keeps a 10% residual on a clip-owned head axis and full Natural eyes', () => {
    const f = fixture()
    const free = fixture()
    for (const g of [f, free]) {
      g.state.eligible = true
      g.frame(0)
    }
    // A clip starting mid-blend neither suspends the controller nor changes the posture weight.
    f.state.clipOwnedIds = new Set(['ParamAngleX', 'ParamEyeLOpen'])
    const partial = f.frame(0.2)
    expect(partial.commanded[f.at('ParamAngleY')]).toBe(free.frame(0.2).commanded[f.at('ParamAngleY')])
    for (let index = 0; index <= 60; index++) {
      const time = 0.45 + index / 60
      const { base, commanded, written } = f.frame(time)
      const unmasked = free.frame(time).commanded
      const { pose } = natural(time)
      const naturalDelta = command(pose.headX) - 2
      const angle = f.at('ParamAngleX')
      expect(commanded[angle] - base[angle]).toBeCloseTo(0.1 * naturalDelta, 6)
      expect(Math.abs(commanded[angle] - base[angle])).toBeLessThanOrEqual(0.1 * Math.abs(naturalDelta) + 1e-9)
      expect(commanded[f.at('ParamEyeBallX')]).toBeCloseTo(command(pose.eyeX), 6)
      expect(commanded[f.at('ParamEyeBallX')]).toBe(unmasked[f.at('ParamEyeBallX')])
      expect(commanded[f.at('ParamAngleY')]).toBe(unmasked[f.at('ParamAngleY')])
      expect(written.has('ParamEyeLOpen')).toBe(false)
      expect(written.has('ParamEyeROpen')).toBe(true)
    }
    f.state.clipOwnedIds = new Set()
    expect(f.frame(1.5).commanded[0]).toBe(free.frame(1.5).commanded[0])
    f.adapter.dispose()
    free.adapter.dispose()
  })

  it('(d) never writes the mouth while speaking or within 0.7 s after speech', () => {
    const f = fixture()
    f.state.eligible = true
    let silentOpenings = 0
    for (let index = 0; index <= 400 * 30; index++) {
      const time = index / 30
      const speaking = time % 20 < 6
      if (f.state.voice.speaking && !speaking)
        f.state.voice.speechEndedAtSeconds = time
      f.state.voice.speaking = speaking
      f.state.voice.level = speaking ? 0.5 : 0
      const { base, commanded, written } = f.frame(time)
      const ended = f.state.voice.speechEndedAtSeconds
      const mouth = f.at('ParamMouthOpenY')
      if (speaking || (ended !== null && time - ended <= 0.7))
        expect(written.has('ParamMouthOpenY')).toBe(false)
      else if (commanded[mouth] > base[mouth])
        silentOpenings++
    }
    // The schedule leaves silence long enough for the 1/40 s opening rate to show.
    expect(silentOpenings).toBeGreaterThan(0)
    f.adapter.dispose()
  })

  it('(e) leaves ParamBreath untouched while manual breath is active', () => {
    const f = fixture()
    f.state.eligible = true
    f.state.manualBreathActive = true
    f.frame(0)
    for (let index = 1; index <= 60; index++)
      expect(f.frame(index / 60).written.has('ParamBreath')).toBe(false)
    f.state.manualBreathActive = false
    const { commanded, written } = f.frame(1.5)
    expect(written.has('ParamBreath')).toBe(true)
    expect(commanded[f.at('ParamBreath')]).toBeCloseTo(natural(1.5).breath.value, 6)
    f.adapter.dispose()
  })

  it('(f) keeps eyelids in their first-frame range over 600 frames of the SDK save/load bracket', () => {
    const run = (restore: boolean) => {
      const f = fixture({ restore })
      f.state.eligible = true
      // Nothing writes the lids during the motion update, so the base comes only from load.
      const reference = stream()
      const open: number[] = []
      let minimumBase = 1
      for (let index = 0; index < 600; index++) {
        const time = index / 60
        const { base, commanded } = f.frame(time)
        const lid = f.at('ParamEyeLOpen')
        minimumBase = Math.min(minimumBase, base[lid])
        if (reference.advance(time).blink.blinkFactor === 1)
          open.push(commanded[lid])
      }
      f.adapter.dispose()
      return { open, minimumBase }
    }
    const bracketed = run(true)
    expect(bracketed.minimumBase).toBe(1)
    const [first] = bracketed.open
    expect(first).toBeGreaterThanOrEqual(0.85)
    for (const value of bracketed.open) {
      expect(value).toBeGreaterThanOrEqual(0.85)
      expect(value).toBeLessThanOrEqual(1)
    }
    // Without the restore the same overlay compounds, so the bracket is what keeps it stateless.
    expect(run(false).minimumBase).toBeLessThan(0.5)
  })

  it('(g) keeps open lids at or above 0.2 and closes them fully in a blink', () => {
    const f = fixture()
    f.state.eligible = true
    f.motion.ParamEyeLOpen = 1
    const reference = stream()
    let deepest = { blinkFactor: 1, lid: 1 }
    for (let index = 0; index <= 15 * 120; index++) {
      const time = index / 120
      const lid = f.frame(time).commanded[f.at('ParamEyeLOpen')]
      const { blinkFactor } = reference.advance(time).blink
      if (blinkFactor === 1)
        expect(lid).toBeGreaterThanOrEqual(0.2)
      if (blinkFactor < deepest.blinkFactor)
        deepest = { blinkFactor, lid }
    }
    // The 120 Hz grid samples the closed end of a blink.
    expect(deepest.blinkFactor).toBeLessThanOrEqual(0.01)
    expect(deepest.lid).toBeLessThanOrEqual(0.05)
    f.adapter.dispose()
  })

  it('(g2) keeps expression-closed lids exactly 0 under a surprised hint', () => {
    const f = fixture()
    f.state.eligible = true
    f.motion.ParamEyeLOpen = 0
    f.motion.ParamEyeROpen = 0
    const episode = { id: 'surprise', emotion: Emotion.Surprise, nominal: 1, intensity: 1, band: 'clear' as const, escalation: false }
    f.state.pendingEmotions.push(episode)
    const reference = stream()
    reference.impulse(episode, 0)
    let peakHint = 0
    for (let index = 0; index <= 3 * 120; index++) {
      const time = index / 120
      const { commanded } = f.frame(time)
      peakHint = Math.max(peakHint, reference.advance(time).face.eyeOpenHint)
      expect(commanded[f.at('ParamEyeLOpen')]).toBe(0)
      expect(commanded[f.at('ParamEyeROpen')]).toBe(0)
    }
    // The +0.15 Surprise hint rides an impulse envelope; its sampled peak is clearly active.
    expect(peakHint).toBeGreaterThan(0.1)
    f.adapter.dispose()
  })

  it('(h) drains pending emotions exactly once', () => {
    const impulse = vi.spyOn(Live2DNaturalMotion.prototype, 'impulse')
    try {
      const f = fixture()
      const episode = { id: 'happy', emotion: Emotion.Happy, nominal: 0.5, intensity: 0.5, band: 'clear' as const, escalation: false }
      f.state.pendingEmotions.push(episode)
      // Emotions queued while Natural is inactive are dropped, not replayed on resume.
      f.frame(0)
      expect(f.state.pendingEmotions).toHaveLength(0)
      expect(impulse).not.toHaveBeenCalled()
      f.state.eligible = true
      f.state.pendingEmotions.push(episode)
      f.frame(0.1)
      expect(f.state.pendingEmotions).toHaveLength(0)
      expect(impulse).toHaveBeenCalledTimes(1)
      expect(impulse).toHaveBeenCalledWith(episode, 0.1)
      f.frame(0.2)
      f.frame(0.3)
      expect(impulse).toHaveBeenCalledTimes(1)
      f.adapter.dispose()
    }
    finally {
      impulse.mockRestore()
    }
  })

  it('(h2) leaves no held face from a hold set while Natural was inactive', () => {
    // The inactive gating itself is unobservable here: a suspended controller does not step, so a
    // forwarded hold would also leave the frames unchanged. This pins the observable outcome only.
    const held = { emotion: Emotion.Sad, strength: 1 }
    const times = Array.from({ length: 30 }, (_, index) => 1 + index * 0.1)
    const run = (holdWhileInactive: boolean, holdWhileActive: boolean) => {
      const f = fixture()
      f.state.heldEmotion = holdWhileInactive ? held : null
      for (const time of [0, 0.5])
        f.frame(time)
      f.state.eligible = true
      f.state.heldEmotion = holdWhileActive ? held : null
      const frames = times.map(time => f.frame(time).commanded)
      f.adapter.dispose()
      return frames
    }

    const control = run(false, false)
    expect(run(true, false)).toEqual(control)
    // The same hold, once Natural is active, shows on the face.
    expect(run(false, true)).not.toEqual(control)
  })

  it('(h3) keeps one brow side and a monotonic onset while the same hold is forwarded every frame', () => {
    const f = fixture()
    f.state.eligible = true
    // Think raises one brow on a side the hold layer picks once; a restart would reroll it.
    const asymmetry = Array.from({ length: 90 }, (_, index) => {
      f.state.heldEmotion = { emotion: Emotion.Think, strength: 1 }
      const { commanded } = f.frame(index / 60)
      return commanded[f.at('ParamBrowLY')] - commanded[f.at('ParamBrowRY')]
    })
    f.adapter.dispose()

    const start = asymmetry.findIndex(value => value !== 0)
    expect(start).toBeGreaterThanOrEqual(0)
    const shown = asymmetry.slice(start)
    expect(shown.every(value => Math.sign(value) === Math.sign(shown[0]))).toBe(true)
    expect(shown.every((value, index) => index === 0 || Math.abs(value) >= Math.abs(shown[index - 1]) - 1e-9)).toBe(true)
    // The onset has a visible size by the end, so the checks above are not about zeros.
    expect(Math.abs(shown.at(-1) ?? 0)).toBeGreaterThan(0.05)
  })

  it('(h3b) clamps the smile to its parameter range when hold, impulse, and laugh hints stack', () => {
    const f = fixture()
    f.state.eligible = true
    f.frame(0)
    f.state.pendingEmotions.push({ id: 'happy', emotion: Emotion.Happy, nominal: 1, intensity: 1, band: 'strong' as const, escalation: false })
    const smile = Array.from({ length: 4 * 120 }, (_, index) => {
      f.state.heldEmotion = { emotion: Emotion.Happy, strength: 1 }
      const { commanded } = f.frame(0.01 + index / 120)
      return commanded[f.at('ParamEyeLSmile')]
    })
    f.adapter.dispose()
    // The stacked hints exceed the half-range gain, so the written value sits on the maximum.
    expect(Math.max(...smile)).toBe(1)
    expect(Math.min(...smile)).toBeGreaterThanOrEqual(0)
  })

  it('(h4) drops an emotion queued on one frame when its model strength turns to zero before the next', () => {
    const episode = { id: 'happy', emotion: Emotion.Happy, nominal: 1, intensity: 1, band: 'strong' as const, escalation: false }
    const times = Array.from({ length: 60 }, (_, index) => index * 0.1)
    /** Frame 1 queues the emotion; `strengthAtNext` applies from frame 2, the first frame that can start it. */
    const run = (queued: boolean, strengthAtNext?: number) => {
      const f = fixture()
      f.state.eligible = true
      const frames = times.map((time, index) => {
        if (queued && index === 1)
          f.state.pendingEmotions.push(episode)
        if (queued && index === 2 && strengthAtNext !== undefined)
          f.state.emotionStrengths = { happy: strengthAtNext }
        return f.frame(time).commanded
      })
      const mood = f.adapter.mood
      f.adapter.dispose()
      return { frames, mood }
    }

    const control = run(false)
    const zeroed = run(true, 0)
    expect(zeroed.frames).toEqual(control.frames)
    expect(zeroed.mood).toEqual(control.mood)
    // The same emotion at full strength does act, so the comparison above can fail.
    const performed = run(true, 1)
    expect(performed.frames).not.toEqual(control.frames)
    expect(performed.mood).not.toEqual(control.mood)
  })

  it('(i) drains pokes exactly once and forwards a pet only while Natural is active', () => {
    const poke = vi.spyOn(Live2DNaturalMotion.prototype, 'poke')
    const setPet = vi.spyOn(Live2DNaturalMotion.prototype, 'setPet')
    try {
      const f = fixture()
      f.state.pendingPokes.push({ region: 'head', x: 0.5, y: -0.25 })
      f.state.pet = { x: 0.2, y: -0.4 }
      // Touch from while Natural is inactive is dropped, not replayed on resume.
      f.frame(0)
      expect(f.state.pendingPokes).toHaveLength(0)
      expect(poke).not.toHaveBeenCalled()
      expect(setPet).toHaveBeenLastCalledWith(null, 0)
      f.state.eligible = true
      f.state.pendingPokes.push({ region: 'body', x: -1, y: 0.5 })
      f.frame(0.1)
      expect(f.state.pendingPokes).toHaveLength(0)
      expect(poke).toHaveBeenCalledTimes(1)
      expect(poke).toHaveBeenCalledWith('body', -1, 0.5, 0.1)
      expect(setPet).toHaveBeenLastCalledWith({ x: 0.2, y: -0.4 }, 0.1)
      f.frame(0.2)
      expect(poke).toHaveBeenCalledTimes(1)
      f.adapter.dispose()
    }
    finally {
      poke.mockRestore()
      setPet.mockRestore()
    }
  })
})
