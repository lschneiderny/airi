import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { Plugin } from 'vue'

import { injectKeyPiniaSynced } from '../libs/pinia/synced-context'

/**
 * Provides a synchronization runtime to a mounted test app, in which this context is the only participant and leads.
 * Use it for a component that reads the runtime with `usePiniaSynced`, such as the Stage, when the test does not
 * exercise synchronization. It installs no Pinia plugin, so every store action runs locally.
 */
export function createSyncedContextPlugin(): Plugin {
  const runtime: SyncedPiniaRuntime = {
    addRole: () => () => {},
    dispose: () => {},
    getLeaderId: () => 'test',
    getParticipantCount: () => 1,
    getParticipants: () => [{ id: 'test', roles: [] }],
    getRoles: () => [],
    isLeader: () => true,
    onCoordinationChange: () => () => {},
    onLeadershipChange: () => () => {},
    participantId: 'test',
    plugin: () => {},
  }
  return { install: app => void app.provide(injectKeyPiniaSynced, runtime) }
}
