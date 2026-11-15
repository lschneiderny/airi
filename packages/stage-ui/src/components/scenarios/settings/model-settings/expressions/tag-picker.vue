<script setup lang="ts" generic="T extends string">
import { Button } from '@proj-airi/ui'

/** A row of toggle buttons for choosing any number of tags from a fixed list, such as occasions or moments. */
const props = defineProps<{
  options: readonly { value: T, label: string }[]
  disabled?: boolean
}>()
const model = defineModel<T[]>({ required: true })

function toggle(value: T) {
  // Kept in the order of the options, so the same choice always gives the same value.
  model.value = props.options
    .map(option => option.value)
    .filter(candidate => candidate === value ? !model.value.includes(candidate) : model.value.includes(candidate))
}
</script>

<template>
  <div :class="['flex flex-wrap gap-1.5']">
    <Button
      v-for="option in options"
      :key="option.value"
      size="sm"
      :variant="model.includes(option.value) ? 'primary' : 'secondary'"
      :aria-pressed="model.includes(option.value)"
      :disabled="disabled"
      :label="option.label"
      @click="toggle(option.value)"
    />
  </div>
</template>
