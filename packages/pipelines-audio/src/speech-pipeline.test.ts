import type { SpeechPipelineOptions } from './speech-pipeline'
import type { IntentHandle, LoggerLike, PlaybackItem, TextSegment, TextToken, TtsRequest } from './types'

import { describe, expect, it, vi } from 'vitest'

import { createSpeechPipeline } from './speech-pipeline'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return {
    promise,
    resolve,
    reject,
  }
}

function createSegmenter(texts: string[]) {
  return (_tokens: ReadableStream<TextToken>, meta: { streamId: string, intentId: string }) => {
    let index = 0

    return new ReadableStream<TextSegment>({
      pull(controller) {
        const text = texts[index]
        if (text == null) {
          controller.close()
          return
        }

        controller.enqueue({
          streamId: meta.streamId,
          intentId: meta.intentId,
          segmentId: `${meta.streamId}:${index}`,
          text,
          sentenceIndex: index,
          sentenceStart: true,
          special: null,
          reason: 'flush',
          createdAt: Date.now(),
        })
        index += 1
      },
    })
  }
}

/** Records clip boundaries in `log` when given. A scheduled clip starts at once and, with `autoEnd`, ends on the next microtask. */
function createPlaybackSpy(options?: { autoEnd?: boolean, log?: string[] }) {
  const scheduled: Array<PlaybackItem<string>> = []
  const startListeners: Array<(event: { item: PlaybackItem<string>, startedAt: number }) => void> = []
  const endListeners: Array<(event: { item: PlaybackItem<string>, endedAt: number }) => void> = []
  const autoEnd = options?.autoEnd ?? true

  function end(item: PlaybackItem<string>) {
    options?.log?.push(`end:${item.text}`)
    for (const listener of endListeners)
      listener({ item, endedAt: Date.now() })
  }

  return {
    scheduled,
    end,
    playback: {
      schedule(item: PlaybackItem<string>) {
        scheduled.push(item)
        options?.log?.push(`start:${item.text}`)
        startListeners.forEach(listener => listener({ item, startedAt: Date.now() }))
        if (autoEnd)
          queueMicrotask(() => end(item))
      },
      stopAll: vi.fn(),
      stopByIntent: vi.fn(),
      stopByOwner: vi.fn(),
      onStart(listener: (event: { item: PlaybackItem<string>, startedAt: number }) => void) {
        startListeners.push(listener)
      },
      onEnd(listener: (event: { item: PlaybackItem<string>, endedAt: number }) => void) {
        endListeners.push(listener)
      },
      onInterrupt: vi.fn(),
      onReject: vi.fn(),
    },
  }
}

