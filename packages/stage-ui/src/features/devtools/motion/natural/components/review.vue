<script setup lang="ts">
import type { NaturalReviewGains } from '@proj-airi/motion-driver-natural/review'
import type { NaturalReviewVariant } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/review'
import type { SelectTabOption } from '@proj-airi/ui'

import { neutralReviewGains } from '@proj-airi/motion-driver-natural/review'
import { useSettingsLive2d } from '@proj-airi/stage-ui-live2d/composables/live2d'
import { useNaturalMotionDiagnostics } from '@proj-airi/stage-ui-live2d/stores'
import { Button, FieldCheckbox, FieldRange, SelectTab } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { Section } from '../../../../../components/layouts'

const prefix = 'tamagotchi.settings.devtools.pages.live2d-natural-motion.review'
/** The layers a solo isolates. `shiftRate` is a pace, not a layer, so a solo leaves it alone. */
const soloLayers = ['shifts', 'drift', 'wobble', 'eyes', 'body', 'acts'] as const
type SoloLayer = typeof soloLayers[number]
const gainLayers = ['follow', 'shifts', 'shiftRate', 'drift', 'wobble', 'eyes', 'body'] as const satisfies readonly (keyof NaturalReviewGains)[]

const { t } = useI18n()
const diagnostics = useNaturalMotionDiagnostics()
const { reviewTuned, reviewVariant, reviewFlags } = storeToRefs(diagnostics)
const { live2dMotionDriver } = storeToRefs(useSettingsLive2d())
// The review reaches the Live2D Natural controller only.
const disabled = computed(() => live2dMotionDriver.value !== 'natural')

// A stage follows the motion only once it has received review settings, so the lab announces itself.
onMounted(() => diagnostics.applyReview())

const variant = computed({
  get: () => reviewVariant.value,
  set: (value: NaturalReviewVariant) => diagnostics.setReviewVariant(value),
})
const variantOptions = computed<SelectTabOption<NaturalReviewVariant>[]>(() =>
  (['current', 'tuned'] as const).map(value => ({ value, label: t(`${prefix}.variant.options.${value}`) })),
)

function tune(change: { gains?: Partial<NaturalReviewGains>, acts?: boolean, caption?: boolean }) {
  const tuned = reviewTuned.value
  diagnostics.setReviewTuned({
    gains: { ...tuned.gains, ...change.gains },
    acts: change.acts ?? tuned.acts,
    caption: change.caption ?? tuned.caption,
  })
}

const caption = computed({ get: () => reviewTuned.value.caption, set: (value: boolean) => tune({ caption: value }) })
const acts = computed({ get: () => reviewTuned.value.acts, set: (value: boolean) => tune({ acts: value }) })

/** Shows one layer alone: every other layer goes to 0 and the idle acts go off. */
function solo(layer: SoloLayer) {
  const only = (candidate: SoloLayer) => Number(candidate === layer)
  tune({
    gains: { shifts: only('shifts'), drift: only('drift'), wobble: only('wobble'), eyes: only('eyes'), body: only('body') },
    acts: layer === 'acts',
  })
}

function reset() {
  tune({ gains: neutralReviewGains, acts: true })
}

const flagRows = computed(() => reviewFlags.value.map(flag => ({
  id: flag.id,
  time: new Date(flag.flaggedAt).toLocaleTimeString(),
  variant: t(`${prefix}.variant.options.${flag.variant}`),
  caption: flag.caption.join(' | '),
})).reverse())
</script>

<template>
  <Section
    :title="t(`${prefix}.title`)"
    icon="i-solar:tuning-2-bold-duotone"
    inner-class="gap-4"
  >
    <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ disabled ? t(`${prefix}.requires-natural`) : t(`${prefix}.description`) }}
    </div>

    <fieldset data-testid="natural-review" :disabled="disabled" :class="['contents']">
      <div :class="['flex flex-col gap-2']">
        <div :class="['text-sm font-medium']">
          {{ t(`${prefix}.variant.title`) }}
        </div>
        <SelectTab
          v-model="variant"
          data-testid="natural-review-variant"
          size="sm"
          tab-space="compact"
          :options="variantOptions"
          :disabled="disabled"
        />
        <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${prefix}.variant.description`) }}
        </div>
      </div>

      <FieldCheckbox
        v-model="caption"
        data-testid="natural-review-caption"
        :label="t(`${prefix}.caption.title`)"
        :description="t(`${prefix}.caption.description`)"
        :disabled="disabled"
      />

      <div :class="['flex flex-col gap-2']">
        <div :class="['text-sm font-medium']">
          {{ t(`${prefix}.solo.title`) }}
        </div>
        <div :class="['flex flex-wrap gap-2']">
          <Button
            v-for="layer in soloLayers"
            :key="layer"
            :data-review-solo="layer"
            size="sm"
            variant="secondary"
            :disabled="disabled"
            :label="t(`${prefix}.layers.${layer}.title`)"
            @click="solo(layer)"
          />
          <Button
            data-testid="natural-review-reset"
            size="sm"
            variant="secondary"
            :disabled="disabled"
            :label="t(`${prefix}.solo.reset`)"
            @click="reset"
          />
        </div>
      </div>

      <FieldCheckbox
        v-model="acts"
        data-testid="natural-review-acts"
        :label="t(`${prefix}.layers.acts.title`)"
        :description="t(`${prefix}.layers.acts.description`)"
        :disabled="disabled"
      />
      <FieldRange
        v-for="layer in gainLayers"
        :key="layer"
        as="div"
        :data-review-gain="layer"
        :model-value="reviewTuned.gains[layer]"
        :min="layer === 'shiftRate' ? 0.1 : 0"
        :max="layer === 'follow' ? 1 : 2"
        :step="0.05"
        :default-value="neutralReviewGains[layer]"
        :format-value="value => `${Math.round(value * 100)}%`"
        :label="t(`${prefix}.layers.${layer}.title`)"
        :description="t(`${prefix}.layers.${layer}.description`)"
        @update:model-value="value => tune({ gains: { [layer]: value } })"
      />

      <div :class="['flex flex-col gap-2']">
        <div :class="['text-sm font-medium']">
          {{ t(`${prefix}.flags.title`) }}
        </div>
        <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t(`${prefix}.flags.description`) }}
        </div>
        <div :class="['flex flex-wrap gap-2']">
          <Button
            data-testid="natural-review-flag"
            size="sm"
            :disabled="disabled"
            :label="t(`${prefix}.flags.flag`)"
            @click="diagnostics.requestReviewFlag()"
          />
          <Button
            data-testid="natural-review-save"
            size="sm"
            variant="secondary"
            :disabled="flagRows.length === 0"
            :label="t(`${prefix}.flags.save`)"
            @click="diagnostics.saveReviewFlags()"
          />
          <Button
            data-testid="natural-review-clear"
            size="sm"
            variant="secondary"
            :disabled="flagRows.length === 0"
            :label="t(`${prefix}.flags.clear`)"
            @click="diagnostics.clearReviewFlags()"
          />
        </div>
        <ul v-if="flagRows.length" data-testid="natural-review-flags" :class="['flex flex-col gap-1 text-xs font-mono']">
          <li v-for="row in flagRows" :key="row.id" :class="['flex flex-wrap gap-x-3']">
            <span>{{ row.time }}</span>
            <span :class="['text-neutral-500 dark:text-neutral-400']">{{ row.variant }}</span>
            <span>{{ row.caption }}</span>
          </li>
        </ul>
      </div>
    </fieldset>
  </Section>
</template>
