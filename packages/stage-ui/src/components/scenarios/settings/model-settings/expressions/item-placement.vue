<script setup lang="ts">
import type { ItemExpressionDocument, StageItemLayer, StageItemPlacement } from '@proj-airi/stage-shared/expression-performance'
import type { Live2DItemEditor } from '@proj-airi/stage-ui-live2d/composables/live2d/items/editor'
import type { SelectOptionGroupItem, SelectOptionItem } from '@proj-airi/ui'

import type { StageItemAsset } from '../../../../../database/repos/stage-items.repo'
import type { PlacementField, PlanePoint } from './item-placement'
import type { ExpressionPanelItem, ExpressionPanelItemCommand, ItemPatch } from './source'

import { canvasAlignedPlacement } from '@proj-airi/stage-ui-live2d/composables/live2d/items/pose'
import { Alert, Button, Checkbox, Collapsible, Input, Select } from '@proj-airi/ui'
import { useRafFn } from '@vueuse/core'
import { computed, onBeforeUnmount, reactive, ref, shallowRef, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  createFramePatchQueue,
  degreesOf,
  itemFrame,
  pinnedPlacement,
  placementFieldPatch,
  rotationFromHandle,
  scaleFromHandle,
  unpinnedPlacement,
  withFieldPatch,
} from './item-placement'

const props = defineProps<{
  item: ExpressionPanelItem
  /** The item's library file, for its size and format; `undefined` while the library has not listed it. */
  asset?: StageItemAsset
  /** Reads the preview's view of her model each frame; `undefined` until the preview has loaded her. */
  editorSource: () => Live2DItemEditor | undefined
  /** False while no stage runtime can take the edits; the controls are then disabled. */
  enabled: boolean
  /** Set when the preview could not add this item within the shown caps. */
  refusal: 'item-limit' | null
}>()
const emit = defineEmits<{
  (e: 'command', command: ExpressionPanelItemCommand): void
  /** The document as edited so far, for the preview to draw. */
  (e: 'draft', document: ItemExpressionDocument): void
  (e: 'close'): void
}>()

const { t } = useI18n()
const s = (key: string, values: Record<string, unknown> = {}) => t(`settings.live2d.expressions.items.placement.${key}`, values)

// The snapshot's document is reactive, which `structuredClone` refuses; the raw object clones.
const draft = ref<ItemExpressionDocument>(structuredClone(toRaw(props.item.document)))
/** The preview's editor, refreshed from `editorSource` when her model appears, goes, or changes. */
const editor = shallowRef<Live2DItemEditor>()
// A patch built from the reactive draft carries proxies, which the settings runtime channel cannot clone; it leaves as plain JSON.
const queue = createFramePatchQueue((id, patch) => emit('command', { type: 'update-item', id, patch: JSON.parse(JSON.stringify(patch)) }))
// A new item gets a fresh draft; whatever the old item still had pending is sent to it, never to the new one.
watch(() => props.item.document.id, () => {
  queue.flush()
  draft.value = structuredClone(toRaw(props.item.document))
})
watch(draft, document => emit('draft', document), { immediate: true, deep: true })
onBeforeUnmount(() => queue.flush())

function update(patch: ItemPatch) {
  if (!props.enabled)
    return
  if (patch.placement)
    draft.value.placement = patch.placement
  if (patch.hides)
    draft.value.hides = patch.hides
  if (patch.link)
    draft.value.link = patch.link
  queue.push(draft.value.id, patch)
}

function setPlacement(placement: StageItemPlacement) {
  update({ placement })
}

const isLive2D = computed(() => props.asset?.format === 'live2d-zip')
const size = computed(() => {
  const asset = props.asset
  if (!asset)
    return undefined
  return asset.format === 'live2d-zip' && asset.canvas ? asset.canvas : { width: asset.width, height: asset.height }
})

// --- Fields

const fieldText = reactive<Record<PlacementField, string>>({ x: '', y: '', scale: '', rotationDegrees: '', anchorX: '', anchorY: '' })
const editingField = ref<PlacementField | null>(null)

// A field shows the draft until the user types in it, so typing is never reformatted under the cursor.
watch(() => draft.value.placement, (placement) => {
  const texts = fieldTexts(placement)
  for (const field of Object.keys(texts) as PlacementField[]) {
    if (field !== editingField.value)
      fieldText[field] = texts[field]
  }
}, { immediate: true, deep: true })

