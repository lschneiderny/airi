import type { LinuxDesktopBackend } from '@proj-airi/stage-shared/host-capabilities'

export function detectLinuxDesktop(env: Readonly<Record<string, string | undefined>>): { session: 'x11' | 'wayland', candidate: LinuxDesktopBackend } {
  const session = env.XDG_SESSION_TYPE === 'x11' || (env.DISPLAY && !env.WAYLAND_DISPLAY) ? 'x11' : 'wayland'
  const desktop = env.XDG_CURRENT_DESKTOP?.toUpperCase() ?? ''
  // Compositor sockets identify the connected session even with inherited names.
  if (env.HYPRLAND_INSTANCE_SIGNATURE)
    return { session, candidate: 'hyprland' }
  if (env.SWAYSOCK)
    return { session, candidate: 'sway' }
  if (desktop.includes('KDE'))
    return { session, candidate: 'kwin' }
  if (desktop.includes('GNOME'))
    return { session, candidate: 'gnome' }
  return { session, candidate: session === 'x11' ? 'x11-ewmh' : 'none' }
}
