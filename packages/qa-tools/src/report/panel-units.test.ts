import type { ChannelClass } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

import type { ChannelRow, EmotionCell, TrajectoryBand } from './cells'

import { describe, expect, it } from 'vitest'

import { axisUnit, drawnOverlays, overlayKinds, overlayUnit } from './panel-units'
import { cellTrajectorySvg } from './trajectory-svg'

const channelOf: Record<ChannelClass, string> = { face: 'browMean', eyelid: 'eyelid', posture: 'angleY', modulation: 'blinkRate' }

function bandOf(times: number[], level: number): TrajectoryBand {
  return { times, mean: times.map(() => level), low: times.map(() => level - 0.01), high: times.map(() => level + 0.01), trials: 5 }
}

/** A row with every overlay populated, so the only reason not to draw one is its unit. */
function fullRow(cls: ChannelClass): ChannelRow {
  const channel = channelOf[cls]
  return {
    cls,
    nullQ: 0.05,
    trajectory: bandOf(Array.from({ length: 111 }, (_, i) => -1 + i / 10), 0.3),
    release: bandOf(Array.from({ length: 181 }, (_, i) => 4 + i / 30), 0.1),
    levels: null,
    result: {
      key: `happy:strong:${channel}`,
      verdict: 'pass',
      emotion: 'happy',
      band: 'strong',
      channel,
      E: 0.3,
      ci: [0.25, 0.35],
      expected: 0.3,
      residual: { late: 0.02, lateCi: [-0.01, 0.05] },
      failed: [],
      reasons: [],
    },
  }
}

const cell = (rows: ChannelRow[]): EmotionCell => ({ key: 'happy:strong', emotion: 'happy', band: 'strong', verdict: 'pass', channels: rows })

describe('panel units', () => {
  const classes: ChannelClass[] = ['face', 'eyelid', 'posture', 'modulation']

  it.each(classes)('%s panels draw only overlays whose unit is the axis unit', (cls) => {
    const drawn = drawnOverlays(fullRow(cls))
    expect(drawn.length).toBeGreaterThan(0)
    for (const kind of drawn)
      expect(overlayUnit(kind, cls), `${cls} ${kind}`).toBe(axisUnit(cls))
  })

  it('keeps the eyelid release data (ratio minus one) off the log-ratio axis, and nothing else', () => {
    expect(axisUnit('eyelid')).toBe('log-ratio')
    expect(drawnOverlays(fullRow('eyelid'))).toEqual(['effect', 'ci', 'expected', 'null', 'trajectory'])
    expect(drawnOverlays(fullRow('face'))).toEqual([...overlayKinds])
    expect(drawnOverlays(fullRow('posture'))).toEqual(['effect', 'ci', 'expected', 'null', 'trajectory'])
    expect(drawnOverlays(fullRow('modulation'))).toEqual(['effect', 'ci', 'expected'])
  })

  it('renders no late-window mark or release curve on an eyelid panel, and labels every axis with its unit', () => {
    const eyelid = cellTrajectorySvg(cell([fullRow('eyelid')]))
    expect(eyelid).not.toContain('class="effect late"')
    expect(eyelid).not.toContain('late-band')
    expect(eyelid).not.toContain('<polyline class="release"')
    expect(eyelid).toContain('<polyline class="traj"')
    expect(eyelid).toContain('log ratio</text>')

    const face = cellTrajectorySvg(cell([fullRow('face')]))
    expect(face).toContain('class="effect late"')
    expect(face).toContain('late-band')
    expect(face).toContain('<polyline class="release"')
    expect(face).toContain('half-range</text>')

    const modulation = cellTrajectorySvg(cell([fullRow('modulation')]))
    expect(modulation).not.toContain('class="effect late"')
    expect(modulation).not.toContain('<polyline class="traj"')
    expect(modulation).toContain('log ratio</text>')
  })
})
