import type { ModelInfo } from '../../../types'

import { createChatProvider, createModelProvider, merge } from '@xsai-ext/providers/utils'
import { z } from 'zod'

import { isModelProvider, ProviderValidationCheck } from '../../../types'
import { createOpenAICompatibleValidators } from '../../../validators'
import { defineProvider } from '../../registry'

const anthropicConfigSchema = z.object({
  apiKey: z
    .string('API Key'),
  baseUrl: z
    .string('Base URL')
    .optional()
    .default('https://api.anthropic.com/v1/'),
})

type AnthropicConfig = z.input<typeof anthropicConfigSchema>

/** The fields AIRI reads from an Anthropic `GET /v1/models` entry. */
interface AnthropicModel {
  id: string
  display_name?: string
  lifecycle?: 'active' | 'deprecated' | 'retired'
  max_input_tokens?: number | null
  capabilities?: { image_input?: { supported: boolean } } | null
}

function toModelInfo(model: AnthropicModel): ModelInfo {
  const vision = model.capabilities?.image_input?.supported
  return {
    id: model.id,
    name: model.display_name ?? model.id,
    provider: 'anthropic',
    ...(vision === undefined ? {} : { metadata: { abilities: { vision } } }),
    ...(model.max_input_tokens ? { contextLength: model.max_input_tokens } : {}),
    deprecated: model.lifecycle === 'deprecated',
  }
}

function createAnthropic(apiKey: string, baseURL: string = 'https://api.anthropic.com/v1/') {
  const anthropicFetch = async (input: any, init: any) => {
    init.headers ??= {}
    if (Array.isArray(init.headers))
      init.headers.push(['anthropic-dangerous-direct-browser-access', 'true'])
    else if (init.headers instanceof Headers)
      init.headers.append('anthropic-dangerous-direct-browser-access', 'true')
    else
      init.headers['anthropic-dangerous-direct-browser-access'] = 'true'

    return fetch(input, init)
  }

  return merge(
    createChatProvider({ apiKey, fetch: anthropicFetch, baseURL }),
    createModelProvider({ apiKey, fetch: anthropicFetch, baseURL }),
  )
}

export const providerAnthropic = defineProvider<AnthropicConfig, 'anthropic'>({
  id: 'anthropic',
  order: 6,
  name: 'Anthropic',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.anthropic.title'),
  description: 'anthropic.com',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.anthropic.description'),
  tasks: ['chat'],
  icon: 'i-lobe-icons:claude',
  iconColor: 'i-lobe-icons:claude-color',

  createProviderConfig: ({ t }) => anthropicConfigSchema.extend({
    apiKey: anthropicConfigSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: anthropicConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
  }),
  createProvider(config) {
    return createAnthropic(config.apiKey, config.baseUrl)
  },

  extraMethods: {
    // The endpoint lists active and deprecated models by default and pages at
    // 20, so request the largest page to get the whole catalog in one call.
    listModels: async (_config, provider) => {
      if (!isModelProvider(provider))
        throw new Error('Anthropic provider must support model listing')

      const { apiKey, baseURL, fetch = globalThis.fetch } = provider.model()
      const url = new URL('models', String(baseURL).endsWith('/') ? String(baseURL) : `${baseURL}/`)
      url.searchParams.set('limit', '1000')
      // The native models endpoint requires its own version and key headers,
      // unlike the OpenAI-compatible chat endpoint.
      const response = await fetch(url, {
        headers: {
          'anthropic-version': '2023-06-01',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
      })
      if (!response.ok)
        throw new Error(`Failed to list Anthropic models: HTTP ${response.status} ${await response.text()}`)

      const { data } = await response.json() as { data: AnthropicModel[] }
      return data.filter(model => model.lifecycle !== 'retired').map(toModelInfo)
    },
  },
  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },
  validators: {
    ...createOpenAICompatibleValidators({
      checks: [ProviderValidationCheck.Connectivity, ProviderValidationCheck.ChatCompletions],
      additionalHeaders: {
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    }),
  },
})
