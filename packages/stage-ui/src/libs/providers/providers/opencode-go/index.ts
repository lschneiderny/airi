import type { ProviderDefinition } from '@proj-airi/provider-inference'

import { createOpenAICompatibleValidators, getDefinedProvider, ProviderValidationCheck } from '@proj-airi/provider-inference'
import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

const baseUrl = 'https://opencode.ai/inference/go/v1/'
const schema = z.object({
  credentialId: z.string().default('opencode-go'),
  credentialRevision: z.number().default(0),
  baseUrl: z.literal(baseUrl).default(baseUrl),
  model: z.string().optional(),
})

type Configuration = z.output<typeof schema>

/** The desktop host owns credentials and supplies its restricted network boundary. */
export interface OpenCodeGoDesktopHost {
  isConfigured: (providerId: string) => Promise<boolean>
  fetch: (providerId: string) => typeof globalThis.fetch
}

/** The desktop definition stores references, while the main service owns actual credentials. */
export function createOpenCodeGoDesktopProvider(client: OpenCodeGoDesktopHost): ProviderDefinition<Configuration, 'opencode-go'> {
  const portable = getDefinedProvider('opencode-go')
  if (!portable)
    throw new Error('The portable OpenCode Go definition is missing')
  const listModels = portable.extraMethods?.listModels
  if (!listModels)
    throw new Error('The portable OpenCode Go model catalog is missing')
  const validators = createOpenAICompatibleValidators<Configuration>({
    checks: [ProviderValidationCheck.Connectivity, ProviderValidationCheck.ModelList, ProviderValidationCheck.ChatCompletions],
    skipApiKeyCheck: true,
    fetchForConfig: config => client.fetch(config.credentialId),
  })

  return {
    ...portable,
    id: 'opencode-go',
    createProviderConfig: () => schema,
    createProvider(config) {
      const provider = createOpenAI('', baseUrl)
      const fetch = client.fetch(config.credentialId)
      return {
        model: () => ({ ...provider.model(), fetch }),
        generation: model => ({
          protocol: 'chat-completions',
          config: { ...provider.chat(model), fetch },
        }),
      }
    },
    validationRequiredWhen: config => client.isConfigured(config.credentialId),
    validators: {
      ...validators,
      validateConfig: [
        ...validators?.validateConfig ?? [],
        ({ t }) => ({
          id: 'opencode-go:stored-credential',
          name: t('settings.pages.providers.catalog.edit.validators.openai-compatible.check-config.title'),
          validator: async (config) => {
            const configured = await client.isConfigured(config.credentialId)
            const reason = configured ? '' : t('settings.pages.providers.provider.opencode-go.desktop.key-required')
            return { valid: configured, reason, reasonKey: '', errors: reason ? [{ error: new Error(reason) }] : [] }
          },
        }),
      ],
    },
    extraMethods: {
      listModels: (_config, provider, context) => listModels({ apiKey: '', baseUrl }, provider, context),
    },
  }
}
