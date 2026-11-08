import { useHostCapabilitiesStore } from '@proj-airi/stage-shared/stores/host-capabilities'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import { createStageWebApp } from './create-stage-web-app'

describe('createStageWebApp', () => {
  it('holds the web host snapshot in the store after mount', () => {
    const pinia = createPinia()
    const store = useHostCapabilitiesStore(pinia)
    expect(store.snapshot).toBeNull()
    const setCalls: string[] = []
    store.$onAction(({ name }) => {
      if (name === 'set')
        setCalls.push(name)
    })

    const { app } = createStageWebApp(defineComponent({ render: () => h('div') }), pinia)
    const host = document.createElement('div')
    document.body.append(host)

    try {
      app.mount(host)
      expect(store.snapshot?.host).toBe('web')
      expect(setCalls).toHaveLength(1)
    }
    finally {
      app.unmount()
      host.remove()
    }
  })
})
