import { createContext } from '@moeru/eventa'
import { bounds } from '@proj-airi/electron-eventa'
import { describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ context: undefined as ReturnType<typeof createContext> | undefined }))

vi.mock('./use-electron-eventa-context', () => ({
  getElectronEventaContext: () => boundary.context,
}))

vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return { ...actual, defineInvoke: () => vi.fn(async () => {}) }
})

describe('useElectronWindowBounds', () => {
  it('drops availability when main withholds the rectangle, so no cached origin stays usable', async () => {
    boundary.context = createContext()
    const { useElectronWindowBounds } = await import('./use-electron-window-bounds')
    const windowBounds = useElectronWindowBounds()
    expect(windowBounds.available.value).toBe(false)

    await boundary.context.emit(bounds, { x: 1796, y: 420, width: 300, height: 400 })
    expect(windowBounds.available.value).toBe(true)

    await boundary.context.emit(bounds, null)
    expect(windowBounds.available.value).toBe(false)

    await boundary.context.emit(bounds, { x: 50, y: 560, width: 300, height: 400 })
    expect(windowBounds.available.value).toBe(true)
    expect([windowBounds.x.value, windowBounds.y.value]).toEqual([50, 560])
  })
})
