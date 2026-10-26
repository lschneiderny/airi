import type { MotionQaState } from '@proj-airi/stage-shared/motion-scenario'

import { describe, expect, it } from 'vitest'

import { parsePointerReceipt, parseVirtualScreenReceipt, planPointerSteps, pointerDesktopCommand, pointerScriptCommand, pointerSteps } from './pointer'

const steps = [
  { tMs: 2000, x: -200, y: 100, phase: 'move' as const },
  { tMs: 2500, x: -200, y: 100, phase: 'down' as const },
  { tMs: 2700, x: -200, y: 100, phase: 'up' as const },
]
const desktop = { x: -1920, y: 0, width: 3840, height: 1080 }
const receipt = { played: 3, maxTimingErrorMs: 3.2, x: -200, y: 100, foregroundPid: 42, foregroundName: 'electron', foregroundElevated: false, desktop }
const state: MotionQaState = { modelId: 'm', modelLoaded: true, driver: 'natural', cursorAttention: true, expressionEnabled: true, heldEmotions: true, naturalActive: true, hold: null, captureActive: false, head: { x: 100, y: 50, width: 80, height: 100 }, screen: { x: -1200, y: 20, devicePixelRatio: 1.5 }, screenAwareness: true, placement: null, placementYawBias: 0 }

