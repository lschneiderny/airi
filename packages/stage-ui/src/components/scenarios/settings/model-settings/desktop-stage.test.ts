import { describe, expect, it } from 'vitest'

import { desktopStageNeedsRelaunch } from './desktop-stage'

describe('desktopStageNeedsRelaunch', () => {
  it.each([
    { running: 'window', next: 'window', expected: false },
    { running: 'window', next: 'desktop', expected: true },
    { running: 'desktop', next: 'window', expected: true },
    { running: 'desktop', next: 'desktop', expected: false },
  ] as const)('requires a relaunch from $running to $next: $expected', ({ running, next, expected }) => {
    expect(desktopStageNeedsRelaunch({ running, next })).toBe(expected)
  })
})
