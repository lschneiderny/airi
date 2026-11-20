import type { CharacterMind } from '@proj-airi/character-mind'
import type { MusicMemory } from '@proj-airi/stage-shared/music'
import type { AppCategory } from '@proj-airi/stage-shared/situation'

import { advanceMusic, initialMusicMemory, nextMusicDeadline } from '@proj-airi/stage-shared/music'

export interface MindMusicOptions {
  /** Subscribes to the one detector's beats and returns the unsubscribe; the app passes `listenBeatSyncBeatSignal`. */
  listen: (onBeat: () => void) => () => void
  /** The leader's foreground category (`useSituationStore` `foregroundCategory`). */
  category: () => AppCategory | null
}

/**
 * Hosts the music detector for one character mind: it turns the beats of upstream's beat sync detector into music
 * edges (`advanceMusic`) on `Date.now`, the clock of the app's mind, and tells the mind each edge as a `music`
 * stimulus. One timer, armed at `nextMusicDeadline`, feeds the settle end and the release without a new beat.
 */
export class MindMusic {
  private memory: MusicMemory = initialMusicMemory
  private unlisten: (() => void) | undefined
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly mind: CharacterMind, private readonly options: MindMusicOptions) {}

  /** Subscribes to beats and starts deciding edges; the store calls it at promotion. Repeated calls keep the first. */
  start(): void {
    this.unlisten ??= this.options.listen(() => this.observe(true))
  }

  /** Unsubscribes, clears the deadline timer, and, if music was playing, tells the mind it stopped. */
  stop(): void {
    this.unlisten?.()
    this.unlisten = undefined
    this.clearTimer()
    const playing = this.memory.playing
    this.memory = initialMusicMemory
    if (playing)
      this.mind.receive({ kind: 'music', playing: false })
  }

  /** Feeds a change of the foreground app. Does nothing while stopped. */
  observeCategory(): void {
    if (this.unlisten)
      this.observe(false)
  }

  /** After a mind reset, tells the new state that music plays, if it does. */
  replay(): void {
    if (this.memory.playing)
      this.mind.receive({ kind: 'music', playing: true })
  }

  private observe(beat: boolean) {
    const { memory, edge } = advanceMusic(this.memory, { atMs: Date.now(), beat, category: this.options.category() })
    this.memory = memory
    if (edge)
      this.mind.receive({ kind: 'music', playing: edge === 'started' })
    this.arm()
  }

  private arm() {
    this.clearTimer()
    const deadline = nextMusicDeadline(this.memory)
    if (deadline === null)
      return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.observe(false)
    }, Math.max(0, deadline - Date.now()))
  }

  private clearTimer() {
    if (this.timer !== undefined)
      clearTimeout(this.timer)
    this.timer = undefined
  }
}
