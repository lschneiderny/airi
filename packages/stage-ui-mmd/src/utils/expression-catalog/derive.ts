import type { CatalogEntry, EmotionMapping, ExpressionArea, ExpressionKind } from '@proj-airi/stage-shared/expression-performance'

import { llmAllowedKinds } from '@proj-airi/stage-shared/expression-performance'

import { MORPH_CANDIDATES, VOWEL_SLOTS } from '../../constants/morphs'

/** The PMX morph fields the catalog reads; `createMMDMorphRuntime(mmd).morphs` satisfies it. */
export interface PmxMorphInfo {
  index: number
  name: string
  /** PMX panel: 0 system (hidden), 1 eyebrow, 2 eye, 3 mouth, 4 other. */
  category: number
  /** PMX morph type: 0 group, 1 vertex, 2 bone, 3-7 UV and additional UV, 8 material, 9 flip, 10 impulse. */
  type: number
}

const vowelNames = new Set(VOWEL_SLOTS.flatMap(slot => MORPH_CANDIDATES[slot]))
// Lip-sync and procedural blink own these morphs; half-width katakana covers names such as ｳｨﾝｸ２右.
const blinkTokens = ['まばたき', 'ウィンク', 'ウインク', 'ｳｨﾝｸ', 'ｳｲﾝｸ', 'blink', 'wink']

function isUvType(type: number): boolean {
  return type >= 3 && type <= 7
}

/** English word tokens need word boundaries; CJK and symbol tokens such as `?` match by substring. */
function matchesToken(text: string, token: string): boolean {
  return /^[a-z]+$/.test(token) ? new RegExp(`(?:^|[^a-z])${token}s?(?=$|[^a-z])`).test(text) : text.includes(token)
}

/**
 * MMD morph-name lexicon. It follows the Live2D catalog token semantics
 * (`stage-ui-live2d/src/utils/expression-catalog/tokens.ts`) with the
 * Japanese names PMX models use instead of the Live2D file-name vocabulary.
 */
export const mmdEmotionTokens: [EmotionMapping['emotion'], string[]][] = [
  ['happy', ['happy', 'smile', 'grin', 'joy', 'laugh', '笑', 'にこ', 'にっこり', 'にやり', '喜', 'なごみ']],
  ['sad', ['sad', 'cry', 'tear', '悲', '泣', '涙']],
  ['angry', ['angry', 'anger', 'mad', '怒']],
  ['think', ['think', 'thinking', '考']],
  ['surprised', ['surprise', 'surprised', 'shock', '驚', 'びっくり', '見開']],
  ['awkward', ['awkward', 'sweat', '困', '汗']],
  ['question', ['question', 'confused', '疑', '?', '？']],
  ['curious', ['curious']],
  ['love', ['love', 'heart', 'はぁと', 'ハート']],
  ['flustered', ['blush', 'shy', '照れ', '赤面']],
  ['sleepy', ['sleepy', 'sleep', 'zzz', '眠']],
]

const negationTokens = ['off', 'hide', 'cancel', 'no', '消', '非表示']

export function suggestMMDKind(morph: PmxMorphInfo): ExpressionKind {
  const text = morph.name.toLowerCase()
  if (vowelNames.has(morph.name) || blinkTokens.some(token => matchesToken(text, token)))
    return 'system'
  if (morph.type === 8 || isUvType(morph.type))
    return 'effect'
  return 'face'
}

export function suggestMMDArea(kind: ExpressionKind, category: number): ExpressionArea {
  if (kind === 'system' || category === 0)
    return 'hidden'
  if (kind === 'effect')
    return 'effects'
  if (category === 1 || category === 2)
    return 'eyes'
  if (category === 3)
    return 'mouth'
  return 'whole-look'
}

export function suggestMMDMappings(name: string, kind: ExpressionKind, area: ExpressionArea): EmotionMapping[] {
  if (kind !== 'face' && kind !== 'effect')
    return []
  const text = name.toLowerCase()
  if (negationTokens.some(token => matchesToken(text, token)))
    return []
  return mmdEmotionTokens
    .filter(([, tokens]) => tokens.some(token => matchesToken(text, token)))
    .map(([emotion]) => ({ emotion, weight: kind === 'face' && (area === 'eyes' || area === 'mouth') ? 0.5 : 1, minBand: kind === 'effect' ? 'strong' : 'clear' }))
}

/**
 * One entry per PMX morph. The morph runtime addresses channels by the exact
 * name, so a repeated name becomes a duplicate aliased to its first morph. An
 * unnamed (blank) morph keeps its raw name for the channel, gets the label
 * `Morph <index>`, and defaults to a hidden system entry the LLM cannot pick.
 */
export function deriveMMDCatalog(morphs: readonly PmxMorphInfo[]): CatalogEntry[] {
  const entries: CatalogEntry[] = []
  const firstByName = new Map<string, CatalogEntry>()
  let unnamed = 0
  for (const morph of morphs) {
    const blank = !morph.name.trim()
    if (blank)
      unnamed++
    const id = `mmd:${morph.index}:${morph.name}`
    const kind = blank ? 'system' : suggestMMDKind(morph)
    const area = suggestMMDArea(kind, morph.category)
    const entry: CatalogEntry = {
      id,
      label: blank ? `Morph ${morph.index}` : morph.name,
      labelSource: blank ? 'file' : 'model',
      kind,
      area,
      group: null,
      confirmed: false,
      // Hidden-panel morphs are model-internal helpers such as emoticon carriers; the user can expose them.
      exposedToLlm: (llmAllowedKinds as readonly ExpressionKind[]).includes(kind) && area !== 'hidden',
      mappings: suggestMMDMappings(morph.name, kind, area),
      fileName: morph.name,
      parameterIds: [morph.name],
    }
    const first = firstByName.get(morph.name)
    if (first) {
      entry.duplicateOf = first.id
      first.aliases = [...first.aliases ?? [], id]
    }
    else {
      firstByName.set(morph.name, entry)
    }
    entries.push(entry)
  }
  if (unnamed > 0)
    console.warn('[mmd-expression-catalog] Unnamed morphs default to hidden system entries:', unnamed)
  return entries
}
