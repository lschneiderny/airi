<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import { Section } from '@proj-airi/stage-ui/components'
import { useCharacterBehaviorSettings } from '@proj-airi/stage-ui/stores/settings'
import { Alert, FieldCheckbox, FieldRange, Textarea } from '@proj-airi/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()
const settings = useCharacterBehaviorSettings()
const saving = ref(false)
const saveError = ref<string>()
const quietAppsDraft = ref('')
const percentage = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }))

watch(() => settings.document.speaking.quietApps.join('\n'), (value) => {
  quietAppsDraft.value = value
}, { immediate: true })

async function updateSettings(patch: Parameters<typeof settings.update>[0]) {
  saving.value = true
  saveError.value = undefined
  try {
    const result = await settings.update(patch)
    if (!result.success)
      saveError.value = t('settings.pages.behavior.invalid-settings')
  }
  catch (error) {
    saveError.value = errorMessageFrom(error) ?? t('settings.pages.behavior.save-failed')
  }
  finally {
    saving.value = false
  }
}

async function commitQuietApps() {
  await updateSettings({ speaking: { quietApps: quietAppsDraft.value.split('\n') } })
}
</script>

<template>
  <div :class="['flex flex-col gap-6 pb-4']">
    <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.pages.behavior.natural-only') }}
    </p>
    <Alert v-if="saveError" tone="danger" :title="t('settings.pages.behavior.save-failed')" live="polite">
      {{ saveError }}
    </Alert>
    <Section :title="t('settings.pages.behavior.sections.idle')" icon="i-solar:settings-bold-duotone" inner-class="gap-4">
      <FieldCheckbox
        :model-value="settings.document.idleActivities"
        :label="t('settings.live2d.animation.natural-idle-activities.title')"
        :description="t('settings.live2d.animation.natural-idle-activities.description')"
        :disabled="saving"
        placement="right"
        @update:model-value="updateSettings({ idleActivities: $event })"
      />
    </Section>
    <Section :title="t('settings.pages.behavior.sections.touch')" icon="i-solar:hand-shake-bold-duotone" inner-class="gap-4">
      <FieldCheckbox
        :model-value="settings.document.touchReactions"
        :label="t('settings.live2d.animation.natural-touch.title')"
        :description="t('settings.live2d.animation.natural-touch.description')"
        :disabled="saving"
        placement="right"
        @update:model-value="updateSettings({ touchReactions: $event })"
      />
    </Section>
    <Section :title="t('settings.pages.behavior.sections.attention')" icon="i-solar:face-scan-circle-bold-duotone" inner-class="gap-4">
      <FieldCheckbox
        :model-value="settings.document.cursorAttention"
        :label="t('settings.live2d.animation.natural-cursor-attention.title')"
        :description="t('settings.live2d.animation.natural-cursor-attention.description')"
        :disabled="saving"
        placement="right"
        @update:model-value="updateSettings({ cursorAttention: $event })"
      />
      <FieldCheckbox
        :model-value="settings.document.chatAttention"
        :label="t('settings.pages.behavior.chat-attention.title')"
        :description="t('settings.pages.behavior.chat-attention.description')"
        :disabled="saving"
        placement="right"
        @update:model-value="updateSettings({ chatAttention: $event })"
      />
    </Section>
    <Section :title="t('settings.pages.behavior.sections.feelings')" icon="i-solar:emoji-funny-circle-bold-duotone" inner-class="gap-4">
      <FieldCheckbox
        :model-value="settings.document.emotion.bands"
        :label="t('settings.live2d.performance.bands.title')"
        :description="t('settings.live2d.performance.bands.description')"
        :disabled="saving"
        placement="right"
        @update:model-value="updateSettings({ emotion: { bands: $event } })"
      />
      <FieldCheckbox
        :model-value="settings.document.emotion.mood"
        :label="t('settings.live2d.performance.mood.title')"
        :description="t('settings.live2d.performance.mood.description')"
        :disabled="saving"
        placement="right"
        @update:model-value="updateSettings({ emotion: { mood: $event } })"
      />
      <FieldCheckbox
        :model-value="settings.document.emotion.heldEmotions"
        :label="t('settings.live2d.performance.held-emotions.title')"
        :description="t('settings.live2d.performance.held-emotions.description')"
        :disabled="saving"
        placement="right"
        @update:model-value="updateSettings({ emotion: { heldEmotions: $event } })"
      />
    </Section>
    <Section :title="t('settings.pages.behavior.sections.speaking')" icon="i-solar:chat-round-dots-bold-duotone" inner-class="gap-4">
      <FieldCheckbox
        :model-value="settings.document.speaking.unpromptedEnabled"
        :label="t('settings.pages.presence.unprompted-enabled.title')"
        :description="t('settings.pages.presence.unprompted-enabled.description')"
        :disabled="saving"
        placement="right"
        @update:model-value="updateSettings({ speaking: { unpromptedEnabled: $event } })"
      />
      <FieldRange
        :model-value="settings.document.speaking.chattiness"
        :min="0"
        :max="1"
        :step="0.05"
        :label="t('settings.pages.presence.chattiness.title')"
        :description="t('settings.pages.presence.chattiness.description')"
        :format-value="percentage.format"
        :disabled="saving"
        @update:model-value="updateSettings({ speaking: { chattiness: $event } })"
      />
      <FieldCheckbox
        :model-value="settings.document.speaking.dontDisturb"
        :label="t('settings.pages.presence.dont-disturb.title')"
        :description="t('settings.pages.presence.dont-disturb.description')"
        :disabled="saving"
        placement="right"
        @update:model-value="updateSettings({ speaking: { dontDisturb: $event } })"
      />
      <FieldCheckbox
        :model-value="settings.document.speaking.speakDuringGames"
        :label="t('settings.pages.presence.speak-during-games.title')"
        :description="t('settings.pages.presence.speak-during-games.description')"
        :disabled="saving"
        placement="right"
        @update:model-value="updateSettings({ speaking: { speakDuringGames: $event } })"
      />
      <label :class="['flex flex-col gap-4']">
        <div>
          <div :class="['text-sm font-medium']">
            {{ t('settings.pages.presence.quiet-apps.title') }}
          </div>
          <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('settings.pages.presence.quiet-apps.description') }}
          </div>
        </div>
        <Textarea
          v-model="quietAppsDraft"
          :submit-on-enter="false"
          :disabled="saving"
          :class="['font-mono']"
          @change="commitQuietApps"
        />
      </label>
    </Section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.behavior.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.behavior.description
  icon: i-solar:emoji-funny-circle-bold-duotone
  settingsEntry: true
  order: 9
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
