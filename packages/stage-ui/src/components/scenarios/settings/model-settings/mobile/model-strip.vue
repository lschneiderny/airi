<script setup lang="ts">
import type { DisplayModel } from '../../../../../stores/display-models'

import { usePreferredReducedMotion, useResizeObserver } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useDisplayModelsStore } from '../../../../../stores/display-models'
import { ModelSelectorDialog } from '../../../dialogs/model-selector'

/**
 * A row of model thumbnails that scrolls sideways. A tap picks the model.
 * The up arrow opens the full model selector for import, rename, and delete. Both ways to pick go through this component, so the latest pick always wins.
 */
const props = defineProps<{
  selectedId?: string
  /** The model that the stage is loading. Its thumbnail shows a spinner. */
  loadingId?: string
}>()

const emit = defineEmits<{
  /** `undefined` comes from the full model selector, when the user clears the model. */
  pick: [model: DisplayModel | undefined]
}>()

const { t } = useI18n()

const displayModelStore = useDisplayModelsStore()
const { displayModels } = storeToRefs(displayModelStore)

/**
 * Counts picks. A model read that finishes after a newer pick is dropped, so the latest pick always wins.
 * A thumbnail tap, a pick in the full model selector, and a selection from outside each start a new pick.
 */
let generation = 0

watch(() => props.selectedId, () => {
  generation++
})

async function pick(id: string) {
  if (id === props.selectedId)
    return

  const current = ++generation
  const model = await displayModelStore.getDisplayModel(id)
  if (model && current === generation)
    emit('pick', model)
}

const selectorOpen = ref(false)
const selectedModel = computed(() => displayModels.value.find(model => model.id === props.selectedId))

function pickFromSelector(model: DisplayModel | undefined) {
  generation++
  emit('pick', model)
}

const list = useTemplateRef<HTMLElement>('list')

const indicator = useTemplateRef<HTMLElement>('indicator')
const reducedMotion = usePreferredReducedMotion()

/** The width of the bar at rest, in pixels. */
const INDICATOR_WIDTH = 20

/** The left edge of the bar at rest, in pixels from the start of the list. The bar sits under the selected thumbnail. */
const indicatorLeft = ref<number>()

/**
 * Moves the bar under the selected thumbnail. On a pick, the bar first stretches to cover the old and the new
 * thumbnail, then shrinks onto the new one. This is the elastic tab indicator, for example Android `TabLayout`
 * with `tabIndicatorAnimationMode="elastic"`. A resize moves the bar without the stretch.
 */
function placeIndicator(options: { stretch: boolean }) {
  const selected = list.value?.querySelector<HTMLElement>('[aria-checked="true"]')
  const from = indicatorLeft.value
  const to = selected ? selected.offsetLeft + (selected.offsetWidth - INDICATOR_WIDTH) / 2 : undefined
  indicatorLeft.value = to

  if (!options.stretch || from === undefined || to === undefined || from === to || reducedMotion.value === 'reduce')
    return

  const start = Math.min(from, to)
  const span = Math.abs(to - from) + INDICATOR_WIDTH
  indicator.value?.animate([
    { left: `${from}px`, width: `${INDICATOR_WIDTH}px`, easing: 'cubic-bezier(0.3, 0, 0.8, 0.15)' },
    { left: `${start}px`, width: `${span}px`, offset: 0.4, easing: 'cubic-bezier(0.05, 0.7, 0.1, 1)' },
    { left: `${to}px`, width: `${INDICATOR_WIDTH}px` },
  ], { duration: 480 })
}

watch(() => props.selectedId, () => placeIndicator({ stretch: true }), { flush: 'post' })
watch(displayModels, () => placeIndicator({ stretch: false }), { flush: 'post' })
useResizeObserver(list, () => placeIndicator({ stretch: false }))

// The selected model can be far down the list. Start with it in view.
onMounted(() => {
  placeIndicator({ stretch: false })
  list.value?.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
})
</script>

<template>
  <div :class="['flex items-center gap-1']">
    <div
      ref="list"
      role="radiogroup"
      :aria-label="t('settings.pages.models.editor.tabs.model')"
      :class="['relative min-w-0 flex flex-1 gap-2.5 overflow-x-auto pb-3 pt-1', 'snap-x scrollbar-none']"
    >
      <button
        v-for="model in displayModels"
        :key="model.id"
        type="button"
        role="radio"
        :aria-checked="model.id === selectedId"
        :aria-label="model.name"
        :aria-busy="model.id === loadingId"
        :class="[
          'shrink-0 snap-start rounded-xl',
          'outline-none focus-visible:ring-2 focus-visible:ring-primary-400/60',
        ]"
        @click="pick(model.id)"
      >
        <span
          :class="[
            'relative size-14 overflow-hidden rounded-xl',
            'flex items-center justify-center',
            'bg-neutral-200/50 dark:bg-neutral-800/60',
          ]"
        >
          <img
            v-if="model.previewImage"
            :src="model.previewImage"
            alt=""
            draggable="false"
            :class="['size-full object-cover object-top']"
          >
          <span
            v-else
            aria-hidden="true"
            :class="['i-mingcute:user-3-line', 'size-6 text-neutral-500 dark:text-neutral-400']"
          />
          <!-- A spinner covers the thumbnail while the stage loads the model. -->
          <Transition
            enter-active-class="transition-opacity duration-200"
            enter-from-class="opacity-0"
            leave-active-class="transition-opacity duration-200"
            leave-to-class="opacity-0"
          >
            <span
              v-if="model.id === loadingId"
              aria-hidden="true"
              :class="['absolute inset-0 flex items-center justify-center', 'bg-neutral-50/60 dark:bg-neutral-900/60']"
            >
              <span :class="['i-mingcute:loading-3-line size-5 animate-spin text-primary-600 dark:text-primary-300']" />
            </span>
          </Transition>
        </span>
      </button>

      <!-- One short bar under the thumbnails marks the selected model. It stretches and shrinks onto the new model on a pick. -->
      <span
        v-if="indicatorLeft !== undefined"
        ref="indicator"
        aria-hidden="true"
        :style="{ left: `${indicatorLeft}px`, width: `${INDICATOR_WIDTH}px` }"
        :class="['absolute bottom-0.5 h-1 rounded-full', 'bg-primary-500 dark:bg-primary-400']"
      />
    </div>

    <ModelSelectorDialog v-model:show="selectorOpen" :selected-model="selectedModel" @pick="pickFromSelector">
      <button
        type="button"
        :aria-label="t('settings.pages.models.editor.model.all-models')"
        :class="[
          'size-10 shrink-0 rounded-full',
          'flex items-center justify-center',
          'text-neutral-600 dark:text-neutral-300',
          'outline-none transition-colors duration-200 hover:bg-primary-500/10',
          'focus-visible:ring-2 focus-visible:ring-primary-400/60',
        ]"
      >
        <span :class="['i-mingcute:up-line size-5']" />
      </button>
    </ModelSelectorDialog>
  </div>
</template>
