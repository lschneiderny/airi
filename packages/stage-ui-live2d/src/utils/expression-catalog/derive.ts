import type { CatalogEntry, EmotionMapping, ExpressionArea, ExpressionKind } from '@proj-airi/stage-shared/expression-performance'

import type { ExpressionDefinition } from '../../composables/live2d/expression/compose'

import { llmAllowedKinds, parseVtubeHotkeys } from '@proj-airi/stage-shared/expression-performance'

import { faceRegions, suggestArea } from './area'
import { deduplicateCatalog } from './dedupe'
import { readParameterDisplayNames } from './display-names'
import { emotionTokens, matchesEmotion, matchesToken } from './tokens'

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

/** Lexicon mappings for face and effect expressions; negated labels such as "cancel" get none. */
export function suggestMappings(label: string, fileName: string, kind: ExpressionKind, area?: ExpressionArea): EmotionMapping[] {
  if (kind !== 'face' && kind !== 'effect')
    return []
  const text = `${label} ${baseName(fileName)}`.toLowerCase()
  if (negationTokens.some(token => matchesToken(text, token)))
    return []
  return emotionTokens
    .filter(([, tokens]) => tokens.some(token => matchesToken(text, token)))
    .map(([emotion]) => ({ emotion, weight: kind === 'face' && (area === 'eyes' || area === 'mouth' || area === 'cheeks') ? 0.5 : 1, minBand: kind === 'effect' ? 'strong' : 'clear' }))
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
  displayInfo?: unknown,
  keepSeparate: ReadonlySet<string> = new Set(),
): CatalogEntry[] {
  const labels = readVtubeHotkeyLabels(vtube)
  const displayNames = readParameterDisplayNames(displayInfo)
  const entries = defs.map((def): CatalogEntry => {
    const reference = model3Refs.find(ref => ref.File === def.id)
    // Explicit model names outrank vendor labels; filenames cover unnamed files.
    let label = labels.get(baseName(def.id).toLowerCase()) ?? baseName(def.id)
    let labelSource: CatalogEntry['labelSource'] = labels.has(baseName(def.id).toLowerCase()) ? 'vtube' : 'file'
    if (typeof reference?.Name === 'string' && cleanLabel(reference.Name)) {
      label = cleanLabel(reference.Name)
      labelSource = 'model'
    }
    const parameterIds = def.parameters.map(parameter => parameter.id)
    let kind = suggestKind(label, def.id)
    if (kind === 'face' && faceRegions(parameterIds, label, displayNames).size === 0 && !matchesEmotion(label))
      kind = 'unsorted'
    const area = kind === 'unsorted' ? 'hidden' : suggestArea(kind, parameterIds, label, displayNames)
    return {
      id: def.id,
      label,
      labelSource,
      kind,
      area,
      group: null,
      confirmed: false,
      exposedToLlm: (llmAllowedKinds as readonly ExpressionKind[]).includes(kind),
      mappings: suggestMappings(label, def.id, kind, area),
      fileName: def.id,
      parameterIds,
    }
  })
  const deduplicated = deduplicateCatalog(entries, defs, new Set(model3Refs.map(ref => ref.File)), keepSeparate)
  const primaryDefs = defs.filter((_, index) => deduplicated[index].duplicateOf === undefined)
  const groups = suggestGroups(primaryDefs, deduplicated.filter(entry => entry.duplicateOf === undefined).map(entry => entry.kind))
  return deduplicated.map(entry => ({ ...entry, group: groups.get(entry.id) ?? null }))
}
