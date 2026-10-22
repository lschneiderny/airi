import type { TurnRef } from '@proj-airi/core-agent'

import { defineInvokeHandler } from '@moeru/eventa'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSpeechBusContext, voiceGetTurns, voiceInterrupt, voiceSnapshotChanged } from '../services/speech/bus'
import { useSpeechOutputControlStore } from './speech-output-control'

const cleanups: (() => void)[] = []

function createStore() {
  const pinia = createPinia()
  setActivePinia(pinia)
  cleanups.push(() => disposePinia(pinia))
  return useSpeechOutputControlStore()
}

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  localStorage.clear()
})

describe('speech output control', () => {
  it('waits for the output host receipt and targets only the selected session', async () => {
    const context = getSpeechBusContext()
    const stored = Promise.withResolvers<{ status: 'recorded' }>()
    const interrupt = vi.fn(() => stored.promise)
    cleanups.push(defineInvokeHandler(context, voiceGetTurns, () => [
      { sessionId: 'alice', turnId: 'reply-a' },
      { sessionId: 'bob', turnId: 'reply-b' },
    ]))
    cleanups.push(defineInvokeHandler(context, voiceInterrupt, interrupt))
    const sender = createStore()
    let received = false
    const request = sender.requestStopSpeaking({ reason: 'manual-chat', sessionId: 'alice' }).then((receipt) => {
      received = true
      return receipt
    })
    await vi.waitFor(() => expect(interrupt).toHaveBeenCalledWith({ turns: [{ sessionId: 'alice', turnId: 'reply-a' }], cause: 'manual-chat' }, expect.anything()))
    expect(received).toBe(false)
    stored.resolve({ status: 'recorded' })
    expect(await request).toEqual({ status: 'recorded' })
  })

  it('targets all known responses only for an explicit all-sessions command', async () => {
    const context = getSpeechBusContext()
    const turns = [{ sessionId: 'alice', turnId: 'reply-a' }, { sessionId: 'bob', turnId: 'reply-b' }]
    cleanups.push(defineInvokeHandler(context, voiceGetTurns, () => turns))
    const interrupt = vi.fn(async (_request: { turns: readonly TurnRef[], cause: string }) => ({ status: 'recorded' as const }))
    cleanups.push(defineInvokeHandler(context, voiceInterrupt, interrupt))
    expect(await createStore().requestStopSpeaking({ reason: 'manual-all' })).toEqual({ status: 'recorded' })
    expect(interrupt.mock.calls[0]?.[0]).toEqual({ turns, cause: 'manual-all' })
  })

  it('asks the next output host when the host that holds the request reloads before it answers', async () => {
    const context = getSpeechBusContext()
    const sender = createStore()
    context.emit(voiceSnapshotChanged, { connected: true, hostId: 'host-1', drafts: [] })
    // The first host takes the request, then its window reloads, so its receipt never comes.
    const received = Promise.withResolvers<void>()
    const stopFirstHost = [
      defineInvokeHandler(context, voiceGetTurns, () => [{ sessionId: 'alice', turnId: 'reply-a' }]),
      defineInvokeHandler(context, voiceInterrupt, () => {
        received.resolve()
        return new Promise<{ status: 'recorded' }>(() => {})
      }),
    ]
    const request = sender.requestStopSpeaking({ reason: 'manual-chat', sessionId: 'alice' })
    await received.promise
    stopFirstHost.forEach(stop => stop())

    // The reloaded page connects as a new host, without the responses of the old page.
    const interrupt = vi.fn(async (_request: { turns: readonly TurnRef[], cause: string }) => ({ status: 'recorded' as const }))
    cleanups.push(defineInvokeHandler(context, voiceGetTurns, () => []))
    cleanups.push(defineInvokeHandler(context, voiceInterrupt, interrupt))
    context.emit(voiceSnapshotChanged, { connected: true, hostId: 'host-2', drafts: [] })

    expect(await request).toEqual({ status: 'recorded' })
    expect(interrupt.mock.calls[0]?.[0]).toEqual({ turns: [], cause: 'manual-chat' })
  })

  it('asks the next output host when the host detaches and rejects the request, as a remounting scene does', async () => {
    const context = getSpeechBusContext()
    const sender = createStore()
    context.emit(voiceSnapshotChanged, { connected: true, hostId: 'host-1', drafts: [] })
    const detached = Promise.withResolvers<void>()
    const stopFirstHost = [
      defineInvokeHandler(context, voiceGetTurns, () => [{ sessionId: 'alice', turnId: 'reply-a' }]),
      defineInvokeHandler(context, voiceInterrupt, async () => {
        // The scene unmounts while the host records the interruption: the host disconnects first, then rejects.
        context.emit(voiceSnapshotChanged, { connected: false, drafts: [] })
        detached.resolve()
        throw new Error('Voice output host detached')
      }),
    ]
    const request = sender.requestStopSpeaking({ reason: 'manual-chat', sessionId: 'alice' })
    await detached.promise
    stopFirstHost.forEach(stop => stop())

    // The remounted scene connects as a new host. No timer runs, so only its connection can settle the request.
    cleanups.push(defineInvokeHandler(context, voiceGetTurns, () => []))
    cleanups.push(defineInvokeHandler(context, voiceInterrupt, async () => ({ status: 'recorded' as const })))
    context.emit(voiceSnapshotChanged, { connected: true, hostId: 'host-2', drafts: [] })

    expect(await request).toEqual({ status: 'recorded' })
  })

  it('fails at once when a connected host rejects the request', async () => {
    const context = getSpeechBusContext()
    const sender = createStore()
    context.emit(voiceSnapshotChanged, { connected: true, hostId: 'host-1', drafts: [] })
    cleanups.push(defineInvokeHandler(context, voiceGetTurns, () => []))
    cleanups.push(defineInvokeHandler(context, voiceInterrupt, async () => {
      throw new Error('Interruption failed')
    }))

    await expect(sender.requestStopSpeaking({ reason: 'manual-all' })).rejects.toThrow('Interruption failed')
  })

  it('waits for the next output host while the previous one is disconnected, and fails when none returns', async () => {
    const context = getSpeechBusContext()
    const sender = createStore()
    context.emit(voiceSnapshotChanged, { connected: true, hostId: 'host-1', drafts: [] })
    // The host detaches as its page hides, before it answers.
    context.emit(voiceSnapshotChanged, { connected: false, drafts: [] })
    const request = sender.requestStopSpeaking({ reason: 'manual-chat', sessionId: 'alice' })

    cleanups.push(defineInvokeHandler(context, voiceGetTurns, () => []))
    cleanups.push(defineInvokeHandler(context, voiceInterrupt, async () => ({ status: 'recorded' as const })))
    context.emit(voiceSnapshotChanged, { connected: true, hostId: 'host-2', drafts: [] })
    expect(await request).toEqual({ status: 'recorded' })

    vi.useFakeTimers()
    try {
      context.emit(voiceSnapshotChanged, { connected: false, drafts: [] })
      cleanups.splice(-2).forEach(cleanup => cleanup())
      const unanswered = expect(sender.requestStopSpeaking({ reason: 'manual-all' })).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(10_000)
      await unanswered
    }
    finally {
      vi.useRealTimers()
    }
  })
})
