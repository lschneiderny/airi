import type { ElectronRendererEmitOptions } from '@moeru/eventa/adapters/electron/renderer'

import type { GoChunk, GoRequest } from '../../shared/eventa/opencode-go'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { createOpenCodeGoDesktopProvider } from '@proj-airi/stage-ui/libs/providers/providers/opencode-go/index'
import { describe, expect, it, vi } from 'vitest'

import { goCancelRequest, goGetConfiguration, goOpenRequest, goReadChunk } from '../../shared/eventa/opencode-go'
import { GoClient } from './opencode-go-client'

function fixture() {
  const context = createContext<undefined, ElectronRendererEmitOptions>()
  const requests: GoRequest[] = []
  const bodies = new Map<string, Uint8Array[]>()
  const cancel = vi.fn()
  const read = vi.fn(({ requestId }: { requestId: string }): GoChunk => {
    const data = bodies.get(requestId)?.shift()
    return data ? { done: false, data } : { done: true }
  })
  defineInvokeHandler(context, goGetConfiguration, () => ({ configured: true, revision: 1, keyPreview: '****1234' }))
  defineInvokeHandler(context, goCancelRequest, cancel)
  defineInvokeHandler(context, goReadChunk, read)
  defineInvokeHandler(context, goOpenRequest, (request) => {
    requests.push(request)
    const value = request.operation === 'models'
      ? { data: [{ id: 'glm-5.3' }, { id: 'unknown-provider-model' }] }
      : { id: 'completion', object: 'chat.completion', created: 0, model: 'glm-5.3', choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
    bodies.set(request.requestId, [new TextEncoder().encode(JSON.stringify(value))])
    return { status: 200, statusText: 'OK', headers: [['content-type', 'application/json']] }
  })
  return { context, client: new GoClient(context), requests, bodies, read, cancel }
}

describe('go renderer transport', () => {
  it('pulls response bytes only when the consumer reads', async () => {
    const state = fixture()
    const response = await state.client.fetch('profile-1')('https://opencode.ai/inference/go/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-opencode-session': 'conversation-42', 'Authorization': 'Bearer renderer-value' },
      body: JSON.stringify({ model: 'glm-5.3', messages: [] }),
    })

    expect(state.read).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ choices: [{ message: { content: 'pong' } }] })
    expect(state.requests).toEqual([expect.objectContaining({
      providerId: 'profile-1',
      operation: 'chat',
      sessionId: 'conversation-42',
    })])
    expect(state.requests[0]).not.toHaveProperty('headers')
    expect(state.requests[0]).not.toHaveProperty('apiKey')
    expect(state.read).toHaveBeenCalledTimes(2)
  })

  it('runs discovery and every validation probe through the same IPC transport', async () => {
    const state = fixture()
    const definition = createOpenCodeGoDesktopProvider(state.client)
    const config = { credentialId: 'profile-2', credentialRevision: 1, baseUrl: 'https://opencode.ai/inference/go/v1/' as const }
    const provider = await definition.createProvider(config)
    const extra = definition.extraMethods
    if (!extra)
      throw new Error('Go model discovery is missing')
    const validators = await Promise.all((definition.validators?.validateProvider ?? []).map(create => create({ t: key => key })))

    expect(await extra.listModels?.(config, provider)).toEqual([{ id: 'glm-5.3', name: 'GLM 5.3', provider: 'opencode-go' }])
    for (const validator of validators) {
      const result = await validator.validator(config, provider, extra, { t: key => key })
      expect(result.valid, `${validator.id}: ${result.reason}`).toBe(true)
    }

    expect(validators).toHaveLength(3)
    expect(state.requests.filter(request => request.operation === 'models')).toHaveLength(4)
    expect(state.requests.filter(request => request.operation === 'chat')).toHaveLength(1)
    expect(state.requests.every(request => request.providerId === 'profile-2')).toBe(true)
    expect(state.cancel).toHaveBeenCalledTimes(1)
  })

  it('cancels the owning main request when its signal aborts', async () => {
    const state = fixture()
    const reading = Promise.withResolvers<void>()
    const cancelled = Promise.withResolvers<void>()
    defineInvokeHandler(state.context, goCancelRequest, () => cancelled.resolve())
    defineInvokeHandler(state.context, goReadChunk, async (_, options) => {
      const signal = options?.abortController?.signal
      if (!signal)
        throw new Error('The read must have a cancellation signal')
      return new Promise<GoChunk>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        reading.resolve()
      })
    })
    const controller = new AbortController()
    const response = await state.client.fetch('profile-3')('https://opencode.ai/inference/go/v1/models', { signal: controller.signal })
    const body = response.text()
    await reading.promise

    controller.abort(new DOMException('Cancelled', 'AbortError'))

    await expect(body).rejects.toMatchObject({ name: 'AbortError' })
    await cancelled.promise
  })

  it('does not open an IPC request for an unsupported destination', async () => {
    const state = fixture()

    await expect(state.client.fetch('profile-4')('https://other.example/chat/completions', { method: 'POST' })).rejects.toBeInstanceOf(TypeError)

    expect(state.requests).toHaveLength(0)
  })
})
