import type { KwinMessage } from '../../apps/stage-tamagotchi/src/main/services/linux-desktop/backends/kwin/protocol'

export interface KwinProbeArgs {
  seconds: number
  cursor: boolean
  bus?: string
}

export const kwinProbeUsage = `Usage: pnpm qa:display run [--name <session>] -- pnpm qa:kwin-probe [--seconds N] [--cursor]
       pnpm qa:kwin-probe --bus <address> [--seconds N] [--cursor]

Loads the AIRI KWin bridge into a QA session's KWin, prints one JSON line per
message for N seconds (default 10, at most 3600), then unloads the scripts and
checks that KWin no longer has them. --cursor also streams the pointer position.
Without --bus it runs only inside a running qa:display session, never on the
inherited desktop session bus (see the host session guard in qa-display-guard.ts).`

export interface KwinProbeBusInput {
  /** The `--bus` address, an explicit choice by the caller. */
  explicitBus?: string
  /** The inherited `DBUS_SESSION_BUS_ADDRESS`, used only after the host session guard accepted the environment. */
  inheritedBus?: string
}

/**
 * Picks the bus the probe loads KWin scripts on: the explicit `--bus`, else the inherited bus. The caller runs
 * `assertQaDisplaySession` first when there is no `--bus`, so the inherited bus is the qa:display session's own.
 */
export function selectKwinProbeBus(input: KwinProbeBusInput): { address: string } | { error: string } {
  if (input.explicitBus)
    return { address: input.explicitBus }
  if (input.inheritedBus)
    return { address: input.inheritedBus }
  return { error: 'no session bus: DBUS_SESSION_BUS_ADDRESS is not set. Run it inside a QA session with `pnpm qa:display run -- pnpm qa:kwin-probe`, or pass --bus <address>.' }
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

/** Window captions (the active window and every own window) can hold private text, so the probe prints only their length. */
export function formatKwinProbeLine(message: KwinMessage): string {
  if (message.method === 'Active' && message.payload) {
    const { caption, ...rest } = message.payload
    return JSON.stringify({ method: 'Active', payload: { captionLength: caption.length, ...rest } })
  }
  if (message.method === 'OwnWindows') {
    return JSON.stringify({
      method: 'OwnWindows',
      payload: message.payload.map(({ caption, ...rest }) => ({ ...rest, captionLength: caption.length })),
    })
  }
  return JSON.stringify(message)
}
