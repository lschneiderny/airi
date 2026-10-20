<script setup lang="ts">
import type { SituationInspection, SituationPreview } from '@proj-airi/stage-ui/stores/devtools/situation-observability'

import { errorMessageFrom } from '@moeru/std'
import { useSituationObservabilityStore } from '@proj-airi/stage-ui/stores/devtools/situation-observability'
import { useIntervalFn } from '@vueuse/core'
import { onMounted, ref, shallowRef } from 'vue'

import SituationBlock from './components/situation-block.vue'
import SituationEvents from './components/situation-events.vue'
import SituationSource from './components/situation-source.vue'
import SituationSummary from './components/situation-summary.vue'

/** Matches the leader's advance ticker, so ages and settled events stay current. */
const REFRESH_INTERVAL_MS = 1_000

// Read-only: the page reads the leader through the store's leader-routed actions and never changes the situation.
const observability = useSituationObservabilityStore()

const inspection = shallowRef<SituationInspection>()
const inspectedAtMs = ref<number>()
const inspectError = ref<string>()
const preview = shallowRef<SituationPreview>()
const previewError = ref<string>()
const previewing = ref(false)
let refreshing = false

async function refresh() {
  if (refreshing)
    return
  refreshing = true
  try {
    inspection.value = await observability.inspect()
    inspectedAtMs.value = Date.now()
    inspectError.value = undefined
  }
  catch (error) {
    inspectError.value = errorMessageFrom(error) ?? 'The leader window did not answer.'
  }
  finally {
    refreshing = false
  }
}

async function renderPreview() {
  previewing.value = true
  try {
    preview.value = await observability.preview(Date.now())
    previewError.value = undefined
  }
  catch (error) {
    previewError.value = errorMessageFrom(error) ?? 'The leader window did not answer.'
  }
  finally {
    previewing.value = false
  }
  await refresh()
}

useIntervalFn(refresh, REFRESH_INTERVAL_MS)
onMounted(refresh)
</script>

<template>
  <div :class="['flex flex-col gap-2']">
    <SituationSource
      :local-leading="observability.liveState.leading"
      :source-leading="inspection?.leading"
      :inspected-at-ms="inspectedAtMs"
      :error="inspectError"
    />

    <template v-if="inspection">
      <SituationSummary :state="inspection.state" :now-ms="inspection.nowMs" />
      <SituationEvents :events="inspection.state.events" :now-ms="inspection.nowMs" />
      <SituationBlock
        :renders="inspection.renders"
        :preview="preview"
        :previewing="previewing"
        :preview-error="previewError"
        @preview="renderPreview"
      />
    </template>

    <!-- Gate decisions and ACT compliance panels go here, below the block they explain. -->
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.devtools.pages.situation.title
  subtitleKey: tamagotchi.settings.devtools.title
</route>
