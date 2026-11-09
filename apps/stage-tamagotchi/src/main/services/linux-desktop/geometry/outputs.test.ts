import { describe, expect, it } from 'vitest'

import { mapDisplaysToOutputs } from './outputs'

function display(id: number, x: number, y: number, width: number, height: number, scaleFactor = 1, inset = 0) {
  return {
    id,
    scaleFactor,
    bounds: { x, y, width, height },
    workArea: { x, y: y + inset, width, height: height - inset },
  }
}

describe('mapDisplaysToOutputs', () => {
  it('replaces each origin with its output origin and moves the work area by the same offset', () => {
    const displays = [display(1, 0, 0, 1920, 1080, 1, 32), display(2, 1920, 0, 1280, 720, 1.5)]
    const outputs = [
      { name: 'DP-1', x: 0, y: 360, width: 1920, height: 1080, scale: 1 },
      { name: 'HDMI-A-1', x: 1920, y: 0, width: 1280, height: 720, scale: 1.5 },
    ]
    expect(mapDisplaysToOutputs(displays, outputs)).toEqual([
      { id: 1, scaleFactor: 1, bounds: { x: 0, y: 360, width: 1920, height: 1080 }, workArea: { x: 0, y: 392, width: 1920, height: 1048 } },
      { id: 2, scaleFactor: 1.5, bounds: { x: 1920, y: 0, width: 1280, height: 720 }, workArea: { x: 1920, y: 0, width: 1280, height: 720 } },
    ])
  })

  it('matches by size and scale, not by list order', () => {
    const displays = [display(1, 0, 0, 1280, 720, 2), display(2, 640, 0, 1920, 1080)]
    const outputs = [
      { name: 'big', x: 1280, y: 0, width: 1920, height: 1080, scale: 1 },
      { name: 'small', x: 0, y: 0, width: 1280, height: 720, scale: 2 },
    ]
    expect(mapDisplaysToOutputs(displays, outputs)?.map(d => d.bounds)).toEqual([
      { x: 0, y: 0, width: 1280, height: 720 },
      { x: 1280, y: 0, width: 1920, height: 1080 },
    ])
  })

  it('pairs identical outputs in positional order', () => {
    const displays = [display(2, 1920, 0, 1920, 1080), display(1, 0, 0, 1920, 1080)]
    const outputs = [
      { name: 'right', x: 1920, y: 100, width: 1920, height: 1080, scale: 1 },
      { name: 'left', x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
    ]
    expect(mapDisplaysToOutputs(displays, outputs)?.map(d => [d.id, d.bounds.x, d.bounds.y])).toEqual([[2, 1920, 100], [1, 0, 0]])
  })

  it('tolerates one pixel of fractional rounding and a small scale difference', () => {
    const mapped = mapDisplaysToOutputs([display(1, 0, 0, 2048, 1152, 1.25)], [{ name: 'eDP-1', x: 5, y: 6, width: 2049, height: 1151, scale: 1.2501 }])
    expect(mapped?.[0]?.bounds).toEqual({ x: 5, y: 6, width: 2048, height: 1152 })
  })

  it.each([
    ['no outputs', [display(1, 0, 0, 1920, 1080)], []],
    ['no displays', [], [{ name: 'DP-1', x: 0, y: 0, width: 1920, height: 1080, scale: 1 }]],
    ['a count difference', [display(1, 0, 0, 1920, 1080)], [
      { name: 'DP-1', x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      { name: 'DP-2', x: 1920, y: 0, width: 1920, height: 1080, scale: 1 },
    ]],
    ['a size difference', [display(1, 0, 0, 1920, 1080)], [{ name: 'DP-1', x: 0, y: 0, width: 1918, height: 1080, scale: 1 }]],
    ['a scale difference', [display(1, 0, 0, 1920, 1080, 1)], [{ name: 'DP-1', x: 0, y: 0, width: 1920, height: 1080, scale: 2 }]],
  ] as const)('returns null for %s, so no display mixes Electron and bridge origins', (_name, displays, outputs) => {
    expect(mapDisplaysToOutputs(displays, outputs)).toBeNull()
  })
})