function fieldTexts(placement: StageItemPlacement): Record<PlacementField, string> {
  return {
    x: placement.x.toFixed(1),
    y: placement.y.toFixed(1),
    scale: placement.scale.toFixed(3),
    rotationDegrees: degreesOf(placement.rotation).toFixed(1),
    anchorX: placement.anchor.x.toFixed(2),
    anchorY: placement.anchor.y.toFixed(2),
  }
}

/** Sends a changed, usable value; an unusable one reads back as the kept value. */
function commitField(field: PlacementField) {
  editingField.value = null
  const patch = placementFieldPatch(field, fieldText[field])
  const next = patch ? withFieldPatch(draft.value.placement, patch) : draft.value.placement
  if (JSON.stringify(next) !== JSON.stringify(draft.value.placement))
    setPlacement(next)
  else
    fieldText[field] = fieldTexts(draft.value.placement)[field]
}

// --- Layer

type LayerKind = StageItemLayer['kind']
const layerOptions = computed<SelectOptionItem<LayerKind>[]>(() => (['behind', 'front', 'above'] as const).map(kind => ({ value: kind, label: s(`layer.${kind}`) })))
const drawableOptions = computed<SelectOptionGroupItem<string>[]>(() => {
  const view = editor.value
  if (!view)
    return []
  const names = new Map(view.parts.map(part => [part.id, part.name]))
  const groups = new Map<string | null, SelectOptionItem<string>[]>()
  for (const drawable of view.drawables) {
    const group = groups.get(drawable.partId) ?? []
    group.push({ value: drawable.id, label: drawable.id })
    groups.set(drawable.partId, group)
  }
  return [...groups].map(([partId, children]) => ({ groupLabel: partId === null ? s('layer.other-part') : names.get(partId) ?? partId, children }))
})
const layerKind = computed(() => draft.value.placement.layer.kind)
const layerDrawable = computed(() => {
  const layer = draft.value.placement.layer
  return layer.kind === 'above' ? layer.drawableId : ''
})

function setLayerKind(kind: LayerKind) {
  const layer: StageItemLayer = kind === 'above'
    ? { kind, drawableId: layerDrawable.value || editor.value?.drawables[0]?.id || '' }
    : { kind }
  setPlacement({ ...draft.value.placement, layer })
}

function setLayerDrawable(drawableId: string) {
  setPlacement({ ...draft.value.placement, layer: { kind: 'above', drawableId } })
}

// --- Pointer work on the preview

type Mode = 'idle' | 'move' | 'scale' | 'rotate' | 'pin' | 'pick-layer'
const mode = ref<Mode>('idle')
const noMesh = ref(false)
const overlay = ref<HTMLElement>()
/** The item's corners and center in view pixels this frame, or empty while nothing can be measured. */
const frameView = shallowRef<PlanePoint[]>([])
const centerView = computed<PlanePoint | undefined>(() => {
  const corners = frameView.value
  if (corners.length !== 4)
    return undefined
  return { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 }
})
/** The rotation handle sits above the top edge, along the item's up direction. */
const rotateHandleView = computed<PlanePoint | undefined>(() => {
  const corners = frameView.value
  if (corners.length !== 4)
    return undefined
  const mid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }
  const center = centerView.value!
  const length = Math.hypot(mid.x - center.x, mid.y - center.y) || 1
  return { x: mid.x + (mid.x - center.x) / length * 24, y: mid.y + (mid.y - center.y) / length * 24 }
})
const polygonPoints = computed(() => frameView.value.map(point => `${point.x},${point.y}`).join(' '))
/** While a click is being picked, the frame and handles let the pointer through to the preview underneath. */
const picking = computed(() => mode.value === 'pin' || mode.value === 'pick-layer')
const handleHit = computed(() => picking.value ? 'pointer-events-none' : 'pointer-events-auto')

function currentPose() {
  const placement = draft.value.placement
  return editor.value?.poseOf(draft.value.id) ?? { x: placement.x, y: placement.y, rotation: placement.rotation, scale: placement.scale }
}

// The scene hands out one editor per loaded model, so a new object means her model loaded again, even the same model.
function refreshEditor() {
  editor.value = props.editorSource()
}

useRafFn(() => {
  refreshEditor()
  const view = editor.value
  const itemSize = size.value
  if (!view || !itemSize) {
    if (frameView.value.length)
      frameView.value = []
    return
  }
  const placement = draft.value.placement
  frameView.value = itemFrame(currentPose(), itemSize, placement.anchor, placement.flipX).map(point => view.canvasToView(point))
})

