import type { RandomStream } from './random'

import { NaturalCursorAttention } from './cursor-attention'
import { drawCursorEpisode } from './cursor-notice'
import { createRandomStream } from './random'

/**
 * Test support only: until the returned function runs, every cursor attention answers its own reports as the
 * character mind does, with `drawCursorEpisode` on a stream of its own seeded by `seed`. Each order starts its
 * episode at the next grid step, as an order from the host does. Instances with the same seed draw the same episodes,
 * so same-seed comparisons stay paired.
 */
export function answerCursorReports(seed = 1): () => void {
  const prototype = NaturalCursorAttention.prototype
  const step = prototype.step
  const streams = new WeakMap<NaturalCursorAttention, RandomStream>()
  prototype.step = function (this: NaturalCursorAttention, ...args: Parameters<NaturalCursorAttention['step']>) {
    const result = step.apply(this, args)
    let random = streams.get(this)
    if (random === undefined) {
      random = createRandomStream(seed)
      streams.set(this, random)
    }
    for (const report of result.reports)
      this.order({ requestId: report.requestId, episode: drawCursorEpisode(report.band, random) })
    return result
  }
  return () => {
    prototype.step = step
  }
}
