import { describe, expect, it } from 'vitest'

import { detectLinuxDesktop } from './detect'

describe('detectLinuxDesktop', () => {
  const bus = 'unix:path=/run/user/1000/airi-qa-display/qa/bus'
  const inheritedKde = { XDG_CURRENT_DESKTOP: 'KDE', KDE_FULL_SESSION: 'true', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0', XDG_SESSION_TYPE: 'wayland' }

  it.each([
    { name: 'empty environment', env: {}, session: 'wayland', candidate: 'none' },
    { name: 'explicit X11', env: { XDG_SESSION_TYPE: 'x11' }, session: 'x11', candidate: 'x11-ewmh' },
    { name: 'display without Wayland', env: { DISPLAY: ':1' }, session: 'x11', candidate: 'x11-ewmh' },
    { name: 'Wayland with Xwayland', env: { DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-1' }, session: 'wayland', candidate: 'none' },
    { name: 'KDE on X11', env: { XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'x11' }, session: 'x11', candidate: 'kwin' },
    { name: 'case insensitive desktop list', env: { XDG_CURRENT_DESKTOP: 'ubuntu:gnome', WAYLAND_DISPLAY: 'wayland-1' }, session: 'wayland', candidate: 'gnome' },
    { name: 'KDE precedes GNOME', env: { XDG_CURRENT_DESKTOP: 'GNOME:KDE' }, session: 'wayland', candidate: 'kwin' },
    { name: 'GNOME precedes X11 fallback', env: { XDG_CURRENT_DESKTOP: 'GNOME', DISPLAY: ':1' }, session: 'x11', candidate: 'gnome' },
    { name: 'sway socket overrides inherited KDE', env: { ...inheritedKde, SWAYSOCK: '/run/user/1000/sway.sock' }, session: 'wayland', candidate: 'sway' },
    { name: 'Hyprland overrides sway and desktop', env: { ...inheritedKde, SWAYSOCK: '/run/user/1000/sway.sock', HYPRLAND_INSTANCE_SIGNATURE: 'hypr-test' }, session: 'wayland', candidate: 'hyprland' },
    { name: 'empty sockets do not override KDE', env: { ...inheritedKde, SWAYSOCK: '', HYPRLAND_INSTANCE_SIGNATURE: '' }, session: 'wayland', candidate: 'kwin' },
    { name: 'existing qa:display client environment', env: { PATH: '/bin', AIRI_QA_DISPLAY: 'qa', WAYLAND_DISPLAY: 'wayland-airi-qa-qa', DISPLAY: ':2', DBUS_SESSION_BUS_ADDRESS: bus, XDG_SESSION_TYPE: 'wayland' }, session: 'wayland', candidate: 'none' },
    { name: 'todo 6 kwin resulting environment', env: { ...inheritedKde, WAYLAND_DISPLAY: 'wayland-airi-qa-qa', DISPLAY: ':2', DBUS_SESSION_BUS_ADDRESS: bus }, session: 'wayland', candidate: 'kwin' },
    { name: 'todo 6 x11 resulting environment', env: { XDG_CURRENT_DESKTOP: 'Openbox', XDG_SESSION_TYPE: 'x11', DISPLAY: ':2', DBUS_SESSION_BUS_ADDRESS: bus }, session: 'x11', candidate: 'x11-ewmh' },
    { name: 'todo 6 sway resulting environment', env: { XDG_CURRENT_DESKTOP: 'sway', XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-airi-qa-qa', SWAYSOCK: '/run/user/1000/airi-qa-display/qa/sway.sock', DBUS_SESSION_BUS_ADDRESS: bus }, session: 'wayland', candidate: 'sway' },
    { name: 'sway with Xwayland resulting environment', env: { XDG_CURRENT_DESKTOP: 'sway', XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-airi-qa-qa', SWAYSOCK: '/run/user/1000/airi-qa-display/qa/sway.sock', DISPLAY: ':2', DBUS_SESSION_BUS_ADDRESS: bus }, session: 'wayland', candidate: 'sway' },
  ])('$name', ({ env, session, candidate }) => {
    expect(detectLinuxDesktop(env)).toEqual({ session, candidate })
  })
})
