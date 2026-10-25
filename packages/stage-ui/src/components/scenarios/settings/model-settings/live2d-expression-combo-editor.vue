<script setup lang="ts">
import type { EmotionMapping, ExpressionArea } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DExpressionSettingsCommand, Live2DExpressionSettingsSnapshot } from '@proj-airi/stage-ui-live2d/stores/expression-store'

import type { DraftMapping } from './live2d-expression-trigger-editor.vue'

import { Button, FieldCombobox, FieldRange, Input, Select } from '@proj-airi/ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import Live2dExpressionTriggerEditor from './live2d-expression-trigger-editor.vue'

type Entry = Live2DExpressionSettingsSnapshot['entries'][number]
type ComboMember = NonNullable<Entry['members']>[number]

const props = defineProps<{
  /** The combo being edited; absent for a new combo. */
  combo?: Entry
  /** Every catalog entry; members are looked up by id and candidates are drawn from it. */
  entries: Entry[]
  /** Members a new combo starts with, for example the selected expressions of a reaction. */
  initialMembers?: ComboMember[]
  /** When set, a new combo starts mapped to this emotion and labelled after it. */
  initialEmotion?: EmotionMapping['emotion']
}>()
const emit = defineEmits<{
  (e: 'command', command: Live2DExpressionSettingsCommand): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const areas: ExpressionArea[] = ['whole-look', 'eyes', 'mouth', 'cheeks', 'effects', 'outfit-hair', 'props', 'hidden']
const noArea = '__none__'
const noMember = ''
const strengthStep = 0.05

const areaOptions = computed(() => [
  { value: noArea, label: t('settings.live2d.expressions.group-none') },
  ...areas.map(area => ({ value: area, label: t(`settings.live2d.expressions.areas.${area}`) })),
])

function initialLabel() {
  if (props.combo)
    return props.combo.label
  if (props.initialEmotion)
    return t('settings.live2d.expressions.combos.default-label', { emotion: t(`settings.live2d.expressions.emotions.${props.initialEmotion}`) })
  return ''
}

function initialMappings(): DraftMapping[] {
  if (props.combo)
    return props.combo.mappings.map(mapping => ({ emotion: mapping.emotion, weight: mapping.weight, minBand: mapping.minBand }))
  if (props.initialEmotion)
    return [{ emotion: props.initialEmotion, weight: 1, minBand: 'clear' }]
  return []
}

const draftLabel = ref(initialLabel())
const draftMembers = ref<ComboMember[]>((props.combo?.members ?? props.initialMembers ?? []).map(member => ({ ...member })))
const initialArea = props.combo?.area ?? noArea
const draftArea = ref<string>(initialArea)
const draftMappings = ref<DraftMapping[]>(initialMappings())
const draftExposedToLlm = ref(props.combo?.exposedToLlm ?? false)
// Only the store knows a combo's slots; a new combo gets its AI eligibility on creation.
const canExposeToLlm = computed(() => (props.combo?.slots?.length ?? 0) > 0)

const entryById = computed(() => new Map(props.entries.map(entry => [entry.id, entry])))
function memberLabel(member: ComboMember) {
  return entryById.value.get(member.expressionId)?.label ?? member.expressionId
}
function memberUsesOverwrite(member: ComboMember) {
  return entryById.value.get(member.expressionId)?.usesOverwrite ?? false
}
function formatStrength(value: number) {
  return `${Math.round(value * 100)}%`
}

const pendingMember = ref(noMember)
const candidateOptions = computed(() => props.entries
  .filter(entry => entry.kind !== 'combo' && !entry.duplicateOf && !draftMembers.value.some(member => member.expressionId === entry.id))
  .map(entry => ({ value: entry.id, label: entry.label })))

watch(pendingMember, (id) => {
  if (id === noMember)
    return
  if (!draftMembers.value.some(member => member.expressionId === id))
    draftMembers.value = [...draftMembers.value, { expressionId: id, strength: 1 }]
  pendingMember.value = noMember
})

function removeMember(index: number) {
  draftMembers.value = draftMembers.value.filter((_, i) => i !== index)
}

const labelError = computed(() => draftLabel.value.trim() === '' ? t('settings.live2d.expressions.validation.label-required') : '')
const triggerEditor = ref<InstanceType<typeof Live2dExpressionTriggerEditor> | null>(null)
const canSave = computed<boolean>(() => labelError.value === '' && draftMembers.value.length > 0 && !(triggerEditor.value?.hasErrors ?? false))

function save() {
  if (!canSave.value)
    return
  const label = draftLabel.value.trim()
  const members = draftMembers.value.map(member => ({ ...member }))
  const mappings = draftMappings.value.map(mapping => ({ emotion: mapping.emotion, weight: mapping.weight as number, minBand: mapping.minBand }))
  if (props.combo) {
    emit('command', {
      type: 'update-combo',
      id: props.combo.id,
      patch: {
        label,
        members,
        mappings,
        ...(canExposeToLlm.value ? { exposedToLlm: draftExposedToLlm.value } : {}),
        // Only a changed Area select is sent, so saving never pins a derived area; None clears a stored one.
        ...(draftArea.value === initialArea
          ? {}
          : { area: draftArea.value === noArea ? null : draftArea.value as ExpressionArea }),
      },
    })
  }
  else {
    emit('command', {
      type: 'create-combo',
      combo: { label, members, mappings, ...(draftArea.value === noArea ? {} : { area: draftArea.value as ExpressionArea }) },
    })
  }
  emit('close')
}

// Delete is a two-step action: the first click shows the question, the second one deletes.
const confirmingDelete = ref(false)
function remove() {
  if (!props.combo)
    return
  emit('command', { type: 'delete-combo', id: props.combo.id })
  emit('close')
}
</script>

<template>
  <div :class="['flex flex-col gap-3']">
    <label :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.live2d.expressions.fields.label') }}
      <Input v-model="draftLabel" type="text" :aria-label="t('settings.live2d.expressions.fields.label')" />
      <span v-if="labelError" :class="['text-red-500']" role="alert">{{ labelError }}</span>
    </label>

    <div :class="['flex flex-col gap-2']">
      <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ t('settings.live2d.expressions.combos.members') }}</span>
      <div
        v-for="(member, index) in draftMembers"
        :key="member.expressionId"
        :class="['flex flex-col gap-2 rounded-lg p-2', 'bg-neutral-50 dark:bg-neutral-900']"
      >
        <FieldRange
          v-model="member.strength"
          :label="memberLabel(member)"
          :description="memberUsesOverwrite(member) ? t('settings.live2d.expressions.combos.strength-hint') : undefined"
          :min="0"
          :max="1"
          :step="strengthStep"
          :format-value="formatStrength"
        />
        <div>
          <Button size="sm" @click="removeMember(index)">
            {{ t('settings.live2d.expressions.combos.remove-member', { label: memberLabel(member) }) }}
          </Button>
        </div>
      </div>
      <FieldCombobox
        v-model="pendingMember"
        :label="t('settings.live2d.expressions.combos.add-member')"
        :options="candidateOptions"
        :placeholder="t('settings.live2d.expressions.search')"
      />
    </div>

    <label :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
      {{ t('settings.live2d.expressions.fields.area') }}
      <Select v-model="draftArea" :options="areaOptions" />
    </label>

    <Live2dExpressionTriggerEditor
      ref="triggerEditor"
      v-model:mappings="draftMappings"
      v-model:exposed-to-llm="draftExposedToLlm"
      :can-expose-to-llm="canExposeToLlm"
      default-min-band="clear"
    />

    <div
      v-if="combo && confirmingDelete"
      :class="[
        'flex flex-wrap items-center gap-2 rounded-lg p-2',
        'bg-red-50 dark:bg-red-950/40',
        'text-xs text-red-800 dark:text-red-200',
      ]"
      role="alertdialog"
      :aria-label="t('settings.live2d.expressions.combos.delete')"
    >
      <span :class="['min-w-0 flex-1 basis-40']">{{ t('settings.live2d.expressions.combos.delete-confirm', { label: combo.label }) }}</span>
      <Button size="sm" color="red" variant="primary" @click="remove">
        {{ t('settings.live2d.expressions.combos.delete') }}
      </Button>
      <Button size="sm" @click="confirmingDelete = false">
        {{ t('settings.live2d.expressions.combos.cancel') }}
      </Button>
    </div>
    <div v-else :class="['flex flex-wrap gap-2']">
      <Button variant="primary" color="primary" :disabled="!canSave" @click="save">
        {{ t('settings.live2d.expressions.combos.save') }}
      </Button>
      <Button @click="emit('close')">
        {{ t('settings.live2d.expressions.combos.cancel') }}
      </Button>
      <Button v-if="combo" color="red" @click="confirmingDelete = true">
        {{ t('settings.live2d.expressions.combos.delete') }}
      </Button>
    </div>
  </div>
</template>
