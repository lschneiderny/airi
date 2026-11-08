import type { Pinia } from 'pinia'
import type { Component, Plugin } from 'vue'
import type { Router, RouteRecordRaw } from 'vue-router'

import NProgress from 'nprogress'

import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { PiniaColada } from '@pinia/colada'
import { isEnvTruthy } from '@proj-airi/stage-shared'
import { pushToTalkTriggerKey } from '@proj-airi/stage-ui/composables/push-to-talk-trigger'
import { trackButtonPlugin } from '@proj-airi/stage-ui/directives/track-button'
import { piniaPluginTracing, setupSynced } from '@proj-airi/stage-ui/libs/pinia'
import { useMediaQuery } from '@vueuse/core'
import { MotionPlugin } from '@vueuse/motion'
import { createPinia } from 'pinia'
import { setupLayouts } from 'virtual:generated-layouts'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import { routes } from 'vue-router/auto-routes'

import { i18n } from './i18n'
import { reportWebHostCapabilities } from './report-host-capabilities'

/**
 * Builds the stage-web app with its plugins, router and Pinia, and reports the host capability snapshot.
 *
 * Accepts an existing Pinia so tests can inspect the store before startup. Returns the unmounted app so `main.ts` mounts it and tests mount it with a stub root component.
 */
export function createStageWebApp(rootComponent: Component, pinia: Pinia = createPinia()) {
  const synced = setupSynced()
  pinia.use(synced.pinia)
  if (import.meta.env.DEV)
    pinia.use(piniaPluginTracing)

  // TODO: vite-plugin-vue-layouts is long deprecated, replace with another layout solution
  const routeRecords = setupLayouts(routes as RouteRecordRaw[])

  let router: Router
  if (isEnvTruthy(import.meta.env.VITE_APP_TARGET_HUGGINGFACE_SPACE))
    router = createRouter({ routes: routeRecords, history: createWebHashHistory() })
  else
    router = createRouter({ routes: routeRecords, history: createWebHistory() })

  router.beforeEach((to, from) => {
    if (to.path !== from.path)
      NProgress.start()
  })

  router.afterEach(() => {
    NProgress.done()
  })

  const app = createApp(rootComponent)
    .use(synced.vue)
    .use(MotionPlugin)
    // TODO: Fix autoAnimatePlugin type error
    .use(autoAnimatePlugin as unknown as Plugin)
    .use(router)
    .use(pinia)
    .use(PiniaColada)
    .use(i18n)
    .use(trackButtonPlugin)
    // NOTICE:
    // Push to Talk holds Space, but no Web API reports a hardware keyboard.
    // A fine pointer (mouse or trackpad) is the closest live signal. Phones and touch-only tablets lack it.
    // Source: https://www.w3.org/TR/mediaqueries-4/#any-input
    // Remove when stage-web gets a touch hold control.
    .provide(pushToTalkTriggerKey, useMediaQuery('(any-pointer: fine)'))

  reportWebHostCapabilities(pinia)

  return { app, pinia }
}
