import type { Profile, WLipSyncAudioNode } from 'wlipsync'

import { afterEach, describe, expect, it } from 'vitest'
import { createWLipSyncNode } from 'wlipsync'

import { createLive2DLipSync } from '.'
import { wlipsyncProfile } from '../shared/wlipsync'

const profile = wlipsyncProfile as Profile
const contexts: AudioContext[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.close()))
})

/** Creates a running context that plays a steady 220 Hz sine at the given peak amplitude. */
async function createToneContext(sampleRate: number, amplitude: number) {
  const context = new AudioContext({ sampleRate })
  contexts.push(context)
  const oscillator = new OscillatorNode(context, { frequency: 220 })
  const source = new GainNode(context, { gain: amplitude })
  oscillator.connect(source)
  oscillator.start()
  await context.resume()
  return { context, source }
}

/**
 * Collects the raw per-block volumes the wLipSync processor posts after the analysis window fills.
 * Rejects when the processor raises `processorerror` or stays silent past the bound.
 */
function collectVolumes(node: WLipSyncAudioNode, count: number): Promise<number[]> {
  const warmupFrames = 16
  return new Promise((resolve, reject) => {
    const volumes: number[] = []
    let frames = 0
    const onMessage = (event: MessageEvent<{ volume: number }>) => {
      frames++
      if (frames > warmupFrames)
        volumes.push(event.data.volume)
      if (volumes.length === count)
        finish()
    }
    // Chromium delivers `processorerror` from a trapped wLipSync processor to `onprocessorerror`, not to `addEventListener` listeners.
    const onProcessorError = (event: ErrorEvent) => finish(new Error(`wLipSync raised processorerror: ${event.message}`))
    const timeout = setTimeout(() => finish(new Error(`wLipSync posted ${frames} of ${warmupFrames + count} frames`)), 5000)
    function finish(error?: Error) {
      clearTimeout(timeout)
      node.port.removeEventListener('message', onMessage)
      node.onprocessorerror = null
      if (error)
        reject(error)
      else
        resolve(volumes)
    }
    node.port.addEventListener('message', onMessage)
    node.onprocessorerror = onProcessorError
  })
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Measures the mean raw level that a Live2D lip sync reports for a tone at the given rate. */
async function measureLive2DLevel(sampleRate: number, amplitude: number) {
  const { context, source } = await createToneContext(sampleRate, amplitude)
  const lipSync = await createLive2DLipSync(context, profile)
  const volumes = collectVolumes(lipSync.node, 32)
  lipSync.connectSource(source)
  const level = mean(await volumes)
  lipSync.dispose()
  return level
}

describe('createLive2DLipSync', () => {
  it('reports the same level as a direct wLipSync node at 48 kHz', { timeout: 15_000 }, async () => {
    const { context, source } = await createToneContext(48_000, 0.3)
    const reference = await createWLipSyncNode(context, profile)
    const lipSync = await createLive2DLipSync(context, profile)
    const referenceVolumes = collectVolumes(reference, 32)
    const volumes = collectVolumes(lipSync.node, 32)
    source.connect(reference)
    lipSync.connectSource(source)

    const referenceLevel = mean(await referenceVolumes)
    const level = mean(await volumes)
    lipSync.dispose()

    expect(referenceLevel).toBeGreaterThan(0.1)
    expect(Math.abs(level - referenceLevel) / referenceLevel).toBeLessThan(0.05)
  })

  it('reports a level that tracks the input at 192 kHz', { timeout: 15_000 }, async () => {
    const reference = await measureLive2DLevel(48_000, 0.3)
    const loud = await measureLive2DLevel(192_000, 0.3)
    const quiet = await measureLive2DLevel(192_000, 0.1)

    expect(Math.abs(loud - reference) / reference).toBeLessThan(0.05)
    expect(loud / quiet).toBeCloseTo(3, 1)
  })
})

describe('wlipsync@1.3.1', () => {
  // When this fails, wLipSync analyses 192 kHz directly and the analysis context in `createWLipSyncAnalysis` can go.
  it('raises processorerror when it analyses a 192 kHz context directly', { timeout: 15_000 }, async () => {
    const { context, source } = await createToneContext(192_000, 0.3)
    const node = await createWLipSyncNode(context, profile)
    const volumes = collectVolumes(node, 32)
    source.connect(node)

    await expect(volumes).rejects.toThrow('processorerror')
  })
})
