import { stageContractEmotions } from '@proj-airi/stage-shared/stage-contract'

export enum Emotion {
  Happy = 'happy',
  Sad = 'sad',
  Angry = 'angry',
  Think = 'think',
  Surprise = 'surprised',
  Awkward = 'awkward',
  Question = 'question',
  Curious = 'curious',
  Neutral = 'neutral',
  Love = 'love',
  Flustered = 'flustered',
  Sleepy = 'sleepy',
}

export const EMOTION_VALUES = Object.values(Emotion)

export const EmotionHappyMotionName = 'Happy'
export const EmotionSadMotionName = 'Sad'
export const EmotionAngryMotionName = 'Angry'
export const EmotionAwkwardMotionName = 'Awkward'
export const EmotionThinkMotionName = 'Think'
export const EmotionSurpriseMotionName = 'Surprise'
export const EmotionQuestionMotionName = 'Question'
export const EmotionNeutralMotionName = 'Idle'
export const EmotionCuriousMotionName = 'Curious'

export const EMOTION_EmotionMotionName_value = {
  [Emotion.Happy]: EmotionHappyMotionName,
  [Emotion.Sad]: EmotionSadMotionName,
  [Emotion.Angry]: EmotionAngryMotionName,
  [Emotion.Think]: EmotionThinkMotionName,
  [Emotion.Surprise]: EmotionSurpriseMotionName,
  [Emotion.Awkward]: EmotionAwkwardMotionName,
  [Emotion.Question]: EmotionQuestionMotionName,
  [Emotion.Neutral]: EmotionNeutralMotionName,
  [Emotion.Curious]: EmotionCuriousMotionName,
  [Emotion.Love]: EmotionHappyMotionName,
  [Emotion.Flustered]: EmotionAwkwardMotionName,
  [Emotion.Sleepy]: EmotionNeutralMotionName,
}

/**
 * Names the runtime prompt shows for each emotion.
 *
 * The first nine entries equal `EMOTION_EmotionMotionName_value` so the shipped prompt bytes
 * stay identical; the newer emotions have prompt names of their own because their motion
 * groups fall back to another emotion's group.
 */
export const EMOTION_PromptName_value = Object.fromEntries(
  stageContractEmotions.map(emotion => [emotion.value, emotion.promptName]),
) as Record<(typeof stageContractEmotions)[number]['value'], string> satisfies Record<Emotion, string>

export const EMOTION_VRMExpressionName_value = {
  [Emotion.Happy]: 'happy',
  [Emotion.Sad]: 'sad',
  [Emotion.Angry]: 'angry',
  [Emotion.Think]: 'think',
  [Emotion.Surprise]: 'surprised',
  [Emotion.Awkward]: 'neutral',
  [Emotion.Question]: 'think',
  [Emotion.Neutral]: 'neutral',
  [Emotion.Curious]: 'think',
  [Emotion.Love]: 'happy',
  [Emotion.Flustered]: 'neutral',
  [Emotion.Sleepy]: 'relaxed',
} satisfies Record<Emotion, string | undefined>

export const EMOTION_SpineAnimationName_value = {
  [Emotion.Happy]: 'celebrate',
  [Emotion.Sad]: 'sad',
  [Emotion.Angry]: 'angry',
  [Emotion.Think]: 'think',
  [Emotion.Surprise]: 'surprise',
  [Emotion.Awkward]: 'awkward',
  [Emotion.Question]: 'question',
  [Emotion.Neutral]: 'idle',
  [Emotion.Curious]: 'curious',
  [Emotion.Love]: 'celebrate',
  [Emotion.Flustered]: 'awkward',
  [Emotion.Sleepy]: 'idle',
} satisfies Record<Emotion, string>

export interface EmotionPayload {
  name: Emotion
  intensity: number
}
