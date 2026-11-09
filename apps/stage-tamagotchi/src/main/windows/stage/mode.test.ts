import { describe, expect, it } from 'vitest'

import { isLinuxStageEligible, selectHostMode } from './mode'

const dev = { development: true }
const production = { development: false }
const desktopMmd = { experimental: true, mode: 'desktop', activeRenderer: 'mmd' } as const

describe('selectHostMode', () => {
  it('uses the saved mode for an MMD model', () => {
    expect(selectHostMode(desktopMmd, 'darwin', {}, dev, false)).toBe('desktop')
    expect(selectHostMode({ ...desktopMmd, mode: 'window' }, 'win32', {}, dev, false)).toBe('window')
  })

  it('keeps the classic window while the Experimental 3D stage setting is off, even for a saved desktop mode', () => {
    expect(selectHostMode({ ...desktopMmd, experimental: false }, 'darwin', {}, dev, false)).toBe('window')
    expect(selectHostMode({ ...desktopMmd, experimental: false }, 'win32', {}, dev, false)).toBe('window')
    expect(selectHostMode({ ...desktopMmd, experimental: false }, 'linux', {}, production, true)).toBe('window')
  })

  it('lets AIRI_STAGE_HOST override, in a development build, the setting, the platform, the renderer and the saved mode', () => {
    expect(selectHostMode({ experimental: false, mode: 'window', activeRenderer: 'other' }, 'linux', { AIRI_STAGE_HOST: 'desktop' }, dev, false)).toBe('desktop')
    expect(selectHostMode(desktopMmd, 'win32', { AIRI_STAGE_HOST: 'window' }, dev, false)).toBe('window')
    expect(selectHostMode(desktopMmd, 'linux', { AIRI_STAGE_HOST: 'window' }, dev, true)).toBe('window')
  })

  it('ignores AIRI_STAGE_HOST in a production build, which obeys the setting', () => {
    expect(selectHostMode({ ...desktopMmd, experimental: false }, 'darwin', { AIRI_STAGE_HOST: 'desktop' }, production, false)).toBe('window')
    expect(selectHostMode(desktopMmd, 'win32', { AIRI_STAGE_HOST: 'window' }, production, false)).toBe('desktop')
    expect(selectHostMode(desktopMmd, 'win32', {}, production, false)).toBe('desktop')
  })

  it('ignores an AIRI_STAGE_HOST value that is not a mode', () => {
    expect(selectHostMode(desktopMmd, 'darwin', { AIRI_STAGE_HOST: 'stage' }, dev, false)).toBe('desktop')
  })

  it('keeps the classic window on a Linux desktop that is not eligible', () => {
    expect(selectHostMode(desktopMmd, 'linux', {}, dev, false)).toBe('window')
    expect(selectHostMode(desktopMmd, 'linux', { AIRI_STAGE_HOST: 'desktop' }, production, false)).toBe('window')
  })

  it('uses the saved mode on an eligible Linux desktop', () => {
    expect(selectHostMode(desktopMmd, 'linux', {}, production, true)).toBe('desktop')
    expect(selectHostMode({ ...desktopMmd, mode: 'window' }, 'linux', {}, production, true)).toBe('window')
    expect(selectHostMode({ ...desktopMmd, activeRenderer: 'other' }, 'linux', {}, production, true)).toBe('window')
  })

  it('ignores Linux eligibility on Windows and macOS', () => {
    expect(selectHostMode(desktopMmd, 'win32', {}, production, true)).toBe('desktop')
    expect(selectHostMode(desktopMmd, 'darwin', {}, production, false)).toBe('desktop')
  })

  it('keeps the classic window for a model that is not MMD or was never reported', () => {
    expect(selectHostMode({ ...desktopMmd, activeRenderer: 'other' }, 'win32', {}, dev, false)).toBe('window')
    expect(selectHostMode({ ...desktopMmd, activeRenderer: null }, 'darwin', {}, dev, false)).toBe('window')
  })
})

describe('isLinuxStageEligible', () => {
  const kdeWayland = { XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-1' }
  const x11 = { XDG_CURRENT_DESKTOP: 'Openbox', XDG_SESSION_TYPE: 'x11', DISPLAY: ':2' }

  it.each([
    { name: 'KDE on Wayland with a toggling Electron', env: kdeWayland, version: '43.8.7', eligible: true },
    { name: 'an EWMH X11 session', env: x11, version: '43.8.7', eligible: true },
    { name: 'the first Electron with the toggle', env: kdeWayland, version: '43.7.6', eligible: true },
    { name: 'a later major', env: x11, version: '44.0.0', eligible: true },
    { name: 'an Electron without the Wayland toggle', env: kdeWayland, version: '43.7.5', eligible: false },
    { name: 'an older minor', env: x11, version: '43.4.1', eligible: false },
    { name: 'GNOME', env: { ...kdeWayland, XDG_CURRENT_DESKTOP: 'GNOME' }, version: '43.8.7', eligible: false },
    { name: 'sway', env: { ...kdeWayland, SWAYSOCK: '/run/user/1000/sway.sock' }, version: '43.8.7', eligible: false },
    { name: 'Hyprland', env: { ...kdeWayland, HYPRLAND_INSTANCE_SIGNATURE: 'hypr' }, version: '43.8.7', eligible: false },
    { name: 'an unknown Wayland compositor', env: { WAYLAND_DISPLAY: 'wayland-1' }, version: '43.8.7', eligible: false },
    { name: 'a missing Electron version', env: kdeWayland, version: undefined, eligible: false },
  ])('$name: $eligible', ({ env, version, eligible }) => {
    expect(isLinuxStageEligible(env, version)).toBe(eligible)
  })
})
