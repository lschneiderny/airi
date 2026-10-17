<script setup lang="ts">
import { useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'

const { t } = useI18n()
const diagnostics = useNaturalMotionDiagnostics()
const { pendingRequest, result, trace, failure } = storeToRefs(diagnostics)

/** Shown before the first result; frozen so the computed keeps one reference. */
const noRows = Object.freeze([])

const rows = computed(() => result.value
  ? Object.entries(result.value.report.metrics).map(([id, metric]) => ({ id, ...metric }))
  : noRows)

function formatNumber(value: number | null) {
  if (value === null)
    return '-'
  // Jitter and its band sit near 1e-4, which three decimals would show as 0.000.
  return value === 0 || Math.abs(value) >= 0.01 ? value.toFixed(3) : value.toExponential(2)
}

function passLabel(pass: boolean | null) {
  if (pass === null)
    return '-'
  return t(`tamagotchi.settings.devtools.pages.live2d-natural-motion.results.${pass ? 'pass' : 'fail'}`)
}
</script>

<template>
  <Section
    :title="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.capture.title')"
    icon="i-solar:graph-new-bold-duotone"
    inner-class="gap-4"
  >
    <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.capture.description') }}
    </div>
    <div :class="['flex flex-wrap items-center gap-2']">
      <Button
        v-for="seconds in [60, 300, 600]"
        :key="seconds"
        :data-capture-seconds="seconds"
        size="sm"
        icon="i-solar:record-circle-bold-duotone"
        :disabled="!!pendingRequest"
        :label="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.capture.start', { seconds })"
        @click="diagnostics.requestCapture(seconds)"
      />
      <Button
        v-if="pendingRequest"
        data-testid="natural-capture-cancel"
        size="sm"
        icon="i-solar:stop-circle-bold-duotone"
        :label="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.capture.cancel')"
        @click="diagnostics.cancelCapture()"
      />
    </div>
    <div
      v-if="pendingRequest"
      data-testid="natural-capture-pending"
      :class="['text-sm text-neutral-600 dark:text-neutral-300']"
    >
      {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.capture.pending', { seconds: pendingRequest.durationSeconds }) }}
    </div>
    <div
      v-else-if="failure"
      data-testid="natural-capture-failure"
      :class="['text-sm text-red-600 dark:text-red-400']"
    >
      {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.capture.failed', { reason: failure }) }}
    </div>

    <div v-if="result" data-testid="natural-capture-results" :class="['flex flex-col gap-3']">
      <div :class="['flex flex-wrap items-center gap-x-4 gap-y-1 text-sm']">
        <span>
          {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.results.score') }}
          <span data-testid="natural-capture-score" :class="['font-mono font-semibold']">{{ result.report.score.toFixed(2) }}</span>
        </span>
        <span>{{ passLabel(result.report.pass) }}</span>
        <span>
          {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.results.frames') }}
          <span :class="['font-mono']">{{ result.frames }}</span>
        </span>
        <span v-if="trace?.meta.model" :class="['font-mono']">{{ trace.meta.model }}</span>
      </div>
      <div v-if="result.report.hardFailures.length" data-testid="natural-capture-hard-failures" :class="['text-sm text-red-600 dark:text-red-400']">
        {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.results.hard-failures') }}
        <span :class="['font-mono']">{{ result.report.hardFailures.join(', ') }}</span>
      </div>
      <div :class="['flex flex-wrap items-center gap-2']">
        <Button
          data-testid="natural-capture-download"
          size="sm"
          icon="i-solar:download-minimalistic-bold-duotone"
          :disabled="!trace"
          :label="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.results.download')"
          @click="diagnostics.saveTrace()"
        />
        <span data-testid="natural-capture-saved-path" :class="['text-xs font-mono text-neutral-500 dark:text-neutral-400 break-all']">
          {{ result.savedPath ?? t('tamagotchi.settings.devtools.pages.live2d-natural-motion.results.not-saved') }}
        </span>
      </div>
      <div :class="['overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800']">
        <table :class="['w-full text-left text-xs']">
          <thead :class="['bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300']">
            <tr>
              <th :class="['px-3 py-2 font-medium']">
                {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.results.columns.metric') }}
              </th>
              <th :class="['px-3 py-2 font-medium']">
                {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.results.columns.value') }}
              </th>
              <th :class="['px-3 py-2 font-medium']">
                {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.results.columns.band') }}
              </th>
              <th :class="['px-3 py-2 font-medium']">
                {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.results.columns.pass') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.id"
              :data-metric="row.id"
              :class="['border-t border-neutral-200 dark:border-neutral-800 font-mono']"
            >
              <td :class="['px-3 py-1.5']">
                {{ row.id }}
              </td>
              <td :class="['px-3 py-1.5']">
                {{ formatNumber(row.value) }}
              </td>
              <td :class="['px-3 py-1.5']">
                {{ row.band ? `${formatNumber(row.band[0])} - ${formatNumber(row.band[1])}` : '-' }}
              </td>
              <td :class="['px-3 py-1.5', row.pass === false ? 'text-red-600 dark:text-red-400' : '']">
                {{ passLabel(row.pass) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Section>
</template>
