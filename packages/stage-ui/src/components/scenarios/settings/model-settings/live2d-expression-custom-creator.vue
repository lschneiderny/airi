<script setup lang="ts">
import type { Live2DExpressionSettingsCommand, Live2DExpressionSettingsSnapshot } from '@proj-airi/stage-ui-live2d/stores/expression-store'

import { Button, FieldCombobox, FieldRange, Input } from '@proj-airi/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

type FreeParameter = Live2DExpressionSettingsSnapshot['freeParameters'][number]

const props = defineProps<{
  /** Parameters no expression or runtime driver writes; each can become one custom switch. */
  freeParameters: FreeParameter[]
}>()
const emit = defineEmits<{
  (e: 'command', command: Live2DExpressionSettingsCommand): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const noParameter = ''
const valueSteps = 100

function parameterLabel(parameter: FreeParameter) {
  return parameter.name === parameter.id ? parameter.id : `${parameter.name} (${parameter.id})`
}

const parameterOptions = computed(() => props.freeParameters.map(parameter => ({ value: parameter.id, label: parameterLabel(parameter) })))
const parameterId = ref(props.freeParameters[0]?.id ?? noParameter)
const parameter = computed(() => props.freeParameters.find(candidate => candidate.id === parameterId.value))
const draftTarget = ref(parameter.value?.max ?? 1)
const draftLabel = ref(parameter.value?.name ?? '')

// A new switch starts at the parameter's maximum, named after the parameter; both stay editable.
watch(parameter, (next) => {
  if (!next)
    return
  draftTarget.value = next.max
  draftLabel.value = next.name
})

const valueStep = computed(() => parameter.value ? (parameter.value.max - parameter.value.min) / valueSteps : 0.01)
function formatValue(value: number) {
  return value.toFixed(2)
}

const labelError = computed(() => draftLabel.value.trim() === '' ? t('settings.live2d.expressions.validation.label-required') : '')
const canCreate = computed(() => parameter.value !== undefined && labelError.value === '')

function create() {
  if (!parameter.value || !canCreate.value)
    return
  emit('command', { type: 'create-custom', custom: { label: draftLabel.value.trim(), parameterId: parameter.value.id, target: draftTarget.value } })
  emit('close')
}
</script>

<template>
  <div :class="['flex flex-col gap-3']">
    <div
      v-if="freeParameters.length === 0"
      :class="['text-sm text-neutral-500 dark:text-neutral-400']"
      role="status"
    >
      {{ t('settings.live2d.expressions.custom.none-free') }}
    </div>
    <template v-else>
      <FieldCombobox
        v-model="parameterId"
        :label="t('settings.live2d.expressions.custom.parameter')"
        :options="parameterOptions"
        :placeholder="t('settings.live2d.expressions.search')"
      />
      <FieldRange
        v-if="parameter"
        v-model="draftTarget"
        :label="t('settings.live2d.expressions.custom.value')"
        :min="parameter.min"
        :max="parameter.max"
        :step="valueStep"
        :format-value="formatValue"
      />
      <label :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.live2d.expressions.custom.label') }}
        <Input v-model="draftLabel" type="text" :aria-label="t('settings.live2d.expressions.custom.label')" />
        <span v-if="labelError" :class="['text-red-500']" role="alert">{{ labelError }}</span>
      </label>
    </template>

    <div :class="['flex flex-wrap gap-2']">
      <Button variant="primary" color="primary" :disabled="!canCreate" @click="create">
        {{ t('settings.live2d.expressions.custom.create') }}
      </Button>
      <Button @click="emit('close')">
        {{ t('settings.live2d.expressions.combos.cancel') }}
      </Button>
    </div>
  </div>
</template>
