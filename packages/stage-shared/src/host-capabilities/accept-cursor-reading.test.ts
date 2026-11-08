import type { SignalStatus } from '.'

import { describe, expect, it } from 'vitest'

import { acceptCursorReading } from '.'

describe('acceptCursorReading', () => {
  it.each([
    { cursor: { kind: 'live' }, accepted: true },
    { cursor: { kind: 'degraded', reason: 'web-page-pointer-only' }, accepted: false },
    { cursor: { kind: 'unavailable', reason: 'wayland-cursor-unreported' }, accepted: false },
  ] satisfies Array<{ cursor: SignalStatus, accepted: boolean }>)(
    'accepts $cursor.kind: $accepted',
    ({ cursor, accepted }) => {
      expect(acceptCursorReading(cursor)).toBe(accepted)
    },
  )
})
