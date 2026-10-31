<script setup lang="ts">
import type { EmotionMapping } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionPanelCommand, ExpressionPanelCustomCommand, ExpressionPanelEntry } from './source'

import { Button, Checkbox, FieldCombobox } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ExpressionComboEditor from './combo-editor.vue'

type Entry = ExpressionPanelEntry
type Emotion = EmotionMapping['emotion']
type ComboMember = NonNullable<Entry['members']>[number]

const props = defineProps<{
  /** Every catalog entry; a row lists the ones mapped to its emotion. */
  entries: Entry[]
}>()
const emit = defineEmits<{
  (e: 'command', command: ExpressionPanelCommand | ExpressionPanelCustomCommand): void
}>()

const { t } = useI18n()

const emotions: Emotion[] = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'love', 'flustered', 'sleepy']
const halfWeightAreas = new Set<NonNullable<Entry['area']>>(['eyes', 'mouth', 'cheeks'])
const noChoice = ''

/** Hidden duplicates fold into their primary, so only primaries take part in reactions. */
const visibleEntries = computed(() => props.entries.filter(entry => entry.duplicateOf === undefined))

function mappingFor(entry: Entry, emotion: Emotion) {
  return entry.mappings.find(mapping => mapping.emotion === emotion)
}
function chipsFor(emotion: Emotion) {
  return visibleEntries.value.filter(entry => mappingFor(entry, emotion) !== undefined)
}
function isHalf(entry: Entry, emotion: Emotion) {
  return (mappingFor(entry, emotion)?.weight ?? 1) < 1
}
function caption(entry: Entry) {
  if (entry.kind === 'combo')
    return t('settings.live2d.expressions.kinds.combo')
  return entry.area ? t(`settings.live2d.expressions.areas.${entry.area}`) : t(`settings.live2d.expressions.kinds.${entry.kind}`)
}
function emotionLabel(emotion: Emotion) {
  return t(`settings.live2d.expressions.emotions.${emotion}`)
}

/** Only entries an emotion can switch on: faces, effects and combos that resolved to at least one slot. */
function canReact(entry: Entry) {
  if (entry.kind === 'combo')
    return (entry.slots?.length ?? 0) > 0
  return entry.kind === 'face' || entry.kind === 'effect'
}
function candidatesFor(emotion: Emotion) {
  return visibleEntries.value
    .filter(entry => canReact(entry) && mappingFor(entry, emotion) === undefined)
    .map(entry => ({ value: entry.id, label: entry.label }))
}

/** Combos and custom switches keep their mappings in their own documents; every other id is an override. */
function mappingsCommand(entry: Entry, mappings: EmotionMapping[]): ExpressionPanelCommand | ExpressionPanelCustomCommand {
  if (entry.id.startsWith('combo:'))
    return { type: 'update-combo', id: entry.id, patch: { mappings } }
  if (entry.id.startsWith('custom:'))
    return { type: 'update-custom', id: entry.id, patch: { mappings } }
  return { type: 'update-entry', id: entry.id, patch: { mappings } }
}

function removeFrom(entry: Entry, emotion: Emotion) {
  emit('command', mappingsCommand(entry, entry.mappings.filter(mapping => mapping.emotion !== emotion)))
}

function addTo(emotion: Emotion, id: string | undefined) {
  if (id === undefined || id === noChoice)
    return
  const entry = visibleEntries.value.find(entry => entry.id === id)
  if (!entry || mappingFor(entry, emotion) !== undefined)
    return
  const mapping: EmotionMapping = {
    emotion,
    weight: entry.area !== undefined && halfWeightAreas.has(entry.area) ? 0.5 : 1,
    minBand: entry.kind === 'effect' ? 'strong' : 'clear',
  }
  emit('command', mappingsCommand(entry, [...entry.mappings, mapping]))
}

function setActive(entry: Entry, active: boolean) {
  emit('command', { type: 'set-active', id: entry.id, active })
}

// Selection is per row, so the same expression can be picked for one emotion and not another.
const selected = ref(new Set<string>())
function selectionKey(emotion: Emotion, id: string) {
  return `${emotion}\u0000${id}`
}
function isSelected(emotion: Emotion, id: string) {
  return selected.value.has(selectionKey(emotion, id))
}
function setSelected(emotion: Emotion, id: string, value: boolean) {
  const next = new Set(selected.value)
  if (value)
    next.add(selectionKey(emotion, id))
  else
    next.delete(selectionKey(emotion, id))
  selected.value = next
}
function selectedChips(emotion: Emotion) {
  return chipsFor(emotion).filter(entry => isSelected(emotion, entry.id))
}
function clearSelection(emotion: Emotion) {
  selected.value = new Set([...selected.value].filter(key => !key.startsWith(`${emotion}\u0000`)))
}

