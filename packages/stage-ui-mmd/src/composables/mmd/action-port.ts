import type { BodyActionRefusal } from '@proj-airi/motion-driver-humanoid/director'

import type { MMDLabeledClip } from '../../stores/mmd'
import type { MMDStanceDiagnostics } from './stance'

/** Time in milliseconds a request waits for the director's answer before it fails; the body tool port waits as long. */
const ANSWER_TIMEOUT_MS = 2_000

export type MMDActionClip = Pick<MMDLabeledClip, 'name' | 'label' | 'kind' | 'exposed'>

export interface MMDExposedAction {
  label: string
  kind: 'action' | 'dance'
}

export interface MMDActionToolState {
  /** `label` is null when the running clip is not one the model may name (an emotion clip, a Lab one-shot). */
  performing: { label: string | null, phase: 'settling' | 'playing', endsInSeconds: number | null } | null
}

export interface MMDActionToolResult {
  success: boolean
  state?: MMDActionToolState
  error?: string
  retryAfterSeconds?: number
  available?: string[]
}

/** What the port reads from one frame of the scene. */
export interface MMDActionFrame {
  /** Director-clock time of the frame, in milliseconds. */
  directorMs: number
  diagnostics: Pick<MMDStanceDiagnostics, 'lastActionSeq' | 'actionRefusal' | 'actionRetryAfterMs' | 'performing'>
}

/** The scene's perform entry, which owns the request queue the director reads. */
export interface MMDActionHost {
  /** Labeled clips of the loaded model, exposed or not. */
  clips: () => readonly MMDActionClip[]
  /** Queues a clip by name (`null` stops) with the `tool` source; returns its request seq, or null when it cannot play. */
  submit: (clipName: string | null) => number | null
  /** Drops the queued request with this seq if the director has not read it. */
  withdraw: (seq: number) => void
}

interface PendingAction {
  seq: number
  stop: boolean
  resolve: (result: MMDActionToolResult) => void
  timer: ReturnType<typeof setTimeout>
}

function isToolActionKind(kind: MMDActionClip['kind']): kind is MMDExposedAction['kind'] {
  return kind === 'action' || kind === 'dance'
}

/**
 * The `perform_action` port of one MMD scene.
 *
 * A request goes through the scene's perform entry like every other clip, so the director sees one queue; the director
 * accepts or refuses it on its next frame (a refusal also advances `lastActionSeq`), and `observe` reads that answer
 * back. The scene calls `observe` every frame in the stage and in the classic window. The port makes no decision of
 * its own and never names a clip the user did not expose.
 */
export class MMDActionPort {
  private frame: MMDActionFrame | null = null
  private pending: PendingAction | null = null

  constructor(private readonly host: MMDActionHost) {}

  exposed(): MMDExposedAction[] {
    return this.host.clips().flatMap(({ label, kind, exposed }) => exposed && isToolActionKind(kind) ? [{ label, kind }] : [])
  }

  state(): MMDActionToolState {
    const frame = this.frame
    const performing = frame?.diagnostics.performing
    if (!frame || !performing)
      return { performing: null }
    const clip = this.host.clips().find(entry => entry.name === performing.clipId)
    const remainingMs = performing.phase === 'playing'
      ? Math.max(0, performing.durationMs - (frame.directorMs - performing.sinceMs))
      : performing.durationMs
    return {
      performing: {
        label: clip?.exposed ? clip.label : null,
        phase: performing.phase,
        endsInSeconds: performing.loop ? null : Math.ceil(remainingMs / 1000),
      },
    }
  }

  perform(label: string | null): Promise<MMDActionToolResult> {
    let clipName: string | null = null
    if (label !== null) {
      const exposed = this.host.clips().find(entry => entry.label === label && entry.exposed && isToolActionKind(entry.kind))
      if (!exposed)
        return Promise.resolve({ success: false, error: `"${label}" is not an exposed action.`, available: this.exposed().map(entry => entry.label) })
      clipName = exposed.name
    }
    if (this.pending)
      this.settle(this.pending, { success: false, error: 'A newer action request replaced this one.' })
    const seq = this.host.submit(clipName)
    if (seq === null)
      return Promise.resolve({ success: false, state: this.state(), error: 'That action cannot play on this model now.' })
    return new Promise((resolve) => {
      const pending: PendingAction = {
        seq,
        stop: clipName === null,
        resolve,
        timer: setTimeout(() => this.expire(pending), ANSWER_TIMEOUT_MS),
      }
      this.pending = pending
    })
  }

  /** Reads the director's answer to the pending request, if this frame carries one. */
  observe(frame: MMDActionFrame): void {
    this.frame = frame
    const pending = this.pending
    const answered = frame.diagnostics.lastActionSeq
    if (!pending || answered < pending.seq)
      return
    // The scene queues one request at a time; a newer one (an ACT cue, the Lab) read first means this one never ran.
    if (answered > pending.seq)
      this.settle(pending, { success: false, error: 'A newer action request replaced this one.' })
    // A stop is never refused, and the director keeps the previous refusal on it, so it is not read.
    else if (pending.stop || frame.diagnostics.actionRefusal === null)
      this.settle(pending, { success: true, state: this.state() })
    else
      this.settle(pending, { ...refusal(frame.diagnostics.actionRefusal, frame.diagnostics.actionRetryAfterMs), state: this.state() })
  }

  /** Fails the pending request, for a scene that goes away before the director answers. */
  dispose(): void {
    if (this.pending)
      this.settle(this.pending, { success: false, error: 'The stage went away before the request was answered.' })
  }

  /** A request the caller was told failed must never run later: a stalled stage that resumes sees no request. */
  private expire(pending: PendingAction): void {
    this.host.withdraw(pending.seq)
    this.settle(pending, { success: false, error: 'The stage did not answer the request.' })
  }

  private settle(pending: PendingAction, result: MMDActionToolResult): void {
    clearTimeout(pending.timer)
    if (this.pending === pending)
      this.pending = null
    pending.resolve(result)
  }
}

function refusal(reason: BodyActionRefusal, retryAfterMs: number | null): Pick<MMDActionToolResult, 'success' | 'error' | 'retryAfterSeconds'> {
  const retryAfterSeconds = retryAfterMs !== null && retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : undefined
  switch (reason) {
    case 'refractory':
      return retryAfterSeconds === undefined
        ? { success: false, error: 'She cannot do that again yet.' }
        : { success: false, error: `She can do that again in ${retryAfterSeconds} s.`, retryAfterSeconds }
    case 'busy':
      return { success: false, error: 'She is already doing something.', ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) }
    case 'asleep':
      return { success: false, error: 'She is asleep.' }
    case 'dragging':
      return { success: false, error: 'She is being moved.' }
  }
}