function viewPoint(event: PointerEvent): PlanePoint {
  const rect = overlay.value?.getBoundingClientRect()
  return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: event.clientX, y: event.clientY }
}

let dragStart: { pointer: PlanePoint, placement: StageItemPlacement, center: PlanePoint } | undefined

function startDrag(kind: 'move' | 'scale' | 'rotate', event: PointerEvent) {
  const view = editor.value
  if (!view || !props.enabled || mode.value !== 'idle')
    return
  event.preventDefault()
  const pose = currentPose()
  dragStart = { pointer: view.viewToCanvas(viewPoint(event)), placement: draft.value.placement, center: { x: pose.x, y: pose.y } }
  mode.value = kind
  overlay.value?.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  const view = editor.value
  if (!view || !dragStart)
    return
  const pointer = view.viewToCanvas(viewPoint(event))
  const start = dragStart
  if (mode.value === 'move') {
    if (start.placement.pin) {
      // A pinned item drags along her mesh: it re-pins under the pointer and stays put over empty canvas.
      const pin = view.pickPin(pointer)
      if (pin)
        setPlacement(pinnedPlacement(draft.value.placement, { ...pin, vertices: [...pin.vertices], weights: [...pin.weights], reference: [...pin.reference] }))
    }
    else {
      setPlacement({ ...draft.value.placement, x: start.placement.x + pointer.x - start.pointer.x, y: start.placement.y + pointer.y - start.pointer.y })
    }
  }
  else if (mode.value === 'scale') {
    setPlacement({ ...draft.value.placement, scale: scaleFromHandle(start.placement.scale, start.center, start.pointer, pointer) })
  }
  else if (mode.value === 'rotate') {
    setPlacement({ ...draft.value.placement, rotation: rotationFromHandle(start.placement.rotation, start.center, start.pointer, pointer) })
  }
}

function endDrag(event: PointerEvent) {
  if (!dragStart)
    return
  dragStart = undefined
  mode.value = 'idle'
  if (overlay.value?.hasPointerCapture(event.pointerId))
    overlay.value.releasePointerCapture(event.pointerId)
  queue.flush()
}

function onOverlayClick(event: PointerEvent) {
  const view = editor.value
  if (!view || (mode.value !== 'pin' && mode.value !== 'pick-layer'))
    return
  const pin = view.pickPin(view.viewToCanvas(viewPoint(event)))
  noMesh.value = !pin
  if (pin) {
    if (mode.value === 'pin')
      setPlacement(pinnedPlacement(draft.value.placement, { ...pin, vertices: [...pin.vertices], weights: [...pin.weights], reference: [...pin.reference] }))
    else
      setLayerDrawable(pin.drawableId)
    queue.flush()
  }
  mode.value = 'idle'
}

function startPicking(kind: 'pin' | 'pick-layer') {
  noMesh.value = false
  mode.value = mode.value === kind ? 'idle' : kind
}

function unpin() {
  setPlacement(unpinnedPlacement(draft.value.placement, editor.value?.poseOf(draft.value.id)))
  queue.flush()
}

function setFlip(flipX: boolean) {
  setPlacement({ ...draft.value.placement, flipX })
}

// --- Hide list and link

const hidesOpen = ref(false)
function setHidden(partId: string, hidden: boolean) {
  const hides = draft.value.hides.filter(id => id !== partId)
  update({ hides: hidden ? [...hides, partId] : hides })
}

function setLinked(linked: boolean) {
  update({ link: linked ? 'parameters' : 'none' })
}

function alignToCanvas() {
  const view = editor.value
  const itemSize = size.value
  if (!view || !itemSize)
    return
  const { pin: _pin, ...rest } = draft.value.placement
  setPlacement({ ...rest, ...canvasAlignedPlacement({ originalWidth: view.canvas.width, originalHeight: view.canvas.height }, { originalWidth: itemSize.width }) })
  queue.flush()
}

const fields: { field: PlacementField, label: string }[] = [
  { field: 'x', label: 'x' },
  { field: 'y', label: 'y' },
  { field: 'scale', label: 'scale' },
  { field: 'rotationDegrees', label: 'rotation' },
  { field: 'anchorX', label: 'anchor-x' },
  { field: 'anchorY', label: 'anchor-y' },
]
const pickingMessage = computed(() => {
  if (mode.value === 'pin')
    return s('pin.picking')
  if (mode.value === 'pick-layer')
    return s('layer.picking')
  return ''
})
</script>

