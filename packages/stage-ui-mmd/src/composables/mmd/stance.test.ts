import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { MMDStanceInteraction, MMDStanceSlots, MMDStanceWorld } from './stance'

import { NO_WORLD_BODY_INPUT, WANDER_MIN_MS } from '@proj-airi/motion-driver-humanoid/director'
import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'

import { createMMDAnimationManager } from './animation-manager'
import { MMDBody } from './body'
import { bodyFixture } from './body/fixture'
import { CHAT_STAND_GAP_LEGS, chatStandX, frameClocks, MMDStanceDirector, standingBaseMotion } from './stance'

const idle: Pick<PerformanceState, 'mode' | 'attention' | 'away'> = { mode: 'idle', attention: 'camera', away: false }
const away: Pick<PerformanceState, 'mode' | 'attention' | 'away'> = { mode: 'idle', attention: 'camera', away: true }
const EPOCH_MS = 1_000_000
const quiet: MMDStanceInteraction = { interactionSeq: 0, chatSendSeq: 0, interactionAtMs: null, actionRequest: null, actionFeedback: null, dragging: false }

function pose(name: string, center: number, legPitch: number, kneePitch: number): AnimationClip {
  const quaternion = (pitch: number) => new Quaternion().setFromEuler(new Euler(pitch, 0, 0)).toArray()
  return new AnimationClip(name, 2, [
    new VectorKeyframeTrack('.bones[センター].position', [0, 2], [0, center, 0, 0, center, 0]),
    ...['左足', '右足'].map(bone => new QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, [0, 2], [...quaternion(legPitch), ...quaternion(legPitch)])),
    ...['左ひざ', '右ひざ'].map(bone => new QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, [0, 2], [...quaternion(kneePitch), ...quaternion(kneePitch)])),
  ])
}

describe('standingBaseMotion', () => {
  it('never plays a sit or sleep slot clip as the standing idle', () => {
    expect(standingBaseMotion('sit-vmd', { sit: 'sit-vmd' })).toBeNull()
    expect(standingBaseMotion('sleep-vmd', { sleep: 'sleep-vmd' })).toBeNull()
    expect(standingBaseMotion('sit-vmd', { sit: 'sit-vmd', idle: 'breathe' })).toBe('breathe')
    expect(standingBaseMotion('breathe', { sit: 'sit-vmd' })).toBe('breathe')
    expect(standingBaseMotion('global', { idle: 'per-model' })).toBe('per-model')
    expect(standingBaseMotion('', {})).toBeNull()
  })

  it('never plays a stance clip that is also the per-model idle slot while standing', () => {
    expect(standingBaseMotion('', { idle: 'qa-sit', sit: 'qa-sit' })).toBeNull()
    expect(standingBaseMotion('qa-sit', { idle: 'qa-sit', sit: 'qa-sit' })).toBeNull()
    expect(standingBaseMotion('breathe', { idle: 'nap', sleep: 'nap' })).toBe('breathe')

    const director = new MMDStanceDirector()
    const result = director.update({ interaction: quiet, nowMs: EPOCH_MS, performance: idle, slots: { idle: 'qa-sit', sit: 'qa-sit' }, idleMotionName: '', isRegistered: () => true })
    expect(director.diagnostics.stance).toBe('stand')
    expect(result.motion).toBeNull()
  })
})

