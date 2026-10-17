import type { GenerationRequest, ModelInfo } from '../../../types'

import { createOpenAI } from '@xsai-ext/providers/create'
import { listModels } from '@xsai/model'
import { z } from 'zod'

import { isModelProvider, ProviderValidationCheck } from '../../../types'
import { createOpenAICompatibleValidators } from '../../../validators'
import { defineProvider } from '../../registry'

const baseUrl = 'https://opencode.ai/inference/go/v1'
const headers: Record<string, string> = typeof window === 'undefined'
  ? { 'User-Agent': 'Project-AIRI' }
  : {}

const models: ModelInfo[] = [
  { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', provider: 'opencode-go' },
  { id: 'glm-5.3', name: 'GLM 5.3', provider: 'opencode-go' },
  { id: 'glm-5.2', name: 'GLM 5.2', provider: 'opencode-go' },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', provider: 'opencode-go' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'opencode-go' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'opencode-go' },
  { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision Exp', provider: 'opencode-go' },
  { id: 'kimi-k3', name: 'Kimi K3', provider: 'opencode-go' },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', provider: 'opencode-go' },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', provider: 'opencode-go' },
  { id: 'longcat-2.0', name: 'LongCat 2.0', provider: 'opencode-go' },
  { id: 'mimo-v2.6-flash', name: 'MiMo V2.6 Flash', provider: 'opencode-go' },
  { id: 'mimo-v2.6-pro', name: 'MiMo V2.6 Pro', provider: 'opencode-go' },
  { id: 'mimo-v2.5', name: 'MiMo V2.5', provider: 'opencode-go' },
  { id: 'mimo-v2.5-pro', name: 'MiMo V2.5 Pro', provider: 'opencode-go' },
  { id: 'hy4-preview', name: 'Hy4 Preview', provider: 'opencode-go' },
  { id: 'hy3', name: 'Hy3', provider: 'opencode-go' },
  { id: 'space-bunny', name: 'Space Bunny', provider: 'opencode-go' },
  { id: 'longcat-2.5-preview-free', name: 'LongCat 2.5 Preview Free', provider: 'opencode-go' },
  { id: 'step-5-preview-free', name: 'Step 5 Preview Free', provider: 'opencode-go' },
  { id: 'cat-jam-free', name: 'Cat Jam Free', provider: 'opencode-go' },
]

const configSchema = z.object({
  apiKey: z.string('API Key'),
  baseUrl: z.string('Base URL').optional().default(baseUrl),
})

type Config = z.input<typeof configSchema>

export const providerOpenCodeGo = defineProvider<Config, 'opencode-go'>({
  id: 'opencode-go',
  order: 5,
  name: 'OpenCode Go',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.opencode-go.title'),
  description: 'OpenCode Go chat models',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.opencode-go.description'),
  tasks: ['chat'],
  capabilities: { chat: { generation: { supportedProtocols: ['chat-completions'], defaultProtocol: 'chat-completions' } } },
  icon: 'i-lobe-icons:opencode',

  createProviderConfig: ({ t }) => configSchema.extend({
    apiKey: configSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: configSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
  }),
  createProvider(config) {
    const provider = createOpenAI(config.apiKey, config.baseUrl)
    return {
      model: provider.model,
      generation(model: string): GenerationRequest {
        return {
          protocol: 'chat-completions',
          config: {
            ...provider.chat(model),
            headers,
          },
        }
      },
    }
  },

  extraMethods: {
    listModels: async (config, provider) => {
      const fetch = isModelProvider(provider) ? provider.model().fetch : undefined
      const available = new Set((await listModels({
        apiKey: config.apiKey,
        baseURL: config.baseUrl ?? baseUrl,
        headers,
        ...(fetch ? { fetch } : {}),
      })).map(model => model.id))
      return models.filter(model => available.has(model.id))
    },
  },
  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },
  validators: {
    ...createOpenAICompatibleValidators({
      checks: [ProviderValidationCheck.Connectivity, ProviderValidationCheck.ModelList, ProviderValidationCheck.ChatCompletions],
      additionalHeaders: headers,
    }),
  },
})
