<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { OnboardingScreen, OnboardingStepAnalyticsNotice } from '@proj-airi/stage-ui/components'
import { isAnalyticsAvailableInBuild } from '@proj-airi/stage-ui/libs/product-signals'
import { useTheme } from '@proj-airi/ui'
import { computed } from 'vue'

import WindowTitleBar from '../components/Window/TitleBar.vue'

import { electronOnboardingClose } from '../../shared/eventa'

const { isDark } = useTheme()
const closeWindow = useElectronEventaInvoke(electronOnboardingClose)

const bgClass = computed(() => isDark.value ? 'bg-[#0f0f0f]' : 'bg-white')
const extraSteps = computed(() => {
  return isAnalyticsAvailableInBuild()
    ? [{ id: 'analytics-notice', component: OnboardingStepAnalyticsNotice }]
    : []
})

// The flow records its steps before it emits `configured`. Recording is a synced action that runs on the leader
// window, and the flow awaits it, so closing this window here cannot reject the pending call.
async function handleConfigured() {
  await closeWindow()
}
</script>

<template>
  <!-- Same flex/min-h-0 chain as OnboardingDialog so model step grid scrolls inside the viewport (not the whole page). -->
  <div
    :class="['onboarding-root h-full min-h-0 w-full flex flex-col overflow-hidden overscroll-none', bgClass]"
  >
    <WindowTitleBar transparent />
    <div class="min-h-11 w-full flex-shrink-0" :class="bgClass" />
    <div class="mx-8 mb-8 mt-2 min-h-0 flex flex-1 flex-col">
      <OnboardingScreen :extra-steps="extraSteps" @configured="handleConfigured" />
    </div>
  </div>
</template>

<style scoped>
.onboarding-root {
  scrollbar-width: none;
}

.onboarding-root::-webkit-scrollbar {
  display: none;
}
</style>

<route lang="yaml">
meta:
  layout: plain
</route>
