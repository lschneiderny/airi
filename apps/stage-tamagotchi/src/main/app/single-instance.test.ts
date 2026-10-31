import type { App, BrowserWindow } from 'electron'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const windowMock = vi.hoisted(() => ({
  toggleWindowShow: vi.fn(),
}))

vi.mock('../windows/shared/window', () => ({
  toggleWindowShow: windowMock.toggleWindowShow,
}))
vi.mock('../windows/shared/display', () => ({ centerWindowOnDisplay: vi.fn() }))

function createMockApp(hasSingleInstanceLock: boolean): MockApp {
  return {
    on: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => hasSingleInstanceLock),
  } as unknown as MockApp
}

function createMockWindow() {
  return {} as BrowserWindow
}

describe('installSingleInstanceGuard', async () => {
  const { installSingleInstanceGuard } = await import('./single-instance')
  const { markStageWindow } = await import('../windows/stage/identity')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * @example
   * const installed = installSingleInstanceGuard({ app, getWindow })
   * expect(installed).toBe(false)
   */
  it('quits the secondary process when another AIRI instance already owns the lock', () => {
    const app = createMockApp(false)

    const installed = installSingleInstanceGuard({
      app,
      getWindow: vi.fn(() => undefined),
    })

    expect(installed).toBe(false)
    expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce()
    expect(app.quit).toHaveBeenCalledOnce()
    expect(app.on).not.toHaveBeenCalled()
  })

  /**
   * @example
   * secondInstanceHandler()
   * expect(toggleWindowShow).toHaveBeenCalledWith(window)
   */
  it('shows the main window when Windows forwards a second launch to the primary process', () => {
    const app = createMockApp(true)
    const window = createMockWindow()

    const installed = installSingleInstanceGuard({
      app,
      getWindow: vi.fn(() => window),
    })

    expect(installed).toBe(true)
    expect(app.on).toHaveBeenCalledWith('second-instance', expect.any(Function))

    const secondInstanceHandler = app.on.mock.calls[0]?.[1] as () => void
    secondInstanceHandler()

    expect(windowMock.toggleWindowShow).toHaveBeenCalledWith(window)
  })

  /**
   * @example
   * secondInstanceHandler()
   * expect(stage.showInactive).toHaveBeenCalledOnce()
   */
  it('shows the desktop stage without focusing it when a second launch is forwarded', () => {
    const app = createMockApp(true)
    const stage = Object.assign(createMockWindow(), { isDestroyed: vi.fn(() => false), showInactive: vi.fn(), show: vi.fn(), focus: vi.fn() })
    markStageWindow(stage)

    installSingleInstanceGuard({ app, getWindow: vi.fn(() => stage) })
    const secondInstanceHandler = app.on.mock.calls[0]?.[1] as () => void
    secondInstanceHandler()

    expect(stage.showInactive).toHaveBeenCalledOnce()
    expect(stage.show).not.toHaveBeenCalled()
    expect(stage.focus).not.toHaveBeenCalled()
    expect(windowMock.toggleWindowShow).not.toHaveBeenCalled()
  })
})
type MockApp = App & {
  on: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
  requestSingleInstanceLock: ReturnType<typeof vi.fn>
}
