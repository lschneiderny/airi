/* eslint-disable antfu/no-top-level-await -- standalone fixture script */
import process from 'node:process'

import { acquire } from '../../src/acquire'

const lease = await acquire({ class: 'test', command: 'holder fixture', cwd: process.cwd() })
process.stdout.write(`GRANTED ${lease.grant}\n`)
process.stdin.once('data', () => {
  lease.release()
  process.stdout.write('RELEASED\n')
  process.exit(0)
})
process.stdin.resume()
