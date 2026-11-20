/**
 * The emotion vocabulary every renderer and the expression performance layer share.
 * Its values equal `PERFORMANCE_EMOTIONS`, in order.
 */
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
