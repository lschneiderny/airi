import type { EmotionMapping } from '@proj-airi/stage-shared/expression-performance'

export const emotionTokens: [EmotionMapping['emotion'], string[]][] = [
  ['happy', ['happy', 'smile', 'grin', 'joy', 'laugh', 'wink', 'star eyes', 'cat mouth', 'tongue out', '笑', '吐舌']],
  ['sad', ['sad', 'cry', 'crying', 'tear', 'sob', '哭', '流泪']],
  ['angry', ['angry', 'anger', 'rage', 'mad', 'disdain', 'black face', 'puff cheeks', 'pout', '生气', '愤怒', '鼓脸']],
  ['think', ['think', 'thinking', '思考']],
  ['surprised', ['surprise', 'surprised', 'shock', 'shocked', 'exclamation', '惊']],
  ['awkward', ['awkward', 'sweat', '尴尬', '汗']],
  ['question', ['question', 'confusion', 'confused', '问号', '疑问']],
  ['curious', ['curious']],
  ['love', ['love', 'heart', '爱心']],
  ['flustered', ['blush', 'red', 'shy', 'embarrassed', 'spiral eyes', '脸红', '害羞']],
  ['sleepy', ['sleepy', 'sleep', 'zzz', 'snot', '困', '睡']],
]

export function matchesToken(text: string, token: string): boolean {
  // Non-ASCII (CJK) tokens match by substring; English tokens need word boundaries.
  return /[^\x00-\x7F]/.test(token) ? text.includes(token) : new RegExp(`(?:^|[^a-z])${token}s?(?=$|[^a-z])`).test(text)
}

export function matchesEmotion(label: string): boolean {
  return emotionTokens.some(([, tokens]) => tokens.some(token => matchesToken(label.toLowerCase(), token)))
}
