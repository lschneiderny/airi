<script setup lang="ts">
import type { EmotionMapping, ExpressionKind } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DExpressionSettingsCommand, Live2DExpressionSettingsSnapshot } from '@proj-airi/stage-ui-live2d/stores/expression-store'

import { Button, Checkbox, Input, Select } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

type Entry = Live2DExpressionSettingsSnapshot['groups'][number]

interface DraftMapping {
  emotion: EmotionMapping['emotion']
  weight: number | undefined
  minBand: EmotionMapping['minBand']
}

const props = defineProps<{
  entry: Entry
  /** Existing group names across the catalog; "none" is always offered. */
  groupNames: string[]
}>()
const emit = defineEmits<{
  (e: 'command', command: Live2DExpressionSettingsCommand): void
}>()

const { t } = useI18n()

const kinds: ExpressionKind[] = ['face', 'effect', 'outfit', 'prop', 'system']
const llmKinds: ExpressionKind[] = ['face', 'effect', 'prop']
const emotions: EmotionMapping['emotion'][] = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious']
const bands: EmotionMapping['minBand'][] = ['slight', 'clear', 'strong']
const noGroup = '__none__'

// Derived groups are named `group:<file>`; the prefix is an internal marker, not part of the name.
function groupLabel(name: string) {
  return name.replace(/^group:/, '')
}
const minWeight = 0.1
const maxWeight = 5

const kindOptions = computed(() => kinds.map(kind => ({ value: kind, label: t(`settings.live2d.expressions.kinds.${kind}`) })))
const emotionOptions = computed(() => emotions.map(emotion => ({ value: emotion, label: t(`settings.live2d.expressions.emotions.${emotion}`) })))
const bandOptions = computed(() => bands.map(band => ({ value: band, label: t(`settings.live2d.expressions.bands.${band}`) })))
const groupOptions = computed(() => [
  { value: noGroup, label: t('settings.live2d.expressions.group-none') },
  ...[...new Set([...props.groupNames, ...(props.entry.group ? [props.entry.group] : [])])].map(name => ({ value: name, label: groupLabel(name) })),
])

const open = ref(false)
const baseline = ref('')
const draftLabel = ref('')
const draftKind = ref<ExpressionKind>('face')
const draftGroup = ref(noGroup)
const draftConfirmed = ref(false)
const draftMappings = ref<DraftMapping[]>([])

function loadDraft() {
  draftLabel.value = props.entry.label
  draftKind.value = props.entry.kind
  draftGroup.value = props.entry.group ?? noGroup
  draftConfirmed.value = props.entry.confirmed
  draftMappings.value = props.entry.mappings.map(mapping => ({ emotion: mapping.emotion, weight: mapping.weight, minBand: mapping.minBand }))
  baseline.value = JSON.stringify(props.entry)
}

function toggleEditor() {
  if (!open.value)
    loadDraft()
  open.value = !open.value
}

// The draft is never overwritten by snapshot updates; the user chooses when to reload.
const isStale = computed(() => open.value && JSON.stringify(props.entry) !== baseline.value)

const labelError = computed(() => draftLabel.value.trim() === '' ? t('settings.live2d.expressions.validation.label-required') : '')
function weightError(weight: number | undefined) {
  return typeof weight === 'number' && Number.isFinite(weight) && weight >= minWeight && weight <= maxWeight
    ? ''
    : t('settings.live2d.expressions.validation.weight-range', { min: minWeight, max: maxWeight })
}
const hasErrors = computed(() => labelError.value !== '' || draftMappings.value.some(mapping => weightError(mapping.weight) !== ''))

function addMapping() {
  draftMappings.value = [...draftMappings.value, { emotion: 'happy', weight: 1, minBand: draftKind.value === 'effect' ? 'strong' : 'clear' }]
}

function removeMapping(index: number) {
  draftMappings.value = draftMappings.value.filter((_, i) => i !== index)
}

function apply() {
  if (hasErrors.value)
    return
  emit('command', {
    type: 'update-entry',
    id: props.entry.id,
    patch: {
      label: draftLabel.value.trim(),
      kind: draftKind.value,
      group: draftGroup.value === noGroup ? null : draftGroup.value,
      confirmed: draftConfirmed.value,
      mappings: draftMappings.value.map(mapping => ({ emotion: mapping.emotion, weight: mapping.weight as number, minBand: mapping.minBand })),
    },
  })
  open.value = false
}

function resetEntry() {
  emit('command', { type: 'reset-entry', id: props.entry.id })
  open.value = false
}
</script>

