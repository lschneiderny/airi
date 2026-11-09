import type { MenuItemConstructorOptions, Rectangle } from 'electron'

import { readWindowRect } from '../services/electron/coordinates'
import { isStageWindow } from '../windows/stage/identity'

export const RECOMMENDED_WIDTH = 450
export const RECOMMENDED_HEIGHT = 600
const ASPECT_RATIO = RECOMMENDED_WIDTH / RECOMMENDED_HEIGHT

export type AlignPosition = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

interface LayoutWindow {
  getBounds: () => Rectangle
}

export function resolveAlignedWindowBounds(window: LayoutWindow, workArea: Rectangle, position: AlignPosition): Rectangle {
  const { width: windowWidth, height: windowHeight } = window.getBounds()
  const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = workArea

  let x = areaX
  let y = areaY

  switch (position) {
    case 'center':
      x = areaX + Math.floor((areaWidth - windowWidth) / 2)
      y = areaY + Math.floor((areaHeight - windowHeight) / 2)
      break
    case 'top-left':
      break
    case 'top-right':
      x = areaX + areaWidth - windowWidth
      break
    case 'bottom-left':
      y = areaY + areaHeight - windowHeight
      break
    case 'bottom-right':
      x = areaX + areaWidth - windowWidth
      y = areaY + areaHeight - windowHeight
      break
  }

  return { x, y, width: windowWidth, height: windowHeight }
}

function isSizeMatch(window: LayoutWindow, targetWidth: number, targetHeight: number): boolean {
  const { width, height } = window.getBounds()
  return Math.abs(width - Math.round(targetWidth)) <= 2 && Math.abs(height - Math.round(targetHeight)) <= 2
}

function isPositionMatch(rect: Rectangle, target: Rectangle): boolean {
  return Math.abs(rect.x - target.x) <= 5 && Math.abs(rect.y - target.y) <= 5
}

/**
 * The tray's "Adjust sizes" and "Align to" submenus for the user-facing main window, after their separator.
 *
 * The desktop stage covers its display's work area and must never be resized, moved or focused, so it gets no items.
 */
export function windowLayoutMenuItems(options: {
  window: LayoutWindow
  workArea: Rectangle
  t: (key: string) => string
  resize: (width: number, height: number, x?: number, y?: number) => void
  align: (position: AlignPosition) => void
}): MenuItemConstructorOptions[] {
  const { window, workArea, t, resize, align } = options
  if (isStageWindow(window))
    return []

  const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = workArea
  const fullHeightTarget = areaHeight
  const fullWidthTarget = Math.floor(areaHeight * ASPECT_RATIO)
  const halfHeightTarget = Math.floor(areaHeight / 2)
  const halfWidthTarget = Math.floor(halfHeightTarget * ASPECT_RATIO)
  const label = (key: string) => t(`tamagotchi.electron.tray.menu.labels.label.${key}`)
  const rect = readWindowRect(window)
  const alignItem = (key: string, position: AlignPosition): MenuItemConstructorOptions => ({
    label: label(key),
    type: 'checkbox',
    checked: rect !== null && isPositionMatch(rect, resolveAlignedWindowBounds(window, workArea, position)),
    click: () => align(position),
  })

  return [
    { type: 'separator' },
    {
      label: label('adjust_sizes'),
      submenu: [
        { label: label('recommended_size'), type: 'checkbox', checked: isSizeMatch(window, RECOMMENDED_WIDTH, RECOMMENDED_HEIGHT), click: () => resize(RECOMMENDED_WIDTH, RECOMMENDED_HEIGHT) },
        { label: label('full_height'), type: 'checkbox', checked: isSizeMatch(window, fullWidthTarget, fullHeightTarget), click: () => resize(fullWidthTarget, fullHeightTarget) },
        { label: label('half_height'), type: 'checkbox', checked: isSizeMatch(window, halfWidthTarget, halfHeightTarget), click: () => resize(halfWidthTarget, halfHeightTarget) },
        { label: label('full_screen'), type: 'checkbox', checked: isSizeMatch(window, areaWidth, areaHeight), click: () => resize(areaWidth, areaHeight, areaX, areaY) },
      ],
    },
    ...rect
      ? [{
        label: label('align_to'),
        submenu: [
          alignItem('center', 'center'),
          { type: 'separator' },
          alignItem('top_left', 'top-left'),
          alignItem('top_right', 'top-right'),
          alignItem('bottom_left', 'bottom-left'),
          alignItem('bottom_right', 'bottom-right'),
        ],
      } satisfies MenuItemConstructorOptions]
      : [],
  ]
}
