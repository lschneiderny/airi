import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import type { OnboardingWindowManager } from '../../../windows/onboarding'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronOpenOnboarding } from '../../../../shared/eventa'
import { Animator } from '../../../windows/shared/animator'
import { computeAdjacentPosition } from '../../../windows/shared/display'
import { isStageWindow } from '../../../windows/stage/identity'
import { displayForWindow, displayMatching, readWindowRect } from '../../electron/coordinates'

const ANIMATION_DURATION = 350

export function createOnboardingService(params: {
  context: ReturnType<typeof createContext>['context']
  onboardingWindowManager: OnboardingWindowManager
  mainWindow: BrowserWindow
}) {
  const mainWindowAnimator = new Animator(params.mainWindow)
  let cleanupOnClosed: (() => void) | undefined

  defineInvokeHandler(params.context, electronOpenOnboarding, async () => {
    const savedBounds = readWindowRect(params.mainWindow)
    const { width: savedWidth, height: savedHeight } = params.mainWindow.getBounds()

    const onboardingWindow = await params.onboardingWindowManager.getAndToggleWindow()
    // The desktop stage covers the whole work area and never moves, so only the classic window slides beside onboarding.
    if (isStageWindow(params.mainWindow))
      return

    const onboardingBounds = readWindowRect(onboardingWindow)
    if (!savedBounds || !onboardingBounds) {
      const work = displayForWindow(onboardingWindow).workArea
      params.mainWindow.setSize(Math.min(savedWidth, work.width), Math.min(savedHeight, work.height))
      cleanupOnClosed?.()
      cleanupOnClosed = params.onboardingWindowManager.onClosed(() => {
        if (!params.mainWindow.isDestroyed())
          params.mainWindow.setSize(savedWidth, savedHeight)
        cleanupOnClosed = undefined
      })
      return
    }
    const display = displayMatching(onboardingBounds)

    const adjacent = computeAdjacentPosition(
      onboardingBounds,
      { width: savedBounds.width, height: savedBounds.height },
      display.workArea,
    )

    mainWindowAnimator.windowBoundsAnimateTo({
      x: adjacent.x,
      y: adjacent.y,
      width: adjacent.width,
      height: adjacent.height,
    }, { duration: ANIMATION_DURATION })

    let userMovedManually = false
    let ignoreNextMoves = true

    const moveListener = () => {
      if (ignoreNextMoves)
        return
      userMovedManually = true
    }

    params.mainWindow.on('move', moveListener)
    params.mainWindow.on('resize', moveListener)
    setTimeout(() => {
      ignoreNextMoves = false
    }, ANIMATION_DURATION + 50)

    cleanupOnClosed?.()

    cleanupOnClosed = params.onboardingWindowManager.onClosed(() => {
      params.mainWindow.removeListener('move', moveListener)
      params.mainWindow.removeListener('resize', moveListener)

      if (!userMovedManually && !params.mainWindow.isDestroyed()) {
        mainWindowAnimator.windowBoundsAnimateTo(savedBounds, { duration: ANIMATION_DURATION })
      }

      cleanupOnClosed = undefined
    })
  })
}
