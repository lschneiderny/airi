import type { Rectangle } from 'electron'

import { EventEmitter } from 'node:events'

import { createContext } from '@moeru/eventa'
import { bounds } from '@proj-airi/electron-eventa'
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
import { describe, expect, it, vi } from 'vitest'

import { readRendererWindowBounds } from './coordinates'
import { createWindowService } from './window'

vi.mock('./coordinates', () => ({ readRendererWindowBounds: vi.fn() }))
vi.mock('../../windows/shared/window', () => ({ resizeWindowByDelta: vi.fn(), setWindowAlwaysOnTop: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse/main', () => ({
  createRendererLoop: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  safeClose: vi.fn(),
}))

describe('window service bounds loop', () => {
  it('tells the renderer once when its rectangle is withheld, then resumes with the trusted one', async () => {
    const context = createContext()
    const window = Object.assign(new EventEmitter(), { webContents: { id: 1 } })
    createWindowService({ context: context as never, window: window as never })
    const sent: Array<Rectangle | null | undefined> = []
    context.on(bounds, event => sent.push(event.body))
    const [loop] = vi.mocked(createRendererLoop).mock.calls.at(-1) ?? []
    if (!loop)
      throw new Error('Window service did not register its bounds loop')

    const trusted = { x: 50, y: 560, width: 300, height: 400 }
    vi.mocked(readRendererWindowBounds).mockReturnValue(trusted)
    await loop.run()
    vi.mocked(readRendererWindowBounds).mockReturnValue(null)
    await loop.run()
    await loop.run()
    vi.mocked(readRendererWindowBounds).mockReturnValue(trusted)
    await loop.run()

    expect(sent).toEqual([trusted, null, trusted])
  })
})
