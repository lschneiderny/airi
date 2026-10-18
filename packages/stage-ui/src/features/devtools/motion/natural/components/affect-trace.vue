<script setup lang="ts">
import type { AffectTraceFailureCode } from '@proj-airi/stage-shared/expression-performance'

import { useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'

const { t } = useI18n()
const diagnostics = useNaturalMotionDiagnostics()
const { affectTraceRequest, affectTraceResult, affectTraceFailure } = storeToRefs(diagnostics)

const failureMessageKeys = {
  'no-recording': 'tamagotchi.settings.devtools.pages.live2d-natural-motion.affect-trace.failures.no-recording',
  'save-failed': 'tamagotchi.settings.devtools.pages.live2d-natural-motion.affect-trace.failures.save-failed',
} satisfies Record<AffectTraceFailureCode, string>
</script>

<template>
  <Section
    :title="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.affect-trace.title')"
    icon="i-solar:document-text-bold-duotone"
    inner-class="gap-4"
  >
    <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.affect-trace.description') }}
    </div>
    <div :class="['flex flex-wrap items-center gap-2']">
      <Button
        data-testid="affect-trace-start"
        size="sm"
        icon="i-solar:record-circle-bold-duotone"
        :disabled="!!affectTraceRequest"
        :label="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.affect-trace.start')"
        @click="diagnostics.requestAffectTrace('start')"
      />
      <Button
        data-testid="affect-trace-export"
        size="sm"
        icon="i-solar:download-minimalistic-bold-duotone"
        :disabled="!!affectTraceRequest"
        :label="t('tamagotchi.settings.devtools.pages.live2d-natural-motion.affect-trace.export')"
        @click="diagnostics.requestAffectTrace('export')"
      />
    </div>
    <div
      v-if="affectTraceRequest"
      data-testid="affect-trace-pending"
      :class="['text-sm text-neutral-600 dark:text-neutral-300']"
    >
      {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.affect-trace.pending') }}
    </div>
    <div
      v-else-if="affectTraceFailure"
      data-testid="affect-trace-failure"
      :class="['text-sm text-red-600 dark:text-red-400']"
    >
      {{ t(failureMessageKeys[affectTraceFailure]) }}
    </div>
    <div
      v-else-if="affectTraceResult"
      data-testid="affect-trace-status"
      :class="['flex flex-col gap-1 text-sm text-neutral-600 dark:text-neutral-300']"
    >
      <span v-if="affectTraceResult.action === 'start'">
        {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.affect-trace.recording') }}
      </span>
      <template v-else>
        <span data-testid="affect-trace-entries">
          {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.affect-trace.exported', { entries: affectTraceResult.entries }) }}
        </span>
        <span v-if="affectTraceResult.truncated" data-testid="affect-trace-truncated" :class="['text-red-600 dark:text-red-400']">
          {{ t('tamagotchi.settings.devtools.pages.live2d-natural-motion.affect-trace.truncated') }}
        </span>
        <span data-testid="affect-trace-saved-path" :class="['text-xs font-mono text-neutral-500 dark:text-neutral-400 break-all']">
          {{ affectTraceResult.savedPath ?? t('tamagotchi.settings.devtools.pages.live2d-natural-motion.results.not-saved') }}
        </span>
      </template>
    </div>
  </Section>
</template>
