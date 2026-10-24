<script setup lang="ts">
import type { ExpressionKind } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DExpressionSettingsCommand, Live2DExpressionSettingsSnapshot } from '@proj-airi/stage-ui-live2d/stores/expression-store'

import type { DraftMapping } from './live2d-expression-trigger-editor.vue'

import { Button, Checkbox, Input, Select } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import Live2dExpressionTriggerEditor from './live2d-expression-trigger-editor.vue'

import { groupDisplayName } from './expression-group-name'

type Entry = Live2DExpressionSettingsSnapshot['entries'][number]

const props = defineProps<{
  entry: Entry
  /** Every group in the catalog with its member labels in catalog order; "none" is always offered. */
  groups: { name: string, labels: string[] }[]
}>()
const emit = defineEmits<{
  (e: 'command', command: Live2DExpressionSettingsCommand): void
}>()

const { t } = useI18n()

const kinds: ExpressionKind[] = ['face', 'effect', 'outfit', 'prop', 'system']
const llmKinds: ExpressionKind[] = ['face', 'effect', 'prop']
const noGroup = '__none__'

const kindOptions = computed(() => kinds.map(kind => ({ value: kind, label: t(`settings.live2d.expressions.kinds.${kind}`) })))
const groupOptions = computed(() => [
  { value: noGroup, label: t('settings.live2d.expressions.group-none') },
  ...props.groups.map(group => ({ value: group.name, label: groupDisplayName(group.labels) })),
])
const mappedEmotions = computed(() => [...new Set(props.entry.mappings.map(mapping => mapping.emotion))]
  .map(emotion => t(`settings.live2d.expressions.emotions.${emotion}`))
  .join(', '))
const switchValue = computed(() => props.entry.inverted ? !props.entry.active : props.entry.active)

function setSwitch(value: boolean) {
  emit('command', { type: 'set-active', id: props.entry.id, active: props.entry.inverted ? !value : value })
}

const open = ref(false)
const baseline = ref('')
const draftLabel = ref('')
const draftKind = ref<ExpressionKind>('face')
const draftGroup = ref(noGroup)
const draftInverted = ref(false)
const draftMappings = ref<DraftMapping[]>([])

function loadDraft() {
  draftLabel.value = props.entry.label
  draftKind.value = props.entry.kind
  draftGroup.value = props.entry.group ?? noGroup
  draftInverted.value = props.entry.inverted ?? false
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
const triggerEditor = ref<InstanceType<typeof Live2dExpressionTriggerEditor> | null>(null)
const hasErrors = computed<boolean>(() => labelError.value !== '' || (triggerEditor.value?.hasErrors ?? false))
// The header checkbox owns the AI toggle for entries, so the editor hides its own copy.
const draftExposedToLlm = ref(false)

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
      confirmed: true,
      inverted: draftInverted.value,
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
  <div
    :class="[
      'min-w-0 p-2',
      'flex flex-col gap-2',
      'rounded-lg border border-solid border-neutral-200 dark:border-neutral-800',
    ]"
  >
    <div :class="['flex flex-wrap items-center gap-2']">
      <div :class="['min-w-0 flex flex-1 basis-40 flex-col gap-1']">
        <span
          :class="[
            'break-words',
            'text-sm font-medium text-neutral-700 dark:text-neutral-300',
          ]"
        >{{ entry.label }}</span>
        <span
          v-if="mappedEmotions"
          :class="['break-words', 'text-xs text-neutral-500 dark:text-neutral-400']"
        >{{ mappedEmotions }}</span>
      </div>
      <div :class="['flex flex-wrap items-center gap-3']">
        <label
          v-if="llmKinds.includes(entry.kind)"
          :class="['flex items-center gap-2', 'text-xs text-neutral-500 dark:text-neutral-400']"
        >
          {{ t('settings.live2d.expressions.llm-exposed') }}
          <Checkbox
            :model-value="entry.exposedToLlm"
            :aria-label="`${t('settings.live2d.expressions.llm-exposed')}: ${entry.label}`"
            @update:model-value="emit('command', { type: 'update-entry', id: entry.id, patch: { exposedToLlm: $event } })"
          />
        </label>
        <label :class="['flex items-center gap-2', 'text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.live2d.expressions.switch') }}
          <Checkbox
            :model-value="switchValue"
            :aria-label="`${t('settings.live2d.expressions.switch')}: ${entry.label}`"
            @update:model-value="setSwitch"
          />
        </label>
        <Button size="sm" :aria-expanded="open" @click="toggleEditor">
          {{ open ? t('settings.live2d.expressions.close-editor') : t('settings.live2d.expressions.edit') }}
        </Button>
      </div>
    </div>

    <div
      v-if="open"
      :class="[
        'flex flex-col gap-3 pt-2',
        'border-t border-neutral-200 dark:border-neutral-800',
      ]"
    >
      <div
        v-if="isStale"
        :class="[
          'flex flex-wrap items-center gap-2 rounded-lg p-2',
          'bg-amber-100 dark:bg-amber-900/40',
          'text-xs text-amber-800 dark:text-amber-200',
        ]"
        role="status"
      >
        <span :class="['flex-1']">{{ t('settings.live2d.expressions.stale') }}</span>
        <Button size="sm" @click="loadDraft">
          {{ t('settings.live2d.expressions.reload') }}
        </Button>
      </div>

      <label :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.live2d.expressions.fields.label') }}
        <Input v-model="draftLabel" type="text" :aria-label="t('settings.live2d.expressions.fields.label')" />
        <span v-if="labelError" :class="['text-red-500']" role="alert">{{ labelError }}</span>
      </label>

      <div :class="['grid grid-cols-1 gap-2 sm:grid-cols-2']">
        <div :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.live2d.expressions.fields.kind') }}
          <Select v-model="draftKind" :options="kindOptions" />
        </div>
        <div :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.live2d.expressions.fields.group') }}
          <Select v-model="draftGroup" :options="groupOptions" />
        </div>
      </div>

      <label :class="['flex items-center justify-between gap-2', 'text-sm text-neutral-700 dark:text-neutral-300']">
        <span :class="['min-w-0 flex flex-1 flex-col gap-0.5']">
          {{ t('settings.live2d.expressions.fields.inverted') }}
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ t('settings.live2d.expressions.fields.inverted-description') }}</span>
        </span>
        <Checkbox v-model="draftInverted" :class="['shrink-0']" :aria-label="t('settings.live2d.expressions.fields.inverted')" />
      </label>

      <Live2dExpressionTriggerEditor
        ref="triggerEditor"
        v-model:mappings="draftMappings"
        v-model:exposed-to-llm="draftExposedToLlm"
        :can-expose-to-llm="false"
        :default-min-band="draftKind === 'effect' ? 'strong' : 'clear'"
      />

      <div :class="['flex flex-wrap gap-2']">
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
