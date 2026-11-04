/**
 * Which imported motions the scene has already bound to the live model, and at which revision.
 *
 * A motion that leaves the library is forgotten on the next `prune`, so importing another file under the same name
 * loads, derives and registers it again instead of being skipped as already bound.
 */
export class MotionRegistrations {
  private readonly revisions = new Map<string, number>()

  has(name: string): boolean {
    return this.revisions.has(name)
  }

  /** Whether the motion is bound at exactly this revision, so loading it again would change nothing. */
  isCurrent(name: string, revision: number): boolean {
    return this.revisions.get(name) === revision
  }

  mark(name: string, revision: number): void {
    this.revisions.set(name, revision)
  }

  /** Forgets every motion whose name is not in `liveNames`; returns the forgotten names. */
  prune(liveNames: Iterable<string>): string[] {
    const live = new Set(liveNames)
    const dropped = [...this.revisions.keys()].filter(name => !live.has(name))
    for (const name of dropped)
      this.revisions.delete(name)
    return dropped
  }

  clear(): void {
    this.revisions.clear()
  }
}
