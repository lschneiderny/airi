import { app } from './app'
import { foregroundWindow } from './foreground-window'
import { powerMonitor, powerMonitorEvents } from './powerMonitor'
import { screen } from './screen'
import { systemPreferences } from './system-preferences'
import { window } from './window'

export type { ForegroundWindowSample } from './foreground-window'
export { cursorScreenPoint, startLoopGetCursorScreenPoint } from './screen'
export { bounds, startLoopGetBounds } from './window'
export type { BackgroundMaterialType, ResizeDirection, VibrancyType } from './window'

export const electron = {
  screen,
  window,
  systemPreferences,
  app,
  powerMonitor,
  foregroundWindow,
}

export const electronEvents = {
  powerMonitor: powerMonitorEvents,
}
