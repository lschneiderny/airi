export interface Point {
  readonly x: number
  readonly y: number
}

/** A renderer `pointermove` position in window client coordinates, with its wall-clock time. */
export interface PointerSample {
  readonly clientX: number
  readonly clientY: number
  readonly atMs: number
}

export interface VerificationPatch {
  geometryVerified?: boolean
  cursorVerified?: boolean
}

export interface CoordinateVerifierOptions {
  readonly report: (patch: VerificationPatch) => void
  readonly log: (message: string) => void
  readonly now: () => number
}

interface Timed extends Point {
  readonly at: number
}

export type PointerComparison = 'skipped' | 'match' | 'mismatch' | 'revoked'

const mismatchTolerancePx = 2
const mismatchWindowMs = 10_000
/** Pushes from separate compositor scripts arrive at slightly different times; a sample may pair with any recent reading. */
const readingHistoryMs = 500
const revocationLine = 'linux-desktop: coordinate mismatch revoked verification'

/**
 * Grants and revokes `geometryVerified` and `cursorVerified` from evidence seen
 * in this process.
 *
 * Geometry is granted by a bound window whose compositor size matches its
 * Electron size while every display maps to an output. The cursor is granted
 * once geometry holds and the stream delivered two distinct positions. Two
 * renderer samples that disagree with `cursor - window origin` by more than two
 * pixels within ten seconds revoke both; an older mismatch expires. A revocation
 * requires fresh evidence. Silence never revokes: a resting pointer keeps its
 * reading and its facts. No timer runs here.
 */
export class CoordinateVerifier {
  private geometry = false
  private cursor = false
  private lastPosition: Point | null = null
  private distinctPositions = 0
  private cursorHistory: Timed[] = []
  private readonly origins = new Map<object, Timed[]>()
  private mismatches: number[] = []

  constructor(private readonly options: CoordinateVerifierOptions) {}

  get geometryVerified() { return this.geometry }
  get cursorVerified() { return this.cursor }

  observeGeometry(evidence: { sizeMatches: boolean, displaysKnown: boolean }) {
    if (!evidence.displaysKnown) {
      this.set(false, false)
      return
    }
    if (evidence.sizeMatches)
      this.set(true, this.distinctPositions >= 2)
  }

  observeCursor(point: Point | null) {
    if (!point) {
      this.cursorHistory = []
      return
    }
    this.cursorHistory = this.recent(this.cursorHistory, { ...point, at: this.options.now() })
    if (this.lastPosition?.x !== point.x || this.lastPosition.y !== point.y) {
      this.lastPosition = point
      this.distinctPositions = Math.min(this.distinctPositions + 1, 2)
    }
    if (this.geometry)
      this.set(true, this.distinctPositions >= 2)
  }

  observeWindowOrigin(window: object, origin: Point) {
    this.origins.set(window, this.recent(this.origins.get(window) ?? [], { ...origin, at: this.options.now() }))
  }

  forgetWindow(window: object) {
    this.origins.delete(window)
  }

  comparePointer(window: object, sample: PointerSample): PointerComparison {
    const origins = this.origins.get(window)
    if (!this.geometry || !origins?.length || this.cursorHistory.length === 0)
      return 'skipped'
    const cursors = this.around(this.cursorHistory, sample.atMs)
    const candidates = this.around(origins, sample.atMs)
    const explained = cursors.some(cursor => candidates.some(origin =>
      Math.abs(cursor.x - origin.x - sample.clientX) <= mismatchTolerancePx
      && Math.abs(cursor.y - origin.y - sample.clientY) <= mismatchTolerancePx))
    if (explained)
      return 'match'

    const now = this.options.now()
    this.mismatches = [...this.mismatches.filter(at => now - at <= mismatchWindowMs), now]
    if (this.mismatches.length < 2)
      return 'mismatch'
    this.revokeEvidence()
    this.set(false, false)
    this.options.log(revocationLine)
    return 'revoked'
  }

  reset() {
    this.revokeEvidence()
    this.cursorHistory = []
    this.origins.clear()
    this.set(false, false)
  }

  private revokeEvidence() {
    this.lastPosition = null
    this.distinctPositions = 0
    this.mismatches = []
  }

  private recent(history: Timed[], next: Timed): Timed[] {
    return [...history.filter(entry => next.at - entry.at <= readingHistoryMs), next]
  }

  /** Readings near the sample, plus the latest one, which a resting pointer still holds. */
  private around(history: Timed[], atMs: number): Timed[] {
    return history.filter((entry, index) => index === history.length - 1 || Math.abs(entry.at - atMs) <= readingHistoryMs)
  }

  private set(geometry: boolean, cursor: boolean) {
    const patch: VerificationPatch = {}
    if (geometry !== this.geometry)
      patch.geometryVerified = this.geometry = geometry
    if (cursor !== this.cursor)
      patch.cursorVerified = this.cursor = cursor
    if (Object.keys(patch).length > 0)
      this.options.report(patch)
  }
}
