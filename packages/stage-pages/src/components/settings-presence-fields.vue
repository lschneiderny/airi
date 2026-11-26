<script setup lang="ts">
import type { SituationSettings } from '@proj-airi/stage-ui/features/situation/settings'

import { useSituationSettings } from '@proj-airi/stage-ui/features/situation/settings'
import { FieldCheckbox } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t } = useI18n()
const settings = useSituationSettings()

async function updateSettings(patch: Partial<SituationSettings>) {
  await settings.update(patch)
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
    <!-- The host's block-list editor; the desktop app replaces the plain list with its app picker. -->
    <slot name="blocked-apps" />
  </div>
</template>
