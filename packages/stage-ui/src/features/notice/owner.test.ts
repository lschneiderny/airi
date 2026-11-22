import type { ChatHistoryItem } from '@proj-airi/core-agent'

import type { NoticePorts } from './owner'

import { describe, expect, it, vi } from 'vitest'

import { NoticeOwner } from './owner'

function harness() {
  const messages: ChatHistoryItem[] = []
  let generation = 1
  const target = () => ({ characterId: 'character-a', generation, owner: true })
  const commit = vi.fn<NoticePorts['session']['commit']>(async (_sessionId, message) => {
    const existing = messages.some(item => item.id === message.id)
    if (!existing)
      messages.push(message)
    return { status: existing ? 'existing' : 'inserted', messageId: message.id }
  })
  const run = vi.fn<NoticePorts['run']>(async () => ({ status: 'spoken', text: 'The task finished.' }))
  const request = vi.fn<NoticePorts['request']>()
  const ports: NoticePorts = {
    session: {
      target,
      load: async () => true,
      messages: () => messages,
      commit,
      store: async (_sessionId, message) => {
        messages.splice(messages.findIndex(item => item.id === message.id), 1, message)
      },
    },
    now: () => 1_700_000_000_000,
    createId: () => 'notice-1',
    request,
    run,
    cancel: vi.fn(),
  }
  const owner = new NoticeOwner(ports)
  request.mockImplementation(async record => owner.execute(record.target))
  return { owner, messages, commit, request, run, ports, reset: () => generation++ }
}

const notice = { source: 'host:task', text: 'Controlled result.', messageId: 'notice-1' }

describe('notice storage owner', () => {
  it('never announces a failed commit or a non-owner target', async () => {
    const { owner, ports, request, commit } = harness()
    ports.session.target = () => ({ characterId: 'character-a', generation: 1, owner: false })
    expect(await owner.deliver('scene-1', notice)).toBeUndefined()
    expect(commit).not.toHaveBeenCalled()
    ports.session.target = () => ({ characterId: 'character-a', generation: 1, owner: true })
    commit.mockRejectedValueOnce(new Error('Storage unavailable'))
    await expect(owner.deliver('session-1', notice)).rejects.toThrow('Storage unavailable')
    expect(request).not.toHaveBeenCalled()
  })

  it('acknowledges storage before an admission result and deduplicates concurrent and later deliveries', async () => {
    const { owner, messages, ports, request, run } = harness()
    const committed = Promise.withResolvers<void>()
    const admission = Promise.withResolvers<void>()
    const original = ports.session.commit
    ports.session.commit = async (...args) => {
      const result = await original(...args)
      committed.resolve()
      return result
    }
    request.mockImplementationOnce(async () => admission.promise)
    const first = owner.deliver('session-1', notice)
    const receipt = owner.deliver('session-1', notice, { waitForCompletion: false })
    await committed.promise
    expect(await receipt).toEqual({ sessionId: 'session-1', messageId: notice.messageId })
    expect(messages).toHaveLength(1)
    expect(request).toHaveBeenCalledOnce()
    expect(run).not.toHaveBeenCalled()
    admission.resolve()
    await first
    await owner.deliver('session-1', notice)
    expect(messages).toHaveLength(1)
    expect(request).toHaveBeenCalledOnce()
  })

  it('never stores an aborted or replaced target and detaches cancellation after acceptance', async () => {
    const { owner, messages, request, run, ports } = harness()
    const loading = Promise.withResolvers<boolean>()
    const started = Promise.withResolvers<void>()
    ports.session.load = async () => {
      started.resolve()
      return loading.promise
    }
    const control = new AbortController()
    const pending = owner.deliver('session-1', notice, { signal: control.signal })
    await started.promise
    control.abort()
    loading.resolve(true)
    expect(await pending).toBeUndefined()
    expect(messages).toEqual([])
    expect(request).not.toHaveBeenCalled()
    ports.session.load = async () => true
    const admission = Promise.withResolvers<void>()
    request.mockImplementationOnce(async (record) => {
      await admission.promise
      return owner.execute(record.target)
    })
    const second = new AbortController()
    await owner.deliver('session-1', notice, { signal: second.signal, waitForCompletion: false })
    const done = owner.deliver('session-1', notice)
    second.abort()
    admission.resolve()
    await done
    expect(run).toHaveBeenCalledOnce()
    expect(messages).toHaveLength(1)
  })

  it('rechecks the original intersection at execution and cannot regain a removed tool through a notice chain', async () => {
    const { owner, messages, request, run } = harness()
    messages.push({ role: 'user', id: 'source-turn', content: 'Do the task', tools: [{ name: 'kept' }, { name: 'removed' }, { name: 'unselected' }] })
    const admission = Promise.withResolvers<void>()
    request.mockImplementationOnce(async (record) => {
      await admission.promise
      return owner.execute(record.target)
    })
    await owner.deliver('session-1', notice, { waitForCompletion: false, continueFrom: { turnId: 'source-turn', tools: [{ name: 'kept' }, { name: 'removed' }, { name: 'forged' }] } })
    const done = owner.deliver('session-1', notice)
    messages[0].tools = [{ name: 'kept' }]
    admission.resolve()
    await done
    expect(run.mock.calls[0][0].tools).toEqual([{ name: 'kept' }])
    // The next request must also intersect the original accepted notice's stored references.
    await owner.deliver('session-1', { ...notice, messageId: 'notice-2' }, { continueFrom: { turnId: 'notice-1', tools: [{ name: 'kept' }, { name: 'removed' }, { name: 'forged' }] } })
    expect(run.mock.calls[1][0].tools).toEqual([{ name: 'kept' }])
  })

  it('settles waiters on disposal and rejects execution against a reset session', async () => {
    const { owner, request, reset, run } = harness()
    const admission = Promise.withResolvers<void>()
    request.mockImplementationOnce(async (record) => {
      await admission.promise
      return owner.execute(record.target)
    })
    await owner.deliver('session-1', notice, { waitForCompletion: false })
    const done = owner.deliver('session-1', notice)
    reset()
    admission.resolve()
    await done
    expect(run).not.toHaveBeenCalled()
    request.mockImplementationOnce(async () => new Promise(() => {}))
    await owner.deliver('session-1', { ...notice, messageId: 'notice-2' }, { waitForCompletion: false })
    const disposed = owner.deliver('session-1', { ...notice, messageId: 'notice-2' })
    owner.dispose()
    expect(await disposed).toEqual({ sessionId: 'session-1', messageId: 'notice-2' })
  })
})
