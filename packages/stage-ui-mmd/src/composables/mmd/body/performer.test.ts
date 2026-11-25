import type { BodyGestureReport, BodyPerformanceInput, LayerOutput, PerformanceLayer } from '@proj-airi/motion-driver-humanoid/performance'

import type { MMDBodyEvent } from './performer'

import { BODY_CHANNELS, BODY_TICK, BodySkeleton, channelIndex, createPerformanceLayers } from '@proj-airi/motion-driver-humanoid/performance'
import { Euler, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { bodyFixture, cursorAt } from './fixture'
import { MMDBody } from './index'
import { MMDBodyPerformer } from './performer'
import { MMDBodyPose } from './pose'
import { buildBodyRigTraits } from './rig-traits'

const free = { pelvis: 0, hips: 0, torso: 0, head: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0 }
const owned = { pelvis: 1, hips: 1, torso: 1, head: 1, leftArm: 1, rightArm: 1, leftFingers: 1, rightFingers: 1 }

function performerOf(fixture: ReturnType<typeof bodyFixture>) {
  const { mmd, rig } = fixture
  const { skeleton, bindMatrix } = mmd.mesh
  const traits = buildBodyRigTraits(mmd.pmx, rig, [], { boneInverses: skeleton.boneInverses, bindMatrix })
  if (!traits)
    throw new TypeError('The fixture rig must yield body traits')
  return { traits, performer: new MMDBodyPerformer(new MMDBodyPose(mmd, rig), traits, { seed: 1, onEvent: () => {} }) }
}

const zero = { yaw: 0, pitch: 0, roll: 0 }
const stillInput: BodyPerformanceInput = {
  head: { attitude: zero, slow: zero, terms: { emphasis: zero, impulse: zero, pet: zero, held: zero, gesture: zero, cue: zero, sway: zero } },
  posture: { amplitude: 0, shiftRate: 0, support: 0 },
  gaze: { yaw: 0, pitch: 0, kind: 'sustained', saccadeSeq: 0, blinkFactor: 1, micro: { yaw: 0, pitch: 0 } },
  breath: { phase: 0, period: 4, scale: 0 },
  voice: { speaking: false, level: 0, slow: 0, onsetSeq: 0, emphasis: null },
  mood: { valence: 0, arousal: 0, tension: 0 },
  energy: { level: 0.5, mode: 'idle', away: false, reactingUntil: 0 },
  held: { emotion: null, strength: 0, level: 0, side: 1 },
  events: { impulse: null, gesture: null, cue: null, poke: null, pet: { level: 0, active: false, x: 0, y: 0 }, react: null },
  directive: { stance: 'stand', rest: 'none', act: null },
  facingYaw: 0,
  allowTurn: false,
  viewerYaw: 0,
  dragging: false,
  attention: { approach: 0, cursorShare: 0 },
  rootVelocity: { x: 0, y: 0, z: 0 },
  owned: { root: 0, leftLegIk: 0, rightLegIk: 0, lowerBody: 0, leftArm: 0, rightArm: 0, leftFingers: 0, rightFingers: 0, upperBody: 0, head: 0 },
  gait: null,
  armLift: { left: 0, right: 0 },
  idle: null,
  groovePhase: null,
}

function channels(values: Partial<Record<typeof BODY_CHANNELS[number], number>>): Float32Array {
  const out = new Float32Array(BODY_CHANNELS.length)
  for (const [name, value] of Object.entries(values) as [typeof BODY_CHANNELS[number], number][])
    out[channelIndex(name)] = value
  return out
}

describe('mmd body performer adapter', () => {
  it.each([1, 2, 3, 4] as const)('keeps the total torso rotation on a spine chain of %i bones', (spine) => {
    const fixture = bodyFixture(0, Math.PI, { spine })
    expect(fixture.rig.spineChain).toHaveLength(spine)
    const { performer } = performerOf(fixture)
    performer.applyTorso(fixture.pipeline.clean, free, channels({ lowerYaw: 0.1, midYaw: 0.2, upperYaw: 0.3 }))
    const top = fixture.bone(fixture.rig.spineChain[spine - 1].name)
    fixture.mesh.updateMatrixWorld(true)
    // Yaw about one axis commutes, so the composed chain turns by the sum of the three controls.
    const expected = new Quaternion().setFromEuler(new Euler(0, 0.6, 0, 'YXZ'))
    expect(top.getWorldQuaternion(new Quaternion()).angleTo(expected)).toBeLessThan(1e-6)
  })

  it('poses the arm segments where the performer\'s own forward kinematics put them', () => {
    const fixture = bodyFixture()
    const { performer, traits } = performerOf(fixture)
    const pose = channels({ leftClavElev: 0.1, leftClavProt: 0.05, leftFlex: 0.4, leftAbduct: 0.3, leftTwist: 0.2, leftElbow: 0.7, rightFlex: -0.2, rightAbduct: 0.5, rightElbow: 0.3, rightTwist: -0.1 })
    performer.applyArms(fixture.pipeline.clean, free, pose)
    fixture.mesh.updateMatrixWorld(true)
    const skeleton = new BodySkeleton(traits)
    skeleton.update(pose)
    for (const [side, prefix] of [['left', '左'], ['right', '右']] as const) {
      const canonical = skeleton.arm(side, pose)
      for (const [bone, point] of [[`${prefix}ひじ`, canonical.elbow], [`${prefix}手首`, canonical.wrist]] as const) {
        const actual = fixture.bone(bone).getWorldPosition(new Vector3())
        expect(actual.distanceTo(new Vector3(point.x, point.y, point.z))).toBeLessThan(1e-4)
      }
    }
  })

  it.each([{ name: 'without twist bones' }, { name: 'with twist bones', twist: {} }])('leaves every group at the clean pose when a clip owns it fully, $name', ({ twist }) => {
    const fixture = bodyFixture(0, Math.PI, { twist })
    const { performer } = performerOf(fixture)
    const { clean } = fixture.pipeline
    clean.quaternions.forEach((quaternion, index) => quaternion.setFromEuler(new Euler(0.01 * index, -0.02 * index, 0.015 * index)))
    fixture.bones.forEach((bone, index) => bone.quaternion.copy(clean.quaternions[index]))
    const pose = channels({ pelvisX: 0.02, hipsYaw: 0.1, lowerPitch: 0.2, midRoll: 0.1, upperYaw: 0.2, neckYaw: 0.3, headPitch: 0.2, leftFlex: 0.5, leftElbow: 0.6, leftIndex0: 0.4, rightAbduct: 0.4, rightThumb1: 0.3 })
    performer.applyTorso(clean, owned, pose)
    performer.applyHead(clean, 1, pose)
    performer.applyArms(clean, owned, pose)
    fixture.bones.forEach((bone, index) => {
      expect(1 - Math.abs(bone.quaternion.dot(clean.quaternions[index]))).toBeLessThan(1e-12)
      expect(bone.position.distanceTo(clean.positions[index])).toBeLessThan(1e-9)
    })
  })

  it('raises layer markers from the core reports, each stroke on the tick that reaches its planned hit', () => {
    const fixture = bodyFixture()
    const { traits } = performerOf(fixture)
    const events: { tick: number, event: MMDBodyEvent }[] = []
    let tick = 0
    const empty = new Float64Array(BODY_CHANNELS.length)
    // Tick 2 starts unit 1 and plans a right-hand beat to hit at tick 6; tick 8 returns to rest; tick 3 reports a nod,
    // an emotion onset and a poke flinch.
    const output = (t: number): LayerOutput => {
      const gesture: BodyGestureReport = t < 2
        ? { unitSeq: 0, strokeSeq: 0, form: null, hand: null, phase: 'rest', plannedHit: null }
        : t < 8
          ? { unitSeq: 1, strokeSeq: 1, form: 'beat', hand: 'right', phase: 'stroke', plannedHit: 6 * BODY_TICK }
          : { unitSeq: 1, strokeSeq: 1, form: null, hand: null, phase: 'rest', plannedHit: null }
      return t < 3
        ? { channels: empty, weight: 0, sequence: 0, gesture }
        : { channels: empty, weight: 0, sequence: 0, gesture, cue: { seq: 1, kind: 'nod' }, emotion: { seq: 1, emotion: 'happy', phase: 'onset' }, reaction: { seq: 1, kind: 'body-poke' } }
    }
    const layer: PerformanceLayer = { id: 'reports', order: 'gesture', mode: 'additive', mask: empty, step: context => output(context.tick), reset() {} }
    const performer = new MMDBodyPerformer(new MMDBodyPose(fixture.mmd, fixture.rig), traits, { seed: 1, layers: [layer], onEvent: event => events.push({ tick, event }) })
    for (tick = 1; tick <= 10; tick++)
      performer.step(stillInput)
    expect(events).toEqual([
      { tick: 2, event: { kind: 'gesture-unit', phase: 'start', unitSeq: 1 } },
      { tick: 3, event: { kind: 'cue', cue: 'nod', seq: 1 } },
      { tick: 3, event: { kind: 'emotion-posture', emotion: 'happy', phase: 'onset' } },
      { tick: 3, event: { kind: 'reaction', reaction: 'body-poke' } },
      { tick: 6, event: { kind: 'gesture-stroke', form: 'beat', hand: 'right', unitSeq: 1 } },
      { tick: 8, event: { kind: 'gesture-unit', phase: 'end', unitSeq: 1 } },
    ])
  })

  it('raises act and rest markers when the act feedback or the rest directive changes, and none without a producer', () => {
    const fixture = bodyFixture()
    const { traits } = performerOf(fixture)
    const events: { tick: number, event: MMDBodyEvent }[] = []
    let tick = 0
    const empty = new Float64Array(BODY_CHANNELS.length)
    // A sigh plays on ticks 3 to 5 and finishes on tick 6; the directive rests from tick 4 and dozes from tick 8.
    const act = (t: number): LayerOutput['act'] => t >= 3 && t <= 5 ? { seq: 1, id: 'sigh', state: 'playing' } : t === 6 ? { seq: 1, id: 'sigh', state: 'finished' } : null
    const layer: PerformanceLayer = { id: 'acts', order: 'act', mode: 'additive', mask: empty, step: context => ({ channels: empty, weight: 0, sequence: 0, act: act(context.tick) }), reset() {} }
    const performer = new MMDBodyPerformer(new MMDBodyPose(fixture.mmd, fixture.rig), traits, { seed: 1, layers: [layer], onEvent: event => events.push({ tick, event }) })
    for (tick = 1; tick <= 10; tick++)
      performer.step({ ...stillInput, directive: { ...stillInput.directive, rest: tick >= 8 ? 'doze' : tick >= 4 ? 'rest' : 'none' } })
    expect(events.filter(({ event }) => event.kind === 'act' || event.kind === 'rest')).toEqual([
      { tick: 3, event: { kind: 'act', id: 'sigh', state: 'playing', seq: 1 } },
      { tick: 4, event: { kind: 'rest', rest: 'rest' } },
      { tick: 6, event: { kind: 'act', id: 'sigh', state: 'finished', seq: 1 } },
      { tick: 8, event: { kind: 'rest', rest: 'doze' } },
    ])
    const silent: MMDBodyEvent[] = []
    const idle = new MMDBodyPerformer(new MMDBodyPose(fixture.mmd, fixture.rig), traits, { seed: 1, layers: createPerformanceLayers({ traits, seed: 1 }), onEvent: event => silent.push(event) })
    for (let t = 0; t < 10; t++)
      idle.step(stillInput)
    expect(silent.filter(event => event.kind === 'act' || event.kind === 'rest')).toEqual([])
  })

  it('holds its capabilities as plain values, so publishing them never starts the core\'s arm form search', () => {
    const { performer } = performerOf(bodyFixture())
    const lazy = Object.values(Object.getOwnPropertyDescriptors(performer.capabilities)).filter(descriptor => descriptor.get)
    expect(lazy).toEqual([])
    expect(performer.capabilities).toBe(performer.capabilities)
  })

  it('takes a claimed arm from the gesture layers before the claim reaches half', () => {
    const fixture = bodyFixture()
    const { traits } = performerOf(fixture)
    const performer = new MMDBodyPerformer(new MMDBodyPose(fixture.mmd, fixture.rig), traits, { seed: 1, layers: createPerformanceLayers({ traits, seed: 1 }), onEvent: () => {} })
    // An utterance from 0.5 s with onsets at 1.5 and 2.6 s; the app's upper-layer fade (a 0.25 s smoothstep) claims both
    // arms two ticks into the second stroke.
    const onsets = [1.5, 2.6]
    const claimAt = 2.6 + 2 * BODY_TICK
    const claim = (time: number) => {
      const u = Math.max(0, Math.min(1, (time - claimAt) / 0.25))
      return u * u * (3 - 2 * u)
    }
    let slow = 0
    let onsetSeq = 0
    let performed = 0
    let whileOwned = 0
    for (let tick = 1; tick <= Math.round(3.5 / BODY_TICK); tick++) {
      const time = tick * BODY_TICK
      const onset = onsets.some(at => Math.abs(time - at) < BODY_TICK / 2)
      onsetSeq += onset ? 1 : 0
      const level = time >= 0.5 ? onset ? 0.45 : 0.1 : 0
      slow = level + (slow - level) * Math.exp(-BODY_TICK / 0.25)
      const owned = claim(time)
      performer.step({
        ...stillInput,
        voice: { speaking: time >= 0.5, level, slow, onsetSeq, emphasis: null },
        energy: { ...stillInput.energy, level: 0.85 },
        owned: { ...stillInput.owned, leftArm: owned, rightArm: owned, leftFingers: owned, rightFingers: owned },
      })
      const { left, right } = performer.diagnostics.gestureActivation
      if (time < claimAt)
        performed = Math.max(performed, left, right)
      else if (owned > 0.5)
        whileOwned = Math.max(whileOwned, left, right)
    }
    expect(performed).toBe(1)
    expect(whileOwned).toBe(0)
  })

  it('reports a write deviation of 0 for a fully owned group and the written angle for a free one', () => {
    const fixture = bodyFixture()
    const { performer } = performerOf(fixture)
    const pose = channels({ rightFlex: 0.4, rightElbow: 0.5, leftFlex: 0.4, leftElbow: 0.5 })
    // A mixer's interpolated clean pose is not exactly unit length; that is no rotation.
    const k = 0.9999 / Math.hypot(0.1, 0.2, 0.3, 0.9)
    fixture.pipeline.clean.quaternions.forEach(quaternion => quaternion.set(0.1 * k, 0.2 * k, 0.3 * k, 0.9 * k))
    performer.beginFrame()
    performer.applyArms(fixture.pipeline.clean, { ...free, rightArm: 1, rightFingers: 1 }, pose)
    expect(performer.writeDeviation.rightArm).toBe(0)
    expect(performer.writeDeviation.leftArm).toBeGreaterThan(0.3)
    performer.beginFrame()
    expect(performer.writeDeviation.leftArm).toBe(0)
  })

  describe('calibrated hands', () => {
    const fingerChains = ['親指０', '親指１', '親指２', '親指２先', '人指１', '人指２', '人指３', '人指３先', '中指１', '中指２', '中指３', '中指３先', '薬指１', '薬指２', '薬指３', '薬指３先', '小指１', '小指２', '小指３', '小指３先']
    // A pointing hand with the wrist turned: curled fingers, a spread, an opposed thumb, and every arm joint off zero.
    const pose = (side: 'left' | 'right') => channels({
      [`${side}ClavElev`]: 0.05,
      [`${side}Flex`]: 0.5,
      [`${side}Abduct`]: 0.3,
      [`${side}Twist`]: 0.1,
      [`${side}Elbow`]: 0.7,
      [`${side}Pron`]: 0.4,
      [`${side}Wflex`]: 0.3,
      [`${side}Wdev`]: -0.1,
      [`${side}Thumb0`]: 0.6,
      [`${side}Thumb1`]: 0.3,
      [`${side}Index1`]: 0.1,
      [`${side}Middle0`]: 1.1,
      [`${side}Middle1`]: 1.2,
      [`${side}Ring0`]: 0.9,
      [`${side}Ring2`]: 0.5,
      [`${side}Little0`]: 0.7,
      [`${side}Spread`]: 0.12,
      [`${side}Opposition`]: 0.5,
    } as Partial<Record<typeof BODY_CHANNELS[number], number>>)

    /** Each finger segment's posed direction in the posed palm frame (along the hand, out of the palm, across it). */
    function posedFingers(fixture: ReturnType<typeof bodyFixture>, side: 'left' | 'right') {
      const { performer } = performerOf(fixture)
      performer.applyArms(fixture.pipeline.clean, free, pose(side))
      fixture.mesh.updateMatrixWorld(true)
      const prefix = side === 'left' ? '左' : '右'
      const calibration = fixture.rig.hands[side]!
      const hand = fixture.bone(`${prefix}手首`).getWorldQuaternion(new Quaternion())
      const axis = new Vector3(...calibration.axis).applyQuaternion(hand)
      const normal = new Vector3(...calibration.normal).applyQuaternion(hand)
      const across = axis.clone().cross(normal)
      const at = (name: string) => fixture.bone(`${prefix}${name}`).getWorldPosition(new Vector3())
      return fingerChains.flatMap((name, k) => {
        if (k % 4 === 3)
          return []
        const segment = at(fingerChains[k + 1]).sub(at(name)).normalize()
        return [segment.dot(axis), segment.dot(normal), segment.dot(across)]
      })
    }

    it('poses a rolled, bent and fanned bind hand as the straight one for the same channels', () => {
      const straight = bodyFixture(0, Math.PI, { hand: {} })
      const turned = bodyFixture(0, Math.PI, { hand: { wrist: 0.15, roll: 0.35, tilt: 0.25, fan: 0.08 } })
      for (const side of ['left', 'right'] as const) {
        const expected = posedFingers(straight, side)
        posedFingers(turned, side).forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6))
      }
    })

    it('curls each finger toward the palm and fans the fingers about the middle one', () => {
      const fixture = bodyFixture(0, Math.PI, { hand: { roll: 0.35 } })
      const posed = posedFingers(fixture, 'left')
      // Finger f, segment j: along, out of the palm, across, from index (f = 1) to little (f = 4).
      const segment = (f: number, j: number) => posed.slice((f * 3 + j) * 3, (f * 3 + j) * 3 + 3)
      expect(segment(2, 0)[1]).toBeCloseTo(Math.sin(1.1), 6)
      expect(segment(2, 0)[2]).toBeCloseTo(0, 6)
      // Spread turns the straight index finger 0.12 toward the thumb, against `across`.
      expect(segment(1, 0)[2]).toBeCloseTo(-Math.sin(0.12), 6)
      expect(segment(4, 0)[2]).toBeGreaterThan(0)
    })

    it('carries the hand along the performer\'s forward kinematics whatever the bind wrist bend', () => {
      const fixture = bodyFixture(0, Math.PI, { hand: { wrist: 0.2, roll: 0.3 } })
      const { performer, traits } = performerOf(fixture)
      for (const side of ['left', 'right'] as const) {
        const c = pose(side)
        performer.applyArms(fixture.pipeline.clean, free, c)
        fixture.mesh.updateMatrixWorld(true)
        const prefix = side === 'left' ? '左' : '右'
        const hand = fixture.bone(`${prefix}手首`).getWorldQuaternion(new Quaternion())
        const posed = new Vector3(...fixture.rig.hands[side]!.axis).applyQuaternion(hand)
        const skeleton = new BodySkeleton(traits)
        skeleton.update(c)
        const fk = skeleton.arm(side, c).hand
        expect(posed.angleTo(new Vector3(-fk[1], -fk[4], -fk[7]))).toBeLessThan(1e-6)
      }
    })

    it.each([
      { name: 'without twist bones', twist: undefined },
      { name: 'with twist bones', twist: { offset: 0.04, tilt: 5 * Math.PI / 180 } },
    ])('turns a rolled bind palm to the palm the forward kinematics assume, $name', ({ twist }) => {
      const fixture = bodyFixture(0, Math.PI, { hand: { wrist: 0.2, roll: 0.35 }, twist })
      const { performer, traits } = performerOf(fixture)
      for (const side of ['left', 'right'] as const) {
        const sigma = side === 'left' ? 1 : -1
        for (const c of [channels({}), pose(side)]) {
          performer.applyArms(fixture.pipeline.clean, free, c)
          fixture.mmd.beforePhysics({ grant: true, ik: false, physics: false })
          fixture.mesh.updateMatrixWorld(true)
          const hand = fixture.bone(`${side === 'left' ? '左' : '右'}手首`).getWorldQuaternion(new Quaternion())
          const calibration = fixture.rig.hands[side]!
          const skeleton = new BodySkeleton(traits)
          skeleton.update(c)
          const fk = skeleton.arm(side, c).hand
          // The canonical hand points along its -y with the palm toward its -sigma x (`BodySkeleton.arm`).
          expect(new Vector3(...calibration.axis).applyQuaternion(hand).angleTo(new Vector3(-fk[1], -fk[4], -fk[7]))).toBeLessThan(1e-5)
          expect(new Vector3(...calibration.normal).applyQuaternion(hand).angleTo(new Vector3(-sigma * fk[0], -sigma * fk[3], -sigma * fk[6]))).toBeLessThan(1e-5)
        }
      }
    })
  })

  describe('twist bones', () => {
    const pose = channels({ leftFlex: 0.5, leftAbduct: 0.3, leftTwist: 0.4, leftElbow: 0.7, leftPron: 0.9, leftWflex: 0.2, leftWdev: -0.1, leftIndex1: 0.5, rightFlex: -0.2, rightAbduct: 0.4, rightTwist: -0.3, rightElbow: 0.5, rightPron: -0.8, rightThumb1: 0.3 })
    const sides = [['left', '左'], ['right', '右']] as const
    /** The joints below each twist bone: the elbow, the hand and the finger bones. */
    const joints = (prefix: string) => ['ひじ', '手首', '親指０', '親指１', '親指２', '人指０', '人指１', '人指２', '人指３'].map(name => `${prefix}${name}`)
    // A library-like rig's offsets: `腕捩` 4 % of the upper arm off its line, its fixed axis 5 degrees off the segment.
    const offLine = { offset: 0.04, tilt: 5 * Math.PI / 180 }

    /** Writes the arms, then runs the fixed-axis and grant solve the frame pipeline runs before physics. */
    function posed(fixture: ReturnType<typeof bodyFixture>, weights = free) {
      const { performer } = performerOf(fixture)
      performer.applyArms(fixture.pipeline.clean, weights, pose)
      fixture.mmd.beforePhysics({ grant: true, ik: false, physics: false })
      fixture.mesh.updateMatrixWorld(true)
      return fixture
    }
    const world = (fixture: ReturnType<typeof bodyFixture>, name: string) => ({
      position: fixture.bone(name).getWorldPosition(new Vector3()),
      rotation: fixture.bone(name).getWorldQuaternion(new Quaternion()),
    })
    const angle = (q: Quaternion) => 2 * Math.atan2(Math.hypot(q.x, q.y, q.z), Math.abs(q.w))

    it('turns the twist bones by upper-arm twist and pronation and leaves every joint below where it was', () => {
      const plain = posed(bodyFixture())
      const twisted = posed(bodyFixture(0, Math.PI, { twist: offLine }))
      for (const [side, prefix] of sides) {
        for (const name of joints(prefix)) {
          const [expected, actual] = [world(plain, name), world(twisted, name)]
          // Turning a bone that sits off the segment line about an axis off it changes the shoulder-to-elbow distance
          // to second order: 1e-4 of a 3-unit arm here, 0.002 degrees seen from the shoulder.
          expect(actual.position.distanceTo(expected.position)).toBeLessThan(2e-4)
          expect(actual.rotation.angleTo(expected.rotation)).toBeLessThan(1e-5)
        }
        const twist = Math.abs(pose[channelIndex(`${side}Twist`)])
        const pron = Math.abs(pose[channelIndex(`${side}Pron`)])
        // The fixed axis is 5 degrees off the upper arm, so the twist bone takes the twist's part about that axis.
        expect(angle(twisted.bone(`${prefix}腕捩`).quaternion)).toBeCloseTo(twist, 2)
        expect(angle(twisted.bone(`${prefix}手捩`).quaternion)).toBeCloseTo(pron, 5)
        // The grant children follow in the same solve.
        expect(angle(twisted.bone(`${prefix}腕捩2`).quaternion)).toBeCloseTo(angle(twisted.bone(`${prefix}腕捩`).quaternion) / 2, 5)
        expect(angle(twisted.bone(`${prefix}手捩2`).quaternion)).toBeCloseTo(pron / 2, 5)
        // The upper arm keeps only its swing: it differs from the rig without twist bones by about the twist.
        const upper = world(plain, `${prefix}腕`).rotation.invert().multiply(world(twisted, `${prefix}腕`).rotation)
        expect(angle(upper)).toBeCloseTo(twist, 1)
      }
    })

    it.each([
      { name: 'coaxial', twist: {}, owned: 0.5 },
      { name: 'coaxial', twist: {}, owned: 0.8 },
      { name: 'off the line', twist: offLine, owned: 0.5 },
      { name: 'off the line', twist: offLine, owned: 0.8 },
    ])('blends with a clip before splitting the twist, so the joints match the rig without twist bones ($name, owned $owned)', ({ twist, owned }) => {
      // A clip pose on the joint bones, part-owned: each joint is the clean pose blended toward the write.
      const clip = (fixture: ReturnType<typeof bodyFixture>) => {
        const { clean } = fixture.pipeline
        for (const [k, name] of ['左腕', '左ひじ', '左手首', '右腕', '右ひじ', '右手首'].entries()) {
          const index = fixture.mmd.mesh.skeleton.bones.indexOf(fixture.bone(name))
          clean.quaternions[index].setFromEuler(new Euler(0.2 + 0.05 * k, -0.3 + 0.1 * k, 0.25 - 0.07 * k))
          fixture.bone(name).quaternion.copy(clean.quaternions[index])
        }
        return fixture
      }
      const weights = { ...free, leftArm: owned, rightArm: owned }
      const plain = posed(clip(bodyFixture()), weights)
      const twisted = posed(clip(bodyFixture(0, Math.PI, { twist })), weights)
      for (const [, prefix] of sides) {
        for (const name of joints(prefix)) {
          const [expected, actual] = [world(plain, name), world(twisted, name)]
          expect(actual.position.distanceTo(expected.position)).toBeLessThan(2e-4)
          expect(actual.rotation.angleTo(expected.rotation)).toBeLessThan(1e-5)
        }
        expect(angle(twisted.bone(`${prefix}腕捩`).quaternion)).toBeGreaterThan(0.01)
        expect(angle(twisted.bone(`${prefix}手捩`).quaternion)).toBeGreaterThan(0.01)
      }
    })

    it.each([
      { name: 'without a fixed axis', twist: { fixedAxis: false }, physics: false },
      { name: 'owned by physics', twist: offLine, physics: true },
    ])('keeps twist on the upper arm and pronation on the hand for twist bones $name', ({ twist, physics }) => {
      const plain = posed(bodyFixture())
      const fixture = bodyFixture(0, Math.PI, { twist })
      if (physics)
        fixture.rig.physicsOwned.push('左腕捩', '左手捩', '右腕捩', '右手捩')
      posed(fixture)
      for (const [, prefix] of sides) {
        for (const name of [`${prefix}腕`, ...joints(prefix)]) {
          const [expected, actual] = [world(plain, name), world(fixture, name)]
          expect(actual.position.distanceTo(expected.position)).toBeLessThan(1e-5)
          expect(actual.rotation.angleTo(expected.rotation)).toBeLessThan(1e-5)
        }
        for (const name of ['腕捩', '手捩'])
          expect(angle(fixture.bone(`${prefix}${name}`).quaternion)).toBe(0)
      }
    })
  })

  it('never writes a physics-owned bone', () => {
    const { mmd, pipeline, rig, input, bone } = bodyFixture()
    const physics = ['上半身2', '首', '左腕', '左ひじ', '右人指１']
    rig.physicsOwned.push(...physics)
    const body = new MMDBody(mmd, rig, { modelKey: 'physics', input: () => ({ ...input, ...cursorAt(input.intent, new Vector3(20, 18, 10)) }) })
    pipeline.poseStages.splice(0, pipeline.poseStages.length, { id: 'natural', run: () => {} }, ...body.poseStages)
    pipeline.surfaceStages.splice(0, pipeline.surfaceStages.length, body.surfaceStage)
    const index = (name: string) => mmd.mesh.skeleton.bones.indexOf(bone(name))
    for (let frame = 0; frame < 120; frame++) {
      pipeline.step(1 / 60)
      // The pipeline restores the clean pose before the stages; a bone no stage writes still holds it after them.
      for (const name of physics)
        expect(bone(name).quaternion.angleTo(pipeline.clean.quaternions[index(name)])).toBeLessThan(1e-7)
    }
    expect(bone('右腕').quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.1)
  })
})
