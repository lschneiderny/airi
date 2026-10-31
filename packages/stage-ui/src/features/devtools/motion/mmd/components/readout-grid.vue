<script setup lang="ts">
defineProps<{
  rows: { id: string, label: string, value: string }[]
  empty: string
}>()
</script>

<template>
  <dl v-if="rows.length" :class="['grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs']">
    <template v-for="row in rows" :key="row.id">
      <dt :class="['text-neutral-500 dark:text-neutral-400']">
        {{ row.label }}
      </dt>
      <dd :data-testid="`readout-${row.id}`" :class="['font-mono tabular-nums']">
        {{ row.value }}
      </dd>
    </template>
  </dl>
  <div v-else :class="['text-xs text-neutral-500 dark:text-neutral-400']">
    {{ empty }}
  </div>
</template>
