import type { ElectronRendererEmitOptions } from '@moeru/eventa/adapters/electron/renderer'

import { createContext, defineInvokeHandler } from '@moeru/eventa'
import { PiniaColada } from '@pinia/colada'
import { createOpenCodeGoDesktopProvider } from '@proj-airi/stage-ui/libs/providers/providers/opencode-go/index'
import { defineProvider } from '@proj-airi/stage-ui/libs/providers/providers/registry'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import GoSettings from './opencode-go-settings.vue'

import { goCancelRequest, goGetConfiguration, goOpenRequest, goReadChunk, goSetConfiguration } from '../../shared/eventa/opencode-go'
import { GoClient } from '../bridges/opencode-go-client'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'
import 'virtual:uno.css'

const boundary = vi.hoisted(() => ({ client: vi.fn<() => GoClient>() }))
// Only the native IPC connection is replaced. The form, provider, stores, SDK,
// and validation composable remain the production implementations.
vi.mock('../bridges/opencode-go', () => ({ getGoClient: boundary.client }))

async function mountSettings(retainedKey?: string) {
  if (retainedKey) {
    localStorage.setItem('settings/providers/configured', JSON.stringify({
      'opencode-go': { id: 'opencode-go', definitionId: 'opencode-go', config: { apiKey: retainedKey }, status: 'unconfigured' },
    }))
  }
  const context = createContext<undefined, ElectronRendererEmitOptions>()
  const client = new GoClient(context)
  boundary.client.mockReturnValue(client)
  defineProvider(createOpenCodeGoDesktopProvider(client))
  let configured = false
  let revision = 0
  const updated = Promise.withResolvers<void>()
  const set = vi.fn(({ apiKey }: { apiKey: string }) => {
    configured = Boolean(apiKey.trim())
    revision++
    updated.resolve()
    return { configured, revision, keyPreview: configured ? '****1234' : '' }
  })
  defineInvokeHandler(context, goSetConfiguration, set)
  defineInvokeHandler(context, goGetConfiguration, () => ({ configured, revision, keyPreview: '' }))
  const bodies = new Map<string, Uint8Array>()
  defineInvokeHandler(context, goOpenRequest, ({ requestId }) => {
    bodies.set(requestId, new TextEncoder().encode(JSON.stringify({ data: [{ id: 'glm-5.3' }] })))
    return { status: 200, statusText: 'OK', headers: [] }
  })
  defineInvokeHandler(context, goReadChunk, ({ requestId }) => {
    const data = bodies.get(requestId)
    bodies.delete(requestId)
    return data ? { done: false as const, data } : { done: true as const }
  })
  defineInvokeHandler(context, goCancelRequest, ({ requestId }) => {
    bodies.delete(requestId)
  })
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/')
  await router.isReady()
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })
  await page.viewport(1100, 900)
  const view = await render(GoSettings, {
    props: { providerId: 'opencode-go' },
    global: { plugins: [pinia, PiniaColada, i18n, router], directives: { motion: {} } },
  })
  return { view, pinia, set, updated, context, client }
}

describe('go desktop credential settings', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('keeps a typed key out of synchronized configuration until an explicit save', async () => {
    const state = await mountSettings()
    const input = page.getByLabelText('settings.pages.providers.common.fields.field.api-key.label', { exact: false })
    await input.fill('fixture-go-key-1234')

    expect(state.set).not.toHaveBeenCalled()
    expect(localStorage.getItem('settings/providers/configured')).not.toContain('fixture-go-key-1234')
    await page.getByRole('button', { name: 'settings.common.save', exact: true }).click()
    await state.updated.promise
    await expect.element(input).toHaveValue('')
    expect(state.set).toHaveBeenCalledWith({ providerId: 'opencode-go', apiKey: 'fixture-go-key-1234' }, expect.anything())
    expect(useProviderConfigStore(state.pinia).getProviderConfig('opencode-go')).not.toHaveProperty('apiKey')
    expect(localStorage.getItem('settings/providers/configured')).not.toContain('fixture-go-key-1234')
    await state.view.unmount()
  })

  it('preserves a key retained after a failed startup transfer when settings open', async () => {
    const state = await mountSettings('retained-fixture-key')
    await state.client.getConfiguration('opencode-go')

    await expect.element(page.getByLabelText('settings.pages.providers.common.fields.field.api-key.label', { exact: false })).toHaveValue('')
    expect(useProviderConfigStore(state.pinia).getProviderConfig('opencode-go')?.apiKey).toBe('retained-fixture-key')
    expect(localStorage.getItem('settings/providers/configured')).toContain('retained-fixture-key')
    expect(state.set).not.toHaveBeenCalled()
    await state.view.unmount()
  })

  it('clears the main credential before resetting its public configuration', async () => {
    const state = await mountSettings()
    await page.getByLabelText('settings.pages.providers.common.fields.field.api-key.label', { exact: false }).fill('fixture-go-key-1234')
    await page.getByRole('button', { name: 'settings.common.save', exact: true }).click()
    const clear = page.getByRole('button', { name: 'settings.pages.providers.provider.opencode-go.desktop.clear', exact: true })
    await expect.element(clear).toBeEnabled()

    await clear.click()

    await expect.element(clear).toBeDisabled()
    expect(state.set.mock.calls.map(([input]) => input.apiKey)).toEqual(['fixture-go-key-1234', ''])
    expect(useProviderConfigStore(state.pinia).getProviderConfig('opencode-go')).not.toHaveProperty('apiKey')
    await state.view.unmount()
  })

  it('shows a save rejection without persisting the draft key', async () => {
    const state = await mountSettings()
    defineInvokeHandler(state.context, goSetConfiguration, () => {
      throw new Error('Credential storage unavailable')
    })
    const input = page.getByLabelText('settings.pages.providers.common.fields.field.api-key.label', { exact: false })
    await input.fill('unsaved-fixture-key')

    await page.getByRole('button', { name: 'settings.common.save', exact: true }).click()

    await expect.element(page.getByRole('alert')).toBeVisible()
    await expect.element(input).toHaveValue('unsaved-fixture-key')
    expect(localStorage.getItem('settings/providers/configured')).not.toContain('unsaved-fixture-key')
    await state.view.unmount()
  })
})
