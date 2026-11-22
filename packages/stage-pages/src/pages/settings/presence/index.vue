<script setup lang="ts">
import type { SituationSettings } from '@proj-airi/stage-ui/features/situation/settings'

import { useSituationSettings } from '@proj-airi/stage-ui/features/situation/settings'
import { FieldCheckbox, Textarea } from '@proj-airi/ui'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t } = useI18n()
const settings = useSituationSettings()
const blockedAppsDraft = ref('')

async function updateSettings(patch: Partial<SituationSettings>) {
  await settings.update(patch)
}

// Keep raw text while typing; the owner normalizes the list when the field loses focus.
watch(() => settings.document.blockedApps.join('\n'), (value) => {
  blockedAppsDraft.value = value
}, { immediate: true })

async function commitBlockedApps() {
  await updateSettings({ blockedApps: blockedAppsDraft.value.split('\n') })
}
</script>

<template>
  <div :class="['flex flex-col gap-6 pb-4']">
    <RouterLink to="/settings/behavior" :class="['text-sm text-primary-600 dark:text-primary-400 hover:underline']">
      {{ t('settings.pages.behavior.link') }}
    </RouterLink>
    <FieldCheckbox
      :model-value="settings.document.showUnpromptedCue"
      :label="t('settings.pages.presence.show-unprompted-cue.title')"
      :description="t('settings.pages.presence.show-unprompted-cue.description')"
      placement="right"
      @update:model-value="updateSettings({ showUnpromptedCue: $event })"
    />
    <FieldCheckbox
      :model-value="settings.document.shareForegroundWindow"
      :label="t('settings.pages.presence.share-foreground-window.title')"
      :description="t('settings.pages.presence.share-foreground-window.description')"
      placement="right"
      @update:model-value="updateSettings({ shareForegroundWindow: $event })"
    />
    <FieldCheckbox
      :model-value="settings.document.shareWindowTitles"
      :label="t('settings.pages.presence.share-window-titles.title')"
      :description="t('settings.pages.presence.share-window-titles.description')"
      :disabled="!settings.document.shareForegroundWindow"
      placement="right"
      @update:model-value="updateSettings({ shareWindowTitles: $event })"
    />
    <FieldCheckbox
      :model-value="settings.document.shareBrowserActivity"
      :label="t('settings.pages.presence.share-browser-activity.title')"
      :description="t('settings.pages.presence.share-browser-activity.description')"
      placement="right"
      @update:model-value="updateSettings({ shareBrowserActivity: $event })"
    />
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
  </div>
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