<template>
  <div class="min-w-0 flex flex-col gap-2 border border-neutral-200 rounded-lg border-solid p-2 dark:border-neutral-800">
    <div class="flex flex-wrap items-center gap-2">
      <div class="min-w-0 flex flex-1 flex-col gap-1">
        <span class="break-words text-sm text-neutral-700 font-medium dark:text-neutral-300">{{ entry.label }}</span>
        <div class="flex flex-wrap items-center gap-1 text-xs">
          <span class="rounded-full bg-primary-100 px-2 py-0.5 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200">{{ t(`settings.live2d.expressions.kinds.${entry.kind}`) }}</span>
          <span v-if="entry.group" class="max-w-full break-all rounded-lg bg-neutral-100 px-2 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{{ groupLabel(entry.group) }}</span>
          <span
            class="rounded-full px-2 py-0.5"
            :class="entry.confirmed ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'"
          >{{ entry.confirmed ? t('settings.live2d.expressions.confirmed') : t('settings.live2d.expressions.suggested') }}</span>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <label v-if="llmKinds.includes(entry.kind)" class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          {{ t('settings.live2d.expressions.llm-exposed') }}
          <Checkbox
            :model-value="entry.exposedToLlm"
            :aria-label="`${t('settings.live2d.expressions.llm-exposed')}: ${entry.label}`"
            @update:model-value="emit('command', { type: 'update-entry', id: entry.id, patch: { exposedToLlm: $event } })"
          />
        </label>
        <label class="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          {{ t('settings.live2d.expressions.preview') }}
          <Checkbox
            :model-value="entry.active"
            :aria-label="`${t('settings.live2d.expressions.preview')}: ${entry.label}`"
            @update:model-value="emit('command', { type: 'toggle', id: entry.id })"
          />
        </label>
        <Button size="sm" :aria-expanded="open" @click="toggleEditor">
          {{ open ? t('settings.live2d.expressions.close-editor') : t('settings.live2d.expressions.edit') }}
        </Button>
      </div>
    </div>

    <div v-if="open" class="flex flex-col gap-3 border-t border-neutral-200 pt-2 dark:border-neutral-800">
      <div v-if="isStale" class="flex flex-wrap items-center gap-2 rounded-lg bg-amber-100 p-2 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" role="status">
        <span class="flex-1">{{ t('settings.live2d.expressions.stale') }}</span>
        <Button size="sm" @click="loadDraft">
          {{ t('settings.live2d.expressions.reload') }}
        </Button>
      </div>

      <label class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
        {{ t('settings.live2d.expressions.fields.label') }}
        <Input v-model="draftLabel" type="text" :aria-label="t('settings.live2d.expressions.fields.label')" />
        <span v-if="labelError" class="text-red-500" role="alert">{{ labelError }}</span>
      </label>

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
          {{ t('settings.live2d.expressions.fields.kind') }}
          <Select v-model="draftKind" :options="kindOptions" />
        </div>
        <div class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
          {{ t('settings.live2d.expressions.fields.group') }}
          <Select v-model="draftGroup" :options="groupOptions" />
        </div>
      </div>

      <label class="flex items-center justify-between gap-2 text-sm text-neutral-700 dark:text-neutral-300">
        {{ t('settings.live2d.expressions.fields.confirmed') }}
        <Checkbox v-model="draftConfirmed" :aria-label="t('settings.live2d.expressions.fields.confirmed')" />
      </label>

      <div class="flex flex-col gap-2">
        <span class="text-xs text-neutral-500 dark:text-neutral-400">{{ t('settings.live2d.expressions.fields.mappings') }}</span>
        <div
          v-for="(mapping, index) in draftMappings"
          :key="index"
          class="flex flex-col gap-2 rounded-lg bg-neutral-50 p-2 dark:bg-neutral-900"
        >
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              {{ t('settings.live2d.expressions.fields.emotion') }}
              <Select v-model="mapping.emotion" :options="emotionOptions" />
            </div>
            <label class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              {{ t('settings.live2d.expressions.fields.weight') }}
              <Input v-model="mapping.weight" type="number" :aria-label="`${t('settings.live2d.expressions.fields.weight')} ${index + 1}`" />
            </label>
            <div class="flex flex-col gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              {{ t('settings.live2d.expressions.fields.min-band') }}
              <Select v-model="mapping.minBand" :options="bandOptions" />
            </div>
          </div>
          <span v-if="weightError(mapping.weight)" class="text-xs text-red-500" role="alert">{{ weightError(mapping.weight) }}</span>
          <div>
            <Button size="sm" @click="removeMapping(index)">
              {{ t('settings.live2d.expressions.remove-mapping') }}
            </Button>
          </div>
        </div>
        <div>
          <Button size="sm" @click="addMapping">
            {{ t('settings.live2d.expressions.add-mapping') }}
          </Button>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button @click="apply">
          {{ t('settings.live2d.expressions.apply') }}
        </Button>
        <Button @click="resetEntry">
          {{ t('settings.live2d.expressions.reset-entry') }}
        </Button>
      </div>
    </div>
  </div>
</template>
