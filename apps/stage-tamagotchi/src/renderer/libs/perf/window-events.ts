import type { PerfWindowEvent, PerfWindowPull, PerfWindowPullRequest, PerfWindowRollup } from '../../../shared/eventa/perf-recording'

import { USAGE_FEATURE_KEYS } from '@proj-airi/stage-shared/perf/usage'

type WindowTags = PerfWindowRollup['tags']

interface QueuedEvent {
  event: PerfWindowEvent
  /** The tick of the last pull that carried the event, or null before any did. */
  sentInTick: number | null
}

/**
 * Queues a stage window's perf events between main's pulls. Each pull carries every event that main has not accepted
 * yet: a model load blocks the renderer, so the pull that carries its event often answers after main's timeout, and
 * main drops that answer. An event leaves the queue once a pull names its tick as accepted. A feature change is
 * noticed at the pull whose tags carry the new hash.
 */
export class WindowPerfEvents {
  private queue: QueuedEvent[] = []
  private lastFeatures: Pick<WindowTags, 'features' | 'featureHash'> | null = null

  /** The stage's display model finished loading, including a reload of the same model. `modelName` is already sanitized. */
  modelLoaded(model: Pick<WindowTags, 'renderer' | 'modelId' | 'modelName'>): void {
    this.push({ name: 'model-load', detail: { renderer: model.renderer, modelId: model.modelId, modelName: model.modelName } })
  }

  attach(rollup: PerfWindowRollup, { tick, acceptedTick }: PerfWindowPullRequest): PerfWindowPull {
    this.queue = this.queue.filter(queued => queued.sentInTick === null || acceptedTick === null || queued.sentInTick > acceptedTick)

    const { features, featureHash } = rollup.tags
    const previous = this.lastFeatures
    if (previous && previous.featureHash !== featureHash) {
      const changed = Object.fromEntries(USAGE_FEATURE_KEYS.filter(key => features[key] !== previous.features[key]).map(key => [key, features[key]]))
      this.push({ name: 'feature-change', detail: { previousFeatureHash: previous.featureHash, featureHash, ...changed } })
    }
    this.lastFeatures = { features, featureHash }

    for (const queued of this.queue)
      queued.sentInTick = tick
    return { ...rollup, events: this.queue.map(queued => queued.event) }
  }

  /** Recording stopped: queued events belong to no session, and the next session starts without a previous hash. */
  clear(): void {
    this.queue = []
    this.lastFeatures = null
  }

  private push(event: PerfWindowEvent): void {
    this.queue.push({ event, sentInTick: null })
  }
}
