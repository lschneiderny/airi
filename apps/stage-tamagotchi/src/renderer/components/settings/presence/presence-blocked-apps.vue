<script setup lang="ts">
import type { InstalledApp } from '../../../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useSituationSettings } from '@proj-airi/stage-ui/features/situation/settings'
import { Alert, Button, ComboboxSelect, IconButton, Input, Skeleton } from '@proj-airi/ui'
import { computed, onMounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { presenceInstalledAppsList } from '../../../../shared/eventa'
import { addableApps, blockedAppRows, withEntry } from './blocked-apps'

const { t } = useI18n()
const tt = (key: string, named?: Record<string, unknown>) => t(`tamagotchi.settings.pages.presence.blocked-apps.${key}`, named ?? {})
const settings = useSituationSettings()
const listInstalledApps = useElectronEventaInvoke(presenceInstalledAppsList)

const installed = shallowRef<InstalledApp[] | null>(null)
const loadFailed = shallowRef(false)
const picked = shallowRef<string>()
const pattern = shallowRef('')

const entries = computed(() => settings.document.blockedApps)
const rows = computed(() => blockedAppRows(entries.value, installed.value ?? []))
const options = computed(() => addableApps(installed.value ?? [], entries.value).map(app => ({ label: app.name, value: app.appKey, description: app.appKey })))

onMounted(async () => {
  try {
    installed.value = await listInstalledApps()
  }
  catch {
    loadFailed.value = true
    installed.value = []
  }
})

async function add(entry: string) {
  const next = withEntry(entries.value, entry)
  if (next)
    await settings.update({ blockedApps: next })
}

async function pick(value: string | number | undefined) {
  if (typeof value === 'string')
    await add(value)
  // The picker is an action, not a selection: clear it for the next app.
  picked.value = undefined
}

async function addPattern() {
  await add(pattern.value)
  pattern.value = ''
}

async function remove(entry: string) {
  await settings.update({ blockedApps: entries.value.filter(existing => existing !== entry) })
}
</script>

<template>
  <section :class="['flex flex-col gap-3']">
    <div>
      <div :class="['text-sm font-medium']">
        {{ t('settings.pages.presence.blocked-apps.title') }}
      </div>
      <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tt('description') }}
      </div>
    </div>

    <ul v-if="rows.length > 0" :class="['flex flex-col gap-1']">
      <li
        v-for="row in rows"
        :key="row.entry"
        data-testid="blocked-app-row"
        :class="['flex items-center justify-between gap-3', 'rounded-lg bg-neutral-100/70 px-3 py-2 dark:bg-neutral-800/70']"
      >
        <div :class="['min-w-0 flex flex-col']">
          <span v-if="row.name" :class="['truncate text-sm']">{{ row.name }}</span>
          <span :class="row.name ? ['truncate font-mono text-xs text-neutral-500 dark:text-neutral-400'] : ['truncate font-mono text-sm']">{{ row.entry }}</span>
        </div>
        <IconButton
          icon="i-solar:close-circle-bold-duotone"
          :aria-label="tt('remove', { app: row.name ?? row.entry })"
          :class="['shrink-0 text-lg text-neutral-500 dark:text-neutral-400']"
          @click="remove(row.entry)"
        />
      </li>
    </ul>
    <div v-else :class="['rounded-lg bg-neutral-100/70 px-3 py-2 text-sm text-neutral-500 dark:bg-neutral-800/70 dark:text-neutral-400']">
      {{ tt('empty') }}
    </div>

    <Skeleton v-if="installed === null" :class="['h-9 w-full rounded-lg']" />
    <Alert v-else-if="loadFailed" tone="warning">
      {{ tt('load-error') }}
    </Alert>
    <ComboboxSelect
      v-else-if="installed.length > 0"
      :model-value="picked"
      :options="options"
      :placeholder="tt('add-app')"
      @update:model-value="pick"
    />
    <div v-else :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ tt('no-installed-apps') }}
    </div>

    <form :class="['flex items-center gap-2']" @submit.prevent="addPattern">
      <Input v-model="pattern" :placeholder="tt('pattern-placeholder')" :class="['min-w-0 flex-1 font-mono']" />
      <Button type="submit" size="sm" :label="tt('add-pattern')" :disabled="!pattern.trim()" />
    </form>
    <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ tt('pattern-hint') }}
    </div>
  </section>
</template>
