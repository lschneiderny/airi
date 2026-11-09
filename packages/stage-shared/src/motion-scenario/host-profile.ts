import type { MotionScenario } from './schema'

import { capabilitiesForHost } from '../host-capabilities'

/** Every input that a declared host cannot supply. Unprofiled scripts retain their explicit inputs. */
export function hostProfileViolations(scenario: Pick<MotionScenario, 'settings' | 'events'>): string[] {
  const host = scenario.settings?.host
  if (host === undefined)
    return []
  const { signals } = capabilitiesForHost(host)
  return scenario.events.flatMap((event, index) => {
    let reason: string | undefined
    switch (event.kind) {
      case 'cursor':
      case 'pointer':
        if (signals.cursorScreenPoint.kind === 'unavailable')
          reason = 'cursorScreenPoint is unavailable'
        break
      case 'placement':
        if (signals.windowOrigin.kind !== 'live')
          reason = 'windowOrigin is not live'
        break
      case 'mode':
        reason = 'mode must resolve from host inputs'
        break
    }
    return reason ? [`host-profile ${host}: events[${index}] ${event.kind}: ${reason}`] : []
  })
}
