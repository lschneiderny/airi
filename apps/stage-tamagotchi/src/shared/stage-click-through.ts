import type { SignalStatus } from '@proj-airi/stage-shared/host-capabilities'

import { HostReasons } from '@proj-airi/stage-shared/host-capabilities'

/**
 * Whether the desktop stage may capture the pointer over the character: forwarded click-through is live, or the
 * Linux desktop bridge emulates it from verified cursor and window positions.
 *
 * Only the desktop stage consumes emulated click-through. Other windows keep treating anything but `live` as
 * unavailable. A missing status (no snapshot yet) is unusable, so the stage starts ignoring the pointer.
 */
export function isStageClickThroughUsable(status: SignalStatus | null | undefined): boolean {
  if (status?.kind === 'live')
    return true
  return status?.kind === 'degraded' && status.reason === HostReasons.LinuxClickThroughEmulated
}
