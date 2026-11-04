<script setup lang="ts">
import type { MMDMotionSnapshot } from '@proj-airi/stage-ui-mmd/stores'

import { useMMDMotionDiagnostics } from '@proj-airi/stage-ui-mmd/stores'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ReadoutGrid from './readout-grid.vue'

import { Section } from '../../../../../components/layouts'

const prefix = 'tamagotchi.settings.devtools.pages.mmd-motion.clips'
// Kind, layer, badge and note names are shared with the clip curation table in the MMD model settings.
const clipsPrefix = 'settings.mmd.animation.clips'

const { t } = useI18n()
const diagnostics = useMMDMotionDiagnostics()
const { snapshot } = storeToRefs(diagnostics)

type Clip = MMDMotionSnapshot['clips'][number]

function playTitle(clip: Clip): string | undefined {
  if (clip.kind !== 'unusable')
    return undefined
  return clip.notes.length
    ? clip.notes.map(note => t(`${clipsPrefix}.notes.${note}`)).join(', ')
    : t(`${prefix}.unusable`)
}

function play(clip: Clip) {
  if (clip.kind !== 'unusable')
    diagnostics.command({ type: 'command', name: 'playClip', value: { name: clip.name } })
}

function stop() {
  diagnostics.command({ type: 'command', name: 'stopClip' })
}

const actionRows = computed(() => {
  const { action, animation } = snapshot.value
  const performing = action.performing
  const refusal = action.refusal
  const layer = animation.layer
  const { unknown, notExposed, notGesture, superseded } = action.drops
  return [
    { id: 'performing', value: performing ? `${performing.name} (${performing.layer}, ${performing.phase}, #${performing.seq})` : '-' },
    { id: 'last-seq', value: String(action.lastActionSeq) },
    { id: 'refusal', value: refusal ? (action.retryAfterMs === null ? refusal : `${refusal} (${(action.retryAfterMs / 1000).toFixed(1)} s)`) : '-' },
    { id: 'drops', value: `${unknown} / ${notExposed} / ${notGesture} / ${superseded}` },
    { id: 'layer', value: layer ? `${layer.name} (${layer.state}, #${layer.seq})` : '-' },
  ].map(row => ({ ...row, label: t(`${prefix}.action.rows.${row.id}`) }))
})

// The body records left and right groups apart; the bar row folds each pair into its larger share.
const ownershipBars = computed(() => {
  const owned = snapshot.value.ownership
  if (!owned)
    return []
  return [
    { id: 'root', value: owned.root },
    { id: 'legs', value: Math.max(owned.leftLegIk, owned.rightLegIk) },
    { id: 'lowerBody', value: owned.lowerBody },
    { id: 'arms', value: Math.max(owned.leftArm, owned.rightArm) },
    { id: 'fingers', value: Math.max(owned.leftFingers, owned.rightFingers) },
    { id: 'upperBody', value: owned.upperBody },
    { id: 'head', value: owned.head },
  ]
})
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:play-stream-bold-duotone"
    inner-class="gap-4"
  >
    <div data-testid="mmd-clips">
      <div v-if="snapshot.clips.length" :class="['overflow-x-auto', 'rounded-lg', 'border-2', 'border-neutral-100', 'dark:border-neutral-800']">
        <table :class="['w-full', 'text-left', 'text-xs']">
          <thead :class="['bg-neutral-100/80', 'dark:bg-neutral-800/80', 'text-neutral-500', 'dark:text-neutral-400']">
            <tr>
              <th
                v-for="header in ['name', 'kind', 'layer', 'loop', 'label', 'exposed', 'actions']"
                :key="header"
                scope="col"
                :class="['px-1.5', 'py-1.5', 'font-medium', 'whitespace-nowrap']"
              >
                {{ t(`${prefix}.headers.${header}`) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="clip in snapshot.clips"
              :key="clip.name"
              :data-testid="`mmd-clip-${clip.name}`"
              :class="['border-t-2', 'border-neutral-100', 'dark:border-neutral-800', 'align-middle']"
            >
              <td :class="['max-w-32', 'truncate', 'px-1.5', 'py-1.5', 'font-mono']" :title="clip.name">
                {{ clip.name }}
              </td>
              <td :class="['px-1.5', 'py-1.5']">
                <span :class="['whitespace-nowrap']">{{ t(`${clipsPrefix}.kinds.${clip.kind}`) }}</span>
                <span
                  v-if="clip.downgraded"
                  :title="t(`${clipsPrefix}.badges.downgraded-hint`)"
                  :class="['ml-1', 'rounded-full px-2 py-0.5', 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300']"
                >
                  {{ t(`${clipsPrefix}.badges.downgraded`) }}
                </span>
              </td>
              <td :class="['px-1.5', 'py-1.5', 'whitespace-nowrap']">
                {{ clip.layer === 'none' ? '-' : t(`${clipsPrefix}.layers.${clip.layer}`) }}
              </td>
              <td :class="['px-1.5', 'py-1.5']">
                {{ t(`${prefix}.${clip.loop ? 'yes' : 'no'}`) }}
              </td>
              <td :class="['px-1.5', 'py-1.5', 'font-mono']">
                {{ clip.label ?? '-' }}
              </td>
              <td :class="['px-1.5', 'py-1.5']">
                {{ t(`${prefix}.${clip.exposed ? 'yes' : 'no'}`) }}
              </td>
              <td :class="['px-1.5', 'py-1.5']">
                <div :class="['flex', 'gap-2']">
                  <Button
                    :data-testid="`mmd-clip-play-${clip.name}`"
                    size="sm"
                    variant="secondary"
                    icon="i-solar:play-bold"
                    :label="t(`${prefix}.play`)"
                    :title="playTitle(clip)"
                    :disabled="clip.kind === 'unusable'"
                    @click="play(clip)"
                  />
                  <Button
                    :data-testid="`mmd-clip-stop-${clip.name}`"
                    size="sm"
                    variant="secondary"
                    icon="i-solar:stop-bold"
                    :label="t(`${prefix}.stop`)"
                    :disabled="snapshot.action.performing?.name !== clip.name"
                    @click="stop"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t(`${prefix}.empty`) }}
      </div>
    </div>
    <ReadoutGrid data-testid="mmd-action" :rows="actionRows" :empty="t(`${prefix}.empty`)" />
    <div v-if="ownershipBars.length" data-testid="mmd-ownership" :class="['grid gap-1']">
      <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t(`${prefix}.ownership.title`) }}
      </div>
      <div :class="['grid grid-cols-7 gap-2']">
        <div v-for="bar in ownershipBars" :key="bar.id" :data-testid="`ownership-${bar.id}`" :class="['grid gap-1 text-xs']">
          <div :class="['h-12 flex flex-col justify-end overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800']">
            <div :class="['bg-primary-400 dark:bg-primary-500']" :style="{ height: `${bar.value * 100}%` }" />
          </div>
          <div :class="['truncate text-neutral-500 dark:text-neutral-400']">
            {{ t(`${prefix}.ownership.groups.${bar.id}`) }}
          </div>
          <div :class="['font-mono tabular-nums']">
            {{ bar.value.toFixed(2) }}
          </div>
        </div>
      </div>
    </div>
  </Section>
</template>