describe('mmd stance director', () => {
  const registered = () => true

  it('applies the clock offset to the director input only', () => {
    const nowMs = EPOCH_MS + 5_000
    expect(frameClocks(nowMs, 0)).toEqual({ naturalSeconds: nowMs / 1000, directorMs: nowMs })
    expect(frameClocks(nowMs, 120_000)).toEqual({ naturalSeconds: nowMs / 1000, directorMs: nowMs + 120_000 })

    const director = new MMDStanceDirector()
    const slots: MMDStanceSlots = { sit: 'sit-vmd' }
    const naturalTimes: number[] = []
    for (const offset of [0, 60_000, 120_000]) {
      const clocks = frameClocks(nowMs, offset)
      naturalTimes.push(clocks.naturalSeconds)
      director.update({ interaction: quiet, nowMs: clocks.directorMs, performance: idle, slots, idleMotionName: '', isRegistered: registered })
    }
    expect(new Set(naturalTimes).size).toBe(1)
    expect(director.diagnostics).toMatchObject({ stance: 'sit', sinceMs: nowMs + 120_000, stanceReason: 'idle-timeout' })
  })

  it('reports the director clock of every frame while the stance start holds', () => {
    const director = new MMDStanceDirector()
    director.update({ interaction: quiet, nowMs: EPOCH_MS, performance: idle, slots: {}, idleMotionName: '', isRegistered: registered })
    const first = director.diagnostics
    director.update({ interaction: quiet, nowMs: EPOCH_MS + 2_500, performance: idle, slots: {}, idleMotionName: '', isRegistered: registered })
    const second = director.diagnostics
    expect(first).toMatchObject({ nowMs: EPOCH_MS, sinceMs: EPOCH_MS })
    expect(second).toMatchObject({ nowMs: EPOCH_MS + 2_500, sinceMs: EPOCH_MS })
  })

  it('keeps standing while away without a sleep slot, and sleeps with one', () => {
    const director = new MMDStanceDirector()
    for (let second = 0; second <= 300; second += 10)
      director.update({ interaction: quiet, nowMs: EPOCH_MS + second * 1000, performance: away, slots: { sit: 'sit-vmd' }, idleMotionName: '', isRegistered: registered })
    expect(director.diagnostics).toMatchObject({ stance: 'stand', stanceReason: 'no-sleep-slot' })

    const result = director.update({ interaction: quiet, nowMs: EPOCH_MS + 310_000, performance: away, slots: { sleep: 'sleep-vmd' }, idleMotionName: '', isRegistered: registered })
    expect(director.diagnostics.stance).toBe('sleep')
    expect(result).toEqual({ motion: 'sleep-vmd', changed: true })
  })

  it('ignores a stance slot whose motion is not registered on this model', () => {
    const director = new MMDStanceDirector()
    director.update({ interaction: quiet, nowMs: EPOCH_MS, performance: idle, slots: { sit: 'missing' }, idleMotionName: '', isRegistered: () => false })
    director.update({ interaction: quiet, nowMs: EPOCH_MS + 200_000, performance: idle, slots: { sit: 'missing' }, idleMotionName: '', isRegistered: () => false })
    expect(director.diagnostics).toMatchObject({ stance: 'stand', stanceReason: 'no-sit-slot' })
  })

  it('cross-fades a stance switch on the base layer without pose pops', async () => {
    const { mmd, rig, input, bones, bone } = bodyFixture()
    const animation = createMMDAnimationManager(mmd, { physicsEnabled: false })
    const director = new MMDStanceDirector()
    const body = new MMDBody(mmd, rig, { modelKey: 'stance', input: () => ({ ...input, stanceClips: director.baseClips, target: new Vector3(4, 21, 30) }) })
    animation.pipeline.poseStages.push(...body.poseStages)
    animation.pipeline.surfaceStages.push(body.surfaceStage)
    await animation.init()
    animation.registerClip('stand', pose('stand', 10, 0, 0))
    animation.registerClip('sit', pose('sit', 3.5, -80 * Math.PI / 180, 80 * Math.PI / 180))

    // The global idle names the sit clip, as the import handler would after
    // importing it first; the per-model idle slot owns standing instead.
    const slots: MMDStanceSlots = { idle: 'stand', sit: 'sit' }
    const centerY = () => mmd.mesh.worldToLocal(bone('センター').getWorldPosition(new Vector3())).y
    const previous = bones.map(b => b.getWorldQuaternion(new Quaternion()))
    let offset = 0
    let maxDelta = 0
    let standingY = Number.NaN
    let transitionFrames = 0
    for (let frame = 0; frame < 360; frame++) {
      if (frame === 120)
        offset += 120_000
      const clocks = frameClocks(EPOCH_MS + frame * 1000 / 60, offset)
      const base = director.update({ interaction: quiet, nowMs: clocks.directorMs, performance: idle, slots, idleMotionName: 'sit', isRegistered: name => animation.availableClips().includes(name) })
      if (base.changed)
        animation.setBaseMotion(base.motion)
      animation.update(1 / 60)
      if (frame === 119) {
        standingY = centerY()
        expect(animation.snapshot().idle).toBe('stand')
      }
      if (frame > 120 && centerY() < standingY - 0.01 && centerY() > standingY - 6.49)
        transitionFrames++
      if (frame > 30) {
        bones.forEach((b, index) => {
          const current = b.getWorldQuaternion(new Quaternion())
          maxDelta = Math.max(maxDelta, current.angleTo(previous[index]))
        })
      }
      bones.forEach((b, index) => b.getWorldQuaternion(previous[index]))
    }

    expect(director.diagnostics.stance).toBe('sit')
    expect(animation.snapshot().idle).toBe('sit')
    expect(standingY - centerY()).toBeGreaterThan(4)
    // 0.6 s at 60 fps; a cut would finish in one or two frames.
    expect(transitionFrames).toBeGreaterThanOrEqual(30)
    expect(transitionFrames).toBeLessThanOrEqual(40)
    expect(maxDelta * 180 / Math.PI).toBeLessThan(5)
  })
})

