<script setup lang="ts">
import type { ConversationSettings } from '@proj-airi/stage-ui/features/conversation/settings'

import { CONVERSATION_REGISTERS, TEXTING_FLAVORS } from '@proj-airi/stage-shared/conversation-register'
import { useConversationSettings } from '@proj-airi/stage-ui/features/conversation/settings'
import { FieldSelect } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const settings = useConversationSettings()

// `update` is a leader-routed synced action, so callers await it instead of dropping the promise.
async function updateSettings(patch: Partial<ConversationSettings>) {
  await settings.update(patch)
}

const registerOptions = computed(() => CONVERSATION_REGISTERS.map(value => ({
  value,
  label: t(`settings.pages.conversation.register.options.${value}`),
})))

const textingFlavorOptions = computed(() => TEXTING_FLAVORS.map(value => ({
  value,
  label: t(`settings.pages.conversation.texting-flavor.options.${value}`),
})))
</script>

<template>
  <div :class="['flex flex-col gap-6 pb-4']">
    <FieldSelect
      :model-value="settings.document.register"
      :label="t('settings.pages.conversation.register.title')"
      :description="t('settings.pages.conversation.register.description')"
      :options="registerOptions"
      @update:model-value="$event && updateSettings({ register: $event })"
    />
    <FieldSelect
      :model-value="settings.document.textingFlavor"
      :label="t('settings.pages.conversation.texting-flavor.title')"
      :description="t('settings.pages.conversation.texting-flavor.description')"
      :options="textingFlavorOptions"
      :disabled="settings.document.register === 'talking'"
      @update:model-value="$event && updateSettings({ textingFlavor: $event })"
    />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.conversation.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.conversation.description
  icon: i-solar:chat-line-bold-duotone
  settingsEntry: true
  order: 11
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
