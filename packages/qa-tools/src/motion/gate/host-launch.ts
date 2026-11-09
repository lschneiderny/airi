import type { HostId } from '@proj-airi/stage-shared/host-capabilities'

import process from 'node:process'

import { isWaylandSession } from '../../host/wayland-session'

/**
 * Match the runner session before taking a lease or starting Electron.
 * XWayland is an explicit launch choice within a Wayland desktop session.
 */
export function resolveT3HostLaunch(host: HostId | undefined, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform):
  { ok: true, script: 'dev' | 'dev:xwayland' } | { ok: false, message: string } {
  const wayland = isWaylandSession(env)
  const script = host === 'linux-xwayland' ? 'dev:xwayland' : 'dev'
  const detected = platform === 'win32'
    ? 'windows'
    : platform === 'darwin'
      ? 'macos'
      : platform === 'linux'
        ? wayland ? (script === 'dev:xwayland' ? 'linux-xwayland' : 'linux-wayland') : 'linux-x11'
        : platform
  if (host !== undefined && host !== detected)
    return { ok: false, message: `host-mismatch: --host ${host}, runner would launch ${detected}` }
  return { ok: true, script }
}
