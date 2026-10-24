<script setup lang="ts">
import type { Live2DExpressionSettingsCommand, Live2DExpressionSettingsSnapshot } from '@proj-airi/stage-ui-live2d/stores/expression-store'

import { Button, Checkbox } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import Live2dExpressionComboEditor from './live2d-expression-combo-editor.vue'

type Entry = Live2DExpressionSettingsSnapshot['entries'][number]
type ComboMember = NonNullable<Entry['members']>[number]

const props = defineProps<{
  /** Every catalog entry; combos are the `combo` kind, the rest are member candidates. */
  entries: Entry[]
}>()
const emit = defineEmits<{
  (e: 'command', command: Live2DExpressionSettingsCommand): void
}>()

const { t } = useI18n()

const combos = computed(() => props.entries.filter(entry => entry.kind === 'combo'))
const entryById = computed(() => new Map(props.entries.map(entry => [entry.id, entry])))

function memberLabel(member: ComboMember) {
  return entryById.value.get(member.expressionId)?.label ?? member.expressionId
}
function memberChip(member: ComboMember) {
  return member.strength < 1 ? `${memberLabel(member)} ${Math.round(member.strength * 100)}%` : memberLabel(member)
}
function mappedEmotions(combo: Entry) {
  return [...new Set(combo.mappings.map(mapping => mapping.emotion))]
    .map(emotion => t(`settings.live2d.expressions.emotions.${emotion}`))
    .join(', ')
}
function isManualOnly(combo: Entry) {
  return (combo.slots?.length ?? 0) === 0
}

const creating = ref(false)
const editingId = ref<string | null>(null)

function toggleEditor(id: string) {
  editingId.value = editingId.value === id ? null : id
}
</script>

<template>
  <section :class="['flex flex-col gap-2']">
    <div :class="['flex flex-wrap items-start justify-between gap-2']">
      <div :class="['min-w-0 flex flex-1 basis-40 flex-col gap-0.5']">
        <h3 :class="['text-sm font-medium text-neutral-700 dark:text-neutral-300']">
          {{ t('settings.live2d.expressions.combos.title') }}
        </h3>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.live2d.expressions.combos.description') }}
        </p>
      </div>
      <Button size="sm" :aria-expanded="creating" @click="creating = !creating">
        {{ creating ? t('settings.live2d.expressions.combos.cancel') : t('settings.live2d.expressions.combos.new') }}
      </Button>
    </div>

    <div
      v-if="creating"
      :class="[
        'min-w-0 p-2',
        'rounded-lg border border-solid border-neutral-200 dark:border-neutral-800',
      ]"
    >
      <Live2dExpressionComboEditor
        :entries="entries"
        @command="emit('command', $event)"
        @close="creating = false"
      />
    </div>

    <div
      v-if="combos.length === 0 && !creating"
      :class="['py-2', 'text-sm text-neutral-500 dark:text-neutral-400']"
    >
      {{ t('settings.live2d.expressions.combos.empty') }}
    </div>

    <div v-else-if="combos.length > 0" role="list" :class="['flex flex-col gap-2']">
      <div
        v-for="combo in combos"
        :key="combo.id"
        role="listitem"
        :class="[
          'min-w-0 p-2',
          'flex flex-col gap-2',
          'rounded-lg border border-solid border-neutral-200 dark:border-neutral-800',
        ]"
      >
        <div :class="['flex flex-wrap items-center gap-2']">
          <div :class="['min-w-0 flex flex-1 basis-40 flex-col gap-1']">
            <div :class="['flex flex-wrap items-center gap-1.5']">
              <span :class="['break-words', 'text-sm font-medium text-neutral-700 dark:text-neutral-300']">{{ combo.label }}</span>
              <span
                v-if="combo.exposedToLlm && !isManualOnly(combo)"
                :class="[
                  'rounded-full px-1.5 py-0.5',
                  'text-[10px] font-medium uppercase tracking-wide',
                  'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200',
                ]"
              >{{ t('settings.live2d.expressions.combos.marker-ai') }}</span>
              <span
                v-if="combo.isDefault"
                :class="[
                  'rounded-full px-1.5 py-0.5',
                  'text-[10px] font-medium uppercase tracking-wide',
                  'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
                ]"
              >{{ t('settings.live2d.expressions.combos.marker-default') }}</span>
            </div>
            <div :class="['flex flex-wrap gap-1']">
              <span
                v-for="member in combo.members ?? []"
                :key="member.expressionId"
                :class="[
                  'rounded-md px-1.5 py-0.5',
                  'text-xs text-neutral-600 dark:text-neutral-300',
                  'bg-neutral-100 dark:bg-neutral-800',
                ]"
              >{{ memberChip(member) }}</span>
            </div>
            <span
              v-if="mappedEmotions(combo)"
              :class="['break-words', 'text-xs text-neutral-500 dark:text-neutral-400']"
            >{{ mappedEmotions(combo) }}</span>
            <span
              v-if="isManualOnly(combo)"
              :class="['break-words', 'text-xs text-amber-700 dark:text-amber-300']"
            >{{ t('settings.live2d.expressions.combos.manual-only') }}</span>
          </div>
          <div :class="['flex flex-wrap items-center gap-3']">
            <label :class="['flex items-center gap-2', 'text-xs text-neutral-500 dark:text-neutral-400']">
              {{ t('settings.live2d.expressions.switch') }}
              <Checkbox
                :model-value="combo.active"
                :aria-label="`${t('settings.live2d.expressions.switch')}: ${combo.label}`"
                @update:model-value="emit('command', { type: 'set-active', id: combo.id, active: $event })"
              />
            </label>
            <Button size="sm" :aria-expanded="editingId === combo.id" @click="toggleEditor(combo.id)">
              {{ editingId === combo.id ? t('settings.live2d.expressions.close-editor') : t('settings.live2d.expressions.edit') }}
            </Button>
          </div>
        </div>

        <div
          v-if="editingId === combo.id"
          :class="['pt-2', 'border-t border-neutral-200 dark:border-neutral-800']"
        >
          <Live2dExpressionComboEditor
            :key="combo.id"
            :combo="combo"
            :entries="entries"
            @command="emit('command', $event)"
            @close="editingId = null"
          />
        </div>
      </div>
    </div>
  </section>
</template>
