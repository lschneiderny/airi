import type { ElectronRendererEmitOptions } from '@moeru/eventa/adapters/electron/renderer'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { describe, expect, it, vi } from 'vitest'

import { goGetConfiguration, goSetConfiguration } from '../../shared/eventa/opencode-go'
import { GoClient } from './opencode-go-client'
import { migrateGoCredentials } from './opencode-go-migration'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function fixture() {
  const context = createContext<undefined, ElectronRendererEmitOptions>()
  const storage = new MemoryStorage()
  const saved = { configured: true, revision: 2, keyPreview: '****' }
  const set = vi.fn(() => saved)
  defineInvokeHandler(context, goSetConfiguration, set)
  defineInvokeHandler(context, goGetConfiguration, () => saved)
  storage.setItem('settings/providers/configured', JSON.stringify({
    'custom-go': { id: 'custom-go', definitionId: 'opencode-go', config: { apiKey: 'newer-key', model: 'glm-5.3' }, status: 'configured' },
    'other': { id: 'other', definitionId: 'openai', config: { apiKey: 'other-key' } },
  }))
  storage.setItem('settings/credentials/providers', JSON.stringify({ 'opencode-go': { apiKey: 'older-key' }, 'other': { apiKey: 'other-key' } }))
  return { context, storage, saved, set, client: new GoClient(context) }
}

describe('go desktop credential transfer', () => {
  it('preserves other providers and replaces Go keys with main-owned references', async () => {
    const state = fixture()

    await migrateGoCredentials(state.storage, state.client)

    const configured = JSON.parse(state.storage.getItem('settings/providers/configured') ?? '{}')
    expect(configured['custom-go'].config).toEqual({
      model: 'glm-5.3',
      credentialId: 'custom-go',
      credentialRevision: 2,
      baseUrl: 'https://opencode.ai/inference/go/v1/',
    })
    expect(configured.other.config.apiKey).toBe('other-key')
    expect(configured['opencode-go'].config.credentialId).toBe('opencode-go')
    expect(JSON.parse(state.storage.getItem('settings/credentials/providers') ?? '{}')).toEqual({ other: { apiKey: 'other-key' } })
    expect(state.set).toHaveBeenCalledWith({ providerId: 'custom-go', apiKey: 'newer-key' }, expect.anything())
  })

  it('retains renderer copies until main acknowledges a durable save', async () => {
    const state = fixture()
    const entered = Promise.withResolvers<void>()
    const acknowledged = Promise.withResolvers<typeof state.saved>()
    defineInvokeHandler(state.context, goSetConfiguration, () => {
      entered.resolve()
      return acknowledged.promise
    })
    const original = state.storage.getItem('settings/providers/configured')
    const transfer = migrateGoCredentials(state.storage, state.client)
    await entered.promise

    expect(state.storage.getItem('settings/providers/configured')).toBe(original)
    acknowledged.resolve(state.saved)
    await transfer

    expect(state.storage.getItem('settings/providers/configured')).not.toContain('newer-key')
  })

  it('does not remove keys when main rejects the transfer', async () => {
    const state = fixture()
    const original = state.storage.getItem('settings/providers/configured')
    defineInvokeHandler(state.context, goSetConfiguration, () => {
      throw new Error('Credential storage unavailable')
    })

    await expect(migrateGoCredentials(state.storage, state.client)).rejects.toBeInstanceOf(Error)

    expect(state.storage.getItem('settings/providers/configured')).toBe(original)
    expect(state.storage.getItem('settings/credentials/providers')).toContain('older-key')
  })

  it('does not retarget a custom endpoint credential to the official Go service', async () => {
    const state = fixture()
    const records = JSON.parse(state.storage.getItem('settings/providers/configured') ?? '{}')
    records['custom-go'].config.baseUrl = 'https://proxy.example/v1/'
    const original = JSON.stringify(records)
    state.storage.setItem('settings/providers/configured', original)

    await expect(migrateGoCredentials(state.storage, state.client)).rejects.toBeInstanceOf(Error)

    expect(state.set).not.toHaveBeenCalled()
    expect(state.storage.getItem('settings/providers/configured')).toBe(original)
  })
})
