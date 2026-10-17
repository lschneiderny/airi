<script setup lang="ts">
import { ProfileSwitcherPopover } from '@proj-airi/stage-ui/components'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'

import HeaderLink from './HeaderLink.vue'

const router = useRouter()
const { t } = useI18n()

function handleNavigation() {
  router.push('/settings/airi-card')
}
</script>

<template>
  <header :class="['mb-1 w-full flex items-center justify-between gap-2']">
    <HeaderLink />
    <div :class="['flex items-center gap-2']">
      <ProfileSwitcherPopover @manage="handleNavigation" />
      <RouterLink
        to="/settings"
        :aria-label="t('settings.title')"
        :title="t('settings.title')"
        :class="[
          'size-11 flex items-center justify-center rounded-full border-2 outline-none shadow-sm backdrop-blur-md',
          'border-neutral-100/60 bg-neutral-50/70 dark:border-neutral-800/30 dark:bg-neutral-800/70',
          'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700',
          'dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200',
          'focus-visible:ring-2 focus-visible:ring-primary-500',
          'transition-colors duration-200 ease-in-out',
        ]"
      >
        <span :class="['i-solar:settings-minimalistic-bold-duotone size-5']" aria-hidden="true" />
      </RouterLink>
    </div>
  </header>
</template>
