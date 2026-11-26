import type { MenuItemConstructorOptions } from 'electron'

import type { PresenceHide, PresenceHideScope, PresenceHidesState } from '../../shared/eventa'

/** The length of a timed hide or pause from the tray. */
export const PRESENCE_HIDE_HOUR_MS = 60 * 60 * 1000

const key = (name: string) => `tamagotchi.electron.tray.menu.presence.${name}`

function showAgainLabel(hide: PresenceHide, t: (key: string, named?: Record<string, unknown>) => string): string {
  if (hide.scope === 'all')
    return t(key('end_pause'))
  return t(key(hide.scope === 'window' ? 'show_window' : 'show_app'), { app: hide.label })
}

/**
 * The tray's "Hide from AIRI" submenu: hide the app the user last had in front, pause everything, or end a hide.
 *
 * Each item acts on the main process's current front app, which a foreground read of another app may change
 * between building the menu and a click; the menu rebuilds on every such change.
 */
export function presenceMenuItems(params: {
  state: PresenceHidesState
  t: (key: string, named?: Record<string, unknown>) => string
  add: (scope: PresenceHideScope, durationMs: number | null) => void
  remove: (id: string) => void
  openSettings: () => void
}): MenuItemConstructorOptions[] {
  const { state, t } = params
  const front = state.front
  const items: MenuItemConstructorOptions[] = front
    ? [
        { label: front.label, enabled: false },
        { label: t(key('this_window')), enabled: front.canHideWindow, click: () => params.add('window', null) },
        { label: t(key('app_hour')), click: () => params.add('app', PRESENCE_HIDE_HOUR_MS) },
        { label: t(key('app_session')), click: () => params.add('app', null) },
      ]
    : [{ label: t(key('no_app')), enabled: false }]

  items.push({ type: 'separator' }, { label: t(key('pause_hour')), click: () => params.add('all', PRESENCE_HIDE_HOUR_MS) })
  if (state.hides.length > 0) {
    items.push({ type: 'separator' })
    for (const hide of state.hides)
      items.push({ label: showAgainLabel(hide, t), click: () => params.remove(hide.id) })
  }
  items.push({ type: 'separator' }, { label: t(key('settings')), click: params.openSettings })
  return items
}
