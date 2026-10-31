import type { BodyToolRequest } from '@proj-airi/motion-driver-humanoid/director'

import type { MMDStanceDiagnostics } from './stance'

/** Distance, in model units, within which the root counts as at a spot; the director's arrival tolerance. */
const AT_SPOT_TOLERANCE = 0.1

/** Time in milliseconds a request waits for the director's answer before it fails. */
const ANSWER_TIMEOUT_MS = 2_000

export interface MMDBodyToolState {
  position: 'home' | 'at-chat' | 'elsewhere'
  moving: boolean
  refractorySeconds: number
}

export interface MMDBodyToolResult {
  success: boolean
  state?: MMDBodyToolState
  error?: string
  retryAfterSeconds?: number
}

/** What the port reads from one frame of the stage. */
export interface MMDBodyToolFrame {
  rootX: number
  homeX: number
  /** Where she stands beside an open chat, or null when no chat is open. */
  standX: number | null
  locomotionMode: string
  /** Director-clock time of the frame, in milliseconds. */
  directorMs: number
  diagnostics: Pick<MMDStanceDiagnostics, 'goalX' | 'lastToolSeq' | 'toolRefused' | 'toolRetryAfterMs' | 'moveRefractoryUntilMs'>
}

interface PendingRequest {
  request: BodyToolRequest
  resolve: (result: MMDBodyToolResult) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * The body tool port of one MMD scene.
 *
 * A request is handed to the stance director as `toolRequest`; the director accepts or refuses it on
 * its next frame, and `observe` reads that answer back. The port makes no decision of its own.
 */
export class MMDBodyToolPort {
  private seq = 0
  private frame: MMDBodyToolFrame | null = null
  private pending: PendingRequest | null = null
  private latest: BodyToolRequest | null = null

  /** The newest request, which the director input carries until a newer one replaces it. */
  get request(): BodyToolRequest | null {
    return this.latest
  }

  state(): MMDBodyToolState {
    const frame = this.frame
    if (!frame)
      return { position: 'elsewhere', moving: false, refractorySeconds: 0 }
    const near = (x: number | null) => x !== null && Math.abs(frame.rootX - x) <= AT_SPOT_TOLERANCE
    return {
      position: near(frame.homeX) ? 'home' : near(frame.standX) ? 'at-chat' : 'elsewhere',
      moving: frame.locomotionMode !== 'idle' || frame.diagnostics.goalX !== null,
      refractorySeconds: Math.ceil(Math.max(0, frame.diagnostics.moveRefractoryUntilMs - frame.directorMs) / 1000),
    }
  }

  comeHere(): Promise<MMDBodyToolResult> {
    return this.submit('come-here')
  }

  goHome(): Promise<MMDBodyToolResult> {
    return this.submit('go-home')
  }

  lookAt(target: NonNullable<BodyToolRequest['target']>): Promise<MMDBodyToolResult> {
    return this.submit('look-at', target)
  }

  /** Reads the director's answer to the pending request, if this frame carries one. */
  observe(frame: MMDBodyToolFrame): void {
    this.frame = frame
    const pending = this.pending
    if (!pending || frame.diagnostics.lastToolSeq < pending.request.seq)
      return
    this.settle(pending, frame.diagnostics.toolRefused ? refusal(frame) : { success: true, state: this.state() })
  }

  /** Fails the pending request and withdraws it, for a scene that goes away before the director answers. */
  dispose(): void {
    this.latest = null
    if (this.pending)
      this.settle(this.pending, { success: false, error: 'The stage went away before the request was answered.' })
  }

  /** A request the caller was told failed must never run later: a stalled stage that resumes sees no request. */
  private expire(pending: PendingRequest): void {
    if (this.latest === pending.request)
      this.latest = null
    this.settle(pending, { success: false, error: 'The stage did not answer the request.' })
  }

  private submit(kind: BodyToolRequest['kind'], target?: BodyToolRequest['target']): Promise<MMDBodyToolResult> {
    if (this.pending)
      this.settle(this.pending, { success: false, error: 'A newer body request replaced this one.' })
    const request: BodyToolRequest = { seq: ++this.seq, kind, ...(target ? { target } : {}) }
    this.latest = request
    return new Promise((resolve) => {
      const pending: PendingRequest = {
        request,
        resolve,
        timer: setTimeout(() => this.expire(pending), ANSWER_TIMEOUT_MS),
      }
      this.pending = pending
    })
  }

  private settle(pending: PendingRequest, result: MMDBodyToolResult): void {
    clearTimeout(pending.timer)
    if (this.pending === pending)
      this.pending = null
    pending.resolve(result)
  }
}

function refusal(frame: MMDBodyToolFrame): MMDBodyToolResult {
  const retryMs = frame.diagnostics.toolRetryAfterMs
  if (retryMs !== null && retryMs > 0)
    return { success: false, error: 'The character is not ready for that yet.', retryAfterSeconds: Math.ceil(retryMs / 1000) }
  return { success: false, error: 'The character cannot walk on this stage now.' }
}
