<script setup lang="ts">
import type { GoConfiguration } from '../../shared/eventa/opencode-go'

import { errorMessageFrom } from '@moeru/std'
import {
  ProviderApiKeyInput,
  ProviderBasicSettings,
  ProviderGenerationSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
  ProviderValidationAlerts,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { Button } from '@proj-airi/ui'
import { onMounted, shallowRef } from 'vue'

import { getGoClient } from '../bridges/opencode-go'
import { toGoConfig } from '../bridges/opencode-go-migration'

const props = defineProps<{ providerId: string, onSelectModel?: () => void }>()
const configStore = useProviderConfigStore()
const consciousness = useConsciousnessStore()
const client = getGoClient()
const draft = shallowRef('')
const saving = shallowRef(false)
const error = shallowRef('')
const state = shallowRef<GoConfiguration>()
const {
  t,
  router,
  providerMetadata,
  isValidating,
  isValid,
  validationMessage,
  forceValid,
  hasManualValidators,
  isManualTesting,
  manualTestPassed,
  manualTestMessage,
  runManualTest,
} = useProviderValidation(props.providerId)
const prefix = 'settings.pages.providers.provider.opencode-go.desktop'

onMounted(async () => {
  try {
    state.value = await client.getConfiguration(props.providerId)
    const current = configStore.getProviderConfig(props.providerId) ?? {}
    // A failed startup transfer leaves the source intact. Only an acknowledged
    // replacement save can remove that key, even when an older main key exists.
    if (typeof current.apiKey === 'string' && current.apiKey.length > 0)
      return
    await configStore.updateProviderConfig(props.providerId, toGoConfig(current, props.providerId, state.value.revision), configStore.getProvider(props.providerId)?.status ?? 'unconfigured')
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t(`${prefix}.save-failed`)
  }
})

async function save(clear = false) {
  saving.value = true
  error.value = ''
  try {
    state.value = await client.setConfiguration(props.providerId, clear ? '' : draft.value)
    const current = clear ? {} : configStore.getProviderConfig(props.providerId) ?? {}
    await configStore.updateProviderConfig(props.providerId, toGoConfig(current, props.providerId, state.value.revision), 'unconfigured')
    draft.value = ''
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? t(`${prefix}.save-failed`)
  }
  finally {
    saving.value = false
  }
}

function selectModel() {
  if (props.onSelectModel) {
    props.onSelectModel()
    return
  }
  consciousness.activeProvider = props.providerId
  router.push('/settings/modules/consciousness')
}
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName"
    :provider-icon="providerMetadata?.icon"
    :on-back="() => router.back()"
  >
    <ProviderSettingsContainer>
      <ProviderBasicSettings
        :title="t('settings.pages.providers.common.section.basic.title')"
        :description="t(`${prefix}.description`)"
        :on-reset="() => save(true)"
      >
        <form :class="['flex flex-col gap-4']" @submit.prevent="save()">
          <ProviderApiKeyInput
            v-model="draft"
            provider-name="OpenCode Go"
            :placeholder="state?.keyPreview || t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder')"
          />
          <p v-if="state?.configured" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
            {{ t(`${prefix}.stored`) }}
          </p>
          <p v-if="error" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
            {{ error }}
          </p>
          <div :class="['flex flex-wrap gap-2']">
            <Button type="submit" color="primary" variant="primary" :loading="saving" :disabled="!draft.trim()">
              {{ t('settings.common.save') }}
            </Button>
            <Button type="button" :disabled="saving || !state?.configured" @click="save(true)">
              {{ t(`${prefix}.clear`) }}
            </Button>
          </div>
        </form>
        <ProviderGenerationSettings :provider-id="providerId" />
      </ProviderBasicSettings>
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
        :on-go-to-model-selection="selectModel"
      />
    </ProviderSettingsContainer>
  </ProviderSettingsLayout>
</template>
