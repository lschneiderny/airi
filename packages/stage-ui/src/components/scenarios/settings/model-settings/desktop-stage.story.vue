<script setup lang="ts">
import type { DesktopStageState } from './desktop-stage'

import { desktopStageNeedsRelaunch } from './desktop-stage'

const examples = [
  { title: 'Linux or non-MMD model', mode: 'desktop', running: 'window', next: 'window' },
  { title: 'Desktop stage ready after relaunch', mode: 'desktop', running: 'window', next: 'desktop' },
  { title: 'Development override keeps desktop', mode: 'window', running: 'desktop', next: 'desktop' },
] as const satisfies readonly (Pick<DesktopStageState, 'mode' | 'running' | 'next'> & { title: string })[]
</script>

<template>
  <Story title="Desktop stage launch policy" group="settings">
    <Variant v-for="example in examples" :id="example.title" :key="example.title" :title="example.title">
      <dl>
        <dt>Saved mode</dt><dd>{{ example.mode }}</dd>
        <dt>Running host</dt><dd>{{ example.running }}</dd>
        <dt>Next host</dt><dd>{{ example.next }}</dd>
        <dt>Relaunch needed</dt><dd>{{ desktopStageNeedsRelaunch(example) }}</dd>
      </dl>
    </Variant>
  </Story>
</template>
