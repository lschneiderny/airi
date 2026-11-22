<script setup lang="ts">
import type { ExpressionArea, ExpressionKind, IdleUse, ItemExpressionDocument, Moment, Occasion } from '@proj-airi/stage-shared/expression-performance'

import type { AnyExpressionPanelCommand, ExpressionPanelEntry, ExpressionPanelItem } from './source'
import type { DraftMapping } from './trigger-editor.vue'

import { MOMENTS, OCCASIONS } from '@proj-airi/stage-shared/expression-performance'
import { Button, Checkbox, Input, Select } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import TagPicker from './tag-picker.vue'
import ExpressionTriggerEditor from './trigger-editor.vue'

import { groupDisplayName } from './group-name'

type Entry = ExpressionPanelEntry

const props = defineProps<{
  entry: Entry
  /** Every group in the catalog with its member labels in catalog order; "none" is always offered. */
  groups: { name: string, labels: string[] }[]
  /** Resolves another entry's label by id, for hidden duplicates and the overriding entry; defaults to the id. */
  labelOf?: (id: string) => string
  /** The renderer lets the character use entries on her own, so the editor offers the choice. */
  idleUse?: boolean
  /** The stored stage item behind an `item:` entry, for its asset and render state badges. */
  item?: ExpressionPanelItem
}>()
const emit = defineEmits<{
  (e: 'command', command: AnyExpressionPanelCommand): void
}>()

const { t } = useI18n()

const kinds: ExpressionKind[] = ['face', 'effect', 'outfit', 'prop', 'system']
/** A stage item is something she holds, an effect around her, or an outfit; never a face. */
const itemKinds: ExpressionKind[] = ['prop', 'effect', 'outfit']
const llmKinds: ExpressionKind[] = ['face', 'effect', 'prop']
const areas: ExpressionArea[] = ['whole-look', 'eyes', 'mouth', 'cheeks', 'effects', 'outfit-hair', 'props', 'hidden']
const idleUses: IdleUse[] = ['never', 'activity', 'sleep']
const noGroup = '__none__'
const noArea = '__none__'

// Custom switches and stage items live in their own documents, so their edits take their own commands.
const isCustom = computed(() => props.entry.id.startsWith('custom:'))
const isItem = computed(() => props.entry.id.startsWith('item:'))
// Items and customs have no detected origin, so they take no choose-one set and no inverted switch.
const hasOwnDocument = computed(() => isCustom.value || isItem.value)
const isUnsorted = computed(() => props.entry.kind === 'unsorted')
const labelOf = (id: string) => props.labelOf?.(id) ?? id
const aliasLabels = computed(() => (props.entry.aliases ?? []).map(alias => ({ id: alias, label: labelOf(alias) })))

/** What the panel can tell about an item at a glance: its file is gone, or the renderer could not place it as stored. */
const itemBadge = computed(() => {
  if (!isItem.value || !props.item)
    return ''
  if (!props.item.available)
    return t('settings.live2d.expressions.items.states.missing-asset')
  if (props.item.state === null || props.item.state === 'attached')
    return ''
  return t(`settings.live2d.expressions.items.states.${props.item.state}`)
})

