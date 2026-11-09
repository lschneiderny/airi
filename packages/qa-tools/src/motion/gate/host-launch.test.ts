import { describe, expect, it } from 'vitest'

import { resolveT3HostLaunch } from './host-launch'

describe('t3 host launch contract', () => {
  it('launches XWayland with dev:xwayland on a Wayland runner', () => {
    expect(resolveT3HostLaunch('linux-xwayland', { WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toEqual({ ok: true, script: 'dev:xwayland' })
  })

  it('refuses XWayland on an X11 runner rather than mislabelling a capture', () => {
    expect(resolveT3HostLaunch('linux-xwayland', { XDG_SESSION_TYPE: 'x11' }, 'linux')).toMatchObject({ ok: false, message: expect.stringContaining('host-mismatch') })
  })

  it.each([
    ['windows', 'win32', {}],
    ['macos', 'darwin', {}],
    ['linux-x11', 'linux', { XDG_SESSION_TYPE: 'x11' }],
    ['linux-wayland', 'linux', { XDG_SESSION_TYPE: 'wayland' }],
  ] as const)('uses dev for matching %s', (host, platform, env) => {
    expect(resolveT3HostLaunch(host, env, platform)).toEqual({ ok: true, script: 'dev' })
  })
})
