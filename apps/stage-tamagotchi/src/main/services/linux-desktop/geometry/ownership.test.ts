import { describe, expect, it } from 'vitest'

import { coordinateOwners } from './ownership'

const electron = { cursor: 'electron', windowRect: 'electron', displays: 'electron' }

describe('coordinateOwners', () => {
  it.each([
    ['x11-ewmh', 'linux-x11', electron],
    ['x11-ewmh', 'linux-xwayland', electron],
    ['x11-ewmh', 'linux-wayland', electron],
    ['gnome', 'linux-xwayland', electron],
    ['gnome', 'linux-wayland', electron],
    ['none', 'linux-x11', electron],
    ['none', 'linux-wayland', electron],
    ['kwin', 'linux-xwayland', { cursor: 'bridge', windowRect: 'electron', displays: 'electron' }],
    ['kwin', 'linux-wayland', { cursor: 'bridge', windowRect: 'bridge', displays: 'bridge' }],
    ['sway', 'linux-xwayland', { cursor: 'none', windowRect: 'electron', displays: 'electron' }],
    ['sway', 'linux-wayland', { cursor: 'none', windowRect: 'bridge', displays: 'bridge' }],
    ['hyprland', 'linux-xwayland', { cursor: 'bridge', windowRect: 'electron', displays: 'electron' }],
    ['hyprland', 'linux-wayland', { cursor: 'bridge', windowRect: 'bridge', displays: 'bridge' }],
  ] as const)('gives %s on %s its ownership row', (backend, host, owners) => {
    expect(coordinateOwners(host, backend)).toEqual(owners)
  })

  it.each(['kwin', 'sway', 'hyprland'] as const)('leaves a native X11 session with %s to Electron', (backend) => {
    expect(coordinateOwners('linux-x11', backend)).toEqual(electron)
  })

  it.each(['windows', 'macos', 'web', 'linux-x11', 'linux-xwayland', 'linux-wayland'] as const)('uses Electron on %s without a ready bridge', (host) => {
    expect(coordinateOwners(host, null)).toEqual(electron)
  })

  it.each(['windows', 'macos', 'web'] as const)('never gives a non-Linux host a bridge owner, even with a backend', (host) => {
    expect(coordinateOwners(host, 'kwin')).toEqual(electron)
  })
})
