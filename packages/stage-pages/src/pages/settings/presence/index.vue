<script setup lang="ts">
import type { SituationSettings } from '@proj-airi/stage-ui/features/situation/settings'

import { useSituationSettings } from '@proj-airi/stage-ui/features/situation/settings'
import { FieldCheckbox, FieldRange, Textarea } from '@proj-airi/ui'
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'

type AppListField = 'quietApps' | 'titleDenylist'

const { t } = useI18n()
const settings = useSituationSettings()

// `update` is a leader-routed synced action, so callers await it instead of dropping the promise.
async function updateSettings(patch: Partial<SituationSettings>) {
  await settings.update(patch)
}

// Drafts keep the raw text while the user types; a list is committed when its field loses focus
// (`change`), and the store trims entries and drops blank lines.
const drafts = reactive<Record<AppListField, string>>({ quietApps: '', titleDenylist: '' })
for (const field of ['quietApps', 'titleDenylist'] as const) {
  watch(() => settings.document[field].join('\n'), (text) => {
    drafts[field] = text
  }, { immediate: true })
}

async function commitAppList(field: AppListField) {
  await updateSettings({ [field]: drafts[field].split('\n') })
}

const appLists = computed(() => [
  {
    field: 'quietApps' as const,
    title: t('settings.pages.presence.quiet-apps.title'),
    description: t('settings.pages.presence.quiet-apps.description'),
  },
  {
    field: 'titleDenylist' as const,
    title: t('settings.pages.presence.title-denylist.title'),
    description: t('settings.pages.presence.title-denylist.description'),
  },
])

function formatChattiness(value: number) {
  return `${Math.round(value * 100)}%`
}
</script>

<template>
  <div :class="['flex flex-col gap-6 pb-4']">
    <FieldCheckbox
      :model-value="settings.document.unpromptedEnabled"
      :label="t('settings.pages.presence.unprompted-enabled.title')"
      :description="t('settings.pages.presence.unprompted-enabled.description')"
      placement="right"
      @update:model-value="updateSettings({ unpromptedEnabled: $event })"
    />
    <FieldRange
      :model-value="settings.document.chattiness"
      :min="0"
      :max="1"
      :step="0.05"
      :label="t('settings.pages.presence.chattiness.title')"
      :description="t('settings.pages.presence.chattiness.description')"
      :format-value="formatChattiness"
      @update:model-value="updateSettings({ chattiness: $event })"
    />
    <FieldCheckbox
      :model-value="settings.document.dontDisturb"
      :label="t('settings.pages.presence.dont-disturb.title')"
      :description="t('settings.pages.presence.dont-disturb.description')"
      placement="right"
      @update:model-value="updateSettings({ dontDisturb: $event })"
    />
    <FieldCheckbox
      :model-value="settings.document.speakDuringGames"
      :label="t('settings.pages.presence.speak-during-games.title')"
      :description="t('settings.pages.presence.speak-during-games.description')"
      placement="right"
      @update:model-value="updateSettings({ speakDuringGames: $event })"
    />
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
    <label
      v-for="list in appLists"
      :key="list.field"
      :class="['flex flex-col gap-4']"
    >
      <div>
        <div :class="['text-sm font-medium']">
          {{ list.title }}
        </div>
        <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ list.description }}
        </div>
      </div>
      <!-- Enter inserts a newline here; the native change event falls through to the textarea. -->
      <Textarea
        v-model="drafts[list.field]"
        :submit-on-enter="false"
        :class="['font-mono']"
        @change="commitAppList(list.field)"
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
