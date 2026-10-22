/* eslint-disable antfu/no-top-level-await -- standalone fixture script */
import type { Buffer } from 'node:buffer'

import process from 'node:process'

import { spawn } from 'node:child_process'

import { acquire } from '../../src/acquire'

const lease = await acquire({ class: 'test', min: 6, max: 6, command: 'coordinator fixture', cwd: process.cwd() })
const marker = process.cwd()
const descendant = process.argv.includes('descendant')
const script = descendant
  ? `const {spawn}=require('node:child_process');const d=spawn(process.execPath,['-e',"process.stdout.write('D-RUN '+process.pid+'\\\\n');setInterval(()=>{},1000)",${JSON.stringify(marker)}],{detached:true,stdio:['ignore','pipe','inherit']});d.stdout.on('data',data=>{process.stdout.write(data);process.stdout.write('W-EXIT\\n');process.exit(0)})`
  : `process.stdout.write('W-RUN '+process.pid+'\\n');setInterval(()=>{},1000)`
const work = spawn(process.execPath, ['-e', script, marker], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] })
if (work.pid)
  lease.addWorkload(work.pid)
work.stdout.on('data', (data: Buffer) => {
  process.stdout.write(data)
  if (!descendant) {
    process.stdout.write('COORD-EXIT\n')
    process.exit(0)
  }
})
work.once('exit', () => {
  process.stdout.write('COORD-EXIT\n')
  process.exit(0)
})
