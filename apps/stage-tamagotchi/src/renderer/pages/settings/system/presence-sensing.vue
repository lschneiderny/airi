<script setup lang="ts">
import type { HostSignal, SignalStatus } from '@proj-airi/stage-shared/host-capabilities'

import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const tt = (key: string) => t(`tamagotchi.settings.pages.system.presence-sensing.${key}`)
const { snapshot } = storeToRefs(useHostCapabilitiesStore())

/** Display order; `Record<HostSignal, SignalStatus>` carries no order of its own. */
const signals: HostSignal[] = [
  'cursorScreenPoint',
  'windowOrigin',
  'displayOrigins',
  'systemIdleTime',
  'screenLock',
  'foregroundWindow',
  'globalKeyUp',
  'clickThroughForward',
  'alwaysOnTop',
  'systemAudioCapture',
]

const statusTone: Record<SignalStatus['kind'], string> = {
  live: 'bg-green-500/15 text-green-700 dark:text-green-300',
  degraded: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  unavailable: 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-300',
}

const rows = computed(() => {
  const current = snapshot.value
  if (!current)
    return []
  return signals.map((signal) => {
    const status = current.signals[signal]
    return {
      signal,
      name: tt(`signals.${signal}`),
      status: tt(`status.${status.kind}`),
      tone: statusTone[status.kind],
      reason: status.kind === 'live' ? null : tt(`reasons.${status.reason}`),
    }
  })
})
</script>

<template>
  <div :class="['flex flex-col gap-4', 'font-normal']">
    <div />
    <div :class="['flex flex-wrap items-center justify-between gap-3']">
      <div :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tt('description') }}
      </div>
      <div
        data-testid="presence-host"
        :class="['flex items-center gap-2', 'rounded-full bg-neutral-100 px-3 py-1 text-xs dark:bg-neutral-800']"
      >
        <span :class="['text-neutral-500 dark:text-neutral-400']">{{ tt('host') }}</span>
        <span :class="['font-mono font-medium']">{{ snapshot?.host ?? '—' }}</span>
      </div>
    </div>

    <div
      v-if="!snapshot"
      :class="['rounded-lg bg-neutral-100/70 px-3 py-2 text-sm text-neutral-500 dark:bg-neutral-800/70 dark:text-neutral-400']"
    >
      {{ tt('pending') }}
    </div>

    <dl v-else :class="['grid gap-2']">
      <div
        v-for="row in rows"
        :key="row.signal"
        :data-testid="`presence-row-${row.signal}`"
        :class="['flex flex-col gap-1', 'rounded-lg bg-neutral-100/70 px-3 py-2 dark:bg-neutral-800/70']"
      >
        <div :class="['flex flex-wrap items-center justify-between gap-2']">
          <dt :class="['text-sm font-medium']">
            {{ row.name }}
          </dt>
          <dd :class="['rounded-full px-2.5 py-0.5 text-xs font-medium', row.tone]">
            {{ row.status }}
          </dd>
        </div>
        <dd v-if="row.reason" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ row.reason }}
        </dd>
      </div>
    </dl>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.pages.system.presence-sensing.title
  subtitleKey: settings.title
</route>
