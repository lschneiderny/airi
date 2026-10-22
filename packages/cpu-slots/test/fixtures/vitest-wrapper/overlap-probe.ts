import process from 'node:process'

import { appendFileSync } from 'node:fs'

import { it } from 'vitest'

import { readStatus } from '../../../src/status'

/** Records when this file ran and the leases held meanwhile; the overlap of the intervals is the concurrency. */
export function registerOverlapProbe() {
  it('probe', async () => {
    const start = Date.now()
    const { leases, held } = readStatus()
    await new Promise(resolve => setTimeout(resolve, 400))
    appendFileSync(process.env.PROBE_OUT!, `${JSON.stringify({ start, end: Date.now(), leases: leases.length, held })}\n`)
  })
}
