import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { capabilitiesForHost, HOST_REASONS } from '.'
import { MotionQaStateSchema } from '../motion-scenario/bridge'

const schema = MotionQaStateSchema.entries.host

describe('host capability wire schema', () => {
  it.each(['kwin', 'x11-ewmh', 'sway', 'hyprland', 'gnome', 'none', null])('accepts backend %s', (linuxDesktopBackend) => {
    expect(safeParse(schema, { ...capabilitiesForHost('linux-wayland'), linuxDesktopBackend }).success).toBe(true)
  })

  it.each(HOST_REASONS)('accepts stable reason %s', (reason) => {
    const caps = capabilitiesForHost('linux-wayland')
    expect(safeParse(schema, { ...caps, signals: { ...caps.signals, foregroundWindow: { kind: 'unavailable', reason } } }).success).toBe(true)
  })

  it.each([
    { linuxDesktopBackend: 'unknown-compositor' },
    { signals: { ...capabilitiesForHost('linux-wayland').signals, foregroundWindow: { kind: 'unavailable', reason: 'unknown-reason' } } },
    { unexpected: true },
  ])('rejects malformed capability fields %j', (patch) => {
    expect(safeParse(schema, { ...capabilitiesForHost('linux-wayland'), ...patch }).success).toBe(false)
  })
})
