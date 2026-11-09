import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OwnWindowBinder } from './binding'

interface Entry { id: string, caption: string }

class FakeSource {
  windows: Entry[] | null = []
  private readonly listeners = new Set<(windows: readonly Entry[] | null) => void>()
  ownWindows() { return this.windows }
  onOwnWindows(listener: (windows: readonly Entry[] | null) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  push(windows: Entry[] | null) {
    this.windows = windows
    for (const listener of this.listeners)
      listener(windows)
  }

  get listenerCount() { return this.listeners.size }
}

class FakeWindow {
  title: string
  destroyed = false
  readonly titles: string[] = []
  constructor(title: string) {
    this.title = title
  }

  getTitle() { return this.title }
  setTitle(title: string) {
    this.title = title
    this.titles.push(title)
  }

  isDestroyed() { return this.destroyed }
}

describe('ownWindowBinder', () => {
  let source: FakeSource
  let unbound: FakeWindow[]
  let binder: OwnWindowBinder<FakeWindow, Entry>

  beforeEach(() => {
    vi.useFakeTimers()
    source = new FakeSource()
    unbound = []
    binder = new OwnWindowBinder({ source, onUnbound: window => unbound.push(window) })
  })

  afterEach(() => {
    binder.dispose()
    vi.useRealTimers()
  })

  it('binds the window whose unique title the compositor reports, then restores the title', async () => {
    const main = new FakeWindow('AIRI')
    const pending = binder.bind(main)
    expect(main.title).toBe('airi-bind-1')
    source.push([{ id: 'other', caption: 'AIRI' }, { id: '{abc}', caption: 'airi-bind-1' }])
    await expect(pending).resolves.toBe('{abc}')
    expect(main.titles).toEqual(['airi-bind-1', 'AIRI'])
    expect(binder.entryFor(main)).toEqual({ id: '{abc}', caption: 'airi-bind-1' })
    source.push([{ id: '{abc}', caption: 'AIRI' }])
    expect(binder.entryFor(main)).toEqual({ id: '{abc}', caption: 'AIRI' })
  })

  it('gives every attempt a new title, so two windows never share one', async () => {
    const first = new FakeWindow('A')
    const second = new FakeWindow('B')
    const a = binder.bind(first)
    const b = binder.bind(second)
    expect([first.title, second.title]).toEqual(['airi-bind-1', 'airi-bind-2'])
    source.push([{ id: '2', caption: 'airi-bind-2' }, { id: '1', caption: 'airi-bind-1' }])
    await expect(Promise.all([a, b])).resolves.toEqual(['1', '2'])
  })

  it('leaves the window unbound after two seconds without a match', async () => {
    const main = new FakeWindow('AIRI')
    const pending = binder.bind(main)
    source.push([{ id: 'x', caption: 'airi-bind-99' }])
    await vi.advanceTimersByTimeAsync(2000)
    await expect(pending).resolves.toBeNull()
    expect(main.title).toBe('AIRI')
    expect(binder.entryFor(main)).toBeUndefined()
    expect(source.listenerCount).toBe(1)
  })

  it('does not overwrite a title the page changed during the handshake', async () => {
    const main = new FakeWindow('AIRI')
    const pending = binder.bind(main)
    main.title = 'Settings'
    await vi.advanceTimersByTimeAsync(2000)
    await pending
    expect(main.title).toBe('Settings')
  })

  it('reuses the in-flight handshake for the same window', async () => {
    const main = new FakeWindow('AIRI')
    const first = binder.bind(main)
    const second = binder.bind(main)
    expect(first).toBe(second)
    expect(main.titles).toEqual(['airi-bind-1'])
    await vi.advanceTimersByTimeAsync(2000)
  })

  it('cancels handshakes on clear and records no late match', async () => {
    const main = new FakeWindow('AIRI')
    const pending = binder.bind(main)
    binder.clear()
    await expect(pending).resolves.toBeNull()
    expect(main.title).toBe('AIRI')
    source.push([{ id: '1', caption: 'airi-bind-1' }])
    expect(binder.entryFor(main)).toBeUndefined()
  })

  it('drops a binding whose compositor window disappears or is reset', async () => {
    const main = new FakeWindow('AIRI')
    const stage = new FakeWindow('Stage')
    const a = binder.bind(main)
    const b = binder.bind(stage)
    source.push([{ id: '1', caption: 'airi-bind-1' }, { id: '2', caption: 'airi-bind-2' }])
    await Promise.all([a, b])
    source.push([{ id: '2', caption: 'Stage' }])
    expect(unbound).toEqual([main])
    expect(binder.entryFor(main)).toBeUndefined()
    source.push(null)
    expect(unbound).toEqual([main, stage])
  })

  it('moves an id to the window that most recently proved it', async () => {
    const old = new FakeWindow('old')
    const fresh = new FakeWindow('fresh')
    const a = binder.bind(old)
    source.push([{ id: '1', caption: 'airi-bind-1' }])
    await a
    const b = binder.bind(fresh)
    source.push([{ id: '1', caption: 'airi-bind-2' }])
    await b
    expect(binder.entryFor(old)).toBeUndefined()
    expect(binder.entryFor(fresh)?.id).toBe('1')
  })

  it('skips a destroyed window and unbinds on request', async () => {
    const closed = new FakeWindow('closed')
    closed.destroyed = true
    await expect(binder.bind(closed)).resolves.toBeNull()
    expect(closed.titles).toEqual([])
    const main = new FakeWindow('AIRI')
    const pending = binder.bind(main)
    source.push([{ id: '1', caption: 'airi-bind-1' }])
    await pending
    binder.unbind(main)
    expect(binder.entryFor(main)).toBeUndefined()
    expect(unbound).toEqual([])
  })
})
