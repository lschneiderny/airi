import type { MalformedQueueEntry } from '@proj-airi/cpu-slots'

import { errorMessageFrom } from '@moeru/std'
import { StoreBusyError } from '@proj-airi/cpu-slots'

/** The part of a cpu-slots status that dev:top shows. */
export interface CpuSlotsStatus {
  budget: number
  held: number
  leases: { class: string, slots: number, pid: number, command: string, age: number }[]
  queue: ({ class: string, pid: number, command: string, wait: number } | MalformedQueueEntry)[]
}

export type CpuSlotsView
  = | { kind: 'ok', status: CpuSlotsStatus }
    | { kind: 'busy' }
    | { kind: 'error', message: string }

function pauseBriefly(): void {
  // dev:top is a one-shot CLI, so a synchronous pause before the single retry keeps main() simple.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
}

function failure(error: unknown): CpuSlotsView {
  return { kind: 'error', message: errorMessageFrom(error) ?? 'unknown error' }
}

/** Reads the status once, and once more after a short pause if the store lock is held. */
export function readCpuSlots(read: () => CpuSlotsStatus, pause: () => void = pauseBriefly): CpuSlotsView {
  try {
    return { kind: 'ok', status: read() }
  }
  catch (error) {
    if (!(error instanceof StoreBusyError))
      return failure(error)
  }
  pause()
  try {
    return { kind: 'ok', status: read() }
  }
  catch (error) {
    return error instanceof StoreBusyError ? { kind: 'busy' } : failure(error)
  }
}

const seconds = (ms: number) => `${Math.floor(ms / 1000)}s`
const clip = (command: string) => command.slice(0, 120)

export function renderCpuSlots(view: CpuSlotsView): string[] {
  if (view.kind === 'busy')
    return ['cpu slots: busy (lock held), try again']
  if (view.kind === 'error')
    return [`cpu slots: unavailable (${view.message})`]
  const { status } = view
  const lines = [`cpu slots: held ${status.held}/${status.budget}, ${status.queue.length} queued`]
  for (const lease of status.leases)
    lines.push(`  lease ${lease.class} ${lease.slots} slots pid ${lease.pid} age ${seconds(lease.age)}  ${clip(lease.command)}`)
  for (const entry of status.queue) {
    if ('malformed' in entry)
      lines.push(`  queued malformed pid ${entry.pid ?? '?'} (${entry.file}) touched ${seconds(entry.touched)}`)
    else
      lines.push(`  queued ${entry.class} pid ${entry.pid} waiting ${seconds(entry.wait)}  ${clip(entry.command)}`)
  }
  return lines
}

export function cpuSlotsJson(view: CpuSlotsView): object {
  if (view.kind === 'busy')
    return { busy: true }
  if (view.kind === 'error')
    return { error: view.message }
  const { budget, held, leases, queue } = view.status
  return { budget, held, leases, queue }
}
