import process from 'node:process'

import { execFileSync } from 'node:child_process'

/** Why the host's power state slows the app below its plugged-in speed, which makes a bench run invalid. */
export type PowerLimit = 'on-battery' | 'low-power-mode'

/**
 * Reads `pmset -g batt` and `pmset -g`. A Mac without a battery reports AC power. Low Power Mode is `lowpowermode 1`,
 * or `powermode 1` on a Mac with High Power Mode; an older macOS may print neither.
 */
export function parsePowerLimit(batt: string, settings: string): PowerLimit | null {
  if (batt.includes('Now drawing from \'Battery Power\''))
    return 'on-battery'
  if (/^\s*(?:low)?powermode\s+1\b/m.test(settings))
    return 'low-power-mode'
  return null
}

/**
 * The macOS power limit at this moment, or null. Other platforms are not read: the Linux bench host is a desktop.
 * @throws when `pmset` fails, because an unknown power state must not pass as plugged in.
 */
export function readPowerLimit(): PowerLimit | null {
  if (process.platform !== 'darwin')
    return null
  const pmset = (args: string[]) => execFileSync('pmset', args, { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] })
  return parsePowerLimit(pmset(['-g', 'batt']), pmset(['-g']))
}
