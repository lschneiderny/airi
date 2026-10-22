import process from 'node:process'

import { parseBudget } from '../../src/budget'
import { Store } from '../../src/store'

// Holds the broker lock in 300 ms bursts so another process's store writes meet a busy lock.
const store = new Store({ root: process.env.AIRI_CPU_SLOTS_DIR!, budget: parseBudget() })
let announced = false
for (;;) {
  try {
    store.transact(() => {
      if (!announced) {
        announced = true
        process.stdout.write('HAMMER-READY\n')
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)
    })
  }
  catch {}
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150)
}
