import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

const eventSuspended = defineEventa('eventa:event:electron:app:suspended')
const eventResumed = defineEventa('eventa:event:electron:app:resumed')
const eventLockScreen = defineEventa('eventa:event:electron:app:lock-screen')
const eventUnlockScreen = defineEventa('eventa:event:electron:app:unlock-screen')

export const powerMonitorEvents = {
  lockScreen: eventLockScreen,
  resumed: eventResumed,
  suspended: eventSuspended,
  unlockScreen: eventUnlockScreen,
}

/**
 * Whole seconds since the last keyboard or mouse input anywhere on the desktop (`powerMonitor.getSystemIdleTime()`).
 * `null` means the host cannot measure idle time, as on a Linux Wayland session.
 */
const getSystemIdleTime = defineInvokeEventa<number | null>('eventa:invoke:electron:power-monitor:get-system-idle-time')

export const powerMonitor = {
  getSystemIdleTime,
}
