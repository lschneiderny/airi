import type { BrowserWindow } from 'electron'

import type { OnboardingWindowManager } from '../../../windows/onboarding'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { electronOpenOnboarding } from '../../../../shared/eventa'
import { markStageWindow } from '../../../windows/stage/identity'
import { createOnboardingService } from './index'

const mocks = vi.hoisted(() => ({
  handlers: new Map<unknown, () => Promise<void>>(),
  animateTo: vi.fn(),
}))

vi.mock('@moeru/eventa', async importOriginal => ({
  ...await importOriginal<typeof import('@moeru/eventa')>(),
  defineInvokeHandler: (_context: unknown, definition: unknown, handler: () => Promise<void>) => {
    mocks.handlers.set(definition, handler)
  },
}))
vi.mock('electron', () => ({
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 25, width: 1440, height: 801 } }) },
}))
vi.mock('../../../windows/shared/animator', () => ({
  Animator: class {
    windowBoundsAnimateTo = mocks.animateTo
  },
}))
vi.mock('../../../windows/shared/display', async importOriginal => ({
  computeAdjacentPosition: (await importOriginal<typeof import('../../../windows/shared/display')>()).computeAdjacentPosition,
  centerWindowOnDisplay: vi.fn(),
}))
vi.mock('../../../windows/shared/window', () => ({ toggleWindowShow: vi.fn() }))

function createMainWindow(bounds: { x: number, y: number, width: number, height: number }) {
  return Object.assign({} as BrowserWindow, {
    getBounds: vi.fn(() => bounds),
    on: vi.fn(),
    removeListener: vi.fn(),
    isDestroyed: vi.fn(() => false),
  })
}

function createOnboardingManager(): OnboardingWindowManager {
  const onboardingWindow = Object.assign({} as BrowserWindow, { getBounds: () => ({ x: 400, y: 200, width: 600, height: 500 }) })
  return Object.assign({} as OnboardingWindowManager, {
    getAndToggleWindow: vi.fn(async () => onboardingWindow),
    onClosed: vi.fn(() => vi.fn()),
  })
}

describe('electronOpenOnboarding', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.animateTo.mockClear()
  })

  it('slides the classic main window beside the onboarding window', async () => {
    const onboardingWindowManager = createOnboardingManager()
    createOnboardingService({ context: {} as never, onboardingWindowManager, mainWindow: createMainWindow({ x: 0, y: 0, width: 450, height: 600 }) })

    await mocks.handlers.get(electronOpenOnboarding)?.()

    expect(onboardingWindowManager.getAndToggleWindow).toHaveBeenCalledOnce()
    expect(mocks.animateTo).toHaveBeenCalledOnce()
  })

  it('opens onboarding without moving the desktop stage', async () => {
    const stage = createMainWindow({ x: 0, y: 25, width: 1440, height: 801 })
    markStageWindow(stage)
    const onboardingWindowManager = createOnboardingManager()
    createOnboardingService({ context: {} as never, onboardingWindowManager, mainWindow: stage })

    await mocks.handlers.get(electronOpenOnboarding)?.()

    expect(onboardingWindowManager.getAndToggleWindow).toHaveBeenCalledOnce()
    expect(mocks.animateTo).not.toHaveBeenCalled()
    expect(stage.on).not.toHaveBeenCalled()
  })
})
