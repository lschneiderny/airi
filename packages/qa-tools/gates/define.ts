import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import process from 'node:process'

import { emotionGate, naturalIdleLivelinessGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'
import { describe, it } from 'vitest'

import { cellPartialName, livelinessPartialName, nullPartialName, readSelection, seedRange, variantSeeds, variantsFor } from '../src/motion/gate/options'
import { requireRunDir, writePartial } from '../src/motion/gate/partials'
import { runEmotionTrial, runIdleTrace, runPlaceboSeed, trialBoundMs } from '../src/motion/gate/trials'

/** One test per (band, variant) cell of `emotion`; each writes its trial records as one partial of the run. */
export function defineEmotionGate(emotion: PerformanceEmotion): void {
  const selection = readSelection(process.env)
  const runDir = requireRunDir()
  const boundMs = trialBoundMs(process.env)
  describe(`emotion gate: ${emotion}`, () => {
    for (const band of selection.bands) {
      for (const variant of variantsFor(band)) {
        it(`${band} ${variant}`, () => {
          const seeds = variantSeeds(emotionGate, variant, selection.seedsLimit)
          const records = Array.from({ length: seeds.count }, (_, index) => runEmotionTrial({ emotion, band, variant, seed: seeds.start + index, gate: emotionGate, boundMs }))
          writePartial(runDir, cellPartialName(emotion, band, variant), { kind: 'emotion-cell', emotion, band, variant, seeds, records })
        })
      }
    }
  })
}

/** Emotion-free runs with placebo marks, one per full-variant seed: the idle noise the scorer measures effects against. */
export function defineNullGate(): void {
  const selection = readSelection(process.env)
  const runDir = requireRunDir()
  const boundMs = trialBoundMs(process.env)
  describe('emotion gate: idle placebo null', () => {
    it('measures placebo windows of emotion-free runs', () => {
      const seeds = seedRange(emotionGate.seeds.full, selection.seedsLimit)
      const runs = Array.from({ length: seeds.count }, (_, index) => runPlaceboSeed(seeds.start + index, emotionGate, boundMs))
      writePartial(runDir, nullPartialName, { kind: 'null', seeds, ranges: runs[0].ranges, records: runs.flatMap(run => run.records) })
    })
  })
}

/** The idle liveliness gate's three desk traces, warm-up dropped. */
export function defineLivelinessGate(): void {
  const runDir = requireRunDir()
  const boundMs = Math.max(trialBoundMs(process.env), 900_000)
  describe('liveliness gate: idle traces', () => {
    for (const seed of naturalIdleLivelinessGate.seeds) {
      it(`seed ${seed}`, () => {
        writePartial(runDir, livelinessPartialName(seed), { kind: 'liveliness-trace', seed, trace: runIdleTrace(seed, naturalIdleLivelinessGate, boundMs) })
      })
    }
  })
}
