import { describe, expect, it, vi } from 'vitest'

import { naturalChatInput } from './natural-chat-input'

const bounds = { x: 100, y: 200, width: 300, height: 400 }
const activity = { typing: true }

describe('naturalChatInput', () => {
  it('stays null without a host chat target', () => {
    const locate = vi.fn(() => ({ x: -2, y: 0 }))
    expect(naturalChatInput({ enabled: true, chatTarget: undefined, activity, locate })).toBeNull()
    expect(locate).not.toHaveBeenCalled()
  })

  it('stays null while the setting is off', () => {
    expect(naturalChatInput({ enabled: false, chatTarget: { visible: true, bounds }, activity, locate: () => ({ x: -2, y: 0 }) })).toBeNull()
  })

  it('locates a visible chat and passes the activity through', () => {
    const locate = vi.fn(() => ({ x: -2, y: 0.5 }))
    expect(naturalChatInput({ enabled: true, chatTarget: { visible: true, bounds }, activity, locate }))
      .toEqual({ target: { x: -2, y: 0.5 }, typing: true })
    expect(locate).toHaveBeenCalledWith(bounds)
  })

  it.each([
    ['hidden', { visible: false, bounds }],
    ['visible without bounds', { visible: true, bounds: null }],
  ])('keeps an input with a null target while the chat is %s', (_, chatTarget) => {
    expect(naturalChatInput({ enabled: true, chatTarget, activity, locate: () => ({ x: 1, y: 1 }) }))
      .toEqual({ target: null, typing: true })
  })

  it('keeps a null target when the host cannot place the chat', () => {
    expect(naturalChatInput({ enabled: true, chatTarget: { visible: true, bounds }, activity: undefined, locate: () => null }))
      .toEqual({ target: null, typing: false })
  })
})
