import { createContext as createBroadcastChannelContext } from '@moeru/eventa/adapters/broadcast-channel'

/**
 * BroadcastChannel name of the devtools inspector bus. Devtools pages in any window read the leader window through it.
 *
 * Use it instead of synced actions for read-only polling: pinia-plugin-synced keeps every action result in the
 * shared domain state until its call timeout, while an Eventa invoke leaves nothing behind.
 */
export const DEVTOOLS_BUS_CHANNEL_NAME = 'proj-airi:devtools:inspector'

/** How long a devtools page waits for the leader before it reports that no window answered. */
export const DEVTOOLS_INSPECT_TIMEOUT_MS = 5_000

let context: ReturnType<typeof createBroadcastChannelContext>['context'] | undefined

/** Returns this window's context on the devtools inspector bus. */
export function getDevtoolsBusContext() {
  context ??= createBroadcastChannelContext(new BroadcastChannel(DEVTOOLS_BUS_CHANNEL_NAME)).context
  return context
}
