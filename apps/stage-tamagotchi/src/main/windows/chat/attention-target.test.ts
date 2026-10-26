import type { ChatAttentionTarget } from '../../../shared/eventa'
import type { ChatWindowSnapshot } from './attention-target'

import { describe, expect, it, vi } from 'vitest'

import { chatAttentionTargetOf, createChatAttentionTargetFeed } from './attention-target'

const bounds = { x: 120, y: 340, width: 380, height: 560 }

function floating(overrides: Partial<Extract<ChatWindowSnapshot, { mode: 'floating' }>> = {}): ChatWindowSnapshot {
  return { mode: 'floating', window: { shown: true, bounds }, folded: false, relocating: false, ...overrides }
}

function legacy(window: Partial<{ shown: boolean, minimized: boolean }> = {}): ChatWindowSnapshot {
  return { mode: 'legacy', window: { shown: true, minimized: false, bounds, ...window } }
}

describe('chatAttentionTargetOf', () => {
  it('points at a shown, unfolded floating chat', () => {
    expect(chatAttentionTargetOf(floating())).toEqual({ visible: true, bounds })
  })

  it('hides a folded floating chat', () => {
    expect(chatAttentionTargetOf(floating({ folded: true }))).toEqual({ visible: false, bounds: null })
  })

  it('hides a floating chat while it moves to the other side of the main window', () => {
    expect(chatAttentionTargetOf(floating({ relocating: true }))).toEqual({ visible: false, bounds: null })
  })

  it('hides a floating chat whose window is hidden or closed', () => {
    expect(chatAttentionTargetOf(floating({ window: { shown: false, bounds } }))).toEqual({ visible: false, bounds: null })
    expect(chatAttentionTargetOf(floating({ window: undefined }))).toEqual({ visible: false, bounds: null })
  })

  it('points at a shown legacy chat window', () => {
    expect(chatAttentionTargetOf(legacy())).toEqual({ visible: true, bounds })
  })

  it('hides a minimized or hidden legacy chat window', () => {
    expect(chatAttentionTargetOf(legacy({ minimized: true }))).toEqual({ visible: false, bounds: null })
    expect(chatAttentionTargetOf(legacy({ shown: false }))).toEqual({ visible: false, bounds: null })
    expect(chatAttentionTargetOf({ mode: 'legacy', window: undefined })).toEqual({ visible: false, bounds: null })
  })

  it('returns a copy of the window bounds', () => {
    const snapshot = floating()
    const target = chatAttentionTargetOf(snapshot)

    expect(target.bounds).not.toBe(bounds)
  })
})

describe('createChatAttentionTargetFeed', () => {
  function setup() {
    let current: ChatAttentionTarget = { visible: false, bounds: null }
    const feed = createChatAttentionTargetFeed(() => current)
    const listener = vi.fn()
    const unsubscribe = feed.subscribe(listener)
    return { feed, listener, unsubscribe, set: (next: ChatAttentionTarget) => current = next }
  }

  it('sends the first target', () => {
    const { feed, listener } = setup()

    feed.update()

    expect(listener).toHaveBeenCalledExactlyOnceWith({ visible: false, bounds: null })
  })

  it('sends a target equal to the last one only once', () => {
    const { feed, listener, set } = setup()

    set({ visible: true, bounds: { ...bounds } })
    feed.update()
    set({ visible: true, bounds: { ...bounds } })
    feed.update()

    expect(listener).toHaveBeenCalledOnce()
  })

  it('sends a moved chat and a chat that hides', () => {
    const { feed, listener, set } = setup()

    set({ visible: true, bounds })
    feed.update()
    set({ visible: true, bounds: { ...bounds, x: bounds.x + 1 } })
    feed.update()
    set({ visible: false, bounds: null })
    feed.update()

    expect(listener.mock.calls).toEqual([
      [{ visible: true, bounds }],
      [{ visible: true, bounds: { ...bounds, x: bounds.x + 1 } }],
      [{ visible: false, bounds: null }],
    ])
  })

  it('stops sending to a listener that unsubscribed', () => {
    const { feed, listener, unsubscribe, set } = setup()

    unsubscribe()
    set({ visible: true, bounds })
    feed.update()

    expect(listener).not.toHaveBeenCalled()
  })
})
