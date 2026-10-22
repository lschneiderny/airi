/* eslint-disable antfu/no-top-level-await -- standalone fixture script */
import process from 'node:process'

import { acquire } from '../../src/acquire'
import { classes } from '../../src/classes'

const requested = process.argv[2] ?? 'test'
if (!Object.hasOwn(classes, requested))
  throw new Error('unknown class')
const lease = await acquire({ class: requested as keyof typeof classes, command: 'holder fixture', cwd: process.cwd() })
process.stdout.write(`GRANTED ${lease.grant} ${lease.id} ${lease.seq}\n`)
process.stdin.once('data', () => {
  lease.release()
  process.stdout.write('RELEASED\n')
  process.exit(0)
})
process.stdin.resume()
