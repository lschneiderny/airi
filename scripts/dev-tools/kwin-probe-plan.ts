import type { KwinMessage } from '../../apps/stage-tamagotchi/src/main/services/linux-desktop/backends/kwin/protocol'

import { namePattern } from './qa-display-plan'

export interface KwinProbeArgs {
  seconds: number
  cursor: boolean
  bus?: string
}

/** Set by `pnpm qa:display run` to the session name; the probe trusts it only after checking the session. */
export const qaSessionMarker = 'AIRI_QA_DISPLAY_SESSION'

export const kwinProbeUsage = `Usage: pnpm qa:display run [--name <session>] -- pnpm qa:kwin-probe [--seconds N] [--cursor]
       pnpm qa:kwin-probe --bus <address> [--seconds N] [--cursor]

Loads the AIRI KWin bridge into a QA session's KWin, prints one JSON line per
message for N seconds (default 10, at most 3600), then unloads the scripts and
checks that KWin no longer has them. --cursor also streams the pointer position.
Without --bus it runs only inside a running qa:display session, never on the
inherited desktop session bus.`

export interface KwinProbeBusInput {
  /** The `--bus` address, an explicit choice by the caller. */
  explicitBus?: string
  /** The value of `AIRI_QA_DISPLAY_SESSION`. */
  marker?: string
  /** The inherited `DBUS_SESSION_BUS_ADDRESS`. */
  inheritedBus?: string
  /** The bus address of the named qa:display session, or null when that session is not running. */
  sessionBus: (name: string) => string | null
}

const isolationHint = 'Run it inside a QA session with `pnpm qa:display run -- pnpm qa:kwin-probe`, or pass --bus <address>.'

/**
 * Picks the bus the probe may load KWin scripts on. The bridge reads the active window as soon as it loads, so an
 * inherited bus is accepted only when it is the bus of the running qa:display session the marker names.
 */
export function selectKwinProbeBus(input: KwinProbeBusInput): { address: string } | { error: string } {
  if (input.explicitBus)
    return { address: input.explicitBus }
  if (!input.marker)
    return { error: `refusing the inherited session bus: ${qaSessionMarker} is not set. ${isolationHint}` }
  if (!namePattern.test(input.marker))
    return { error: `refusing the inherited session bus: ${qaSessionMarker}="${input.marker}" is not a qa:display session name. ${isolationHint}` }
  const sessionBus = input.sessionBus(input.marker)
  if (!sessionBus)
    return { error: `refusing the inherited session bus: qa:display session "${input.marker}" is not running. ${isolationHint}` }
  if (sessionBus !== input.inheritedBus)
    return { error: `refusing the inherited session bus: DBUS_SESSION_BUS_ADDRESS is not the bus of qa:display session "${input.marker}". ${isolationHint}` }
  return { address: sessionBus }
}

export function parseKwinProbeArgs(argv: readonly string[]): KwinProbeArgs | { error: string } {
  const args: KwinProbeArgs = { seconds: 10, cursor: false }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--cursor') {
      args.cursor = true
    }
    else if (flag === '--bus') {
      const value = argv[++index]
      if (!value)
        return { error: '--bus needs an address' }
      args.bus = value
    }
    else if (flag === '--seconds') {
      const value = argv[++index]
      if (value === undefined)
        return { error: '--seconds needs a value' }
      if (!/^\d{1,4}$/.test(value) || Number(value) < 1 || Number(value) > 3600)
        return { error: '--seconds must be a whole number from 1 to 3600' }
      args.seconds = Number(value)
    }
    else {
      return { error: `unknown argument "${flag}"` }
    }
  }
  return args
}

/** Window captions can hold private text, so the probe prints only their length. */
export function formatKwinProbeLine(message: KwinMessage): string {
  if (message.method === 'Active' && message.payload) {
    const { caption, ...rest } = message.payload
    return JSON.stringify({ method: 'Active', payload: { captionLength: caption.length, ...rest } })
  }
  return JSON.stringify(message)
}
