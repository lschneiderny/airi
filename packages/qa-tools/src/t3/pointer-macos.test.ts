import { describe, expect, it } from 'vitest'

import { dragSteps, macPointerCommand, moveSteps, parseMacPointerProbe, parseMacPointerReceipt, pressSteps, releaseSteps, warpSteps } from './pointer-macos'

describe('macOS pointer commands', () => {
  it('runs the helper isolated and sends the step table as JSON on stdin', () => {
    const built = macPointerCommand('play', warpSteps({ x: 10, y: 20 }))

    expect(built.command).toBe('python3')
    expect(built.args[0]).toBe('-I')
    expect(built.args[1]).toMatch(/scripts\/macos\/mac-pointer\.py$/)
    expect(built.args[2]).toBe('play')
    expect(JSON.parse(built.input)).toEqual({ steps: [{ atMs: 0, action: 'warp', x: 10, y: 20 }] })
  })

  it('sends no input to the probe', () => {
    expect(macPointerCommand('probe')).toMatchObject({ args: [expect.any(String), expect.any(String), 'probe'], input: '' })
  })

  it('builds move, press, and release rows', () => {
    expect(moveSteps({ x: 1, y: 2 })).toEqual([{ atMs: 0, action: 'move', x: 1, y: 2 }])
    expect(pressSteps({ x: 1, y: 2 }, 120)).toEqual([{ atMs: 0, action: 'move', x: 1, y: 2 }, { atMs: 120, action: 'down', x: 1, y: 2 }])
    expect(releaseSteps({ x: 1, y: 2 })).toEqual([{ atMs: 0, action: 'up', x: 1, y: 2 }])
  })

  it('builds a drag as a press, evenly spaced rounded moves, and a release at the end point', () => {
    const steps = dragSteps({ x: 0, y: 0 }, { x: 100, y: 15 }, { durationMs: 300, moves: 2, dwellMs: 50 })

    expect(steps).toEqual([
      { atMs: 0, action: 'move', x: 0, y: 0 },
      { atMs: 50, action: 'down', x: 0, y: 0 },
      { atMs: 150, action: 'move', x: 33, y: 5 },
      { atMs: 250, action: 'move', x: 67, y: 10 },
      { atMs: 350, action: 'move', x: 100, y: 15 },
      { atMs: 350, action: 'up', x: 100, y: 15 },
    ])
  })

  it('rejects fractional coordinates and a drag without moves', () => {
    expect(() => warpSteps({ x: 1.5, y: 2 })).toThrow('integers')
    expect(() => dragSteps({ x: 0, y: 0 }, { x: 1, y: 1 }, { durationMs: 100, moves: 0 })).toThrow('at least one')
  })
})

describe('macOS pointer helper output', () => {
  it('parses a probe with and without post-event access', () => {
    expect(parseMacPointerProbe('{"ok":true,"warp":true,"postEvents":true,"responsibleApp":null,"missing":[],"screen":{"width":1440,"height":900}}').screen).toEqual({ width: 1440, height: 900 })
    expect(parseMacPointerProbe('{"ok":false,"warp":true,"postEvents":false,"responsibleApp":"com.example.terminal","missing":["post-event access"]}').responsibleApp).toBe('com.example.terminal')
  })

  it('parses a play receipt and rejects malformed output', () => {
    expect(parseMacPointerReceipt('{"played":2,"maxTimingErrorMs":1.2,"x":10,"y":20,"screen":{"width":1440,"height":900}}')).toMatchObject({ played: 2, x: 10, y: 20 })
    expect(() => parseMacPointerReceipt('{"played":2}')).toThrow()
    expect(() => parseMacPointerProbe('garbage')).toThrow()
  })
})
