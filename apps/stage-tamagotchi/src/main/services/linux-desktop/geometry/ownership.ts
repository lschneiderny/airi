import type { HostId, LinuxDesktopBackend } from '@proj-airi/stage-shared/host-capabilities'

/** `none` means no source may be read: the backend proves this signal cannot be reported. */
export type CursorOwner = 'electron' | 'bridge' | 'none'

export interface CoordinateOwners {
  readonly cursor: CursorOwner
  readonly windowRect: 'electron' | 'bridge'
  readonly displays: 'electron' | 'bridge'
}

const electronOwned: CoordinateOwners = { cursor: 'electron', windowRect: 'electron', displays: 'electron' }

/**
 * The one source each coordinate reading comes from, per backend and session.
 *
 * `backend` is `null` without a ready bridge. Only the returned owner may be
 * read, so Electron and compositor coordinates never meet in one computation.
 * Native X11 keeps Electron's window rectangles and displays because its
 * origins are already global, but its cursor comes from the X server through
 * the EWMH backend: Electron's X11 cursor is a cache that only events on its
 * own windows refresh. XWayland gains only the compositor cursor; native
 * Wayland takes the cursor, window rectangles and display origins from the
 * compositor.
 */
export function coordinateOwners(host: HostId, backend: LinuxDesktopBackend | null): CoordinateOwners {
  if (host === 'linux-x11' && backend === 'x11-ewmh')
    return { cursor: 'bridge', windowRect: 'electron', displays: 'electron' }
  if (backend === null || (host !== 'linux-xwayland' && host !== 'linux-wayland'))
    return electronOwned
  const space = host === 'linux-wayland' ? 'bridge' : 'electron'
  switch (backend) {
    case 'kwin':
    case 'hyprland':
      return { cursor: 'bridge', windowRect: space, displays: space }
    case 'sway':
      return { cursor: 'none', windowRect: space, displays: space }
    case 'x11-ewmh':
    case 'gnome':
    case 'none':
      return electronOwned
  }
}
