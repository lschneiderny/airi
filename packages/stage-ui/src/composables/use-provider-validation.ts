import type { RemovableRef } from '@vueuse/core'

import type { ProviderMode } from './use-analytics'

import { errorMessageFrom } from '@moeru/std'
import { computedAsync, useDebounceFn } from '@vueuse/core'
import { cloneDeep } from 'es-toolkit'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { selectProviderMetadata } from '../libs/providers/metadata'
import { useProviderConfigStore } from '../stores/providers/config'
import { useProviderStore } from '../stores/providers/provider'
import { useAnalytics } from './use-analytics'

/**
 * Classifies provider ids into bounded analytics buckets.
 */
function providerModeForAnalytics(providerId: string): ProviderMode {
  if (!providerId)
    return 'unknown'

  return providerId.startsWith('official-provider') || providerId.startsWith('vision-official-provider')
    ? 'official'
    : 'custom'
}

export function useProviderValidation(providerId: string) {
  const { t } = useI18n()
  const router = useRouter()
  const providersStore = useProviderStore()
  const providerStore = useProviderConfigStore()
  const {
    trackProviderConnectionTestCompleted,
    trackProviderConnectionTestStarted,
  } = useAnalytics()
  const { configs: providers } = storeToRefs(providerStore) as { configs: RemovableRef<Record<string, any>> }

  const providerMetadata = computedAsync(async () => {
    const definition = providersStore.getProviderDefinition(providerId)
    return await selectProviderMetadata(definition, t, {
      id: providerId,
      configured: providerStore.getProvider(providerId)?.status === 'configured',
    })
  }, undefined)

  const credentials = computed(() => providers.value[providerId] || {})

  const debounceTime = 500
  const isValidating = ref(0)
  const isValid = ref(false)
  const validationMessage = ref('')

  // ROOT CAUSE:
  //
  // Fields wrote through the `configs` projection, which never reaches the
  // leader from a follower window such as Electron settings. Keys vanished and
  // validation never ran. Edits now use `patchProviderConfig`; drafts keep the
  // input stable until the leader snapshot arrives.
  const drafts = ref<Record<string, unknown>>({})
  let saveQueue = Promise.resolve()

  watch(credentials, (stored) => {
    for (const [key, value] of Object.entries(drafts.value)) {
      if (stored[key] === value)
        delete drafts.value[key]
    }
  })

  function saveField(key: string) {
    saveQueue = saveQueue.then(async () => {
      if (!Object.hasOwn(drafts.value, key))
        return
      try {
        await providersStore.initializeProvider(providerId)
        if (!await providerStore.patchProviderConfig(providerId, { [key]: drafts.value[key] }))
          throw new Error(`Provider ${providerId} no longer exists.`)
      }
      catch (error) {
        validationMessage.value = errorMessageFrom(error) ?? 'Failed to save provider settings.'
      }
    })
  }

  /** Binds one provider configuration field to an input through the leader-owned store. */
  function configField<T>(key: string, fallback: T) {
    return computed<T>({
      get: () => (Object.hasOwn(drafts.value, key) ? drafts.value[key] : credentials.value[key] || fallback) as T,
      set: (value) => {
        drafts.value[key] = value
        saveField(key)
      },
    })
  }

  const apiKey = configField('apiKey', '')
  const baseUrl = configField('baseUrl', '')
  const accountId = configField('accountId', '')

  // Manual chat ping check state (settings pages only)
  const hasManualValidators = computedAsync(
    async () => await providersStore.hasManualProviderValidators(providerId),
    false,
  )
  const isManualTesting = ref(false)
  const manualTestPassed = ref(false)
  const manualTestMessage = ref('')

  function providerConnectionTestAnalyticsBase() {
    return {
      provider_id: providerId,
      provider_mode: providerModeForAnalytics(providerId),
    }
  }

  /**
   * `validateProviderConfig` is a synchronized action. A follower renderer posts
   * its arguments over a BroadcastChannel.
   *
   * `structuredClone` rejects a Vue reactive proxy. A shallow copy keeps the
   * nested values as proxies, so this copy must be deep.
   */
  function configToValidate(): Record<string, any> {
    const config = cloneDeep(credentials.value)
    if (config.apiKey)
      config.apiKey = config.apiKey.trim()
    if (config.baseUrl)
      config.baseUrl = config.baseUrl.trim()

    return config
  }

  async function validateConfiguration() {
    if (!providerMetadata.value)
      return

    isValidating.value++
    validationMessage.value = ''
    const startValidationTimestamp = performance.now()
    let finalValidationMessage = ''

    try {
      // Settings pages always skip chat ping check during automatic validation
      // to avoid unexpected API billing. Users can trigger it manually.
      const validationResult = await providersStore.validateProviderConfig(providerId, configToValidate(), {
        skipChatPingCheck: true,
      })
      isValid.value = validationResult.valid
      providerStore.setProviderStatus(providerId, isValid.value ? 'configured' : 'invalid')

      if (!isValid.value) {
        finalValidationMessage = validationResult.reason
      }

      // When a provider validates successfully on its settings page,
      // mark it as added so it appears in the model selector (e.g. Consciousness module).
      // This fixes providers like LM Studio that use default config and may not
      // need an API key, yet should be selectable after successful validation.
      if (isValid.value) {
        providerStore.markProviderAdded(providerId)
      }
    }
    catch (error) {
      isValid.value = false
      providerStore.setProviderStatus(providerId, 'invalid')
      finalValidationMessage = t('settings.dialogs.onboarding.validationError', {
        error: errorMessageFrom(error) ?? 'Generic error (993b5ad7)',
      })
    }
    finally {
      setTimeout(() => {
        isValidating.value--
        validationMessage.value = finalValidationMessage
      }, Math.max(0, debounceTime - (performance.now() - startValidationTimestamp)))
    }
  }

  async function runManualTest() {
    if (!providerMetadata.value)
      return

    isManualTesting.value = true
    manualTestMessage.value = ''
    const startedAt = performance.now()
    trackProviderConnectionTestStarted(providerConnectionTestAnalyticsBase())

    try {
      const result = await providersStore.validateProviderConfig(providerId, configToValidate(), {
        onlyChatPingCheck: true,
      })
      manualTestPassed.value = result.valid
      if (result.valid) {
        trackProviderConnectionTestCompleted({
          ...providerConnectionTestAnalyticsBase(),
          duration_ms: Math.round(performance.now() - startedAt),
          success: true,
        })
      }
      else {
        manualTestMessage.value = result.reason
        trackProviderConnectionTestCompleted({
          ...providerConnectionTestAnalyticsBase(),
          error_code: 'validation_failed',
          duration_ms: Math.round(performance.now() - startedAt),
          success: false,
        })
      }
    }
    catch (error) {
      manualTestPassed.value = false
      manualTestMessage.value = errorMessageFrom(error) ?? 'Generic error (e56ae24f)'
      trackProviderConnectionTestCompleted({
        ...providerConnectionTestAnalyticsBase(),
        error_code: 'provider_error',
        duration_ms: Math.round(performance.now() - startedAt),
        success: false,
      })
    }
    finally {
      isManualTesting.value = false
    }
  }

  async function shouldValidateConfiguration() {
    const definition = providersStore.getProviderDefinition(providerId)
    return await definition.validationRequiredWhen?.(credentials.value) ?? false
  }

  const debouncedValidateConfiguration = useDebounceFn(async () => {
    if (!await shouldValidateConfiguration()) {
      isValid.value = false
      providerStore.setProviderStatus(providerId, 'unconfigured')
      validationMessage.value = ''
      isValidating.value = 0
      return
    }
    validateConfiguration()
  }, debounceTime)

  onMounted(async () => {
    await providersStore.initializeProvider(providerId)
    if (await shouldValidateConfiguration()) {
      await validateConfiguration()
    }
  })

  // The synced config store re-applies fresh object snapshots (new references,
  // identical content) after every synced action. Watching a serialized signature
  // instead of the deep object prevents equivalent snapshots from re-triggering
  // validation, which would otherwise loop with markProviderAdded().
  const credentialsSignature = computed(() => JSON.stringify(credentials.value))

  watch(credentialsSignature, () => {
    debouncedValidateConfiguration()
    // Reset manual test state when credentials actually change
    manualTestPassed.value = false
    manualTestMessage.value = ''
  })

  async function handleResetSettings() {
    const defaultOptions = providerMetadata.value?.defaultConfig ?? {}
    drafts.value = {}
    await saveQueue
    await providerStore.updateProviderConfig(providerId, { ...defaultOptions }, 'unconfigured')
    isValid.value = false
    validationMessage.value = ''
    isValidating.value = 0
    manualTestPassed.value = false
    manualTestMessage.value = ''
  }

  function forceValid() {
    isValid.value = true
    validationMessage.value = ''
    manualTestPassed.value = true
    manualTestMessage.value = ''
    providersStore.forceProviderConfigured(providerId)
  }

  return {
    t,
    router,
    providerMetadata,
    apiKey,
    baseUrl,
    accountId,
    configField,
    isValidating,
    isValid,
    validationMessage,
    handleResetSettings,
    forceValid,
    // Manual test generation
    hasManualValidators,
    isManualTesting,
    manualTestPassed,
    manualTestMessage,
    runManualTest,
  }
}