describe('createSpeechPipeline', () => {
  it('carries sentence identity through requests, results, playback, and ordered specials per intent', async () => {
    const { scheduled, playback } = createPlaybackSpy()
    const requests: TtsRequest[] = []
    const results: Array<{ sentenceIndex: number, sentenceStart: boolean }> = []
    const order: string[] = []
    const pipeline = createSpeechPipeline<string>({
      playback,
      async tts(request) {
        requests.push(request)
        return request.text
      },
    })
    pipeline.on('onTtsResult', result => results.push(result))
    pipeline.on('onSpecial', segment => order.push(segment.special!))
    pipeline.on('onPlaybackEnd', event => order.push(event.item.text))
    for (const turnId of ['first', 'second']) {
      const finished = new Promise<void>((resolve) => {
        pipeline.on('onIntentEnd', () => resolve())
      })
      const intent = pipeline.openIntent({ turnId })
      intent.writeLiteral('Hello there.')
      intent.writeSpecial('<|ACT {"emotion":"happy"}|>')
      intent.writeLiteral('This is a test, with a pause! And a third sentence?')
      intent.end()
      await finished
    }
    const identity = (item: { sentenceIndex: number, sentenceStart: boolean }) => [item.sentenceIndex, item.sentenceStart]
    const expected = [[0, true], [1, true], [2, true]]
    expect(requests.map(identity)).toEqual([...expected, ...expected])
    expect(results.map(identity)).toEqual([...expected, ...expected])
    expect(scheduled.map(identity)).toEqual([...expected, ...expected])
    expect(order.slice(0, 4)).toEqual(['Hello there.', '<|ACT {"emotion":"happy"}|>', 'This is a test, with a pause!', 'And a third sentence?'])
  })

  it('preserves playback order when TTS completes out of order', async () => {
    const { scheduled, playback } = createPlaybackSpy()
    const pendingRequests = [
      deferred<string>(),
      deferred<string>(),
      deferred<string>(),
    ]
    const completed: number[] = []

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 2,
      segmenter: createSegmenter(['first', 'second', 'third']),
      playback,
      async tts(request) {
        const text = await pendingRequests[request.sequence]!.promise
        completed.push(request.sequence)
        return text
      },
    })

    // Synthesis completes in the order 1, 2, 0: the second request finishes while the first is
    // still pending, which frees a slot for the third, which also finishes before the first.
    pipeline.on('onTtsRequest', (request) => {
      if (request.sequence === 1) {
        pendingRequests[1]!.resolve('second')
      }
      else if (request.sequence === 2) {
        pendingRequests[2]!.resolve('third')
        void pendingRequests[2]!.promise.then(() => pendingRequests[0]!.resolve('first'))
      }
    })

    const intentFinished = new Promise<void>((resolve) => {
      pipeline.on('onIntentEnd', () => resolve())
    })

    const intent = pipeline.openIntent()
    intent.end()

    await intentFinished

    expect(completed).toEqual([1, 2, 0])
    expect(scheduled.map(item => item.sequence)).toEqual([0, 1, 2])
    expect(scheduled.map(item => item.text)).toEqual(['first', 'second', 'third'])
  })

  it('prefetches TTS requests up to the configured concurrency', async () => {
    const { playback } = createPlaybackSpy()
    const startedRequests: number[] = []
    const pendingRequests = [
      deferred<string>(),
      deferred<string>(),
      deferred<string>(),
    ]
    const requestStarted = [
      deferred<void>(),
      deferred<void>(),
      deferred<void>(),
    ]
    let inFlight = 0
    let maxInFlight = 0

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 2,
      segmenter: createSegmenter(['alpha', 'beta', 'gamma']),
      playback,
      async tts(request: TtsRequest) {
        startedRequests.push(request.sequence)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        requestStarted[request.sequence]!.resolve()

        try {
          return await pendingRequests[request.sequence]!.promise
        }
        finally {
          inFlight -= 1
        }
      },
    })

    const intentFinished = new Promise<void>((resolve) => {
      pipeline.on('onIntentEnd', () => resolve())
    })

    const intent = pipeline.openIntent()
    intent.end()

    await requestStarted[1]!.promise

    expect(startedRequests).toEqual([0, 1])
    expect(maxInFlight).toBe(2)

    pendingRequests[0]!.resolve('alpha')
    pendingRequests[1]!.resolve('beta')
    await requestStarted[2]!.promise

    expect(startedRequests).toEqual([0, 1, 2])

    pendingRequests[2]!.resolve('gamma')
    await intentFinished

    expect(maxInFlight).toBe(2)
  })

  it('cancels in-flight TTS work without scheduling stale playback', async () => {
    const { scheduled, playback } = createPlaybackSpy()
    const abortedRequests: number[] = []
    const bothRequestsStarted = deferred<void>()
    let startedRequests = 0

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 2,
      segmenter: createSegmenter(['left', 'right']),
      playback,
      tts(request, signal) {
        return new Promise<string | null>((resolve) => {
          signal.addEventListener('abort', () => {
            abortedRequests.push(request.sequence)
            resolve(null)
          }, { once: true })
          startedRequests += 1
          if (startedRequests === 2)
            bothRequestsStarted.resolve()
        })
      },
    })

    const intentCanceled = new Promise<void>((resolve) => {
      pipeline.on('onIntentCancel', () => resolve())
    })

    const intent = pipeline.openIntent()
    intent.end()

    await bothRequestsStarted.promise
    intent.cancel('test-cancel')
    await intentCanceled

    expect(abortedRequests.sort()).toEqual([0, 1])
    expect(scheduled).toEqual([])
  })

  it('dispatches special controls only after the preceding playback item ends', async () => {
    const { scheduled, playback, end } = createPlaybackSpy({ autoEnd: false })
    const events: string[] = []

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 2,
      segmenter: (_tokens, meta) => {
        return new ReadableStream<TextSegment>({
          start(controller) {
            controller.enqueue({
              turnId: meta.turnId,
              streamId: meta.streamId,
              intentId: meta.intentId,
              segmentId: 'segment:0',
              text: 'before',
              sentenceIndex: 0,
              sentenceStart: true,
              special: null,
              reason: 'flush',
              createdAt: Date.now(),
            })
            controller.enqueue({
              turnId: meta.turnId,
              streamId: meta.streamId,
              intentId: meta.intentId,
              segmentId: 'segment:1',
              text: '',
              sentenceIndex: 1,
              sentenceStart: false,
              special: '<|CALL ["plugin.action"]|>',
              reason: 'special',
              createdAt: Date.now(),
            })
            controller.close()
          },
        })
      },
      playback,
      async tts(request) {
        events.push(`tts:${request.text}`)
        return request.text
      },
    })

    pipeline.on('onSpecial', (segment) => {
      events.push(`special:${segment.special}`)
      events.push(`turn:${segment.turnId}`)
    })
    pipeline.on('onPlaybackEnd', event => events.push(`end:${event.item.text}`))
    const playbackStarted = new Promise<void>(resolve => pipeline.on('onPlaybackStart', () => resolve()))
    const intentFinished = new Promise<void>(resolve => pipeline.on('onIntentEnd', () => resolve()))

    const intent = pipeline.openIntent({ turnId: 'turn-1' })
    intent.end()

    await playbackStarted
    expect(scheduled.map(item => item.text)).toEqual(['before'])
    expect(events).toEqual(['tts:before'])

    end(scheduled[0]!)
    await intentFinished

    expect(events).toEqual([
      'tts:before',
      'end:before',
      'special:<|CALL ["plugin.action"]|>',
      'turn:turn-1',
    ])
  })

  it('does not schedule queued timeline playback after the owning intent is cancelled', async () => {
    const { scheduled, playback, end } = createPlaybackSpy({ autoEnd: false })

    const pipeline = createSpeechPipeline<string>({
      ttsMaxConcurrent: 2,
      segmenter: (_tokens, meta) => {
        return new ReadableStream<TextSegment>({
          start(controller) {
            controller.enqueue({
              turnId: meta.turnId,
              streamId: meta.streamId,
              intentId: meta.intentId,
              segmentId: 'segment:0',
              text: 'first',
              sentenceIndex: 0,
              sentenceStart: true,
              special: null,
              reason: 'flush',
              createdAt: Date.now(),
            })
            controller.enqueue({
              turnId: meta.turnId,
              streamId: meta.streamId,
              intentId: meta.intentId,
              segmentId: 'segment:1',
              text: 'second',
              sentenceIndex: 1,
              sentenceStart: true,
              special: null,
              reason: 'flush',
              createdAt: Date.now(),
            })
            controller.close()
          },
        })
      },
      playback,
      async tts(request) {
        return request.text
      },
    })

    const playbackStarted = new Promise<void>(resolve => pipeline.on('onPlaybackStart', () => resolve()))
    const intentCanceled = new Promise<void>(resolve => pipeline.on('onIntentCancel', () => resolve()))

    const intent = pipeline.openIntent({ intentId: 'intent-1', turnId: 'turn-1' })
    intent.end()

    await playbackStarted
    expect(scheduled.map(item => item.text)).toEqual(['first'])

    intent.cancel('newer-intent')
    end(scheduled[0]!)
    await intentCanceled

    expect(scheduled.map(item => item.text)).toEqual(['first'])
  })
})

