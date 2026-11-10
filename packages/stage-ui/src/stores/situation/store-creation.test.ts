import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { useAiriCardStore } from '../modules/airi-card'
import { useSituationStore } from './index'

/** A synced runtime of a window that follows, reporting its role on subscribe like the plugin. */
function followerRuntime(): SyncedPiniaRuntime {
  return {
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 2),
    isLeader: () => false,
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      listener(false)
      return vi.fn()
    }),
    participantId: 'situation-store-creation-test',
    plugin: vi.fn(),
  }
}

// The card store and vue-i18n are the real ones here. The card store's setup calls `useI18n`, which works only inside
// a component setup of an app with the i18n plugin. A store created outside one, as in this file, has no such context.
describe('situation store in a window without an i18n context', () => {
  it('is created and follows without creating the character state store or the card store behind it', () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    const store = useSituationStore()
    store.setHostCapabilities({ unprompted: true })
    store.initialize(followerRuntime())

    expect(store.leading).toBe(false)
    expect(Object.keys(pinia.state.value)).not.toContain('character-state')
    expect(Object.keys(pinia.state.value)).not.toContain('airi-card')
    store.dispose()

    // The premise of this test: this context cannot create the card store.
    expect(() => useAiriCardStore()).toThrow('Must be called at the top of a `setup` function')
  })
})
