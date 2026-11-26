<script setup lang="ts">
import { useSituationSettings } from '@proj-airi/stage-ui/features/situation/settings'
import { Textarea } from '@proj-airi/ui'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsPresenceFields from '../../../components/settings-presence-fields.vue'

const { t } = useI18n()
const settings = useSituationSettings()
const blockedAppsDraft = ref('')

// Keep raw text while typing; the owner normalizes the list when the field loses focus.
watch(() => settings.document.blockedApps.join('\n'), (value) => {
  blockedAppsDraft.value = value
}, { immediate: true })

async function commitBlockedApps() {
  await settings.update({ blockedApps: blockedAppsDraft.value.split('\n') })
}
</script>

<template>
  <SettingsPresenceFields>
    <template #blocked-apps>
      <label :class="['flex flex-col gap-4']">
        <div>
          <div :class="['text-sm font-medium']">
            {{ t('settings.pages.presence.blocked-apps.title') }}
          </div>
          <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.pages.presence.blocked-apps.description') }}
          </div>
        </div>
        <Textarea
          v-model="blockedAppsDraft"
          :submit-on-enter="false"
          :class="['font-mono']"
          @change="commitBlockedApps"
        />
      </label>
    </template>
  </SettingsPresenceFields>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.presence.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.presence.description
  icon: i-solar:chat-round-dots-bold-duotone
  settingsEntry: true
  order: 10
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