// One editor at a time: a combo starts from the selected plain expressions of its row.
const composingEmotion = ref<Emotion | null>(null)
function initialMembersFor(emotion: Emotion): ComboMember[] {
  return selectedChips(emotion)
    .filter(entry => entry.kind !== 'combo')
    .map(entry => ({ expressionId: entry.id, strength: 1 }))
}
function openComposer(emotion: Emotion) {
  if (selectedChips(emotion).length === 0)
    return
  composingEmotion.value = emotion
}
function closeComposer(emotion: Emotion) {
  composingEmotion.value = null
  clearSelection(emotion)
}
</script>

<template>
  <section :class="['flex flex-col gap-2']">
    <div :class="['min-w-0 flex flex-col gap-0.5']">
      <h3 :class="['text-sm font-medium text-neutral-700 dark:text-neutral-300']">
        {{ t('settings.live2d.expressions.reactions.title') }}
      </h3>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('settings.live2d.expressions.reactions.description') }}
      </p>
    </div>

    <div :class="['flex flex-col gap-2']">
      <section
        v-for="emotion in emotions"
        :key="emotion"
        :aria-label="emotionLabel(emotion)"
        :class="[
          'min-w-0 p-2',
          'flex flex-col gap-2',
          'rounded-lg border border-solid border-neutral-200 dark:border-neutral-800',
        ]"
      >
        <div :class="['flex flex-wrap items-center justify-between gap-2']">
          <h4 :class="['text-sm font-medium text-neutral-700 dark:text-neutral-300']">
            {{ emotionLabel(emotion) }}
          </h4>
          <div :class="['flex flex-wrap items-center gap-2']">
            <span
              v-if="selectedChips(emotion).length === 0"
              :class="['text-xs text-neutral-500 dark:text-neutral-400']"
            >{{ t('settings.live2d.expressions.reactions.make-combo-hint') }}</span>
            <Button
              size="sm"
              :disabled="selectedChips(emotion).length === 0"
              :aria-expanded="composingEmotion === emotion"
              @click="openComposer(emotion)"
            >
              {{ t('settings.live2d.expressions.reactions.make-combo') }}
            </Button>
          </div>
        </div>

        <div
          v-if="chipsFor(emotion).length === 0"
          :class="['text-xs text-neutral-500 dark:text-neutral-400']"
        >
          {{ t('settings.live2d.expressions.reactions.empty') }}
        </div>
        <div v-else :class="['flex flex-wrap gap-1.5']">
          <div
            v-for="entry in chipsFor(emotion)"
            :key="entry.id"
            :class="[
              'min-w-0 px-2 py-1',
              'flex flex-wrap items-center gap-2',
              'rounded-md bg-neutral-100 dark:bg-neutral-800',
            ]"
          >
            <Checkbox
              :model-value="isSelected(emotion, entry.id)"
              :aria-label="t('settings.live2d.expressions.reactions.select', { label: entry.label })"
              @update:model-value="setSelected(emotion, entry.id, $event)"
            />
            <div :class="['min-w-0 flex flex-col']">
              <span :class="['break-words', 'text-sm text-neutral-700 dark:text-neutral-200']">
                {{ entry.label }}
                <span
                  v-if="isHalf(entry, emotion)"
                  :class="['ml-0.5', 'text-xs font-medium text-primary-600 dark:text-primary-300']"
                  :title="t('settings.live2d.expressions.fields.weight')"
                >½</span>
              </span>
              <span :class="['text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400']">{{ caption(entry) }}</span>
            </div>
            <Button
              size="sm"
              :variant="entry.active ? 'primary' : 'secondary'"
              :color="entry.active ? 'primary' : 'neutral'"
              :aria-pressed="entry.active"
              :aria-label="t('settings.live2d.expressions.reactions.preview', { label: entry.label })"
              @click="setActive(entry, !entry.active)"
            >
              {{ t('settings.live2d.expressions.switch') }}
            </Button>
            <Button
              size="sm"
              :aria-label="t('settings.live2d.expressions.reactions.remove', { label: entry.label, emotion: emotionLabel(emotion) })"
              @click="removeFrom(entry, emotion)"
            >
              {{ t('settings.live2d.expressions.remove-mapping') }}
            </Button>
          </div>
        </div>

        <FieldCombobox
          :model-value="noChoice"
          :label="t('settings.live2d.expressions.reactions.add')"
          :options="candidatesFor(emotion)"
          :placeholder="t('settings.live2d.expressions.search')"
          @update:model-value="addTo(emotion, $event)"
        />

        <div
          v-if="composingEmotion === emotion"
          :class="['pt-2', 'border-t border-neutral-200 dark:border-neutral-800']"
        >
          <ExpressionComboEditor
            :key="emotion"
            :entries="entries"
            :initial-members="initialMembersFor(emotion)"
            :initial-emotion="emotion"
            @command="emit('command', $event)"
            @close="closeComposer(emotion)"
          />
        </div>
      </section>
    </div>
  </section>
</template>
