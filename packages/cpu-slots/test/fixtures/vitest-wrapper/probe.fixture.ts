import process from 'node:process'

import { appendFileSync } from 'node:fs'

import { it } from 'vitest'

import { readStatus } from '../../../src/status'

/** Records the leases held while this test runs, as a worker of the vitest process under test sees them. */
it('probe', () => {
  const status = readStatus()
  appendFileSync(process.env.PROBE_OUT!, `${JSON.stringify({ leases: status.leases.length, held: status.held })}\n`)
})
