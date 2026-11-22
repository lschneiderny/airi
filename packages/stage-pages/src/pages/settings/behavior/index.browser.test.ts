import en from '@proj-airi/i18n/locales/en'

import { useCharacterBehaviorSettings } from '@proj-airi/stage-ui/stores/settings'
import { createPinia, disposePinia } from 'pinia'
import { expect, it, onTestFinished } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import BehaviorPage from './index.vue'

import '@unocss/reset/tailwind.css'
import '@proj-airi/ui/main.css'
import 'virtual:uno.css'

it('writes the Behavior page idle toggle to its settings document', async () => {
  localStorage.clear()
  const pinia = createPinia()
  onTestFinished(() => {
    cleanup()
    disposePinia(pinia)
    localStorage.clear()
  })
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const screen = await render(BehaviorPage, { global: { plugins: [pinia, i18n] } })
  const settings = useCharacterBehaviorSettings(pinia)
  const saved = new Promise<void>((resolve, reject) => {
    const stop = settings.$onAction(({ name, after, onError }) => {
      if (name !== 'update')
        return
      after(() => {
        stop()
        resolve()
      })
      onError((error) => {
        stop()
        reject(error)
      })
    })
    onTestFinished(stop)
  })
  const toggle = screen.getByRole('switch', { name: i18n.global.t('settings.live2d.animation.natural-idle-activities.title') })
  await toggle.click()
  await saved
  expect(settings.document.idleActivities).toBe(false)
  expect(JSON.parse(localStorage.getItem('settings/character-behavior')!).idleActivities).toBe(false)
  await expect.element(toggle).not.toBeChecked()
})