<template>
  <section
    data-testid="item-placement"
    :class="[
      'flex flex-col gap-3 p-3',
      'rounded-lg',
      'bg-neutral-50 dark:bg-neutral-900/60',
    ]"
    :aria-label="s('title', { label: item.document.label })"
  >
    <div :class="['flex flex-wrap items-center gap-2']">
      <h3 :class="['min-w-0 flex-1 truncate', 'text-sm font-medium text-neutral-700 dark:text-neutral-300']">
        {{ s('title', { label: item.document.label }) }}
      </h3>
      <Button size="sm" @click="emit('close')">
        {{ s('done') }}
      </Button>
    </div>

    <Alert v-if="!enabled" tone="warning" live="polite">
      {{ s('no-runtime') }}
    </Alert>
    <Alert v-else-if="refusal" tone="warning" live="polite" data-testid="placement-refusal">
      {{ s('refused-limit') }}
    </Alert>

    <!-- The preview fills this box; the overlay above it carries the handles and takes the pointer. -->
    <div
      ref="overlay"
      data-testid="placement-preview"
      :class="[
        'relative aspect-[3/4] max-h-[60dvh] w-full overflow-hidden',
        'rounded-lg bg-neutral-100 dark:bg-neutral-950',
        picking ? 'cursor-crosshair' : '',
        'touch-none select-none',
      ]"
      @pointermove="onPointerMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @pointerdown="onOverlayClick"
    >
      <div :class="['absolute inset-0']">
        <slot />
      </div>
      <svg
        v-if="editor && frameView.length === 4 && enabled"
        :class="['pointer-events-none absolute inset-0 h-full w-full overflow-visible']"
        aria-hidden="true"
      >
        <polygon
          :points="polygonPoints"
          :class="[handleHit, 'fill-primary-500/10 stroke-primary-500', mode === 'idle' ? 'cursor-move' : '']"
          stroke-width="1.5"
          @pointerdown.stop="startDrag('move', $event)"
        />
        <line
          v-if="rotateHandleView && centerView"
          :x1="(frameView[0].x + frameView[1].x) / 2"
          :y1="(frameView[0].y + frameView[1].y) / 2"
          :x2="rotateHandleView.x"
          :y2="rotateHandleView.y"
          :class="['stroke-primary-500']"
          stroke-width="1"
        />
        <circle
          v-for="(corner, index) in frameView"
          :key="index"
          :cx="corner.x"
          :cy="corner.y"
          r="6"
          :class="[handleHit, 'cursor-nwse-resize fill-white stroke-primary-500 dark:fill-neutral-900']"
          stroke-width="1.5"
          @pointerdown.stop="startDrag('scale', $event)"
        />
        <circle
          v-if="rotateHandleView"
          :cx="rotateHandleView.x"
          :cy="rotateHandleView.y"
          r="6"
          :class="[handleHit, 'cursor-grab fill-primary-500 stroke-white dark:stroke-neutral-900']"
          stroke-width="1.5"
          @pointerdown.stop="startDrag('rotate', $event)"
        />
      </svg>
      <!-- Pointer events for the handles are reachable only through the polygon and circles above; these screen-reader-only labels name them, and the typed fields below are the keyboard path. -->
      <div :class="['sr-only']">
        <span>{{ s('move', { label: item.document.label }) }}</span>
        <span>{{ s('scale-handle', { label: item.document.label }) }}</span>
        <span>{{ s('rotate-handle', { label: item.document.label }) }}</span>
      </div>
      <p
        v-if="pickingMessage"
        role="status"
        :class="[
          'absolute bottom-2 left-2 right-2 px-2 py-1',
          'rounded-md bg-white/90 dark:bg-black/70',
          'text-xs text-neutral-700 dark:text-neutral-300',
        ]"
      >
        {{ pickingMessage }}
      </p>
    </div>
    <p v-if="!editor && enabled" role="status" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ s('loading') }}
    </p>
    <p v-else :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ s('hint') }}
    </p>

    <!-- Position, size, and anchor as numbers, in her canvas units; typed values are clamped and wrap before they are sent. -->
    <div :class="['grid grid-cols-2 gap-2 sm:grid-cols-3']">
      <label
        v-for="{ field, label } in fields"
        :key="field"
        :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']"
      >
        {{ s(`fields.${label}`) }}
        <Input
          v-model="fieldText[field]"
          type="text"
          inputmode="decimal"
          size="sm"
          :disabled="!enabled"
          :aria-label="s(`fields.${label}`)"
          @focus="editingField = field"
          @blur="commitField(field)"
          @keydown.enter.prevent="commitField(field)"
        />
      </label>
    </div>
    <label :class="['flex items-center justify-between gap-2', 'text-sm text-neutral-700 dark:text-neutral-300']">
      {{ s('fields.flip') }}
      <Checkbox :model-value="draft.placement.flipX" :disabled="!enabled" :aria-label="s('fields.flip')" @update:model-value="setFlip" />
    </label>

    <!-- Where she draws it: before her, after her, or right above one of her layers, grouped by part. -->
    <div :class="['grid grid-cols-1 gap-2 sm:grid-cols-2']">
      <label :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
        <span>{{ s('layer.title') }}</span>
        <Select :model-value="layerKind" :options="layerOptions" :disabled="!enabled" @update:model-value="setLayerKind($event as LayerKind)" />
      </label>
      <label v-if="layerKind === 'above'" :class="['flex flex-col gap-1', 'text-xs text-neutral-500 dark:text-neutral-400']">
        <span>{{ s('layer.drawable') }}</span>
        <div :class="['flex items-center gap-2']">
          <Select :model-value="layerDrawable" :options="drawableOptions" :disabled="!enabled || !editor" :class="['min-w-0 flex-1']" @update:model-value="setLayerDrawable($event as string)" />
          <Button size="sm" :disabled="!enabled || !editor" :aria-pressed="mode === 'pick-layer'" @click="startPicking('pick-layer')">
            {{ s('layer.pick') }}
          </Button>
        </div>
      </label>
    </div>

    <!-- A pin makes the item follow one spot of her mesh. -->
    <div :class="['flex flex-wrap items-center gap-2', 'text-xs text-neutral-500 dark:text-neutral-400']">
      <span :class="['min-w-0 flex-1']" data-testid="placement-pin-state">
        {{ draft.placement.pin ? s('pin.pinned', { drawable: draft.placement.pin.drawableId }) : s('pin.unpinned') }}
      </span>
      <Button v-if="draft.placement.pin" size="sm" :disabled="!enabled" @click="unpin">
        {{ s('pin.unpin') }}
      </Button>
      <Button size="sm" :disabled="!enabled || !editor" :aria-pressed="mode === 'pin'" @click="startPicking('pin')">
        {{ mode === 'pin' ? s('pin.cancel') : s('pin.click') }}
      </Button>
    </div>
    <Alert v-if="noMesh" tone="warning" live="polite" data-testid="placement-no-mesh">
      {{ s('pin.no-mesh') }}
    </Alert>

    <!-- Live2D items can wear her motion and lay their canvas over hers. -->
    <template v-if="isLive2D">
      <label :class="['flex items-center justify-between gap-2', 'text-sm text-neutral-700 dark:text-neutral-300']">
        <span :class="['min-w-0 flex flex-1 flex-col gap-0.5']">
          {{ s('link.title') }}
          <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ s('link.description') }}</span>
        </span>
        <Checkbox :model-value="draft.link === 'parameters'" :disabled="!enabled" :aria-label="s('link.title')" @update:model-value="setLinked" />
      </label>
      <Button size="sm" :disabled="!enabled || !editor || !size" :class="['w-fit']" @click="alignToCanvas">
        {{ s('link.align') }}
      </Button>
    </template>

    <!-- Her parts this item hides, as her part tree. -->
    <Collapsible v-model="hidesOpen" :label="s('hides.title')">
      <p :class="['mb-2', 'text-xs text-neutral-500 dark:text-neutral-400']">
        {{ s('hides.description') }}
      </p>
      <ul v-if="editor" data-testid="placement-hides" :class="['flex flex-col gap-1']">
        <li
          v-for="part in editor.parts"
          :key="part.id"
          :style="{ paddingLeft: `${part.depth * 0.75}rem` }"
        >
          <label :class="['flex items-center gap-2', 'text-xs text-neutral-700 dark:text-neutral-300']">
            <Checkbox
              :model-value="draft.hides.includes(part.id)"
              :disabled="!enabled"
              :aria-label="part.name"
              @update:model-value="setHidden(part.id, $event)"
            />
            <span :class="['truncate']">{{ part.name }}</span>
          </label>
        </li>
      </ul>
      <p v-else :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ s('loading') }}
      </p>
    </Collapsible>
  </section>
</template>
