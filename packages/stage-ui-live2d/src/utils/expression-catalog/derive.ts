import type { CatalogEntry, EmotionMapping, ExpressionKind } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionDefinition } from '../../composables/live2d/expression/compose'

import { llmAllowedKinds, parseVtubeHotkeys } from '@proj-airi/stage-shared/expression-performance'

function baseName(path: string): string {
  return path.split(/[\\/]/).pop()!.replace(/\.exp3\.json$/i, '')
}

function cleanLabel(label: string): string {
  return label.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim()
}

/** First usable hotkey label wins, independently of path casing and directories. */
export function readVtubeHotkeyLabels(vtube: unknown): Map<string, string> {
  const labels = new Map<string, string>()
  for (const hotkey of parseVtubeHotkeys(vtube)) {
    const key = baseName(hotkey.File).toLowerCase()
    const label = cleanLabel(hotkey.Name)
    if (hotkey.Action === 'ToggleExpression' && key && label && !labels.has(key))
      labels.set(key, label)
  }
  return labels
}

const rules: [ExpressionKind, string[]][] = [
  ['system', ['watermark', '水印']],
  ['prop', ['phone', 'bag', 'game', 'pillow', 'board', 'note', 'box', 'mouse', 'chat box', 'chat text', 'chat icon', 'pen', 'eat']],
  ['outfit', ['hair', 'braid', 'bun', 'ponytail', 'glasses', 'coat', 'bow', 'sleeve', 'nail', 'earring', 'ear hide', 'tail', 'headphone', 'hat', 'cap', 'eye color', 'eye mask', 'mask', 'band-aid', 'sticker', 'arms disappear', 'remove body', 'body']],
  ['effect', ['tear', 'zzz', 'exclamation', 'confusion', 'awkward', 'blood', 'snot', 'black face', 'love', 'red']],
]

/** Ordered token rules avoid substring collisions such as phone in headphone. */
export function suggestKind(label: string, fileName: string): ExpressionKind {
  const text = `${label} ${baseName(fileName)}`.toLowerCase()
  for (const [kind, tokens] of rules) {
    if (tokens.some(token => token === '水印' ? text.includes(token) : new RegExp(`(?:^|[^a-z])${token}s?(?=$|[^a-z])`).test(text)))
      return kind
  }
  return 'face'
}

const negationTokens = ['cancel', 'off', 'hide', 'hidden', 'remove', 'no', 'disappear', '取消', '隐藏', '关闭']

const emotionTokens: [EmotionMapping['emotion'], string[]][] = [
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

function matchesToken(text: string, token: string): boolean {
  // Non-ASCII (CJK) tokens match by substring; English tokens need word boundaries.
  return /[^\x00-\x7F]/.test(token) ? text.includes(token) : new RegExp(`(?:^|[^a-z])${token}s?(?=$|[^a-z])`).test(text)
}

/** Lexicon mappings for face and effect expressions; negated labels such as "cancel" get none. */
export function suggestMappings(label: string, fileName: string, kind: ExpressionKind): EmotionMapping[] {
  if (kind !== 'face' && kind !== 'effect')
    return []
  const text = `${label} ${baseName(fileName)}`.toLowerCase()
  if (negationTokens.some(token => matchesToken(text, token)))
    return []
  return emotionTokens
    .filter(([, tokens]) => tokens.some(token => matchesToken(text, token)))
    .map(([emotion]) => ({ emotion, weight: 1, minBand: kind === 'effect' ? 'strong' : 'clear' }))
}

/** Connected components never cross kinds or use system-owned parameters. */
export function suggestGroups(defs: ExpressionDefinition[], kinds: ExpressionKind[]): Map<string, string | null> {
  const systemParameters = new Set(defs.flatMap((def, index) => kinds[index] === 'system' ? def.parameters.map(parameter => parameter.id) : []))
  const parents = defs.map((_, index) => index)
  function find(index: number): number {
    if (parents[index] !== index)
      parents[index] = find(parents[index])
    return parents[index]
  }
  const owners = new Map<string, { index: number, value: number }[]>()
  defs.forEach((def, index) => {
    if (kinds[index] === 'system')
      return
    for (const parameter of def.parameters) {
      if (systemParameters.has(parameter.id))
        continue
      const key = `${kinds[index]}:${parameter.id}`
      const previous = owners.get(key) ?? []
      for (const owner of previous) {
        if (owner.value !== 0 || parameter.value !== 0)
          parents[find(index)] = find(owner.index)
      }
      previous.push({ index, value: parameter.value })
      owners.set(key, previous)
    }
  })
  const members = new Map<number, string[]>()
  defs.forEach((def, index) => {
    const component = find(index)
    const ids = members.get(component) ?? []
    ids.push(def.id)
    members.set(component, ids)
  })
  const groups = new Map<string, string | null>()
  for (const ids of members.values()) {
    ids.sort((left, right) => {
      const a = Array.from(left, char => char.codePointAt(0)!)
      const b = Array.from(right, char => char.codePointAt(0)!)
      for (let index = 0; index < Math.min(a.length, b.length); index++) {
        if (a[index] !== b[index])
          return a[index] - b[index]
      }
      return a.length - b.length
    })
    for (const id of ids)
      groups.set(id, ids.length > 1 ? `group:${ids[0]}` : null)
  }
  return groups
}

/** Model references use archive-relative File paths, matching definition ids. */
export function deriveCatalog(
  defs: ExpressionDefinition[],
  model3Refs: { File: string, Name?: unknown }[],
  vtube: unknown,
): CatalogEntry[] {
  const labels = readVtubeHotkeyLabels(vtube)
  const entries = defs.map((def): CatalogEntry => {
    const reference = model3Refs.find(ref => ref.File === def.id)
    // Explicit model names outrank vendor labels; filenames cover unnamed files.
    let label = labels.get(baseName(def.id).toLowerCase()) ?? baseName(def.id)
    if (typeof reference?.Name === 'string' && cleanLabel(reference.Name))
      label = cleanLabel(reference.Name)
    const kind = suggestKind(label, def.id)
    return {
      id: def.id,
      label,
      kind,
      group: null,
      confirmed: false,
      exposedToLlm: (llmAllowedKinds as readonly ExpressionKind[]).includes(kind),
      mappings: suggestMappings(label, def.id, kind),
      fileName: def.id,
      parameterIds: def.parameters.map(parameter => parameter.id),
    }
  })
  const groups = suggestGroups(defs, entries.map(entry => entry.kind))
  return entries.map(entry => ({ ...entry, group: groups.get(entry.id)! }))
}