describe('mmd stance director in the stage world', () => {
  const registered = () => true
  const talking: Pick<PerformanceState, 'mode' | 'attention' | 'away'> = { mode: 'talking', attention: 'camera', away: false }
  const world = (patch: Partial<MMDStanceWorld> = {}): MMDStanceWorld => ({
    ...NO_WORLD_BODY_INPUT,
    ground: { minX: -10, maxX: 10 },
    legLength: 1,
    ...patch,
  })
  function frame(director: MMDStanceDirector, atMs: number, input: MMDStanceWorld, performance = idle, offsetMs = 0, interaction: MMDStanceInteraction = quiet) {
    return director.update({
      interaction,
      nowMs: frameClocks(EPOCH_MS + atMs, offsetMs).directorMs,
      performance,
      slots: {},
      idleMotionName: '',
      isRegistered: registered,
      world: input,
    })
  }

  it('walks to one leg length short of the chat, on the side of home, after an unfold', () => {
    const director = new MMDStanceDirector()
    frame(director, 0, world())
    expect(director.diagnostics).toMatchObject({ goalX: null, reason: 'stay' })
    frame(director, 100, world({ chatUnfoldSeq: 1, chatX: 5 }))
    expect(director.diagnostics).toMatchObject({ goalX: 4, reason: 'approach-chat', pace: 'walk' })
    expect(director.intent?.locomotion).toMatchObject({ goalX: 4, reason: 'approach-chat' })
  })

  it('stands on the other side of a chat at the ground edge when her side has no ground beside it', () => {
    const legLength = 9
    const halfWidth = 4.9
    const ground = { minX: 5.9, maxX: 88 }
    // Measured on the real surface: a 380 DIP chat at x 94 DIP, 0.065 units per DIP, her root behind it at x 8.
    const chat = { minX: 6.1, maxX: 30.9 }
    const director = new MMDStanceDirector()
    const input = (patch: Partial<MMDStanceWorld>) => world({ ground, legLength, rootX: 8, homeX: 35.7, ...patch })
    frame(director, 0, input({}))
    frame(director, 100, input({ chatUnfoldSeq: 1, chatX: chatStandX(chat, 8, 35.7, halfWidth, legLength, ground) }))

    const goalX = director.diagnostics.goalX!
    expect(goalX).toBeCloseTo(chat.maxX + halfWidth + CHAT_STAND_GAP_LEGS * legLength)
    expect(goalX - halfWidth).toBeGreaterThanOrEqual(chat.maxX)
  })

  it('stops beside a 380 DIP chat for either root side and either home side, never over it', () => {
    const unitsPerDip = 1 / 15
    const legLength = 9
    const halfWidth = 2.7
    // A 380 DIP chat centred at x 0, inside a wide ground line.
    const chat = { minX: -190 * unitsPerDip, maxX: 190 * unitsPerDip }
    for (const rootSide of [1, -1]) {
      for (const homeSide of [1, -1]) {
        const rootX = rootSide * 30
        const homeX = homeSide * 40
        const director = new MMDStanceDirector()
        const input = (patch: Partial<MMDStanceWorld>) => world({ ground: { minX: -80, maxX: 80 }, legLength, rootX, homeX, ...patch })
        frame(director, 0, input({}))
        frame(director, 100, input({ chatUnfoldSeq: 1, chatX: chatStandX(chat, rootX, homeX, halfWidth, legLength, { minX: -80, maxX: 80 }) }))
        const goalX = director.diagnostics.goalX!
        const edge = rootSide > 0 ? chat.maxX : chat.minX
        const label = `root ${rootSide > 0 ? 'right' : 'left'}, home ${homeSide > 0 ? 'right' : 'left'}`
        expect(director.diagnostics.reason, label).toBe('approach-chat')
        expect(goalX, label).toBeCloseTo(edge + rootSide * (halfWidth + CHAT_STAND_GAP_LEGS * legLength))
        // Her body rect [goalX - halfWidth, goalX + halfWidth] does not overlap the chat.
        expect(goalX - halfWidth >= chat.maxX || goalX + halfWidth <= chat.minX, label).toBe(true)
      }
    }
  })

  it('ignores requests that predate its first frame', () => {
    const director = new MMDStanceDirector()
    frame(director, 0, world({ chatUnfoldSeq: 3, chatX: 5, debugGoal: { seq: 2, x: 6, pace: 'walk' } }))
    expect(director.diagnostics).toMatchObject({ goalX: null, reason: 'stay', pendingGoal: null })
  })

  it('chases a cursor eight leg lengths away after a poke', () => {
    const director = new MMDStanceDirector()
    frame(director, 0, world())
    frame(director, 1_000, world({ cursorX: 8, cursorOnStage: true }), idle, 0, { ...quiet, interactionSeq: 1, interactionAtMs: EPOCH_MS + 1_000 })
    expect(director.diagnostics).toMatchObject({ goalX: 7, reason: 'approach-cursor' })
  })

  it('holds a goal while speaking, finishes the one in flight, then issues the held goal', () => {
    const director = new MMDStanceDirector()
    frame(director, 0, world())
    frame(director, 100, world({ chatUnfoldSeq: 1, chatX: 5 }))
    expect(director.diagnostics.goalX).toBe(4)

    // Speaking starts mid-walk: the relocation finishes.
    frame(director, 4_000, world({ speaking: true, rootX: 2, locomotionMode: 'walking' }))
    expect(director.diagnostics).toMatchObject({ goalX: 4, reason: 'approach-chat' })
    frame(director, 8_000, world({ speaking: true, rootX: 4, locomotionMode: 'idle' }))
    expect(director.diagnostics.goalX).toBeNull()

    frame(director, 9_000, world({ speaking: true, rootX: 4, debugGoal: { seq: 1, x: -6, pace: 'walk' } }))
    expect(director.diagnostics).toMatchObject({ goalX: null, pendingGoal: { x: -6, reason: 'debug' } })
    frame(director, 20_000, world({ speaking: true, rootX: 4, debugGoal: { seq: 1, x: -6, pace: 'walk' } }))
    expect(director.diagnostics.pendingGoal).not.toBeNull()
    frame(director, 21_000, world({ speaking: false, rootX: 4, debugGoal: { seq: 1, x: -6, pace: 'walk' } }))
    expect(director.diagnostics).toMatchObject({ goalX: -6, reason: 'debug', pendingGoal: null })
  })

  it('drops a held goal after the time to live, and treats the talking performance as speaking', () => {
    const director = new MMDStanceDirector()
    frame(director, 0, world(), talking)
    frame(director, 1_000, world({ debugGoal: { seq: 1, x: -6, pace: 'walk' } }), talking)
    expect(director.diagnostics.pendingGoal).not.toBeNull()
    frame(director, 36_000, world({ debugGoal: { seq: 1, x: -6, pace: 'walk' } }), talking)
    expect(director.diagnostics).toMatchObject({ goalX: null, pendingGoal: null })
    frame(director, 37_000, world(), idle)
    expect(director.diagnostics.goalX).toBeNull()
  })

  it('walks home after twenty seconds with no reason', () => {
    const director = new MMDStanceDirector()
    frame(director, 0, world({ rootX: 3, homeX: 0 }))
    frame(director, 19_000, world({ rootX: 3, homeX: 0 }))
    expect(director.diagnostics.goalX).toBeNull()
    frame(director, 20_000, world({ rootX: 3, homeX: 0 }))
    expect(director.diagnostics).toMatchObject({ goalX: 0, reason: 'return-home', pace: 'stroll' })
  })

  it('wanders after the debug clock skips ahead only in roam mode', () => {
    const wander = (roamMode: 'stay' | 'roam') => {
      const director = new MMDStanceDirector()
      frame(director, 0, world({ roamMode, seed: 7 }))
      frame(director, 1_000, world({ roamMode, seed: 7 }), idle, 1_200_000)
      return director.diagnostics
    }
    expect(wander('roam')).toMatchObject({ reason: 'wander' })
    expect(wander('roam').goalX).not.toBeNull()
    expect(wander('stay')).toMatchObject({ goalX: null, reason: 'stay', nextWanderAtMs: null })
  })

  it('does not wander again on arrival when the next wander came due during the walk', () => {
    const director = new MMDStanceDirector()
    const roam = (patch: Partial<MMDStanceWorld> = {}) => world({ roamMode: 'roam', seed: 7, ...patch })
    frame(director, 0, roam())
    let offsetMs = director.diagnostics.nextWanderAtMs! - EPOCH_MS + 1_000
    frame(director, 100, roam(), idle, offsetMs)
    const first = director.diagnostics
    expect(first.reason).toBe('wander')
    const goalX = first.goalX!

    // The debug clock skips past the rescheduled wander while she is still walking to the first one.
    offsetMs += first.nextWanderAtMs! - (EPOCH_MS + 2_000 + offsetMs) + 1_000
    frame(director, 2_000, roam({ rootX: goalX / 2, locomotionMode: 'walking' }), idle, offsetMs)
    expect(director.diagnostics).toMatchObject({ reason: 'wander', goalX })

    frame(director, 4_000, roam({ rootX: goalX, locomotionMode: 'idle' }), idle, offsetMs)
    const arrivedAtMs = director.diagnostics.nowMs
    expect(director.diagnostics).toMatchObject({ goalX: null, reason: 'stay' })
    expect(director.diagnostics.nextWanderAtMs).toBeGreaterThanOrEqual(arrivedAtMs + WANDER_MIN_MS)

    frame(director, 4_100, roam({ rootX: goalX, locomotionMode: 'idle' }), idle, offsetMs)
    expect(director.diagnostics.goalX).toBeNull()
  })

  it('drops its goal and held goal when the host places her, and waits before walking home', () => {
    const director = new MMDStanceDirector()
    frame(director, 0, world())
    frame(director, 100, world({ chatUnfoldSeq: 1, chatX: 5 }))
    frame(director, 200, world({ speaking: true, debugGoal: { seq: 1, x: 6, pace: 'walk' } }))
    director.clearGoal()
    expect(director.diagnostics).toMatchObject({ goalX: null, reason: 'stay', pendingGoal: null })
    frame(director, 15_000, world({ rootX: 8, homeX: 0 }))
    expect(director.diagnostics.goalX).toBeNull()
    frame(director, 21_000, world({ rootX: 8, homeX: 0 }))
    expect(director.diagnostics.reason).toBe('return-home')
  })

  it('never issues a goal without a ground line', () => {
    const director = new MMDStanceDirector()
    const classic = { ...NO_WORLD_BODY_INPUT }
    frame(director, 0, classic)
    frame(director, 100, { ...classic, chatUnfoldSeq: 1, chatX: 5, debugGoal: { seq: 1, x: 6, pace: 'walk' } })
    expect(director.diagnostics).toMatchObject({ goalX: null, reason: 'stay', pendingGoal: null })
    expect(director.intent?.locomotion.goalX).toBeNull()
  })
})
