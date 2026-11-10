// @vitest-environment jsdom

import { boolean, number, optional, pipe, transform } from 'valibot'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSettingsDocument } from '.'

const key = 'settings/test-document'
const entries = {
  /** @default true */
  enabled: optional(boolean(), true),
  /** Clamped to 0..10. @default 5 */
  level: optional(pipe(number(), transform(value => Math.min(Math.max(value, 0), 10))), 5),
}
const options = { label: 'test-document' }

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('useSettingsDocument', () => {
  it('starts from the schema defaults and writes nothing until the first update', async () => {
    const settings = useSettingsDocument(key, entries, options)
    expect(settings.document.value).toEqual({ enabled: true, level: 5 })
    expect(localStorage.getItem(key)).toBeNull()

    expect(await settings.update({ level: 99 })).toEqual({ success: true })

    expect(settings.document.value).toEqual({ enabled: true, level: 10 })
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ enabled: true, level: 10 })
  })

  it('replaces the document on update instead of mutating it', async () => {
    const settings = useSettingsDocument(key, entries, options)
    const before = settings.document.value
    await settings.update({ enabled: false })
    expect(settings.document.value).not.toBe(before)
    expect(before).toEqual({ enabled: true, level: 5 })
  })

  it.each([{ level: 'high' }, { unknown: 1 }, [], null, 'text'])('rejects the invalid patch %j without changing the document or storage', async (patch) => {
    const settings = useSettingsDocument(key, entries, options)
    await settings.update({ enabled: false })
    const stored = localStorage.getItem(key)
    // @ts-expect-error Deliberately exercise malformed runtime input.
    const result = await settings.update(patch)
    expect(result.success).toBe(false)
    expect(settings.document.value).toEqual({ enabled: false, level: 5 })
    expect(localStorage.getItem(key)).toBe(stored)
  })

  it('keeps valid stored fields, resets invalid ones, and drops unknown ones', () => {
    localStorage.setItem(key, JSON.stringify({ enabled: false, level: 'high', extra: 1 }))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(useSettingsDocument(key, entries, options).document.value).toEqual({ enabled: false, level: 5 })
    expect(warning).toHaveBeenCalledExactlyOnceWith('[test-document] Invalid stored fields reset to defaults:', 'level')
  })

  it.each(['{corrupt', '[]', 'null', '"text"'])('reads the stored value %s as the defaults', (stored) => {
    localStorage.setItem(key, stored)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(useSettingsDocument(key, entries, options).document.value).toEqual({ enabled: true, level: 5 })
    expect(warning).toHaveBeenCalledExactlyOnceWith('[test-document] Stored settings are not an object; using defaults')
  })

  it('starts from `initial` only while nothing is stored, and validates it like a stored document', () => {
    const initial = vi.fn(() => ({ enabled: false, level: 99, extra: 1 }))
    expect(useSettingsDocument(key, entries, { ...options, initial }).document.value).toEqual({ enabled: false, level: 10 })
    expect(localStorage.getItem(key)).toBeNull()

    localStorage.setItem(key, JSON.stringify({ level: 2 }))
    expect(useSettingsDocument(key, entries, { ...options, initial }).document.value).toEqual({ enabled: true, level: 2 })
  })

  it('resets to the schema defaults, not to `initial`', async () => {
    const settings = useSettingsDocument(key, entries, { ...options, initial: () => ({ enabled: false }) })
    expect(settings.document.value.enabled).toBe(false)

    await settings.reset()

    expect(settings.document.value).toEqual({ enabled: true, level: 5 })
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ enabled: true, level: 5 })
  })

  it('does not follow storage changes from other windows', async () => {
    const settings = useSettingsDocument(key, entries, options)
    await settings.update({ level: 1 })
    const newValue = JSON.stringify({ enabled: false, level: 9 })
    localStorage.setItem(key, newValue)
    window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage }))
    expect(settings.document.value).toEqual({ enabled: true, level: 1 })
  })
})
