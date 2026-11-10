import process from 'node:process'

import { readFileSync } from 'node:fs'

import { CpuSlotsError } from './errors'

export interface CpuPressure {
  readonly someAvg10: number
}

export interface PressureThresholds {
  readonly idle: number
  readonly hold: number
}

export const PRESSURE_IDLE = 20
export const PRESSURE_HOLD = 70

/** Parse configuration before entering a broker transaction; decide receives only data. */
export function parsePressureThresholds(): PressureThresholds {
  const values = [
    ['AIRI_CPU_PRESSURE_IDLE', PRESSURE_IDLE],
    ['AIRI_CPU_PRESSURE_HOLD', PRESSURE_HOLD],
  ] as const
  const [idle, hold] = values.map(([key, fallback]) => {
    const value = process.env[key]
    if (value === undefined)
      return fallback
    const threshold = Number(value)
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(threshold) || threshold < 0 || threshold > 100)
      throw new CpuSlotsError('bad-pressure-threshold', key)
    return threshold
  })
  return { idle, hold }
}

/** Missing or unreadable PSI is supported: scheduling then uses the configured slot budget. */
export function readCpuPressure(path = process.env.AIRI_CPU_PRESSURE_FILE ?? '/proc/pressure/cpu'): CpuPressure | undefined {
  if (process.platform !== 'linux' && process.env.AIRI_CPU_PRESSURE_FILE === undefined)
    return undefined
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  }
  catch (error) {
    if (error instanceof Error && 'code' in error)
      return undefined
    throw error
  }
  const match = /^some\s+avg10=(\d+(?:\.\d+)?)\s+avg60=\d+(?:\.\d+)?\s+avg300=\d+(?:\.\d+)?\s+total=\d+\s*$/m.exec(text)
  if (!match)
    return undefined
  const someAvg10 = Number(match[1])
  return Number.isFinite(someAvg10) && someAvg10 <= 100 ? { someAvg10 } : undefined
}