const angry = '<|ACT {"emotion":{"name":"angry","intensity":"clear"}}|>'
const neutral = '<|ACT {"emotion":{"name":"neutral"}}|>'
const happy = '<|ACT {"emotion":{"name":"happy"}}|>'

type Part = { literal: string } | { special: string }

const quietLogger: LoggerLike = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

/**
 * Holds every synthesis until `count` requests are pending, then releases them in request order.
 * A marker therefore arrives while the text ahead of it is still synthesizing, as with a slow TTS.
 */
function createHeldSynthesis(count: number, outcome: (request: TtsRequest) => Promise<string | null> = async request => request.text) {
  const held: Array<() => void> = []

  async function tts(request: TtsRequest) {
    const gate = deferred<void>()
    held.push(gate.resolve)
    if (held.length === count)
      held.forEach(release => release())
    await gate.promise
    return outcome(request)
  }

  return tts
}

/** Runs one turn through the real chunker and records clip boundaries and markers in one ordered log. */
function createOrderedPipeline(tts: SpeechPipelineOptions<string>['tts'], options?: { autoEnd?: boolean }) {
  const log: string[] = []
  const spy = createPlaybackSpy({ autoEnd: options?.autoEnd, log })
  const pipeline = createSpeechPipeline<string>({ playback: spy.playback, tts, logger: quietLogger })
  pipeline.on('onSpecial', segment => log.push(`special:${segment.special}`))
  const turnEnded = new Promise<void>(resolve => pipeline.on('onTurnEnd', () => resolve()))

  function speak(parts: Part[]) {
    const intent = pipeline.openIntent({ turnId: 'turn-1' })
    for (const part of parts) {
      if ('literal' in part)
        intent.writeLiteral(part.literal)
      else
        intent.writeSpecial(part.special)
    }
    intent.end()
    return intent
  }

  return { ...spy, log, pipeline, speak, turnEnded }
}

