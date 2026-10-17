<script setup lang="ts">
import SharedChatSettings from '@proj-airi/stage-pages/pages/settings/providers/chat/[providerId].vue'

import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import GoSettings from '../../../../components/opencode-go-settings.vue'

const route = useRoute('/settings/providers/chat/[providerId]')
const providers = useProviderStore()
const providerId = computed(() => {
  const id = route.params.providerId
  if (typeof id !== 'string')
    throw new TypeError('Expected a provider ID')
  return id
})
const isGo = computed(() => providers.findProviderDefinition(providerId.value)?.id === 'opencode-go')
</script>

<template>
  <GoSettings v-if="isGo" :key="providerId" :provider-id="providerId" />
  <SharedChatSettings v-else :key="providerId" />
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
