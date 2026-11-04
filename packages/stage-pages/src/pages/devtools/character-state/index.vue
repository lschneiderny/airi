<script setup lang="ts">
import type { CharacterEvent } from '@proj-airi/stage-shared/character-state'
import type { CharacterStateInspection } from '@proj-airi/stage-ui/stores/devtools/character-state-observability'

import type { CharacterControlsOutcome } from './components/character-state-controls.vue'

import { useCharacterStateStore } from '@proj-airi/stage-ui/stores/character-state'
import { leaderErrorMessage, useCharacterStateObservabilityStore } from '@proj-airi/stage-ui/stores/devtools/character-state-observability'
import { useIntervalFn } from '@vueuse/core'
import { onMounted, ref, shallowRef } from 'vue'

import CharacterStateContributions from './components/character-state-contributions.vue'
import CharacterStateControls from './components/character-state-controls.vue'
import CharacterStateHistory from './components/character-state-history.vue'
import CharacterStateMood from './components/character-state-mood.vue'
import CharacterStateRelationship from './components/character-state-relationship.vue'
import CharacterStateSource from './components/character-state-source.vue'

/** Matches the situation inspector, so ages stay current while the leader's minute ticker runs. */
const REFRESH_INTERVAL_MS = 1_000

// The page reads the leader over the devtools inspector bus. Every value, age, and rendered text it shows is read at
// the leader's clock (wall clock plus the devtools jump); the jump never reaches another module.
const observability = useCharacterStateObservabilityStore()
const characterState = useCharacterStateStore()

const inspection = shallowRef<CharacterStateInspection>()
const inspectedAtMs = ref<number>()
const inspectError = ref<string>()
const busy = ref(false)
const outcome = shallowRef<CharacterControlsOutcome>()
const actionError = ref<string>()
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
    inspectError.value = leaderErrorMessage(error)
  }
  finally {
    refreshing = false
  }
}

/** Runs one leader action, shows its outcome, and refreshes the view from the state it answered with. */
async function act(run: () => Promise<{ inspection: CharacterStateInspection, outcome: CharacterControlsOutcome }>) {
  busy.value = true
  try {
    const result = await run()
    inspection.value = result.inspection
    inspectedAtMs.value = Date.now()
    inspectError.value = undefined
    outcome.value = result.outcome
    actionError.value = undefined
  }
  catch (error) {
    outcome.value = undefined
    actionError.value = leaderErrorMessage(error)
  }
  finally {
    busy.value = false
  }
}

function jump(ms: number) {
  return act(async () => {
    const result = await observability.jumpLeader(ms)
    return { inspection: result.inspection, outcome: { action: 'jump', atMs: result.inspection.nowMs } }
  })
}

function apply(event: CharacterEvent) {
  return act(async () => {
    const result = await observability.applyLeader(event)
    if (result.status === 'invalid')
      return { inspection: await observability.inspectLeader(), outcome: { action: 'apply', atMs: Date.now(), kind: event.kind, status: 'invalid', error: result.error } }
    return { inspection: result.inspection, outcome: { action: 'apply', atMs: result.inspection.nowMs, kind: event.kind, status: result.status } }
  })
}

function reset() {
  return act(async () => {
    const fresh = await observability.resetLeader()
    return { inspection: fresh, outcome: { action: 'reset', atMs: fresh.nowMs } }
  })
}

useIntervalFn(refresh, REFRESH_INTERVAL_MS)
onMounted(refresh)
</script>

<template>
  <div :class="['flex flex-col gap-2']">
    <CharacterStateSource
      :local-leading="characterState.leading"
      :source-leading="inspection?.leading ?? null"
      :leader-now-ms="inspection?.nowMs"
      :clock-offset-ms="inspection?.clockOffsetMs"
      :card-id="inspection?.cardId"
      :inspected-at-ms="inspectedAtMs"
      :error="inspectError"
    />

    <template v-if="inspection">
      <CharacterStateControls
        :clock-offset-ms="inspection.clockOffsetMs"
        :busy="busy"
        :outcome="outcome"
        :error="actionError"
        @jump="jump"
        @apply="apply"
        @reset="reset"
      />
      <CharacterStateMood :inspection="inspection" />
      <CharacterStateContributions :contributions="inspection.contributions" :now-ms="inspection.nowMs" />
      <CharacterStateRelationship :inspection="inspection" />
      <CharacterStateHistory :history="inspection.history" />
    </template>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.devtools.pages.character-state.title
  subtitleKey: tamagotchi.settings.devtools.title
</route>
