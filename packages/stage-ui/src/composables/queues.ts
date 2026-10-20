import type { UseQueueReturn } from '@proj-airi/stream-kit'

import type { Emotion, EmotionPayload } from '../constants/emotions'

import { createStreamingControlParser, normalizeActPayload } from '@proj-airi/pipelines-audio'
import { createQueue } from '@proj-airi/stream-kit'

export function useEmotionsMessageQueue(emotionsQueue: UseQueueReturn<EmotionPayload>) {
  const actControl = createStreamingControlParser()
  let parsedEmotion: EmotionPayload | undefined

  actControl.onSignal((signal) => {
    if (signal.type !== 'act')
      return

    const emotion = normalizeActPayload(signal.payload).emotion
    if (emotion)
      parsedEmotion = { name: emotion.name as Emotion, intensity: emotion.intensity }
  })

  return createQueue<string>({
    handlers: [
      async (ctx) => {
        parsedEmotion = undefined
        await actControl.dispatchWith(ctx.data)
        if (parsedEmotion) {
          ctx.emit('emotion', parsedEmotion)
          emotionsQueue.enqueue(parsedEmotion)
        }
      },
    ],
  })
}
