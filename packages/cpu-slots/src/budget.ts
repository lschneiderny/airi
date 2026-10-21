import process from 'node:process'

import { CpuSlotsError } from './errors'

export function parseBudget(value: string | undefined = process.env.AIRI_CPU_BUDGET): number {
  if (value === undefined)
    return 12

  const budget = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(budget) || budget <= 0)
    throw new CpuSlotsError('bad-budget')

  return budget
}
