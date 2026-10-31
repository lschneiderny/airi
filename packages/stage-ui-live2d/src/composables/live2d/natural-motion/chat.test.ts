import type { NaturalMotionEvent } from '@proj-airi/motion-driver-natural/frame-types'
import type { NaturalChatInput } from '@proj-airi/motion-driver-natural/natural-motion'

import { mapCursor } from '@proj-airi/motion-driver-natural/cursor-attention'
import { NaturalMotion } from '@proj-airi/motion-driver-natural/natural-motion'
import { describe, expect, it } from 'vitest'

const dt = 1 / 120
const target = { x: -3, y: -1 }
const input: NaturalChatInput = { target, typing: false, sentSeq: 0, sentWords: 8, unfoldSeq: 0 }

function fixture() {
  const motion = new NaturalMotion({ seed: 42 })
  const events: NaturalMotionEvent[] = []
  motion.setObserver(event => events.push(event))
  motion.advance(0)
  return { motion, events }
}

function advance(motion: NaturalMotion, from: number, to: number) {
  for (let frame = Math.round(from / dt) + 1; frame <= Math.round(to / dt); frame++)
    motion.advance(frame * dt)
}

describe('natural chat attention', () => {
  it.each([false, true])('keeps seeded chat fixation time in its typing share when typing=%s', (typing) => {
    const { motion, events } = fixture()
    motion.setChat({ ...input, typing }, 0)
    let chatFrames = 0
    for (let frame = 1; frame <= 300 / dt; frame++) {
      motion.advance(frame * dt)
      chatFrames += Number(motion.onChat)
    }
    const share = chatFrames / (300 / dt)
    if (typing) {
      expect(share).toBeGreaterThanOrEqual(0.25)
      expect(share).toBeLessThanOrEqual(0.45)
      expect(events.some(event => event.kind === 'glance' && event.cause === 'chat-typing' && event.hold >= 0.18)).toBe(true)
    }
    else {
      expect(share).toBe(0)
      expect(events.filter(event => event.kind === 'glance')).toEqual([])
    }
  })

  it('starts one delayed sent reading glance with an explicit 2.5-second hold', () => {
    const { motion, events } = fixture()
    motion.setChat(input, 0)
    motion.setChat({ ...input, sentSeq: 1 }, 1)
    advance(motion, 1, 5)
    const glances = events.filter(event => event.kind === 'glance' && event.cause === 'chat-sent')
    expect(glances).toHaveLength(1)
    expect(glances[0].at).toBeGreaterThanOrEqual(1.18)
    expect(glances[0].at).toBeLessThanOrEqual(1.30 + dt)
    expect(glances[0]).toMatchObject({ point: mapCursor(target).eye, hold: 2.5 })
    const end = glances[0].at + 2.4
    // Replaying the same seed verifies the held target rather than only its observer metadata.
    const replay = fixture().motion
    replay.setChat(input, 0)
    replay.setChat({ ...input, sentSeq: 1 }, 1)
    expect(replay.advance(end).fixation).toEqual(mapCursor(target).eye)
  })

  it.each(['hidden', 'talking', 'pet', 'pet-camera-hold'] as const)('consumes a sent cue without a glance while %s', (blocked) => {
    const { motion, events } = fixture()
    motion.setChat(input, 0)
    let at = 1
    if (blocked === 'talking')
      motion.setPerformance({ mode: 'talking', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }, 0.5, 0)
    if (blocked === 'pet' || blocked === 'pet-camera-hold') {
      motion.setPet({ x: 0, y: 0 }, 0)
      advance(motion, 0, 4)
      at = 4
      if (blocked === 'pet-camera-hold') {
        motion.setPet(null, at)
        advance(motion, at, at + dt)
        at += dt
      }
    }
    motion.setChat({ ...input, target: blocked === 'hidden' ? null : target, sentSeq: 1 }, at)
    advance(motion, at, at + 5)
    motion.setChat({ ...input, sentSeq: 1 }, at + 5)
    advance(motion, at + 5, at + 6)
    expect(events.filter(event => event.kind === 'glance' && event.cause === 'chat-sent')).toEqual([])
  })

  it('glances once 0.25 seconds after hidden-first unfold with a 0.8-second hold', () => {
    const { motion, events } = fixture()
    motion.setChat({ ...input, target: null }, 0)
    motion.setChat({ ...input, unfoldSeq: 1 }, 1)
    advance(motion, 1, 3)
    const glances = events.filter(event => event.kind === 'glance' && event.cause === 'chat-unfold')
    expect(glances).toHaveLength(1)
    expect(glances[0].at).toBeCloseTo(1.25, 10)
    expect(glances[0]).toMatchObject({ point: mapCursor(target).eye, hold: 0.8 })
  })

  it.each(['visible-first', 'null-first', 'null-between'] as const)('does not replay startup or unchanged sequences for %s', (lifecycle) => {
    const { motion, events } = fixture()
    if (lifecycle === 'null-first')
      motion.setChat(null, 0)
    motion.setChat(input, 0)
    if (lifecycle === 'null-between') {
      motion.setChat(null, 1)
      motion.setChat(input, 2)
    }
    advance(motion, lifecycle === 'null-between' ? 2 : 0, 5)
    expect(events.filter(event => event.kind === 'glance')).toEqual([])
  })

  it('treats a sent sequence reset as one new cue and preserves the baseline across null', () => {
    const { motion, events } = fixture()
    motion.setChat({ ...input, sentSeq: 5 }, 0)
    motion.setChat(null, 0.5)
    motion.setChat({ ...input, sentSeq: 0 }, 1)
    motion.setChat({ ...input, sentSeq: 0 }, 1)
    advance(motion, 1, 5)
    expect(events.filter(event => event.kind === 'glance' && event.cause === 'chat-sent')).toHaveLength(1)
  })

  it('suppresses typing fixations during talking', () => {
    const { motion, events } = fixture()
    motion.setPerformance({ mode: 'talking', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }, 0.5, 0)
    motion.setChat({ ...input, typing: true }, 0)
    advance(motion, 0, 30)
    expect(motion.onChat).toBe(false)
    expect(events.filter(event => event.kind === 'glance' && event.cause === 'chat-typing')).toEqual([])
  })

  it.each(['sent', 'unfold'] as const)('leaves an active %s read by the next grid step when talking starts', (cue) => {
    const { motion, events } = fixture()
    motion.setChat(input, 0)
    motion.setChat({ ...input, sentSeq: Number(cue === 'sent'), unfoldSeq: Number(cue === 'unfold') }, 1)
    const point = mapCursor(target).eye
    expect(motion.advance(1.5).fixation).toEqual(point)
    motion.setPerformance({ mode: 'talking', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }, 0.5, 1.5)
    expect(motion.advance(181 * dt).fixation).not.toEqual(point)
    let heldChatFrames = 0
    for (let frame = 182; frame <= 420; frame++) {
      const fixation = motion.advance(frame * dt).fixation
      heldChatFrames += Number(fixation.x === point.x && fixation.y === point.y)
    }
    expect(heldChatFrames).toBe(0)
    expect(events.filter(event => event.kind === 'glance' && event.cause.startsWith('chat-') && event.at >= 1.5)).toEqual([])
  })

  it('leaves a settled typing-branch fixation by the next grid step when talking starts', () => {
    const { motion, events } = fixture()
    motion.setChat({ ...input, typing: true }, 0)
    let frame = 0
    while (!motion.onChat && frame < 30 / dt)
      motion.advance(++frame * dt)
    expect(motion.onChat).toBe(true)
    advance(motion, frame * dt, (frame + 12) * dt)
    frame += 12
    expect(motion.onChat).toBe(true)
    const before = motion.advance(frame * dt).fixation
    const at = frame * dt
    motion.setPerformance({ mode: 'talking', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }, 0.5, at)
    expect(motion.advance((++frame) * dt).fixation).not.toEqual(before)
    expect(motion.onChat).toBe(false)
    expect(motion.chatHeadFollow).toEqual({ x: 0, y: 0 })
    const endFrame = frame + 240
    for (; frame <= endFrame; frame++) {
      motion.advance(frame * dt)
      expect(motion.onChat).toBe(false)
    }
    expect(events.filter(event => event.kind === 'glance' && event.cause.startsWith('chat-') && event.at >= at)).toEqual([])
  })

  it('cancels a pending read when talking starts before its deadline', () => {
    const { motion, events } = fixture()
    motion.setChat(input, 0)
    motion.setChat({ ...input, sentSeq: 1 }, 1)
    motion.setPerformance({ mode: 'talking', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }, 0.5, 1.1)
    advance(motion, 1.1, 6)
    expect(events.filter(event => event.kind === 'glance' && event.cause === 'chat-sent')).toEqual([])
  })

  it('moves mean head X toward the chat by at least 0.03 during typing fixations', () => {
    const { motion } = fixture()
    const baseline = fixture().motion
    motion.setChat({ ...input, typing: true }, 0)
    let difference = 0
    let count = 0
    for (let frame = 1; frame <= 300 / dt; frame++) {
      const chat = motion.advance(frame * dt)
      const idle = baseline.advance(frame * dt)
      if (frame * dt > 10 && motion.onChat) {
        difference += chat.pose.headX - idle.pose.headX
        count++
      }
    }
    expect(count).toBeGreaterThan(1000)
    expect(difference / count).toBeLessThanOrEqual(-0.03)
  })

  it.each(['disabled', 'hidden'] as const)('cancels active typing and a pending send deadline when %s', (reason) => {
    const { motion, events } = fixture()
    motion.setChat({ ...input, typing: true }, 0)
    let frame = 0
    while (!motion.onChat && frame < 30 / dt)
      motion.advance(++frame * dt)
    expect(motion.onChat).toBe(true)
    const at = frame * dt
    motion.setChat({ ...input, typing: true, sentSeq: 1 }, at)
    motion.advance((++frame) * dt)
    motion.setChat(reason === 'disabled' ? null : { ...input, target: null, sentSeq: 1 }, frame * dt)
    motion.advance((++frame) * dt)
    expect(motion.onChat).toBe(false)
    expect(motion.chatHeadFollow).toEqual({ x: 0, y: 0 })
    expect(motion.advance(frame * dt + 0.1).fixation.x).toBeGreaterThan(-0.3)
    advance(motion, frame * dt + 0.1, frame * dt + 5)
    expect(events.filter(event => event.kind === 'glance' && event.cause === 'chat-sent')).toEqual([])
  })
})
