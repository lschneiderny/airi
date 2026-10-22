/* eslint-disable antfu/no-top-level-await -- standalone fixture script */
import process from 'node:process'

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { acquire } from '../../src/acquire'

// Simulates work that escapes its coordinator (a detached suite): it is not in the coordinator's job.
const lease = await acquire({ class: 'test', min: 6, max: 6, command: 'escaper fixture', cwd: process.cwd() })
const work = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', process.cwd()], { detached: true, stdio: 'ignore' })
work.unref()
lease.addWorkload(work.pid!)
const file = join(process.env.AIRI_CPU_SLOTS_DIR!, 'leases', `${lease.id}.json`)
// Registration is queued behind a possibly busy lock; announce only once the lease lists the workload.
const deadline = Date.now() + 20_000
while (Date.now() < deadline) {
  try {
    if (JSON.parse(readFileSync(file, 'utf8')).workload.length)
      break
  }
  catch {}
  await new Promise(resolve => setTimeout(resolve, 20))
}
if (Date.now() >= deadline)
  process.exit(1)
process.stdout.write(`W-RUN ${work.pid}\n`)
setInterval(() => {}, 1000)
