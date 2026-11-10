import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { onWindowClosed } from './on-window-closed'

describe('onWindowClosed', () => {
  it('runs the callbacks of a window in registration order through one closed listener', () => {
    const window = new EventEmitter()
    const other = new EventEmitter()
    const calls: string[] = []
    onWindowClosed(window, () => calls.push('first'))
    onWindowClosed(window, () => calls.push('second'))
    onWindowClosed(other, () => calls.push('other'))
    onWindowClosed(window, () => calls.push('third'))

    expect(window.listenerCount('closed')).toBe(1)
    window.emit('closed')

    expect(calls).toEqual(['first', 'second', 'third'])
    expect(window.listenerCount('closed')).toBe(0)
  })

  it('does not run a cancelled callback, and cancels one registration at a time', () => {
    const window = new EventEmitter()
    const cancelled = vi.fn()
    const twice = vi.fn()
    onWindowClosed(window, cancelled)()
    const cancelOne = onWindowClosed(window, twice)
    onWindowClosed(window, twice)
    cancelOne()
    cancelOne()

    window.emit('closed')

    expect(cancelled).not.toHaveBeenCalled()
    expect(twice).toHaveBeenCalledTimes(1)
  })

  it('runs every callback when one throws, then throws that error', () => {
    const window = new EventEmitter()
    const failure = new Error('cleanup failed')
    const after = vi.fn()
    onWindowClosed(window, () => {
      throw failure
    })
    onWindowClosed(window, after)

    expect(() => window.emit('closed')).toThrow(failure)
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('throws several failures as one AggregateError', () => {
    const window = new EventEmitter()
    const failures = [new Error('first'), new Error('second')]
    for (const failure of failures) {
      onWindowClosed(window, () => {
        throw failure
      })
    }

    let thrown: unknown
    try {
      window.emit('closed')
    }
    catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AggregateError)
    expect((thrown as AggregateError).errors).toEqual(failures)
  })
})
