<script setup lang="ts">
import type { StageItemAsset } from '../../../../../database/repos/stage-items.repo'
import type { StageItemImportRefusal } from '../../../../../stores/stage-item-library'
import type { ExpressionPanelItemCommand, ExpressionPanelSnapshot } from './source'

import { errorMessageFrom } from '@moeru/std'
import { countModelsPlacingAsset, MAX_MODEL_ITEMS } from '@proj-airi/stage-ui-live2d/stores/expression-catalog-persistence'
import { Alert, Button, Skeleton } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useStageItemLibraryStore } from '../../../../../stores/stage-item-library'

/**
 * The device-wide item library and the way into this model's catalog. Import, list, and removal talk to the library
 * store, which any window may write; "Add to this model" is a command for the store that owns the model on stage.
 */
const props = defineProps<{
  snapshot: ExpressionPanelSnapshot
}>()
const emit = defineEmits<{
  (e: 'command', command: ExpressionPanelItemCommand): void
}>()

const { t } = useI18n()
const prefix = 'settings.live2d.expressions.items'

const library = useStageItemLibraryStore()
const { assets, error } = storeToRefs(library)
// The first list read decides between the skeleton and the empty or ready state; later reloads keep the list visible.
const loaded = ref(false)
library.load().catch(() => {}).finally(() => {
  loaded.value = true
})

// One object URL per image asset, revoked when the asset leaves the library or the panel closes. A blob read in
// flight is never started twice, and a URL created after its asset left or the panel closed is revoked at once.
const thumbnails = shallowRef<Record<string, string>>({})
const loading = new Set<string>()
let disposed = false

function wantsThumbnail(id: string) {
  return !disposed && assets.value.some(asset => asset.id === id && asset.format !== 'live2d-zip')
}

async function loadThumbnail(id: string) {
  loading.add(id)
  try {
    const blob = await library.blobOf(id)
    if (!blob)
      return
    const url = URL.createObjectURL(blob)
    if (!wantsThumbnail(id)) {
      URL.revokeObjectURL(url)
      return
    }
    thumbnails.value = { ...thumbnails.value, [id]: url }
  }
  catch (error) {
    console.warn('[stage-items] Failed to read a thumbnail:', id, errorMessageFrom(error))
  }
  finally {
    loading.delete(id)
  }
}

watch(assets, (list) => {
  const kept: Record<string, string> = {}
  for (const [id, url] of Object.entries(thumbnails.value)) {
    if (wantsThumbnail(id))
      kept[id] = url
    else
      URL.revokeObjectURL(url)
  }
  thumbnails.value = kept
  for (const asset of list) {
    if (asset.format !== 'live2d-zip' && !kept[asset.id] && !loading.has(asset.id))
      void loadThumbnail(asset.id)
  }
}, { immediate: true })
onUnmounted(() => {
  disposed = true
  for (const url of Object.values(thumbnails.value))
    URL.revokeObjectURL(url)
  thumbnails.value = {}
})

function detail(asset: StageItemAsset) {
  const size = t(`${prefix}.size`, { width: asset.width, height: asset.height })
  return asset.format === 'gif' && asset.frames !== undefined ? `${size} · ${t(`${prefix}.frames`, { count: asset.frames })}` : size
}

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const importing = ref(false)
const refusals = ref<{ name: string, reason: StageItemImportRefusal }[]>([])
const importFailed = ref(false)

async function importChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...input.files ?? []]
  // The same file may be chosen again after a refusal.
  input.value = ''
  if (files.length === 0)
    return
  importing.value = true
  importFailed.value = false
  try {
    const results = await library.importFiles(files)
    refusals.value = results.flatMap(result => result.ok ? [] : [{ name: result.name, reason: result.reason }])
  }
  catch (error) {
    console.warn('[stage-items] Failed to import files:', errorMessageFrom(error))
    importFailed.value = true
  }
  finally {
    importing.value = false
  }
}

// Removal asks first, because it strips the item from every model that places the asset.
const removing = ref<{ asset: StageItemAsset, models: number } | null>(null)
function askRemove(asset: StageItemAsset) {
  removing.value = { asset, models: countModelsPlacingAsset(asset.id) }
}
async function confirmRemove() {
  const pending = removing.value
  removing.value = null
  if (pending)
    await library.remove(pending.asset.id)
}

const itemCount = computed(() => props.snapshot.items?.length ?? 0)
const addBlocker = computed(() => {
  if (itemCount.value >= MAX_MODEL_ITEMS)
    return t(`${prefix}.add-full`, { max: MAX_MODEL_ITEMS })
  if (!props.snapshot.canvas)
    return t(`${prefix}.add-no-canvas`)
  return ''
})

/** A new item sits in front of her, centered on her canvas, one third of its width wide. */
function addToModel(asset: StageItemAsset) {
  const canvas = props.snapshot.canvas
  if (!canvas || addBlocker.value)
    return
  const label = asset.name.replace(/\.[^.]+$/, '') || asset.name
  emit('command', {
    type: 'create-item',
    item: {
      assetId: asset.id,
      label,
      kind: 'prop',
      mappings: [],
      placement: {
        x: canvas.width / 2,
        y: canvas.height / 2,
        rotation: 0,
        scale: canvas.width / 3 / asset.width,
        flipX: false,
        anchor: { x: 0.5, y: 0.5 },
        layer: { kind: 'front' },
      },
    },
  })
}
</script>

