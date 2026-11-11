import type { MotionTraceEvent, MotionTraceV1 } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { CdpClient } from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'
import type { MMDMotionCommand, MMDMotionSnapshot } from '@proj-airi/stage-ui-mmd/stores'

import { randomUUID } from 'node:crypto'

const channelName = 'airi-stores-stage-ui-mmd-motion-diagnostics'

export class CaptureRefusal extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

/** Use the notice's real close action; an unavailable dismissal is reported, never hidden with styles. */
export async function dismissCaptureNotice(client: CdpClient): Promise<boolean | 'absent'> {
  try {
    return await client.evaluate<boolean | 'absent'>(`(async () => {
      const notice = [...document.querySelectorAll('[data-sonner-toast]')].find(toast =>
        toast.querySelector('[data-title]')?.textContent?.trim() === 'AIRI cannot sense everything on this system')
      if (!notice) return 'absent'
      const close = notice.querySelector('button[data-close-button]')
      if (!(close instanceof HTMLButtonElement) || close.disabled || close.dataset.disabled === 'true') return false
      return new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (!notice.isConnected) finish(true)
        })
        const timeout = setTimeout(() => finish(false), 2000)
        const finish = dismissed => {
          clearTimeout(timeout)
          observer.disconnect()
          resolve(dismissed)
        }
        observer.observe(document.documentElement, { childList: true, subtree: true })
        try {
          close.click()
          if (!notice.isConnected) finish(true)
        } catch { finish(false) }
      })
    })()`, 5000)
  }
  catch (error) {
    // Capture still runs when this optional page action cannot be performed.
    if (error instanceof Error)
      return false
    throw error
  }
}

export interface CaptureSnapshot {
  snapshot: MMDMotionSnapshot | null
  nowMs: number
}

/** Each request owns and closes its channel, including on timeout. Only the stage publishes replies. */
export async function captureSnapshot(client: CdpClient, options: { command?: MMDMotionCommand, wait?: 'mounted' | 'recording' | 'stopped' | 'warm' } = {}): Promise<CaptureSnapshot> {
  const wait = options.wait ?? 'mounted'
  const timeout = wait === 'warm' ? 60_000 : wait === 'mounted' ? 30_000 : 10_000
  return client.evaluate<CaptureSnapshot>(`(async () => {
    const channel = new BroadcastChannel(${JSON.stringify(channelName)})
    let latest = null
    let standingSince = null
    const started = performance.now()
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => ${wait === 'mounted' ? 'resolve({ snapshot: latest, nowMs: performance.now() })' : 'reject(new Error("trace-command-timeout"))'}, ${timeout})
        channel.addEventListener('message', event => {
          if (event.data?.type !== 'snapshot') return
          const s = latest = event.data.snapshot
          const now = performance.now()
          const standing = (!s.locomotion || s.locomotion.mode === 'idle') && !s.action.performing && !s.director?.pendingGoal && s.director?.goalX == null
          standingSince = standing ? standingSince ?? now : null
          const ready = ${wait === 'warm'
            ? 's.loadedModelKey && now - started >= 10000 && standingSince !== null && now - standingSince >= 1000'
            : wait === 'mounted'
              ? 's.loadedModelKey'
              : `s.trace?.refused || s.trace?.state === ${JSON.stringify(wait)}`}
          if (ready) {
            clearTimeout(timer)
            resolve({ snapshot: s, nowMs: now })
          }
        })
        ${options.command ? `channel.postMessage(${JSON.stringify(options.command)})` : ''}
      })
    } finally { channel.close() }
  })()`, timeout + 5000)
}

export async function postCaptureCommand(client: CdpClient, command: MMDMotionCommand): Promise<void> {
  await client.evaluate(`(() => {
    const channel = new BroadcastChannel(${JSON.stringify(channelName)})
    channel.postMessage(${JSON.stringify(command)})
    channel.close()
  })()`)
}

export interface CaptureChunk {
  header?: Omit<MotionTraceV1, 'rot' | 'root' | 'channels' | 'events'>
  rot: string
  root: string
  channels: string
  events?: MotionTraceEvent[]
  refused?: string
}

export async function drainCaptureChunk(client: CdpClient, from: number, count: number): Promise<CaptureChunk> {
  const requestId = randomUUID()
  const chunk = await client.evaluate<CaptureChunk>(`(async () => {
    const channel = new BroadcastChannel(${JSON.stringify(channelName)})
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('trace-drain-timeout')), 10000)
        channel.addEventListener('message', event => {
          if (event.data?.type === 'trace' && event.data.requestId === ${JSON.stringify(requestId)}) {
            clearTimeout(timer)
            resolve(event.data)
          }
        })
        channel.postMessage({ type: 'command', name: 'drainTrace', value: ${JSON.stringify({ requestId, from, count })} })
      })
    } finally { channel.close() }
  })()`, 15_000)
  if (chunk.refused)
    throw new CaptureRefusal(chunk.refused)
  return chunk
}
