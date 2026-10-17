<script setup lang="ts">
import SharedVisionSettings from '@proj-airi/stage-pages/pages/settings/providers/vision/[providerId].vue'

import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import GoSettings from '../../../../components/opencode-go-settings.vue'

const route = useRoute('/settings/providers/vision/[providerId]')
const router = useRouter()
const providers = useProviderStore()
const vision = useVisionStore()
const providerId = computed(() => `vision-${route.params.providerId}`)
const isGo = computed(() => providers.findProviderDefinition(providerId.value)?.id === 'opencode-go')

function selectModel() {
  vision.activeProvider = providerId.value
  router.push('/settings/modules/vision')
}
</script>

<template>
  <GoSettings v-if="isGo" :key="providerId" :provider-id="providerId" :on-select-model="selectModel" />
  <SharedVisionSettings v-else :key="providerId" />
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
