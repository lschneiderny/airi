import { describe, expect, it } from 'vitest'

import { result } from '../metrics/result'
import { judgeMetrics } from './judge'
import { loadBands } from './load'

const bands = await loadBands(new URL('../../../../../', import.meta.url).pathname)

describe('nonfinite metric defence', () => {
  it.each([Number.NaN, Infinity, -Infinity])('fails a nonfinite gated value: %s', (value) => {
    const [metric] = judgeMetrics([result('period.rootForeAft.acfPeak', 'correlation', 'window', value)], bands.classes.idle)
    expect(metric).toMatchObject({ status: 'FAIL', value: null, detail: expect.stringContaining('undefined: nonfinite') })
  })

  it('fails a finite aggregate when a contributing sample is nonfinite', () => {
    const [metric] = judgeMetrics([result('period.rootForeAft.acfPeak', 'correlation', 'window', 0, 'ok', '', [{ start: 0, end: 600, value: Infinity }])], bands.classes.idle)
    expect(metric).toMatchObject({ status: 'FAIL', value: null, detail: expect.stringContaining('undefined: nonfinite') })
  })
})