const kindOptions = computed(() => (isItem.value ? itemKinds : kinds).map(kind => ({ value: kind, label: t(`settings.live2d.expressions.kinds.${kind}`) })))
const areaOptions = computed(() => [
  { value: noArea, label: t('settings.live2d.expressions.areas.none') },
  ...areas.map(area => ({ value: area, label: t(`settings.live2d.expressions.areas.${area}`) })),
])
const groupOptions = computed(() => [
  { value: noGroup, label: t('settings.live2d.expressions.group-none') },
  ...props.groups.map(group => ({ value: group.name, label: groupDisplayName(group.labels) })),
])
const idleUseOptions = computed(() => idleUses.map(use => ({ value: use, label: t(`settings.live2d.expressions.idle-use.options.${use}`) })))
// A system entry is never hers to use, whatever was stored for it.
const canUseIdle = computed(() => props.idleUse === true && props.entry.kind !== 'system' && props.entry.inverted !== true)
const occasionOptions = computed(() => OCCASIONS.map(value => ({ value, label: t(`settings.live2d.expressions.occasions.options.${value}`) })))
const momentOptions = computed(() => MOMENTS.map(value => ({ value, label: t(`settings.live2d.expressions.moments.options.${value}`) })))
const momentsTag = computed(() => {
  const moments = canUseIdle.value ? props.entry.moments ?? [] : []
  return moments.length === 0 ? '' : t('settings.live2d.expressions.moments.tag', { moments: moments.map(moment => t(`settings.live2d.expressions.moments.options.${moment}`)).join(', ') })
})
const idleUseTag = computed(() => {
  if (!canUseIdle.value || (props.entry.idleUse !== 'activity' && props.entry.idleUse !== 'sleep'))
    return ''
  const tag = t(`settings.live2d.expressions.idle-use.tags.${props.entry.idleUse}`)
  const occasions = props.entry.idleUse === 'activity' ? props.entry.occasions ?? [] : []
  return occasions.length === 0 ? tag : `${tag}: ${occasions.map(occasion => t(`settings.live2d.expressions.occasions.options.${occasion}`)).join(', ')}`
})
const mappedEmotions = computed(() => [...new Set(props.entry.mappings.map(mapping => mapping.emotion))]
  .map(emotion => t(`settings.emotions.${emotion}`))
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
const draftArea = ref<string>(noArea)
const initialArea = ref<string>(noArea)
const draftInverted = ref(false)
const draftIdleUse = ref<IdleUse>('never')
const draftOccasions = ref<Occasion[]>([])
const draftMoments = ref<Moment[]>([])
const draftMappings = ref<DraftMapping[]>([])

function loadDraft() {
  draftLabel.value = props.entry.label
  draftKind.value = props.entry.kind
  draftGroup.value = props.entry.group ?? noGroup
  draftArea.value = props.entry.area ?? noArea
  initialArea.value = draftArea.value
  draftInverted.value = props.entry.inverted ?? false
  draftIdleUse.value = props.entry.idleUse ?? 'never'
  draftOccasions.value = [...props.entry.occasions ?? []]
  draftMoments.value = [...props.entry.moments ?? []]
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
const triggerEditor = ref<InstanceType<typeof ExpressionTriggerEditor> | null>(null)
const hasErrors = computed<boolean>(() => labelError.value !== '' || (triggerEditor.value?.hasErrors ?? false))
// The header checkbox owns the AI toggle for entries, so the editor hides its own copy.
const draftExposedToLlm = ref(false)

function setExposedToLlm(exposedToLlm: boolean) {
  if (isItem.value)
    emit('command', { type: 'update-item', id: props.entry.id, patch: { exposedToLlm } })
  else if (isCustom.value)
    emit('command', { type: 'update-custom', id: props.entry.id, patch: { exposedToLlm } })
  else
    emit('command', { type: 'update-entry', id: props.entry.id, patch: { exposedToLlm } })
}

/** Gives an unsorted entry its kind and opens the editor so a mapping can follow right away. Items are never unsorted. */
function setKind(kind: ExpressionKind) {
  const patch = { kind, exposedToLlm: llmKinds.includes(kind) }
  if (isCustom.value)
    emit('command', { type: 'update-custom', id: props.entry.id, patch })
  else
    emit('command', { type: 'update-entry', id: props.entry.id, patch })
  if (!open.value) {
    loadDraft()
    open.value = true
  }
  draftKind.value = kind
}

function apply() {
  if (hasErrors.value)
    return
  const label = draftLabel.value.trim()
  const mappings = draftMappings.value.map(mapping => ({ emotion: mapping.emotion, weight: mapping.weight as number, minBand: mapping.minBand }))
  // Only a changed Area select is sent, so saving never pins an area the entry merely derived.
  const areaChanged = draftArea.value !== initialArea.value
  const area = areaChanged && draftArea.value !== noArea ? { area: draftArea.value as ExpressionArea } : {}
  const clearArea = areaChanged && draftArea.value === noArea ? { area: null } : {}
  // Only a changed choice is sent, so saving never stores "never" for an entry that had no choice.
  const idleUse = props.idleUse === true && draftIdleUse.value !== (props.entry.idleUse ?? 'never') ? { idleUse: draftIdleUse.value } : {}
  // Occasions belong to a pastime; an empty list means any time and clears a stored choice.
  const occasions = props.idleUse === true && draftIdleUse.value === 'activity' && JSON.stringify(draftOccasions.value) !== JSON.stringify(props.entry.occasions ?? []) ? { occasions: draftOccasions.value } : {}
  // Tagging a moment is the permission to use the entry for it; an empty list takes it back.
  const moments = props.idleUse === true && JSON.stringify(draftMoments.value) !== JSON.stringify(props.entry.moments ?? []) ? { moments: draftMoments.value } : {}
  if (isItem.value) {
    // The kind picker offers item kinds only, so the draft kind is one of them.
    const kind = draftKind.value as ItemExpressionDocument['kind']
    emit('command', { type: 'update-item', id: props.entry.id, patch: { label, kind, mappings, ...area, ...clearArea, ...idleUse, ...occasions, ...moments } })
  }
  else if (isCustom.value) {
    emit('command', { type: 'update-custom', id: props.entry.id, patch: { label, kind: draftKind.value, mappings, ...area, ...clearArea, ...idleUse, ...occasions, ...moments } })
  }
  else {
    emit('command', {
      type: 'update-entry',
      id: props.entry.id,
      patch: {
        label,
        kind: draftKind.value,
        group: draftGroup.value === noGroup ? null : draftGroup.value,
        confirmed: true,
        inverted: draftInverted.value,
        mappings,
        ...area,
        ...clearArea,
        ...idleUse,
        ...occasions,
        ...moments,
      },
    })
  }
  open.value = false
}

function deleteCustom() {
  emit('command', { type: 'delete-custom', id: props.entry.id })
  open.value = false
}

function deleteItem() {
  emit('command', { type: 'delete-item', id: props.entry.id })
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
        <span
          v-if="idleUseTag"
          :class="['break-words', 'text-xs text-neutral-500 dark:text-neutral-400']"
        >{{ idleUseTag }}</span>
        <span
          v-if="momentsTag"
          :class="['break-words', 'text-xs text-neutral-500 dark:text-neutral-400']"
        >{{ momentsTag }}</span>
        <span
          v-if="entry.overriddenBy !== null"
          :class="['break-words', 'text-xs text-amber-700 dark:text-amber-300']"
          role="status"
        >{{ t('settings.live2d.expressions.overridden-by', { label: entry.overriddenBy }) }}</span>
        <span
          v-if="itemBadge"
          data-testid="item-state"
          :class="['break-words', 'text-xs text-amber-700 dark:text-amber-300']"
          role="status"
        >{{ itemBadge }}</span>
        <div
          v-if="aliasLabels.length > 0"
          :class="['flex flex-wrap items-center gap-1.5', 'text-xs text-neutral-500 dark:text-neutral-400']"
        >
          <span :class="['break-words']">{{ t('settings.live2d.expressions.duplicates.also', { labels: aliasLabels.map(alias => alias.label).join(', ') }) }}</span>
          <Button
            v-for="alias in aliasLabels"
            :key="alias.id"
            size="sm"
            @click="emit('command', { type: 'update-entry', id: alias.id, patch: { keepSeparate: true } })"
          >
            {{ t('settings.live2d.expressions.duplicates.keep-separate', { label: alias.label }) }}
          </Button>
        </div>
      </div>
      <div :class="['flex flex-wrap items-center gap-3']">
        <!-- The Select root is renderless and drops attributes, so the picker takes its accessible name from this label. -->
        <label v-if="isUnsorted" :class="['min-w-32']">
          <span :class="['sr-only']">{{ `${t('settings.live2d.expressions.fields.kind')}: ${entry.label}` }}</span>
          <Select
            :model-value="entry.kind"
            :options="kindOptions"
            @update:model-value="setKind($event as ExpressionKind)"
          >
            <!-- Unsorted is not an offered kind, so the trigger names the current state itself. -->
            <template #value="{ option }">
              <span :class="['block truncate']">{{ option?.label ?? t('settings.live2d.expressions.kinds.unsorted') }}</span>
            </template>
          </Select>
        </label>
        <label
          v-if="llmKinds.includes(entry.kind)"
          :class="['flex items-center gap-2', 'text-xs text-neutral-500 dark:text-neutral-400']"
        >
          {{ t('settings.live2d.expressions.llm-exposed') }}
          <Checkbox
            :model-value="entry.exposedToLlm"
            :aria-label="`${t('settings.live2d.expressions.llm-exposed')}: ${entry.label}`"
            @update:model-value="setExposedToLlm"
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
        <div v-if="!hasOwnDocument" :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
          <span>{{ t('settings.live2d.expressions.fields.group') }}</span>
          <Select v-model="draftGroup" :options="groupOptions" />
        </div>
        <label :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
          <span>{{ t('settings.live2d.expressions.fields.area') }}</span>
          <Select v-model="draftArea" :options="areaOptions" />
        </label>
        <label v-if="canUseIdle" :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
          <span>{{ t('settings.live2d.expressions.fields.idle-use') }}</span>
          <Select v-model="draftIdleUse" :options="idleUseOptions" />
          <span>{{ t('settings.live2d.expressions.fields.idle-use-description') }}</span>
        </label>
      </div>
      <div
        v-if="canUseIdle && draftIdleUse === 'activity'"
        data-testid="expression-occasions"
        role="group"
        :aria-label="t('settings.live2d.expressions.occasions.title')"
        :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']"
      >
        <span>{{ t('settings.live2d.expressions.occasions.title') }}</span>
        <TagPicker v-model="draftOccasions" :options="occasionOptions" />
        <span>{{ t('settings.live2d.expressions.occasions.description') }}</span>
      </div>
      <div
        v-if="canUseIdle"
        data-testid="expression-moments"
        role="group"
        :aria-label="t('settings.live2d.expressions.moments.title')"
        :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']"
      >
        <span>{{ t('settings.live2d.expressions.moments.title') }}</span>
        <TagPicker v-model="draftMoments" :options="momentOptions" />
        <span>{{ t('settings.live2d.expressions.moments.description') }}</span>
      </div>

      <p v-if="isItem && llmKinds.includes(draftKind)" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.live2d.expressions.items.llm-exposed-description') }}
      </p>

      <label v-if="!hasOwnDocument" :class="['flex items-center justify-between gap-2', 'text-sm text-neutral-700 dark:text-neutral-300']">
        <span :class="['min-w-0 flex flex-1 flex-col gap-0.5']">
          {{ t('settings.live2d.expressions.fields.inverted') }}
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ t('settings.live2d.expressions.fields.inverted-description') }}</span>
        </span>
        <Checkbox v-model="draftInverted" :class="['shrink-0']" :aria-label="t('settings.live2d.expressions.fields.inverted')" />
      </label>

      <ExpressionTriggerEditor
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
        <Button v-if="isItem" color="red" @click="deleteItem">
          {{ t('settings.live2d.expressions.items.delete') }}
        </Button>
        <Button v-else-if="isCustom" color="red" @click="deleteCustom">
          {{ t('settings.live2d.expressions.custom.delete') }}
        </Button>
        <Button v-else @click="resetEntry">
          {{ t('settings.live2d.expressions.reset-entry') }}
        </Button>
      </div>
    </div>
  </div>
</template>
