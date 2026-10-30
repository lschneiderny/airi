<script setup lang="ts">
import type { ActComplianceRecord } from '@proj-airi/stage-ui/stores/devtools/act-compliance'
import type { SituationGateEvaluation, SituationInspection, SituationPreview } from '@proj-airi/stage-ui/stores/devtools/situation-observability'

import { errorMessageFrom } from '@moeru/std'
import { useActComplianceStore } from '@proj-airi/stage-ui/stores/devtools/act-compliance'
import { useSituationObservabilityStore } from '@proj-airi/stage-ui/stores/devtools/situation-observability'
import { useIntervalFn } from '@vueuse/core'
import { onMounted, ref, shallowRef } from 'vue'

import SituationActCompliance from './components/situation-act-compliance.vue'
import SituationBlock from './components/situation-block.vue'
import SituationEvents from './components/situation-events.vue'
import SituationGate from './components/situation-gate.vue'
import SituationReasons from './components/situation-reasons.vue'
import SituationSource from './components/situation-source.vue'
import SituationSpend from './components/situation-spend.vue'
import SituationSummary from './components/situation-summary.vue'

/** Matches the leader's advance ticker, so ages and settled events stay current. */
const REFRESH_INTERVAL_MS = 1_000

// The page reads the leader over the devtools inspector bus and never changes the situation. Its only action,
// "Evaluate now", asks the leader's gate for one decision that skips timing; the gate keeps every hard suppressor.
const observability = useSituationObservabilityStore()
const actCompliance = useActComplianceStore()

const inspection = shallowRef<SituationInspection>()
const inspectedAtMs = ref<number>()
const inspectError = ref<string>()
const preview = shallowRef<SituationPreview>()
const previewError = ref<string>()
const previewing = ref(false)
const complianceRecords = shallowRef<ActComplianceRecord[]>([])
const complianceError = ref<string>()
const evaluation = shallowRef<{ atMs: number, result: SituationGateEvaluation }>()
const evaluating = ref(false)
const evaluateError = ref<string>()
let refreshing = false

async function refresh() {
  if (refreshing)
    return
  refreshing = true
  try {
    inspection.value = await observability.inspectLeader()
    inspectedAtMs.value = Date.now()
    inspectError.value = undefined
  }
  catch (error) {
    inspectError.value = errorMessageFrom(error) ?? 'The leader window did not answer.'
  }
  try {
    complianceRecords.value = (await actCompliance.inspectLeader()).records
    complianceError.value = undefined
  }
  catch (error) {
    complianceError.value = errorMessageFrom(error) ?? 'The leader window did not answer.'
  }
  finally {
    refreshing = false
  }
}

async function renderPreview() {
  previewing.value = true
  try {
    preview.value = await observability.previewLeader(Date.now())
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

async function evaluateNow() {
  evaluating.value = true
  try {
    evaluation.value = { atMs: Date.now(), result: await observability.evaluateGateLeader() }
    evaluateError.value = undefined
  }
  catch (error) {
    evaluation.value = undefined
    evaluateError.value = errorMessageFrom(error) ?? 'The leader window did not answer.'
  }
  finally {
    evaluating.value = false
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

    <template v-if="inspection">
      <SituationGate
        :urge="inspection.urge"
        :now-ms="inspection.nowMs"
        :evaluation="evaluation"
        :evaluating="evaluating"
        :evaluate-error="evaluateError"
        @evaluate="evaluateNow"
      />
      <SituationReasons
        :reasons="inspection.reasons"
        :threads="inspection.threads"
        :extraction="inspection.extraction"
        :outcomes="inspection.outcomes"
        :now-ms="inspection.nowMs"
      />
      <SituationSpend :spend="inspection.spend" :now-ms="inspection.nowMs" />
    </template>

    <SituationActCompliance :records="complianceRecords" :error="complianceError" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.devtools.pages.situation.title
  subtitleKey: tamagotchi.settings.devtools.title
</route>
