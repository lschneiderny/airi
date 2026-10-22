import type { Profile, WLipSyncAudioNode } from 'wlipsync'

import { createWLipSyncNode } from 'wlipsync'

/** Highest `AudioContext` sample rate that wLipSync analyses directly. */
export const WLIPSYNC_MAX_SAMPLE_RATE = 48_000

/** A wLipSync analysis that accepts audio from any `AudioContext` sample rate. */
export interface WLipSyncAnalysis {
  /** Node in the caller's `AudioContext`. Connect the audio to analyse to it. */
  input: AudioNode
  /**
   * wLipSync node that reports `volume` and `weights`.
   * It can live in a separate `AudioContext`, so never connect sources to it directly.
   */
  node: WLipSyncAudioNode
  /** Disconnects the input and releases the analysis context when one was created. Safe to call more than once. */
  dispose: () => void
}

/**
 * Creates a wLipSync analysis fed from `context`.
 *
 * Contexts at or below {@link WLIPSYNC_MAX_SAMPLE_RATE} use one wLipSync node directly.
 * Faster contexts are bridged into a separate analysis context at that rate.
 */
export async function createWLipSyncAnalysis(context: AudioContext, profile: Profile): Promise<WLipSyncAnalysis> {
  if (context.sampleRate <= WLIPSYNC_MAX_SAMPLE_RATE) {
    const node = await createWLipSyncNode(context, profile)
    return { input: node, node, dispose: () => node.disconnect() }
  }

  // NOTICE:
  // wlipsync@1.3.1 traps ("memory access out of bounds") above 64 kHz, so 192 kHz devices read volume 0.
  // Its analysis window grows with the context rate and overflows a fixed WASM region in `execute`
  // once it exceeds about 4096 samples. `set_input` itself succeeds. Analyse at 48 kHz instead.
  // Source: wlipsync/dist/audio-processor.js.
  // Remove when the wlipsync@1.3.1 browser test stops reporting processorerror.
  const analysisContext = new AudioContext({ sampleRate: WLIPSYNC_MAX_SAMPLE_RATE })
  const input = context.createMediaStreamDestination()
  const stopInput = () => input.stream.getTracks().forEach(track => track.stop())

  let node: WLipSyncAudioNode
  try {
    node = await createWLipSyncNode(analysisContext, profile)
  }
  catch (error) {
    stopInput()
    void analysisContext.close()
    throw error
  }

  const bridge = analysisContext.createMediaStreamSource(input.stream)
  bridge.connect(node)

  let disposed = false
  const followContextState = () => {
    if (context.state === 'running')
      void analysisContext.resume()
    else if (context.state === 'suspended')
      void analysisContext.suspend()
    else
      dispose()
  }
  function dispose() {
    if (disposed)
      return
    disposed = true
    context.removeEventListener('statechange', followContextState)
    input.disconnect()
    stopInput()
    bridge.disconnect()
    node.disconnect()
    void analysisContext.close()
  }

  context.addEventListener('statechange', followContextState)
  followContextState()

  return { input, node, dispose }
}
