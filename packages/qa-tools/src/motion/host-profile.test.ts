import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'

import { NaturalMotion } from '@proj-airi/motion-driver-natural/natural-motion'
import { naturalIdleLivelinessGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runIdleTrace } from './gate/trials'
import { runT1 } from './t1/runner'

const scenario: MotionScenario = { version: 1, id: 'profile', seed: 1, durationSeconds: 80, levels: ['t1'], events: [] }

afterEach(() => vi.restoreAllMocks())

describe('host-profile simulation', () => {
  it.each([
    { kind: 'cursor', at: 1, x: 1, y: 1 },
    { kind: 'pointer', at: 1, phase: 'move', x: 1, y: 1 },
    { kind: 'placement', at: 1, inward: 1 },
    { kind: 'mode', at: 1, mode: 'watching' },
  ] satisfies MotionScenario['events'])('refuses $kind before executing the sink', (event) => {
    expect(() => runT1({ ...scenario, settings: { host: 'linux-wayland' }, events: [event] })).toThrow(event.kind)
  })

  it('keeps Wayland Natural inputs idle with no cursor or placement throughout', () => {
    const performance = vi.spyOn(NaturalMotion.prototype, 'setPerformance')
    const cursor = vi.spyOn(NaturalMotion.prototype, 'setCursor')
    const placement = vi.spyOn(NaturalMotion.prototype, 'setPlacement')
    const trace = runT1({ ...scenario, settings: { host: 'linux-wayland' } })

    expect(trace.t.at(-1)).toBeGreaterThan(79)
    expect(new Set(performance.mock.calls.map(([state]) => state.mode))).toEqual(new Set(['idle']))
    expect(new Set(cursor.mock.calls.map(([point]) => point))).toEqual(new Set([null]))
    // Placement starts null in the adapter and is forwarded only on change.
    expect(placement).not.toHaveBeenCalled()
  })

  it.each(['cursor', 'pointer'] as const)('resolves Windows idle, watching, idle around the %s event at 60 s', (kind) => {
    const performance = vi.spyOn(NaturalMotion.prototype, 'setPerformance')
    const event: MotionScenario['events'][number] = kind === 'cursor'
      ? { kind, at: 60, x: 1, y: 0 }
      : { kind, at: 60, phase: 'move', x: 1, y: 0 }
    runT1({ ...scenario, settings: { host: 'windows' }, events: [event] })
    const modes = (start: number, end: number) => new Set(performance.mock.calls.filter(([, , time]) => time >= start && time < end).map(([state]) => state.mode))

    expect(modes(0, 10)).toEqual(new Set(['watching']))
    expect(modes(10, 60)).toEqual(new Set(['idle']))
    expect(modes(60, 70)).toEqual(new Set(['watching']))
    expect(modes(70, 80)).toEqual(new Set(['idle']))
  })

  it('fails a liveliness scored window that leaves idle, but permits warm-up activity', () => {
    const input: MotionScenario = { ...scenario, settings: { host: 'windows' }, events: [{ kind: 'cursor', at: 60, x: 1, y: 0 }] }
    expect(() => runT1(input, { idleAfterSeconds: 10 })).toThrow(/mode-left-idle.*60/)
    expect(() => runT1({ ...input, events: [] }, { idleAfterSeconds: 10 })).not.toThrow()
  })

  it('passes the declared profile and scored-window guard through idle trials', () => {
    const performance = vi.spyOn(NaturalMotion.prototype, 'setPerformance')
    const gate = { ...naturalIdleLivelinessGate, warmUpSeconds: 12, scoredSeconds: 1 }
    runIdleTrace(1, gate, 30_000, undefined, 'windows')
    expect(new Set(performance.mock.calls.filter(([, , time]) => time < 10).map(([state]) => state.mode))).toEqual(new Set(['watching']))
    expect(() => runIdleTrace(1, gate, 30_000, (input, options) => runT1({
      ...input,
      events: [{ kind: 'pointer', at: 12, phase: 'move', x: 1, y: 0 }],
    }, options), 'windows')).toThrow(/mode-left-idle.*12/)
  })
})