describe('real pointer playback', () => {
  it('uses physical pixels with a negative monitor origin and head-width Y units', () => {
    expect(pointerSteps([{ kind: 'pointer', at: 2, phase: 'move', x: 0.25, y: -0.5 }], state)).toEqual([{ tMs: 2000, phase: 'move', x: -1560, y: 120 }])
    expect(() => pointerSteps([], { ...state, head: null })).toThrow(/pointer-head-unavailable/)
  })

  it('reads physical virtual-screen bounds without moving or releasing the pointer', () => {
    const script = pointerDesktopCommand('win32')!.args.at(-1)!
    expect(script).toContain('SetProcessDPIAware')
    for (const index of [76, 77, 78, 79])
      expect(script).toContain(`GetSystemMetrics(${index})`)
    expect(script).not.toContain('SetCursorPos')
    expect(script).not.toContain('mouse_event')
    expect(pointerDesktopCommand('linux')).toBeNull()
    expect(parseVirtualScreenReceipt(JSON.stringify(desktop))).toEqual(desktop)
    expect(() => parseVirtualScreenReceipt('garbage')).toThrow()
    expect(() => parseVirtualScreenReceipt(JSON.stringify({ ...desktop, width: 0 }))).toThrow()
  })

  it('retains a fitting path, including negative virtual-screen coordinates', () => {
    const events = [{ kind: 'pointer' as const, at: 2, phase: 'move' as const, x: 0.25, y: -0.5 }]
    expect(planPointerSteps(events, state, desktop)).toEqual({ steps: pointerSteps(events, state), mirrored: null })
  })

  it('mirrors a right-side approach and all later targets toward screen center without changing the scenario', () => {
    const corner: MotionQaState = { ...state, head: { x: 1700, y: 200, width: 100, height: 100 }, screen: { x: 0, y: 0, devicePixelRatio: 1 } }
    const events = [
      { kind: 'pointer' as const, at: 2, phase: 'move' as const, x: 8, y: 0 },
      { kind: 'pointer' as const, at: 4, phase: 'move' as const, x: 0.6, y: 0 },
      { kind: 'pointer' as const, at: 5, phase: 'move' as const, x: -0.4, y: 0 },
      { kind: 'pointer' as const, at: 6, phase: 'down' as const, x: 0.2, y: 1 },
      { kind: 'pointer' as const, at: 6.2, phase: 'up' as const, x: 0.2, y: 1 },
    ]
    const before = JSON.stringify(events)
    const planned = planPointerSteps(events, corner, { x: 0, y: 0, width: 1920, height: 1080 })
    expect(planned.mirrored).toBe('x')
    expect(planned.steps.map(step => step.x)).toEqual([950, 1690, 1790, 1730, 1730])
    expect(planned.steps.map(step => step.y)).toEqual([250, 250, 250, 350, 350])
    expect(planned.steps.map(step => step.tMs)).toEqual([2000, 4000, 5000, 6000, 6200])
    expect(JSON.stringify(events)).toBe(before)
  })

  it('can mirror a vertical approach toward screen center', () => {
    const bottom: MotionQaState = { ...state, head: { x: 300, y: 850, width: 100, height: 100 }, screen: { x: 0, y: 0, devicePixelRatio: 1 } }
    const planned = planPointerSteps([{ kind: 'pointer', at: 2, phase: 'move', x: 0, y: 8 }], bottom, { x: 0, y: 0, width: 1920, height: 1080 })
    expect(planned).toEqual({ mirrored: 'y', steps: [{ tMs: 2000, phase: 'move', x: 350, y: 100 }] })
  })

  it('rejects an approach that cannot fit from either side before input', () => {
    const large: MotionQaState = { ...state, head: { x: -55, y: 97, width: 585, height: 728 }, screen: { x: 735, y: 216, devicePixelRatio: 1 } }
    expect(() => planPointerSteps([{ kind: 'pointer', at: 2, phase: 'move', x: 8, y: 0 }], large, { x: 0, y: 0, width: 1920, height: 1080 })).toThrow(/pointer-path-outside-virtual-screen.*step #0.*bounds=/)
  })

  it('checks every later point and treats the right and bottom edges as exclusive', () => {
    const origin: MotionQaState = { ...state, head: { x: 0, y: 0, width: 100, height: 100 }, screen: { x: 0, y: 0, devicePixelRatio: 1 } }
    const first = { kind: 'pointer' as const, at: 2, phase: 'move' as const, x: 0, y: 0 }
    const bounds = { x: 0, y: 0, width: 100, height: 100 }
    expect(planPointerSteps([first, { ...first, at: 3, x: 0.49, y: 0.49 }], origin, bounds).mirrored).toBeNull()
    expect(() => planPointerSteps([first, { ...first, at: 3, x: 0.5 }], origin, bounds)).toThrow(/step #1/)
    expect(() => planPointerSteps([first, { ...first, at: 3, y: 0.5 }], origin, bounds)).toThrow(/step #1/)
  })

  it('builds sorted timed Windows moves and dwells before a press, always releasing on exit', () => {
    const built = pointerScriptCommand(steps, 123456, 'win32')!
    expect(built.command).toBe('powershell')
    const script = built.args.at(-1)!
    expect(script).toContain('Stopwatch')
    expect(script).toContain('123456')
    expect(script).toContain('2000,-200,100,0;2500,-200,100,1;2700,-200,100,2')
    expect(script).toContain('Wait-Time ($due - 100); Move-To $x $y')
    expect(script).toContain('$clock.Elapsed.TotalMilliseconds + 100')
    expect(script).toContain('mouse_event(2')
    expect(script).toContain('finally { [QaPointer]::mouse_event(4')
    expect(script).toContain('foregroundElevated')
    expect(script.indexOf('pointer-path-outside-virtual-screen')).toBeLessThan(script.indexOf('SetCursorPos'))
    expect(pointerScriptCommand(steps, 0, 'linux')).toBeNull()
  })

  it('refuses unsorted, nonfinite and injected inputs', () => {
    expect(() => pointerScriptCommand([...steps].reverse(), 0, 'win32')).toThrow(/Invalid pointer/)
    expect(() => pointerScriptCommand([{ ...steps[0], x: Number.NaN }], 0, 'win32')).toThrow(/Invalid pointer/)
    expect(() => pointerScriptCommand(steps, Number.POSITIVE_INFINITY, 'win32')).toThrow(/Invalid pointer/)
  })

  it('accepts only a complete, timely, read-back receipt', () => {
    expect(parsePointerReceipt(JSON.stringify(receipt), steps)).toEqual(receipt)
    expect(() => parsePointerReceipt(JSON.stringify({ ...receipt, played: 2 }), steps)).toThrow(/pointer-incomplete/)
    expect(() => parsePointerReceipt(JSON.stringify({ ...receipt, maxTimingErrorMs: 501 }), steps)).toThrow(/pointer-timing-error/)
    expect(() => parsePointerReceipt(JSON.stringify({ ...receipt, x: 0 }), steps)).toThrow(/pointer-final-position/)
    expect(() => parsePointerReceipt(JSON.stringify({ ...receipt, foregroundElevated: true }), steps)).toThrow(/pointer-foreground-elevated/)
  })

  it.each(['garbage', '', '{}', '{"played":"3"}', JSON.stringify({ ...receipt, maxTimingErrorMs: null })])('rejects malformed receipt %s', (text) => {
    expect(() => parsePointerReceipt(text, steps)).toThrow()
  })
})
