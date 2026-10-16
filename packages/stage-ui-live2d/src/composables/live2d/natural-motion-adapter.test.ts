import type { Live2DMotionDriver } from './live2d'

import { describe, expect, it } from 'vitest'

import { Live2DNaturalMotionAdapter } from './natural-motion-adapter'

function fixture(omit = '', fixed = '') {
  const ids = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleY', 'ParamBodyAngleZ', 'ParamEyeBallX', 'ParamEyeBallY', 'ParamMouthOpenY', 'ParamEyeLOpen', 'PhysicsOutput'].filter(id => id !== omit)
  const parameters = {
    ids,
    defaultValues: new Float32Array(ids.map(() => 2)),
    minimumValues: new Float32Array(ids.map(id => id === fixed ? 2 : -8)),
    maximumValues: new Float32Array(ids.map(id => id === fixed ? 2 : 22)),
  }
  let values = [...parameters.defaultValues]
  const state = {
    driver: 'universal' as Live2DMotionDriver,
    get eligible() { return this.driver === 'natural' },
    set eligible(value: boolean) { this.driver = value ? 'natural' : 'universal' },
    manualActive: false,
    springActive: false,
    exclusive: false,
    motion: { group: undefined as string | undefined, idleGroup: 'Idle', selectedIdleGroup: 'SavedIdle', priority: 0 },
    cursor: null as { x: number, y: number } | null,
  }
  const visibility = new class extends EventTarget {
    hidden = false
  }()
  let physics = 0
  const normalInputs: number[] = []
  const model = {
    coreModel: {
      getParameterValueByIndex: (index: number) => values[index],
      setParameterValueByIndex: (index: number, value: number) => { values[index] = value },
    },
    updateFocus() {
      expect(this).toBe(model)
      for (const id of ['ParamAngleX', 'ParamEyeBallX']) {
        const index = ids.indexOf(id)
        if (index >= 0)
          values[index] += 3
      }
    },
  }
  const original = model.updateFocus
  const adapter = new Live2DNaturalMotionAdapter(model, parameters, () => state, visibility, () => 0.8)
  function frame(time: number, bear = false) {
    // SDK order: normal motion/final plugins, save, focus, physics, draw, restore.
    normalInputs.push(values[0])
    values[0] = 6 // beat/manual/clip command, not the previous Natural output
    adapter.frame(time)
    const saved = [...values]
    model.updateFocus()
    const commanded = [...values]
    physics++
    const body = ids.indexOf('ParamBodyAngleX')
    if (bear && body >= 0)
      values[body] = values[0] * 0.5
    values[ids.indexOf('PhysicsOutput')] = values[0] * 0.25
    const rendered = [...values]
    values = saved
    return { commanded, rendered }
  }
  return { ids, state, visibility, model, original, adapter, frame, normalInputs, passes: () => physics }
}

