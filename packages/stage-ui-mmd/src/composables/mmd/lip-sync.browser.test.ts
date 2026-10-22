import { afterEach, describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'

import { useMMDLipSync } from './lip-sync'

const contexts: AudioContext[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.close()))
})

/** Creates a running context and a looping 220 Hz tone source, the way the stage plays a speech buffer. */
async function createToneSource(sampleRate: number) {
  const context = new AudioContext({ sampleRate })
  contexts.push(context)
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let index = 0; index < samples.length; index++)
    samples[index] = 0.3 * Math.sin(2 * Math.PI * 220 * index / context.sampleRate)
  const source = new AudioBufferSourceNode(context, { buffer, loop: true })
  await context.resume()
  return { context, source }
}

/** A morph controller stand-in that records the strongest vowel weight the lip sync writes. */
function createRecordingMorphs() {
  let level = 0
  const morphs = {
    set: (_slot: string, weight: number) => {
      level = Math.max(level, weight)
    },
  }
  return { morphs, readLevel: () => level }
}

/** Drives `update` once per frame, like the render loop, until the mouth opens or the bound passes. */
function waitForMouthLevel(readLevel: () => number): Promise<number> {
  return new Promise((resolve, reject) => {
    let frame = 0
    const timeout = setTimeout(() => {
      cancelAnimationFrame(frame)
      reject(new Error('MMD mouth level stayed 0'))
    }, 5000)
    const tick = () => {
      const level = readLevel()
      if (level > 0) {
        clearTimeout(timeout)
        resolve(level)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  })
}

describe('useMMDLipSync', () => {
  it.each([48_000, 192_000])('opens the mouth for a tone at %i Hz', { timeout: 15_000 }, async (sampleRate) => {
    const { context, source } = await createToneSource(sampleRate)
    const lipSync = useMMDLipSync(shallowRef<AudioContext | undefined>(context), shallowRef<AudioBufferSourceNode | undefined>(source))
    const { morphs, readLevel: readWeight } = createRecordingMorphs()
    const readLevel = () => {
      lipSync.update(morphs as never, 0.016)
      return readWeight()
    }
    source.start()

    expect(await waitForMouthLevel(readLevel)).toBeGreaterThan(0)
  })
})
