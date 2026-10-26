import { describe, expect, it, vi } from 'vitest'

import { createUnfoldCounter, naturalChatInput } from './natural-chat-input'

const bounds = { x: 100, y: 200, width: 300, height: 400 }
const activity = { typing: true, sentSeq: 4, sentWords: 9 }

describe('naturalChatInput', () => {
  it('stays null without a host chat target, even after sends', () => {
    const locate = vi.fn(() => ({ x: -2, y: 0 }))
    expect(naturalChatInput({ enabled: true, chatTarget: undefined, activity, unfoldSeq: 2, locate })).toBeNull()
    expect(locate).not.toHaveBeenCalled()
  })

  it('stays null while the setting is off', () => {
    expect(naturalChatInput({ enabled: false, chatTarget: { visible: true, bounds }, activity, unfoldSeq: 0, locate: () => ({ x: -2, y: 0 }) })).toBeNull()
  })

  it('locates a visible chat and passes the activity through', () => {
    const locate = vi.fn(() => ({ x: -2, y: 0.5 }))
    expect(naturalChatInput({ enabled: true, chatTarget: { visible: true, bounds }, activity, unfoldSeq: 1, locate }))
      .toEqual({ target: { x: -2, y: 0.5 }, typing: true, sentSeq: 4, sentWords: 9, unfoldSeq: 1 })
    expect(locate).toHaveBeenCalledWith(bounds)
  })

  it.each([
    ['hidden', { visible: false, bounds }],
    ['visible without bounds', { visible: true, bounds: null }],
  ])('keeps an input with a null target while the chat is %s', (_, chatTarget) => {
    expect(naturalChatInput({ enabled: true, chatTarget, activity, unfoldSeq: 3, locate: () => ({ x: 1, y: 1 }) }))
      .toEqual({ target: null, typing: true, sentSeq: 4, sentWords: 9, unfoldSeq: 3 })
  })

  it('keeps a null target when the host cannot place the chat', () => {
    expect(naturalChatInput({ enabled: true, chatTarget: { visible: true, bounds }, activity: undefined, unfoldSeq: 0, locate: () => null }))
      .toEqual({ target: null, typing: false, sentSeq: 0, sentWords: 0, unfoldSeq: 0 })
  })
})

describe('createUnfoldCounter', () => {
  it('does not count a chat already visible at the first observation', () => {
    const counter = createUnfoldCounter()
    expect(counter.observe(true)).toBe(0)
    expect(counter.observe(true)).toBe(0)
  })

  it('counts each hidden -> visible transition once', () => {
    const counter = createUnfoldCounter()
    expect(counter.observe(false)).toBe(0)
    expect(counter.observe(true)).toBe(1)
    expect(counter.observe(true)).toBe(1)
    expect(counter.observe(false)).toBe(1)
    expect(counter.observe(false)).toBe(1)
    expect(counter.observe(true)).toBe(2)
    expect(counter.seq).toBe(2)
  })
})
