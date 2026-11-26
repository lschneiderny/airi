import type { ChatRequestOptions } from '../../../types'

import { createOllama } from '@xsai-ext/providers/create'
import { z } from 'zod'

import { ProviderValidationCheck } from '../../../types'
import { createOpenAICompatibleValidators } from '../../../validators'
import { defineProvider } from '../../registry'

type OllamaReasoningEffort = 'high' | 'low' | 'medium' | 'none'
type OllamaThinkingMode = 'auto' | 'disable' | 'enable' | 'high' | 'low' | 'medium'

const ollamaConfigSchema = z.object({
  baseUrl: z.string()
    .default('http://localhost:11434/v1/'),
  thinkingMode: z.enum(['auto', 'disable', 'enable', 'low', 'medium', 'high'])
    .default('auto'),
  headers: z.record(z.string(), z.string())
    .optional(),
})

type OllamaConfig = z.input<typeof ollamaConfigSchema>

interface OllamaModelEntry {
  name: string
  size?: number
}

/** The native API sits beside the OpenAI-compatible `/v1/` root. */
function ollamaNativeUrl(config: OllamaConfig, path: string) {
  const baseUrl = config.baseUrl || ollamaConfigSchema.shape.baseUrl.parse(undefined)
  return new URL(`../api/${path}`, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
}

async function fetchOllamaModels(config: OllamaConfig, path: 'ps' | 'tags'): Promise<OllamaModelEntry[]> {
  const response = await fetch(ollamaNativeUrl(config, path), { headers: config.headers })
  if (!response.ok)
    return []

  const body = await response.json() as { models?: Array<Partial<OllamaModelEntry>> }
  return (body.models ?? []).filter((model): model is OllamaModelEntry => !!model.name)
}

/** Embedding-only models such as `all-minilm` lack the `completion` capability and cannot answer a chat ping. */
async function canChat(config: OllamaConfig, model: string) {
  const response = await fetch(ollamaNativeUrl(config, 'show'), {
    method: 'POST',
    headers: { ...config.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  })
  if (!response.ok)
    return false

  const body = await response.json() as { capabilities?: string[] }
  return body.capabilities?.includes('completion') ?? false
}

async function firstChatModel(config: OllamaConfig, models: OllamaModelEntry[]) {
  for (const model of models) {
    if (await canChat(config, model.name))
      return model.name
  }
}

/**
 * Picks the model the chat probe pings. A probe loads its model into memory, which takes
 * minutes for a large model and can evict the one the character uses. The probe prefers a
 * loaded chat model, then the smallest installed one.
 *
 * @example
 * await pickOllamaValidationModel({ baseUrl: 'http://localhost:11434/v1/' })
 * // => 'gemma4:e4b-it-qat' (loaded), rather than the first listed 'gemma4:12b-it-qat'
 */
export async function pickOllamaValidationModel(config: OllamaConfig): Promise<string | undefined> {
  const loaded = await firstChatModel(config, await fetchOllamaModels(config, 'ps'))
  if (loaded)
    return loaded

  const installed = await fetchOllamaModels(config, 'tags')
  return firstChatModel(config, installed.toSorted((a, b) => (a.size ?? Infinity) - (b.size ?? Infinity)))
}

function normalizeOllamaThinkingMode(value: unknown): OllamaThinkingMode {
  switch (value) {
    case 'auto':
    case 'disable':
    case 'enable':
    case 'high':
    case 'low':
    case 'medium':
      return value
    default:
      return 'auto'
  }
}

/**
 * Maps the persisted Ollama setting to its OpenAI-compatible effort value.
 *
 * @example
 * resolveOllamaReasoningEffort('disable')
 * // => 'none'
 */
export function resolveOllamaReasoningEffort(modeRaw: unknown): OllamaReasoningEffort | undefined {
  const mode = normalizeOllamaThinkingMode(modeRaw)

  switch (mode) {
    case 'auto':
      return undefined
    case 'disable':
      return 'none'
    case 'enable':
      return 'medium'
    case 'low':
    case 'medium':
    case 'high':
      return mode
    default:
      return undefined
  }
}

export const providerOllama = defineProvider<OllamaConfig, 'ollama'>({
  id: 'ollama',
  order: 2,
  name: 'Ollama',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.ollama.title'),
  description: 'Local Ollama server for fast model iteration.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.ollama.description'),
  tasks: ['chat'],
  capabilities: { chat: { reasoning: { modes: ['enabled', 'disabled'] } } },
  icon: 'i-lobe-icons:ollama',

  createProviderConfig: ({ t }) => ollamaConfigSchema.extend({
    baseUrl: ollamaConfigSchema.shape.baseUrl
      .meta({
        labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
        descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
        placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
      }),
    thinkingMode: ollamaConfigSchema.shape.thinkingMode
      .meta({
        labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.thinking-mode.label'),
        descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.thinking-mode.description'),
        section: 'advanced',
        type: 'select',
        options: [
          {
            label: t('settings.pages.providers.catalog.edit.config.common.fields.field.thinking-mode.options.auto'),
            value: 'auto',
          },
          {
            label: t('settings.pages.providers.catalog.edit.config.common.fields.field.thinking-mode.options.disable'),
            value: 'disable',
          },
          {
            label: t('settings.pages.providers.catalog.edit.config.common.fields.field.thinking-mode.options.enable'),
            value: 'enable',
          },
          {
            label: t('settings.pages.providers.catalog.edit.config.common.fields.field.thinking-mode.options.low'),
            value: 'low',
          },
          {
            label: t('settings.pages.providers.catalog.edit.config.common.fields.field.thinking-mode.options.medium'),
            value: 'medium',
          },
          {
            label: t('settings.pages.providers.catalog.edit.config.common.fields.field.thinking-mode.options.high'),
            value: 'high',
          },
        ],
      }),
    headers: ollamaConfigSchema.shape.headers
      .meta({
        labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.headers.label'),
        descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.headers.description'),
        section: 'advanced',
        type: 'key-values',
      }),
  }),
  createProvider(config) {
    const baseProvider = createOllama('', config.baseUrl)

    return {
      ...baseProvider,
      chat(model: string, options?: ChatRequestOptions) {
        const chatOptions = baseProvider.chat(model)
        if (options?.reasoning) {
          return {
            ...chatOptions,
            reasoningEffort: options.reasoning === 'enabled' ? 'medium' : 'none',
          }
        }

        const reasoningEffort = resolveOllamaReasoningEffort(config.thinkingMode)

        if (reasoningEffort === undefined)
          return chatOptions

        return { ...chatOptions, reasoningEffort }
      },
    }
  },
  validationRequiredWhen: () => true,
  validators: {
    validateConfig: [
      ({ t }) => ({
        id: 'ollama:check-config',
        name: t('settings.pages.providers.catalog.edit.validators.openai-compatible.check-config.title'),
        validator: async (config) => {
          const errors: Array<{ error: unknown }> = []
          const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl.trim() : ''

          if (!baseUrl)
            errors.push({ error: new Error('Base URL is required.') })

          if (baseUrl) {
            try {
              const parsed = new URL(baseUrl)
              if (!parsed.host)
                errors.push({ error: new Error('Base URL is not absolute. Check your input.') })
            }
            catch {
              errors.push({ error: new Error('Base URL is invalid. It must be an absolute URL.') })
            }
          }

          return {
            errors,
            reason: errors.length > 0 ? errors.map(item => (item.error as Error).message).join(', ') : '',
            reasonKey: '',
            valid: errors.length === 0,
          }
        },
      }),
    ],
    validateProvider: createOpenAICompatibleValidators({
      checks: [ProviderValidationCheck.Connectivity, ProviderValidationCheck.ModelList, ProviderValidationCheck.ChatCompletions],
      pickValidationModel: pickOllamaValidationModel,
      schedule: {
        mode: 'interval',
        intervalMs: 15_000,
      },
      connectivityFailureReason: ({ errorMessage }) =>
        `Failed to reach Ollama server, error: ${errorMessage} occurred.\n\nIf you are using Ollama locally, this is likely the CORS (Cross-Origin Resource Sharing) security issue, where you will need to set the OLLAMA_ORIGINS=* environment variable before launching Ollama server to make this work.`,
    })!.validateProvider,
  },
  business: ({ t }) => ({
    troubleshooting: {
      validators: {
        openaiCompatibleCheckConnectivity: {
          label: t('settings.pages.providers.catalog.edit.providers.provider.ollama.troubleshooting.validators.openai-compatible-check-connectivity.label'),
          content: t('settings.pages.providers.catalog.edit.providers.provider.ollama.troubleshooting.validators.openai-compatible-check-connectivity.content'),
        },
      },
    },
  }),
})