describe('special marker playback order', () => {
  it('fires a marker after the preceding clip ends and before the next clip starts', async () => {
    const { log, speak, turnEnded } = createOrderedPipeline(createHeldSynthesis(2))

    speak([{ literal: 'I am annoyed now. ' }, { special: neutral }, { literal: ' Okay, better.' }])
    await turnEnded

    expect(log).toEqual([
      'start:I am annoyed now.',
      'end:I am annoyed now.',
      `special:${neutral}`,
      'start:Okay, better.',
      'end:Okay, better.',
    ])
  })

  it('fires a leading marker before the first clip starts', async () => {
    const { log, speak, turnEnded } = createOrderedPipeline(createHeldSynthesis(2))

    speak([{ special: angry }, { literal: ' I am annoyed now. ' }, { special: neutral }, { literal: ' Okay, better.' }])
    await turnEnded

    expect(log).toEqual([
      `special:${angry}`,
      'start:I am annoyed now.',
      'end:I am annoyed now.',
      `special:${neutral}`,
      'start:Okay, better.',
      'end:Okay, better.',
    ])
  })

  it.each([
    ['fails', async () => { throw new Error('synthesis failed') }],
    ['returns no audio', async () => null],
  ])('fires a marker after a sentence whose synthesis %s before the next clip starts', async (_label, silentSynthesis) => {
    const { log, speak, turnEnded } = createOrderedPipeline(createHeldSynthesis(3, async (request) => {
      if (request.text !== 'I am annoyed now.')
        return request.text

      return silentSynthesis()
    }))

    speak([{ literal: 'Hello there. ' }, { literal: 'I am annoyed now. ' }, { special: neutral }, { literal: ' Okay, better.' }])
    await turnEnded

    expect(log).toEqual([
      'start:Hello there.',
      'end:Hello there.',
      `special:${neutral}`,
      'start:Okay, better.',
      'end:Okay, better.',
    ])
  })

  it('fires a marker attached to a chunk without audio before the next clip starts', async () => {
    const { log, speak, turnEnded } = createOrderedPipeline(createHeldSynthesis(2, async (request) => {
      return request.text === 'I am annoyed now' ? null : request.text
    }))

    // Without a period, the chunker attaches the marker to the text before it.
    speak([{ literal: 'I am annoyed now' }, { special: neutral }, { literal: ' Okay, better.' }])
    await turnEnded

    expect(log).toEqual([
      `special:${neutral}`,
      'start:Okay, better.',
      'end:Okay, better.',
    ])
  })

  it('fires every marker in arrival order when speech is muted', async () => {
    const { log, scheduled, speak, turnEnded } = createOrderedPipeline(async () => null)

    speak([
      { special: angry },
      { literal: ' I am annoyed now. ' },
      { special: neutral },
      { literal: ' Okay' },
      { special: happy },
      { literal: ' better.' },
    ])
    await turnEnded

    expect(log).toEqual([`special:${angry}`, `special:${neutral}`, `special:${happy}`])
    expect(scheduled).toEqual([])
  })

  it.each([
    ['cancel', (intent: IntentHandle) => intent.cancel('test-cancel')],
    ['interrupt', (_intent: IntentHandle, pipeline: ReturnType<typeof createSpeechPipeline<string>>) => pipeline.interrupt('test-interrupt')],
  ])('drops pending markers of a turn on %s', async (_label, stop) => {
    const { end, log, pipeline, scheduled, speak } = createOrderedPipeline(createHeldSynthesis(2), { autoEnd: false })
    const arrivedSpecials: string[] = []
    pipeline.on('onSegment', segment => segment.special && arrivedSpecials.push(segment.special))
    const firstClipStarted = new Promise<void>(resolve => pipeline.on('onPlaybackStart', () => resolve()))
    const turnCanceled = new Promise<void>(resolve => pipeline.on('onTurnCancel', () => resolve()))

    const intent = speak([{ literal: 'I am annoyed now. ' }, { special: neutral }, { literal: ' Okay, better.' }])
    await firstClipStarted

    expect(arrivedSpecials).toEqual([neutral])
    expect(log).toEqual(['start:I am annoyed now.'])

    stop(intent, pipeline)
    end(scheduled[0]!)
    await turnCanceled

    expect(log).toEqual(['start:I am annoyed now.', 'end:I am annoyed now.'])
  })
})
