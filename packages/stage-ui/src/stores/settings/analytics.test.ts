// @vitest-environment jsdom

import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { analyticsConsentMirrorKey, useSettingsAnalytics } from './analytics'

const key = 'settings/analytics'
const contexts: ReturnType<typeof createPinia>[] = []

function context(mirror = vi.fn(async (_optedIn: boolean) => {})) {
  const pinia = createPinia()
  createApp({}).use(pinia).provide(analyticsConsentMirrorKey, mirror)
  contexts.push(pinia)
  return { store: useSettingsAnalytics(pinia), mirror }
}

afterEach(() => {
  contexts.splice(0).forEach(disposePinia)
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('analytics consent document', () => {
  it.each([
    ['true', true],
    ['false', false],
    [null, false],
    ['{broken', false],
    ['"true"', false],
  ])('imports only explicit legacy consent %s', async (stored, expected) => {
    if (stored !== null)
      localStorage.setItem('settings/analytics/opted-in', stored)
    localStorage.setItem('settings/analytics/enabled', 'true')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const { store, mirror } = context()
    expect(store.analyticsEnabled).toBe(expected)
    expect(writes).not.toHaveBeenCalled()
    expect(mirror).not.toHaveBeenCalled()
    expect(localStorage.getItem(key)).toBeNull()

    await store.initialize()

    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ optedIn: expected })
    expect(localStorage.getItem('settings/analytics/opted-in')).toBeNull()
    expect(localStorage.getItem('settings/analytics/enabled')).toBeNull()
    expect(mirror).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it.each([false, true])('prefers a new document with optedIn=%s and never reads old consent', async (optedIn) => {
    localStorage.setItem(key, JSON.stringify({ optedIn }))
    localStorage.setItem('settings/analytics/opted-in', String(!optedIn))
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    const { store } = context()
    expect(store.analyticsEnabled).toBe(optedIn)
    expect(reads.mock.calls.some(([name]) => name === 'settings/analytics/opted-in')).toBe(false)
    await store.initialize()
    expect(store.analyticsEnabled).toBe(optedIn)
  })

  it('keeps the legacy keys and live state when the new document cannot be saved', async () => {
    localStorage.setItem('settings/analytics/opted-in', 'true')
    localStorage.setItem('settings/analytics/enabled', 'true')
    const { store, mirror } = context()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Save refused')
    })

    await expect(store.update({ optedIn: false })).rejects.toThrow('Save refused')

    expect(store.analyticsEnabled).toBe(true)
    expect(localStorage.getItem(key)).toBeNull()
    expect(localStorage.getItem('settings/analytics/opted-in')).toBe('true')
    expect(localStorage.getItem('settings/analytics/enabled')).toBe('true')
    expect(mirror).not.toHaveBeenCalled()
  })

  it('resets to false, removes both old keys, and cannot import them again after the sweep', async () => {
    localStorage.setItem('settings/analytics/opted-in', 'true')
    const { store, mirror } = context()
    await store.reset()
    expect(store.analyticsEnabled).toBe(false)
    expect(mirror).toHaveBeenCalledExactlyOnceWith(false)
    localStorage.removeItem(key)
    expect(context().store.analyticsEnabled).toBe(false)
  })

  it('awaits the main mirror on startup, update, and reset without an SDK', async () => {
    const acknowledgment = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const mirror = vi.fn(async (_optedIn: boolean) => {
      entered.resolve()
      await acknowledgment.promise
    })
    const { store } = context(mirror)
    let finished = false
    const initialization = store.initialize().then(() => {
      finished = true
    })
    await entered.promise
    expect(finished).toBe(false)
    acknowledgment.resolve()
    await initialization
    await store.update({ optedIn: true })
    await store.reset()
    expect(mirror.mock.calls).toEqual([[false], [true], [false]])
  })

  it('surfaces a rejected main mirror while retaining the acknowledged document', async () => {
    const { store } = context(vi.fn(async () => {
      throw new Error('Main rejected consent')
    }))
    await expect(store.initialize()).rejects.toThrow('Main rejected consent')
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ optedIn: false })
    await expect(store.reset()).rejects.toThrow('Main rejected consent')
    expect(store.analyticsEnabled).toBe(false)
  })
})
