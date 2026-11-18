import type { TraceRecord } from '@proj-airi/trace-kit'

import { AgentAttributes, AgentNames } from '@proj-airi/trace-kit/agent'
import { VoiceIdKeys } from '@proj-airi/trace-kit/voice'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { configureTraceTransport } from '../../../composables/use-trace'
import { useLlmStreamingControlStore } from './streaming-control'

const records: TraceRecord[] = []
let stopTransport: (() => void) | undefined

function recordsOfType<T extends TraceRecord['type']>(type: T) {
  return records.filter((record): record is Extract<TraceRecord, { type: T }> => record.type === type)
}

describe('useLlmStreamingControlStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stopTransport = configureTraceTransport({ source: 'test', clock: 'mono:test', runtime: 'test', send: record => records.push(record) })
  })

  afterEach(() => {
    stopTransport?.()
    records.length = 0
  })

  it('records the turn ID that a dispatch names, and no turn for a dispatch without one', async () => {
    const store = useLlmStreamingControlStore()

    await store.dispatchWith('<|DELAY:1|>', { turnId: 'alice-turn' })
    await store.dispatchWith('<|DELAY:1|>')

    const begins = recordsOfType('span.begin').filter(record => record.name === AgentNames.ControlDispatch)
    expect(begins.map(record => record.ids?.[VoiceIdKeys.Turn])).toEqual(['alice-turn', undefined])
  })

  it('records streaming control dispatch spans and call handler instants', async () => {
    const store = useLlmStreamingControlStore()
    const handler = vi.fn()

    store.on({
      name: 'plugin.action',
      prompt: 'Run the plugin action.',
    }, handler)

    await expect(store.dispatchWith('<|CALL ["plugin.action"]|>')).resolves.toBe(true)

    const begin = recordsOfType('span.begin').find(record => record.name === AgentNames.ControlDispatch)!
    expect(begin.track).toBe('agents/agent/control')
    expect(begin.attrs?.[AgentAttributes.ControlTokenLength]).toBe('<|CALL ["plugin.action"]|>'.length)
    const updates = Object.assign({}, ...recordsOfType('span.update').map(record => record.attrs))
    expect(updates[AgentAttributes.ControlParserName]).toBe('CALL')
    expect(updates[AgentAttributes.ControlTokenType]).toBe('call')
    expect(updates[AgentAttributes.ControlCallName]).toBe('plugin.action')
    expect(updates[AgentAttributes.ControlHandlerCount]).toBe(1)
    const instants = recordsOfType('instant')
    expect(instants.find(record => record.name === AgentNames.ControlParsed)?.attrs?.[AgentAttributes.ControlTokenType]).toBe('call')
    expect(instants.find(record => record.name === AgentNames.ControlHandlerStarted)?.attrs?.[AgentAttributes.ControlCallName]).toBe('plugin.action')
    expect(instants.find(record => record.name === AgentNames.ControlHandlerEnded)?.attrs?.[AgentAttributes.ControlCallName]).toBe('plugin.action')
    expect(recordsOfType('span.end')).toHaveLength(1)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('records rejected streaming control dispatches', async () => {
    const store = useLlmStreamingControlStore()

    await expect(store.dispatchWith('<|CALL []|>')).resolves.toBe(false)

    const rejected = recordsOfType('instant').find(record => record.name === AgentNames.ControlRejected)
    expect(rejected?.attrs?.[AgentAttributes.ControlReason]).toBe('parse-failed')
    expect(recordsOfType('span.end')).toHaveLength(1)
  })

  it('reports rejected markers of local turns to rejection listeners until they are disposed', async () => {
    const { useLlmStreamingControlStore } = await import('./streaming-control')
    const store = useLlmStreamingControlStore()
    const rejections: unknown[] = []
    const dispose = store.onRejected(rejection => rejections.push(rejection))

    await store.dispatchWith('<|ACT banana|>', { turnId: 'turn-1' })
    await store.dispatchWith('<|ACT happy|>', { turnId: 'turn-1' })
    await store.dispatchWith('<|NOPE|>', { turnId: 'turn-1' })
    // Without a turn there is nothing to attribute; a remote CALL is reported by the window that owns the turn.
    await store.dispatchWith('<|ACT banana|>')
    await store.dispatchWith('<|ACT banana|>', { turnId: 'turn-2', remote: true })
    dispose()
    await store.dispatchWith('<|ACT banana|>', { turnId: 'turn-3' })

    expect(rejections).toEqual([
      { turnId: 'turn-1', special: '<|ACT banana|>', reason: 'parse-failed' },
      { turnId: 'turn-1', special: '<|NOPE|>', reason: 'no-matching-parser' },
    ])
  })
})
