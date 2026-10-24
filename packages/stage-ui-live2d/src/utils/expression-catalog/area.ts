import type { ExpressionArea, ExpressionKind } from '@proj-airi/stage-shared/expression-performance'

import { matchesEmotion, matchesToken } from './tokens'

const regions: [ExpressionArea, string[]][] = [
  ['effects', ['tear', 'sweat', 'heart', 'star', 'mark', 'line', 'shadow', '汗', '泪']],
  ['outfit-hair', ['hair', 'cloth', 'hat', 'mask', '髪', '发', '口罩', '面罩']],
  ['cheeks', ['cheek', 'blush', 'tere', '頬', '腮', '脸红', '鼓脸', '鼓腮']],
  ['mouth', ['mouth', 'lip', 'tongue', 'teeth', 'jaw', '口', '嘴', '舌', '牙']],
  ['eyes', ['eye', 'eyeball', 'brow', 'pupil', 'iris', '目', '眉', '瞳', '眼']],
]

function regionOf(text: string): ExpressionArea | undefined {
  return regions.find(([, tokens]) => tokens.some(token => matchesToken(text.toLowerCase(), token)))?.[0]
}

/** Each parameter has one region; effects and clothing take precedence over facial details. */
export function faceRegions(parameterIds: readonly string[], label: string, names: ReadonlyMap<string, string> = new Map()): Set<ExpressionArea> {
  const found = new Set<ExpressionArea>()
  for (const id of parameterIds) {
    const splitId = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').replace(/[^a-z0-9]/gi, ' ')
    const region = regionOf(`${id} ${splitId} ${names.get(id) ?? ''}`)
    if (region === 'eyes' || region === 'mouth' || region === 'cheeks')
      found.add(region)
  }
  if (found.size === 0) {
    for (const [region, tokens] of regions) {
      if ((region === 'eyes' || region === 'mouth' || region === 'cheeks')
        && tokens.some(token => matchesToken(label.toLowerCase(), token))) {
        found.add(region)
      }
    }
  }
  return found
}

export function suggestArea(kind: ExpressionKind, parameterIds: readonly string[], label: string, names: ReadonlyMap<string, string> = new Map()): ExpressionArea {
  if (kind === 'system')
    return 'hidden'
  if (kind === 'prop')
    return 'props'
  if (kind === 'outfit')
    return 'outfit-hair'
  if (kind === 'effect')
    return 'effects'
  const found = faceRegions(parameterIds, label, names)
  if (found.size >= 2)
    return 'whole-look'
  if (found.size === 1)
    return [...found][0]
  return matchesEmotion(label) ? 'whole-look' : 'hidden'
}
