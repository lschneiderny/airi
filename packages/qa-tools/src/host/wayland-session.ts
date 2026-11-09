/** Whether the environment describes a Wayland desktop session; XWayland clients inside it still count. */
export function isWaylandSession(env: Readonly<Record<string, string | undefined>>): boolean {
  return Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland'
}
