<script setup lang="ts">
import SettingsPresenceFields from '@proj-airi/stage-pages/components/settings-presence-fields.vue'

import PresenceBlockedApps from '../../../components/settings/presence/presence-blocked-apps.vue'
import PresenceHides from '../../../components/settings/presence/presence-hides.vue'
</script>

<template>
  <SettingsPresenceFields>
    <template #blocked-apps>
      <PresenceHides />
      <PresenceBlockedApps />
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
