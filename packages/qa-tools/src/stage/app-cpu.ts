import { CdpClient, waitForRemoteDebug } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import * as v from 'valibot'

const processInfoResponse = v.object({
  result: v.object({ processInfo: v.array(v.object({ cpuTime: v.number() })) }),
})

/** Sums `cpuTime`, cumulative CPU seconds, over the processes of a `SystemInfo.getProcessInfo` response. */
export function processInfoCpuSeconds(response: unknown): number {
  return v.parse(processInfoResponse, response).result.processInfo.reduce((sum, process) => sum + process.cpuTime, 0)
}

/**
 * Connects to the browser target of the app behind a CDP port and reads the cumulative CPU seconds of all of its
 * processes (browser, renderers, GPU, utilities) through `SystemInfo.getProcessInfo`. It sees only the app's own
 * processes, never the host's process table.
 */
export async function connectAppCpu(port: number): Promise<{ readSeconds: () => Promise<number>, close: () => void }> {
  const client = await CdpClient.connect(await waitForRemoteDebug(port))
  return {
    readSeconds: async () => processInfoCpuSeconds(await client.send('SystemInfo.getProcessInfo')),
    close: () => client.close(),
  }
}
