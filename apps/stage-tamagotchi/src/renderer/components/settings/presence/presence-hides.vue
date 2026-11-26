<script setup lang="ts">
import type { PresenceHide, PresenceHideScope } from '../../../../shared/eventa'

import { useSituationSettings } from '@proj-airi/stage-ui/features/situation/settings'
import { Alert, Button } from '@proj-airi/ui'
import { format } from 'date-fns'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePresenceHides } from '../../../composables/use-presence-hides'
import { withEntry } from './blocked-apps'

const HOUR_MS = 60 * 60 * 1000

const { t } = useI18n()
const tt = (key: string, named?: Record<string, unknown>) => t(`tamagotchi.settings.pages.presence.hides.${key}`, named ?? {})
const settings = useSituationSettings()
const { state, add, remove } = usePresenceHides()
const failed = shallowRef(false)

async function run(action: () => Promise<unknown>) {
  failed.value = false
  try {
    await action()
  }
  catch {
    failed.value = true
  }
}

function hide(scope: PresenceHideScope, durationMs: number | null) {
  return run(() => add(scope, durationMs))
}

/** Adds the front app to the persisted block list; the block list hides it from the next read on. */
function blockAlways() {
  const front = state.value.front
  if (!front)
    return
  return run(async () => {
    const next = withEntry(settings.document.blockedApps, front.appKey)
    if (next)
      await settings.update({ blockedApps: next })
  })
}

function hideLabel(entry: PresenceHide): string {
  if (entry.scope === 'all')
    return tt('pause-label')
  return entry.scope === 'window' ? tt('window-label', { app: entry.label }) : entry.label ?? ''
}

function hideEnd(entry: PresenceHide): string {
  if (entry.untilMs !== null)
    return tt('until-time', { time: format(entry.untilMs, 'p') })
  return entry.scope === 'window' ? tt('until-quit') : tt('until-restart')
}
</script>

<template>
  <section :class="['flex flex-col gap-3']">
    <div>
      <div :class="['text-sm font-medium']">
        {{ tt('title') }}
      </div>
      <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tt('description') }}
      </div>
    </div>

    <div :class="['flex flex-col gap-2', 'rounded-lg bg-neutral-100/70 px-3 py-2 dark:bg-neutral-800/70']">
      <template v-if="state.front">
        <div data-testid="presence-front" :class="['text-sm']">
          {{ tt('front', { app: state.front.label }) }}
        </div>
        <div :class="['flex flex-wrap gap-2']">
          <Button size="sm" :label="tt('this-window')" :disabled="!state.front.canHideWindow" @click="hide('window', null)" />
          <Button size="sm" :label="tt('app-hour')" @click="hide('app', HOUR_MS)" />
          <Button size="sm" :label="tt('app-session')" @click="hide('app', null)" />
          <Button size="sm" :label="tt('app-always')" @click="blockAlways" />
        </div>
      </template>
      <div v-else :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tt('no-front') }}
      </div>
    </div>

    <div>
      <Button size="sm" :label="tt('pause-hour')" @click="hide('all', HOUR_MS)" />
    </div>

    <Alert v-if="failed" tone="danger">
      {{ tt('error') }}
    </Alert>

    <div v-if="state.hides.length > 0" :class="['flex flex-col gap-1']">
      <div :class="['text-xs font-medium text-neutral-500 dark:text-neutral-400']">
        {{ tt('hidden-now') }}
      </div>
      <ul :class="['flex flex-col gap-1']">
        <li
          v-for="entry in state.hides"
          :key="entry.id"
          data-testid="presence-hide-row"
          :class="['flex items-center justify-between gap-3', 'rounded-lg bg-neutral-100/70 px-3 py-2 dark:bg-neutral-800/70']"
        >
          <div :class="['min-w-0 flex flex-col']">
            <span :class="['truncate text-sm']">{{ hideLabel(entry) }}</span>
            <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">{{ hideEnd(entry) }}</span>
          </div>
          <Button size="sm" :label="tt('show-again')" :class="['shrink-0']" @click="run(() => remove(entry.id))" />
        </li>
      </ul>
    </div>
  </section>
</template>
