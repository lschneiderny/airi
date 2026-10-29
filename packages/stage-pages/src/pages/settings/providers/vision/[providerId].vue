<script setup lang="ts">
import {
  ProviderAdvancedSettings,
  ProviderApiKeyInput,
  ProviderBaseUrlInput,
  ProviderBasicSettings,
  ProviderGenerationSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
  ProviderValidationAlerts,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { getDefinedProvider } from '@proj-airi/stage-ui/libs'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { computedAsync } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'

const route = useRoute('/settings/providers/vision/[providerId]')
const routeProviderId = route.params.providerId
if (typeof routeProviderId !== 'string')
  throw new Error('Expected a provider id in the settings route')
const sourceProviderId = routeProviderId
const providerId = `vision-${sourceProviderId}`
const visionStore = useVisionStore()
const { activeProvider } = storeToRefs(visionStore)

// Use the composable to get validation logic and state
const {
  t,
  router,
  providerMetadata,
  apiKey,
  baseUrl,
  isValidating,
  isValid,
  validationMessage,
  handleResetSettings,
  forceValid,
  hasManualValidators,
  isManualTesting,
  manualTestPassed,
  manualTestMessage,
  runManualTest,
} = useProviderValidation(providerId)

const apiKeyPlaceholder = computedAsync(async () => {
  const definition = getDefinedProvider(sourceProviderId)
  if (!definition?.createProviderConfig)
    return 'sk-...'

  const schema = await definition.createProviderConfig({ t }) as any
  const shape = typeof schema?.shape === 'function' ? schema.shape() : schema?.shape
  const apiKeySchema = shape?.apiKey
  if (!apiKeySchema)
    return 'sk-...'

  const meta = typeof apiKeySchema.meta === 'function' ? apiKeySchema.meta() : undefined
  return typeof meta?.placeholderLocalized === 'string' ? meta.placeholderLocalized : 'sk-...'
}, 'sk-...')

function goToModelSelection() {
  activeProvider.value = providerId
  router.push('/settings/modules/vision')
}
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <ProviderSettingsContainer>
      <ProviderBasicSettings
        :title="t('settings.pages.providers.common.section.basic.title')"
        :description="t('settings.pages.providers.common.section.basic.description')"
        :on-reset="handleResetSettings"
      >
        <ProviderApiKeyInput
          v-model="apiKey"
          :provider-name="providerMetadata?.localizedName"
          :placeholder="apiKeyPlaceholder"
        />
        <ProviderGenerationSettings :provider-id="providerId" />
      </ProviderBasicSettings>

      <ProviderAdvancedSettings :title="t('settings.pages.providers.common.section.advanced.title')">
        <ProviderBaseUrlInput
          v-model="baseUrl"
          :placeholder="providerMetadata?.defaultConfig.baseUrl as string || 'Base URL of your provider'"
        />
      </ProviderAdvancedSettings>

      <ProviderValidationAlerts
        :is-valid="isValid"
        :is-validating="isValidating"
        :validation-message="validationMessage"
        :has-manual-validators="hasManualValidators"
        :is-manual-testing="isManualTesting"
        :manual-test-passed="manualTestPassed"
        :manual-test-message="manualTestMessage"
        :on-run-test="runManualTest"
        :on-force-valid="forceValid"
        :on-go-to-model-selection="goToModelSelection"
      />
    </ProviderSettingsContainer>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