describe('natural motion adapter', () => {
  it('composes natural input before one physics pass', () => {
    const f = fixture()
    f.state.eligible = true
    f.frame(0)
    const first = f.frame(0.45, true)
    const second = f.frame(0.46, true)
    expect(first.commanded.slice(0, 8)).toEqual(Array.from<number>({ length: 8 }).fill(2))
    expect(second.commanded.slice(0, 8)).toEqual(first.commanded.slice(0, 8))
    expect(first.rendered[3]).toBe(1)
    expect(first.rendered[10]).toBe(0.5)
    expect(first.commanded[8]).toBe(2)
    expect(first.commanded[9]).toBe(2)
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
    expect(f.frame(1.225).commanded[0]).toBeCloseTo(5.5)
    f.state.eligible = false
    const start = f.frame(1.225).commanded[0]
    expect(start).toBeCloseTo(5.5)
    expect(f.frame(1.425).commanded[0]).toBe(9)
    expect(f.frame(2).commanded[6]).toBe(5)
    f.adapter.dispose()
  })

  it('compensates partial eyes from the actual asymmetric blended head', () => {
    const f = fixture()
    f.state.eligible = true
    f.state.cursor = { x: -1, y: 0 }
    f.frame(0)
    const result = f.frame(0.225).commanded
    const head = -0.25 * (1 - (1 + 0.225 / 0.14) * Math.exp(-0.225 / 0.14))
    const fixation = -0.65 * (1 - (1 + 0.225 / 0.024) * Math.exp(-0.225 / 0.024))
    const blendedHead = (9 + 2 + head * 10) / 2
    const normalizedHead = (blendedHead - 2) / 20
    const eyes = Math.max(-0.95, fixation - normalizedHead)
    expect(result[0]).toBeCloseTo(blendedHead, 10)
    expect(result[6]).toBeCloseTo((5 + 2 + eyes * 10) / 2, 10)
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
      after.forEach((value, axis) => expect(value).toBeCloseTo(before[axis], 10))
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
    expect(center.frame(1).commanded[0]).toBe(2)
    const n = near.frame(1).commanded
    const full = far.frame(1).commanded
    expect(n[0] - 2).toBeCloseTo((full[0] - 2) * 0.25)
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
    const f = fixture('ParamAngleY', 'ParamBodyAngleZ')
    f.state.eligible = true
    f.state.cursor = { x: -1, y: -1 }
    f.frame(0)
    const { commanded } = f.frame(1)
    expect(f.ids).not.toContain('ParamAngleY')
    expect(commanded[f.ids.indexOf('ParamBodyAngleZ')]).toBe(2)
    expect(commanded.every(Number.isFinite)).toBe(true)
    expect(commanded[0]).toBeLessThan(2)
    f.adapter.dispose()
  })

  it('preserves manual release and rapid mode transitions', () => {
    const f = fixture()
    f.state.eligible = true
    f.frame(0)
    f.frame(0.45)
    f.state.manualActive = true
    f.frame(0.5)
    expect(f.frame(0.7).commanded[0]).toBe(9)
    f.state.manualActive = false
    f.state.springActive = true
    expect(f.frame(1).commanded[0]).toBe(9)
    f.state.springActive = false
    f.state.exclusive = true
    expect(f.frame(2).commanded[0]).toBe(9)
    f.state.exclusive = false
    f.state.driver = 'magic'
    expect(f.frame(3).commanded[0]).toBe(9)
    f.state.driver = 'natural'
    f.frame(4)
    expect(f.frame(4.45).commanded[0]).toBe(2)
    f.adapter.dispose()
  })

  it('yields to explicit non-idle clips but not forced configured idle loops', () => {
    const f = fixture()
    f.state.eligible = true
    f.state.motion = { ...f.state.motion, group: 'SavedIdle', priority: 3 }
    f.frame(0)
    expect(f.frame(0.45).commanded[0]).toBe(2)
    f.state.motion.group = 'tap_body'
    f.frame(0.5)
    expect(f.frame(0.7).commanded[0]).toBe(9)
    f.state.motion.group = undefined
    f.state.motion.priority = 0
    f.frame(0.8)
    expect(f.frame(1.25).commanded[0]).toBe(2)
    f.adapter.dispose()
  })

  it('yields to an explicit clip during a partial Natural blend', () => {
    const f = fixture()
    f.state.eligible = true
    f.frame(0)
    const before = f.frame(0.2).commanded
    expect(before[0]).toBeGreaterThan(2)
    expect(before[0]).toBeLessThan(9)

    f.state.motion = { ...f.state.motion, group: 'tap_body', priority: 3 }
    expect(f.frame(0.2).commanded).toEqual(before)
    expect(f.frame(0.200001).commanded[0]).toBeLessThan(before[0])
    expect(f.frame(0.4).commanded[0]).toBe(9)

    f.state.motion.group = undefined
    f.state.motion.priority = 0
    expect(f.frame(0.5).commanded[0]).toBe(9)
    expect(f.frame(1).commanded[0]).toBe(2)
    f.adapter.dispose()
  })
})