<template>
  <section data-testid="stage-items" :class="['flex flex-col gap-2']">
    <div :class="['flex flex-wrap items-center justify-between gap-2']">
      <div :class="['min-w-0 flex flex-col gap-0.5']">
        <h3 :class="['text-sm font-medium text-neutral-700 dark:text-neutral-300']">
          {{ t(`${prefix}.title`) }}
        </h3>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${prefix}.description`) }}
        </p>
      </div>
      <Button size="sm" :loading="importing" @click="fileInput?.click()">
        {{ importing ? t(`${prefix}.importing`) : t(`${prefix}.import`) }}
      </Button>
      <input
        ref="fileInput"
        type="file"
        multiple
        accept="image/png,image/jpeg,image/gif,application/zip,.zip"
        :aria-label="t(`${prefix}.import`)"
        :class="['sr-only']"
        @change="importChosen"
      >
    </div>

    <Alert
      v-if="refusals.length > 0"
      tone="danger"
      live="assertive"
      dismissible
      :dismiss-label="t(`${prefix}.refused-dismiss`)"
      @dismiss="refusals = []"
    >
      <ul data-testid="stage-items-refusals" :class="['m-0 list-none p-0', 'flex flex-col gap-0.5']">
        <li v-for="refusal in refusals" :key="`${refusal.name}:${refusal.reason}`" :class="['break-words']">
          {{ t(`${prefix}.refused`, { name: refusal.name, reason: t(`${prefix}.refusals.${refusal.reason}`) }) }}
        </li>
      </ul>
    </Alert>

    <Alert
      v-if="importFailed"
      tone="danger"
      live="assertive"
      dismissible
      :dismiss-label="t(`${prefix}.refused-dismiss`)"
      @dismiss="importFailed = false"
    >
      {{ t(`${prefix}.import-failed`) }}
    </Alert>

    <Alert v-if="error" tone="danger">
      {{ t(`${prefix}.library-error`) }}
    </Alert>

    <Alert
      v-if="removing"
      tone="warning"
      live="polite"
      actions-placement="end"
    >
      {{ removing.models > 0
        ? t(`${prefix}.remove-confirm`, { name: removing.asset.name, count: removing.models })
        : t(`${prefix}.remove-confirm-unused`, { name: removing.asset.name }) }}
      <template #actions>
        <Button size="sm" variant="primary" color="red" @click="confirmRemove">
          {{ t(`${prefix}.confirm`) }}
        </Button>
        <Button size="sm" @click="removing = null">
          {{ t(`${prefix}.cancel`) }}
        </Button>
      </template>
    </Alert>

    <div v-if="!loaded" :class="['flex flex-col gap-2']" aria-hidden="true">
      <div v-for="row in 2" :key="row" :class="['flex items-center gap-3 p-2']">
        <Skeleton :class="['size-12 shrink-0 rounded-lg']" />
        <div :class="['flex flex-1 flex-col gap-1.5']">
          <Skeleton :class="['h-3.5 w-40']" />
          <Skeleton :class="['h-3 w-24']" />
        </div>
      </div>
    </div>

    <p
      v-else-if="assets.length === 0 && !error"
      :class="['rounded-lg p-2', 'bg-neutral-50 dark:bg-neutral-900', 'text-xs text-neutral-500 dark:text-neutral-400']"
    >
      {{ t(`${prefix}.library-empty`) }}
    </p>

    <ul v-else role="list" :class="['m-0 list-none p-0', 'flex flex-col gap-2']">
      <li
        v-for="asset in assets"
        :key="asset.id"
        :class="[
          'min-w-0 p-2',
          'flex flex-wrap items-center gap-3',
          'rounded-lg bg-neutral-50 dark:bg-neutral-900',
        ]"
      >
        <img
          v-if="thumbnails[asset.id]"
          :src="thumbnails[asset.id]"
          :alt="asset.name"
          :class="['size-12 shrink-0 rounded-lg object-contain', 'bg-neutral-100 dark:bg-neutral-800']"
        >
        <div
          v-else
          aria-hidden="true"
          :class="[
            'size-12 shrink-0 rounded-lg',
            'flex items-center justify-center',
            'bg-neutral-100 dark:bg-neutral-800',
          ]"
        >
          <div :class="['i-solar:user-rounded-linear', 'text-xl text-neutral-500 dark:text-neutral-400']" />
        </div>
        <div :class="['min-w-0 flex flex-1 basis-40 flex-col']">
          <span :class="['break-words', 'text-sm text-neutral-700 dark:text-neutral-200']">{{ asset.name }}</span>
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ t(`${prefix}.formats.${asset.format}`) }} · {{ detail(asset) }}</span>
        </div>
        <div :class="['flex flex-wrap items-center gap-2']">
          <Button
            size="sm"
            variant="primary"
            color="primary"
            :disabled="addBlocker !== ''"
            :title="addBlocker || undefined"
            :aria-label="`${t(`${prefix}.add`)}: ${asset.name}`"
            @click="addToModel(asset)"
          >
            {{ t(`${prefix}.add`) }}
          </Button>
          <Button size="sm" :aria-label="t(`${prefix}.remove`, { name: asset.name })" @click="askRemove(asset)">
            {{ t(`${prefix}.remove-action`) }}
          </Button>
        </div>
      </li>
    </ul>

    <p v-if="loaded && assets.length > 0 && addBlocker" :class="['text-xs text-neutral-500 dark:text-neutral-400']" role="note">
      {{ addBlocker }}
    </p>
  </section>
</template>
