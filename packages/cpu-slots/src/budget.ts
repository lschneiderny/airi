import process from 'node:process'

import { totalmem } from 'node:os'

import { CpuSlotsError } from './errors'
import { sharedCeiling } from './grant'

const GIB = 2 ** 30
/** Memory one slot's workload uses. Vitest workers and vue-tsc processes measured 2.5 to 3.4 GiB each. */
const SLOT_MEMORY = 3 * GIB
/** Memory kept for the desktop and every process the broker does not schedule. */
const RESERVED_MEMORY = 10 * GIB

/** 12, lowered until the shared ceiling's slots fit in memory, so idle-CPU overshoot cannot exhaust RAM. */
function defaultBudget(memory: number): number {
  const fit = Math.floor((memory - RESERVED_MEMORY) / SLOT_MEMORY)
  let budget = 12
  while (budget > 1 && sharedCeiling(budget) > fit)
    budget--
  return budget
}

/** An explicit `AIRI_CPU_BUDGET` is used as given; only the default depends on the machine's memory. */
export function parseBudget(value: string | undefined = process.env.AIRI_CPU_BUDGET, memory = totalmem()): number {
  if (value === undefined)
    return defaultBudget(memory)

  const budget = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(budget) || budget <= 0)
    throw new CpuSlotsError('bad-budget')

  return budget
}
