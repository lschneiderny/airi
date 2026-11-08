import { app } from './app'
import { foregroundWindow } from './foreground-window'
import { hostCapabilities, hostCapabilitiesEvents } from './host-capabilities'
import { powerMonitor, powerMonitorEvents } from './powerMonitor'
import { screen } from './screen'
import { systemPreferences } from './system-preferences'
import { window } from './window'

export type { ForegroundWindowSample } from './foreground-window'
export { getHostCapabilities, hostCapabilitiesChanged } from './host-capabilities'
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
  hostCapabilities,
}

export const electronEvents = {
  powerMonitor: powerMonitorEvents,
  hostCapabilities: hostCapabilitiesEvents,
}
